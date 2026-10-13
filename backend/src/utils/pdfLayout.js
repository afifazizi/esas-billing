// Professional Template v9 PDF layout renderer.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { monthName, monthShort } from './pdfTemplate.js';
import { clusterColor } from './pdfCharts.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHARCOAL = '#262626';
const TEXT = '#333333';
const MUTED = '#6F767D';
const RULE = '#D8DDE2';
const ORANGE = '#F58220';
const BLACK_HEADER = '#262626';
const TOTAL_BG = '#FFF4EA';
const POSITIVE_BG = '#D9EFD2';
const NEGATIVE_BG = '#F4CCCC';
const NEUTRAL_BG = '#E9ECF0';

export const PAGE_MARGIN_LEFT = 57;
export const PAGE_CONTENT_WIDTH = 482;
const PAGE_RIGHT = PAGE_MARGIN_LEFT + PAGE_CONTENT_WIDTH;

export function resolveLogoPath() {
  return resolve(HERE, '../assets/ipsb-logo.png');
}

export function footerLeft(payload) {
  return `ESAS Cloud Storage Report | ${payload.customer} | ${monthName(payload.month)} ${payload.year}`;
}

export function footerRight(pageNumber) {
  return `Page ${pageNumber}`;
}

export function buildRenderPlan(payload = {}) {
  const portrait = (name, extra = {}) => ({ name, layout: 'portrait', ...extra });
  return [
    portrait('COVER', { standalone: true }),
    portrait('1. Executive Summary'),
    portrait('2. Isilon Report'),
    portrait('3. Workfolder Summary'),
    portrait('4. Cluster Summary'),
    portrait('5.1 Monthly Total Usage'),
    portrait('5.2 Cluster Trend'),
    portrait('5.3 Monitoring Scope Changes / 5.4 / 5.5'),
    ...(payload.momMatrix?.rows?.length ? [portrait('5.6 Detailed Month-on-Month Differences')] : []),
    portrait('6. Billing Summary'),
  ];
}

function addPortraitPage(doc) {
  doc.addPage({ size: 'A4', layout: 'portrait', margin: 50 });
  return 57;
}

function heading(doc, text, y = 60, size = 13) {
  doc.fillColor(CHARCOAL).font('Helvetica-Bold').fontSize(size)
    .text(text, PAGE_MARGIN_LEFT, y, { width: PAGE_CONTENT_WIDTH, lineBreak: false });
  return y + size + 12;
}

function subheading(doc, text, y) {
  doc.fillColor(CHARCOAL).font('Helvetica-Bold').fontSize(9.5)
    .text(text, PAGE_MARGIN_LEFT, y, { width: PAGE_CONTENT_WIDTH, lineBreak: false });
  return y + 18;
}

function paragraph(doc, text, y, size = 7.2) {
  doc.fillColor(TEXT).font('Helvetica').fontSize(size)
    .text(text, PAGE_MARGIN_LEFT, y, { width: PAGE_CONTENT_WIDTH, lineGap: 1.2 });
  return doc.y + 8;
}

function asCell(value, options = {}) {
  if (value && typeof value === 'object' && Object.hasOwn(value, 'text')) return value;
  return { text: String(value ?? ''), ...options };
}

