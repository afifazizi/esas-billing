'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Archive,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Pencil,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import CustomerDialog from './CustomerDialog';
import {
  filterAndSortCustomers,
  getContractStatus,
  getCustomerSummary,
  type ContractHealthFilter,
  type CustomerRecord,
  type CustomerSortField,
  type SortDirection,
} from './customer-utils';

const emptyForm = {
  cust_name: '',
  cust_description: '',
  price: '',
  registeredAt: '',
  contractEndAt: '',
};

const controlClass = 'rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] transition-colors placeholder:text-[var(--color-faint)] focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20';

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-MY', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatApiError(error: unknown, fallback: string): string {
  if (typeof error !== 'object' || error === null || !('response' in error)) return fallback;
  const response = (error as { response?: { data?: unknown } }).response;
  const data = response?.data;
  if (typeof data === 'object' && data !== null) {
    const message = (data as { error?: unknown; message?: unknown }).error
      ?? (data as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

function ContractBadge({ customer, now }: { customer: CustomerRecord; now: Date }) {
  const status = getContractStatus(customer.contractEndAt, now);
  const styles = {
    'no-expiry': 'bg-blue-600/15 text-[var(--color-blue-text)]',
    active: 'bg-green-600/15 text-[var(--color-green-text)]',
    expiring: 'bg-amber-600/15 text-[var(--color-amber-text)]',
    expired: 'bg-red-600/15 text-[var(--color-red-text)]',
  }[status.health];

  return (
    <div className="space-y-1">
      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${styles}`}>{status.label}</span>
      <div className="text-xs text-[var(--color-muted)]">{status.detail}</div>
    </div>
  );
}

interface CustomerActionsProps {
  customer: CustomerRecord;
  menuKey: string;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onEdit: () => void;
  onArchive: () => void;
}

function CustomerActions({ customer, menuKey, menuOpen, onToggleMenu, onEdit, onArchive }: CustomerActionsProps) {
  const menuId = `customer-actions-${menuKey}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`/dashboard/reports/${customer.id}`}
        className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
        aria-label={`View report for ${customer.name}`}
      >
        <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" /> Report
      </Link>
      <Link
        href={`/dashboard/customers/${customer.id}`}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-text-soft)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
        aria-label={`Manage ${customer.name}`}
      >
        <Settings2 className="h-3.5 w-3.5" aria-hidden="true" /> Manage
      </Link>
      <div className="relative" data-customer-menu={menuKey}>
        <button
          id={`customer-menu-button-${menuKey}`}
          type="button"
          onClick={onToggleMenu}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-controls={menuId}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
        >
          More <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        {menuOpen && (
          <div id={menuId} role="menu" className="absolute right-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] py-1 shadow-xl shadow-[var(--color-shadow)]">
            <button type="button" role="menuitem" onClick={onEdit} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-text-soft)] hover:bg-[var(--color-hover)] focus:bg-[var(--color-hover)] focus:outline-none">
              <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
            </button>
            <button type="button" role="menuitem" onClick={onArchive} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-red-text)] hover:bg-[var(--color-hover)] focus:bg-[var(--color-hover)] focus:outline-none">
              <Archive className="h-4 w-4" aria-hidden="true" /> Archive
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editCustomer, setEditCustomer] = useState<CustomerRecord | null>(null);
  const [archiveCustomer, setArchiveCustomer] = useState<CustomerRecord | null>(null);
  const [formError, setFormError] = useState('');
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [contractFilter, setContractFilter] = useState<ContractHealthFilter>('all');
  const [sortField, setSortField] = useState<CustomerSortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [form, setForm] = useState(emptyForm);
  const now = useMemo(() => new Date(), []);

  const fetchCustomers = useCallback(async () => {
    setLoadError('');
    try {
      const response = await api.get('/customers');
      setCustomers(Array.isArray(response.data) ? response.data : []);
    } catch (error: unknown) {
      setLoadError(formatApiError(error, 'Unable to load customers. Please try again.'));
    } finally {
      setLoading(false);
    }
  }, []);

  // The customers endpoint is client-authenticated, so the initial request belongs in an effect.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchCustomers(); }, [fetchCustomers]);

  useEffect(() => {
    if (!openMenuId) return;
    const closeMenu = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(`[data-customer-menu="${CSS.escape(openMenuId)}"]`)) setOpenMenuId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpenMenuId(null);
      document.getElementById(`customer-menu-button-${openMenuId}`)?.focus();
    };
    document.addEventListener('mousedown', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openMenuId]);

  const visibleCustomers = useMemo(
    () => filterAndSortCustomers(customers, query, contractFilter, sortField, sortDirection, now),
    [customers, query, contractFilter, sortField, sortDirection, now],
  );
  const summary = useMemo(() => getCustomerSummary(customers, now), [customers, now]);
  const hasFilters = query.trim() !== '' || contractFilter !== 'all';

  const openAdd = () => {
    setEditCustomer(null);
    setForm(emptyForm);
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (customer: CustomerRecord) => {
    setOpenMenuId(null);
    setEditCustomer(customer);
    setForm({
      cust_name: customer.name,
      cust_description: customer.description || '',
      price: String(customer.price),
      registeredAt: customer.registeredAt?.slice(0, 10) || '',
      contractEndAt: customer.contractEndAt?.slice(0, 10) || '',
    });
    setFormError('');
    setShowForm(true);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    setFormBusy(true);
    const payload: Record<string, unknown> = {
      cust_name: form.cust_name.trim(),
      cust_description: form.cust_description.trim(),
      price: Number(form.price),
      registeredAt: form.registeredAt || undefined,
      contractEndAt: form.contractEndAt || undefined,
    };
    if (editCustomer) payload.cust_id = editCustomer.id;

    try {
      if (editCustomer) await api.put(`/customers/${editCustomer.id}`, payload);
      else await api.post('/customers', payload);
      const action = editCustomer ? 'updated' : 'added';
      setShowForm(false);
      setFeedback({ tone: 'success', message: `${form.cust_name.trim()} was ${action} successfully.` });
      await fetchCustomers();
    } catch (error: unknown) {
      setFormError(formatApiError(error, 'Unable to save customer. Please review the form and try again.'));
    } finally {
      setFormBusy(false);
    }
  };

  const confirmArchive = async () => {
    if (!archiveCustomer) return;
    setArchiveBusy(true);
    try {
      await api.delete(`/customers/${archiveCustomer.id}`);
      setFeedback({ tone: 'success', message: `${archiveCustomer.name} was archived successfully.` });
      setArchiveCustomer(null);
      await fetchCustomers();
    } catch (error: unknown) {
      setFeedback({ tone: 'error', message: formatApiError(error, 'Unable to archive customer. Please try again.') });
      setArchiveCustomer(null);
    } finally {
      setArchiveBusy(false);
    }
  };

  const clearFilters = () => {
    setQuery('');
    setContractFilter('all');
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Customer Management</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">Manage customer contracts, clusters, and storage folders</p>
        </div>
        <button type="button" onClick={openAdd} className="inline-flex w-fit items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500">
          <Plus className="h-4 w-4" aria-hidden="true" /> Add Customer
        </button>
      </header>

      <div aria-live="polite" aria-atomic="true">
        {feedback && (
          <div role={feedback.tone === 'error' ? 'alert' : 'status'} className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-sm ${feedback.tone === 'success' ? 'border-green-600/30 bg-green-600/10 text-[var(--color-green-text)]' : 'border-red-600/30 bg-red-600/10 text-[var(--color-red-text)]'}`}>
            <div className="flex items-center gap-2">
              {feedback.tone === 'success' ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />}
              <span>{feedback.message}</span>
            </div>
            <button type="button" onClick={() => setFeedback(null)} aria-label="Dismiss notification" className="rounded p-0.5 hover:bg-[var(--color-hover)]"><X className="h-4 w-4" aria-hidden="true" /></button>
          </div>
        )}
      </div>

      <section aria-label="Customer overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Total customers', summary.total, 'text-[var(--color-text)]'],
          ['Expiring ≤90 days', summary.expiring, 'text-[var(--color-amber-text)]'],
          ['Expired', summary.expired, 'text-[var(--color-red-text)]'],
          ['Visible results', visibleCustomers.length, 'text-[var(--color-blue-text)]'],
        ].map(([label, count, color]) => (
          <div key={String(label)} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">{label}</p>
            <p className={`mt-1 text-2xl font-semibold ${color}`}>{count}</p>
          </div>
        ))}
      </section>

      <section aria-label="Customer search and filters" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(15rem,1fr)_auto_auto_auto] lg:items-end">
          <div>
            <label htmlFor="customer-search" className="mb-1.5 block text-xs font-medium text-[var(--color-muted)]">Search customers</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-subtle)]" aria-hidden="true" />
              <input id="customer-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Customer name or ID" className={`${controlClass} w-full pl-9`} />
            </div>
          </div>
          <div>
            <label htmlFor="contract-filter" className="mb-1.5 block text-xs font-medium text-[var(--color-muted)]">Contract health</label>
            <select id="contract-filter" value={contractFilter} onChange={(event) => setContractFilter(event.target.value as ContractHealthFilter)} className={controlClass}>
              <option value="all">All contracts</option>
              <option value="active">Active / no expiry</option>
              <option value="expiring">Expiring within 90 days</option>
              <option value="expired">Expired</option>
            </select>
          </div>
          <div>
            <label htmlFor="customer-sort" className="mb-1.5 block text-xs font-medium text-[var(--color-muted)]">Sort by</label>
            <select id="customer-sort" value={sortField} onChange={(event) => setSortField(event.target.value as CustomerSortField)} className={controlClass}>
              <option value="name">Customer name</option>
              <option value="price">Price</option>
              <option value="departmentCount">Cluster count</option>
              <option value="registeredAt">Registration date</option>
              <option value="contractEndAt">Contract end date</option>
            </select>
          </div>
          <button type="button" onClick={() => setSortDirection((value) => value === 'asc' ? 'desc' : 'asc')} className={`${controlClass} inline-flex items-center justify-center gap-2`} aria-label={`Sort ${sortDirection === 'asc' ? 'descending' : 'ascending'}`}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> {sortDirection === 'asc' ? 'Ascending' : 'Descending'}
          </button>
        </div>
      </section>

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-600/30 bg-red-600/10 p-4 text-sm text-[var(--color-red-text)]">
          <span>{loadError}</span>
          <button type="button" onClick={() => { setLoading(true); void fetchCustomers(); }} className="rounded-md border border-current px-3 py-1.5 font-semibold">Try again</button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20" role="status" aria-label="Loading customers"><div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" /></div>
      ) : loadError && customers.length === 0 ? null : visibleCustomers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-14 text-center">
          <Search className="mx-auto h-8 w-8 text-[var(--color-subtle)]" aria-hidden="true" />
          <h2 className="mt-3 font-semibold text-[var(--color-text)]">{hasFilters ? 'No customers match these filters' : 'No customers yet'}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-[var(--color-muted)]">{hasFilters ? 'Try another name, ID, or contract health selection.' : 'Add your first customer to begin managing clusters and contracts.'}</p>
          {hasFilters && <button type="button" onClick={clearFilters} className="mt-4 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm font-semibold text-[var(--color-text-soft)] hover:bg-[var(--color-hover)]">Clear filters</button>}
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-[var(--color-hover)] text-left text-[var(--color-muted)]">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Price/GB</th>
                  <th scope="col" className="px-4 py-3 text-center font-medium">Clusters</th>
                  <th scope="col" className="px-4 py-3 font-medium">Registered</th>
                  <th scope="col" className="px-4 py-3 font-medium">Contract status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {visibleCustomers.map((customer) => (
                  <tr key={customer.id} className="transition-colors hover:bg-[var(--color-hover)]">
                    <th scope="row" className="px-4 py-4 text-left">
                      <div className="font-semibold text-[var(--color-text)]">{customer.name}</div>
                      <div className="mt-0.5 max-w-[15rem] truncate font-mono text-[11px] font-normal text-[var(--color-muted)]" title={customer.id}>ID: {customer.id}</div>
                    </th>
                    <td className="px-4 py-4 text-right font-mono text-[var(--color-teal-text)]">RM {Number(customer.price).toFixed(4)}</td>
                    <td className="px-4 py-4 text-center text-[var(--color-text-soft)]">{customer.departmentCount}</td>
                    <td className="px-4 py-4 text-xs text-[var(--color-muted)]">{formatDate(customer.registeredAt)}</td>
                    <td className="px-4 py-4"><ContractBadge customer={customer} now={now} /></td>
                    <td className="px-4 py-4">
                      <CustomerActions customer={customer} menuKey={`${customer.id}-desktop`} menuOpen={openMenuId === `${customer.id}-desktop`} onToggleMenu={() => setOpenMenuId((id) => id === `${customer.id}-desktop` ? null : `${customer.id}-desktop`)} onEdit={() => openEdit(customer)} onArchive={() => { setOpenMenuId(null); setArchiveCustomer(customer); }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-[var(--color-border)] md:hidden">
            {visibleCustomers.map((customer) => (
              <article key={customer.id} className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold text-[var(--color-text)]">{customer.name}</h2>
                    <p className="truncate font-mono text-[11px] text-[var(--color-muted)]" title={customer.id}>ID: {customer.id}</p>
                  </div>
                  <ContractBadge customer={customer} now={now} />
                </div>
                <dl className="grid grid-cols-3 gap-3 text-xs">
                  <div><dt className="text-[var(--color-muted)]">Price/GB</dt><dd className="mt-1 font-mono text-[var(--color-teal-text)]">RM {Number(customer.price).toFixed(4)}</dd></div>
                  <div><dt className="text-[var(--color-muted)]">Clusters</dt><dd className="mt-1 text-[var(--color-text-soft)]">{customer.departmentCount}</dd></div>
                  <div><dt className="text-[var(--color-muted)]">Registered</dt><dd className="mt-1 text-[var(--color-text-soft)]">{formatDate(customer.registeredAt)}</dd></div>
                </dl>
                <CustomerActions customer={customer} menuKey={`${customer.id}-mobile`} menuOpen={openMenuId === `${customer.id}-mobile`} onToggleMenu={() => setOpenMenuId((id) => id === `${customer.id}-mobile` ? null : `${customer.id}-mobile`)} onEdit={() => openEdit(customer)} onArchive={() => { setOpenMenuId(null); setArchiveCustomer(customer); }} />
              </article>
            ))}
          </div>
        </div>
      )}

      <CustomerDialog open={showForm} onClose={() => { if (!formBusy) setShowForm(false); }} title={editCustomer ? 'Edit Customer' : 'Add Customer'} description={editCustomer ? `Update ${editCustomer.name} (${editCustomer.id})` : 'Create a customer record and optional contract schedule.'} labelledBy="customer-form-title" describedBy="customer-form-description">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><label htmlFor="customer-name" className="mb-1 block text-sm text-[var(--color-muted)]">Customer name</label><input id="customer-name" type="text" value={form.cust_name} onChange={(event) => setForm((value) => ({ ...value, cust_name: event.target.value }))} className={`${controlClass} w-full`} required autoComplete="organization" placeholder="e.g. Media Prima" /></div>
          <div><label htmlFor="customer-description" className="mb-1 block text-sm text-[var(--color-muted)]">Description <span className="text-[var(--color-faint)]">(optional)</span></label><input id="customer-description" type="text" value={form.cust_description} onChange={(event) => setForm((value) => ({ ...value, cust_description: event.target.value }))} className={`${controlClass} w-full`} /></div>
          <div><label htmlFor="customer-price" className="mb-1 block text-sm text-[var(--color-muted)]">Price per GB (RM)</label><input id="customer-price" type="number" step="0.0001" min="0" value={form.price} onChange={(event) => setForm((value) => ({ ...value, price: event.target.value }))} className={`${controlClass} w-full`} required placeholder="0.0200" /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="registered-date" className="mb-1 block text-sm text-[var(--color-muted)]">Date registered</label><input id="registered-date" type="date" value={form.registeredAt} onChange={(event) => setForm((value) => ({ ...value, registeredAt: event.target.value }))} className={`${controlClass} w-full`} /></div>
            <div><label htmlFor="contract-end-date" className="mb-1 block text-sm text-[var(--color-muted)]">Contract end <span className="text-[var(--color-faint)]">(optional)</span></label><input id="contract-end-date" type="date" min={form.registeredAt || undefined} value={form.contractEndAt} onChange={(event) => setForm((value) => ({ ...value, contractEndAt: event.target.value }))} className={`${controlClass} w-full`} /></div>
          </div>
          {formError && <div role="alert" className="rounded-md border border-red-600/30 bg-red-600/10 p-3 text-sm text-[var(--color-red-text)]">{formError}</div>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" disabled={formBusy} onClick={() => setShowForm(false)} className="rounded-md px-4 py-2 text-sm text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)] disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={formBusy} className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:cursor-wait disabled:opacity-60">{formBusy ? 'Saving…' : editCustomer ? 'Save changes' : 'Add customer'}</button>
          </div>
        </form>
      </CustomerDialog>

      <CustomerDialog open={archiveCustomer !== null} onClose={() => { if (!archiveBusy) setArchiveCustomer(null); }} title="Archive customer?" description="This action removes the customer from active customer management. Existing data is retained by the system." labelledBy="archive-customer-title" describedBy="archive-customer-description" tone="danger">
        {archiveCustomer && (
          <div>
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
              <p className="font-semibold text-[var(--color-text)]">{archiveCustomer.name}</p>
              <p className="mt-0.5 font-mono text-xs text-[var(--color-muted)]">ID: {archiveCustomer.id}</p>
            </div>
            <p className="mt-4 text-sm font-medium text-[var(--color-text-soft)]">Are you sure you want to archive this customer?</p>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" disabled={archiveBusy} onClick={() => setArchiveCustomer(null)} className="rounded-md px-4 py-2 text-sm text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)] disabled:opacity-50">Keep customer</button>
              <button type="button" disabled={archiveBusy} onClick={() => void confirmArchive()} className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-wait disabled:opacity-60"><Archive className="h-4 w-4" aria-hidden="true" />{archiveBusy ? 'Archiving…' : 'Archive customer'}</button>
            </div>
          </div>
        )}
      </CustomerDialog>
    </div>
  );
}
