// Pure logic helpers for the Professional Template v9 PDF export.
// Everything here is testable without a PDF renderer or database.
//
// Data reality rules (see docs/template-v9 structure):
// - All usage figures derive from Report rows (usageSize BigInt bytes).
// - Historical monthly totals are computed per month via groupBy month/year.
// - Money uses exact billable bytes / 1073741824 * pricePerGb, rounded to 2dp.
// - Template example values are FORMAT references only — never hardcoded.

import {
  billableUsageBytes,
  billableUsageGb,
  exactBillableUsageGb,
  sumBillableUsageBytes,
} from './usageThreshold.js';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthName(month) {
  return MONTH_NAMES[Number(month) - 1] || String(month);
}

export function monthShort(month) {
  return (MONTH_NAMES[Number(month) - 1] || String(month)).slice(0, 3).toUpperCase();
}

// Deterministic 3-letter customer code for the report ID (ESAS-MPB-2025-05).
// Rule: derive from the customer name, preferring an existing convention:
//   1. If custId is a short uppercase-ish code (<=5 chars) use it upper-cased (e.g. 'MP', 'JPJ').
//   2. Well-known brand aliases win (Media Prima -> MPB) because the report spec
//      keys on the customer's known corporate code.
//   3. Otherwise use the first letters of the first three alphabetic words
//      (skip non-alphanumeric filler like 'of', 'the'); for single/double words take
//      the leading consonants/fallback of that word. Deterministic for the same name.
const BRAND_CODES = {
  'media prima': 'MPB',
};

export function deriveCustomerCode(custName, custId = '') {
  const name = String(custName || '').trim();
  // Known alias first for the corporate report code, then short custId fallback.
  const brand = BRAND_CODES[name.toLowerCase()];
  if (brand) return brand;
  const id = String(custId || '').trim();
  if (id && /^[a-zA-Z0-9]{1,5}$/.test(id)) return id.toUpperCase();
  const words = name.split(/\s+/).filter((w) => /^[A-Za-z]{2,}$/.test(w));
  if (words.length >= 3) {
    return words.slice(0, 3).map((w) => w[0].toUpperCase()).join('');
  }
  // Single-word name: use first 3 alpha chars (IPPTAR -> IPP).
  const compact = name.replace(/[^A-Za-z]/g, '').toUpperCase();
  return (compact + 'XXX').slice(0, 3);
}

export function buildReportId(custCode, year, month) {
  return `ESAS-${String(custCode).toUpperCase()}-${String(year)}-${String(month).padStart(2, '0')}`;
}

export function periodLabel(month, year) {
  return `${monthName(month)} ${year}`;
}

export function lastDayOfMonth(month, year) {
  return new Date(Number(year), Number(month), 0).getDate();
}

function fmtTb(bytes) {
  return (Number(bytes) / 1024 / 1073741824).toFixed(2);
}

function fmtPb(bytes) {
  return (Number(bytes) / 1024 / 1024 / 1073741824).toFixed(4);
}

// ─── Monthly history ─────────────────────────────────────────────────────────
// monthsOfReport: [{ month, usageSize, folderId, folder/department info, pricePerGb }]
// Only months January..selected month of the selected year are considered.

export function buildMonthlyHistory(year, month, yearRows) {
  const perMonth = new Map(); // 'MM' -> bytes
  const recorded = new Set(); // months that have ANY report row (blank otherwise)
  for (const row of yearRows) {
    if (Number(row.year) !== Number(year)) continue;
    if (Number(row.month) > Number(month)) continue;
    const key = String(row.month).padStart(2, '0');
    recorded.add(key);
    perMonth.set(key, (perMonth.get(key) || 0n) + billableUsageBytes(row.usageSize));
  }
  const series = [];
  let prevBytes = null;
  for (let m = 1; m <= Number(month); m += 1) {
    const key = String(m).padStart(2, '0');
    const bytes = perMonth.get(key) || 0n;
    // MoM change % from billable bytes per month; '-' for January and 'N/A'
    // for blank months (no recorded rows) — blank historical cells are not
    // treated as zero usage (template v9 executive summary wording).
    let momPct = '-';
    if (m > 1 && recorded.has(key)) {
      if (prevBytes === null || prevBytes === 0n) momPct = 'N/A';
      else momPct = `${((Number(bytes) - Number(prevBytes)) / Number(prevBytes) * 100).toFixed(2)}%`;
    } else if (m > 1) {
      momPct = 'N/A';
    }
    series.push({
      month: key,
      label: periodLabel(key, year),
      bytes: String(bytes),
      usageTb: fmtTb(bytes),
      usagePb: fmtPb(bytes),
      momPct,
    });
    // Keep the last non-blank month as the comparison base for later months.
    if (bytes > 0n) prevBytes = bytes;
  }
  return series;
}

