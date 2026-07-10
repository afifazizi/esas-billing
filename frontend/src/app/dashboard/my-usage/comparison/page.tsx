'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Database, Files, FolderTree, TrendingUp } from 'lucide-react';

type FolderRow = { folderId: string; cluster: string; workflowFolder: string; usageGb: number; fileCount: number };
type MonthRow = { key: string; label: string; totalUsageGb: number; totalFileCount: number; reportRows: number; folders: FolderRow[] };
type ComparisonData = { customer: { name?: string }; months: MonthRow[] };

const fmt = (value: number) => Math.round(value || 0).toLocaleString();
const usage = (value: number) => value >= 1024 ? `${(value / 1024).toFixed(2)} TB` : `${fmt(value)} GB`;
const difference = (current: number, previous: number) => ({ amount: current - previous, percent: previous ? ((current - previous) / previous) * 100 : null });

function Delta({ current, previous, unit = '' }: { current: number; previous: number; unit?: string }) {
  if (!previous) return <span className="text-[var(--color-subtle)]">—</span>;
  const result = difference(current, previous);
  const className = result.amount > 0 ? 'text-[var(--color-amber-text)]' : result.amount < 0 ? 'text-[var(--color-green-text)]' : 'text-[var(--color-muted)]';
  return <span className={`font-mono text-xs ${className}`}>{result.amount > 0 ? '+' : ''}{fmt(result.amount)}{unit} · {result.percent! > 0 ? '+' : ''}{result.percent!.toFixed(1)}%</span>;
}

