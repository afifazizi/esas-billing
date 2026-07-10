'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useRouter, useSearchParams } from 'next/navigation';
import { User, Lock, Save, AlertTriangle } from 'lucide-react';

export default function ProfileContent() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const forceChange = searchParams.get('forceChange') === '1';
  const newPwdRef = useRef<HTMLInputElement>(null);

  const [nameForm, setNameForm] = useState({ fullname: user?.fullname || '', email: user?.email || '' });
  const [pwdForm, setPwdForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [nameMsg, setNameMsg] = useState('');
  const [pwdMsg, setPwdMsg] = useState('');
  const [nameLoading, setNameLoading] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);

  useEffect(() => {
    if (forceChange && newPwdRef.current) {
      newPwdRef.current.focus();
    }
  }, [forceChange]);

  const handleNameUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameMsg('');
    setNameLoading(true);
    try {
      // Update profile via the users endpoint (admin can also use PUT /users/:id)
      await api.put(`/users/${user?.id}`, { fullname: nameForm.fullname, email: nameForm.email });
      setNameMsg('Profile updated successfully');
    } catch (err: any) {
      setNameMsg(err.response?.data?.error || 'Update failed');
    } finally {
      setNameLoading(false);
    }
  };

  const handlePwdChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdMsg('');
    if (pwdForm.newPassword !== pwdForm.confirmPassword) {
      setPwdMsg('Passwords do not match');
      return;
    }
    setPwdLoading(true);
    try {
      await api.put('/auth/password', { currentPassword: pwdForm.currentPassword, newPassword: pwdForm.newPassword });
      setPwdMsg('Password changed successfully');
      setPwdForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      // If this was a forced change, redirect to dashboard after a short delay
      if (forceChange) {
        setTimeout(() => router.push('/dashboard'), 1500);
      }
    } catch (err: any) {
      setPwdMsg(err.response?.data?.error || 'Password change failed');
    } finally {
      setPwdLoading(false);
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">My Profile</h1>
        <p className="text-[var(--color-muted)] text-sm mt-1">Manage your account details and password</p>
      </div>

      {/* Force password change banner */}
      {forceChange && (
        <div className="flex items-center gap-3 bg-amber-900/30 border border-amber-700/50 rounded-lg p-4">
          <AlertTriangle className="w-5 h-5 text-[var(--color-amber-text)] shrink-0" />
          <div>
            <p className="text-[var(--color-amber-text)] font-medium">Password change required</p>
            <p className="text-[var(--color-amber-text)]/80 text-sm">You must change your password before continuing to the dashboard.</p>
          </div>
        </div>
      )}

      {/* Profile Info */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-full bg-amber-600/20 flex items-center justify-center text-[var(--color-amber-text)] text-xl font-bold">
            {user.username[0].toUpperCase()}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">{user.fullname}</h2>
            <p className="text-sm text-[var(--color-muted)]">@{user.username} · {user.userRole}</p>
          </div>
        </div>

        <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-soft)] mb-3">
          <User className="w-4 h-4" /> Edit Profile
        </h3>
        <form onSubmit={handleNameUpdate} className="space-y-3">
          <div>
            <label className="block text-sm text-[var(--color-muted)] mb-1">Full Name</label>
            <input type="text" value={nameForm.fullname} onChange={e => setNameForm(f => ({ ...f, fullname: e.target.value }))}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none" required />
          </div>
          <div>
            <label className="block text-sm text-[var(--color-muted)] mb-1">Email</label>
            <input type="email" value={nameForm.email} onChange={e => setNameForm(f => ({ ...f, email: e.target.value }))}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none" required />
          </div>
          {nameMsg && <div className={`text-sm rounded p-2 ${nameMsg.includes('failed') ? 'text-[var(--color-red-text)] bg-red-900/20 border border-red-800' : 'text-green-400 bg-green-900/20 border border-green-800'}`}>{nameMsg}</div>}
          <button type="submit" disabled={nameLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50 transition-colors">
            <Save className="w-4 h-4" /> {nameLoading ? 'Saving...' : 'Save Profile'}
          </button>
        </form>
      </div>

      {/* Change Password */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-6">
        <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-soft)] mb-3">
          <Lock className="w-4 h-4" /> Change Password
        </h3>
        <form onSubmit={handlePwdChange} className="space-y-3">
          <div>
            <label className="block text-sm text-[var(--color-muted)] mb-1">Current Password</label>
            <input type="password" value={pwdForm.currentPassword} onChange={e => setPwdForm(f => ({ ...f, currentPassword: e.target.value }))}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none" required />
          </div>
          <div>
            <label className="block text-sm text-[var(--color-muted)] mb-1">New Password</label>
            <input type="password" ref={newPwdRef} value={pwdForm.newPassword} onChange={e => setPwdForm(f => ({ ...f, newPassword: e.target.value }))}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none" required minLength={8} />
            <p className="text-xs text-[var(--color-subtle)] mt-1">Min 8 characters, 1 uppercase, 1 number</p>
          </div>
          <div>
            <label className="block text-sm text-[var(--color-muted)] mb-1">Confirm New Password</label>
            <input type="password" value={pwdForm.confirmPassword} onChange={e => setPwdForm(f => ({ ...f, confirmPassword: e.target.value }))}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-amber-500 focus:outline-none" required />
          </div>
          {pwdMsg && <div className={`text-sm rounded p-2 ${pwdMsg.includes('failed') || pwdMsg.includes('do not match') ? 'text-[var(--color-red-text)] bg-red-900/20 border border-red-800' : 'text-green-400 bg-green-900/20 border border-green-800'}`}>{pwdMsg}</div>}
          <button type="submit" disabled={pwdLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50 transition-colors">
            <Lock className="w-4 h-4" /> {pwdLoading ? 'Changing...' : 'Change Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
