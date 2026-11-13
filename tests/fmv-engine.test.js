// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const FMV = require('../fmv-engine.js');

const u = (brand, series, product, year, price) => ({ brand, series, product, body: 'Sedan', trans: 'Automatic / Gas', cond: 'Minor issues', year, km: 50000, price, month: 320 });
const m = FMV.prepare([
  u('TOYOTA', 'VIOS 1.3 E', 'CAR FINANCING', 2020, 400000), u('TOYOTA', 'VIOS', 'CAR FINANCING', 2021, 420000),
  u('TOYOTA', 'VIOS', 'CAR REFINANCING', 2021, 410000), u('ISUZU', 'GIGA', 'TRUCK REFINANCING', 2020, 1500000),
]);

test('productsFor lists the product types a brand + model was sold under, most first', () => {
  assert.deepEqual(FMV.productsFor(m, 'TOYOTA', 'VIOS'), ['CAR FINANCING', 'CAR REFINANCING']);
  assert.deepEqual(FMV.productsFor(m, 'Toyota', 'Vios 1.5 G'), ['CAR FINANCING', 'CAR REFINANCING']); // cleaned like the estimator
  assert.equal(FMV.productsFor(m, 'TOYOTA', 'NEVER SOLD'), null); // unknown model: no restriction
  assert.equal(FMV.productsFor(m, '', ''), null);
});

test('valuesFor lists body types and transmissions a brand + model was sold with, skipping "Not specified"', () => {
  const m2 = FMV.prepare([
    { brand: 'TOYOTA', series: 'VIOS', product: 'CAR FINANCING', body: 'Sedan', trans: 'Automatic / Gas', cond: '', year: 2020, km: 0, price: 400000, month: 320 },
    { brand: 'TOYOTA', series: 'VIOS', product: 'CAR FINANCING', body: 'SEDAN', trans: 'MANUAL GAS', cond: '', year: 2020, km: 0, price: 380000, month: 320 },
    { brand: 'TOYOTA', series: 'VIOS', product: 'CAR FINANCING', body: 'Sedan', trans: 'Automatic / Gas', cond: '', year: 2021, km: 0, price: 420000, month: 320 },
    { brand: 'TOYOTA', series: 'VIOS', product: 'CAR FINANCING', body: 'Sedan', trans: '', cond: '', year: 2021, km: 0, price: 410000, month: 320 },
    { brand: 'ISUZU', series: 'GIGA', product: 'TRUCK FINANCING', body: 'DUMP TRUCK', trans: 'Manual / Diesel', cond: '', year: 2020, km: 0, price: 1500000, month: 320 },
  ]);
  assert.deepEqual(FMV.valuesFor(m2, 'TOYOTA', 'VIOS', 'body'), ['Sedan']);
  assert.deepEqual(FMV.valuesFor(m2, 'TOYOTA', 'VIOS', 'trans'), ['Automatic / Gas', 'Manual / Gas']);
  assert.deepEqual(FMV.valuesFor(m2, 'TOYOTA', 'VIOS', 'product'), ['CAR FINANCING']);
  assert.equal(FMV.valuesFor(m2, 'TOYOTA', 'NEVER SOLD', 'body'), null);
});
