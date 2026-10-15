// Call-scoped calculation reuse (Offset BE performance addendum 2026-10-12, P1/P2).
//
// A BE entrypoint that owns a calculation (for example one Offset Flight call, or one Offset
// editing session) creates a cache and runs its work inside withCalculationCache(). While that runs,
// a pure sub-calculation wrapped in cachedCalculation() is executed once per exact argument set and
// reused afterwards. Outside an owning entrypoint nothing is cached: every existing public function
// keeps its contract and its cost.
//
// Rules (SPEC.md next to this file):
// - The key is every real argument plus the model/version of the calculation, serialized exactly
//   (no rounding; -0, NaN and Infinity keep their identity). Equal key = same result.
// - A thrown calculation is not stored and the next call runs it again, unless the error is marked
//   `cacheable` (a deterministic failure of the same input, 0.1.1): that error is stored and rethrown.
// - The cache never hands out a shared object: it stores a copy and every hit returns a fresh copy,
//   so a later result assembly can never change what another candidate or call sees.
// - Bounded per namespace (least recently used entry dropped first).
// - No DOM, storage or FE import. The active cache is set only for the duration of the owning call
//   (synchronous; restored in finally), so no result leaks into an unrelated call.

// 0.1.1 (2026-10-15): an error marked `cacheable === true` is stored and rethrown on a hit (BDP v0.4 Roll-in
// "no solution" during Offset scans); every other throw is still never stored.
export const CALCULATION_CACHE_V0_1 = Object.freeze({ id: "calculation-cache-v0.1", version: "0.1.1" });

const DEFAULT_LIMIT = 512;

let activeCache = null;

export function createCalculationCache({ limits = {}, defaultLimit = DEFAULT_LIMIT } = {}) {
  return { entries: new Map(), limits: { ...limits }, defaultLimit, stats: {} };
}

// Runs fn with `cache` active; null runs it with no reuse at all (a verification reference).
export function withCalculationCache(cache, fn) {
  const previous = activeCache;
  activeCache = cache ?? null;
  try {
    return fn();
  } finally {
    activeCache = previous;
  }
}

export function activeCalculationCache() {
  return activeCache;
}

// Exact, order-independent key of plain data (objects sorted by key, undefined members dropped as
// the canonical BE inputs treat them as missing).
export function calculationKey(value) {
  if (value === null) return "null";
  switch (typeof value) {
    case "number": return Object.is(value, -0) ? "-0" : String(value);
    case "string": return JSON.stringify(value);
    case "boolean": return value ? "true" : "false";
    case "undefined": return "undefined";
    case "bigint": return `${value}n`;
    case "object": {
      if (Array.isArray(value)) return `[${value.map(calculationKey).join(",")}]`;
      if (value instanceof Set) return `Set[${[...value].map(calculationKey).sort().join(",")}]`;
      if (value instanceof Map) return `Map[${[...value].map(([k, v]) => `${calculationKey(k)}:${calculationKey(v)}`).sort().join(",")}]`;
      const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${calculationKey(value[key])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`calculationKey cannot serialize a ${typeof value}`);
  }
}

function namespaceStats(cache, namespace) {
  cache.stats[namespace] ??= { calls: 0, hits: 0, misses: 0, errors: 0 };
  return cache.stats[namespace];
}

// Runs compute() once per exact `keyParts` inside the active cache; without one it just runs it.
export function cachedCalculation(namespace, keyParts, compute) {
  const cache = activeCache;
  if (!cache) return compute();
  const stats = namespaceStats(cache, namespace);
  stats.calls += 1;
  const key = calculationKey(keyParts);
  let entries = cache.entries.get(namespace);
  if (!entries) {
    entries = new Map();
    cache.entries.set(namespace, entries);
  }
  if (entries.has(key)) {
    stats.hits += 1;
    const stored = entries.get(key);
    // Refresh recency.
    entries.delete(key);
    entries.set(key, stored);
    if (stored.thrown) throw stored.thrown;
    return structuredClone(stored.value);
  }
  stats.misses += 1;
  let value;
  try {
    value = compute();
  } catch (error) {
    stats.errors += 1;
    if (error?.cacheable === true) store(cache, namespace, entries, key, { thrown: error });
    throw error;
  }
  store(cache, namespace, entries, key, { value: structuredClone(value) });
  return value;
}

function store(cache, namespace, entries, key, entry) {
  entries.set(key, entry);
  const limit = cache.limits[namespace] ?? cache.defaultLimit;
  while (entries.size > limit) entries.delete(entries.keys().next().value);
}

// Counters per namespace since the cache was created (or since the given snapshot).
export function calculationCacheStats(cache, since = null) {
  const out = {};
  for (const [namespace, stats] of Object.entries(cache?.stats ?? {})) {
    const base = since?.[namespace] ?? { calls: 0, hits: 0, misses: 0, errors: 0 };
    out[namespace] = { calls: stats.calls - base.calls, hits: stats.hits - base.hits, misses: stats.misses - base.misses, errors: stats.errors - base.errors };
  }
  return out;
}

export function snapshotCalculationCacheStats(cache) {
  return structuredClone(cache?.stats ?? {});
}
