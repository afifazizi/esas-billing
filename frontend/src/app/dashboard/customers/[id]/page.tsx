'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import Link from 'next/link';
import { Plus, Pencil, Trash2, ChevronRight, Tag, Star } from 'lucide-react';

interface Department {
  deptId: string;
  deptName: string;
  deptDesc: string | null;
  _count: { folders: number };
}

interface FolderData {
  folderId: string;
  folderDirectory: string;
  folderName: string;
  folderDesc: string | null;
}

interface PriceTier {
  id: string;
  custId: string;
  label: string | null;
  price: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isDefault: boolean;
  createdAt: string;
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-MY', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [folders, setFolders] = useState<Record<string, FolderData[]>>({});
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<{ id: string; name: string; price: number; registeredAt: string | null; contractEndAt: string | null } | null>(null);

  // Department modal
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [editDept, setEditDept] = useState<Department | null>(null);
  const [deptForm, setDeptForm] = useState({ dept_id: '', dept_name: '', dept_desc: '' });
  const [deptError, setDeptError] = useState('');

  // Folder modal
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [editFolder, setEditFolder] = useState<FolderData | null>(null);
  const [folderDeptId, setFolderDeptId] = useState('');
  const [folderForm, setFolderForm] = useState({ folder_id: '', folder_directory: '', folder_name: '', folder_desc: '', folder_short_name: '' });
  const [folderError, setFolderError] = useState('');

  // Price tier modal
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [editPriceTier, setEditPriceTier] = useState<PriceTier | null>(null);
  const [priceForm, setPriceForm] = useState({ label: '', price: '', effectiveFrom: '', effectiveTo: '', isDefault: false });
  const [priceError, setPriceError] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [custRes, deptRes, priceRes] = await Promise.all([
        api.get('/customers'),
        api.get(`/departments/customers/${id}/departments`),
        api.get(`/customers/${id}/prices`),
      ]);
      const cust = custRes.data.find((c: any) => c.id === id);
      setCustomer(cust || null);
      setDepartments(deptRes.data);
      setPriceTiers(priceRes.data);

      const folderMap: Record<string, FolderData[]> = {};
      await Promise.all(
        deptRes.data.map(async (d: Department) => {
          const fRes = await api.get(`/folders/departments/${d.deptId}/folders`);
          folderMap[d.deptId] = fRes.data;
        })
      );
      setFolders(folderMap);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Department handlers
  const openAddDept = () => {
    setEditDept(null);
    setDeptForm({ dept_id: '', dept_name: '', dept_desc: '' });
    setDeptError('');
    setShowDeptModal(true);
  };

  const openEditDept = (d: Department) => {
    setEditDept(d);
    setDeptForm({ dept_id: d.deptId, dept_name: d.deptName, dept_desc: d.deptDesc || '' });
    setDeptError('');
    setShowDeptModal(true);
  };

