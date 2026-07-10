'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { Plus, Pencil, Trash2, Eye, BarChart3 } from 'lucide-react';

interface Customer {
  id: string;
  name: string;
  description: string | null;
  price: number;
  departmentCount: number;
  registeredAt: string | null;
  contractEndAt: string | null;
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleDateString('en-MY', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editCust, setEditCust] = useState<Customer | null>(null);
  const [error, setError] = useState('');

  const [form, setForm] = useState({ cust_id: '', cust_name: '', cust_description: '', price: '', registeredAt: '', contractEndAt: '' });

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await api.get('/customers');
      setCustomers(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  const openAdd = () => {
    setEditCust(null);
    setForm({ cust_id: '', cust_name: '', cust_description: '', price: '', registeredAt: '', contractEndAt: '' });
    setError('');
    setShowModal(true);
  };

  const openEdit = (c: Customer) => {
    setEditCust(c);
    setForm({
      cust_id: c.id,
      cust_name: c.name,
      cust_description: c.description || '',
      price: String(c.price),
      registeredAt: c.registeredAt ? c.registeredAt.slice(0, 10) : '',
      contractEndAt: c.contractEndAt ? c.contractEndAt.slice(0, 10) : '',
    });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const payload: Record<string, unknown> = {
      cust_name: form.cust_name,
      cust_description: form.cust_description,
      price: parseFloat(form.price),
      registeredAt: form.registeredAt || undefined,
      contractEndAt: form.contractEndAt || undefined,
    };
    // Only send cust_id for edits; creates auto-generate it server-side
    if (editCust) {
      payload.cust_id = editCust.id;
    }
    try {
      if (editCust) {
        await api.put(`/customers/${editCust.id}`, payload);
      } else {
        await api.post('/customers', payload);
      }
      setShowModal(false);
      fetchCustomers();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Operation failed');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure? This will soft-delete the customer.')) return;
    try {
      await api.delete(`/customers/${id}`);
      fetchCustomers();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-2 border-amber-500 border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Customer Management</h1>
          <p className="text-[var(--color-muted)] text-sm mt-1">Manage customers, clusters, and storage folders</p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 transition-colors">
          <Plus className="w-4 h-4" /> Add Customer
        </button>
      </div>

      {/* Table */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-hover)] text-[var(--color-muted)] text-left">
              <tr>
                <th className="px-4 py-3 font-medium">No</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium text-right">Price/GB (RM)</th>
                <th className="px-4 py-3 font-medium text-center">Clusters</th>
                <th className="px-4 py-3 font-medium">Registered</th>
                <th className="px-4 py-3 font-medium text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {customers.map((c, i) => (
                <tr key={c.id} className="hover:bg-[#1C2128] transition-colors">
                  <td className="px-4 py-3 text-[var(--color-muted)]">{i + 1}</td>
                  <td className="px-4 py-3 text-[var(--color-text)] font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-right font-mono text-teal-400">RM {Number(c.price).toFixed(4)}</td>
                  <td className="px-4 py-3 text-center text-[var(--color-muted)]">{c.departmentCount}</td>
                  <td className="px-4 py-3 text-[var(--color-muted)] text-xs">{formatDate(c.registeredAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <Link href={`/dashboard/reports/${c.id}`} className="p-1.5 rounded hover:bg-amber-600/20 text-[var(--color-amber-text)] transition-colors" title="View Report">
                        <BarChart3 className="w-4 h-4" />
                      </Link>
                      <Link href={`/dashboard/customers/${c.id}`} className="p-1.5 rounded hover:bg-teal-600/20 text-teal-400 transition-colors" title="View Detail">
                        <Eye className="w-4 h-4" />
                      </Link>
                      <button onClick={() => openEdit(c)} className="p-1.5 rounded hover:bg-blue-600/20 text-blue-400 transition-colors" title="Edit">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded hover:bg-red-600/20 text-[var(--color-red-text)] transition-colors" title="Delete">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-[var(--color-subtle)]">No customers found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowModal(false)}>
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">{editCust ? 'Edit Customer' : 'Add Customer'}</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-[var(--color-muted)] mb-1">Customer Name</label>
                <input type="text" value={form.cust_name} onChange={e => setForm(f => ({ ...f, cust_name: e.target.value }))}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none" required placeholder="e.g. Media Prima" />
              </div>
              <div>
                <label className="block text-sm text-[var(--color-muted)] mb-1">Description</label>
                <input type="text" value={form.cust_description} onChange={e => setForm(f => ({ ...f, cust_description: e.target.value }))}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm text-[var(--color-muted)] mb-1">Price per GB (RM)</label>
                <input type="number" step="0.0001" min="0" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none" required placeholder="0.02" />
              </div>
              <div>
                <label className="block text-sm text-[var(--color-muted)] mb-1">Date Registered</label>
                <input type="date" value={form.registeredAt} onChange={e => setForm(f => ({ ...f, registeredAt: e.target.value }))}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none [color-scheme:dark]" />
              </div>
              <div>
                <label className="block text-sm text-[var(--color-muted)] mb-1">Contract End Date <span className="text-[var(--color-faint)]">(optional)</span></label>
                <input type="date" value={form.contractEndAt} onChange={e => setForm(f => ({ ...f, contractEndAt: e.target.value }))}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none [color-scheme:dark]" />
              </div>
              {error && <div className="text-sm text-[var(--color-red-text)] bg-red-900/20 border border-red-800 rounded p-2">{error}</div>}
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 rounded-md text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)] transition-colors">Cancel</button>
                <button type="submit" className="px-4 py-2 rounded-md text-sm font-semibold bg-amber-600 text-white hover:bg-amber-500 transition-colors">
                  {editCust ? 'Save' : 'Add Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
