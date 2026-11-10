// Cleared-field fit (owner 2026-11-10: "해당 값을 지우면 적정 값이 나타난다; 실패하면 다른 값들을 바꿔본다 (lock이 안걸린
// 놈들만)"; "offset도 같이 바꿔져야지 같은 be아냐?"). Shared by the Offset Flight and the POP-UP Flight: an emptied and
// committed field (edit kind "clear") with a candidate list is not taken back to its value from the start of the edit;
// the planner fills it.
//   0. When the aircraft flies (VALID / WARNING) with the Offset clear rule (back to the value at the start of the edit,
//      a solved field solved again), that stays: nothing changes.
//   1. The field alone: its candidate values, nearest the page default first; the first with which the aircraft flies
//      (VALID / WARNING) is taken. A field listed in `autoOnClear` goes back to AUTO instead, before any search.
//   2. When none fits: the field at its default, then one other field at a time, in the order of `order`, not LOCKed,
//      its candidates nearest its current value first; the first change that fits is taken.
//   3. Else the field at its default, with an error saying no fit was found.
// Each fill or change is a warning naming it. Fields without a candidate list keep the Offset rule (back to the value
// at the start of the edit; a Tracking Time to solved).

export const OFFSET_CLEAR_FIT_V0_1 = Object.freeze({ id: "offset-clear-fit-v0.1", version: "0.1.1" });

export const clearFitRange = (lo, hi, step) => Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => Math.round((lo + i * step) * 1000) / 1000);

const editsOf = (input) => [...(input.edit ? [input.edit] : []), ...(input.edits ?? [])];
const fmt = (v) => (Number.isFinite(v) ? (Math.abs(v) >= 100 ? Math.round(v).toLocaleString("en-US") : String(Math.round(v * 10) / 10)) : String(v));
// The geometry, altitude, angle and speed fields of a follower that belong to #1's Offset Turn: a follower does not own them.
const OFFSET_TURN_KEYS = new Set(["offsetG", "offsetBankDeg", "offsetRadiusNm", "offsetSpeedValue", "offsetAltitudeMslFt"]);

export function clearFitFieldLocked(input, n, key) {
  const record = input.aircraft[n] ?? {};
  if (n === "1") return record.locks?.[key] === true;
  return record.options?.[`${key.replace(/(Deg|Nm|MslFt|Kcas)$/, "")}Locked`] === true;
}

function withEdits(input, edits) {
  const { edit, edits: _e, ...rest } = input;
  return { ...rest, edits };
}

// The candidate nearest `from` that fits: `from` itself (when listed) first, then on each side the farthest candidate;
// a side whose farthest does not fit is skipped, else bisection toward `from` (the fit is taken as monotone along a
// side, which holds for the geometry, altitude, angle and speed fields). Each value is tried once.
export function nearestFit(candidates, from, fits) {
  const tried = new Map();
  const test = (v) => { if (!tried.has(v)) tried.set(v, fits(v)); return tried.get(v); };
  const own = candidates.find((v) => Math.abs(v - from) < 1e-9);
  if (own !== undefined && test(own)) return own;
  let best = null;
  for (const side of [candidates.filter((v) => v < from - 1e-9).sort((a, b) => b - a), candidates.filter((v) => v > from + 1e-9).sort((a, b) => a - b)]) {
    if (!side.length || !test(side[side.length - 1])) continue;
    let lo = 0;
    let hi = side.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (test(side[mid])) hi = mid; else lo = mid + 1;
    }
    if (best === null || Math.abs(side[hi] - from) < Math.abs(best - from)) best = side[hi];
  }
  return best;
}

// spec: {
//   table: { key: [label, page default, candidates] },
//   order: step 2's keys,
//   autoOnClear?: { key: [edits that put it back to AUTO] }, autoLabel?: { key: label },
//   flies?(out, n, strict): a fit (default VALID / WARNING), strict?: a first pass with flies(.., true),
//   locked?(input, n, key): LOCKed (default clearFitFieldLocked), currentValue?(out, n, key): a value not in the record,
// }
// flight(input) returns an output with aircraftResults and nextInput (the Offset Flight contract).
export function calculateWithClearFit(rawInput, flight, spec) {
  if (spec.strict) {
    const strict = clearFit(rawInput, flight, spec, true);
    if (strict.fitted) return strict.out;
  }
  return clearFit(rawInput, flight, spec, false).out;
}

