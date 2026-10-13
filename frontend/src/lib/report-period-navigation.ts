interface LatestPeriodDecision {
  hasExplicitPeriodParams: boolean;
  hasManualPeriodSelection: boolean;
  reportStatus?: string | null;
  requestedPeriod: string;
  latestPeriod?: string | null;
}

export function shouldSwitchToLatestPeriod({
  hasExplicitPeriodParams,
  hasManualPeriodSelection,
  reportStatus,
  requestedPeriod,
  latestPeriod,
}: LatestPeriodDecision): boolean {
  return !hasExplicitPeriodParams
    && !hasManualPeriodSelection
    && reportStatus === 'EMPTY'
    && Boolean(latestPeriod)
    && latestPeriod !== requestedPeriod;
}
