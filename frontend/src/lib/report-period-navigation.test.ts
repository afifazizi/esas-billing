import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldSwitchToLatestPeriod } from './report-period-navigation.ts';

test('initial empty report view may open latest available period', () => {
  assert.equal(shouldSwitchToLatestPeriod({
    hasExplicitPeriodParams: false,
    hasManualPeriodSelection: false,
    reportStatus: 'EMPTY',
    requestedPeriod: '2026-07',
    latestPeriod: '2026-05',
  }), true);
});

test('manual selection keeps an empty future period available for upload', () => {
  assert.equal(shouldSwitchToLatestPeriod({
    hasExplicitPeriodParams: false,
    hasManualPeriodSelection: true,
    reportStatus: 'EMPTY',
    requestedPeriod: '2026-07',
    latestPeriod: '2026-05',
  }), false);
});

test('explicit month and year parameters keep the requested empty period', () => {
  assert.equal(shouldSwitchToLatestPeriod({
    hasExplicitPeriodParams: true,
    hasManualPeriodSelection: false,
    reportStatus: 'EMPTY',
    requestedPeriod: '2026-07',
    latestPeriod: '2026-05',
  }), false);
});
