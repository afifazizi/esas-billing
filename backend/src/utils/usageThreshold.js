export const BYTES_PER_GB = 1073741824n;

export function billableUsageBytes(value) {
  const bytes = BigInt(value ?? 0n);
  return bytes > BYTES_PER_GB ? bytes : 0n;
}

export function billableUsageGb(value) {
  return Math.ceil(Number(billableUsageBytes(value)) / Number(BYTES_PER_GB));
}

export function exactBillableUsageGb(value) {
  return Number(billableUsageBytes(value)) / Number(BYTES_PER_GB);
}

export function sumBillableUsageBytes(values, select = (value) => value) {
  return values.reduce((sum, value) => sum + billableUsageBytes(select(value)), 0n);
}

export function billableUsageFilter() {
  return { gt: BYTES_PER_GB };
}
