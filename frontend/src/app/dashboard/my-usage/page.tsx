'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarDays, Database, Files, FolderTree } from 'lucide-react';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type UnknownRecord = Record<string, unknown>;
type MonthRow = { key: string; month: number; label: string; usageGb: number; fileCount: number; reportRows: number };
type YearlySummary = {
  customerName: string;
  year: number;
  availableYears: number[];
  totalUsageGb: number;
  totalFileCount: number;
  reportRows: number;
  months: MonthRow[];
};

const numberValue = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const record = (value: unknown): UnknownRecord => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {}
);

const firstValue = (source: UnknownRecord, keys: string[]): unknown => {
  for (const key of keys) if (source[key] !== undefined && source[key] !== null) return source[key];
  return undefined;
};

const usageGb = (source: UnknownRecord): number => {
  const direct = firstValue(source, ['totalUsageGb', 'total_usage_gb', 'usageGb', 'usage_gb']);
  if (direct !== undefined) return numberValue(direct);
  const bytes = firstValue(source, ['totalUsageBytes', 'total_usage_bytes', 'usageBytes', 'usage_bytes', 'totalUsage', 'total_usage']);
  return numberValue(bytes) / 1073741824;
};

const formatNumber = (value: number) => Math.round(value || 0).toLocaleString();
const formatUsage = (value: number) => value >= 1024 ? `${(value / 1024).toFixed(2)} TB` : `${formatNumber(value)} GB`;

function normaliseSummary(payload: unknown, requestedYear: number): YearlySummary {
  const root = record(payload);
  const customer = record(root.customer);
  const summary = record(root.summary);
  const sourceMonths = firstValue(root, ['months', 'monthlyUsage', 'monthly_usage', 'usageByMonth', 'usage_by_month']);
  const byMonth = new Map<number, MonthRow>();

  if (Array.isArray(sourceMonths)) {
    sourceMonths.forEach((item, index) => {
      const row = record(item);
      const rawMonth = firstValue(row, ['month', 'monthNumber', 'month_number', 'period']);
      const parsedMonth = numberValue(rawMonth);
      const month = parsedMonth >= 1 && parsedMonth <= 12 ? parsedMonth : index + 1;
      byMonth.set(month, {
        key: String(firstValue(row, ['key', 'id']) ?? `${requestedYear}-${month}`),
        month,
        label: String(firstValue(row, ['label', 'monthLabel', 'month_label']) ?? MONTH_NAMES[month - 1]),
        usageGb: usageGb(row),
        fileCount: numberValue(firstValue(row, ['totalFileCount', 'total_file_count', 'fileCount', 'file_count'])),
        reportRows: numberValue(firstValue(row, ['reportRows', 'report_rows', 'rowCount', 'row_count'])),
      });
    });
  }

  const months = MONTH_NAMES.map((label, index) => byMonth.get(index + 1) ?? {
    key: `${requestedYear}-${index + 1}`,
    month: index + 1,
    label,
    usageGb: 0,
    fileCount: 0,
    reportRows: 0,
  });
  const rawYears = firstValue(root, ['availableYears', 'available_years', 'years']);
  const availableYears = Array.isArray(rawYears)
    ? rawYears.map((item) => numberValue(typeof item === 'object' ? firstValue(record(item), ['year', 'value']) : item)).filter((year) => year > 0)
    : [];
  const resolvedYear = numberValue(firstValue(root, ['year']) ?? requestedYear) || requestedYear;

  return {
    customerName: String(firstValue(customer, ['name', 'custName', 'cust_name']) ?? firstValue(root, ['customerName', 'customer_name']) ?? ''),
    year: resolvedYear,
    availableYears: [...new Set(availableYears)].sort((a, b) => b - a),
    totalUsageGb: usageGb({ ...root, ...summary }) || months.reduce((total, month) => total + month.usageGb, 0),
    totalFileCount: numberValue(firstValue({ ...root, ...summary }, ['totalFileCount', 'total_file_count', 'fileCount', 'file_count'])) || months.reduce((total, month) => total + month.fileCount, 0),
    reportRows: numberValue(firstValue({ ...root, ...summary }, ['reportRows', 'report_rows', 'rowCount', 'row_count'])) || months.reduce((total, month) => total + month.reportRows, 0),
    months,
  };
}

function KpiCard({ label, value, helper, icon: Icon, tone }: { label: string; value: string; helper: string; icon: typeof Database; tone: string }) {
  return <article className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm shadow-black/5">
    <div className="flex items-start justify-between gap-4">
      <div><p className="text-sm text-[var(--color-muted)]">{label}</p><p className="mt-2 font-mono text-2xl font-bold text-[var(--color-text)]">{value}</p><p className="mt-2 text-xs text-[var(--color-subtle)]">{helper}</p></div>
      <span className={`rounded-xl p-3 ${tone}`}><Icon className="h-5 w-5" /></span>
    </div>
  </article>;
}

