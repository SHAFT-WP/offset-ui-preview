// Display precision (FE) and BE output precision rules — see docs/TERMINOLOGY.md
// "Variable casing and display precision" and docs/FE-BE-RULES.md "Numeric precision".
//
// FE display (rounded): NM 1 decimal, seconds integer, feet integer, angles/headings integer,
// Mach 2 decimals, G 1 decimal, speeds (KCAS/KTAS/kt) integer.
// BE output (truncated toward zero): 5 decimals, applied once at a public BE entrypoint's result;
// internal calculation and solvers keep full precision.

export const DISPLAY_PRECISION_V0_1 = Object.freeze({
  id: "display-precision-v0.1",
  version: "0.1.0",
  digits: Object.freeze({ nm: 1, sec: 0, ft: 0, deg: 0, mach: 2, g: 1, kt: 0 }),
  beOutputDecimals: 5,
});

const finite = (value) => typeof value === "number" && Number.isFinite(value);

function fixed(value, digits) {
  if (!finite(Number(value))) return "-";
  const text = Number(value).toFixed(digits);
  // Avoid "-0" / "-0.0" after rounding a tiny negative.
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}

export const formatNm = (value) => fixed(value, 1);
export const formatSec = (value) => fixed(value, 0);
export const formatFt = (value) => fixed(value, 0);
export const formatDeg = (value) => fixed(value, 0);
export const formatMach = (value) => fixed(value, 2);
export const formatG = (value) => fixed(value, 1);
export const formatKt = (value) => fixed(value, 0);

// Signed seconds for deltas: "+3 s" style text without the unit.
export function formatSignedSec(value) {
  if (!finite(Number(value))) return "-";
  const text = formatSec(value);
  return Number(text) > 0 ? `+${text}` : text;
}

// Truncate toward zero at `decimals` places. A value whose scaled form sits within float noise
// of an integer (e.g. 1.23456 stored as 1.2345599999) keeps that integer instead of dropping a
// digit.
export function truncateDecimals(value, decimals = DISPLAY_PRECISION_V0_1.beOutputDecimals) {
  if (!finite(value)) return value;
  const scale = 10 ** decimals;
  const scaled = value * scale;
  const nearest = Math.round(scaled);
  const kept = Math.abs(scaled - nearest) < 1e-6 ? nearest : Math.trunc(scaled);
  const result = kept / scale;
  return Object.is(result, -0) ? 0 : result;
}

// Returns a structural copy of a plain BE result with every finite number truncated. Only plain
// objects and arrays are traversed; anything else (functions, class instances, frozen model
// metadata strings) is kept by reference.
export function truncateBeOutput(result, decimals = DISPLAY_PRECISION_V0_1.beOutputDecimals) {
  const seen = new WeakMap();
  const walk = (node) => {
    if (typeof node === "number") return truncateDecimals(node, decimals);
    if (!node || typeof node !== "object") return node;
    if (seen.has(node)) return seen.get(node);
    if (Array.isArray(node)) {
      const copy = [];
      seen.set(node, copy);
      node.forEach((item) => copy.push(walk(item)));
      return copy;
    }
    const proto = Object.getPrototypeOf(node);
    if (proto !== Object.prototype && proto !== null) return node;
    const copy = {};
    seen.set(node, copy);
    for (const [key, item] of Object.entries(node)) copy[key] = walk(item);
    return Object.isFrozen(node) ? Object.freeze(copy) : copy;
  };
  return walk(result);
}
