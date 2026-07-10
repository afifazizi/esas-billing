'use client';

import { useAuth } from '@/lib/auth';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';
import {
  LayoutDashboard,
  Users,
  FileBarChart,
  FolderTree,
  LogOut,
  User,
  Shield,
  UploadCloud,
  Link2Off,
  BarChart3,
  GitCompareArrows,
} from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { BrandLogo } from '@/components/BrandLogo';

const internalNavItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/dashboard/customers', label: 'Customer Management', icon: FolderTree },
  { href: '/dashboard/reports', label: 'Reports', icon: FileBarChart },
  { href: '/dashboard/import-runs', label: 'Import History', icon: UploadCloud },
  { href: '/dashboard/audit-logs', label: 'Audit Trail', icon: Shield, adminOnly: true },
  { href: '/dashboard/unmatched-directories', label: 'Unmatched Paths', icon: Link2Off, adminOnly: true },
];

const customerNavItems = [
  { href: '/dashboard/my-usage', label: 'My Usage', icon: BarChart3, exact: true },
  { href: '/dashboard/my-usage/comparison', label: 'Comparison', icon: GitCompareArrows },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
      return;
    }
    if (!loading && user?.userRole === 'customer_viewer' && pathname !== '/dashboard/my-usage' && pathname !== '/dashboard/my-usage/comparison' && pathname !== '/dashboard/profile') {
      router.push('/dashboard/my-usage');
    }
  }, [user, loading, router, pathname]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)] md:flex-row">
      {/* Sidebar */}
      <aside className="sticky top-0 z-10 flex h-auto w-full shrink-0 flex-col border-b border-[var(--color-border)] bg-[var(--color-surface)] md:h-screen md:w-64 md:border-r md:border-b-0 md:overflow-y-auto">
        <div className="border-b border-[var(--color-border)] p-4">
          <Link href={user.userRole === 'customer_viewer' ? '/dashboard/my-usage' : '/dashboard'} className="block" aria-label="ESAS Billing dashboard">
            <BrandLogo className="w-full" imageClassName="rounded-lg" loading="eager" />
          </Link>
        </div>
        <nav className="flex flex-1 gap-1 overflow-x-auto p-3 md:block md:space-y-1">
          {(user.userRole === 'customer_viewer' ? customerNavItems : internalNavItems).map((item) => {
            if ('adminOnly' in item && item.adminOnly && user.userRole !== 'admin') return null;
            const Icon = item.icon;
            const exact = 'exact' in item && item.exact;
            const active = exact
              ? pathname === item.href
              : pathname === item.href || pathname?.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex shrink-0 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-amber-600/10 text-[var(--color-amber-text)] border border-amber-600/30'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
          {user.userRole === 'admin' && (
            <Link
              href="/dashboard/users"
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                pathname?.startsWith('/dashboard/users')
                  ? 'bg-amber-600/10 text-[var(--color-amber-text)] border border-amber-600/30'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'
              }`}
            >
              <Users className="w-4 h-4" />
              User Management
            </Link>
          )}
          <Link
            href="/dashboard/profile"
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
              pathname === '/dashboard/profile'
                ? 'bg-amber-600/10 text-[var(--color-amber-text)] border border-amber-600/30'
                : 'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'
            }`}
          >
            <User className="w-4 h-4" />
            Profile
          </Link>
        </nav>
        <div className="p-3 border-t border-[var(--color-border)]">
          <ThemeToggle />
          <div className="mb-2 mt-3 flex items-center gap-2 px-3 py-2">
            <div className="w-7 h-7 rounded-full bg-amber-600/20 flex items-center justify-center text-[var(--color-amber-text)] text-xs font-bold">
              {user.username[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="break-words text-sm text-[var(--color-text)]">{user.fullname}</p>
              <p className="text-xs text-[var(--color-subtle)]">{user.userRole}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-[var(--color-muted)] hover:text-[var(--color-red-text)] hover:bg-[var(--color-hover)] transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="min-w-0 flex-1 overflow-auto">
        <div className="p-4 sm:p-6">{children}</div>
      </main>
    </div>
  );
}