export default function UsageComparisonPage() {
  const { user } = useAuth();
  const [months, setMonths] = useState<2 | 3>(3);
  const [data, setData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api.get('/analytics/customer-usage-comparison', { params: { months }, signal: controller.signal })
      .then((response) => setData(response.data))
      .catch((err) => { if (err?.code !== 'ERR_CANCELED') setError(err?.response?.data?.error || 'Unable to load comparison data.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [months]);

  const current = data?.months?.at(-1);
  const previous = data?.months?.at(-2);
  const chartRows = useMemo(() => (data?.months ?? []).map((month) => ({ period: month.label, usageGb: month.totalUsageGb, fileCount: month.totalFileCount })), [data]);

  return <div className="space-y-6">
    <section className="rounded-2xl border border-amber-500/20 bg-[linear-gradient(135deg,var(--color-surface)_0%,var(--color-bg)_100%)] p-5 sm:p-6"><div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"><div className="max-w-2xl"><p className="text-sm text-[var(--color-subtle)]">{data?.customer?.name || user?.customerName || 'Customer Portal'}</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-[var(--color-text)]">Usage Comparison</h1><p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">Compare your most recent two or three reported months. For the full year, use My Usage.</p></div><label className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-sm sm:w-52"><span className="font-medium text-[var(--color-muted)]">Period</span><select aria-label="Select comparison period" value={months} onChange={(event) => { setLoading(true); setError(''); setMonths(Number(event.target.value) as 2 | 3); }} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-semibold text-[var(--color-text)] outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"><option value={2}>Last 2 months</option><option value={3}>Last 3 months</option></select></label></div></section>
    {loading && <div className="flex min-h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" /></div>}
    {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-[var(--color-red-text)]">{error}</div>}
    {!loading && !error && data && <>
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Latest usage" value={usage(current?.totalUsageGb ?? 0)} icon={Database} tone="bg-teal-500/10 text-[var(--color-teal-text)]" /><Metric label="Latest file count" value={fmt(current?.totalFileCount ?? 0)} icon={Files} tone="bg-amber-500/10 text-[var(--color-amber-text)]" /><Metric label="Latest report rows" value={fmt(current?.reportRows ?? 0)} icon={FolderTree} tone="bg-blue-500/10 text-[var(--color-blue-text)]" /><Metric label="Usage change" value={<Delta current={current?.totalUsageGb ?? 0} previous={previous?.totalUsageGb ?? 0} unit=" GB" />} icon={TrendingUp} tone="bg-emerald-500/10 text-[var(--color-green-text)]" /></section>
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2"><Chart title="Storage usage" data={chartRows} dataKey="usageGb" color="#0d9488" suffix="GB" /><Chart title="File count" data={chartRows} dataKey="fileCount" color="#d97706" suffix="files" /></section>
      <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"><div className="border-b border-[var(--color-border)] p-5"><h2 className="font-semibold text-[var(--color-text)]">Period comparison</h2><p className="mt-1 text-xs text-[var(--color-subtle)]">Changes are calculated against the preceding reported month.</p></div><div className="overflow-x-auto"><table className="min-w-[760px] w-full text-sm"><thead className="bg-[var(--color-hover)] text-left text-[var(--color-muted)]"><tr><th className="px-4 py-3 font-medium">Month</th><th className="px-4 py-3 text-right font-medium">Usage</th><th className="px-4 py-3 text-right font-medium">Files</th><th className="px-4 py-3 text-right font-medium">Usage change</th><th className="px-4 py-3 text-right font-medium">File change</th></tr></thead><tbody className="divide-y divide-[var(--color-border)]">{data.months.map((month, index) => <tr key={month.key}><td className="px-4 py-3 font-medium text-[var(--color-text)]">{month.label}</td><td className="px-4 py-3 text-right font-mono text-[var(--color-text-soft)]">{usage(month.totalUsageGb)}</td><td className="px-4 py-3 text-right font-mono text-[var(--color-text-soft)]">{fmt(month.totalFileCount)}</td><td className="px-4 py-3 text-right"><Delta current={month.totalUsageGb} previous={data.months[index - 1]?.totalUsageGb ?? 0} unit=" GB" /></td><td className="px-4 py-3 text-right"><Delta current={month.totalFileCount} previous={data.months[index - 1]?.totalFileCount ?? 0} /></td></tr>)}</tbody></table></div></section>
      <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"><div className="border-b border-[var(--color-border)] p-5"><h2 className="font-semibold text-[var(--color-text)]">Latest month detail</h2><p className="mt-1 text-xs text-[var(--color-subtle)]">Cluster and workflow folder usage for {current?.label || 'the latest month'}.</p></div><div className="overflow-x-auto"><table className="min-w-[720px] w-full text-sm"><thead className="bg-[var(--color-hover)] text-left text-[var(--color-muted)]"><tr><th className="px-4 py-3 font-medium">No.</th><th className="px-4 py-3 font-medium">Cluster</th><th className="px-4 py-3 font-medium">Workflow folder</th><th className="px-4 py-3 text-right font-medium">Usage</th><th className="px-4 py-3 text-right font-medium">Files</th></tr></thead><tbody className="divide-y divide-[var(--color-border)]">{(current?.folders ?? []).map((folder, index) => <tr key={folder.folderId || `${folder.cluster}-${folder.workflowFolder}`}><td className="px-4 py-3 text-[var(--color-muted)]">{index + 1}</td><td className="px-4 py-3 break-words text-[var(--color-text)]">{folder.cluster}</td><td className="px-4 py-3 break-words text-[var(--color-text-soft)]">{folder.workflowFolder}</td><td className="px-4 py-3 text-right font-mono text-[var(--color-text-soft)]">{usage(folder.usageGb)}</td><td className="px-4 py-3 text-right font-mono text-[var(--color-text-soft)]">{fmt(folder.fileCount)}</td></tr>)}{(current?.folders ?? []).length === 0 && <tr><td colSpan={5} className="px-4 py-12 text-center text-[var(--color-subtle)]">No folder detail is available for this month.</td></tr>}</tbody></table></div></section>
    </>}
  </div>;
}

function Metric({ label, value, icon: Icon, tone }: { label: string; value: React.ReactNode; icon: typeof Database; tone: string }) { return <article className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-sm text-[var(--color-muted)]">{label}</p><div className="mt-2 font-mono text-2xl font-bold text-[var(--color-text)]">{value}</div><p className="mt-2 text-xs text-[var(--color-subtle)]">{label === 'Usage change' ? 'Versus prior month' : 'Most recent report'}</p></div><span className={`rounded-xl p-3 ${tone}`}><Icon className="h-5 w-5" /></span></div></article>; }
function Chart({ title, data, dataKey, color, suffix }: { title: string; data: { period: string; usageGb: number; fileCount: number }[]; dataKey: 'usageGb' | 'fileCount'; color: string; suffix: string }) { return <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"><h2 className="text-base font-semibold text-[var(--color-text)]">{title}</h2><p className="mt-1 text-xs text-[var(--color-subtle)]">Latest selected reporting periods</p><div className="mt-5 h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" opacity={0.5} /><XAxis dataKey="period" stroke="var(--color-muted)" fontSize={12} /><YAxis stroke="var(--color-muted)" fontSize={12} /><Tooltip formatter={(value) => [`${fmt(Number(value))} ${suffix}`, title]} contentStyle={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '12px', color: 'var(--color-text)' }} /><Bar dataKey={dataKey} fill={color} radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></section>; }
