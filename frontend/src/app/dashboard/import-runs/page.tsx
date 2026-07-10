'use client';

import { useEffect, useState, useCallback, Fragment } from 'react';
import { api } from '@/lib/api';
import { UploadCloud, ChevronDown, ChevronUp, FolderX } from 'lucide-react';

interface ImportRun {
  id: string;
  createdAt: string;
  uploadedBy: string;
  fileName: string;
  custId: string;
  month: string;
  year: string;
  matchedCount: number;
  unmatchedCount: number;
  insertedCount: number;
  skippedCount: number;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
}

interface UnmatchedDir {
  id: string;
  directoryPath: string;
  sizeGb: number;
  fileCount: number;
  status: string;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    SUCCESS: 'bg-green-600/20 text-green-400 border-green-600/30',
    PARTIAL: 'bg-amber-600/20 text-[var(--color-amber-text)] border-amber-600/30',
    FAILED: 'bg-red-600/20 text-[var(--color-red-text)] border-red-600/30',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
        colors[status] || 'bg-zinc-600/20 text-[var(--color-muted)] border-zinc-600/30'
      }`}
    >
      {status}
    </span>
  );
}

export default function ImportRunsPage() {
  const [runs, setRuns] = useState<ImportRun[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [expandedDirs, setExpandedDirs] = useState<Record<string, UnmatchedDir[]>>({});
  const [loadingDirs, setLoadingDirs] = useState<Record<string, boolean>>({});

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/import-runs', { params: { page, limit } });
      const body = res.data || {};
      const items: ImportRun[] = (body.data || []).map((r: Record<string, unknown>) => ({
        id: String(r.id ?? ''),
        createdAt: String(r.createdAt ?? ''),
        uploadedBy: String(r.uploadedBy ?? ''),
        fileName: String(r.fileName ?? ''),
        custId: String(r.custId ?? ''),
        month: String(r.month ?? ''),
        year: String(r.year ?? ''),
        matchedCount: Number(r.matchedCount ?? 0),
        unmatchedCount: Number(r.unmatchedCount ?? 0),
        insertedCount: Number(r.insertedCount ?? 0),
        skippedCount: Number(r.skippedCount ?? 0),
        status: (r.status as ImportRun['status']) || 'SUCCESS',
      }));
      setRuns(items);
      setTotal(Number((body.pagination as Record<string, unknown>)?.total ?? 0));
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'Failed to load import history');
    } finally {
      setLoading(false);
    }
  }, [page, limit]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const toggleExpand = async (runId: string) => {
    const isCurrentlyExpanded = expanded[runId];
    setExpanded((prev) => ({ ...prev, [runId]: !prev[runId] }));

    if (!isCurrentlyExpanded && !expandedDirs[runId]) {
      setLoadingDirs((prev) => ({ ...prev, [runId]: true }));
      try {
        const res = await api.get(`/import-runs/${runId}`);
        setExpandedDirs((prev) => ({ ...prev, [runId]: res.data.unmatchedDirs || [] }));
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingDirs((prev) => ({ ...prev, [runId]: false }));
      }
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const formatMonthName = (m: number | string) => {
    const n = typeof m === 'string' ? parseInt(m, 10) : m;
    if (!n || n < 1 || n > 12) return '-';
    return new Date(2020, n - 1).toLocaleString('en', { month: 'long' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Import History</h1>
          <p className="text-[var(--color-muted)] text-sm mt-1">Track all CSV report imports and their results</p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800/40 bg-red-900/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-amber-500 border-t-transparent" />
        </div>
      ) : (
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-hover)] text-[var(--color-muted)] text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">File Name</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Month/Year</th>
                  <th className="px-4 py-3 font-medium text-center">Matched</th>
                  <th className="px-4 py-3 font-medium text-center">Unmatched</th>
                  <th className="px-4 py-3 font-medium text-center">Inserted</th>
                  <th className="px-4 py-3 font-medium text-center">Skipped</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {runs.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center text-[var(--color-subtle)]">
                      No import runs found
                    </td>
                  </tr>
                )}
                {runs.map((run) => {
                  const hasUnmatched = (run.unmatchedCount ?? 0) > 0;
                  return (
                  <Fragment key={run.id}>
                  <tr
                    className={`hover:bg-[#1C2128] ${hasUnmatched ? 'cursor-pointer' : ''}`}
                    onClick={() => hasUnmatched && toggleExpand(run.id)}
                  >
                    <td className="px-4 py-3 text-[var(--color-text-soft)] text-xs font-mono">
                      {run.createdAt ? new Date(run.createdAt).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text)]">{run.uploadedBy || '-'}</td>
                    <td className="px-4 py-3 text-[var(--color-text-soft)] text-xs max-w-[160px] truncate">
                      {run.fileName || '-'}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text)]">{run.custId || '-'}</td>
                    <td className="px-4 py-3 text-[var(--color-muted)] text-xs">
                      {run.month && run.year ? `${formatMonthName(run.month)} ${run.year}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-teal-400">
                      {run.matchedCount ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-[var(--color-amber-text)]">
                      {run.unmatchedCount ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-green-400">
                      {run.insertedCount ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-[var(--color-subtle)]">
                      {run.skippedCount ?? '-'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="px-4 py-3">
                      {hasUnmatched && (
                        <button className="p-1 rounded hover:bg-[var(--color-hover)] text-[var(--color-subtle)] hover:text-[var(--color-text-soft)] transition-colors">
                          {expanded[run.id] ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded[run.id] && (
                    <tr key={`${run.id}-expanded`}>
                      <td colSpan={11} className="px-4 py-4 bg-[var(--color-bg)]">
                        <h4 className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider mb-3">
                          Unmatched Directories
                        </h4>
                        {loadingDirs[run.id] ? (
                          <div className="flex justify-center py-6">
                            <div className="animate-spin rounded-full h-5 w-5 border-2 border-amber-500 border-t-transparent" />
                          </div>
                        ) : expandedDirs[run.id] && expandedDirs[run.id].length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="text-[var(--color-subtle)] text-left border-b border-[var(--color-border)]">
                                <tr>
                                  <th className="py-1.5 font-medium">Directory Path</th>
                                  <th className="py-1.5 font-medium text-right">Size (GB)</th>
                                  <th className="py-1.5 font-medium text-center">Files</th>
                                  <th className="py-1.5 font-medium">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[var(--color-border)]">
                                {expandedDirs[run.id].map((d) => (
                                  <tr key={d.id}>
                                    <td className="py-2 text-[var(--color-text-soft)] font-mono max-w-lg truncate">
                                      {d.directoryPath}
                                    </td>
                                    <td className="py-2 text-right font-mono text-teal-400">
                                      {d.sizeGb?.toLocaleString() ?? '-'}
                                    </td>
                                    <td className="py-2 text-center font-mono text-[var(--color-muted)]">
                                      {d.fileCount?.toLocaleString() ?? '-'}
                                    </td>
                                    <td className="py-2">
                                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                                        d.status === 'RESOLVED'
                                          ? 'bg-green-600/20 text-green-400'
                                          : d.status === 'IGNORED'
                                          ? 'bg-zinc-600/20 text-[var(--color-subtle)]'
                                          : 'bg-amber-600/20 text-[var(--color-amber-text)]'
                                      }`}>
                                        {d.status}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-[var(--color-subtle)] text-sm flex items-center gap-2 py-4">
                            <FolderX className="w-4 h-4" />
                            No unmatched directories
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > limit && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)]">
              <span className="text-sm text-[var(--color-subtle)]">
                Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 rounded text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <span className="text-sm text-[var(--color-subtle)] px-2">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 rounded text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
