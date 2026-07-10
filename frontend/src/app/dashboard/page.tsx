'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import {
  ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line,
} from 'recharts';
import {
  Activity, AlertTriangle, ArrowUpRight, CalendarCheck, CheckCircle2,
  Clock3, Database, DollarSign, FileText, HardDrive, ShieldAlert,
  TrendingUp, Users, Zap,
} from 'lucide-react';

const COLORS = ['#D2991D', '#39D353', '#58A6FF', '#F78166', '#BC8CFF', '#F0B72F', '#2DD4BF', '#A78BFA'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 6 }, (_, index) => CURRENT_YEAR - index);
const BYTES_IN_GB = 1073741824;
const GB_IN_PB = 1048576;

type MonthlyUsageItem = {
  month?: string | number;
  total_usage?: string | number;
  total_usage_bytes?: string | number;
  total_usage_gb?: string | number;
  usage_size?: string | number;
};

type UsageByCustomer = {
  cust_id?: string;
  cust_name?: string;
  customer?: string;
  customer_name?: string;
  total_usage?: string | number;
  total_usage_bytes?: string | number;
  total_usage_gb?: string | number;
  usage_size?: string | number;
  monthly_usage?: MonthlyUsageItem[];
  months?: MonthlyUsageItem[];
  usage_by_month?: MonthlyUsageItem[];
};

type RevenueItem = {
  month?: string;
  total_usage: number;
  price: number;
};

type StorageTrend = {
  month: string;
  total_pb: string;
};

type DashboardSummary = {
  year: string;
  totalCustomers: number;
  activeCustomers: number;
  totalUsageGB: number;
  totalUsageTB: string;
  totalUsagePB: number;
  totalRevenue: number;
  uploadedReports: number;
  expectedReports: number;
  reportCompletionPct: number;
  pendingUnmatched: number;
  partialImports: number;
  failedImports: number;
  topCustomer?: {
    custId: string;
    custName: string;
    totalUsageGb: number;
    totalUsagePb: number;
  } | null;
};

type TopCustomer = {
  rank: number;
  custId: string;
  custName: string;
  reportCount: number;
  totalUsageGb: number;
  totalUsagePb: number;
  sharePct: number;
};

type RecentImport = {
  id: string;
  fileName: string;
  month: string;
  year: string;
  status: string;
  matchedCount: number;
  unmatchedCount: number;
  insertedCount: number;
  skippedCount: number;
  createdAt: string;
  customer?: { custId: string; custName: string } | null;
};

type AttentionItem = {
  key: string;
  severity: 'ok' | 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  count: number;
  href: string;
};

type UsageChartRow = {
  month: string;
  [customerName: string]: string | number;
};

const toNumber = (value: string | number | undefined): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const monthIndex = (month: string | number | undefined): number => {
  const parsed = toNumber(month);
  return parsed >= 1 && parsed <= 12 ? parsed - 1 : -1;
};

const customerName = (item: UsageByCustomer): string => (
  item.cust_name ?? item.customer_name ?? item.customer ?? 'Unknown Customer'
);

const usageGb = (item: MonthlyUsageItem | UsageByCustomer): number => {
  const directGb = toNumber(item.total_usage_gb);
  if (directGb > 0) return directGb;
  return Math.ceil(toNumber(item.total_usage ?? item.total_usage_bytes ?? item.usage_size) / BYTES_IN_GB);
};

const compactNumber = (value: number): string => new Intl.NumberFormat('en-MY', {
  notation: value >= 1000000 ? 'compact' : 'standard',
  maximumFractionDigits: value >= 1000000 ? 1 : 0,
}).format(value);

const formatCurrency = (value: number): string => `RM ${new Intl.NumberFormat('en-MY', {
  maximumFractionDigits: 0,
}).format(value || 0)}`;

