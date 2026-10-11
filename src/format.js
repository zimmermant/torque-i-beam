export const I_HAT = 'î';
export const J_HAT = 'ĵ';
export const K_HAT = 'k̂';
const MINUS = '−';

// The only way a number reaches the screen. Rounds here and nowhere else; a
// null or non-finite value prints as a dash; and negative zero can never
// appear, because String(-0) is "0" and Number("-0.00") is -0.
export function fmt(n, dp = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const s = String(Number(n.toFixed(dp)));
  return s.startsWith('-') ? MINUS + s.slice(1) : s;
}

export function fmtAngle(a) {
  return a === null || a === undefined ? '—' : `${fmt(a)}°`;
}

// "30 î + 40 ĵ N" -- the sign between the terms follows the ROUNDED y, so a
// y that prints as 0 never shows as "- 0".
export function vecText(v, unit) {
  const ry = Number(v.y.toFixed(2));
  const sign = ry < 0 ? MINUS : '+';
  const tail = unit ? ` ${unit}` : '';
  return `${fmt(v.x)} ${I_HAT} ${sign} ${fmt(Math.abs(v.y))} ${J_HAT}${tail}`;
}

export function parenthesized(n) {
  return `(${fmt(n)})`;
}
