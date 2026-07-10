"use client";

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Database, Files, TrendingUp, FolderTree } from 'lucide-react';

type FolderRow = { folderId: string; cluster: string; workflowFolder: string; usageGb: number; fileCount: number };
type MonthRow = { key: string; year: string; month: string; label: string; totalUsageGb: number; totalFileCount: number; reportRows: number; folders: FolderRow[] };
type ComparisonData = { customer: { custId: string; name: string }; months: MonthRow[] };

const fmt = (n: number) => Number(n || 0).toLocaleString();
const delta = (current: number, previous: number) => {
  const diff = current - previous;
  const pct = previous ? (diff / previous) * 100 : 0;
  return { diff, pct };
};

function DeltaBadge({ current, previous, unit = '' }: { current: number; previous: number; unit?: string }) {
  const d = delta(current, previous);
  if (!previous) return <span className="text-[var(--color-subtle)]">—</span>;
  const up = d.diff > 0;
  return <span className={`font-mono text-xs ${up ? 'text-[var(--color-amber-text)]' : d.diff < 0 ? 'text-[var(--color-green-text)]' : 'text-[var(--color-muted)]'}`}>{up ? '+' : ''}{fmt(d.diff)}{unit} / {up ? '+' : ''}{d.pct.toFixed(1)}%</span>;
}

export default function MyUsagePage() {
  const { user } = useAuth();
  const [months, setMonths] = useState(3);
  const [data, setData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get('/analytics/customer-usage-comparison', { params: { months } })
      .then(res => setData(res.data))
      .catch(err => setError(err?.response?.data?.error || 'Unable to load usage data'))
      .finally(() => setLoading(false));
  }, [months]);

  const current = data?.months?.[data.months.length - 1];
  const previous = data?.months?.[data.months.length - 2];
  const chartRows = useMemo(() => (data?.months || []).map(m => ({ period: m.label.replace(' 20', '\n20'), usageGb: m.totalUsageGb, fileCount: m.totalFileCount })), [data]);

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p className="text-sm text-[var(--color-subtle)]">{data?.customer?.name || user?.customerName || 'Customer Portal'}</p>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">My ESAS Usage</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">View storage usage and compare file count and size across recent months.</p>
      </div>
      <select value={months} onChange={e => setMonths(Number(e.target.value))} className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-amber-500 focus:outline-none">
        <option value={2}>Last 2 months</option>
        <option value={3}>Last 3 months</option>
      </select>
    </div>

    {loading && <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" /></div>}
    {error && <div className="rounded-lg border border-red-800 bg-red-900/20 p-4 text-sm text-[var(--color-red-text)]">{error}</div>}

    {!loading && !error && data && <>
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"><Database className="mb-3 h-5 w-5 text-teal-400" /><p className="text-xs text-[var(--color-muted)]">Current Usage</p><p className="mt-1 font-mono text-2xl font-bold text-[var(--color-text)]">{fmt(current?.totalUsageGb || 0)} GB</p></div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"><Files className="mb-3 h-5 w-5 text-amber-400" /><p className="text-xs text-[var(--color-muted)]">Current File Count</p><p className="mt-1 font-mono text-2xl font-bold text-[var(--color-text)]">{fmt(current?.totalFileCount || 0)}</p></div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"><FolderTree className="mb-3 h-5 w-5 text-blue-400" /><p className="text-xs text-[var(--color-muted)]">Report Rows</p><p className="mt-1 font-mono text-2xl font-bold text-[var(--color-text)]">{fmt(current?.reportRows || 0)}</p></div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"><TrendingUp className="mb-3 h-5 w-5 text-amber-400" /><p className="text-xs text-[var(--color-muted)]">Usage Change</p><p className="mt-2"><DeltaBadge current={current?.totalUsageGb || 0} previous={previous?.totalUsageGb || 0} unit=" GB" /></p></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"><h2 className="mb-4 font-semibold text-[var(--color-text)]">Usage Size by Month</h2><div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartRows}><CartesianGrid stroke="var(--color-border)" /><XAxis dataKey="period" stroke="var(--color-muted)" /><YAxis stroke="var(--color-muted)" /><Tooltip /><Bar dataKey="usageGb" fill="#0D9488" radius={[6,6,0,0]} /></BarChart></ResponsiveContainer></div></div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"><h2 className="mb-4 font-semibold text-[var(--color-text)]">File Count by Month</h2><div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartRows}><CartesianGrid stroke="var(--color-border)" /><XAxis dataKey="period" stroke="var(--color-muted)" /><YAxis stroke="var(--color-muted)" /><Tooltip /><Bar dataKey="fileCount" fill="#D97706" radius={[6,6,0,0]} /></BarChart></ResponsiveContainer></div></div>
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <div className="border-b border-[var(--color-border)] p-4"><h2 className="font-semibold text-[var(--color-text)]">Month Comparison</h2></div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-[var(--color-hover)] text-left text-[var(--color-muted)]"><tr><th className="px-4 py-3">Month</th><th className="px-4 py-3 text-right">Usage Size</th><th className="px-4 py-3 text-right">File Count</th><th className="px-4 py-3 text-right">Usage Change</th><th className="px-4 py-3 text-right">File Change</th></tr></thead><tbody className="divide-y divide-[var(--color-border)]">{data.months.map((m, i) => <tr key={m.key}><td className="px-4 py-3 text-[var(--color-text)]">{m.label}</td><td className="px-4 py-3 text-right font-mono text-[var(--color-text-soft)]">{fmt(m.totalUsageGb)} GB</td><td className="px-4 py-3 text-right font-mono text-[var(--color-text-soft)]">{fmt(m.totalFileCount)}</td><td className="px-4 py-3 text-right"><DeltaBadge current={m.totalUsageGb} previous={data.months[i-1]?.totalUsageGb || 0} unit=" GB" /></td><td className="px-4 py-3 text-right"><DeltaBadge current={m.totalFileCount} previous={data.months[i-1]?.totalFileCount || 0} /></td></tr>)}</tbody></table></div>
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <div className="border-b border-[var(--color-border)] p-4"><h2 className="font-semibold text-[var(--color-text)]">Current Month Detail</h2><p className="text-xs text-[var(--color-muted)]">Cluster and workflow folder usage for {current?.label}</p></div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-[var(--color-hover)] text-left text-[var(--color-muted)]"><tr><th className="px-4 py-3">No</th><th className="px-4 py-3">Cluster</th><th className="px-4 py-3">Workflow Folder</th><th className="px-4 py-3 text-right">Size</th><th className="px-4 py-3 text-right">File Count</th></tr></thead><tbody className="divide-y divide-[var(--color-border)]">{(current?.folders || []).map((f, i) => <tr key={f.folderId}><td className="px-4 py-3 text-[var(--color-muted)]">{i+1}</td><td className="px-4 py-3 text-[var(--color-text)]">{f.cluster}</td><td className="px-4 py-3 text-[var(--color-text-soft)]">{f.workflowFolder}</td><td className="px-4 py-3 text-right font-mono text-[var(--color-text-soft)]">{fmt(f.usageGb)} GB</td><td className="px-4 py-3 text-right font-mono text-[var(--color-text-soft)]">{fmt(f.fileCount)}</td></tr>)}{(current?.folders || []).length === 0 && <tr><td colSpan={5} className="px-4 py-12 text-center text-[var(--color-subtle)]">No usage data is available for this month.</td></tr>}</tbody></table></div>
      </div>
    </>}
  </div>;
}
