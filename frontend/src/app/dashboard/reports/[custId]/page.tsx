'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import * as XLSX from 'xlsx';
import Link from 'next/link';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Upload, Trash2, ChevronRight, FileDown, Printer, FileSearch, CheckCircle2, AlertTriangle, XCircle, ArrowLeft, ArrowRight, Loader2, FileText, ShieldCheck, RefreshCw } from 'lucide-react';

interface ReportMeta {
  status: 'DRAFT' | 'EMPTY' | string;
  rowCount: number;
  breakdownRowCount: number;
  pendingUnmatched: number;
  latestImport: {
    id: string;
    fileName: string;
    status: string;
    matchedCount: number;
    unmatchedCount: number;
    insertedCount: number;
    skippedCount: number;
    createdAt: string;
    uploadedBy: string;
  } | null;
  latestAvailable: { year: string; month: string; reportRows: number; totalUsageGb: number } | null;
}

interface ReportDetail {
  customer: { name: string; pricePerGb: number } | null;
  month: string;
  year: string;
  meta?: ReportMeta;
  isilon: { id: string; cluster: string; workflowFolder: string; sizeGb: number }[];
  totalUsageGb: number;
  workfolderSummary: { folderName: string; sizeGb: number }[];
  departmentalSummary: { deptName: string; sizeGb: number; sharePct?: number }[];
}

interface UploadPreviewRow {
  rowNumber?: number;
  directoryPath?: string;
  folderName?: string;
  department?: string;
  usageGb?: number;
  status?: 'matched' | 'unmatched' | 'duplicate' | 'skipped' | string;
  message?: string;
}

interface UploadPreview {
  previewId?: string;
  fileHash?: string;
  fileName: string;
  month: string;
  year: string;
  custId: string;
  matchedCount: number;
  unmatchedCount: number;
  skippedCount: number;
  duplicateCount: number;
  estimatedUsageGb: number;
  errors: string[];
  warnings: string[];
  rows: UploadPreviewRow[];
}


const monthLabel = (month: string, year: string) => new Date(Number(year), Number(month) - 1).toLocaleString('en', { month: 'long', year: 'numeric' });

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Not recorded';
  return new Date(value).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' });
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const getCount = (source: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
  }
  return 0;
};

const getStrings = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        return String(record.message || record.error || record.warning || JSON.stringify(item));
      }
      return String(item);
    });
  }
  if (typeof value === 'string') return [value];
  return [String(value)];
};

const normalizePreview = (raw: unknown, fallback: { fileName: string; month: string; year: string; custId: string }): UploadPreview => {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rowsSource = (data.rows || data.previewRows || data.matchedRows || data.items || []) as unknown;
  const rows = Array.isArray(rowsSource) ? rowsSource.slice(0, 100).map((item) => item as UploadPreviewRow) : [];
  const estimatedUsageBytes = getCount(data, ['estimatedUsageBytes', 'estimated_usage_bytes', 'usageBytes', 'totalBytes']);
  return {
    previewId: typeof data.previewId === 'string' ? data.previewId : typeof data.importRunId === 'string' ? data.importRunId : typeof data.token === 'string' ? data.token : undefined,
    fileHash: typeof data.fileHash === 'string' ? data.fileHash : undefined,
    fileName: String(data.fileName || data.file_name || fallback.fileName),
    month: String(data.month || fallback.month),
    year: String(data.year || fallback.year),
    custId: String(data.custId || data.cust_id || data.paramCustID || fallback.custId),
    matchedCount: getCount(data, ['matchedCount', 'matched_count', 'matched', 'processed', 'validRows']),
    unmatchedCount: getCount(data, ['unmatchedCount', 'unmatched_count', 'unmatched']),
    skippedCount: getCount(data, ['skippedCount', 'skipped_count', 'skipped']),
    duplicateCount: getCount(data, ['duplicateCount', 'duplicate_count', 'duplicates']),
    estimatedUsageGb: getCount(data, ['estimatedUsageGb', 'estimated_usage_gb', 'totalUsageGb', 'usageGb']) || (estimatedUsageBytes ? estimatedUsageBytes / 1073741824 : 0),
    errors: [...getStrings(data.errors), ...getStrings(data.validationErrors)],
    warnings: [...getStrings(data.warnings), ...getStrings(data.duplicateWarnings), ...getStrings(data.skippedWarnings)],
    rows,
  };
};