// ─── Section 1.1 validation rows ────────────────────────────────────────────
// folderConfigCount: count of distinct monitored paths in folder config (Folder rows
// for the customer not deleted); rowCount: matched report rows for the month;
// pendingUnmatched: unmatched directories pending for the month.

export function buildValidationRows({ monthLabel, expectedPaths, receivedPaths = rowCount, rowCount, pendingUnmatched, monthsOfHistory }) {
  const expectedPass = expectedPaths > 0;
  const receivedPass = expectedPass && receivedPaths === expectedPaths;
  const unmatchedPass = Number(pendingUnmatched) === 0;
  const historyPass = monthsOfHistory > 0;
  const allPass = expectedPass && receivedPass && unmatchedPass && historyPass;
  return [
    { item: `Expected ${monthLabel} report paths`, result: String(expectedPaths), status: expectedPass ? 'PASS' : 'FAIL' },
    { item: `${monthLabel} distinct configured paths received`, result: String(receivedPaths), status: receivedPass ? 'PASS' : 'FAIL' },
    { item: `Missing / unmatched ${monthLabel} paths`, result: String(pendingUnmatched), status: unmatchedPass ? 'PASS' : 'FAIL' },
    { item: 'Historical period available', result: `Jan-${monthShort(monthLabel)} ${/(\d{4})\s*$/.test(monthLabel) ? RegExp.$1 : ''}`.trim() || `${monthLabel}`, status: historyPass ? 'PASS' : 'FAIL' },
    { item: 'Overall validation', result: allPass ? 'Complete' : 'Incomplete', status: allPass ? 'PASS' : 'FAIL' },
  ];
}

// ─── Historical first months / monitoring scope changes (5.3) ───────────────
// Deterministic rule: a path is "first represented" in the first month of the
// selected year where its recorded billable usage is > 0. Treatment is
// 'New monitored path' normally, or 'First represented; 0 TB in <later months>'
// when some later month shows a recorded 0 after first appearance.

