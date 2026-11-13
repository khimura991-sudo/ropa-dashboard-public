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
