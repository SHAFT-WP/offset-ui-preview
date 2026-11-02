// Offset-only persistence. One setItem commits the whole Flight; the legacy #1
// record is migration input only. No calculations or display rounding live here.
// The record mechanics (one verified write, newer-format refusal) are the bombing app
// shared FE's (shared/save-store-v0.1.mjs, 2026-10-22).
import { isRecordObject as object, parseStoredJson as parse, readWorkRecord, writeWorkRecord } from "./shared/save-store-v0.1.mjs?v=0.1.1";
import { FORMATION_ANGLE_CONVENTION, convertOffsetDraftsFromTail } from "./shared/formation-save-v0.1.mjs?v=0.1.0";

export const OFFSET_INPUT_STORAGE_KEY = "flight-sim-tools.offset.v2.input.v1";
export const OFFSET_FLIGHT_STORAGE_KEY = "flight-sim-tools.offset.v2.flight-layout.v1";
// 4 (2026-11-02, owner): follower Formation bearings are abeam bearings (0 abeam, 90 behind, negative ahead; the record
// carries angleConvention). A version 3 record, and every older one, holds tail bearings and is converted once on read.
export const OFFSET_SAVE_SCHEMA_VERSION = 4;
const TAIL_BEARING_SCHEMA_VERSION = 3;
export const OFFSET_FORMATION_CONVERTED_NOTICE = "Loaded · Formation bearings converted to the abeam rule (0° abeam, 90° behind); Save to keep them";
// The POP-UP page (owner 2026-10-27; the Offset page in POP-UP mode) keeps its own record under its own keys.
export const POPUP_STORAGE_KEYS = Object.freeze({ input: "flight-sim-tools.popup.v2.input.v1", flight: "flight-sim-tools.popup.v2.flight-layout.v1" });
const OFFSET_STORAGE_KEYS = Object.freeze({ input: OFFSET_INPUT_STORAGE_KEY, flight: OFFSET_FLIGHT_STORAGE_KEY });

const leadValid = (value) => object(value) && object(value.inputs);
const flightValid = (value) => object(value) && Number.isInteger(value.size) && value.size >= 1 && value.size <= 4
  && (value.aircraft === undefined || object(value.aircraft));

export function readOffsetWorkSave(storage, keys = OFFSET_STORAGE_KEYS) {
  // Read the new record first: an obsolete/broken legacy #1 record must not stop
  // a complete snapshot from loading, even if that legacy key cannot be read.
  const { raw, parsed: flight, currentFormat, record } = readWorkRecord(storage, keys.flight, {
    schemaVersion: OFFSET_SAVE_SCHEMA_VERSION, valid: (value) => flightValid(value) && leadValid(value.lead),
  });
  if (currentFormat) {
    if (!record) return { lead: null, flight: null, notice: "Saved conditions could not be read; defaults loaded" };
    return { lead: record.lead, flight: record, notice: null };
  }
  // A version 3 snapshot (complete #1 + Flight, as version 4): its follower bearings are tail bearings, converted here
  // once (by its version). An unreadable one is not mixed with an older #1 record, as for the current format.
  if (object(flight) && flight.schemaVersion === TAIL_BEARING_SCHEMA_VERSION) {
    if (!flightValid(flight) || !leadValid(flight.lead)) return { lead: null, flight: null, notice: "Saved conditions could not be read; defaults loaded" };
    const converted = { ...convertOffsetDraftsFromTail(flight), schemaVersion: OFFSET_SAVE_SCHEMA_VERSION, angleConvention: FORMATION_ANGLE_CONVENTION };
    return { lead: converted.lead, flight: converted, notice: OFFSET_FORMATION_CONVERTED_NOTICE };
  }
  const leadRaw = storage.getItem(keys.input);
  const legacy = parse(leadRaw);
  const lead = legacy?.version === 4 ? legacy.aircraft?.["1"] : legacy;
  const badLead = leadRaw !== null && !leadValid(lead);
  const badFlight = raw !== null && !flightValid(flight);
  // Older layouts also hold tail bearings.
  const legacyFlight = flightValid(flight) ? convertOffsetDraftsFromTail(flight) : null;
  return {
    lead: leadValid(lead) ? lead : null,
    flight: legacyFlight,
    notice: badLead || badFlight ? "Some saved conditions could not be read; missing values use defaults. Save to replace this record"
      : legacyFlight ? OFFSET_FORMATION_CONVERTED_NOTICE : null,
  };
}

export function writeOffsetWorkSave(storage, { lead, flight }, keys = OFFSET_STORAGE_KEYS) {
  if (!leadValid(lead) || !flightValid(flight)) throw new Error("Invalid save snapshot");
  // Preserve extensions owned by the other layout (notably Standard's unmounted
  // SEM & Rejoin). Mounted extensions in `flight` replace their own saved value.
  return writeWorkRecord(storage, keys.flight, {
    schemaVersion: OFFSET_SAVE_SCHEMA_VERSION,
    build: (previous) => ({ ...(flightValid(previous) ? previous : {}), ...flight, schemaVersion: OFFSET_SAVE_SCHEMA_VERSION, angleConvention: FORMATION_ANGLE_CONVENTION, lead }),
  });
}
