'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { BarChart3, Search } from 'lucide-react';

interface Report {
  id: string;
  folder_name: string;
  folder_dir: string;
  department: string;
  customer: string;
  usage_gb: number;
  dir_count: number;
  file_count: number;
  month: string;
  year: string;
  file_name: string;
}

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  useEffect(() => {
    setLoading(true);
    const [y, m] = month.split('-');
    api.get('/reports', { params: { year: y, month: m } })
      .then(res => setReports(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [month]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Isilon Reports</h1>
          <p className="text-[var(--color-muted)] text-sm mt-1">View all uploaded Isilon storage reports</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={month.split('-')[1]} onChange={e => setMonth(`${month.split('-')[0]}-${e.target.value}`)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-[var(--color-text)] text-sm focus:border-amber-500 focus:outline-none">
            {['01','02','03','04','05','06','07','08','09','10','11','12'].map(m => (
              <option key={m} value={m}>{new Date(2020, parseInt(m)-1).toLocaleString('en', {month:'long'})}</option>
            ))}
          </select>
          <select value={month.split('-')[0]} onChange={e => setMonth(`${e.target.value}-${month.split('-')[1]}`)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-[var(--color-text)] text-sm focus:border-amber-500 focus:outline-none">
            {Array.from({length:5}, (_,i) => String(new Date().getFullYear() - i)).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-2 border-amber-500 border-t-transparent" /></div>
      ) : (
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-hover)] text-[var(--color-muted)] text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Department</th>
                  <th className="px-4 py-3 font-medium">Folder</th>
                  <th className="px-4 py-3 font-medium text-right">Usage (GB)</th>
                  <th className="px-4 py-3 font-medium text-center">Files</th>
                  <th className="px-4 py-3 font-medium">File Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {reports.map(r => (
                  <tr key={r.id} className="hover:bg-[#1C2128]">
                    <td className="px-4 py-3 text-[var(--color-text)]">{r.customer}</td>
                    <td className="px-4 py-3 text-[var(--color-text-soft)]">{r.department}</td>
                    <td className="px-4 py-3 text-[var(--color-text-soft)] font-mono text-xs max-w-xs truncate" title={r.folder_dir}>{r.folder_name}</td>
                    <td className="px-4 py-3 text-right font-mono text-teal-400">{r.usage_gb.toLocaleString()}</td>
                    <td className="px-4 py-3 text-center text-[var(--color-muted)]">{r.file_count.toLocaleString()}</td>
                    <td className="px-4 py-3 text-[var(--color-subtle)] text-xs">{r.file_name || '-'}</td>
                  </tr>
                ))}
                {reports.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-[var(--color-subtle)]">No reports for this month</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
