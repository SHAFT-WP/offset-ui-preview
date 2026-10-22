// Flight composition (Flight Bombing Tactics, since 2026-10-22, from the Offset Flight entrypoint): the flight-level
// mechanics a pattern's Flight entrypoint is built from. The Flight structure (#1 and its followers, element leads,
// wingmen), reading the input records (a record that cannot be read fails only its aircraft and goes back
// unchanged), the one-shot edit events (applied in order, each aircraft's errors kept), per-aircraft reuse of a
// solve keyed by its full dependencies, the editing session (sub-solve cache, reuse, idle preparation, counters) and
// the drop-order timing walk (#n against #n-1). Pure: no DOM, window, storage or FE import. Every tactical meaning
// (what a record holds, what an edit does, what an aircraft reads from the ones before it, how a drop-order delta
// is measured) is the pattern's, passed in.
import { calculationCacheStats, calculationKey, createCalculationCache, snapshotCalculationCacheStats, withCalculationCache } from "../../common/calculation/calculation-cache-v0.1.mjs";

export const FLIGHT_COMPOSITION_V0_1 = Object.freeze({ id: "flight-composition-v0.1", version: "0.1.0", status: "work" });

// ---- Flight structure -----------------------------------------------------------------------------------------
// A Flight of 1–4. Element lead (formation reference, inherited values) vs drop-order predecessor (n - 1): #2 and #3
// fly off #1, #4 off #3; #3 releases after #2. #2 and #4 are wingmen.
export const FLIGHT_MAX_SIZE = 4;
export const FLIGHT_FOLLOWERS = Object.freeze([2, 3, 4]);
export const FLIGHT_ELEMENT_LEAD = Object.freeze({ 2: 1, 3: 1, 4: 3 });
export const FLIGHT_WINGMEN = Object.freeze([2, 4]);

// ---- Input records --------------------------------------------------------------------------------------------
// The Flight input: { schemaVersion?, flightSize (1–4, default 1), aircraft: { 1: lead record, 2–4: follower
// records } }. normalizeLead / normalizeFollower read one record (throwing when it cannot be read). The source is
// copied first, so the input is never mutated. A record that cannot be read fails that aircraft: { raw } goes back
// unchanged in the next input (never silently replaced by defaults), with its message in stateErrors.
export function readFlightRecords(input, { schemaVersion, normalizeLead, normalizeFollower }) {
  if (!input || typeof input !== "object") throw new TypeError("input must be an object");
  if (input.schemaVersion !== undefined && input.schemaVersion !== schemaVersion) {
    throw new TypeError(`schemaVersion ${input.schemaVersion} is not supported`);
  }
  const flightSize = input.flightSize ?? 1;
  if (!Number.isInteger(flightSize) || flightSize < 1 || flightSize > FLIGHT_MAX_SIZE) throw new RangeError("flightSize must be an integer from 1 to 4");
  const source = structuredClone(input.aircraft ?? {});
  if (!source[1] || typeof source[1] !== "object") throw new TypeError("aircraft[1] is required");
  const aircraft = {};
  const stateErrors = {};
  const normalize = (number, fn) => {
    try { aircraft[number] = fn(source[number]); }
    catch (error) { stateErrors[number] = error.message; aircraft[number] = { raw: source[number] }; }
  };
  normalize(1, normalizeLead);
  for (const number of FLIGHT_FOLLOWERS) if (source[number]) normalize(number, normalizeFollower);
  return { flightSize, aircraft, stateErrors };
}

// ---- One-shot edit events -------------------------------------------------------------------------------------
// `edit` (one event) and `edits` (the ordered events of one coalesced FE request) are the same contract: each event
// is a state transition on the record left by the previous one, then the final state is solved once.
export function flightEditEvents(input) {
  if (input.edit && input.edits) throw new TypeError("input carries both edit and edits; send one ordered edits list");
  if (input.edits !== undefined && !Array.isArray(input.edits)) throw new TypeError("edits must be an array");
  return input.edits ?? (input.edit ? [input.edit] : []);
}

// Applies the events in order through applyEdit(number, edit) (the pattern's state transition; event.aircraft
// defaults to #1). An aircraft whose state cannot be read, or whose earlier event failed, takes no further event.
// Returns the edit errors by aircraft.
export function applyFlightEdits(aircraft, edits, applyEdit) {
  const editErrors = {};
  for (const edit of edits) {
    const number = edit?.aircraft ?? 1;
    if (!aircraft[number]) throw new TypeError(`edit targets missing aircraft #${number}`);
    if (aircraft[number].raw || editErrors[number]) continue;
    try {
      applyEdit(number, edit);
    } catch (error) {
      editErrors[number] = error.message;
    }
  }
  return editErrors;
}