const formatUsage = (gb: number): string => {
  if (gb >= GB_IN_PB) return `${(gb / GB_IN_PB).toFixed(2)} PB`;
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`;
  return `${Math.round(gb).toLocaleString()} GB`;
};

const statusStyle = (status: string): string => {
  if (status === 'SUCCESS') return 'border-emerald-500/30 bg-emerald-500/10 text-[var(--color-green-text)]';
  if (status === 'PARTIAL') return 'border-amber-500/30 bg-amber-500/10 text-[var(--color-amber-text)]';
  if (status === 'FAILED') return 'border-red-500/30 bg-red-500/10 text-[var(--color-red-text)]';
  return 'border-zinc-500/30 bg-zinc-500/10 text-[var(--color-text-soft)]';
};

const severityMeta = {
  ok: { icon: CheckCircle2, className: 'border-emerald-500/25 bg-emerald-500/10 text-[var(--color-green-text)]' },
  info: { icon: Activity, className: 'border-blue-500/25 bg-blue-500/10 text-[var(--color-blue-text)]' },
  warning: { icon: AlertTriangle, className: 'border-amber-500/25 bg-amber-500/10 text-[var(--color-amber-text)]' },
  critical: { icon: ShieldAlert, className: 'border-red-500/25 bg-red-500/10 text-[var(--color-red-text)]' },
};

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [usageByCustomer, setUsageByCustomer] = useState<UsageByCustomer[]>([]);
  const [revenue, setRevenue] = useState<RevenueItem[]>([]);
  const [storageTrend, setStorageTrend] = useState<StorageTrend[]>([]);
  const [topCustomers, setTopCustomers] = useState<TopCustomer[]>([]);
  const [recentImports, setRecentImports] = useState<RecentImport[]>([]);
  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>([]);
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/analytics/dashboard-summary', { params: { year: selectedYear } }),
      api.get('/analytics/usage-by-customer-monthly', { params: { year: selectedYear } }),
      api.get('/analytics/revenue', { params: { year: selectedYear } }),
      api.get('/analytics/storage-trend', { params: { year: selectedYear } }),
      api.get('/analytics/top-customers', { params: { year: selectedYear, limit: 5 } }),
      api.get('/analytics/recent-imports', { params: { year: selectedYear, limit: 5 } }),
      api.get('/analytics/attention-items', { params: { year: selectedYear } }),
    ]).then(([summaryRes, usageRes, revRes, storRes, topRes, importsRes, attentionRes]) => {
      setSummary(summaryRes.data);
      setUsageByCustomer(Array.isArray(usageRes.data) ? usageRes.data : []);
      setRevenue(Array.isArray(revRes.data) ? revRes.data : []);
      setStorageTrend(Array.isArray(storRes.data) ? storRes.data : []);
      setTopCustomers(Array.isArray(topRes.data) ? topRes.data : []);
      setRecentImports(Array.isArray(importsRes.data) ? importsRes.data : []);
      setAttentionItems(Array.isArray(attentionRes.data) ? attentionRes.data : []);
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedYear]);

  const revenueChartData = revenue.map((r, i) => ({
    month: MONTHS[i],
    revenue: Math.round((toNumber(r.total_usage) / BYTES_IN_GB) * toNumber(r.price) * 100) / 100,
  }));

  const storageChartData = storageTrend.map((s) => ({
    month: MONTHS[parseInt(s.month, 10) - 1],
    pb: parseFloat(s.total_pb),
  }));

  const { usageChartData, usageCustomers, peakMonth } = useMemo(() => {
    const totals = new Map<string, number>();
    const monthlyPb = new Map<string, number[]>();

    usageByCustomer.forEach((item) => {
      const name = customerName(item);
      const nestedMonthlyUsage = item.monthly_usage ?? item.months ?? item.usage_by_month;
      if (!Array.isArray(nestedMonthlyUsage)) return;

      nestedMonthlyUsage.forEach((monthItem) => {
        const index = monthIndex(monthItem.month);
        if (index < 0) return;
        const pb = usageGb(monthItem) / GB_IN_PB;
        const values = monthlyPb.get(name) ?? Array(12).fill(0);
        values[index] += pb;
        monthlyPb.set(name, values);
        totals.set(name, (totals.get(name) ?? 0) + pb);
      });
    });

    const customers = Array.from(totals.entries())
      .filter(([, total]) => total > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);

    let peak = { month: '—', value: 0 };
    const rows: UsageChartRow[] = MONTHS.map((month, index) => {
      const row: UsageChartRow = { month };
      const monthTotal = customers.reduce((sum, name) => {
        const value = monthlyPb.get(name)?.[index] ?? 0;
        row[name] = Number(value.toFixed(4));
        return sum + value;
      }, 0);
      if (monthTotal > peak.value) peak = { month, value: monthTotal };
      return row;
    });

    return { usageChartData: rows, usageCustomers: customers, peakMonth: peak };
  }, [usageByCustomer]);

  const usageChartHeight = Math.max(380, 320 + Math.ceil(usageCustomers.length / 3) * 28);
  const topAttention = attentionItems[0];

  const kpiCards = [
    {
      label: 'Total Usage',
      value: summary ? formatUsage(summary.totalUsageGB) : '0 GB',
      helper: `${selectedYear} storage consumed`,
      icon: HardDrive,
      accent: 'from-teal-500/20 to-cyan-500/5 text-[var(--color-teal-text)]',
    },
    {
      label: 'Revenue',
      value: formatCurrency(summary?.totalRevenue ?? 0),
      helper: 'Recognised from uploaded reports',
      icon: DollarSign,
      accent: 'from-emerald-500/20 to-green-500/5 text-[var(--color-green-text)]',
    },
    {
      label: 'Active Customers',
      value: `${summary?.activeCustomers ?? 0}/${summary?.totalCustomers ?? 0}`,
      helper: 'Customers with usage this year',
      icon: Users,
      accent: 'from-amber-500/20 to-yellow-500/5 text-[var(--color-amber-text)]',
    },
    {
      label: 'Report Coverage',
      value: `${summary?.reportCompletionPct ?? 0}%`,
      helper: `${summary?.uploadedReports ?? 0}/${summary?.expectedReports ?? 0} expected uploads`,
      icon: CalendarCheck,
      accent: 'from-blue-500/20 to-indigo-500/5 text-[var(--color-blue-text)]',
    },
  ];

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--color-amber)_22%,transparent),transparent_34%),linear-gradient(135deg,var(--color-surface)_0%,var(--color-bg)_64%,var(--color-surface-raised)_100%)] p-6 shadow-2xl shadow-black/10">
        <div className="absolute right-8 top-6 h-24 w-24 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-medium text-[var(--color-amber-text)]">
              <Zap className="h-3.5 w-3.5" />
              ESAS Storage Command
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-[var(--color-text)] sm:text-4xl">Dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-muted)]">
              Year-aware storage, revenue, import health, and customer usage overview for the ESAS operating picture.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3">
                <p className="text-xs text-[var(--color-subtle)]">Top Customer</p>
                <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{summary?.topCustomer?.custName ?? 'No usage yet'}</p>
                <p className="text-xs text-[var(--color-amber-text)]">{summary?.topCustomer ? formatUsage(summary.topCustomer.totalUsageGb) : 'Awaiting report data'}</p>
              </div>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3">
                <p className="text-xs text-[var(--color-subtle)]">Peak Month</p>
                <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{peakMonth.month}</p>
                <p className="text-xs text-[var(--color-teal-text)]">{peakMonth.value > 0 ? `${peakMonth.value.toFixed(2)} PB` : 'No peak detected'}</p>
              </div>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3">
                <p className="text-xs text-[var(--color-subtle)]">Attention</p>
                <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{topAttention?.title ?? 'No issues detected'}</p>
                <p className="text-xs text-[var(--color-blue-text)]">{topAttention?.count ?? 0} open item{(topAttention?.count ?? 0) === 1 ? '' : 's'}</p>
              </div>
            </div>
          </div>

          <label className="relative flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-sm text-[var(--color-text-soft)] shadow-inner lg:w-44">
            <span className="font-medium text-[var(--color-muted)]">Year</span>
            <select
              value={selectedYear}
              onChange={(event) => setSelectedYear(Number(event.target.value))}
              className="w-24 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-semibold text-[var(--color-text)] outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
            >
              {YEAR_OPTIONS.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="group overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 transition hover:-translate-y-0.5 hover:border-amber-500/40 hover:shadow-xl hover:shadow-black/20">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-[var(--color-muted)]">{card.label}</p>
                  <p className="mt-2 font-mono text-2xl font-bold text-[var(--color-text)]">{card.value}</p>
                  <p className="mt-2 text-xs text-[var(--color-subtle)]">{card.helper}</p>
                </div>
                <div className={`rounded-2xl bg-gradient-to-br p-3 ${card.accent}`}>
                  <Icon className="h-6 w-6" />
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 xl:col-span-2">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-[var(--color-text)]">Usage by Customer by Month</h3>
              <p className="text-xs text-[var(--color-subtle)]">Stacked petabyte view, controlled by selected year.</p>
            </div>
            <div className="rounded-full border border-teal-500/20 bg-teal-500/10 px-3 py-1 text-xs text-[var(--color-teal-text)]">
              {summary ? formatUsage(summary.totalUsageGB) : '0 GB'} total
            </div>
          </div>

          {usageCustomers.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={usageChartHeight}>
                <BarChart data={usageChartData} margin={{ top: 12, right: 18, left: 0, bottom: 8 }}>
                  <defs>
                    {usageCustomers.map((name, idx) => (
                      <linearGradient key={name} id={`usageGradient${idx}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLORS[idx % COLORS.length]} stopOpacity={0.95} />
                        <stop offset="100%" stopColor={COLORS[idx % COLORS.length]} stopOpacity={0.45} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.45} />
                  <XAxis dataKey="month" stroke="var(--color-muted)" fontSize={12} interval={0} />
                  <YAxis stroke="var(--color-muted)" fontSize={12} tickFormatter={(value) => `${Number(value).toFixed(1)} PB`} />
                  <Tooltip
                    formatter={(value) => [`${Number(value).toFixed(4)} PB`, 'Usage']}
                    contentStyle={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '12px', color: 'var(--color-text)' }}
                    cursor={{ fill: 'rgba(210, 153, 29, 0.08)' }}
                  />
                  {usageCustomers.map((name, idx) => (
                    <Bar key={name} dataKey={name} stackId="usage" fill={`url(#usageGradient${idx})`} radius={idx === usageCustomers.length - 1 ? [8, 8, 0, 0] : [0, 0, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-4 grid grid-cols-1 gap-2 text-xs text-[var(--color-text-soft)] sm:grid-cols-2 lg:grid-cols-3">
                {usageCustomers.map((name, idx) => (
                  <div key={name} className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                    <span className="break-words leading-snug">{name}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex h-72 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] text-center">
              <Database className="mb-3 h-8 w-8 text-[var(--color-faint)]" />
              <p className="text-sm font-medium text-[var(--color-text-soft)]">No usage data for {selectedYear}</p>
              <p className="mt-1 text-xs text-[var(--color-subtle)]">Upload and confirm a monthly report to populate this view.</p>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-[var(--color-text)]">Top Customers</h3>
                <p className="text-xs text-[var(--color-subtle)]">Usage share for {selectedYear}</p>
              </div>
              <TrendingUp className="h-5 w-5 text-[var(--color-amber-text)]" />
            </div>
            <div className="space-y-3">
              {topCustomers.length > 0 ? topCustomers.map((customer) => (
                <div key={customer.custId}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-[var(--color-text)]">{customer.rank}. {customer.custName}</span>
                    <span className="font-mono text-xs text-[var(--color-muted)]">{formatUsage(customer.totalUsageGb)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--color-bg)]">
                    <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-teal-400" style={{ width: `${Math.max(customer.sharePct, 3)}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-subtle)]">{customer.sharePct}% share · {customer.reportCount} report rows</p>
                </div>
              )) : (
                <p className="rounded-xl border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-subtle)]">No customer usage yet.</p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-[var(--color-text)]">Needs Attention</h3>
                <p className="text-xs text-[var(--color-subtle)]">Operational exceptions</p>
              </div>
              <ShieldAlert className="h-5 w-5 text-[var(--color-amber-text)]" />
            </div>
            <div className="space-y-3">
              {attentionItems.map((item) => {
                const meta = severityMeta[item.severity] ?? severityMeta.info;
                const Icon = meta.icon;
                return (
                  <Link key={item.key} href={item.href} className="block rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3 transition hover:border-amber-500/35">
                    <div className="flex items-start gap-3">
                      <span className={`rounded-lg border p-2 ${meta.className}`}><Icon className="h-4 w-4" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--color-text)]">{item.title}</p>
                        <p className="mt-1 text-xs leading-5 text-[var(--color-subtle)]">{item.description}</p>
                      </div>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--color-faint)]" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h3 className="mb-4 text-base font-semibold text-[var(--color-text)]">Revenue by Month</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={revenueChartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#D2991D" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="#D2991D" stopOpacity={0.35} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.45} />
              <XAxis dataKey="month" stroke="var(--color-muted)" fontSize={12} interval={0} />
              <YAxis stroke="var(--color-muted)" fontSize={12} tickFormatter={(value) => compactNumber(Number(value))} />
              <Tooltip
                formatter={(value) => [formatCurrency(Number(value)), 'Revenue']}
                contentStyle={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '12px', color: 'var(--color-text)' }}
              />
              <Bar dataKey="revenue" fill="url(#revenueGradient)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h3 className="mb-4 text-base font-semibold text-[var(--color-text)]">Monthly Usage Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={storageChartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.45} />
              <XAxis dataKey="month" stroke="var(--color-muted)" fontSize={12} interval={0} />
              <YAxis stroke="var(--color-muted)" fontSize={12} tickFormatter={(value) => `${Number(value).toFixed(1)} PB`} />
              <Tooltip
                formatter={(value) => [`${Number(value).toFixed(4)} PB`, 'Usage']}
                contentStyle={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '12px', color: 'var(--color-text)' }}
              />
              <Line type="monotone" dataKey="pb" stroke="#39D353" strokeWidth={3} dot={{ fill: '#39D353', r: 4 }} activeDot={{ r: 6, fill: '#39D353' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-[var(--color-text)]">Recent Import Activity</h3>
            <p className="text-xs text-[var(--color-subtle)]">Latest uploads for {selectedYear}</p>
          </div>
          <Link href="/dashboard/import-runs" className="text-xs font-medium text-[var(--color-amber-text)] transition hover:text-[var(--color-amber-text)]">View all</Link>
        </div>
        {recentImports.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
            {recentImports.map((run) => (
              <div key={run.id} className="grid gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)] p-4 last:border-b-0 md:grid-cols-[1fr_auto_auto] md:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="break-words text-sm font-medium text-[var(--color-text)]">{run.customer?.custName ?? 'Unknown customer'}</p>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusStyle(run.status)}`}>{run.status}</span>
                  </div>
                  <p className="mt-1 break-words text-xs text-[var(--color-subtle)]">{run.fileName}</p>
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                  <Clock3 className="h-4 w-4" />
                  {MONTHS[Number(run.month) - 1]} {run.year}
                </div>
                <div className="flex items-center gap-4 text-xs text-[var(--color-muted)]">
                  <span><FileText className="mr-1 inline h-3.5 w-3.5" />{run.insertedCount} inserted</span>
                  <span>{run.unmatchedCount} unmatched</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--color-border)] px-4 py-10 text-center">
            <FileText className="mx-auto mb-3 h-8 w-8 text-[var(--color-faint)]" />
            <p className="text-sm font-medium text-[var(--color-text-soft)]">No imports recorded for {selectedYear}</p>
            <p className="mt-1 text-xs text-[var(--color-subtle)]">Upload a customer report to populate this operational trail.</p>
          </div>
        )}
      </section>
    </div>
  );
}
