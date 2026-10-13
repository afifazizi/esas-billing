import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBulkSelectionState,
  MAX_BULK_REPORT_SELECTION,
  normalizeReportSelection,
  toggleReportSelection,
  toggleAllReportSelections,
} from './report-selection.ts';

test('toggles one report selection without mutating the existing selection', () => {
  const selected = ['r1'];
  assert.deepEqual(toggleReportSelection(selected, 'r2'), ['r1', 'r2']);
  assert.deepEqual(toggleReportSelection(selected, 'r1'), []);
  assert.deepEqual(selected, ['r1']);
});

test('select all selects every visible row, then clears them when all are selected', () => {
  const visible = ['r1', 'r2', 'r3'];
  assert.deepEqual(toggleAllReportSelections(['r2'], visible), ['r1', 'r2', 'r3']);
  assert.deepEqual(toggleAllReportSelections(visible, visible), []);
});

test('select all only clears visible rows and preserves selections outside the current view', () => {
  assert.deepEqual(toggleAllReportSelections(['r1', 'r2', 'other'], ['r1', 'r2']), ['other']);
});

test('individual selection cannot exceed the backend request limit', () => {
  const selected = Array.from({ length: MAX_BULK_REPORT_SELECTION }, (_, index) => `r${index}`);
  assert.deepEqual(toggleReportSelection(selected, 'overflow'), selected);
  assert.equal(toggleReportSelection(selected, 'r0').length, MAX_BULK_REPORT_SELECTION - 1);
});

test('select all caps selection at the backend request limit', () => {
  const visible = Array.from({ length: MAX_BULK_REPORT_SELECTION + 25 }, (_, index) => `r${index}`);
  const selected = toggleAllReportSelections([], visible);
  assert.equal(selected.length, MAX_BULK_REPORT_SELECTION);
  assert.deepEqual(selected, visible.slice(0, MAX_BULK_REPORT_SELECTION));
  assert.deepEqual(toggleAllReportSelections(selected, visible), []);
});

test('select all preserves an arbitrary visible selection beyond row 500 and fills remaining capacity', () => {
  const visible = Array.from({ length: 501 }, (_, index) => `r${index + 1}`);
  const selected = toggleAllReportSelections(['r501'], visible);
  assert.equal(selected.length, MAX_BULK_REPORT_SELECTION);
  assert.ok(selected.includes('r501'));
  assert.ok(!selected.includes('r500'));

  assert.deepEqual(getBulkSelectionState(selected, visible), {
    selectedVisibleCount: MAX_BULK_REPORT_SELECTION,
    visibleTargetCount: MAX_BULK_REPORT_SELECTION,
    allVisibleCapacitySelected: true,
    indeterminate: false,
    capacityReached: true,
  });
  assert.deepEqual(toggleAllReportSelections(selected, visible), []);
});

test('header state is indeterminate for any visible partial selection, including row 501', () => {
  const visible = Array.from({ length: 501 }, (_, index) => `r${index + 1}`);
  assert.deepEqual(getBulkSelectionState(['r501'], visible), {
    selectedVisibleCount: 1,
    visibleTargetCount: MAX_BULK_REPORT_SELECTION,
    allVisibleCapacitySelected: false,
    indeterminate: true,
    capacityReached: false,
  });
});

test('out-of-view selections consume capacity without being dropped', () => {
  const outside = Array.from({ length: 499 }, (_, index) => `outside-${index}`);
  assert.deepEqual(toggleAllReportSelections(outside, ['r1', 'r2']), ['r1', ...outside]);
});

test('selection normalization deduplicates and caps stale oversized state', () => {
  const oversized = Array.from({ length: 501 }, (_, index) => `r${index}`);
  assert.deepEqual(normalizeReportSelection(['r1', 'r1', 'r2']), ['r1', 'r2']);
  assert.equal(normalizeReportSelection(oversized).length, MAX_BULK_REPORT_SELECTION);
  assert.equal(toggleReportSelection(oversized, 'overflow').length, MAX_BULK_REPORT_SELECTION);
});

test('499 visible rows can all be selected and cleared', () => {
  const visible = Array.from({ length: 499 }, (_, index) => `r${index}`);
  const selected = toggleAllReportSelections([], visible);
  assert.equal(selected.length, 499);
  assert.equal(getBulkSelectionState(selected, visible).allVisibleCapacitySelected, true);
  assert.deepEqual(toggleAllReportSelections(selected, visible), []);
});

test('a full out-of-view selection leaves zero visible capacity without dropping IDs', () => {
  const outside = Array.from({ length: MAX_BULK_REPORT_SELECTION }, (_, index) => `outside-${index}`);
  assert.deepEqual(getBulkSelectionState(outside, ['r1']), {
    selectedVisibleCount: 0,
    visibleTargetCount: 0,
    allVisibleCapacitySelected: false,
    indeterminate: false,
    capacityReached: true,
  });
  assert.deepEqual(toggleAllReportSelections(outside, ['r1']), outside);
});

test('exactly 500 and plain 501 visible rows select to capacity and clear cleanly', () => {
  for (const size of [500, 501]) {
    const visible = Array.from({ length: size }, (_, index) => `r${index}`);
    const selected = toggleAllReportSelections([], visible);
    assert.equal(selected.length, MAX_BULK_REPORT_SELECTION);
    assert.equal(getBulkSelectionState(selected, visible).allVisibleCapacitySelected, true);
    assert.deepEqual(toggleAllReportSelections(selected, visible), []);
  }
});
