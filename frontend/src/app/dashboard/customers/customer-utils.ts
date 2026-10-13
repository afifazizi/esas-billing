export interface CustomerRecord {
  id: string;
  name: string;
  description: string | null;
  price: number;
  departmentCount: number;
  registeredAt: string | null;
  contractEndAt: string | null;
}

export type ContractHealthFilter = 'all' | 'active' | 'expiring' | 'expired';
export type CustomerSortField = 'name' | 'price' | 'departmentCount' | 'registeredAt' | 'contractEndAt';
export type SortDirection = 'asc' | 'desc';
export type ContractHealth = 'no-expiry' | 'active' | 'expiring' | 'expired';

export interface ContractStatus {
  health: ContractHealth;
  days: number | null;
  label: string;
  detail: string;
}

const DAY_MS = 86_400_000;

function utcDay(value: Date): number {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
}

function contractDay(value: string): number | null {
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnly) {
    const day = Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return Number.isNaN(day) ? null : day;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : utcDay(parsed);
}

export function getContractStatus(contractEndAt: string | null, now = new Date()): ContractStatus {
  if (!contractEndAt) {
    return { health: 'no-expiry', days: null, label: 'No expiry', detail: 'No contract end date' };
  }

  const endDay = contractDay(contractEndAt);
  if (endDay === null) {
    return { health: 'no-expiry', days: null, label: 'No expiry', detail: 'No valid contract end date' };
  }

  const days = Math.round((endDay - utcDay(now)) / DAY_MS);
  if (days < 0) {
    const elapsed = Math.abs(days);
    return {
      health: 'expired',
      days,
      label: 'Expired',
      detail: `Expired ${elapsed} ${elapsed === 1 ? 'day' : 'days'} ago`,
    };
  }
  if (days === 0) {
    return { health: 'expiring', days, label: 'Expiring', detail: 'Expires today' };
  }
  if (days <= 90) {
    return {
      health: 'expiring',
      days,
      label: 'Expiring',
      detail: `${days} ${days === 1 ? 'day' : 'days'} remaining`,
    };
  }

  return {
    health: 'active',
    days,
    label: 'Active',
    detail: `${days} days remaining`,
  };
}

export function matchesContractFilter(
  customer: CustomerRecord,
  filter: ContractHealthFilter,
  now = new Date(),
): boolean {
  if (filter === 'all') return true;
  const health = getContractStatus(customer.contractEndAt, now).health;
  if (filter === 'active') return health === 'active' || health === 'no-expiry';
  return health === filter;
}

function dateValue(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function filterAndSortCustomers(
  customers: CustomerRecord[],
  query: string,
  contractFilter: ContractHealthFilter,
  sortField: CustomerSortField,
  direction: SortDirection,
  now = new Date(),
): CustomerRecord[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const multiplier = direction === 'asc' ? 1 : -1;

  return customers
    .filter((customer) => {
      const matchesQuery = !normalizedQuery
        || customer.name.toLocaleLowerCase().includes(normalizedQuery)
        || customer.id.toLocaleLowerCase().includes(normalizedQuery);
      return matchesQuery && matchesContractFilter(customer, contractFilter, now);
    })
    .sort((a, b) => {
      let comparison = 0;
      if (sortField === 'name') comparison = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      if (sortField === 'price') comparison = Number(a.price) - Number(b.price);
      if (sortField === 'departmentCount') comparison = a.departmentCount - b.departmentCount;
      if (sortField === 'registeredAt' || sortField === 'contractEndAt') {
        const aDate = dateValue(a[sortField]);
        const bDate = dateValue(b[sortField]);
        if (aDate === null && bDate === null) comparison = 0;
        else if (aDate === null) return 1;
        else if (bDate === null) return -1;
        else comparison = aDate - bDate;
      }
      return comparison * multiplier || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
}

export function getCustomerSummary(customers: CustomerRecord[], now = new Date()) {
  return customers.reduce(
    (summary, customer) => {
      const health = getContractStatus(customer.contractEndAt, now).health;
      if (health === 'expiring') summary.expiring += 1;
      if (health === 'expired') summary.expired += 1;
      return summary;
    },
    { total: customers.length, expiring: 0, expired: 0 },
  );
}
