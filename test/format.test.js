import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmt, fmtAngle, vecText, parenthesized, I_HAT, J_HAT, K_HAT } from '../src/format.js';

// Mutation: returning n.toFixed(2) directly prints "-0.00" for -0.001 and
// "30.00" for 30.
test('fmt trims zeros, uses a true minus sign, and never prints negative zero', () => {
  assert.strictEqual(fmt(30.000000000000004), '30');
  assert.strictEqual(fmt(1.5), '1.5');
  assert.strictEqual(fmt(-1.5), '−1.5');
  assert.strictEqual(fmt(-0), '0');
  assert.strictEqual(fmt(-0.001), '0');
  assert.strictEqual(fmt(0.004), '0');
  assert.strictEqual(fmt(53.13010235415598), '53.13');
  assert.strictEqual(fmt(2.675), '2.67');          // toFixed, not Math.round: documented
  assert.ok(!fmt(-0.0049).includes('-') && !fmt(-0.0049).includes('−'));
});

test('fmt prints a dash for null, undefined and non-finite values', () => {
  for (const v of [null, undefined, NaN, Infinity]) assert.strictEqual(fmt(v), '—');
  assert.strictEqual(fmtAngle(null), '—');
  assert.strictEqual(fmtAngle(53.13010235), '53.13°');
});

test('vecText writes i-hat and j-hat, with the sign following the ROUNDED y', () => {
  assert.strictEqual(vecText({ x: 30, y: 40 }, 'N'), `30 ${I_HAT} + 40 ${J_HAT} N`);
  assert.strictEqual(vecText({ x: -30, y: -40 }, 'N'), `−30 ${I_HAT} − 40 ${J_HAT} N`);
  assert.strictEqual(vecText({ x: 1.5, y: 0 }, 'm'), `1.5 ${I_HAT} + 0 ${J_HAT} m`);
  // y = -0.001 rounds to 0, so it must print "+ 0", not "- 0"
  assert.strictEqual(vecText({ x: 1, y: -0.001 }, 'm'), `1 ${I_HAT} + 0 ${J_HAT} m`);
  assert.strictEqual(vecText({ x: 1, y: 2 }), `1 ${I_HAT} + 2 ${J_HAT}`);
});

test('the hats are the right characters and parenthesized wraps a formatted number', () => {
  assert.strictEqual(I_HAT, 'î');
  assert.strictEqual(J_HAT, 'ĵ');
  assert.strictEqual(K_HAT, 'k̂');
  assert.strictEqual(parenthesized(-1.5), '(−1.5)');
  assert.strictEqual(parenthesized(-0), '(0)');
});