export function buildScopeChanges(yearRows, { month, year }) {
  const perPath = new Map(); // folderId -> { label, byMonth: Map('MM' -> bytes) }
  for (const row of yearRows) {
    if (Number(row.year) !== Number(year)) continue;
    const mKey = String(row.month).padStart(2, '0');
    if (Number(row.month) > Number(month)) continue;
    if (!perPath.has(row.folderId)) {
      perPath.set(row.folderId, {
        folderId: row.folderId,
        cluster: row.clusterName || '',
        path: row.pathLabel || row.folder?.folderName || row.folderId,
      });
    }
    const entry = perPath.get(row.folderId);
    if (!entry.byMonth) entry.byMonth = new Map();
    entry.byMonth.set(mKey, (entry.byMonth.get(mKey) || 0n) + billableUsageBytes(row.usageSize));
  }
  const maxMonth = Number(month);
  const rows = [];
  for (const entry of perPath.values()) {
    let firstMonth = null;
    let hasLaterZero = false;
    for (let m = 1; m <= maxMonth; m += 1) {
      const key = String(m).padStart(2, '0');
      const bytes = entry.byMonth?.get(key) || 0n;
      if (firstMonth === null && bytes > 0n) firstMonth = key;
      else if (firstMonth !== null && bytes === 0n) hasLaterZero = true;
    }
    if (firstMonth === null) continue;
    rows.push({
      path: `${entry.cluster ? `${entry.cluster} / ` : ''}${entry.path}`,
      firstMonth: `${monthShort(firstMonth)} ${year}`,
      treatment: hasLaterZero
        ? `First represented; 0 TB in later ${year} months`
        : 'New monitored path',
    });
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

// ─── Row-keyed history used by 5.2 / 5.5 / 5.6 ──────────────────────────────

export function buildRowHistory(yearRows, { month, year }, labelFn) {
  const perPath = new Map();
  for (const row of yearRows) {
    if (Number(row.year) !== Number(year)) continue;
    const mKey = String(row.month).padStart(2, '0');
    if (Number(row.month) > Number(month)) continue;
    if (!perPath.has(row.folderId)) {
      perPath.set(row.folderId, { folderId: row.folderId, label: labelFn(row), byMonth: new Map() });
    }
    const entry = perPath.get(row.folderId);
    entry.byMonth.set(mKey, (entry.byMonth.get(mKey) || 0n) + billableUsageBytes(row.usageSize));
  }
  return [...perPath.values()];
}

// 5.4 Current vs previous month.
export function buildMonthComparison(month, year, curBytes, prevBytes) {
  const curTb = Number(fmtTb(curBytes));
  const prevTb = Number(fmtTb(prevBytes));
  const change = curTb - prevTb;
  const changePct = prevTb ? `${((curTb - prevTb) / prevTb * 100).toFixed(2)}%` : 'N/A';
  return {
    prevTb: fmtTb(prevBytes),
    curTb: fmtTb(curBytes),
    change: change.toFixed(2),
    changePct,
  };
}

// 5.5 per-cluster prev vs current.
export function buildClusterMonthComparison(yearRows, { month, year }) {
  const clusters = new Map();
  for (const row of yearRows) {
    if (Number(row.year) !== Number(year)) continue;
    const mKey = String(row.month).padStart(2, '0');
    if (!clusters.has(row.clusterName || row.cluster)) {
      clusters.set(row.clusterName || row.cluster, new Map());
    }
    const byMonth = clusters.get(row.clusterName || row.cluster);
    byMonth.set(mKey, (byMonth.get(mKey) || 0n) + billableUsageBytes(row.usageSize));
  }
  const curKey = String(month).padStart(2, '0');
  const prevM = Number(month) - 1;
  const prevKey = String(prevM).padStart(2, '0');
  const rows = [];
  for (const [cluster, byMonth] of clusters) {
    const cur = byMonth.get(curKey) || 0n;
    const prev = byMonth.get(prevKey) || 0n;
    const curTb = Number(fmtTb(cur));
    const prevTb = Number(fmtTb(prev));
    const change = curTb - prevTb;
    rows.push({
      cluster,
      prevTb: fmtTb(prev),
      curTb: fmtTb(cur),
      change: change.toFixed(2),
      changePct: prevTb ? `${((curTb - prevTb) / prevTb * 100).toFixed(2)}%` : 'N/A',
    });
  }
  return rows.sort((a, b) => b.curTb - a.curTb);
}

// 5.6 MoM difference matrix: rows = monitored paths, columns = month pairs
// JAN-FEB, FEB-MAR, ..., prev-current. Cell values in TB, as numbers (floats)
// with sign: blank cell when path absent from either adjacent month (rendered N/A).
export function buildMomDifferenceMatrix(yearRows, { month, year }) {
  const monthPairs = [];
  for (let m = 1; m < Number(month); m += 1) {
    monthPairs.push([String(m).padStart(2, '0'), String(m + 1).padStart(2, '0')]);
  }
  if (!monthPairs.length) return { columns: [], rows: [] };

  const paths = buildRowHistory(yearRows, { month, year }, (row) => row.pathLabel || row.folder?.folderName || row.folderId);
  const rows = paths.map((path) => {
    const cells = monthPairs.map(([a, b]) => {
      const presentBoth = path.byMonth.has(a) && path.byMonth.has(b);
      if (!presentBoth) return null; // 'N/A'
      const diffTb = (Number(path.byMonth.get(b) || 0n) - Number(path.byMonth.get(a) || 0n)) / 1024 / 1073741824;
      return Math.round(diffTb * 100) / 100;
    });
    return { label: path.label, cells };
  });
  rows.sort((a, b) => a.label.localeCompare(b.label));
  return { columns: monthPairs.map(([a, b]) => `${monthShort(a)}-${monthShort(b)}`), rows };
}

// Revenue: exact billable bytes / 1073741824 * pricePerGb, rounded once to 2dp.
export function computeRevenue(reports) {
  const raw = reports.reduce(
    (sum, report) => sum + exactBillableUsageGb(report.usageSize) * Number(report.pricePerGb ?? 0),
    0,
  );
  return Math.round(raw * 100) / 100;
}

export function totalBillableBytes(reports) {
  return sumBillableUsageBytes(reports, (report) => report.usageSize);
}

export function usageGbFromBytes(bytes) {
  return billableUsageGb(bytes);
}