export default function ReportDetailPage() {
  const { custId } = useParams<{ custId: string }>();
  const searchParams = useSearchParams();
  const queryMonth = searchParams.get('month');
  const queryYear = searchParams.get('year');
  const hasExplicitPeriodParams = searchParams.has('month') || searchParams.has('year');
  const queryPeriod = queryYear && queryMonth && /^\d{4}$/.test(queryYear) && /^(0[1-9]|1[0-2])$/.test(queryMonth)
    ? `${queryYear}-${queryMonth}`
    : null;
  const [data, setData] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => {
    if (queryPeriod) return queryPeriod;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [uploadSummary, setUploadSummary] = useState<{ inserted: number; skipped: number; unmatched: number } | null>(null);
  const [uploadStep, setUploadStep] = useState<1 | 2 | 3>(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedPriceId, setSelectedPriceId] = useState('');
  const [priceOptions, setPriceOptions] = useState<{ id: string; label: string | null; price: number; isDefault: boolean }[]>([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [repricing, setRepricing] = useState(false);
  const [showPriceTierSelector, setShowPriceTierSelector] = useState(false);
  const [repriceTiers, setRepriceTiers] = useState<{ id: string; label: string | null; price: number; isDefault: boolean }[]>([]);
  const [selectedRepriceTier, setSelectedRepriceTier] = useState('');
  const [repriceMsg, setRepriceMsg] = useState('');

  const setReportPeriod = (period: string) => {
    setMonth(period);
  };

  const fetchDetail = async () => {
    setLoading(true);
    let switchingToLatest = false;
    const [y, m] = month.split('-');
    try {
      const res = await api.get('/analytics/report-detail', { params: { cust_id: custId, month: m, year: y } });
      const detail = res.data as ReportDetail;
      const latestAvailable = detail.meta?.latestAvailable;
      const latestPeriod = latestAvailable ? `${latestAvailable.year}-${latestAvailable.month}` : null;

      if (!hasExplicitPeriodParams && detail.meta?.status === 'EMPTY' && latestPeriod && latestPeriod !== month) {
        switchingToLatest = true;
        setReportPeriod(latestPeriod);
        return;
      }

      setData(detail);
    } catch (e) {
      console.error(e);
    } finally {
      if (!switchingToLatest) setLoading(false);
    }
  };

  useEffect(() => {
    if (queryPeriod && queryPeriod !== month) setMonth(queryPeriod);
  }, [queryPeriod]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchDetail(); }, [month, custId]); // eslint-disable-line

  const resetUploadWizard = () => {
    setUploadStep(1);
    setSelectedFile(null);
    setPreview(null);
    setUploadMsg('');
    setUploading(false);
    setConfirming(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const openUploadModal = () => {
    resetUploadWizard();
    setShowUploadModal(true);
    // Fetch price tiers for this customer
    api.get(`/customers/${custId}/prices`).then(res => {
      setPriceOptions(res.data || []);
      const def = (res.data || []).find((p: any) => p.isDefault);
      setSelectedPriceId(def?.id || (res.data?.[0]?.id || ''));
    }).catch(() => setPriceOptions([]));
  };

  const closeUploadModal = () => {
    setShowUploadModal(false);
    resetUploadWizard();
  };

  const handlePreviewUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    const file = selectedFile || fileRef.current?.files?.[0];
    if (!file) { setUploadMsg('Choose a CSV file before previewing.'); return; }
    if (!file.name.toLowerCase().endsWith('.csv')) { setUploadMsg('Only CSV files are allowed'); return; }

    setUploading(true);
    setUploadMsg('');
    const [y, m] = month.split('-');
    const formData = new FormData();
    formData.append('file_name', file);
    formData.append('reportDate', month);
    formData.append('paramCustID', custId);
    formData.append('month', m);
    formData.append('year', y);
    formData.append('custId', custId);
    if (selectedPriceId) formData.append('priceId', selectedPriceId);

    try {
      const res = await api.post('/reports/upload/preview', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setPreview(normalizePreview(res.data, { fileName: file.name, month: m, year: y, custId }));
      setUploadStep(2);
    } catch (err: any) {
      setUploadMsg(err.response?.data?.error || err.response?.data?.message || 'Preview failed. Confirm the backend /reports/upload/preview endpoint is available.');
      setPreview(null);
    } finally {
      setUploading(false);
    }
  };

  const handleConfirmUpload = async () => {
    if (!preview || preview.errors.length > 0) return;
    setConfirming(true);
    setUploadMsg('');
    try {
      const res = await api.post('/reports/upload/confirm', {
        previewId: preview.previewId,
        fileHash: preview.fileHash,
        fileName: preview.fileName,
        reportDate: `${preview.year}-${preview.month}`,
        month: preview.month,
        year: preview.year,
        custId: preview.custId,
        paramCustID: preview.custId,
      });
      const responseData = (res.data || {}) as Record<string, unknown>;
      const inserted = getCount(responseData, ['inserted', 'insertedCount', 'processed', 'matchedCount']) || preview.matchedCount;
      const skipped = getCount(responseData, ['skipped', 'skippedCount']) || preview.skippedCount || preview.duplicateCount;
      const unmatched = getCount(responseData, ['unmatched', 'unmatchedCount']) || preview.unmatchedCount;
      setUploadSummary({ inserted, skipped, unmatched });
      setUploadStep(3);
      fetchDetail();
    } catch (err: any) {
      setUploadMsg(err.response?.data?.error || err.response?.data?.message || 'Confirm import failed');
    } finally {
      setConfirming(false);
    }
  };

  const handleDelete = async (reportId: string) => {
    if (!confirm('Soft-delete this report?')) return;
    try {
      await api.delete(`/reports/${reportId}`);
      fetchDetail();
    } catch (err: any) { alert(err.response?.data?.error || 'Delete failed'); }
  };

  const handleDownloadPdf = async () => {
    const [y, m] = month.split('-');
    try {
      const res = await api.get('/export/pdf', {
        params: { cust_id: custId, month: m, year: y },
        responseType: 'blob',
      });
      downloadBlob(new Blob([res.data], { type: 'application/pdf' }), `esas-report-${custId}-${y}-${m}.pdf`);
    } catch (e) { console.error(e); alert('PDF download failed'); }
  };

  const handleExportExcel = async () => {
    const [y, m] = month.split('-');
    try {
      const res = await api.get('/export/excel', { params: { cust_id: custId, month: m, year: y } });
      const workbook = XLSX.utils.book_new();
      Object.values(res.data.sheets || {}).forEach((sheet: any) => {
        const rows = [sheet.headers || [], ...(sheet.rows || [])];
        const worksheet = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(workbook, worksheet, String(sheet.name || 'Sheet').slice(0, 31));
      });
      XLSX.writeFile(workbook, `esas-report-${custId}-${y}-${m}.xlsx`);
    } catch (e) { console.error(e); alert('Excel export failed'); }
  };

  const handlePrint = () => { window.print(); };

  const fetchRepriceTiers = async () => {
    try {
      const res = await api.get(`/customers/${custId}/prices`);
      const tiers = res.data || [];
      setRepriceTiers(tiers);
      const currentPrice = data?.customer?.pricePerGb;
      const match = tiers.find((p: any) => p.price === currentPrice);
      setSelectedRepriceTier(match?.id || (tiers[0]?.id || ''));
      setShowPriceTierSelector(true);
      setRepriceMsg('');
    } catch {
      setRepriceMsg('Failed to load price tiers');
      setRepriceTiers([]);
    }
  };

  const handleReprice = async () => {
    if (!selectedRepriceTier) return;
    if (!custId || typeof custId !== 'string' || custId.trim() === '') {
      setRepriceMsg('Customer ID is missing — please reload the page.');
      return;
    }
    setRepricing(true);
    setRepriceMsg('');
    const [y, m] = month.split('-');
    try {
      const res = await api.put('/reports/reprice', {
        custId,
        month: m,
        year: y,
        priceId: selectedRepriceTier,
      });
      const d = res.data || {};
      setRepriceMsg(`Repriced ${d.updatedCount || d.count || 0} rows at RM ${(d.price || 0).toFixed(4)}/GB.`);
      setShowPriceTierSelector(false);
      fetchDetail();
    } catch (err: any) {
      setRepriceMsg(err.response?.data?.error || 'Reprice failed');
    } finally {
      setRepricing(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-2 border-amber-500 border-t-transparent" /></div>;
  }

  const [y, m] = month.split('-');

  return (
    <div className="space-y-6">
      {/* Breadcrumb + Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-[var(--color-subtle)] mb-1">
            <Link href="/dashboard/customers" className="hover:text-[var(--color-text-soft)]">Customer Management</Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-[var(--color-text-soft)]">ESAS Report</span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">{data?.customer?.name || custId}</h1>
        </div>
        <div className="flex items-center gap-3">
          <select value={month.split('-')[1]} onChange={e => setReportPeriod(`${month.split('-')[0]}-${e.target.value}`)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-[var(--color-text)] text-sm focus:border-amber-500 focus:outline-none">
            {['01','02','03','04','05','06','07','08','09','10','11','12'].map(m => (
              <option key={m} value={m}>{new Date(2020, parseInt(m)-1).toLocaleString('en', {month:'long'})}</option>
            ))}
          </select>
          <select value={month.split('-')[0]} onChange={e => setReportPeriod(`${e.target.value}-${month.split('-')[1]}`)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-[var(--color-text)] text-sm focus:border-amber-500 focus:outline-none">
            {Array.from({length:5}, (_,i) => String(new Date().getFullYear() - i)).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button onClick={openUploadModal}
            className="flex items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-[var(--color-text)] hover:bg-teal-500 transition-colors">
            <Upload className="w-4 h-4" /> Upload Report
          </button>
          <button onClick={handleDownloadPdf}
            className="flex items-center gap-2 rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-500 transition-colors">
            <FileText className="w-4 h-4" /> Download PDF
          </button>
          <button onClick={handleExportExcel}
            className="flex items-center gap-2 rounded-md bg-[var(--color-hover)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-soft)] hover:text-[var(--color-text)] transition-colors">
            <FileDown className="w-4 h-4" /> Export Excel
          </button>
          <button onClick={handlePrint}
            className="flex items-center gap-2 rounded-md bg-[var(--color-hover)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-soft)] hover:text-[var(--color-text)] transition-colors">
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-gradient-to-br from-[var(--color-surface)] to-[var(--color-bg)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${data?.meta?.status === 'DRAFT' ? 'border-amber-700 bg-amber-900/20 text-[var(--color-amber-text)]' : 'border-zinc-700 bg-zinc-800/60 text-[var(--color-muted)]'}`}>
                {data?.meta?.status || ((data?.isilon?.length || 0) > 0 ? 'DRAFT' : 'EMPTY')}
              </span>
              <span className="text-sm text-[var(--color-muted)]">{monthLabel(m, y)} report package</span>
            </div>
            <h2 className="mt-3 text-lg font-semibold text-[var(--color-text)]">Customer-facing ESAS report</h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              {data?.meta?.latestImport
                ? `Last import: ${data.meta.latestImport.fileName} by ${data.meta.latestImport.uploadedBy} on ${formatDateTime(data.meta.latestImport.createdAt)}.`
                : 'No import run is recorded for this report period.'}
            </p>
          </div>
          <div className="grid min-w-[300px] gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
              <p className="text-xs text-[var(--color-subtle)]">Report Rows</p>
              <p className="mt-1 font-mono text-lg text-[var(--color-text)]">{data?.meta?.rowCount ?? data?.isilon?.length ?? 0}</p>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
              <p className="text-xs text-[var(--color-subtle)]">Pending Unmatched</p>
              <p className={`mt-1 font-mono text-lg ${(data?.meta?.pendingUnmatched || 0) > 0 ? 'text-[var(--color-amber-text)]' : 'text-[var(--color-green-text)]'}`}>{data?.meta?.pendingUnmatched ?? 0}</p>
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="flex items-center gap-3 rounded-lg border border-green-800/40 bg-green-900/10 p-3 text-sm text-[var(--color-green-text)]">
            <ShieldCheck className="h-4 w-4 text-[var(--color-green-text)]" />
            Matched report rows: {(data?.meta?.rowCount ?? data?.isilon?.length ?? 0).toLocaleString()}
          </div>
          <div className={`flex items-center gap-3 rounded-lg border p-3 text-sm ${(data?.meta?.pendingUnmatched || 0) > 0 ? 'border-amber-800/50 bg-amber-900/10 text-[var(--color-amber-text)]' : 'border-green-800/40 bg-green-900/10 text-[var(--color-green-text)]'}`}>
            <AlertTriangle className="h-4 w-4" />
            {(data?.meta?.pendingUnmatched || 0) > 0 ? `${data?.meta?.pendingUnmatched} unmatched paths require review` : 'No pending unmatched paths'}
          </div>
        </div>
      </div>

      {uploadSummary && (
        <div className="bg-green-900/20 border border-green-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="shrink-0 mt-0.5">
              <div className="w-6 h-6 rounded-full bg-green-600/20 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[var(--color-green-text)] font-medium">
                Import complete: {uploadSummary.inserted} inserted, {uploadSummary.skipped} skipped (duplicates)
                {uploadSummary.unmatched > 0 && (
                  <>, {uploadSummary.unmatched} unmatched paths</>
                )}
              </p>
              {uploadSummary.unmatched > 0 && (
                <Link
                  href="/dashboard/unmatched-directories?status=PENDING"
                  className="text-xs text-[var(--color-amber-text)] hover:text-[var(--color-amber-text)] underline mt-1 inline-block"
                >
                  Review unmatched paths →
                </Link>
              )}
            </div>
            <button
              onClick={() => setUploadSummary(null)}
              className="text-[var(--color-subtle)] hover:text-[var(--color-text-soft)] shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
          <p className="text-sm text-[var(--color-muted)]">Usage Size (GB)</p>
          <p className="text-2xl font-bold text-[var(--color-text)] font-mono mt-1">{data?.totalUsageGb?.toLocaleString() || 0}</p>
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--color-muted)]">Price per GB (RM)</p>
            <button onClick={fetchRepriceTiers} title="Change price tier"
              className="p-1 rounded hover:bg-[var(--color-hover)] text-[var(--color-muted)] hover:text-[var(--color-amber-text)] transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-2xl font-bold text-[var(--color-amber-text)] font-mono mt-1">{data?.customer?.pricePerGb || 0}</p>
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
          <p className="text-sm text-[var(--color-muted)]">Total Revenue (RM)</p>
          <p className="text-2xl font-bold text-green-400 font-mono mt-1">
            {Math.round((data?.totalUsageGb || 0) * (data?.customer?.pricePerGb || 0) * 100) / 100}
          </p>
        </div>
      </div>

      {/* Inline Price Tier Selector */}
      {showPriceTierSelector && (
        <div className="rounded-lg border border-amber-800/50 bg-[var(--color-surface)] p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-[var(--color-muted)] mb-1">Current tier: RM {data?.customer?.pricePerGb || 0}/GB</label>
              <select value={selectedRepriceTier} onChange={e => setSelectedRepriceTier(e.target.value)}
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] text-sm focus:border-amber-500 focus:outline-none">
                {repriceTiers.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.label || 'Unnamed tier'} — RM {p.price.toFixed(4)}/GB{p.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleReprice} disabled={repricing || !selectedRepriceTier}
                className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50 transition-colors">
                {repricing ? 'Applying...' : 'Apply'}
              </button>
              <button onClick={() => { setShowPriceTierSelector(false); setRepriceMsg(''); }}
                className="rounded-md px-3 py-2 text-sm text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]">
                Cancel
              </button>
            </div>
          </div>
          {repriceMsg && (
            <p className={`mt-3 text-sm ${repriceMsg.toLowerCase().includes('failed') ? 'text-[var(--color-red-text)]' : 'text-[var(--color-green-text)]'}`}>
              {repriceMsg}
            </p>
          )}
        </div>
      )}


      {data && data.isilon.length === 0 && (
        <div className="rounded-xl border border-amber-800/50 bg-amber-900/10 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--color-amber-text)]"><AlertTriangle className="h-5 w-5" /> No report uploaded for {data.customer?.name || custId} — {monthLabel(m, y)}</h3>
              <p className="mt-2 text-sm text-[var(--color-text-soft)]">Upload an Isilon CSV for this period, or jump to the latest month with available report data.</p>
              {data.meta?.latestAvailable && (
                <p className="mt-2 text-sm text-[var(--color-text-soft)]">Latest available: <span className="font-semibold text-[var(--color-text)]">{monthLabel(data.meta.latestAvailable.month, data.meta.latestAvailable.year)}</span> · {data.meta.latestAvailable.reportRows} rows · {data.meta.latestAvailable.totalUsageGb.toLocaleString()} GB</p>
              )}
            </div>
            <div className="flex gap-3">
              {data.meta?.latestAvailable && (
                <button onClick={() => setReportPeriod(`${data.meta!.latestAvailable!.year}-${data.meta!.latestAvailable!.month}`)} className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500">Open latest report</button>
              )}
              <button onClick={openUploadModal} className="rounded-md border border-amber-700 px-4 py-2 text-sm font-semibold text-[var(--color-amber-text)] hover:bg-amber-900/20">Upload Isilon Report</button>
            </div>
          </div>
        </div>
      )}

      {/* 1. Isilon Report Table */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">1. Isilon Report</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[var(--color-muted)] text-left border-b border-[var(--color-border)]">
              <tr>
                <th className="px-4 py-2 font-medium">No</th>
                <th className="px-4 py-2 font-medium">Cluster</th>
                <th className="px-4 py-2 font-medium">Workflow Folder</th>
                <th className="px-4 py-2 font-medium text-right">Size (GB)</th>
                <th className="px-4 py-2 font-medium text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {data?.isilon.map((r, i) => (
                <tr key={r.id} className="hover:bg-[#1C2128]">
                  <td className="px-4 py-2 text-[var(--color-muted)]">{i + 1}</td>
                  <td className="px-4 py-2 text-[var(--color-text-soft)]">{r.cluster}</td>
                  <td className="px-4 py-2 text-[var(--color-text)]">{r.workflowFolder}</td>
                  <td className="px-4 py-2 text-right font-mono text-teal-400">{r.sizeGb.toLocaleString()}</td>
                  <td className="px-4 py-2 text-center">
                    <button onClick={() => handleDelete(r.id)} className="p-1 rounded hover:bg-red-600/20 text-[var(--color-red-text)]"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
              {(!data?.isilon || data.isilon.length === 0) && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--color-subtle)]">No Data</td></tr>
              )}
              {data?.isilon && data.isilon.length > 0 && (
                <tr className="bg-[var(--color-hover)]">
                  <td colSpan={3} className="px-4 py-2 text-center font-semibold text-[var(--color-text)]">Total</td>
                  <td className="px-4 py-2 text-right font-mono font-bold text-[var(--color-text)]">{data.totalUsageGb.toLocaleString()}</td>
                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. Workfolder Summary */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-5">
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">2.1 Workfolder Summary</h3>
        <p className="text-xs text-[var(--color-subtle)] mb-4">Storage usage by workflow folder (GB)</p>
        {data?.workfolderSummary && data.workfolderSummary.length > 0 ? (
          <ResponsiveContainer width="100%" height={Math.max(300, data.workfolderSummary.length * 32)}>
            <BarChart data={data.workfolderSummary} layout="vertical" margin={{ top: 5, right: 60, left: 10, bottom: 5 }} barSize={18} barGap={4}>
              <defs>
                <linearGradient id="wfGradient" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#1a6b3c" />
                  <stop offset="100%" stopColor="#39D353" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
              <XAxis type="number" stroke="#484F58" fontSize={12} tickFormatter={v => `${(v/1024).toFixed(1)}TB`} />
              <YAxis type="category" dataKey="folderName" stroke="var(--color-muted)" fontSize={12} width={180} tick={{ fill: '#C9D1D9' }} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', color: 'var(--color-text)', fontSize: 13 }}
                formatter={(value) => [`${Number(value).toLocaleString()} GB`, 'Usage']}
                labelStyle={{ color: '#8B949E', marginBottom: 4 }}
              />
              <Bar dataKey="sizeGb" fill="url(#wfGradient)" radius={[0, 6, 6, 0]}
                label={({ value }) => `${Number(value).toLocaleString()} GB`}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : <p className="text-[var(--color-subtle)] text-center py-12">No data available</p>}
      </div>

      {/* 3. Cluster Summary */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-5">
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">2.2 Cluster Summary</h3>
        <p className="text-xs text-[var(--color-subtle)] mb-4">Storage usage by cluster</p>
        {data?.departmentalSummary && data.departmentalSummary.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-3">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.departmentalSummary} barSize={40}>
                  <defs>
                    <linearGradient id="deptGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f0a500" />
                      <stop offset="100%" stopColor="#D2991D" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="deptName" stroke="var(--color-muted)" fontSize={12} tick={{ fill: '#C9D1D9' }} />
                  <YAxis stroke="#484F58" fontSize={12} tickFormatter={v => `${(v/1024).toFixed(1)}TB`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', color: 'var(--color-text)', fontSize: 13 }}
                    formatter={(value) => [`${Number(value).toLocaleString()} GB`, 'Usage']}
                  />
                  <Bar dataKey="sizeGb" fill="url(#deptGradient)" radius={[6, 6, 0, 0]}
                    label={({ value }) => `${(Number(value)/1024).toFixed(1)}TB`}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="lg:col-span-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[var(--color-muted)] text-left"><tr><th className="py-1 font-medium">Cluster</th><th className="py-1 font-medium text-right">Size (GB)</th><th className="py-1 font-medium text-right">Share</th></tr></thead>
                <tbody>
                  {data.departmentalSummary.map(d => (
                    <tr key={d.deptName} className="border-t border-[var(--color-border)]">
                      <td className="py-2 text-[var(--color-text)]">{d.deptName}</td>
                      <td className="py-2 text-right font-mono text-teal-400">{d.sizeGb.toLocaleString()}</td>
                      <td className="py-2 text-right font-mono text-[var(--color-text-soft)]">{typeof d.sharePct === 'number' ? `${d.sharePct}%` : `${Math.round((d.sizeGb / (data.totalUsageGb || 1)) * 10000) / 100}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : <p className="text-[var(--color-subtle)] text-center py-8">No data</p>}
      </div>



      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={closeUploadModal}>
          <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-[var(--color-border)] bg-[var(--color-bg)] px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-[var(--color-text)]">
                    Upload Isilon Report
                  </h3>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">
                    Preview the parsed CSV, review warnings, then confirm the import.
                  </p>
                </div>
                <button onClick={closeUploadModal} className="rounded-md p-1 text-[var(--color-subtle)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]">
                  <XCircle className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                {[1, 2, 3].map((step) => (
                  <div key={step} className="flex items-center gap-2">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold ${uploadStep >= step ? 'border-amber-500 bg-amber-600/20 text-[var(--color-amber-text)]' : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-subtle)]'}`}>
                      {uploadStep > step ? <CheckCircle2 className="h-4 w-4" /> : step}
                    </div>
                    <span className={`text-sm ${uploadStep >= step ? 'text-[var(--color-text-soft)]' : 'text-[var(--color-subtle)]'}`}>
                      {step === 1 ? 'Upload CSV' : step === 2 ? 'Preview Results' : 'Confirm Import'}
                    </span>
                    {step < 3 && <div className="h-px w-10 bg-[var(--color-border)]" />}
                  </div>
                ))}
              </div>
            </div>

            <div className="max-h-[calc(92vh-142px)] overflow-y-auto p-6">
              <div className="space-y-5">
                  {uploadStep === 1 && (
                    <form onSubmit={handlePreviewUpload} className="space-y-5">
                      <div className="grid gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4 md:grid-cols-3">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-[var(--color-subtle)]">Customer</p>
                          <p className="mt-1 text-sm font-medium text-[var(--color-text)]">{data?.customer?.name || custId}</p>
                          <p className="mt-1 font-mono text-xs text-[var(--color-subtle)]">{custId}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-[var(--color-subtle)]">Report Period</p>
                          <p className="mt-1 text-sm font-medium text-[var(--color-text)]">{new Date(Number(y), Number(m) - 1).toLocaleString('en', { month: 'long', year: 'numeric' })}</p>
                          <p className="mt-1 text-xs text-[var(--color-subtle)]">Change month/year from the report page controls.</p>
                        </div>
                        <label className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors hover:border-amber-500/60">
                          <span className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]"><Upload className="h-4 w-4 text-[var(--color-amber-text)]" /> CSV File</span>
                          <input ref={fileRef} type="file" accept=".csv" onChange={(event) => { setSelectedFile(event.target.files?.[0] || null); setUploadMsg(''); }} className="mt-3 w-full text-sm text-[var(--color-text-soft)] file:mr-3 file:rounded file:border-0 file:bg-[var(--color-hover)] file:px-3 file:py-1.5 file:text-sm file:text-[var(--color-text-soft)] hover:file:bg-[var(--color-border)]" required />
                          <span className="mt-2 block text-xs text-[var(--color-subtle)]">{selectedFile ? selectedFile.name : 'Select an Isilon CSV to preview before importing.'}</span>
                        </label>
                      </div>
                      {priceOptions.length > 0 && (
                        <div>
                          <label className="block text-sm text-[var(--color-muted)] mb-1">Price Tier</label>
                          <select value={selectedPriceId} onChange={e => setSelectedPriceId(e.target.value)}
                            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] text-sm focus:border-amber-500 focus:outline-none">
                            {priceOptions.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.label || 'Unnamed tier'} — RM {p.price.toFixed(4)}/GB{p.isDefault ? ' (default)' : ''}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-xs text-[var(--color-subtle)]">Select which price tier to apply to this import.</p>
                        </div>
                      )}
                      {uploadMsg && <div className="rounded-md border border-red-800 bg-red-900/20 p-3 text-sm text-[var(--color-red-text)]">{uploadMsg}</div>}
                      <div className="flex justify-end gap-3">
                        <button type="button" onClick={closeUploadModal} className="rounded-md px-4 py-2 text-sm text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]">Cancel</button>
                        <button type="submit" disabled={uploading || !selectedFile} className="flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50">
                          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
                          {uploading ? 'Generating preview...' : 'Preview CSV'}
                        </button>
                      </div>
                    </form>
                  )}

                  {uploadStep === 2 && preview && (
                    <div className="space-y-5">
                      <div className="grid gap-3 md:grid-cols-5">
                        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4 md:col-span-2">
                          <p className="text-xs uppercase tracking-wide text-[var(--color-subtle)]">File</p>
                          <p className="mt-1 break-all text-sm font-medium text-[var(--color-text)]">{preview.fileName}</p>
                          <p className="mt-2 text-xs text-[var(--color-subtle)]">{new Date(Number(preview.year), Number(preview.month) - 1).toLocaleString('en', { month: 'long', year: 'numeric' })}</p>
                        </div>
                        <div className="rounded-lg border border-teal-800/50 bg-teal-900/10 p-4">
                          <p className="text-xs text-[var(--color-teal-text)]">Matched</p>
                          <p className="mt-1 text-2xl font-bold text-[var(--color-text)]">{preview.matchedCount.toLocaleString()}</p>
                        </div>
                        <div className="rounded-lg border border-amber-800/50 bg-amber-900/10 p-4">
                          <p className="text-xs text-[var(--color-amber-text)]">Unmatched</p>
                          <p className="mt-1 text-2xl font-bold text-[var(--color-text)]">{preview.unmatchedCount.toLocaleString()}</p>
                        </div>
                        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
                          <p className="text-xs text-[var(--color-muted)]">Est. Usage (GB)</p>
                          <p className="mt-1 text-2xl font-bold text-[var(--color-text)]">{Math.round(preview.estimatedUsageGb).toLocaleString()}</p>
                        </div>
                      </div>

                      {(preview.errors.length > 0 || preview.warnings.length > 0 || preview.skippedCount > 0 || preview.duplicateCount > 0) && (
                        <div className="grid gap-3 md:grid-cols-2">
                          {preview.errors.length > 0 && (
                            <div className="rounded-lg border border-red-800 bg-red-900/20 p-4">
                              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-red-text)]"><XCircle className="h-4 w-4" /> Validation errors</div>
                              <ul className="space-y-1 text-sm text-red-200">{preview.errors.map((error, index) => <li key={index}>• {error}</li>)}</ul>
                            </div>
                          )}
                          {(preview.warnings.length > 0 || preview.skippedCount > 0 || preview.duplicateCount > 0) && (
                            <div className="rounded-lg border border-amber-800 bg-amber-900/20 p-4">
                              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-amber-text)]"><AlertTriangle className="h-4 w-4" /> Warnings</div>
                              <ul className="space-y-1 text-sm text-amber-100">
                                {preview.duplicateCount > 0 && <li>• {preview.duplicateCount.toLocaleString()} duplicate rows may be skipped.</li>}
                                {preview.skippedCount > 0 && <li>• {preview.skippedCount.toLocaleString()} rows marked as skipped.</li>}
                                {preview.warnings.map((warning, index) => <li key={index}>• {warning}</li>)}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
                        <div className="border-b border-[var(--color-border)] bg-[var(--color-hover)] px-4 py-3">
                          <h4 className="text-sm font-semibold text-[var(--color-text)]">Parsed row preview</h4>
                          <p className="mt-1 text-xs text-[var(--color-subtle)]">Showing up to the first 100 rows returned by preview.</p>
                        </div>
                        <div className="max-h-80 overflow-auto">
                          <table className="w-full min-w-[760px] text-sm">
                            <thead className="sticky top-0 bg-[var(--color-bg)] text-left text-[var(--color-muted)]">
                              <tr><th className="px-4 py-2 font-medium">Row</th><th className="px-4 py-2 font-medium">Directory / Folder</th><th className="px-4 py-2 font-medium">Cluster</th><th className="px-4 py-2 font-medium text-right">Usage (GB)</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Message</th></tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--color-border)]">
                              {preview.rows.map((row, index) => (
                                <tr key={index} className="hover:bg-[#1C2128]">
                                  <td className="px-4 py-2 text-[var(--color-subtle)]">{row.rowNumber || index + 1}</td>
                                  <td className="px-4 py-2 text-[var(--color-text)]"><div className="max-w-xl whitespace-normal break-words font-mono text-xs">{row.directoryPath || row.folderName || '—'}</div></td>
                                  <td className="px-4 py-2 text-[var(--color-text-soft)]">{row.department || '—'}</td>
                                  <td className="px-4 py-2 text-right font-mono text-teal-400">{typeof row.usageGb === 'number' ? row.usageGb.toLocaleString() : '—'}</td>
                                  <td className="px-4 py-2"><span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-soft)]">{row.status || 'parsed'}</span></td>
                                  <td className="px-4 py-2 text-[var(--color-muted)]"><div className="max-w-md whitespace-normal break-words">{row.message || '—'}</div></td>
                                </tr>
                              ))}
                              {preview.rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--color-subtle)]">Backend returned summary counts without row samples.</td></tr>}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {uploadMsg && <div className="rounded-md border border-red-800 bg-red-900/20 p-3 text-sm text-[var(--color-red-text)]">{uploadMsg}</div>}
                      <div className="flex flex-wrap justify-between gap-3">
                        <button type="button" onClick={() => { setUploadStep(1); setPreview(null); setUploadMsg(''); }} className="flex items-center gap-2 rounded-md px-4 py-2 text-sm text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"><ArrowLeft className="h-4 w-4" /> Back</button>
                        <div className="flex gap-3">
                          <button type="button" onClick={closeUploadModal} className="rounded-md px-4 py-2 text-sm text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]">Cancel</button>
                          <button type="button" onClick={handleConfirmUpload} disabled={confirming || preview.errors.length > 0} className="flex items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-[var(--color-text)] hover:bg-teal-500 disabled:opacity-50 disabled:hover:bg-teal-600">
                            {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                            {confirming ? 'Confirming...' : 'Confirm Import'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {uploadStep === 3 && uploadSummary && (
                    <div className="rounded-lg border border-green-800 bg-green-900/20 p-6 text-center">
                      <CheckCircle2 className="mx-auto h-12 w-12 text-green-400" />
                      <h4 className="mt-3 text-lg font-semibold text-[var(--color-text)]">Import confirmed</h4>
                      <p className="mt-2 text-sm text-green-200">
                        {uploadSummary.inserted.toLocaleString()} inserted, {uploadSummary.skipped.toLocaleString()} skipped, {uploadSummary.unmatched.toLocaleString()} unmatched.
                      </p>
                      <div className="mt-5 flex justify-center gap-3">
                        {uploadSummary.unmatched > 0 && <Link href="/dashboard/unmatched-directories?status=PENDING" className="rounded-md border border-amber-700 bg-amber-900/20 px-4 py-2 text-sm text-[var(--color-amber-text)] hover:bg-amber-900/30">Review unmatched paths</Link>}
                        <button onClick={closeUploadModal} className="rounded-md bg-green-700 px-4 py-2 text-sm font-semibold text-[var(--color-text)] hover:bg-green-600">Done</button>
                      </div>
                    </div>
                  )}
                </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
