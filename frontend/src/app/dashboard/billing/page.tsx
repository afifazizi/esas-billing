'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  CalendarRange,
  CircleDollarSign,
  FileWarning,
  Loader2,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { api } from '@/lib/api';
import { normalizeLifecycleStatus, type ReportLifecycleStatus } from '@/lib/report-lifecycle';

interface BillingIssue {
  code: string;
  severity: 'blocking' | 'info' | string;
  message: string;
}

interface BillingCustomer {
  custId: string;
  custName: string;
  month: string;
  year: string;
  lifecycleStatus: ReportLifecycleStatus;
  lifecycleVersion: number;
  reportRowCount: number;
  usageBytes: string;
  usageGb: number;
  revenue: number;
  latestImport: {
    id: string;
    fileName: string;
    status: string;
    insertedCount: number;
    unmatchedCount: number;
    createdAt: string;
  } | null;
  latestImportStatus: string | null;
  pendingUnmatchedCount: number;
  priceInfo: {
    current: { id: string; label: string | null; price: number; isDefault: boolean } | null;
    default: { id: string; label: string | null; price: number; isDefault: boolean } | null;
    appliedPriceIds: string[];
  };
  readiness: {
    ready: boolean;
    readyForReview: boolean;
    readyForApproval: boolean;
    readyForLock: boolean;
    issues: BillingIssue[];
  };
}

interface BillingSummary {
  month: string;
  year: string;
  customers: BillingCustomer[];
  totals: {
    customerCount: number;
    reportRowCount: number;
    usageBytes: string;
    usageGb: number;
    revenue: number;
    pendingUnmatchedCount: number;
    readyCount: number;
  };
  statusCounts: Record<ReportLifecycleStatus, number>;
}

type QueueFilter = 'ALL' | 'ACTION_REQUIRED' | 'READY' | ReportLifecycleStatus;

const QUEUE_FILTERS: QueueFilter[] = ['ALL', 'ACTION_REQUIRED', 'READY', 'DRAFT', 'REVIEWED', 'APPROVED', 'LOCKED'];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const STATUS_STYLES: Record<ReportLifecycleStatus, string> = {
  DRAFT: 'border-amber-700/60 bg-amber-900/20 text-[var(--color-amber-text)]',
  REVIEWED: 'border-blue-700/60 bg-blue-900/20 text-[var(--color-blue-text)]',
  APPROVED: 'border-green-700/60 bg-green-900/20 text-[var(--color-green-text)]',
  LOCKED: 'border-purple-700/60 bg-purple-900/20 text-[var(--color-purple-text)]',
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', maximumFractionDigits: 2 }).format(value || 0);
}

function formatUsage(gb: number) {
  if (gb >= 1024 * 1024) return `${(gb / 1024 / 1024).toFixed(2)} PB`;
  if (gb >= 1024) return `${(gb / 1024).toFixed(2)} TB`;
  return `${Math.round(gb).toLocaleString()} GB`;
}

