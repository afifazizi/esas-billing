'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import { Shield, Search, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';

interface AuditUser {
  id: string;
  username: string;
  fullname: string;
}

interface AuditLog {
  id: string;
  userId: string;
  createdAt: string;
  user: AuditUser | null;
  action: string;
  entityType: string;
  entityId: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
}

const columnHelper = createColumnHelper<AuditLog>();

export default function AuditLogsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [actionFilter, setActionFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState('');

  // Unique values for filter dropdowns
  const [actions, setActions] = useState<string[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);

  useEffect(() => {
    if (!authLoading && user?.userRole !== 'admin') {
      router.push('/dashboard');
    }
  }, [user, authLoading, router]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit };
      if (actionFilter) params.action = actionFilter;
      if (userFilter) params.user = userFilter;
      if (entityTypeFilter) params.entityType = entityTypeFilter;
      const res = await api.get('/audit-logs', { params });
      setData(res.data.data);
      setTotal(res.data.pagination.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, limit, actionFilter, userFilter, entityTypeFilter]);

  const fetchFilterOptions = useCallback(async () => {
    try {
      const res = await api.get('/audit-logs/filters');
      setActions(res.data.actions || []);
      setUsers(res.data.users || []);
      setEntityTypes(res.data.entityTypes || []);
    } catch {
      // Filters endpoint may not exist yet—derive from existing data
    }
  }, []);

  useEffect(() => {
    if (user?.userRole === 'admin') {
      fetchLogs();
      fetchFilterOptions();
    }
  }, [user, fetchLogs, fetchFilterOptions]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const totalPages = Math.ceil(total / limit);

  const columns = [
    columnHelper.accessor('createdAt', {
      header: 'Timestamp',
      cell: (info) => (
        <span className="text-[var(--color-text-soft)] text-xs font-mono">
          {new Date(info.getValue()).toLocaleString()}
        </span>
      ),
    }),
    columnHelper.accessor((row) => row.user?.username || 'System', {
      id: 'user',
      header: 'User',
      cell: (info) => <span className="text-[var(--color-text)]">{info.getValue()}</span>,
    }),
    columnHelper.accessor('action', {
      header: 'Action',
      cell: (info) => (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-600/20 text-[var(--color-amber-text)]">
          {info.getValue()}
        </span>
      ),
    }),
    columnHelper.accessor('entityType', {
      header: 'Entity Type',
      cell: (info) => <span className="text-[var(--color-muted)] text-xs">{info.getValue()}</span>,
    }),
    columnHelper.accessor('entityId', {
      header: 'Entity ID',
      cell: (info) => {
        const value = info.getValue();
        return (
          <span className="text-[var(--color-subtle)] text-xs font-mono" title={value || undefined}>
            {value ? `${value.slice(0, 8)}…` : '-'}
          </span>
        );
      },
    }),
    columnHelper.accessor((row) => `${row.action.replaceAll('_', ' ')} ${row.entityType}`, {
      id: 'details',
      header: 'Details',
      cell: (info) => (
        <span className="text-[var(--color-muted)] text-xs max-w-[220px] truncate block">
          {info.getValue()}
        </span>
      ),
    }),
    columnHelper.display({
      id: 'expand',
      header: '',
      cell: ({ row }) => (
        <button
          onClick={() => toggleExpand(row.original.id)}
          className="p-1 rounded hover:bg-[var(--color-hover)] text-[var(--color-subtle)] hover:text-[var(--color-text-soft)] transition-colors"
        >
          {expanded[row.original.id] ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
      ),
    }),
  ];

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: totalPages,
    state: { pagination: { pageIndex: page - 1, pageSize: limit } },
  });

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
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Audit Trail</h1>
          <p className="text-[var(--color-muted)] text-sm mt-1">Monitor all system actions and changes</p>
        </div>
        <div className="flex items-center gap-1 px-2 py-1 rounded bg-amber-600/10 border border-amber-600/30">
          <Shield className="w-4 h-4 text-[var(--color-amber-text)]" />
          <span className="text-xs text-[var(--color-amber-text)] font-medium">Admin Only</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-[var(--color-subtle)]" />
          <span className="text-xs text-[var(--color-subtle)] font-medium uppercase tracking-wider">Filters</span>
        </div>
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-[var(--color-text)] text-sm focus:border-amber-500 focus:outline-none"
        >
          <option value="">All Actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
          {actions.length === 0 && (
            <>
              <option value="CREATE_CUSTOMER">CREATE_CUSTOMER</option>
              <option value="UPDATE_CUSTOMER">UPDATE_CUSTOMER</option>
              <option value="DELETE_CUSTOMER">DELETE_CUSTOMER</option>
              <option value="UPLOAD_REPORT">UPLOAD_REPORT</option>
              <option value="DELETE_REPORT">DELETE_REPORT</option>
              <option value="CREATE_USER">CREATE_USER</option>
              <option value="DELETE_USER">DELETE_USER</option>
              <option value="LOGIN">LOGIN</option>
              <option value="MAP_DIRECTORY">MAP_DIRECTORY</option>
              <option value="IGNORE_DIRECTORY">IGNORE_DIRECTORY</option>
            </>
          )}
        </select>
        <select
          value={userFilter}
          onChange={(e) => { setUserFilter(e.target.value); setPage(1); }}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-[var(--color-text)] text-sm focus:border-amber-500 focus:outline-none"
        >
          <option value="">All Users</option>
          {users.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
        <select
          value={entityTypeFilter}
          onChange={(e) => { setEntityTypeFilter(e.target.value); setPage(1); }}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-[var(--color-text)] text-sm focus:border-amber-500 focus:outline-none"
        >
          <option value="">All Entity Types</option>
          {entityTypes.map((et) => (
            <option key={et} value={et}>{et}</option>
          ))}
          {entityTypes.length === 0 && (
            <>
              <option value="customer">customer</option>
              <option value="report">report</option>
              <option value="user">user</option>
              <option value="unmatched_directory">unmatched_directory</option>
            </>
          )}
        </select>
        {(actionFilter || userFilter || entityTypeFilter) && (
          <button
            onClick={() => { setActionFilter(''); setUserFilter(''); setEntityTypeFilter(''); setPage(1); }}
            className="text-xs text-[var(--color-amber-text)] hover:text-[var(--color-amber-text)] transition-colors ml-2"
          >
            Clear Filters
          </button>
        )}
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
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th key={header.id} className="px-4 py-3 font-medium">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {table.getRowModel().rows.map((row) => (
                  <React.Fragment key={row.id}>
                    <tr
                      className="hover:bg-[#1C2128] cursor-pointer"
                      onClick={() => toggleExpand(row.original.id)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-4 py-3">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                    {expanded[row.original.id] && (
                      <tr>
                        <td colSpan={columns.length} className="px-4 py-4 bg-[var(--color-bg)]">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <h4 className="text-xs font-semibold text-[var(--color-subtle)] uppercase tracking-wider mb-2">
                                Old Value
                              </h4>
                              <pre className="text-xs text-[var(--color-red-text)] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md p-3 overflow-x-auto max-h-48">
                                {row.original.oldValue
                                  ? JSON.stringify(row.original.oldValue, null, 2)
                                  : 'null'}
                              </pre>
                            </div>
                            <div>
                              <h4 className="text-xs font-semibold text-[var(--color-subtle)] uppercase tracking-wider mb-2">
                                New Value
                              </h4>
                              <pre className="text-xs text-green-400 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md p-3 overflow-x-auto max-h-48">
                                {row.original.newValue
                                  ? JSON.stringify(row.original.newValue, null, 2)
                                  : 'null'}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                {data.length === 0 && (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-12 text-center text-[var(--color-subtle)]">
                      No audit logs found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > limit && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)]">
              <span className="text-sm text-[var(--color-subtle)]">
                Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-1.5 rounded hover:bg-[var(--color-hover)] text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => {
                    if (totalPages <= 7) return true;
                    if (p === 1 || p === totalPages) return true;
                    if (Math.abs(p - page) <= 1) return true;
                    return false;
                  })
                  .reduce<(number | '...')[]>((acc, p, i, arr) => {
                    if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...');
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, i) =>
                    p === '...' ? (
                      <span key={`dots-${i}`} className="text-[var(--color-faint)] px-1">...</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setPage(p)}
                        className={`w-8 h-8 rounded text-sm transition-colors ${
                          p === page
                            ? 'bg-amber-600 text-white'
                            : 'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'
                        }`}
                      >
                        {p}
                      </button>
                    )
                  )}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded hover:bg-[var(--color-hover)] text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