function table(doc, {
  y,
  columns,
  rows,
  header = true,
  headerLabels = null,
  rowHeight = 18.8,
  fontSize = 6.1,
  x = PAGE_MARGIN_LEFT,
  width = PAGE_CONTENT_WIDTH,
  border = true,
}) {
  let cursorY = y;
  const labels = headerLabels || columns.map((c) => c.label);
  if (header) {
    doc.rect(x, cursorY, width, rowHeight).fill(BLACK_HEADER);
    let cx = x;
    labels.forEach((label, index) => {
      const col = columns[index];
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(fontSize)
        .text(String(label ?? ''), cx + 5, cursorY + 5.2, { width: col.w - 10, align: col.align || 'left', lineBreak: false });
      cx += col.w;
    });
    cursorY += rowHeight;
  }

  rows.forEach((rawRow) => {
    const row = rawRow.map((cell) => asCell(cell));
    let cx = x;
    row.forEach((cell, index) => {
      const col = columns[index];
      if (cell.bg) doc.rect(cx, cursorY, col.w, rowHeight).fill(cell.bg);
      doc.fillColor(cell.color || TEXT).font(cell.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(cell.fontSize || fontSize)
        .text(String(cell.text ?? ''), cx + 5, cursorY + 5.1, {
          width: col.w - 10,
          align: cell.align || col.align || 'left',
          lineBreak: false,
          ellipsis: true,
          height: rowHeight - 6,
        });
      cx += col.w;
    });
    if (border) {
      doc.moveTo(x, cursorY + rowHeight).lineTo(x + width, cursorY + rowHeight).strokeColor(RULE).lineWidth(0.35).stroke();
    }
    cursorY += rowHeight;
  });
  return cursorY;
}

function changeCell(value, { suffix = '', signed = false } = {}) {
  const str = String(value ?? '');
  const num = Number.parseFloat(str.replace(/[^0-9+-.]/g, ''));
  const display = signed && Number.isFinite(num) && num > 0 && !str.startsWith('+') ? `+${str}${suffix}` : `${str}${suffix}`;
  if (!Number.isFinite(num) || str === 'N/A' || str === '-') return { text: display, bg: NEUTRAL_BG, align: 'right' };
  return { text: display, bg: num > 0 ? POSITIVE_BG : num < 0 ? NEGATIVE_BG : NEUTRAL_BG, color: num > 0 ? '#2E7D32' : num < 0 ? '#B3261E' : MUTED, align: 'right' };
}

function cleanCluster(value, customer = '') {
  let text = String(value || '').trim();
  if (customer && text.toUpperCase().startsWith(`${String(customer).toUpperCase()} `)) text = text.slice(String(customer).length + 1);
  return text.replace(/^MP\s+/i, '').trim();
}

function drawCover(doc, payload) {
  const logo = resolveLogoPath();
  if (!existsSync(logo)) throw new Error(`IPSB logo asset not found: ${logo}`);
  doc.image(logo, 215.4, 85.4, { width: 164.4, height: 90.3 });
  doc.rect(263.6, 189.9, 68, 4.5).fill(ORANGE);

  doc.fillColor(CHARCOAL).font('Helvetica-Bold').fontSize(26)
    .text('Enterprise Storage', 57, 279, { lineBreak: false })
    .text('Archiving System (ESAS)', 57, 311, { lineBreak: false });
  doc.fillColor(MUTED).font('Helvetica').fontSize(12)
    .text('Cloud Storage Usage Report', 57, 350, { lineBreak: false });

  const labelX = 84;
  const valueX = 210;
  const lineX1 = 78;
  const lineX2 = 517;
  let y = 425;
  for (const row of payload.metadata) {
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5)
      .text(String(row.label).toUpperCase(), labelX, y, { width: 121, lineBreak: false, ellipsis: false });
    doc.fillColor(TEXT).font('Helvetica').fontSize(7.5)
      .text(String(row.value), valueX, y, { width: 300, lineBreak: false, ellipsis: true });
    doc.moveTo(lineX1, y + 16.3).lineTo(lineX2, y + 16.3).strokeColor(RULE).lineWidth(0.45).stroke();
    y += 24.4;
  }

  doc.rect(57, 665, 482, 27).fill(ORANGE);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.4)
    .text('CONFIDENTIAL - For authorised use only', 57, 675, { width: 482, align: 'center', lineBreak: false });
}

