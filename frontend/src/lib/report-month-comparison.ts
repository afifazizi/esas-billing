// Pure month-to-month comparison logic for the admin Isilon Reports page
// (/dashboard/reports). Kept free of React so the normalization and
// formatting rules are testable with `node --test`
// (see report-month-comparison.test.ts).
//
// API covenant — GET /api/analytics/customer-yearly-summary?cust_id=<id>&year=<YYYY>:
//   { customer:{custId,name}, selectedYear, availableYears:[...],
//     totals:{usageBytes,usageGb,fileCount,reportRows,totalRevenue},
//     months:[12 rows], clusters, workflowFolders }
// Each months row:
//   { year, month, usageBytes:string, usageGb:number, fileCount, reportRows,
//     revenue:number, deltaUsageBytes:string|null, deltaUsageGb:number|null,
//     deltaUsagePct:number|null, deltaFileCount:number|null,
//     deltaReportRows:number|null, previousPeriod:{year,month}|null }
//
// January has null deltas. Empty months keep zeros with honest negative
// deltas after data. Revenue/delta fields may be absent while the backend
// catches up — normalize defensively and never render raw unknown fields.

export type DeltaTone = 'up' | 'down' | 'flat' | 'none';

export interface PreviousPeriod {
  year: number;
  month: number;
}

export interface MonthComparisonRow {
  key: string;
  year: number;
  /** 1..12, January first. */
  month: number;
  /** 'January' */
  label: string;
  /** 'Jan' */
  shortLabel: string;
  usageBytes: string;
  usageGb: number;
  fileCount: number;
  reportRows: number;
  revenue: number;
  deltaUsageBytes: string | null;
  deltaUsageGb: number | null;
  deltaUsagePct: number | null;
  deltaFileCount: number | null;
  deltaReportRows: number | null;
  previousPeriod: PreviousPeriod | null;
}

export interface YearlyComparisonTotals {
  usageBytes: string;
  usageGb: number;
  fileCount: number;
  reportRows: number;
  totalRevenue: number;
}

export interface YearlyComparisonSummary {
  customerId: string;
  customerName: string;
  year: number;
  /** Distinct years with data, newest first. */
  availableYears: number[];
  totals: YearlyComparisonTotals;
  /** Exactly 12 rows, January..December, zero-filled where absent. */
  months: MonthComparisonRow[];
}

export interface CustomerOption {
  id: string;
  name: string;
}

type UnknownRecord = Record<string, unknown>;

const MONTH_SHORT_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const BYTES_IN_GB = 1073741824;
const NUMBER_LOCALE = 'en-MY';

const record = (value: unknown): UnknownRecord => (
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {}
);

const numberValue = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const nullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const numberOr = (value: unknown, fallback: number): number => {
  const parsed = nullableNumber(value);
  return parsed === null ? fallback : parsed;
};

export const monthLongLabel = (month: number): string => (
  Number.isInteger(month) && month >= 1 && month <= 12 ? MONTH_LONG_LABELS[month - 1] : '—'
);

export const monthShortLabel = (month: number): string => (
  Number.isInteger(month) && month >= 1 && month <= 12 ? MONTH_SHORT_LABELS[month - 1] : '—'
);

const monthKey = (year: number, month: number): string => `${year}-${String(month).padStart(2, '0')}`;

const normalizePreviousPeriod = (value: unknown): PreviousPeriod | null => {
  const row = record(value);
  const year = nullableNumber(row.year);
  const month = nullableNumber(row.month);
  if (year === null || month === null || month < 1 || month > 12) return null;
  return { year, month };
};

const normalizeMonthRow = (value: unknown, index: number): MonthComparisonRow | null => {
  const row = record(value);
  const rawMonth = numberValue(row.month);
  const month = rawMonth >= 1 && rawMonth <= 12 ? Math.round(rawMonth) : index + 1;
  if (month < 1 || month > 12) return null;

  const usageBytes = row.usageBytes === null || row.usageBytes === undefined ? '0' : String(row.usageBytes);
  const bytesFallback = nullableNumber(usageBytes) ?? 0;
  const year = numberOr(row.year, 0);

  return {
    key: monthKey(year, month),
    year,
    month,
    label: monthLongLabel(month),
    shortLabel: monthShortLabel(month),
    usageBytes,
    usageGb: numberOr(row.usageGb, bytesFallback / BYTES_IN_GB),
    fileCount: numberOr(row.fileCount, 0),
    reportRows: numberOr(row.reportRows, 0),
    revenue: numberOr(row.revenue, 0),
    deltaUsageBytes: row.deltaUsageBytes === null || row.deltaUsageBytes === undefined ? null : String(row.deltaUsageBytes),
    deltaUsageGb: nullableNumber(row.deltaUsageGb),
    deltaUsagePct: nullableNumber(row.deltaUsagePct),
    deltaFileCount: nullableNumber(row.deltaFileCount),
    deltaReportRows: nullableNumber(row.deltaReportRows),
    previousPeriod: normalizePreviousPeriod(row.previousPeriod),
  };
};

