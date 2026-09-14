'use strict';

// src/jobs/billing.job.js
//
// Billing job handler: aggregates real meter readings for a billing period
// and computes charges from a configurable per-unit rate.
//
// This replaces a placeholder that returned Math.random() invoice counts and
// amounts - numbers that looked real in logs and dashboards while being pure
// fiction. The aggregation below runs off the same readings store the
// analytics endpoints serve, so billing output reconciles with what the
// dashboard shows for the same period.
//
// Billing semantics:
//  - A period covers one calendar month (data.period, e.g. "2026-09").
//  - Consumption per meter = SUM of reading values in the period.
//  - Charge per meter = consumption * ratePerUnit (data option or BILLING_RATE_PER_UNIT).
//  - data.accountId restricts billing to a single meter; omit for all meters.

const { childLogger } = require('../config/logger');
const aggregator = require('../services/aggregator');

const log = childLogger('job:billing');

const DEFAULT_RATE_PER_UNIT = parseFloat(process.env.BILLING_RATE_PER_UNIT || '0.15');

async function billingHandler(data, { signal } = {}) {
  const { period, accountId } = data || {};

  if (!period || !/^\d{4}-\d{2}$/.test(period)) {
    throw new Error('billing job requires data.period as "YYYY-MM"');
  }

  const ratePerUnit =
    data.ratePerUnit !== undefined && data.ratePerUnit !== null
      ? Number(data.ratePerUnit)
      : DEFAULT_RATE_PER_UNIT;
  if (!Number.isFinite(ratePerUnit) || ratePerUnit < 0) {
    throw new Error(`billing job received invalid ratePerUnit: ${data.ratePerUnit}`);
  }

  log.info({ period, accountId: accountId || 'all', ratePerUnit }, 'Starting billing job');

  // Calendar month window for the period, in UTC.
  const startDate = `${period}-01T00:00:00.000Z`;
  const monthNumber = parseInt(period.slice(5, 7), 10);
  const year = parseInt(period.slice(0, 4), 10);
  const endDate = new Date(Date.UTC(year, monthNumber, 1)).toISOString();

  if (signal && signal.aborted) {
    throw new Error('Billing job aborted before aggregation');
  }

  // Pull the period's readings (single meter or the whole fleet).
  const filters = { startDate, endDate };
  if (accountId) {
    filters.meterIds = [accountId];
  }
  const readings = aggregator.getReadings(filters);

  if (readings.length === 0) {
    log.warn({ period, accountId: accountId || 'all' }, 'No readings in billing period');
    return {
      period,
      accountId: accountId || 'all',
      ratePerUnit,
      invoicesGenerated: 0,
      totalAmount: '0.00',
      totalConsumption: 0,
      invoices: [],
      processedAt: new Date().toISOString(),
      empty: true,
    };
  }

  // Group consumption per meter.
  const perMeter = new Map();
  for (const reading of readings) {
    const meterId = reading.meterId;
    const value = Number(reading.value) || 0;
    perMeter.set(meterId, (perMeter.get(meterId) || 0) + value);
  }

  const invoices = [];
  let totalConsumption = 0;
  let totalAmount = 0;

  for (const [meterId, consumption] of perMeter) {
    const amount = consumption * ratePerUnit;
    totalConsumption += consumption;
    totalAmount += amount;
    invoices.push({
      meterId,
      consumption: Number(consumption.toFixed(3)),
      ratePerUnit,
      amount: Number(amount.toFixed(2)),
      period,
    });
  }

  if (signal && signal.aborted) {
    throw new Error('Billing job aborted during aggregation');
  }

  const result = {
    period,
    accountId: accountId || 'all',
    ratePerUnit,
    invoicesGenerated: invoices.length,
    totalConsumption: Number(totalConsumption.toFixed(3)),
    totalAmount: totalAmount.toFixed(2),
    invoices,
    processedAt: new Date().toISOString(),
    empty: false,
  };

  log.info(
    {
      period,
      invoicesGenerated: result.invoicesGenerated,
      totalAmount: result.totalAmount,
    },
    'Billing job completed'
  );

  return result;
}

module.exports = billingHandler;
