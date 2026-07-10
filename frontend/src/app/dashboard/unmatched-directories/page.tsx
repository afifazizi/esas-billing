'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { Link2Off, MapPin, EyeOff, CheckCircle2, AlertTriangle } from 'lucide-react';

interface UnmatchedDirectory {
  id: string;
  directoryPath: string;
  sizeGb: number;
  fileCount: number;
  importRunDate: string;
  status: 'PENDING' | 'RESOLVED' | 'IGNORED';
}

interface Folder {
  id: string;
  name: string;
  path: string;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PENDING: 'bg-amber-600/20 text-[var(--color-amber-text)] border-amber-600/30',
    RESOLVED: 'bg-green-600/20 text-green-400 border-green-600/30',
    IGNORED: 'bg-zinc-600/20 text-[var(--color-subtle)] border-zinc-600/30',
  };
  const icons: Record<string, React.ReactNode> = {
    PENDING: <AlertTriangle className="w-3 h-3" />,
    RESOLVED: <CheckCircle2 className="w-3 h-3" />,
    IGNORED: <EyeOff className="w-3 h-3" />,
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${
        colors[status] || 'bg-zinc-600/20 text-[var(--color-muted)] border-zinc-600/30'
      }`}
    >
      {icons[status]}
      {status}
    </span>
  );
}

export default function UnmatchedDirectoriesPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [dirs, setDirs] = useState<UnmatchedDirectory[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [mappingId, setMappingId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && user?.userRole !== 'admin') {
      router.push('/dashboard');
    }
  }, [user, authLoading, router]);

  const fetchDirs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter && statusFilter !== 'ALL') params.status = statusFilter;
      const res = await api.get('/unmatched-directories', { params });
      setDirs(res.data.data || res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const fetchFolders = useCallback(async () => {
    try {
      const res = await api.get('/folders');
      setFolders(res.data || []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    if (user?.userRole === 'admin') {
      fetchDirs();
      fetchFolders();
    }
  }, [user, fetchDirs, fetchFolders]);

  const handleMap = async (dirId: string) => {
    if (!selectedFolderId) {
      setActionMsg('Please select a folder');
      return;
    }
    setActionLoading(true);
    setActionMsg('');
    try {
      await api.put(`/unmatched-directories/${dirId}/map`, { folderId: selectedFolderId });
      setMappingId(null);
      setSelectedFolderId('');
      setActionMsg('Mapped successfully');
      fetchDirs();
    } catch (err: any) {
      setActionMsg(err.response?.data?.error || 'Mapping failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleIgnore = async (dirId: string) => {
    setActionLoading(true);
    setActionMsg('');
    try {
      await api.put(`/unmatched-directories/${dirId}/ignore`);
      setActionMsg('Marked as ignored');
      fetchDirs();
    } catch (err: any) {
      setActionMsg(err.response?.data?.error || 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  if (authLoading || user?.userRole !== 'admin') {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Unmatched Paths</h1>
          <p className="text-[var(--color-muted)] text-sm mt-1">
            Review and map unrecognized directories from imports
          </p>
        </div>
        <div className="flex items-center gap-1 px-2 py-1 rounded bg-amber-600/10 border border-amber-600/30">
          <Link2Off className="w-4 h-4 text-[var(--color-amber-text)]" />
          <span className="text-xs text-[var(--color-amber-text)] font-medium">Admin Only</span>
        </div>
      </div>

      {/* Action message */}
      {actionMsg && (
        <div
          className={`text-sm rounded-lg p-3 ${
            actionMsg.includes('success') || actionMsg.includes('successfully')
              ? 'bg-green-900/20 border border-green-800 text-green-400'
              : actionMsg.includes('failed')
              ? 'bg-red-900/20 border border-red-800 text-[var(--color-red-text)]'
              : 'bg-amber-900/20 border border-amber-800 text-[var(--color-amber-text)]'
          }`}
        >
          {actionMsg}
        </div>
      )}

      {/* Status Filter */}
      <div className="flex items-center gap-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-3">
        <span className="text-xs text-[var(--color-subtle)] font-medium uppercase tracking-wider mr-2">
          Status
        </span>
        {(['PENDING', 'RESOLVED', 'IGNORED', 'ALL'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded text-sm transition-colors ${
              statusFilter === s
                ? 'bg-amber-600 text-white'
                : 'bg-[var(--color-hover)] text-[var(--color-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {/* Table */}
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
                  <th className="px-4 py-3 font-medium">Directory Path</th>
                  <th className="px-4 py-3 font-medium text-right">Size (GB)</th>
                  <th className="px-4 py-3 font-medium text-center">File Count</th>
                  <th className="px-4 py-3 font-medium">Import Run Date</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {dirs.map((d) => (
                  <tr key={d.id} className="hover:bg-[#1C2128]">
                    <td className="px-4 py-3 text-[var(--color-text-soft)] font-mono text-xs max-w-md truncate">
                      {d.directoryPath}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-teal-400">
                      {d.sizeGb?.toLocaleString() ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-[var(--color-muted)]">
                      {d.fileCount?.toLocaleString() ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-muted)] text-xs">
                      {d.importRunDate
                        ? new Date(d.importRunDate).toLocaleDateString()
                        : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={d.status} />
                    </td>
                    <td className="px-4 py-3">
                      {d.status === 'PENDING' && (
                        <div className="flex items-center justify-center gap-2">
                          {/* Map to Folder */}
                          {mappingId === d.id ? (
                            <div className="flex items-center gap-2">
                              <select
                                value={selectedFolderId}
                                onChange={(e) => setSelectedFolderId(e.target.value)}
                                className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-text)] text-xs focus:border-amber-500 focus:outline-none"
                              >
                                <option value="">Select folder...</option>
                                {folders.map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={() => handleMap(d.id)}
                                disabled={actionLoading || !selectedFolderId}
                                className="px-2 py-1 rounded text-xs font-medium bg-teal-600 text-[var(--color-text)] hover:bg-teal-500 disabled:opacity-50 transition-colors"
                              >
                                {actionLoading ? '...' : 'Confirm'}
                              </button>
                              <button
                                onClick={() => { setMappingId(null); setSelectedFolderId(''); }}
                                className="text-xs text-[var(--color-subtle)] hover:text-[var(--color-text-soft)]"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <>
                              <button
                                onClick={() => { setMappingId(d.id); setSelectedFolderId(''); }}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-teal-600/20 text-teal-400 hover:bg-teal-600/30 border border-teal-600/30 transition-colors"
                              >
                                <MapPin className="w-3 h-3" />
                                Map to Folder
                              </button>
                              <button
                                onClick={() => handleIgnore(d.id)}
                                disabled={actionLoading}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-zinc-600/20 text-[var(--color-muted)] hover:bg-zinc-600/30 border border-zinc-600/30 transition-colors disabled:opacity-50"
                              >
                                <EyeOff className="w-3 h-3" />
                                Ignore
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {dirs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-[var(--color-subtle)]">
                      No unmatched directories found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
