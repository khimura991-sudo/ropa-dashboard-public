// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { dayOf, workdayCalendar, topBrandModels, bigLosses, invKpis } = require('../dash-logic.js');

test('dayOf reads Excel dates, serials and text', () => {
  assert.equal(dayOf(new Date(2026, 0, 1, 23, 59, 40)), '2026-01-02'); // SheetJS stores Jan 2 a few seconds before midnight
  assert.equal(dayOf(new Date(2026, 0, 2)), '2026-01-02');
  assert.equal(dayOf(46023), '2026-01-01');
  assert.equal(dayOf('1/5/2026'), '2026-01-05');
  assert.equal(dayOf('2026-03-09'), '2026-03-09');
  assert.equal(dayOf(''), null);
  assert.equal(dayOf(null), null);
});

test('workdayCalendar: Nov 2026 starts on Sunday, weekend units move to a workday', () => {
  const days = ['2026-11-01', '2026-11-02', '2026-11-02', '2026-11-07', '2026-11-13'];
  const c = workdayCalendar(days, 2026, 10, new Date(2026, 10, 13));
  const all = c.weeks.flat().filter(Boolean);
  const mon2 = all.find((x) => x.d === 2), fri6 = all.find((x) => x.d === 6);
  assert.equal(mon2.units, 3); assert.equal(mon2.weekend, 1);
  assert.equal(fri6.units, 1); assert.equal(fri6.weekend, 1);
  assert.equal(c.total, 5);
  assert.equal(c.workdaysSoFar, 10);
  assert.equal(c.average, 0.5);
  assert.equal(c.weekendUnits, 2);
  c.weeks.forEach((w) => assert.equal(w.length, 5));
  assert.ok(!all.some((x) => x.d === 1 || x.d === 7 || x.d === 8)); // no weekend days shown
});

test('workdayCalendar: past month counts every workday', () => {
  const c = workdayCalendar([], 2026, 9, new Date(2026, 10, 13));
  assert.equal(c.workdaysSoFar, 22);
  assert.equal(c.average, 0);
  assert.equal(c.total, 0);
});

test('topBrandModels groups by brand + model in the month, sorted by units', () => {
  const fmv = { cleanBrand: (s) => s.toUpperCase(), modelOf: (s) => s.split(' ')[0].toUpperCase(), cleanSeries: (s) => s.toUpperCase() };
  const units = [
    { brand: 'toyota', series: 'vios 1.3', price: 400000, day: '2026-11-03' },
    { brand: 'toyota', series: 'vios 1.5', price: 450000, day: '2026-11-04' },
    { brand: 'ford', series: 'ranger', price: 600000, day: '2026-11-05' },
    { brand: 'ford', series: 'ranger', price: 600000, day: '2026-10-05' },
  ];
  const r = topBrandModels(units, 2026, 10, fmv);
  assert.deepEqual(r.map((x) => [x.name, x.units, x.amount]), [['TOYOTA VIOS', 2, 850000], ['FORD RANGER', 1, 600000]]);
});

test('bigLosses keeps losses of 300K or more for the month', () => {
  const top = [
    { month: 'November', gain: -300000 }, { month: 'November', gain: -299999 },
    { month: 'November', gain: -700000 }, { month: 'October', gain: -900000 },
  ];
  assert.deepEqual(bigLosses(top, 'November').map((x) => x.gain), [-700000, -300000]);
});

test('invKpis sums on hand, under legal and for sale', () => {
  const rows = [
    { status: 'UNDER LEGAL', units: 47 }, { status: 'UNDER LEGAL SPECIAL CASE - RETURNED UNITS', units: 3 },
    { status: 'FOR SALE TRANSMITTED', units: 100 }, { status: 'FOR SALE UNTRANSMITTED', units: 20 },
    { status: 'SOLD', units: 150 }, { status: 'REDEEMED', units: 9 },
  ];
  assert.deepEqual(invKpis(rows), { onHand: 170, underLegal: 50, forSale: 120 });
  assert.equal(invKpis([]), null);
  assert.equal(invKpis(null), null);
});