function drawExecutive(doc, payload) {
  heading(doc, '1. Executive Summary');
  paragraph(doc, `This report presents the ${monthName(payload.month)} ${payload.year} ESAS storage utilization together with historical usage from January to ${monthName(payload.month)} ${payload.year}. The report provides key usage, revenue and validation information for the selected billing period.`, 85);

  const cardY = 134.7;
  const cardW = 153.1;
  const gap = 5.7;
  const cards = [
    ['TOTAL USAGE', `${Number(payload.totalUsageGb).toLocaleString()} GB`, `${monthName(payload.month)} billing output`],
    ['PRICE PER GB', `RM ${payload.pricePerGb}`, 'Configured billing rate'],
    ['TOTAL REVENUE', `RM ${Number(payload.totalRevenue).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 'Monthly calculated charge'],
  ];
  cards.forEach(([label, value, sub], i) => {
    const x = 65.5 + i * (cardW + gap);
    doc.rect(x, cardY, cardW, 70.9).strokeColor(RULE).lineWidth(0.55).stroke();
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(6.4).text(label, x, cardY + 8, { width: cardW, align: 'center', lineBreak: false });
    doc.fillColor(CHARCOAL).font('Helvetica-Bold').fontSize(13).text(value, x + 5, cardY + 29, { width: cardW - 10, align: 'center', lineBreak: false, ellipsis: true });
    doc.fillColor(MUTED).font('Helvetica').fontSize(6.2).text(sub, x, cardY + 57, { width: cardW, align: 'center', lineBreak: false });
  });

  subheading(doc, '1.1 Data Validation', 235);
  table(doc, {
    y: 255,
    columns: [{ label: 'Validation Item', w: 270 }, { label: 'Result', w: 125 }, { label: 'Status', w: 87, align: 'center' }],
    rows: payload.validation.map((row) => [row.item, row.result, { text: row.status, color: row.status === 'PASS' ? '#2E7D32' : '#B3261E', bold: true, align: 'center' }]),
    rowHeight: 18.8,
    fontSize: 6.3,
  });
}

function drawIsilon(doc, payload) {
  heading(doc, '2. Isilon Report');
  paragraph(doc, `Detailed ${monthName(payload.month)} ${payload.year} storage utilization by cluster and workflow folder.`, 85);
  const maxRows = 34;
  const chunks = [];
  for (let i = 0; i < payload.isilon.length; i += maxRows) chunks.push(payload.isilon.slice(i, i + maxRows));
  if (!chunks.length) chunks.push([]);
  chunks.forEach((chunk, chunkIndex) => {
    if (chunkIndex > 0) {
      addPortraitPage(doc);
      heading(doc, '2. Isilon Report (continued)');
    }
    const rows = chunk.map((row) => {
      const cluster = cleanCluster(row.cluster, payload.customer);
      return [row.no, { text: cluster, bg: clusterColor(cluster) }, row.workflowFolder, Number(row.sizeGb).toLocaleString()];
    });
    const isLast = chunkIndex === chunks.length - 1;
    if (isLast) rows.push([{ text: '', bg: TOTAL_BG }, { text: 'TOTAL', bg: TOTAL_BG, bold: true }, { text: '', bg: TOTAL_BG }, { text: Number(payload.totalUsageGb).toLocaleString(), bg: TOTAL_BG, bold: true, align: 'right' }]);
    table(doc, {
      y: chunkIndex === 0 ? 105.9 : 93,
      columns: [{ label: 'No', w: 31 }, { label: 'Cluster', w: 122 }, { label: 'Workflow Folder', w: 245 }, { label: 'Size (GB)', w: 84, align: 'right' }],
      rows,
      rowHeight: 18.8,
      fontSize: 5.8,
    });
  });
}

function workflowCluster(folderName) {
  const text = String(folderName || '');
  if (/DA \(OLD ARCHIVE\)|DALET/i.test(text)) return 'DA (OLD ARCHIVE)';
  if (/POST PRODUCTION|\bPP\b/i.test(text)) return 'POST PRODUCTION';
  if (/NEARLINE/i.test(text)) return 'NEARLINE';
  if (/NEWS|NRCS/i.test(text)) return 'NEWS';
  return 'ARCHIVE';
}

function drawWorkfolders(doc, payload, charts) {
  heading(doc, '3. Workfolder Summary');
  charts.drawHorizontalBarChart(doc, {
    y: 102,
    rows: payload.workfolderChart,
    labelKey: 'folderName',
    valueKey: 'sizeGb',
    maxRows: 12,
    height: 210,
  });

  const perFirstPage = 22;
  const first = payload.workfolderSummary.slice(0, perFirstPage);
  const rest = payload.workfolderSummary.slice(perFirstPage);
  const makeRows = (items, offset, includeTotal) => {
    const rows = items.map((row, i) => [
      offset + i + 1,
      { text: row.folderName, bg: clusterColor(workflowCluster(row.folderName)) },
      Number(row.sizeGb).toLocaleString(),
    ]);
    if (includeTotal) rows.push([{ text: '', bg: TOTAL_BG }, { text: 'TOTAL', bg: TOTAL_BG, bold: true }, { text: Number(payload.totalUsageGb).toLocaleString(), bg: TOTAL_BG, bold: true, align: 'right' }]);
    return rows;
  };
  table(doc, {
    y: 326,
    columns: [{ label: 'No', w: 31 }, { label: 'Workflow Folder', w: 367 }, { label: 'Size (GB)', w: 84, align: 'right' }],
    rows: makeRows(first, 0, !rest.length),
    rowHeight: 18.8,
    fontSize: 5.8,
  });

  if (rest.length) {
    const chunks = [];
    for (let i = 0; i < rest.length; i += 35) chunks.push(rest.slice(i, i + 35));
    chunks.forEach((chunk, index) => {
      addPortraitPage(doc);
      const isLast = index === chunks.length - 1;
      table(doc, {
        y: 57,
        columns: [{ label: 'No', w: 31 }, { label: 'Workflow Folder', w: 367 }, { label: 'Size (GB)', w: 84, align: 'right' }],
        rows: makeRows(chunk, perFirstPage + index * 35, isLast),
        rowHeight: 18.8,
        fontSize: 5.8,
      });
    });
  }
}

function drawCluster(doc, payload, charts) {
  heading(doc, '4. Cluster Summary');
  const chartRows = payload.clusterChart.map((row) => ({ ...row, deptName: cleanCluster(row.deptName, payload.customer) }));
  charts.drawVerticalBarChart(doc, { y: 91, rows: chartRows, labelKey: 'deptName', valueKey: 'sizeGb', height: 210 });
  const rows = payload.departmentalSummary.map((row, i) => {
    const cluster = cleanCluster(row.deptName, payload.customer);
    return [i + 1, { text: cluster, bg: clusterColor(cluster) }, Number(row.sizeGb).toLocaleString(), `${row.sharePct}%`];
  });
  rows.push([{ text: '', bg: TOTAL_BG }, { text: 'TOTAL', bg: TOTAL_BG, bold: true }, { text: Number(payload.totalUsageGb).toLocaleString(), bg: TOTAL_BG, bold: true, align: 'right' }, { text: '100.00%', bg: TOTAL_BG, bold: true, align: 'right' }]);
  table(doc, {
    y: 312,
    columns: [{ label: 'No', w: 31 }, { label: 'Cluster', w: 255 }, { label: 'Size (GB)', w: 107, align: 'right' }, { label: 'Share', w: 89, align: 'right' }],
    rows,
    rowHeight: 18.8,
    fontSize: 6.2,
  });
}

function drawMonthlyTrend(doc, payload, charts) {
  heading(doc, `5. Storage Usage Trend - January to ${monthName(payload.month)} ${payload.year}`);
  paragraph(doc, `Historical usage below follows the monthly TB dataset supplied for ${payload.year}. The historical series is retained separately from the ${monthName(payload.month)} billing output for management analysis and month-on-month comparison.`, 85);
  subheading(doc, '5.1 Monthly Total Usage', 125);
  charts.drawLineChart(doc, { y: 143, rows: payload.monthlySeries, labelKey: 'labelShort', valueKey: 'usageTbNum', height: 165 });
  table(doc, {
    y: 326,
    columns: [{ label: 'Month', w: 160 }, { label: 'Usage (TB)', w: 105, align: 'right' }, { label: 'Usage (PB)', w: 105, align: 'right' }, { label: 'MoM Change', w: 112, align: 'right' }],
    rows: payload.monthlySeries.map((row) => [row.label, row.usageTb, row.usagePb, changeCell(row.momPct)]),
    rowHeight: 18.8,
    fontSize: 6.2,
  });
}

function drawClusterTrend(doc, payload, charts) {
  subheading(doc, '5.2 Cluster Trend', 59.5);
  charts.drawMultiLineChart(doc, { y: 82, months: payload.trendMonths, series: payload.clusterTrend, height: 190 });
  const monthWidth = (PAGE_CONTENT_WIDTH - 142) / Math.max(payload.trendMonths.length, 1);
  table(doc, {
    y: 294,
    columns: [{ label: 'Cluster', w: 142 }, ...payload.trendMonths.map((m) => ({ label: m, w: monthWidth, align: 'right' }))],
    rows: payload.clusterTrendTable.map((row) => {
      const cluster = cleanCluster(row.cluster, payload.customer);
      return [{ text: cluster, bg: clusterColor(cluster) }, ...row.values];
    }),
    rowHeight: 18.8,
    fontSize: payload.trendMonths.length > 8 ? 5 : 5.8,
  });
}

function drawComparisons(doc, payload) {
  subheading(doc, '5.3 Monitoring Scope Changes', 59.5);
  paragraph(doc, 'A blank month in the supplied historical table means the path was not represented in the monitored scope for that month. The table records when each monitored path first appears in the selected trend period.', 78, 6.8);
  table(doc, {
    y: 110,
    columns: [{ label: 'Path', w: 265 }, { label: 'First Month Represented', w: 120 }, { label: 'Treatment', w: 97 }],
    rows: payload.scopeChanges.slice(0, 4).map((row) => [row.path, row.firstMonth, row.treatment]),
    rowHeight: 18.8,
    fontSize: 5.6,
  });

  subheading(doc, '5.4 Current Month vs Previous Month', 226.7);
  table(doc, {
    y: 248,
    columns: [{ label: 'Metric', w: 158 }, { label: payload.prevMonthLabel || 'Previous', w: 81, align: 'right' }, { label: payload.curMonthLabel || 'Current', w: 81, align: 'right' }, { label: 'Change', w: 81, align: 'right' }, { label: 'Change %', w: 81, align: 'right' }],
    rows: payload.monthComparison.map((row) => [row.metric, row.prev, row.current, changeCell(row.change), changeCell(row.changePct)]),
    rowHeight: 18.8,
    fontSize: 5.8,
  });

  subheading(doc, '5.5 Cluster Month-on-Month Comparison', 300.3);
  table(doc, {
    y: 322,
    columns: [{ label: 'Cluster', w: 158 }, { label: `Prev (${payload.prevMonthLabel})`, w: 81, align: 'right' }, { label: `Current (${payload.curMonthLabel})`, w: 81, align: 'right' }, { label: 'Change (TB)', w: 81, align: 'right' }, { label: 'Change %', w: 81, align: 'right' }],
    rows: payload.clusterMomTable.map((row) => {
      const cluster = cleanCluster(row.cluster, payload.customer);
      return [{ text: cluster, bg: clusterColor(cluster) }, row.prevTb, row.curTb, changeCell(row.change), changeCell(row.changePct)];
    }),
    rowHeight: 18.8,
    fontSize: 5.8,
  });
}

function drawMatrixPages(doc, payload) {
  const rowsPerPage = 34;
  const chunks = [];
  for (let i = 0; i < payload.momMatrix.rows.length; i += rowsPerPage) chunks.push(payload.momMatrix.rows.slice(i, i + rowsPerPage));
  if (!chunks.length) chunks.push([]);
  chunks.forEach((chunk, index) => {
    addPortraitPage(doc);
    const title = index ? '5.6 Detailed Month-on-Month Differences by Monitored Path (TB) (continued)' : '5.6 Detailed Month-on-Month Differences by Monitored Path (TB)';
    subheading(doc, title, 59.5);
    paragraph(doc, 'Green indicates increased usage, red indicates decreased usage, white/grey indicates no change, and N/A indicates the path was not represented in both adjacent months.', 78, 6.5);
    const pathW = 142;
    const pairW = (PAGE_CONTENT_WIDTH - pathW) / Math.max(payload.momMatrix.columns.length, 1);
    table(doc, {
      y: 107.5,
      columns: [{ label: 'Cluster / Path', w: pathW }, ...payload.momMatrix.columns.map((label) => ({ label, w: pairW, align: 'center' }))],
      rows: chunk.map((row) => [
        row.label,
        ...row.cells.map((cell) => {
          if (cell === null) return { text: 'N/A', bg: NEUTRAL_BG, color: MUTED, align: 'center' };
          const text = cell > 0 ? `+${cell.toFixed(1)}` : cell.toFixed(1).replace('-0.0', '0');
          return { text, bg: cell > 0 ? POSITIVE_BG : cell < 0 ? NEGATIVE_BG : NEUTRAL_BG, color: TEXT, align: 'center' };
        }),
      ]),
      rowHeight: 18.8,
      fontSize: Math.max(4.3, 5.5 - Math.max(0, payload.momMatrix.columns.length - 7) * 0.18),
    });
  });
}

function drawBilling(doc, payload) {
  heading(doc, '6. Billing Summary');
  paragraph(doc, `Billing is based on the ${monthName(payload.month)} ESAS billing output. Historical TB trend values are presented for management analysis and are not substituted for the billing calculation.`, 85, 7);
  const amount = `RM ${Number(payload.totalRevenue).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  table(doc, {
    y: 117.4,
    columns: [{ label: 'Description', w: 205 }, { label: 'Usage', w: 88, align: 'right' }, { label: 'Unit Rate', w: 91, align: 'right' }, { label: 'Amount', w: 98, align: 'right' }],
    rows: [
      ['ESAS Cloud Storage', `${Number(payload.totalUsageGb).toLocaleString()} GB`, `RM ${payload.pricePerGb} / GB`, amount],
      [{ text: 'TOTAL', bg: TOTAL_BG, bold: true }, { text: '', bg: TOTAL_BG }, { text: '', bg: TOTAL_BG }, { text: amount, bg: TOTAL_BG, bold: true, align: 'right' }],
    ],
    rowHeight: 18.8,
    fontSize: 6.2,
  });
  subheading(doc, '6.1 Report Traceability', 196.1);
  table(doc, {
    y: 217.8,
    columns: [{ label: 'Report Traceability', w: 180 }, { label: 'Value', w: 302 }],
    rows: [
      ['Report ID', payload.reportId],
      ['Data Cut-off', payload.dataCutoff],
      ['Historical Trend Period', payload.trendPeriod],
      ['Generated By', payload.generatedBy],
      ['Generated Date/Time', payload.generatedAtMYT],
    ],
    rowHeight: 18.8,
    fontSize: 6.2,
  });
}

export function writeFooters(doc, payload) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const pageNo = index - range.start + 1;
    const width = doc.page.width;
    doc.moveTo(51, 805).lineTo(width - 51, 805).strokeColor(RULE).lineWidth(0.6).stroke();
    doc.fillColor(MUTED).font('Helvetica').fontSize(6.3)
      .text(footerLeft(payload), 51, 814, { width: 380, height: 8, lineBreak: false });
    doc.text(footerRight(pageNo), width - 111, 814, { width: 60, height: 8, align: 'right', lineBreak: false });
  }
}

export function renderPdf(doc, payload, charts) {
  drawCover(doc, payload);
  addPortraitPage(doc);
  drawExecutive(doc, payload);
  addPortraitPage(doc);
  drawIsilon(doc, payload);
  addPortraitPage(doc);
  drawWorkfolders(doc, payload, charts);
  addPortraitPage(doc);
  drawCluster(doc, payload, charts);
  addPortraitPage(doc);
  drawMonthlyTrend(doc, payload, charts);
  addPortraitPage(doc);
  drawClusterTrend(doc, payload, charts);
  addPortraitPage(doc);
  drawComparisons(doc, payload);
  if (payload.momMatrix?.rows?.length) drawMatrixPages(doc, payload);
  addPortraitPage(doc);
  drawBilling(doc, payload);
  writeFooters(doc, payload);
}

export const templateHelpers = { monthShort, monthName };