const emptyMonthRow = (year: number, month: number): MonthComparisonRow => ({
  key: monthKey(year, month),
  year,
  month,
  label: monthLongLabel(month),
  shortLabel: monthShortLabel(month),
  usageBytes: '0',
  usageGb: 0,
  fileCount: 0,
  reportRows: 0,
  revenue: 0,
  deltaUsageBytes: null,
  deltaUsageGb: null,
  deltaUsagePct: null,
  deltaFileCount: null,
  deltaReportRows: null,
  previousPeriod: null,
});

/**
 * Maps a raw yearly-summary API payload onto the typed comparison interface.
 * Always returns exactly 12 month rows (Jan..Dec), zero-filling absent months.
 * Never throws on malformed input — unknown shapes collapse to honest zeros.
 */
export function normalizeYearlyComparison(payload: unknown, requestedYear: number): YearlyComparisonSummary {
  const root = record(payload);
  const customer = record(root.customer);
  const totalsRaw = record(root.totals);
  const year = numberOr(root.selectedYear, requestedYear);

  const byMonth = new Map<number, MonthComparisonRow>();
  const sourceMonths = Array.isArray(root.months) ? root.months : [];
  sourceMonths.forEach((item, index) => {
    const row = normalizeMonthRow(item, index);
    if (row) byMonth.set(row.month, row);
  });

  const months = MONTH_LONG_LABELS.map((_, index) => byMonth.get(index + 1) ?? emptyMonthRow(year, index + 1));

  const rawYears = Array.isArray(root.availableYears) ? root.availableYears : [];
  const availableYears = [...new Set(rawYears
    .map((item) => numberValue(record(item).year ?? item))
    .filter((candidate) => candidate > 0 && Number.isInteger(candidate)))].sort((a, b) => b - a);

  return {
    customerId: String(customer.custId ?? ''),
    customerName: String(customer.name ?? customer.custName ?? ''),
    year,
    availableYears,
    totals: {
      usageBytes: totalsRaw.usageBytes === null || totalsRaw.usageBytes === undefined ? '0' : String(totalsRaw.usageBytes),
      usageGb: numberOr(totalsRaw.usageGb, months.reduce((sum, month) => sum + month.usageGb, 0)),
      fileCount: numberOr(totalsRaw.fileCount, months.reduce((sum, month) => sum + month.fileCount, 0)),
      reportRows: numberOr(totalsRaw.reportRows, months.reduce((sum, month) => sum + month.reportRows, 0)),
      totalRevenue: numberOr(totalsRaw.totalRevenue, months.reduce((sum, month) => sum + month.revenue, 0)),
    },
    months,
  };
}

/** Default year for a freshly selected customer: the newest year with data. */
export function pickLatestYear(availableYears: unknown, fallbackYear: number): number {
  const raw = Array.isArray(availableYears) ? availableYears : [];
  const years = raw
    .map((item) => numberValue(item))
    .filter((year) => year > 0 && Number.isInteger(year));
  return years.length > 0 ? Math.max(...years) : fallbackYear;
}

/**
 * Maps GET /api/customers (array of { id, name, ... }) onto typed options.
 * Drops rows without a usable id, never renders raw unknown fields.
 */
export function normalizeCustomerOptions(payload: unknown): CustomerOption[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((item) => {
      const row = record(item);
      return {
        id: String(row.id ?? row.custId ?? ''),
        name: String(row.name ?? row.custName ?? '').trim() || 'Unnamed customer',
      };
    })
    .filter((option) => option.id.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export const formatCount = (value: number): string => Math.round(value || 0).toLocaleString(NUMBER_LOCALE);

export const formatTotalUsage = (gb: number): string => {
  const value = Number.isFinite(gb) ? gb : 0;
  if (value >= 1048576) return `${(value / 1048576).toFixed(2)} PB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} TB`;
  return `${formatCount(value)} GB`;
};

export const formatRevenueRm = (value: number): string => (
  `RM ${(Number.isFinite(value) ? value : 0).toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
);

const signPrefix = (value: number): string => (value > 0 ? '+' : value < 0 ? '-' : '±');

export const formatDeltaGb = (delta: number | null): string => {
  if (delta === null) return '—';
  return `${signPrefix(delta)}${Math.abs(delta).toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`;
};

export const formatDeltaPct = (delta: number | null): string => {
  if (delta === null) return '—';
  return `${signPrefix(delta)}${Math.abs(delta).toFixed(1)}%`;
};

export const formatSignedCount = (delta: number | null): string => {
  if (delta === null) return '—';
  return `${signPrefix(delta)}${Math.round(Math.abs(delta)).toLocaleString(NUMBER_LOCALE)}`;
};

export const deltaTone = (delta: number | null): DeltaTone => {
  if (delta === null) return 'none';
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
};