const { parseMarket, marketRef } = require('../dash-logic.js');
const fakeFmv = { cleanBrand: (s) => String(s).toUpperCase().trim().replace('MITSUBIHSI', 'MITSUBISHI'), modelOf: (s) => { const t = String(s).toUpperCase().split(' '); return /^[A-Z]\d$/.test(t[1] || '') ? t[0] + ' ' + t[1] : t[0]; } };

test('parseMarket maps headers in any order and cleans prices', () => {
  const rows = [
    ['asking price', 'Brand', 'MODEL', 'Year Model', 'Listing Type', 'Month', 'Link'],
    ['₱ 398,000', 'toyota', 'vios', 2020, 'Bank repo', '2026-11', 'x'],
    [470000, 'TOYOTA', 'VIOS', '2020', 'Regular used', new Date(2026, 10, 3), ''],
    ['', 'TOYOTA', 'VIOS', 2020, 'Bank repo', '2026-11', ''], // no price
    [500000, '', 'VIOS', 2020, 'Bank repo', '2026-11', ''], // no brand
  ];
  assert.deepEqual(parseMarket(rows), [
    { brand: 'toyota', model: 'vios', year: 2020, type: 'repo', price: 398000, month: '2026-11' },
    { brand: 'TOYOTA', model: 'VIOS', year: 2020, type: 'used', price: 470000, month: '2026-11' },
  ]);
  assert.deepEqual(parseMarket([]), []);
});

test('marketRef: exact year, last 3 months, median comparison', () => {
  const L = [
    { brand: 'Toyota', model: 'Vios 1.3', year: 2020, type: 'repo', price: 398000, month: '2026-11' },
    { brand: 'TOYOTA', model: 'VIOS', year: 2020, type: 'repo', price: 425000, month: '2026-09' },
    { brand: 'TOYOTA', model: 'VIOS', year: 2020, type: 'used', price: 470000, month: '2026-11' },
    { brand: 'TOYOTA', model: 'VIOS', year: 2020, type: 'repo', price: 999000, month: '2026-08' }, // too old
    { brand: 'TOYOTA', model: 'VIOS', year: 2021, type: 'repo', price: 500000, month: '2026-11' }, // other year
  ];
  const r = marketRef(L, { brand: 'TOYOTA', series: 'VIOS', year: '2020' }, fakeFmv, new Date(2026, 10, 13), 335000);
  assert.equal(r.yearNote, '');
  assert.deepEqual([r.repo.low, r.repo.high, r.repo.median, r.repo.n], [398000, 425000, 411500, 2]);
  assert.ok(Math.abs(r.repo.pct - 335000 / 411500) < 1e-9);
  assert.deepEqual([r.used.low, r.used.high, r.used.n], [470000, 470000, 1]);
});

test('marketRef: falls back to ±1 year, cleans brand/model, null when nothing matches', () => {
  const L = [{ brand: 'Mitsubihsi', model: 'Mirage G4 GLX', year: 2021, type: 'repo', price: 365000, month: '2026-11' }];
  const r = marketRef(L, { brand: 'MITSUBISHI', series: 'MIRAGE G4', year: 2022 }, fakeFmv, new Date(2026, 10, 13), 300000);
  assert.equal(r.yearNote, '±1 year');
  assert.equal(r.repo.n, 1);
  assert.equal(r.used, null);
  assert.equal(marketRef(L, { brand: 'TOYOTA', series: 'VIOS', year: 2021 }, fakeFmv, new Date(2026, 10, 13), 300000), null);
  assert.equal(marketRef([], { brand: 'TOYOTA', series: 'VIOS', year: 2021 }, fakeFmv, new Date(2026, 10, 13), 300000), null);
});
