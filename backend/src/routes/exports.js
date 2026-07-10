import { Router } from 'express';
import PDFDocument from 'pdfkit';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';

export const exportRouter = Router();
exportRouter.use(authenticate);

const BYTES_PER_GB = 1073741824;

async function resolveExportCustomerId(req, custId) {
  const requested = String(custId || '').trim();
  if (req.user?.role === 'customer_viewer') {
    if (!req.user.custId) { const err = new Error('Customer scope is required'); err.status = 403; throw err; }
    if (requested && requested !== req.user.custId) { const err = new Error('Customer scope mismatch'); err.status = 403; throw err; }
    return req.user.custId;
  }
  return requested;
}

async function validatePeriodQuery(req) {
  const { cust_id, month, year, file_name } = req.query;
  if (!cust_id || !month || !year) {
    const err = new Error('cust_id, month, and year are required');
    err.status = 400;
    throw err;
  }
  const m = String(month).padStart(2, '0');
  const y = String(year);
  if (!/^(0[1-9]|1[0-2])$/.test(m)) {
    const err = new Error('month must be between 01 and 12');
    err.status = 400;
    throw err;
  }
  if (!/^\d{4}$/.test(y)) {
    const err = new Error('year must be a four-digit year');
    err.status = 400;
    throw err;
  }
  return { custId: await resolveExportCustomerId(req, cust_id), month: m, year: y, fileName: file_name ? String(file_name) : null };
}

function bytesToGb(bytes) {
  return Math.ceil(Number(bytes || 0n) / BYTES_PER_GB);
}

