import { Router } from 'express';
import PDFDocument from 'pdfkit';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { billableUsageBytes, billableUsageGb, exactBillableUsageGb, sumBillableUsageBytes } from '../utils/usageThreshold.js';
import { renderPdf } from '../utils/pdfLayout.js';
import { buildPdfPayloadForCustomer } from '../utils/pdfPayload.js';
import * as pdfCharts from '../utils/pdfCharts.js';

export const exportRouter = Router();
exportRouter.use(authenticate);

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

  const totalBytes = sumBillableUsageBytes(reports, (report) => report.usageSize);
  const pricePerGb = Number(customer?.prices[0]?.price || reports[0]?.pricePerGb || 0);
  const totalUsageGb = billableUsageGb(totalBytes);
  const totalRevenue = reports.reduce(
    (sum, report) => sum + exactBillableUsageGb(report.usageSize) * Number(report.pricePerGb),
    0,
  );

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
    physicalSize: String(billableUsageBytes(report.usageSize)),
    sizeGb: billableUsageGb(report.usageSize),
    pricePerGb: Number(report.pricePerGb),
  }));

  const workfolderMap = new Map();
  const departmentMap = new Map();
  for (const row of isilon) {
    const usageBytes = BigInt(row.physicalSize);
    workfolderMap.set(row.workflowFolder, (workfolderMap.get(row.workflowFolder) || 0n) + usageBytes);
    departmentMap.set(row.department, (departmentMap.get(row.department) || 0n) + usageBytes);
  }
  const workfolderSummary = [...workfolderMap.entries()]
    .map(([folderName, usageBytes]) => ({ folderName, sizeGb: billableUsageGb(usageBytes) }))
    .sort((a, b) => b.sizeGb - a.sizeGb);
  const departmentalSummary = [...departmentMap.entries()]
    .map(([deptName, usageBytes]) => ({
      deptName,
      sizeGb: billableUsageGb(usageBytes),
      sharePct: totalBytes ? Math.round((Number(usageBytes) / Number(totalBytes)) * 10000) / 100 : 0,
    }))
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

// ─── Template v9 payload assembly ───────────────────────────────────────────
// Extends getReportExportData with the historical dataset required by
// sections 5.1-5.6 (same-customer rows for the selected year) and the
// folder-config count for 1.1 Data Validation.

export function buildTemplateCurrentReports(isilonRows, month) {
  return isilonRows.map((row) => ({
    reportId: row.id,
    folderId: row.id,
    usageSize: BigInt(row.physicalSize),
    pricePerGb: Number(row.pricePerGb || 0),
    month,
    clusterName: row.department,
    pathLabel: row.workflowFolder,
  }));
}

async function getTemplateV9Payload(query) {
  const base = await getReportExportData(query);
  const folderWhere = { department: { custId: query.custId }, deletedAt: null };
  const [yearRows, folderCount] = await Promise.all([
    prisma.report.findMany({
      where: { custId: query.custId, year: query.year, deletedAt: null, ...(query.fileName && query.fileName !== '1' ? { fileName: query.fileName } : {}) },
      include: { folder: { include: { department: true } } },
      orderBy: [{ month: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.folder.count({ where: folderWhere }),
  ]);

  const historyRows = yearRows.map((row) => ({
    year: row.year,
    month: row.month,
    folderId: row.folderId,
    usageSize: row.usageSize,
    pricePerGb: row.pricePerGb,
    clusterName: row.folder.department.deptName,
    pathLabel: `${row.folder.department.deptName} - ${row.folder.folderName}`,
  }));

  const reports = buildTemplateCurrentReports(base.isilon, query.month);

  return buildPdfPayloadForCustomer({
    customer: { custName: base.customer, prices: [{ price: base.pricePerGb }] },
    custId: query.custId,
    month: query.month,
    year: query.year,
    reports,
    folderCount,
    pendingUnmatched: base.pendingUnmatched,
    generatedAt: base.generatedAt,
    historyRows,
  });
}

export function buildExcelSheets(data) {
  return {
    summary: {
      name: 'Summary',
      headers: ['Customer', 'Month/Year', 'Status', 'Report Rows', 'Total Usage (GB)', 'Price per GB (RM)', 'Total Revenue (RM)', 'Pending Unmatched'],
      rows: [[data.customer, data.period, data.status, data.rowCount, data.totalUsageGb, data.pricePerGb, data.totalRevenue, data.pendingUnmatched]],
    },
    report: {
      name: 'Isilon Report',
      headers: ['No', 'Cluster', 'Workflow Folder', 'Directory', 'Dir Count', 'File Count', 'ADS Count', 'Other Count', 'Physical Size (Bytes)', 'Size (GB)'],
      rows: data.isilon.map((row) => [row.no, row.cluster, row.workflowFolder, row.directory, row.dirCount, row.fileCount, row.adsCount, row.otherCount, row.physicalSize, row.sizeGb]),
    },
    workfolder: {
      name: 'Workfolder Summary',
      headers: ['Workflow Folder', 'Size (GB)'],
      rows: data.workfolderSummary.map((row) => [row.folderName, row.sizeGb]),
    },
    department: {
      name: 'Cluster Summary',
      headers: ['Cluster', 'Size (GB)', 'Share %'],
      rows: data.departmentalSummary.map((row) => [row.deptName, row.sizeGb, row.sharePct]),
    },
  };
}

// GET /api/export/excel — structured workbook JSON consumed by the frontend xlsx library.
exportRouter.get('/excel', async (req, res, next) => {
  try {
    const data = await getReportExportData(await validatePeriodQuery(req));
    res.json({ sheets: buildExcelSheets(data) });
  } catch (err) {
    next(err);
  }
});

// GET /api/export/pdf-data
// Returns structured JSON for PDF rendering or integration testing (Template v9).
exportRouter.get('/pdf-data', async (req, res, next) => {
  try {
    const data = await getTemplateV9Payload(await validatePeriodQuery(req));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/export/pdf
// Streams the formal customer-facing ESAS PDF report (Professional Template v9).
exportRouter.get('/pdf', async (req, res, next) => {
  try {
    const query = await validatePeriodQuery(req);
    const payload = await getTemplateV9Payload(query);
    const filename = `esas-report-${sanitizeFilePart(payload.customer)}-${payload.year}-${payload.month}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true, autoFirstPage: false });
    doc.info.Title = 'Cloud Storage Usage Report';
    doc.info.Customer = payload.customer;
    doc.addPage({ size: 'A4', margin: 50 });
    renderPdf(doc, payload, pdfCharts, null);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    next(err);
  }
});