function periodLabel(month: string, year: string) {
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

function nextAction(customer: BillingCustomer) {
  if (customer.readiness.issues.some((issue) => issue.code === 'MISSING_REPORT')) return 'Upload report';
  if (customer.readiness.issues.some((issue) => issue.code === 'PENDING_UNMATCHED')) return 'Resolve paths';
  if (customer.readiness.readyForReview) return 'Submit for review';
  if (customer.readiness.readyForApproval) return 'Approve report';
  if (customer.readiness.readyForLock) return 'Lock period';
  if (customer.readiness.ready) return 'View package';
  return 'Review issues';
}

function BillingOperationsContent() {
  const searchParams = useSearchParams();
  const now = new Date();
  const linkedYear = searchParams.get('year');
  const linkedFilter = searchParams.get('filter') as QueueFilter | null;
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [year, setYear] = useState(linkedYear && /^\d{4}$/.test(linkedYear) ? linkedYear : String(now.getFullYear()));
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<QueueFilter>(linkedFilter && QUEUE_FILTERS.includes(linkedFilter) ? linkedFilter : 'ALL');

  useEffect(() => {
    let active = true;
    // Loading state is intentionally reset whenever the selected period changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError('');
    api.get('/billing/summary', { params: { month, year } })
      .then((response) => {
        if (!active) return;
        const data = response.data as BillingSummary;
        setSummary({
          ...data,
          customers: (data.customers || []).map((customer) => ({
            ...customer,
            lifecycleStatus: normalizeLifecycleStatus(customer.lifecycleStatus),
          })),
        });
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError.response?.data?.error || 'Billing summary could not be loaded.');
        setSummary(null);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [month, year]);

  const visibleCustomers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (summary?.customers || []).filter((customer) => {
      const matchesQuery = !normalizedQuery
        || customer.custName.toLowerCase().includes(normalizedQuery)
        || customer.custId.toLowerCase().includes(normalizedQuery);
      if (!matchesQuery) return false;
      if (filter === 'ALL') return true;
      if (filter === 'ACTION_REQUIRED') return !customer.readiness.ready;
      if (filter === 'READY') return customer.readiness.ready;
      return customer.lifecycleStatus === filter;
    });
  }, [summary, query, filter]);

  const cards = [
    { label: 'Customers', value: summary?.totals.customerCount ?? 0, helper: `${visibleCustomers.length} shown`, icon: Users, color: 'text-[var(--color-blue-text)]' },
    { label: 'Billing Ready', value: summary?.totals.readyCount ?? 0, helper: `${Math.max((summary?.totals.customerCount ?? 0) - (summary?.totals.readyCount ?? 0), 0)} need action`, icon: BadgeCheck, color: 'text-[var(--color-green-text)]' },
    { label: 'Period Revenue', value: formatCurrency(summary?.totals.revenue ?? 0), helper: `${summary?.totals.reportRowCount ?? 0} report rows`, icon: CircleDollarSign, color: 'text-[var(--color-amber-text)]' },
    { label: 'Unmatched Paths', value: summary?.totals.pendingUnmatchedCount ?? 0, helper: 'Blocking billing readiness', icon: FileWarning, color: 'text-[var(--color-red-text)]' },
  ];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-amber-500/20 bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--color-amber)_18%,transparent),transparent_32%),linear-gradient(135deg,var(--color-surface),var(--color-bg))] p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-medium text-[var(--color-amber-text)]">
              <ShieldCheck className="h-3.5 w-3.5" /> Billing control
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-[var(--color-text)]">Billing Operations</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-muted)]">
              Close each customer period deliberately: resolve data exceptions, review the package, approve it, then lock it.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
            <label className="text-xs text-[var(--color-muted)]">Month
              <select value={month} onChange={(event) => setMonth(event.target.value)} className="mt-1 block rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-semibold text-[var(--color-text)] outline-none focus:border-amber-500">
                {MONTHS.map((name, index) => <option key={name} value={String(index + 1).padStart(2, '0')}>{name}</option>)}
              </select>
            </label>
            <label className="text-xs text-[var(--color-muted)]">Year
              <select value={year} onChange={(event) => setYear(event.target.value)} className="mt-1 block rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-semibold text-[var(--color-text)] outline-none focus:border-amber-500">
                {Array.from({ length: 6 }, (_, index) => String(now.getFullYear() - index)).map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <div className="flex items-start justify-between gap-4">
                <div><p className="text-sm text-[var(--color-muted)]">{card.label}</p><p className="mt-2 font-mono text-2xl font-bold text-[var(--color-text)]">{card.value}</p><p className="mt-2 text-xs text-[var(--color-subtle)]">{card.helper}</p></div>
                <Icon className={`h-6 w-6 ${card.color}`} />
              </div>
            </div>
          );
        })}
      </section>

      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="border-b border-[var(--color-border)] p-4 sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]"><CalendarRange className="h-5 w-5 text-[var(--color-amber-text)]" /> {periodLabel(month, year)} close queue</h2>
              <p className="mt-1 text-xs text-[var(--color-subtle)]">All active customers are shown, including customers with no uploaded report.</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="relative min-w-[240px]">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-[var(--color-subtle)]" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer or ID" className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] py-2 pl-9 pr-3 text-sm text-[var(--color-text)] outline-none focus:border-amber-500" />
              </label>
              <select value={filter} onChange={(event) => setFilter(event.target.value as QueueFilter)} className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-amber-500">
                <option value="ALL">All customers</option><option value="ACTION_REQUIRED">Action required</option><option value="READY">Billing ready</option><option value="DRAFT">Draft</option><option value="REVIEWED">Reviewed</option><option value="APPROVED">Approved</option><option value="LOCKED">Locked</option>
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 py-20 text-sm text-[var(--color-muted)]"><Loader2 className="h-5 w-5 animate-spin text-[var(--color-amber-text)]" /> Loading billing queue…</div>
        ) : error ? (
          <div className="m-5 rounded-xl border border-red-800 bg-red-900/20 p-5 text-sm text-[var(--color-red-text)]"><AlertTriangle className="mr-2 inline h-4 w-4" />{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-sm">
              <thead className="bg-[var(--color-hover)] text-left text-[var(--color-muted)]">
                <tr><th className="px-4 py-3 font-medium">Customer</th><th className="px-4 py-3 font-medium">Lifecycle</th><th className="px-4 py-3 font-medium">Report</th><th className="px-4 py-3 font-medium">Latest Import</th><th className="px-4 py-3 text-right font-medium">Revenue</th><th className="px-4 py-3 font-medium">Readiness</th><th className="px-4 py-3 text-right font-medium">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {visibleCustomers.map((customer) => (
                  <tr key={customer.custId} className="align-top transition-colors hover:bg-[var(--color-hover)]">
                    <td className="px-4 py-4"><p className="font-semibold text-[var(--color-text)]">{customer.custName}</p><p className="mt-1 font-mono text-xs text-[var(--color-subtle)]">{customer.custId}</p></td>
                    <td className="px-4 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[customer.lifecycleStatus]}`}>{customer.lifecycleStatus}</span><p className="mt-2 text-xs text-[var(--color-subtle)]">Version {customer.lifecycleVersion}</p></td>
                    <td className="px-4 py-4"><p className="font-mono font-semibold text-[var(--color-text)]">{formatUsage(customer.usageGb)}</p><p className="mt-1 text-xs text-[var(--color-subtle)]">{customer.reportRowCount} rows · {customer.pendingUnmatchedCount} unmatched</p></td>
                    <td className="px-4 py-4"><p className="font-medium text-[var(--color-text-soft)]">{customer.latestImportStatus || 'No import'}</p><p className="mt-1 max-w-[180px] truncate text-xs text-[var(--color-subtle)]" title={customer.latestImport?.fileName}>{customer.latestImport?.fileName || 'No source file'}</p></td>
                    <td className="px-4 py-4 text-right"><p className="font-mono font-semibold text-[var(--color-green-text)]">{formatCurrency(customer.revenue)}</p><p className="mt-1 text-xs text-[var(--color-subtle)]">{customer.priceInfo.current ? `RM ${customer.priceInfo.current.price.toFixed(4)}/GB` : 'No price'}</p></td>
                    <td className="px-4 py-4">
                      {customer.readiness.ready ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-green-text)]"><BadgeCheck className="h-4 w-4" /> Billing ready</span> : <div className="space-y-1.5">{customer.readiness.issues.slice(0, 3).map((issue) => <p key={issue.code} className={`text-xs ${issue.severity === 'blocking' ? 'text-[var(--color-red-text)]' : 'text-[var(--color-amber-text)]'}`}>• {issue.message}</p>)}</div>}
                    </td>
                    <td className="px-4 py-4 text-right"><Link href={`/dashboard/reports/${customer.custId}?month=${month}&year=${year}`} className="inline-flex items-center gap-2 rounded-md border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-xs font-semibold text-[var(--color-amber-text)] hover:bg-amber-600/20">{nextAction(customer)} <ArrowUpRight className="h-3.5 w-3.5" /></Link></td>
                  </tr>
                ))}
                {visibleCustomers.length === 0 && <tr><td colSpan={7} className="px-4 py-16 text-center text-sm text-[var(--color-subtle)]">No customers match the current search and filter.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function BillingOperationsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center gap-3 py-20 text-sm text-[var(--color-muted)]"><Loader2 className="h-5 w-5 animate-spin text-[var(--color-amber-text)]" /> Loading Billing Operations…</div>}>
      <BillingOperationsContent />
    </Suspense>
  );
}