export default function MyUsagePage() {
  const { user } = useAuth();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [summary, setSummary] = useState<YearlySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api.get('/analytics/customer-yearly-summary', { params: { year: selectedYear }, signal: controller.signal })
      .then((response) => setSummary(normaliseSummary(response.data, selectedYear)))
      .catch((err) => { if (err?.code !== 'ERR_CANCELED') setError(err?.response?.data?.error || 'Unable to load annual usage data.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selectedYear]);

  const years = useMemo(() => {
    const apiYears = summary?.availableYears ?? [];
    return [...new Set([selectedYear, ...apiYears])].sort((a, b) => b - a);
  }, [selectedYear, summary]);

  return <div className="space-y-6">
    <section className="rounded-2xl border border-amber-500/20 bg-[linear-gradient(135deg,var(--color-surface)_0%,var(--color-bg)_100%)] p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl"><p className="text-sm text-[var(--color-subtle)]">{summary?.customerName || user?.customerName || 'Customer Portal'}</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-[var(--color-text)]">My Usage</h1><p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">Your complete storage and file activity for the selected calendar year.</p></div>
        <label className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-sm sm:w-48"><span className="font-medium text-[var(--color-muted)]">Year</span><select aria-label="Select usage year" value={selectedYear} onChange={(event) => { setLoading(true); setError(''); setSelectedYear(Number(event.target.value)); }} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-semibold text-[var(--color-text)] outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20">{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
      </div>
    </section>

    {loading && <div className="flex min-h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" /></div>}
    {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-[var(--color-red-text)]">{error}</div>}
    {!loading && !error && summary && <>
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Annual Usage" value={formatUsage(summary.totalUsageGb)} helper={`${summary.year} storage reported`} icon={Database} tone="bg-teal-500/10 text-[var(--color-teal-text)]" />
        <KpiCard label="Files Reported" value={formatNumber(summary.totalFileCount)} helper="Across all months" icon={Files} tone="bg-amber-500/10 text-[var(--color-amber-text)]" />
        <KpiCard label="Report Rows" value={formatNumber(summary.reportRows)} helper="Usage records received" icon={FolderTree} tone="bg-blue-500/10 text-[var(--color-blue-text)]" />
        <KpiCard label="Months Covered" value={`${summary.months.filter((month) => month.reportRows > 0 || month.usageGb > 0 || month.fileCount > 0).length}/12`} helper={`Calendar year ${summary.year}`} icon={CalendarDays} tone="bg-emerald-500/10 text-[var(--color-green-text)]" />
      </section>
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <UsageChart title="Storage Usage by Month" data={summary.months} dataKey="usageGb" color="#0d9488" valueLabel="GB" />
        <UsageChart title="File Count by Month" data={summary.months} dataKey="fileCount" color="#d97706" valueLabel="files" />
      </section>
      <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"><div className="border-b border-[var(--color-border)] p-5"><h2 className="font-semibold text-[var(--color-text)]">Monthly activity</h2><p className="mt-1 text-xs text-[var(--color-subtle)]">All twelve months are shown; months without reported activity remain at zero.</p></div><div className="overflow-x-auto"><table className="min-w-[680px] w-full text-sm"><thead className="bg-[var(--color-hover)] text-left text-[var(--color-muted)]"><tr><th className="px-4 py-3 font-medium">Month</th><th className="px-4 py-3 text-right font-medium">Usage</th><th className="px-4 py-3 text-right font-medium">File count</th><th className="px-4 py-3 text-right font-medium">Report rows</th></tr></thead><tbody className="divide-y divide-[var(--color-border)]">{summary.months.map((month) => <tr key={month.key}><td className="px-4 py-3 font-medium text-[var(--color-text)]">{month.label}</td><td className="px-4 py-3 text-right font-mono text-[var(--color-text-soft)]">{formatUsage(month.usageGb)}</td><td className="px-4 py-3 text-right font-mono text-[var(--color-text-soft)]">{formatNumber(month.fileCount)}</td><td className="px-4 py-3 text-right font-mono text-[var(--color-text-soft)]">{formatNumber(month.reportRows)}</td></tr>)}</tbody></table></div></section>
    </>}
  </div>;
}

function UsageChart({ title, data, dataKey, color, valueLabel }: { title: string; data: MonthRow[]; dataKey: 'usageGb' | 'fileCount'; color: string; valueLabel: string }) {
  return <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"><h2 className="text-base font-semibold text-[var(--color-text)]">{title}</h2><p className="mt-1 text-xs text-[var(--color-subtle)]">January through December</p><div className="mt-5 h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}><CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" opacity={0.5} /><XAxis dataKey="label" stroke="var(--color-muted)" fontSize={12} interval={0} /><YAxis stroke="var(--color-muted)" fontSize={12} /><Tooltip formatter={(value) => [`${formatNumber(numberValue(value))} ${valueLabel}`, title]} contentStyle={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '12px', color: 'var(--color-text)' }} /><Bar dataKey={dataKey} fill={color} radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></section>;
}
