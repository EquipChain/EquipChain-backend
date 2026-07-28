#!/usr/bin/env node

/**
 * Seed Script — Sample Meter Readings
 *
 * Generates 90 days of synthetic meter reading data across 3 meters.
 * Each meter records ~24 readings per day at semi-random intervals,
 * producing realistic consumption patterns with daily and seasonal variation.
 *
 * Usage:
 *   node scripts/seed-readings.js
 *
 * The seed data is loaded automatically when the server starts in development
 * mode (NODE_ENV !== 'production'). To disable auto-seeding, set SKIP_SEED=1.
 */

const { addReadings, readingCount } = require('../src/services/aggregator');

const METERS = [
  { id: 'METER-001', name: 'Main Building', baseLoad: 150 },
  { id: 'METER-002', name: 'Warehouse', baseLoad: 80 },
  { id: 'METER-003', name: 'Office Wing', baseLoad: 100 },
];

/**
 * Generate a reading value with some randomness and time-of-day pattern.
 * @param {number} baseLoad - Base consumption in kWh
 * @param {number} hour - Hour of day (0-23)
 * @returns {number}
 */
function generateValue(baseLoad, hour) {
  // Morning ramp (6-9), peak (10-16), evening decline (17-22), night low (23-5)
  let multiplier;
  if (hour >= 6 && hour <= 9) {
    multiplier = 0.7 + Math.random() * 0.4; // 0.7–1.1
  } else if (hour >= 10 && hour <= 11) {
    multiplier = 0.9 + Math.random() * 0.5; // 0.9–1.4
  } else if (hour >= 12 && hour <= 16) {
    multiplier = 1.0 + Math.random() * 0.6; // 1.0–1.6
  } else if (hour >= 17 && hour <= 19) {
    multiplier = 0.8 + Math.random() * 0.4; // 0.8–1.2
  } else if (hour >= 20 && hour <= 22) {
    multiplier = 0.5 + Math.random() * 0.3; // 0.5–0.8
  } else {
    multiplier = 0.1 + Math.random() * 0.2; // 0.1–0.3 (night)
  }

  return Math.round(baseLoad * multiplier * 10) / 10;
}

/**
 * Generate 90 days of readings for all meters.
 * @returns {number} Total readings generated
 */
function seedReadings() {
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - 90);
  startDate.setUTCHours(0, 0, 0, 0);

  const totalReadings = 90 * METERS.length * 24; // ~6480 readings
  const batch = [];

  for (let day = 0; day < 90; day++) {
    const date = new Date(startDate);
    date.setUTCDate(date.getUTCDate() + day);

    for (const meter of METERS) {
      for (let hour = 0; hour < 24; hour++) {
        const timestamp = new Date(date);
        timestamp.setUTCHours(hour, Math.floor(Math.random() * 60), 0, 0);

        batch.push({
          meterId: meter.id,
          timestamp: timestamp.getTime(),
          value: generateValue(meter.baseLoad, hour),
          unit: 'kWh',
        });
      }
    }
  }

  addReadings(batch);
  return batch.length;
}

// Run directly
if (require.main === module) {
  const before = readingCount();
  const count = seedReadings();
  console.log(`Seeded ${count} readings across ${METERS.length} meters.`);
  console.log(`Total readings in store: ${readingCount()}`);
}

module.exports = { seedReadings, METERS };