function money(value) {
  return Number(value || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function periodLabel(month, year) {
  return new Date(Number(year), Number(month) - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' });
}

function sanitizeFilePart(value) {
  return String(value || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'report';
}

async function getReportExportData({ custId, month, year, fileName }) {
  const where = { custId, month, year, deletedAt: null };
  if (fileName && fileName !== '1') where.fileName = fileName;

  const [reports, customer, latestImport, pendingUnmatched] = await Promise.all([
    prisma.report.findMany({
      where,
      include: {
        folder: { include: { department: { include: { customer: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.customer.findUnique({
      where: { custId },
      include: { prices: { orderBy: { createdAt: 'desc' }, take: 1 } },
    }),
    prisma.importRun.findFirst({
      where: { custId, month, year },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { username: true, fullname: true } } },
    }),
    prisma.unmatchedDirectory.count({
      where: { status: 'PENDING', importRun: { custId, month, year } },
    }),
  ]);

  const totalBytes = reports.reduce((sum, report) => sum + BigInt(report.usageSize || 0n), 0n);
  const pricePerGb = Number(customer?.prices[0]?.price || reports[0]?.pricePerGb || 0);
  const totalUsageGb = reports.reduce((sum, report) => sum + bytesToGb(report.usageSize), 0);
  const totalRevenue = (Number(totalBytes) / BYTES_PER_GB) * pricePerGb;

  const isilon = reports.map((report, index) => ({
    no: index + 1,
    id: report.id,
    cluster: `${report.folder.department.customer.custName} ${report.folder.department.deptName}`,
    department: report.folder.department.deptName,
    workflowFolder: `${report.folder.department.deptName} - ${report.folder.folderName}`,
    directory: report.folderDir || report.folder.folderDirectory || '',
    dirCount: report.dirCount,
    fileCount: report.fileCount,
    adsCount: report.adsCount,
    otherCount: report.otherCount,
    physicalSize: String(report.usageSize),
    sizeGb: bytesToGb(report.usageSize),
  }));

  const workfolderMap = new Map();
  const departmentMap = new Map();
  for (const row of isilon) {
    workfolderMap.set(row.workflowFolder, (workfolderMap.get(row.workflowFolder) || 0) + row.sizeGb);
    departmentMap.set(row.department, (departmentMap.get(row.department) || 0) + row.sizeGb);
  }
  const workfolderSummary = [...workfolderMap.entries()]
    .map(([folderName, sizeGb]) => ({ folderName, sizeGb }))
    .sort((a, b) => b.sizeGb - a.sizeGb);
  const departmentalSummary = [...departmentMap.entries()]
    .map(([deptName, sizeGb]) => ({ deptName, sizeGb, sharePct: totalUsageGb ? Math.round((sizeGb / totalUsageGb) * 10000) / 100 : 0 }))
    .sort((a, b) => b.sizeGb - a.sizeGb);

  return {
    title: 'ESAS Cloud Storage Report',
    custId,
    customer: customer?.custName || custId,
    month,
    year,
    period: periodLabel(month, year),
    generatedAt: new Date().toISOString(),
    status: reports.length ? 'DRAFT' : 'EMPTY',
    pricePerGb,
    totalUsageGb,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    rowCount: reports.length,
    pendingUnmatched,
    latestImport: latestImport ? {
      fileName: latestImport.fileName,
      status: latestImport.status,
      matchedCount: latestImport.matchedCount,
      unmatchedCount: latestImport.unmatchedCount,
      insertedCount: latestImport.insertedCount,
      skippedCount: latestImport.skippedCount,
      createdAt: latestImport.createdAt,
      uploadedBy: latestImport.user?.fullname || latestImport.user?.username || 'Unknown',
    } : null,
    isilon,
    reports: isilon,
    workfolderSummary,
    departmentalSummary,
  };
}

function drawText(doc, text, x, y, options = {}) {
  doc.text(String(text ?? ''), x, y, options);
}

function addPageIfNeeded(doc, y, needed = 80) {
  if (y + needed < doc.page.height - doc.page.margins.bottom) return y;
  doc.addPage();
  return doc.page.margins.top;
}

function drawRule(doc, y) {
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#D9DEE7').lineWidth(0.8).stroke();
}

function drawSummaryCard(doc, x, y, label, value, accent = '#111827', width = 155) {
  doc.roundedRect(x, y, width, 54, 6).fillAndStroke('#F8FAFC', '#D9DEE7');
  doc.fillColor('#6B7280').fontSize(7).font('Helvetica').text(label, x + 10, y + 10, { width: width - 20 });
  doc.fillColor(accent).fontSize(13).font('Helvetica-Bold').text(value, x + 10, y + 28, { width: width - 20 });
}

function truncateLabel(value, maxLength = 34) {
  const text = String(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function formatChartValue(value) {
  const gb = Number(value || 0);
  if (Math.abs(gb) >= 1024) return `${(gb / 1024).toFixed(1)} TB`;
  return `${gb.toLocaleString()} GB`;
}

function drawChartFrame(doc, x, y, width, height) {
  doc.roundedRect(x, y, width, height, 6).fillAndStroke('#FFFFFF', '#D9DEE7');
}

function drawHorizontalBarChart(doc, { y, title, subtitle, rows, labelKey, valueKey, barColor = '#2F9E44', maxRows = 12 }) {
  const limitedRows = rows.slice(0, maxRows);
  const rowHeight = 22;
  const chartHeight = Math.max(96, limitedRows.length * rowHeight + 58);
  y = addPageIfNeeded(doc, y, chartHeight + 24);

  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11).text(title, 50, y);
  doc.fillColor('#6B7280').font('Helvetica').fontSize(8).text(subtitle, 50, y + 14);
  y += 30;

  drawChartFrame(doc, 50, y, 495, chartHeight);
  if (!limitedRows.length) {
    doc.fillColor('#6B7280').font('Helvetica').fontSize(9).text('No data available', 50, y + 38, { width: 495, align: 'center' });
    return y + chartHeight + 22;
  }

  const maxValue = Math.max(...limitedRows.map((row) => Number(row[valueKey] || 0)), 1);
  const labelX = 66;
  const barX = 222;
  const barWidth = 230;
  const valueX = 462;
  let rowY = y + 36;

  doc.fillColor('#6B7280').font('Helvetica').fontSize(7).text('0', barX, y + 18);
  doc.text(formatChartValue(maxValue), barX + barWidth - 60, y + 18, { width: 60, align: 'right' });
  doc.moveTo(barX, y + 30).lineTo(barX + barWidth, y + 30).strokeColor('#E5E7EB').lineWidth(0.5).stroke();

  for (const row of limitedRows) {
    const value = Number(row[valueKey] || 0);
    const width = Math.max(1, (value / maxValue) * barWidth);
    doc.fillColor('#374151').font('Helvetica').fontSize(7).text(truncateLabel(row[labelKey]), labelX, rowY + 3, { width: 145 });
    doc.roundedRect(barX, rowY + 2, barWidth, 12, 3).fill('#EEF2F7');
    doc.roundedRect(barX, rowY + 2, width, 12, 3).fill(barColor);
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(7).text(value.toLocaleString(), valueX, rowY + 2, { width: 55, align: 'right' });
    rowY += rowHeight;
  }

  if (rows.length > maxRows) {
    doc.fillColor('#6B7280').font('Helvetica-Oblique').fontSize(7)
      .text(`Showing top ${maxRows} of ${rows.length} workflow folders by usage.`, 66, y + chartHeight - 18, { width: 450 });
  }
  return y + chartHeight + 22;
}

function drawVerticalBarChart(doc, { y, title, subtitle, rows, labelKey, valueKey, barColor = '#D2991D', maxRows = 8 }) {
  const limitedRows = rows.slice(0, maxRows);
  const chartHeight = 210;
  y = addPageIfNeeded(doc, y, chartHeight + 54);

  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11).text(title, 50, y);
  doc.fillColor('#6B7280').font('Helvetica').fontSize(8).text(subtitle, 50, y + 14);
  y += 30;

  drawChartFrame(doc, 50, y, 495, chartHeight);
  if (!limitedRows.length) {
    doc.fillColor('#6B7280').font('Helvetica').fontSize(9).text('No data available', 50, y + 82, { width: 495, align: 'center' });
    return y + chartHeight + 22;
  }

  const maxValue = Math.max(...limitedRows.map((row) => Number(row[valueKey] || 0)), 1);
  const originX = 78;
  const originY = y + 160;
  const plotWidth = 405;
  const plotHeight = 112;
  const gap = 12;
  const barWidth = Math.max(18, Math.min(42, (plotWidth - gap * (limitedRows.length - 1)) / limitedRows.length));

  doc.strokeColor('#E5E7EB').lineWidth(0.5);
  for (let i = 0; i <= 4; i += 1) {
    const gridY = originY - (plotHeight * i) / 4;
    doc.moveTo(originX, gridY).lineTo(originX + plotWidth, gridY).stroke();
  }
  doc.fillColor('#6B7280').font('Helvetica').fontSize(7)
    .text(formatChartValue(maxValue), originX + plotWidth + 4, originY - plotHeight - 4, { width: 40 })
    .text('0', originX + plotWidth + 4, originY - 4, { width: 40 });

  limitedRows.forEach((row, index) => {
    const value = Number(row[valueKey] || 0);
    const height = Math.max(1, (value / maxValue) * plotHeight);
    const x = originX + index * (barWidth + gap);
    const barY = originY - height;
    doc.roundedRect(x, barY, barWidth, height, 3).fill(barColor);
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(7)
      .text(formatChartValue(value), x - 8, barY - 12, { width: barWidth + 16, align: 'center' });
    doc.fillColor('#374151').font('Helvetica').fontSize(7)
      .text(truncateLabel(row[labelKey], 14), x - 12, originY + 8, { width: barWidth + 24, align: 'center' });
  });

  if (rows.length > maxRows) {
    doc.fillColor('#6B7280').font('Helvetica-Oblique').fontSize(7)
      .text(`Showing top ${maxRows} of ${rows.length} clusters by usage.`, 66, y + chartHeight - 18, { width: 450 });
  }
  return y + chartHeight + 22;
}

function drawTable(doc, { y, title, columns, rows, rowHeight = 18, maxRows = Infinity }) {
  y = addPageIfNeeded(doc, y, 48);
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11).text(title, 50, y);
  y += 18;
  doc.roundedRect(50, y, 495, rowHeight, 3).fill('#111827');
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7);
  let x = 58;
  for (const col of columns) {
    doc.text(col.label, x, y + 6, { width: col.width, align: col.align || 'left' });
    x += col.width;
  }
  y += rowHeight;
  doc.font('Helvetica').fontSize(7).fillColor('#111827');
  const limitedRows = rows.slice(0, maxRows);
  limitedRows.forEach((row, idx) => {
    y = addPageIfNeeded(doc, y, rowHeight + 22);
    if (idx % 2 === 0) doc.rect(50, y, 495, rowHeight).fill('#F8FAFC');
    doc.fillColor('#111827');
    x = 58;
    for (const col of columns) {
      doc.text(String(row[col.key] ?? ''), x, y + 5, { width: col.width, align: col.align || 'left', ellipsis: true });
      x += col.width;
    }
    y += rowHeight;
  });
  if (rows.length > maxRows) {
    y += 4;
    doc.fillColor('#6B7280').font('Helvetica-Oblique').fontSize(7).text(`Showing first ${maxRows} of ${rows.length} rows. Export Excel for the complete table.`, 50, y);
    y += 14;
  }
  return y + 16;
}

export function streamPdf(res, payload) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  const safeCustomer = sanitizeFilePart(payload.customer);
  const filename = `esas-report-${safeCustomer}-${payload.year}-${payload.month}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(20).text(payload.title, 50, 48);
  doc.font('Helvetica').fontSize(10).fillColor('#4B5563').text(`Customer: ${payload.customer}`, 50, 78);
  doc.text(`Period: ${payload.period}`, 50, 94);
  doc.text(`Generated: ${new Date(payload.generatedAt).toLocaleString('en-MY')}`, 50, 110);
  doc.roundedRect(430, 54, 92, 28, 14).fill(payload.status === 'DRAFT' ? '#FEF3C7' : '#E5E7EB');
  doc.fillColor(payload.status === 'DRAFT' ? '#92400E' : '#374151').font('Helvetica-Bold').fontSize(9).text(payload.status, 430, 64, { width: 92, align: 'center' });
  drawRule(doc, 138);

  drawSummaryCard(doc, 50, 156, 'TOTAL USAGE', `${payload.totalUsageGb.toLocaleString()} GB`, '#0F766E');
  drawSummaryCard(doc, 220, 156, 'PRICE PER GB', `RM ${payload.pricePerGb}`, '#B45309');
  drawSummaryCard(doc, 390, 156, 'TOTAL REVENUE', `RM ${money(payload.totalRevenue)}`, '#047857');

  let y = 236;
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12).text('Report Validation', 50, y);
  y += 18;
  const validationRows = [
    `Rows in report: ${payload.rowCount}`,
    `Pending unmatched paths: ${payload.pendingUnmatched}`,
    payload.latestImport ? `Latest import: ${payload.latestImport.fileName} (${payload.latestImport.status})` : 'Latest import: none recorded',
  ];
  doc.font('Helvetica').fontSize(9).fillColor('#374151');
  validationRows.forEach((line) => { doc.text(`• ${line}`, 58, y); y += 14; });
  y += 8;

  if (!payload.isilon.length) {
    doc.fillColor('#991B1B').font('Helvetica-Bold').fontSize(11).text('No Isilon report data exists for this customer and period.', 50, y);
    doc.end();
    return;
  }

  y = drawHorizontalBarChart(doc, {
    y,
    title: '2.1 Workfolder Summary',
    subtitle: 'Storage usage by workflow folder (GB)',
    rows: payload.workfolderSummary,
    labelKey: 'folderName',
    valueKey: 'sizeGb',
    barColor: '#39D353',
    maxRows: 12,
  });

  y = drawVerticalBarChart(doc, {
    y,
    title: '2.2 Cluster Summary',
    subtitle: 'Storage usage by cluster',
    rows: payload.departmentalSummary,
    labelKey: 'deptName',
    valueKey: 'sizeGb',
    barColor: '#D2991D',
    maxRows: 8,
  });

  y = drawTable(doc, {
    y,
    title: 'Isilon Report',
    columns: [
      { key: 'no', label: 'No', width: 24 },
      { key: 'cluster', label: 'Cluster', width: 120 },
      { key: 'workflowFolder', label: 'Workflow Folder', width: 210 },
      { key: 'sizeGb', label: 'Size (GB)', width: 85, align: 'right' },
    ],
    rows: payload.isilon.map((row) => ({ ...row, sizeGb: row.sizeGb.toLocaleString() })),
    maxRows: 40,
  });

  y = drawTable(doc, {
    y,
    title: 'Workfolder Summary',
    columns: [
      { key: 'folderName', label: 'Workflow Folder', width: 320 },
      { key: 'sizeGb', label: 'Size (GB)', width: 110, align: 'right' },
    ],
    rows: payload.workfolderSummary.map((row) => ({ ...row, sizeGb: row.sizeGb.toLocaleString() })),
    maxRows: 25,
  });

  y = drawTable(doc, {
    y,
    title: 'Cluster Summary',
    columns: [
      { key: 'deptName', label: 'Cluster', width: 240 },
      { key: 'sizeGb', label: 'Size (GB)', width: 95, align: 'right' },
      { key: 'sharePct', label: 'Share %', width: 80, align: 'right' },
    ],
    rows: payload.departmentalSummary.map((row) => ({ ...row, sizeGb: row.sizeGb.toLocaleString(), sharePct: `${row.sharePct}%` })),
  });



  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.fillColor('#6B7280').font('Helvetica').fontSize(7)
      .text(`ESAS Cloud Storage Report • ${payload.customer} • ${payload.period}`, 50, 812, { width: 360 });
    doc.text(`Page ${i + 1} of ${range.count}`, 470, 812, { width: 75, align: 'right' });
  }

  doc.end();
}

// GET /api/export/excel
// Returns JSON structured for Excel generation (3 sheets: Report, Breakdown, Summary)
exportRouter.get('/excel', async (req, res, next) => {
  try {
    const query = await validatePeriodQuery(req);
    const data = await getReportExportData(query);

    res.json({
      sheets: {
        summary: {
          name: 'Summary',
          headers: ['Customer', 'Month/Year', 'Status', 'Report Rows', 'Total Usage (GB)', 'Price per GB (RM)', 'Total Revenue (RM)', 'Pending Unmatched'],
          rows: [[data.customer, data.period, data.status, data.rowCount, data.totalUsageGb, data.pricePerGb, data.totalRevenue, data.pendingUnmatched]],
        },
        report: {
          name: 'Isilon Report',
          headers: ['No', 'Cluster', 'Workflow Folder', 'Directory', 'Dir Count', 'File Count', 'ADS Count', 'Other Count', 'Physical Size (Bytes)', 'Size (GB)'],
          rows: data.isilon.map((r) => [r.no, r.cluster, r.workflowFolder, r.directory, r.dirCount, r.fileCount, r.adsCount, r.otherCount, r.physicalSize, r.sizeGb]),
        },
        workfolder: {
          name: 'Workfolder Summary',
          headers: ['Workflow Folder', 'Size (GB)'],
          rows: data.workfolderSummary.map((r) => [r.folderName, r.sizeGb]),
        },
        department: {
          name: 'Cluster Summary',
          headers: ['Cluster', 'Size (GB)', 'Share %'],
          rows: data.departmentalSummary.map((r) => [r.deptName, r.sizeGb, r.sharePct]),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/export/pdf-data
// Returns structured JSON for PDF rendering or integration testing.
exportRouter.get('/pdf-data', async (req, res, next) => {
  try {
    const data = await getReportExportData(await validatePeriodQuery(req));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/export/pdf
// Streams a formal customer-facing ESAS PDF report.
exportRouter.get('/pdf', async (req, res, next) => {
  try {
    const data = await getReportExportData(await validatePeriodQuery(req));
    streamPdf(res, data);
  } catch (err) {
    next(err);
  }
});