// ---- Per-aircraft reuse ---------------------------------------------------------------------------------------
// One aircraft's heavy solve is a pure function of its own record after the call's edit events, its state error and
// what it reads from the aircraft before it (the pattern's leader views). The key is exactly that (exact
// serialization) plus the pattern's model key, so a reused solve is the one a fresh solve would return. A failure is
// reused only for the identical input, never an earlier success for a changed one.
export function aircraftSolveKey(modelKey, number, record, stateError, leaders) {
  return calculationKey({ model: modelKey, number, record, stateError: stateError ?? null, leaders });
}

// solve() returns { entry, record }: the aircraft's result entry and its record after the solve. memo: the
// session's { solves (Map, oldest first), solveLimit }, or null (no reuse). A hit hands out a copy and becomes the
// newest; a store keeps a copy and drops the oldest beyond the limit.
export function reusedSolve(memo, keyOf, solve) {
  const solves = memo?.solves;
  if (!solves) return { ...solve(), reused: false };
  const key = keyOf();
  const stored = solves.get(key);
  if (stored) {
    solves.delete(key);
    solves.set(key, stored);
    return { ...structuredClone(stored), reused: true };
  }
  const solved = solve();
  solves.set(key, structuredClone(solved));
  while (solves.size > memo.solveLimit) solves.delete(solves.keys().next().value);
  return { ...solved, reused: false };
}

// ---- Editing session ------------------------------------------------------------------------------------------
// calculateFlight(input, memo) → { output, solveLog } is the pattern's Flight calculation; the session runs it with
// its own sub-solve cache and per-aircraft memo, so a call re-solves only the aircraft whose dependencies changed.
// Its output equals the pattern's fresh calculation for every input. The page holds the session as an opaque handle
// (in the Worker).
export function createFlightSession(calculateFlight, { solveLimit = 48, cacheLimits = {} } = {}) {
  const memo = { solves: new Map(), solveLimit, cache: createCalculationCache({ limits: cacheLimits }) };
  let last = null;
  return Object.freeze({
    calculate(input) {
      const before = snapshotCalculationCacheStats(memo.cache);
      const started = performance.now();
      const { output, solveLog } = withCalculationCache(memo.cache, () => calculateFlight(input, memo));
      last = { solveLog, subSolves: calculationCacheStats(memo.cache, before), beMs: performance.now() - started };
      return output;
    },
    // Idle-time preparation: the page sends each returned state back as its next input, and a record a solve just
    // wrote its derived values into is a new input once. Solving that returned state ahead of time (output
    // discarded, counters untouched) makes the page's next request reuse it. Returns which aircraft it solved.
    prepare(nextInput) {
      const { solveLog } = withCalculationCache(memo.cache, () => calculateFlight(nextInput, memo));
      return solveLog;
    },
    // Counters of the last calculate(): which aircraft were solved or reused, sub-solve calls, hits and misses
    // (real executions), and the BE time. Diagnostics only, not output.
    lastStats() {
      return last && structuredClone(last);
    },
    clear() {
      memo.solves.clear();
      memo.cache = createCalculationCache({ limits: cacheLimits });
      last = null;
    },
  });
}

// ---- Drop-order timing ----------------------------------------------------------------------------------------
// #n against its drop-order predecessor #n-1, for #2..#flightSize. results[n].result is an aircraft's result;
// delta({ predecessorResult, ownResult }) is the pattern's measure. Without both results: not available, with the
// cause.
export function dropOrderTiming(flightSize, results, delta) {
  const timing = {};
  for (let number = 2; number <= flightSize; number += 1) {
    const predecessor = number - 1;
    const own = results[number]?.result;
    const previous = results[predecessor]?.result;
    if (!own || !previous) {
      timing[number] = { aircraft: number, predecessor, available: false, cause: !previous ? `Aircraft #${predecessor} has no current result` : `Aircraft #${number} has no current result` };
      continue;
    }
    timing[number] = { aircraft: number, predecessor, available: true, ...delta({ predecessorResult: previous, ownResult: own }) };
  }
  return timing;
}
