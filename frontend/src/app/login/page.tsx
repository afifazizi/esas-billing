'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BrandLogo } from '@/components/BrandLogo';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user) router.push(user.userRole === 'customer_viewer' ? '/dashboard/my-usage' : '/dashboard');
  }, [user, router]);

  if (user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const userData = await login(username, password);
      if (userData.mustChangePassword) {
        router.push('/dashboard/profile?forceChange=1');
      } else {
        router.push(userData.userRole === 'customer_viewer' ? '/dashboard/my-usage' : '/dashboard');
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Invalid credentials. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <BrandLogo
            className="mx-auto w-full max-w-[520px]"
            imageClassName="rounded-xl shadow-lg shadow-black/10"
            loading="eager"
          />
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-8">
          <h2 className="text-xl font-semibold text-[var(--color-text)] mb-6">Sign In</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-muted)] mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] placeholder-[var(--color-subtle)] focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                placeholder="Enter your username"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-muted)] mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] placeholder-[var(--color-subtle)] focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                placeholder="Enter your password"
                required
              />
            </div>
            {error && (
              <div className="rounded-md bg-red-900/30 border border-red-800 px-4 py-2 text-sm text-[var(--color-red-text)]">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-[var(--color-faint)] mt-6">ESAS Billing v3.0</p>
      </div>
    </div>
  );
}
