import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExcelSheets, buildTemplateCurrentReports, exportRouter } from '../src/routes/exports.js';

test('Excel export route is restored as an authenticated GET endpoint', () => {
  const layer = exportRouter.stack.find((item) => item.route?.path === '/excel' && item.route.methods?.get);
  assert.ok(layer);
});

test('Excel workbook JSON preserves the current four-sheet contract without legacy breakdown data', () => {
  const sheets = buildExcelSheets({
    customer: 'Customer', period: 'July 2026', status: 'DRAFT', rowCount: 1,
    totalUsageGb: 2, pricePerGb: 3, totalRevenue: 6, pendingUnmatched: 0,
    isilon: [{ no: 1, cluster: 'C A', workflowFolder: 'A - F', directory: '/f', dirCount: 1, fileCount: 2, adsCount: 0, otherCount: 0, physicalSize: '2147483648', sizeGb: 2 }],
    workfolderSummary: [{ folderName: 'A - F', sizeGb: 2 }],
    departmentalSummary: [{ deptName: 'A', sizeGb: 2, sharePct: 100 }],
  });
  assert.deepEqual(Object.keys(sheets), ['summary', 'report', 'workfolder', 'department']);
  assert.equal(sheets.report.name, 'Isilon Report');
  assert.equal(sheets.department.name, 'Cluster Summary');
  assert.doesNotMatch(JSON.stringify(sheets), /breakdown/i);
});

test('PDF current rows preserve exact report IDs and applied prices for duplicate path labels', () => {
  const rows = buildTemplateCurrentReports([
    { id: 'r1', department: 'A', workflowFolder: 'A - Same', physicalSize: '2147483648', pricePerGb: 2 },
    { id: 'r2', department: 'A', workflowFolder: 'A - Same', physicalSize: '3221225472', pricePerGb: 5 },
  ], '07');
  assert.deepEqual(rows.map((row) => ({ reportId: row.reportId, pricePerGb: row.pricePerGb })), [
    { reportId: 'r1', pricePerGb: 2 },
    { reportId: 'r2', pricePerGb: 5 },
  ]);
  assert.equal(rows[0].pathLabel, rows[1].pathLabel);
});
