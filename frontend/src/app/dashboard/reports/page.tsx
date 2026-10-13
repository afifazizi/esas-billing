'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  deltaTone,
  formatCount,
  formatDeltaGb,
  formatDeltaPct,
  formatRevenueRm,
  formatSignedCount,
  formatTotalUsage,
  normalizeCustomerOptions,
  normalizeYearlyComparison,
  pickLatestYear,
  type CustomerOption,
  type MonthComparisonRow,
  type YearlyComparisonSummary,
} from '@/lib/report-month-comparison';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  ArrowUpRight,
  BarChart3,
  Database,
  DollarSign,
  Files,
  FolderTree,
  TrendingUp,
} from 'lucide-react';

const TONE_CLASS: Record<string, string> = {
  up: 'text-[var(--color-green-text)]',
  down: 'text-[var(--color-red-text)]',
  flat: 'text-[var(--color-muted)]',
  none: 'text-[var(--color-faint)]',
};

const toneClass = (delta: number | null): string => TONE_CLASS[deltaTone(delta)] ?? TONE_CLASS.none;

const formatAxisUsage = (value: number): string => {
  if (value >= 1048576) return `${(value / 1048576).toFixed(1)} PB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} TB`;
  return `${Math.round(value).toLocaleString()} GB`;
};