  const handleDeptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeptError('');
    try {
      if (editDept) {
        await api.put(`/departments/${editDept.deptId}`, { dept_name: deptForm.dept_name, dept_desc: deptForm.dept_desc });
      } else {
        await api.post(`/departments/customers/${id}/departments`, { dept_name: deptForm.dept_name, dept_desc: deptForm.dept_desc });
      }
      setShowDeptModal(false);
      fetchData();
    } catch (err: any) {
      setDeptError(err.response?.data?.error || 'Operation failed');
    }
  };

  const handleDeleteDept = async (deptId: string) => {
    if (!confirm('Delete this cluster and all its folders?')) return;
    try { await api.delete(`/departments/${deptId}`); fetchData(); }
    catch (err: any) { alert(err.response?.data?.error || 'Delete failed'); }
  };

  // Folder handlers
  const openAddFolder = (deptId: string) => {
    setEditFolder(null);
    setFolderDeptId(deptId);
    setFolderForm({ folder_id: '', folder_directory: '', folder_name: '', folder_desc: '', folder_short_name: '' });
    setFolderError('');
    setShowFolderModal(true);
  };

  const openEditFolder = (f: FolderData) => {
    setEditFolder(f);
    setFolderForm({ folder_id: f.folderId, folder_directory: f.folderDirectory, folder_name: f.folderName, folder_desc: f.folderDesc || '', folder_short_name: '' });
    setFolderError('');
    setShowFolderModal(true);
  };

  const handleFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFolderError('');
    try {
      if (editFolder) {
        await api.put(`/folders/${editFolder.folderId}`, { folder_directory: folderForm.folder_directory, folder_name: folderForm.folder_name, folder_desc: folderForm.folder_desc, folder_short_name: folderForm.folder_short_name });
      } else {
        await api.post(`/folders/departments/${folderDeptId}/folders`, { folder_directory: folderForm.folder_directory, folder_name: folderForm.folder_name, folder_desc: folderForm.folder_desc, folder_short_name: folderForm.folder_short_name });
      }
      setShowFolderModal(false);
      fetchData();
    } catch (err: any) {
      setFolderError(err.response?.data?.error || 'Operation failed');
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (!confirm('Soft-delete this folder?')) return;
    try { await api.delete(`/folders/${folderId}`); fetchData(); }
    catch (err: any) { alert(err.response?.data?.error || 'Delete failed'); }
  };

  // Price tier handlers
  const openAddPrice = () => {
    setEditPriceTier(null);
    setPriceForm({ label: '', price: '', effectiveFrom: '', effectiveTo: '', isDefault: priceTiers.length === 0 });
    setPriceError('');
    setShowPriceModal(true);
  };

  const openEditPrice = (pt: PriceTier) => {
    setEditPriceTier(pt);
    setPriceForm({
      label: pt.label || '',
      price: String(pt.price),
      effectiveFrom: pt.effectiveFrom ? pt.effectiveFrom.slice(0, 10) : '',
      effectiveTo: pt.effectiveTo ? pt.effectiveTo.slice(0, 10) : '',
      isDefault: pt.isDefault,
    });
    setPriceError('');
    setShowPriceModal(true);
  };

  const handlePriceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPriceError('');
    const payload: Record<string, unknown> = {
      price: parseFloat(priceForm.price),
      label: priceForm.label || undefined,
      effectiveFrom: priceForm.effectiveFrom ? new Date(priceForm.effectiveFrom).toISOString() : undefined,
      effectiveTo: priceForm.effectiveTo ? new Date(priceForm.effectiveTo).toISOString() : undefined,
      isDefault: priceForm.isDefault,
    };
    try {
      if (editPriceTier) {
        await api.put(`/customers/prices/${editPriceTier.id}`, payload);
      } else {
        await api.post(`/customers/${id}/prices`, payload);
      }
      setShowPriceModal(false);
      fetchData();
    } catch (err: any) {
      setPriceError(err.response?.data?.error || 'Operation failed');
    }
  };

  const handleDeletePrice = async (tierId: string) => {
    if (!confirm('Delete this price tier?')) return;
    try { await api.delete(`/customers/prices/${tierId}`); fetchData(); }
    catch (err: any) { alert(err.response?.data?.error || 'Delete failed'); }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-2 border-amber-500 border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-[var(--color-subtle)] mb-1">
            <Link href="/dashboard/customers" className="hover:text-[var(--color-text-soft)]">Customer Management</Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-[var(--color-text-soft)]">Cluster List</span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">{customer?.name || id}</h1>
          {customer && (
            <div className="flex items-center gap-4 mt-2 text-sm text-[var(--color-muted)]">
              {customer.registeredAt && (
                <span>Registered: <span className="text-[var(--color-text-soft)]">{new Date(customer.registeredAt).toLocaleDateString('en-MY', { year: 'numeric', month: 'short', day: 'numeric' })}</span></span>
              )}
              {customer.contractEndAt && (
                <span>Contract End: <span className="text-[var(--color-amber-text)]">{new Date(customer.contractEndAt).toLocaleDateString('en-MY', { year: 'numeric', month: 'short', day: 'numeric' })}</span></span>
              )}
            </div>
          )}
        </div>
        <button onClick={openAddDept} className="flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 transition-colors">
          <Plus className="w-4 h-4" /> Add Cluster
        </button>
      </div>

      {departments.length === 0 ? (
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-12 text-center text-[var(--color-subtle)]">
          No clusters yet. Add one to get started.
        </div>
      ) : (
        departments.map(dept => (
          <div key={dept.deptId} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg">
            <table className="w-full text-sm table-fixed border-b border-[var(--color-border)]">
              <tbody>
                <tr>
                  <td className="w-12 px-4 py-3" />
                  <td className="w-72 px-4 py-3">
                    <h3 className="text-lg font-semibold text-[var(--color-text)]">{dept.deptName}</h3>
                  </td>
                  <td className="px-4 py-3" />
                  <td className="w-20 px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEditDept(dept)} className="p-1.5 rounded hover:bg-blue-600/20 text-blue-400 transition-colors" title="Edit"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => handleDeleteDept(dept.deptId)} className="p-1.5 rounded hover:bg-red-600/20 text-[var(--color-red-text)] transition-colors" title="Delete"><Trash2 className="w-4 h-4" /></button>
                      <button onClick={() => openAddFolder(dept.deptId)} className="flex items-center gap-1 px-3 py-1 rounded-md bg-teal-600/20 text-teal-400 text-xs hover:bg-teal-600/30 transition-colors">
                        <Plus className="w-3 h-3" /> Add Directory
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-fixed">
                <thead className="text-[var(--color-muted)] text-left border-b border-[var(--color-border)]">
                  <tr>
                    <th className="px-4 py-2 font-medium w-12">No</th>
                    <th className="px-4 py-2 font-medium w-72">Directory</th>
                    <th className="px-4 py-2 font-medium">Folder Name</th>
                    <th className="px-4 py-2 font-medium text-center w-20">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {(folders[dept.deptId] || []).map((f, i) => (
                    <tr key={f.folderId} className="hover:bg-[#1C2128]">
                      <td className="px-4 py-2 text-[var(--color-muted)]">{i + 1}</td>
                      <td className="px-4 py-2 text-[var(--color-text-soft)] font-mono text-xs">{f.folderDirectory}</td>
                      <td className="px-4 py-2 text-[var(--color-text)]">{f.folderName}</td>
                      <td className="px-4 py-2">
                        <div className="flex justify-center gap-1">
                          <button onClick={() => openEditFolder(f)} className="p-1 rounded hover:bg-blue-600/20 text-blue-400"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => handleDeleteFolder(f.folderId)} className="p-1 rounded hover:bg-red-600/20 text-[var(--color-red-text)]"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(folders[dept.deptId] || []).length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-[var(--color-subtle)]">No directories</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      {/* ─── Price Tiers ─── */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <h3 className="text-lg font-semibold text-[var(--color-text)] flex items-center gap-2">
            <Tag className="w-5 h-5 text-[var(--color-amber-text)]" /> Price Tiers
          </h3>
          <button onClick={openAddPrice} className="flex items-center gap-2 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-500 transition-colors">
            <Plus className="w-4 h-4" /> Add Price Tier
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-hover)] text-[var(--color-muted)] text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Label</th>
                <th className="px-4 py-2 font-medium text-right">Price/GB (RM)</th>
                <th className="px-4 py-2 font-medium">Effective From</th>
                <th className="px-4 py-2 font-medium">Effective To</th>
                <th className="px-4 py-2 font-medium text-center">Default</th>
                <th className="px-4 py-2 font-medium text-center w-20">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {priceTiers.map(pt => (
                <tr key={pt.id} className="hover:bg-[#1C2128]">
                  <td className="px-4 py-2 text-[var(--color-text)]">{pt.label || <span className="text-[var(--color-subtle)] italic">Unnamed tier</span>}</td>
                  <td className="px-4 py-2 text-right font-mono text-teal-400">RM {pt.price.toFixed(4)}</td>
                  <td className="px-4 py-2 text-[var(--color-muted)] text-xs">{formatDate(pt.effectiveFrom)}</td>
                  <td className="px-4 py-2 text-[var(--color-muted)] text-xs">{pt.effectiveTo ? formatDate(pt.effectiveTo) : <span className="text-[var(--color-subtle)] italic">Ongoing</span>}</td>
                  <td className="px-4 py-2 text-center">
                    {pt.isDefault ? <Star className="w-4 h-4 text-[var(--color-amber-text)] inline" /> : <span className="text-[var(--color-subtle)]">—</span>}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-center gap-1">
                      <button onClick={() => openEditPrice(pt)} className="p-1 rounded hover:bg-blue-600/20 text-blue-400"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => handleDeletePrice(pt.id)} className="p-1 rounded hover:bg-red-600/20 text-[var(--color-red-text)]"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {priceTiers.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-[var(--color-subtle)]">No price tiers. Add one to set pricing for this customer.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dept Modal */}
      {showDeptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowDeptModal(false)}>
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">{editDept ? 'Edit Cluster' : 'Add Cluster'}</h3>
            <form onSubmit={handleDeptSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-[var(--color-muted)] mb-1">Cluster Name</label>
                <input type="text" value={deptForm.dept_name} onChange={e => setDeptForm(f => ({ ...f, dept_name: e.target.value }))}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none" required />
              </div>
              <div>
                <label className="block text-sm text-[var(--color-muted)] mb-1">Description</label>
                <input type="text" value={deptForm.dept_desc} onChange={e => setDeptForm(f => ({ ...f, dept_desc: e.target.value }))}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none" />
              </div>
              {deptError && <div className="text-sm text-[var(--color-red-text)] bg-red-900/20 border border-red-800 rounded p-2">{deptError}</div>}
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowDeptModal(false)} className="px-4 py-2 rounded-md text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]">Cancel</button>
                <button type="submit" className="px-4 py-2 rounded-md text-sm font-semibold bg-amber-600 text-white hover:bg-amber-500">{editDept ? 'Save' : 'Add'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Folder Modal */}
      {showFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowFolderModal(false)}>
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">{editFolder ? 'Edit Directory' : 'Add Directory'}</h3>
            <form onSubmit={handleFolderSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-[var(--color-muted)] mb-1">Directory Path</label>
                <input type="text" value={folderForm.folder_directory} onChange={e => setFolderForm(f => ({ ...f, folder_directory: e.target.value }))}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] font-mono text-xs focus:border-amber-500 focus:outline-none" required placeholder="/ifs/Dalet/DPSHARE/RSU" />
              </div>
              <div>
                <label className="block text-sm text-[var(--color-muted)] mb-1">Folder Name</label>
                <input type="text" value={folderForm.folder_name} onChange={e => setFolderForm(f => ({ ...f, folder_name: e.target.value }))}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none" required />
              </div>
              <div>
                <label className="block text-sm text-[var(--color-muted)] mb-1">Short Name (for CSV matching)</label>
                <input type="text" value={folderForm.folder_short_name} onChange={e => setFolderForm(f => ({ ...f, folder_short_name: e.target.value }))}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] font-mono focus:border-amber-500 focus:outline-none" placeholder="RSU" />
              </div>
              {folderError && <div className="text-sm text-[var(--color-red-text)] bg-red-900/20 border border-red-800 rounded p-2">{folderError}</div>}
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowFolderModal(false)} className="px-4 py-2 rounded-md text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]">Cancel</button>
                <button type="submit" className="px-4 py-2 rounded-md text-sm font-semibold bg-amber-600 text-white hover:bg-amber-500">{editFolder ? 'Save' : 'Add'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Price Tier Modal */}
      {showPriceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowPriceModal(false)}>
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">{editPriceTier ? 'Edit Price Tier' : 'Add Price Tier'}</h3>
            <form onSubmit={handlePriceSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-[var(--color-muted)] mb-1">Label <span className="text-[var(--color-faint)]">(optional)</span></label>
                <input type="text" value={priceForm.label} onChange={e => setPriceForm(f => ({ ...f, label: e.target.value }))}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none" placeholder="e.g. 2026 Fixed Rate, Year 1 Discount" />
              </div>
              <div>
                <label className="block text-sm text-[var(--color-muted)] mb-1">Price per GB (RM)</label>
                <input type="number" step="0.0001" min="0" value={priceForm.price} onChange={e => setPriceForm(f => ({ ...f, price: e.target.value }))}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none" required placeholder="0.028" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-[var(--color-muted)] mb-1">Effective From <span className="text-[var(--color-faint)]">(optional)</span></label>
                  <input type="date" value={priceForm.effectiveFrom} onChange={e => setPriceForm(f => ({ ...f, effectiveFrom: e.target.value }))}
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none [color-scheme:dark]" />
                </div>
                <div>
                  <label className="block text-sm text-[var(--color-muted)] mb-1">Effective To <span className="text-[var(--color-faint)]">(optional)</span></label>
                  <input type="date" value={priceForm.effectiveTo} onChange={e => setPriceForm(f => ({ ...f, effectiveTo: e.target.value }))}
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none [color-scheme:dark]" />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={priceForm.isDefault} onChange={e => setPriceForm(f => ({ ...f, isDefault: e.target.checked }))}
                  className="rounded border-[var(--color-border)] bg-[var(--color-bg)] text-amber-500 focus:ring-amber-500" />
                <span className="text-sm text-[var(--color-text)]">Set as default price tier</span>
              </label>
              {priceError && <div className="text-sm text-[var(--color-red-text)] bg-red-900/20 border border-red-800 rounded p-2">{priceError}</div>}
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowPriceModal(false)} className="px-4 py-2 rounded-md text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]">Cancel</button>
                <button type="submit" className="px-4 py-2 rounded-md text-sm font-semibold bg-amber-600 text-white hover:bg-amber-500">{editPriceTier ? 'Save' : 'Add Tier'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
