'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Key, Shield } from 'lucide-react';

interface UserData {
  id: string;
  username: string;
  email: string;
  fullname: string;
  userRole: string;
  custId?: string | null;
  isActive?: boolean;
  customer?: { custName?: string | null } | null;
  createdAt: string;
}

type ApiErrorData = {
  error?: string;
  message?: string;
  details?: unknown;
  errors?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const formatApiError = (err: unknown, fallback = 'Failed') => {
  const response = isRecord(err) && isRecord(err.response) ? err.response : undefined;
  const data = response && isRecord(response.data) ? (response.data as ApiErrorData) : undefined;
  const base = data?.error || data?.message || fallback;
  const details = data?.details || data?.errors;

  if (Array.isArray(details)) {
    const detailText = details
      .map((detail) => {
        if (typeof detail === 'string') return detail;
        if (!isRecord(detail)) return '';

        const path = detail.path;
        const field = Array.isArray(path) ? path.join('.') : detail.field || path;
        const message = detail.message || detail.error;
        return [field, message].filter(Boolean).join(' ');
      })
      .filter(Boolean)
      .join('; ');

    return detailText ? `${base}: ${detailText}` : base;
  }

  if (isRecord(details)) {
    const detailText = Object.entries(details)
      .map(([field, value]) => `${field} ${Array.isArray(value) ? value.join(', ') : String(value)}`)
      .join('; ');

    return detailText ? `${base}: ${detailText}` : base;
  }

  return base;
};

export default function UsersPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [pwdUserId, setPwdUserId] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({ email: '', username: '', fullname: '', userRole: 'user', custId: '', password: '', confirmPassword: '', mustChangePassword: false });
  const [pwdForm, setPwdForm] = useState({ password: '', confirmPassword: '', mustChangePassword: false });

  useEffect(() => {
    if (!authLoading && user?.userRole !== 'admin') {
      router.push('/dashboard');
    }
  }, [user, authLoading, router]);

  const fetchUsers = useCallback(async () => {
    try { const res = await api.get('/users'); setUsers(res.data); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (user?.userRole !== 'admin') return;

    api.get('/users')
      .then(res => setUsers(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
    api.get('/customers')
      .then(res => setCustomers((res.data || []).map((c: any) => ({ id: c.id, name: c.name }))))
      .catch(console.error);
  }, [user?.userRole]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirmPassword) { setError('Passwords do not match'); return; }
    try {
      await api.post('/users', { email: form.email, username: form.username, fullname: form.fullname, role: form.userRole, custId: form.userRole === 'customer_viewer' ? form.custId : undefined, password: form.password, mustChangePassword: form.mustChangePassword });
      setShowModal(false);
      setForm({ email: '', username: '', fullname: '', userRole: 'user', custId: '', password: '', confirmPassword: '', mustChangePassword: false });
      fetchUsers();
    } catch (err: unknown) { setError(formatApiError(err)); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this user?')) return;
    try { await api.delete(`/users/${id}`); fetchUsers(); }
    catch (err: unknown) { alert(formatApiError(err, 'Delete failed')); }
  };

  const handleResetPwd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (pwdForm.password !== pwdForm.confirmPassword) { setError('Passwords do not match'); return; }
    try {
      await api.put(`/users/${pwdUserId}/password`, { password: pwdForm.password, mustChangePassword: pwdForm.mustChangePassword });
      setShowPwdModal(false);
      setPwdForm({ password: '', confirmPassword: '', mustChangePassword: false });
    } catch (err: unknown) { setError(formatApiError(err)); }
  };

  if (authLoading || user?.userRole !== 'admin') {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-2 border-amber-500 border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">User Management</h1>
          <p className="text-[var(--color-muted)] text-sm mt-1">Administer system users and roles</p>
        </div>
        <button onClick={() => { setError(''); setShowModal(true); }}
          className="flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 transition-colors">
          <Plus className="w-4 h-4" /> Add User
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-2 border-amber-500 border-t-transparent" /></div>
      ) : (
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-hover)] text-[var(--color-muted)] text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">No</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Username</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {users.map((u, i) => (
                  <tr key={u.id} className="hover:bg-[#1C2128]">
                    <td className="px-4 py-3 text-[var(--color-muted)]">{i + 1}</td>
                    <td className="px-4 py-3 text-[var(--color-text-soft)]">{u.email}</td>
                    <td className="px-4 py-3 text-[var(--color-text)]">{u.fullname}</td>
                    <td className="px-4 py-3 text-[var(--color-text-soft)]">{u.username}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${u.userRole === 'admin' ? 'bg-blue-600/20 text-blue-400' : u.userRole === 'customer_viewer' ? 'bg-teal-600/20 text-teal-400' : 'bg-amber-600/20 text-[var(--color-amber-text)]'}`}>
                        <Shield className="w-3 h-3" /> {u.userRole}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-soft)]">{u.customer?.custName || u.custId || '—'}</td>
                    <td className="px-4 py-3"><span className={`rounded px-2 py-0.5 text-xs ${u.isActive === false ? 'bg-red-600/20 text-[var(--color-red-text)]' : 'bg-green-600/20 text-[var(--color-green-text)]'}`}>{u.isActive === false ? 'Disabled' : 'Active'}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-center gap-1">
                        <button onClick={() => { setPwdUserId(u.id); setPwdForm({ password: '', confirmPassword: '', mustChangePassword: false }); setError(''); setShowPwdModal(true); }}
                          className="p-1.5 rounded hover:bg-teal-600/20 text-teal-400 transition-colors" title="Reset Password">
                          <Key className="w-4 h-4" />
                        </button>
                        {u.username !== user?.username && (
                          <button onClick={() => handleDelete(u.id)}
                            className="p-1.5 rounded hover:bg-red-600/20 text-[var(--color-red-text)] transition-colors" title="Delete">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--color-subtle)]">No users found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowModal(false)}>
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">Add New User</h3>
            <form onSubmit={handleAdd} className="space-y-3">
              <div><label className="block text-sm text-[var(--color-muted)] mb-1">Email</label><input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none" required /></div>
              <div><label className="block text-sm text-[var(--color-muted)] mb-1">Username</label><input type="text" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none lowercase" required /></div>
              <div><label className="block text-sm text-[var(--color-muted)] mb-1">Full Name</label><input type="text" value={form.fullname} onChange={e => setForm(f => ({ ...f, fullname: e.target.value }))} className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none" required /></div>
              <div><label className="block text-sm text-[var(--color-muted)] mb-1">Role</label><select value={form.userRole} onChange={e => setForm(f => ({ ...f, userRole: e.target.value, custId: e.target.value === 'customer_viewer' ? f.custId : '' }))} className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none"><option value="user">User</option><option value="admin">Admin</option><option value="customer_viewer">Customer Viewer</option></select></div>
              {form.userRole === 'customer_viewer' && <div><label className="block text-sm text-[var(--color-muted)] mb-1">Customer</label><select value={form.custId} onChange={e => setForm(f => ({ ...f, custId: e.target.value }))} className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none" required><option value="">Select customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
              <div><label className="block text-sm text-[var(--color-muted)] mb-1">Password</label><input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none" required />
                {form.password.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    <li className={`text-xs flex items-center gap-1 ${form.password.length >= 8 ? 'text-green-400' : 'text-[var(--color-subtle)]'}`}>{form.password.length >= 8 ? '✓' : '○'} At least 8 characters</li>
                    <li className={`text-xs flex items-center gap-1 ${/[A-Z]/.test(form.password) ? 'text-green-400' : 'text-[var(--color-subtle)]'}`}>{/[A-Z]/.test(form.password) ? '✓' : '○'} One uppercase letter</li>
                    <li className={`text-xs flex items-center gap-1 ${/[0-9]/.test(form.password) ? 'text-green-400' : 'text-[var(--color-subtle)]'}`}>{/[0-9]/.test(form.password) ? '✓' : '○'} One number</li>
                  </ul>
                )}
              </div>
              <div><label className="block text-sm text-[var(--color-muted)] mb-1">Confirm Password</label><input type="password" value={form.confirmPassword} onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))} className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none" required /></div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={form.mustChangePassword} onChange={e => setForm(f => ({ ...f, mustChangePassword: e.target.checked }))}
                  className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-bg)] text-amber-500 focus:ring-amber-500 focus:ring-offset-0" />
                <span className="text-sm text-[var(--color-text-soft)]">Require password change on next login</span>
              </label>
              {error && <div className="text-sm text-[var(--color-red-text)] bg-red-900/20 border border-red-800 rounded p-2">{error}</div>}
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 rounded-md text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]">Cancel</button>
                <button type="submit" className="px-4 py-2 rounded-md text-sm font-semibold bg-amber-600 text-white hover:bg-amber-500">Add User</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showPwdModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowPwdModal(false)}>
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">Reset User Password</h3>
            <form onSubmit={handleResetPwd} className="space-y-3">
              <div><label className="block text-sm text-[var(--color-muted)] mb-1">New Password</label><input type="password" value={pwdForm.password} onChange={e => setPwdForm(f => ({ ...f, password: e.target.value }))} className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none" required />
                {pwdForm.password.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    <li className={`text-xs flex items-center gap-1 ${pwdForm.password.length >= 8 ? 'text-green-400' : 'text-[var(--color-subtle)]'}`}>{pwdForm.password.length >= 8 ? '✓' : '○'} At least 8 characters</li>
                    <li className={`text-xs flex items-center gap-1 ${/[A-Z]/.test(pwdForm.password) ? 'text-green-400' : 'text-[var(--color-subtle)]'}`}>{/[A-Z]/.test(pwdForm.password) ? '✓' : '○'} One uppercase letter</li>
                    <li className={`text-xs flex items-center gap-1 ${/[0-9]/.test(pwdForm.password) ? 'text-green-400' : 'text-[var(--color-subtle)]'}`}>{/[0-9]/.test(pwdForm.password) ? '✓' : '○'} One number</li>
                  </ul>
                )}
              </div>
              <div><label className="block text-sm text-[var(--color-muted)] mb-1">Confirm Password</label><input type="password" value={pwdForm.confirmPassword} onChange={e => setPwdForm(f => ({ ...f, confirmPassword: e.target.value }))} className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none" required /></div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={pwdForm.mustChangePassword} onChange={e => setPwdForm(f => ({ ...f, mustChangePassword: e.target.checked }))}
                  className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-bg)] text-amber-500 focus:ring-amber-500 focus:ring-offset-0" />
                <span className="text-sm text-[var(--color-text-soft)]">Require password change on next login</span>
              </label>
              {error && <div className="text-sm text-[var(--color-red-text)] bg-red-900/20 border border-red-800 rounded p-2">{error}</div>}
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowPwdModal(false)} className="px-4 py-2 rounded-md text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]">Cancel</button>
                <button type="submit" className="px-4 py-2 rounded-md text-sm font-semibold bg-amber-600 text-white hover:bg-amber-500">Reset Password</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