export default function ReportsPage() {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [summary, setSummary] = useState<YearlyComparisonSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState('');
  const [summaryError, setSummaryError] = useState('');
  // Year auto-default may only act before the user picks a year themselves;
  // afterwards their manual choice stays authoritative even if that year has
  // no data yet (mirrors the report-period-navigation guard pattern).
  const manualYearSelection = useRef(false);

  // Customer list drives the selection state; the yearly summary is fetched
  // only after a customer is chosen (cust_id is required for internal users).
  useEffect(() => {
    const controller = new AbortController();
    api.get('/customers', { signal: controller.signal })
      .then((response) => setCustomers(normalizeCustomerOptions(response.data)))
      .catch((err) => {
        if (err?.code !== 'ERR_CANCELED') setError(err?.response?.data?.error || 'Unable to load customers.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  // When a customer is picked, default the year to the current calendar year;
  // the first payload's availableYears then auto-refines to the latest year
  // with data (see the fetch effect below).
  const selectCustomer = (id: string) => {
    manualYearSelection.current = false;
    setSelectedCustomerId(id);
    setSummary(null);
    setSummaryError('');
    if (!id) {
      setSelectedYear(null);
      setSummaryLoading(false);
      return;
    }
    setSelectedYear(new Date().getFullYear());
    setSummaryLoading(true);
  };

  const selectYear = (year: number) => {
    manualYearSelection.current = true;
    setSummary(null);
    setSummaryError('');
    setSelectedYear(year);
    setSummaryLoading(true);
  };

  useEffect(() => {
    if (!selectedCustomerId || selectedYear === null) return;
    const controller = new AbortController();
    let switchingYear = false;
    api.get('/analytics/customer-yearly-summary', {
      params: { cust_id: selectedCustomerId, year: selectedYear },
      signal: controller.signal,
    })
      .then((response) => {
        const normalized = normalizeYearlyComparison(response.data, selectedYear);
        // Default year = latest in availableYears once the first payload lands,
        // but only until the user has picked a year manually.
        if (
          !manualYearSelection.current
          && normalized.availableYears.length > 0
          && !normalized.availableYears.includes(selectedYear)
        ) {
          // Keep the spinner up through the refetch for the latest data year;
          // that refetch's own completion clears the loading state.
          switchingYear = true;
          setSelectedYear(pickLatestYear(normalized.availableYears, selectedYear));
          return;
        }
        setSummary(normalized);
      })
      .catch((err) => {
        if (err?.code === 'ERR_CANCELED') return;
        setSummary(null);
        setSummaryError(err?.response?.data?.error || 'Unable to load the yearly comparison.');
      })
      .finally(() => {
        if (!controller.signal.aborted && !switchingYear) setSummaryLoading(false);
      });
    return () => controller.abort();
  }, [selectedCustomerId, selectedYear]);

  const yearOptions = useMemo(() => {
    const apiYears = summary?.availableYears ?? [];
    const currentYear = new Date().getFullYear();
    return [...new Set([selectedYear ?? currentYear, currentYear, ...apiYears])]
      .filter((year) => Number.isInteger(year) && year > 0)
      .sort((a, b) => b - a);
  }, [summary, selectedYear]);

  const chartData = useMemo(() => (
    (summary?.months ?? []).map((month) => ({ month: month.shortLabel, usageGb: month.usageGb }))
  ), [summary]);

  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId);

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--color-amber)_22%,transparent),transparent_34%),linear-gradient(135deg,var(--color-surface)_0%,var(--color-bg)_64%,var(--color-surface-raised)_100%)] p-6 shadow-2xl shadow-black/10">
        <div className="absolute right-8 top-6 h-24 w-24 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-medium text-[var(--color-amber-text)]">
              <BarChart3 className="h-3.5 w-3.5" />
              ESAS Storage Command
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-[var(--color-text)] sm:text-4xl">Isilon Reports</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-muted)]">
              Month-to-month Isilon storage, file, and billing comparison across the whole calendar year — every month against the previous period.
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
            <label className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-sm shadow-inner sm:w-80">
              <span className="shrink-0 font-medium text-[var(--color-muted)]">Customer</span>
              <select
                aria-label="Select customer"
                value={selectedCustomerId}
                onChange={(event) => selectCustomer(event.target.value)}
                disabled={loading || customers.length === 0}
                className="min-w-40 max-w-48 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-semibold text-[var(--color-text)] outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {customers.length === 0 && <option value="">No customers</option>}
                {customers.length > 0 && !selectedCustomerId && <option value="">Select customer</option>}
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.name}</option>
                ))}
              </select>
            </label>

            <label className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-sm shadow-inner sm:w-40">
              <span className="font-medium text-[var(--color-muted)]">Year</span>
              <select
                aria-label="Select report year"
                value={selectedYear ?? ''}
                onChange={(event) => selectYear(Number(event.target.value))}
                disabled={!selectedCustomerId}
                className="w-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-semibold text-[var(--color-text)] outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-[var(--color-red-text)]">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex min-h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        </div>
      )}

      {!loading && !error && !selectedCustomerId && (
        <section className="rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-16 text-center">
          <Database className="mx-auto mb-4 h-10 w-10 text-[var(--color-faint)]" />
          <h2 className="text-lg font-semibold text-[var(--color-text)]">Select a customer to begin</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--color-muted)]">
            Choose a customer to view their full-year month-to-month Isilon report comparison — usage, files, report rows, and revenue for all twelve months.
          </p>
          {customers.length === 0 && !error && (
            <p className="mt-4 text-xs text-[var(--color-subtle)]">
              No customers are registered yet. Add one from Customer Management to unlock yearly reporting.
            </p>
          )}
          {customers.length > 0 && (
            <Link
              href="/dashboard/customers"
              className="mt-6 inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm font-medium text-[var(--color-text)] transition hover:border-amber-500/40"
            >
              Manage customers
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          )}
          {customers.length === 0 && (
            <Link
              href="/dashboard/customers"
              className="mt-6 inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm font-medium text-[var(--color-text)] transition hover:border-amber-500/40"
            >
              Open Customer Management
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          )}
        </section>
      )}

      {!loading && !error && selectedCustomerId && (
        <>
          {summaryError && (
            <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-[var(--color-red-text)]">
              {summaryError}
            </div>
          )}

          {summaryLoading && (
            <div className="flex min-h-64 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            </div>
          )}

          {!summaryLoading && !summaryError && summary && (
            <>
              <section aria-label="Year totals" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <TotalCard label="Usage (GB)" value={formatTotalUsage(summary.totals.usageGb)} helper={`All clusters, ${summary.year}`} icon={Database} tone="bg-teal-500/10 text-[var(--color-teal-text)]" />
                <TotalCard label="Files" value={formatCount(summary.totals.fileCount)} helper="Across all months" icon={Files} tone="bg-amber-500/10 text-[var(--color-amber-text)]" />
                <TotalCard label="Report Rows" value={formatCount(summary.totals.reportRows)} helper="Usage records received" icon={FolderTree} tone="bg-blue-500/10 text-[var(--color-blue-text)]" />
                <TotalCard label="Total Revenue (RM)" value={formatRevenueRm(summary.totals.totalRevenue)} helper={`Recognised from ${summary.year} reports`} icon={DollarSign} tone="bg-emerald-500/10 text-[var(--color-green-text)]" />
              </section>

              <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-[var(--color-text)]">Monthly Usage — {selectedCustomer?.name ?? summary.customerName}</h3>
                    <p className="text-xs text-[var(--color-subtle)]">Isilon usage in GB for {summary.year}, all twelve months.</p>
                  </div>
                  <div className="rounded-full border border-teal-500/20 bg-teal-500/10 px-3 py-1 text-xs text-[var(--color-teal-text)]">
                    {formatTotalUsage(summary.totals.usageGb)} total
                  </div>
                </div>
                {summary.totals.usageGb > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                      <defs>
                        <linearGradient id="reportsUsageGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#D2991D" stopOpacity={0.95} />
                          <stop offset="100%" stopColor="#D2991D" stopOpacity={0.35} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.45} />
                      <XAxis dataKey="month" stroke="var(--color-muted)" fontSize={12} interval={0} />
                      <YAxis stroke="var(--color-muted)" fontSize={12} tickFormatter={(value) => formatAxisUsage(Number(value))} />
                      <Tooltip
                        formatter={(value) => [formatAxisUsage(Number(value)), 'Usage']}
                        contentStyle={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '12px', color: 'var(--color-text)' }}
                        cursor={{ fill: 'rgba(210, 153, 29, 0.08)' }}
                      />
                      <Bar dataKey="usageGb" fill="url(#reportsUsageGradient)" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] text-center">
                    <TrendingUp className="mb-3 h-8 w-8 text-[var(--color-faint)]" />
                    <p className="text-sm font-medium text-[var(--color-text-soft)]">No usage data for {summary.year}</p>
                    <p className="mt-1 text-xs text-[var(--color-subtle)]">Upload and confirm a monthly report to populate this year.</p>
                  </div>
                )}
              </section>

              <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
                <div className="border-b border-[var(--color-border)] p-5">
                  <h2 className="font-semibold text-[var(--color-text)]">Month-to-Month Comparison</h2>
                  <p className="mt-1 text-xs text-[var(--color-subtle)]">
                    {selectedCustomer?.name ?? summary.customerName} · {summary.year} · every month compared with its previous period. January has no previous period; months without uploads report honest zeros.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-[860px] w-full text-sm">
                    <thead className="bg-[var(--color-hover)] text-left text-[var(--color-muted)]">
                      <tr>
                        <th className="px-4 py-3 font-medium">Month</th>
                        <th className="px-4 py-3 text-right font-medium">Usage (GB)</th>
                        <th className="px-4 py-3 text-right font-medium">Δ Usage vs prev</th>
                        <th className="px-4 py-3 text-right font-medium">Files (Δ)</th>
                        <th className="px-4 py-3 text-right font-medium">Report Rows (Δ)</th>
                        <th className="px-4 py-3 text-right font-medium">Revenue (RM)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {summary.months.map((month) => (
                        <MonthRow key={month.key} month={month} />
                      ))}
                    </tbody>
                    <tfoot className="border-t border-[var(--color-border)] bg-[var(--color-hover)]">
                      <tr>
                        <td className="px-4 py-3 font-semibold text-[var(--color-text)]">Year total</td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-[var(--color-text)]">{formatCount(summary.totals.usageGb)} GB</td>
                        <td className="px-4 py-3" />
                        <td className="px-4 py-3 text-right font-mono font-semibold text-[var(--color-text)]">{formatCount(summary.totals.fileCount)}</td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-[var(--color-text)]">{formatCount(summary.totals.reportRows)}</td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-[var(--color-text)]">{formatRevenueRm(summary.totals.totalRevenue)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            </>
          )}

          {!summaryLoading && !summaryError && !summary && (
            <section className="rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-16 text-center">
              <Database className="mx-auto mb-4 h-10 w-10 text-[var(--color-faint)]" />
              <h2 className="text-lg font-semibold text-[var(--color-text)]">No data for {selectedCustomer?.name ?? 'this customer'} yet</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--color-muted)]">
                Select a different year or upload a monthly report to populate the yearly comparison.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function MonthRow({ month }: { month: MonthComparisonRow }) {
  return (
    <tr className="transition-colors hover:bg-[var(--color-hover)]">
      <td className="px-4 py-3 font-medium text-[var(--color-text)]">{month.label}</td>
      <td className="px-4 py-3 text-right font-mono text-[var(--color-text-soft)]">{formatCount(month.usageGb)}</td>
      <td className="px-4 py-3 text-right">
        <div className="flex flex-col items-end gap-0.5">
          <span className={`font-mono text-xs font-semibold ${toneClass(month.deltaUsageGb)}`}>{formatDeltaGb(month.deltaUsageGb)}</span>
          {month.deltaUsagePct !== null && (
            <span className={`font-mono text-[11px] ${toneClass(month.deltaUsagePct)}`}>{formatDeltaPct(month.deltaUsagePct)}</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <DeltaCell value={formatCount(month.fileCount)} delta={month.deltaFileCount} />
      </td>
      <td className="px-4 py-3 text-right">
        <DeltaCell value={formatCount(month.reportRows)} delta={month.deltaReportRows} />
      </td>
      <td className="px-4 py-3 text-right font-mono text-[var(--color-text-soft)]">{formatRevenueRm(month.revenue)}</td>
    </tr>
  );
}

function DeltaCell({ value, delta }: { value: string; delta: number | null }) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="font-mono text-[var(--color-text-soft)]">{value}</span>
      <span className={`font-mono text-[11px] ${toneClass(delta)}`}>{formatSignedCount(delta)}</span>
    </div>
  );
}

function TotalCard({ label, value, helper, icon: Icon, tone }: { label: string; value: string; helper: string; icon: typeof Database; tone: string }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 transition hover:-translate-y-0.5 hover:border-amber-500/40 hover:shadow-xl hover:shadow-black/20">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--color-muted)]">{label}</p>
          <p className="mt-2 font-mono text-2xl font-bold text-[var(--color-text)]">{value}</p>
          <p className="mt-2 text-xs text-[var(--color-subtle)]">{helper}</p>
        </div>
        <span className={`rounded-xl p-3 ${tone}`}><Icon className="h-5 w-5" /></span>
      </div>
    </article>
  );
}
