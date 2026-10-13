export type ReportLifecycleStatus = 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'LOCKED';
export type LifecycleRole = 'admin' | 'user' | 'customer_viewer';

export interface LifecycleAction {
  target: ReportLifecycleStatus;
  label: string;
  description: string;
  requiresReason: boolean;
  tone: 'primary' | 'success' | 'warning';
}

const VALID_STATUSES = new Set<ReportLifecycleStatus>([
  'DRAFT',
  'REVIEWED',
  'APPROVED',
  'LOCKED',
]);

export function normalizeLifecycleStatus(value?: string | null): ReportLifecycleStatus {
  const normalized = String(value || 'DRAFT').toUpperCase() as ReportLifecycleStatus;
  return VALID_STATUSES.has(normalized) ? normalized : 'DRAFT';
}

export function isPeriodMutable(status?: string | null): boolean {
  const normalized = normalizeLifecycleStatus(status);
  return normalized !== 'APPROVED' && normalized !== 'LOCKED';
}

export function getLifecycleActions(
  status: string | null | undefined,
  role: LifecycleRole,
  hasReportRows: boolean,
): LifecycleAction[] {
  if (role === 'customer_viewer') return [];

  const normalized = normalizeLifecycleStatus(status);

  if (normalized === 'DRAFT') {
    if (!hasReportRows) return [];
    return [{
      target: 'REVIEWED',
      label: 'Submit for review',
      description: 'Mark this report package as ready for administrative review.',
      requiresReason: false,
      tone: 'primary',
    }];
  }

  if (role !== 'admin') return [];

  if (normalized === 'REVIEWED') {
    return [
      {
        target: 'APPROVED',
        label: 'Approve report',
        description: 'Approve this report package and block data-changing operations.',
        requiresReason: false,
        tone: 'success',
      },
      {
        target: 'DRAFT',
        label: 'Return to draft',
        description: 'Return the report for correction. A reason is required.',
        requiresReason: true,
        tone: 'warning',
      },
    ];
  }

  if (normalized === 'APPROVED') {
    return [
      {
        target: 'LOCKED',
        label: 'Lock period',
        description: 'Close the billing period and preserve the approved package.',
        requiresReason: false,
        tone: 'success',
      },
      {
        target: 'DRAFT',
        label: 'Reopen report',
        description: 'Reopen the approved package for correction. A reason is required.',
        requiresReason: true,
        tone: 'warning',
      },
    ];
  }

  return [{
    target: 'DRAFT',
    label: 'Reopen locked period',
    description: 'Unlock and return this billing period to draft. A reason is required.',
    requiresReason: true,
    tone: 'warning',
  }];
}