function clearFit(rawInput, flight, spec, strict) {
  const { table, order, autoOnClear = {}, autoLabel = {} } = spec;
  const flies = spec.flies ?? ((out, n) => ["VALID", "WARNING"].includes(out?.aircraftResults?.[n]?.status));
  const locked = spec.locked ?? clearFitFieldLocked;
  const all = editsOf(rawInput ?? {});
  const clear = all.find((e) => e?.kind === "clear" && (table[e.key] || autoOnClear[e.key]));
  if (!clear || !rawInput?.aircraft?.[String(clear.aircraft ?? 1)]) return { fitted: true, out: flight(rawInput) };
  const n = String(clear.aircraft ?? 1);
  const number = Number(n);
  const others = all.filter((e) => e !== clear);
  const run = (input, edits) => flight(withEdits(input, [...others, ...edits]));
  const setEdit = (key) => ({ aircraft: number, kind: "set", key, commit: true });
  const setValue = (input, key, value) => {
    const next = structuredClone(input);
    next.aircraft[n].values = { ...next.aircraft[n].values, [key]: value };
    return next;
  };
  const note = (out, warning, error) => {
    const a = out.aircraftResults[n];
    if (!a) return out;
    const errors = error ? [...(a.errors ?? []), error] : a.errors ?? [];
    const warnings = warning ? [...(a.warnings ?? []), warning] : a.warnings ?? [];
    const status = errors.length ? "INVALID" : a.status === "VALID" && warnings.length ? "WARNING" : a.status;
    return { ...out, aircraftResults: { ...out.aircraftResults, [n]: { ...a, status, errors, warnings } }, clearFit: { aircraft: number, key: clear.key, ...(out.clearFit ?? {}) } };
  };
  const [label, center, candidates] = table[clear.key] ?? [autoLabel[clear.key] ?? clear.key, null, []];
  // Step 0: when the aircraft already flies with the clear rule (the value from the start of the edit, a solved field
  // solved again), that is the fit: nothing else changes (a coupled field keeps its driver). Not for AUTO fields.
  if (!autoOnClear[clear.key]) {
    const kept = flight(rawInput);
    if (flies(kept, n, strict)) return { fitted: true, out: kept };
  }
  // Step 1: AUTO for the fields listed in autoOnClear, else the field's candidates nearest its default.
  let atDefault;
  let baseInput;
  if (autoOnClear[clear.key]) {
    // The field keeps a number to start from (the value at the start of the edit, else the fallback); AUTO replaces it.
    const startValue = [clear.before?.value, clear.fallbackValue].map(Number).find(Number.isFinite);
    const autoInput = startValue === undefined ? rawInput : setValue(rawInput, clear.key, startValue);
    atDefault = run(autoInput, autoOnClear[clear.key].map((e) => ({ aircraft: number, kind: "set", commit: true, ...e })));
    baseInput = atDefault.nextInput;
    if (flies(atDefault, n, strict)) return { fitted: true, out: note(atDefault, `${label} cleared: AUTO`) };
  } else {
    const outs = new Map();
    const tryValue = (value) => {
      const out = run(setValue(rawInput, clear.key, value), [setEdit(clear.key)]);
      outs.set(value, out);
      return flies(out, n, strict);
    };
    const found = nearestFit(candidates, center, tryValue);
    atDefault = outs.get(center) ?? run(setValue(rawInput, clear.key, center), [setEdit(clear.key)]);
    baseInput = atDefault.nextInput;
    if (found !== null) return { fitted: true, out: note(outs.get(found), `${label} cleared: set to ${fmt(found)} (fits)`) };
  }
  // Step 2: one other field at a time, not LOCKed (and not #1's Offset Turn for a follower).
  for (const key of order) {
    if (key === clear.key || locked(baseInput, n, key) || (n !== "1" && OFFSET_TURN_KEYS.has(key))) continue;
    const current = Number(baseInput.aircraft[n]?.values?.[key] ?? spec.currentValue?.(atDefault, n, key));
    const [otherLabel, otherDefault, otherCandidates] = table[key];
    const from = Number.isFinite(current) ? current : otherDefault;
    const outs = new Map();
    const found = nearestFit(otherCandidates, from, (value) => {
      const out = run(setValue(baseInput, key, value), [setEdit(key)]);
      outs.set(value, out);
      return flies(out, n, strict);
    });
    if (found !== null && Math.abs(found - from) > 1e-9) {
      const first = autoOnClear[clear.key] ? `${label} cleared: AUTO` : `${label} cleared: set to ${fmt(center)}`;
      return { fitted: true, out: note(outs.get(found), `${first}; it did not fit alone, so ${otherLabel} changed ${fmt(from)} → ${fmt(found)}`) };
    }
  }
  return { fitted: false, out: note(atDefault, null, `${label} cleared: no value fits, and no single change of ${order.filter((k) => k !== clear.key).map((k) => table[k][0]).join(", ")} (not LOCKed) fits either`) };
}
