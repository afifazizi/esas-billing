export const MAX_BULK_REPORT_SELECTION = 500;

export type BulkSelectionState = {
  selectedVisibleCount: number;
  visibleTargetCount: number;
  allVisibleCapacitySelected: boolean;
  indeterminate: boolean;
  capacityReached: boolean;
};

export function normalizeReportSelection(
  selectedIds: string[],
  maxSelection = MAX_BULK_REPORT_SELECTION,
): string[] {
  return [...new Set(selectedIds)].slice(0, maxSelection);
}

export function toggleReportSelection(
  selectedIds: string[],
  reportId: string,
  maxSelection = MAX_BULK_REPORT_SELECTION,
): string[] {
  const selected = normalizeReportSelection(selectedIds, maxSelection);
  if (selected.includes(reportId)) {
    return selected.filter((id) => id !== reportId);
  }

  return selected.length >= maxSelection
    ? selected
    : [...selected, reportId];
}

export function getBulkSelectionState(
  selectedIds: string[],
  visibleIds: string[],
  maxSelection = MAX_BULK_REPORT_SELECTION,
): BulkSelectionState {
  const selected = normalizeReportSelection(selectedIds, maxSelection);
  const visible = [...new Set(visibleIds)];
  const visibleSet = new Set(visible);
  const selectedVisibleCount = selected.filter((id) => visibleSet.has(id)).length;
  const outsideVisibleCount = selected.length - selectedVisibleCount;
  const visibleTargetCount = Math.min(visible.length, Math.max(0, maxSelection - outsideVisibleCount));
  const allVisibleCapacitySelected = visibleTargetCount > 0
    && selectedVisibleCount === visibleTargetCount;

  return {
    selectedVisibleCount,
    visibleTargetCount,
    allVisibleCapacitySelected,
    indeterminate: selectedVisibleCount > 0 && !allVisibleCapacitySelected,
    capacityReached: selected.length >= maxSelection,
  };
}

export function toggleAllReportSelections(
  selectedIds: string[],
  visibleIds: string[],
  maxSelection = MAX_BULK_REPORT_SELECTION,
): string[] {
  const selected = normalizeReportSelection(selectedIds, maxSelection);
  const visible = [...new Set(visibleIds)];
  const visibleSet = new Set(visible);
  const outsideVisible = selected.filter((id) => !visibleSet.has(id));
  const selectedVisible = new Set(selected.filter((id) => visibleSet.has(id)));
  const targetCount = Math.min(visible.length, Math.max(0, maxSelection - outsideVisible.length));

  if (targetCount === 0 || selectedVisible.size === targetCount) {
    return outsideVisible;
  }

  const fillCount = targetCount - selectedVisible.size;
  const fill = visible.filter((id) => !selectedVisible.has(id)).slice(0, fillCount);
  const nextVisible = visible.filter((id) => selectedVisible.has(id) || fill.includes(id));
  return [...nextVisible, ...outsideVisible];
}
