// Offset-only persistence. One setItem commits the whole Flight; the legacy #1
// record is migration input only. No calculations or display rounding live here.
// The record mechanics (one verified write, newer-format refusal) are the bombing app
// shared FE's (shared/save-store-v0.1.mjs, 2026-10-22).
import { isRecordObject as object, parseStoredJson as parse, readWorkRecord, writeWorkRecord } from "./shared/save-store-v0.1.mjs?v=0.1.1";

export const OFFSET_INPUT_STORAGE_KEY = "flight-sim-tools.offset.v2.input.v1";
export const OFFSET_FLIGHT_STORAGE_KEY = "flight-sim-tools.offset.v2.flight-layout.v1";
export const OFFSET_SAVE_SCHEMA_VERSION = 3;

const leadValid = (value) => object(value) && object(value.inputs);
const flightValid = (value) => object(value) && Number.isInteger(value.size) && value.size >= 1 && value.size <= 4
  && (value.aircraft === undefined || object(value.aircraft));

export function readOffsetWorkSave(storage) {
  // Read the new record first: an obsolete/broken legacy #1 record must not stop
  // a complete snapshot from loading, even if that legacy key cannot be read.
  const { raw, parsed: flight, currentFormat, record } = readWorkRecord(storage, OFFSET_FLIGHT_STORAGE_KEY, {
    schemaVersion: OFFSET_SAVE_SCHEMA_VERSION, valid: (value) => flightValid(value) && leadValid(value.lead),
  });
  if (currentFormat) {
    if (!record) return { lead: null, flight: null, notice: "Saved conditions could not be read; defaults loaded" };
    return { lead: record.lead, flight: record, notice: null };
  }
  const leadRaw = storage.getItem(OFFSET_INPUT_STORAGE_KEY);
  const legacy = parse(leadRaw);
  const lead = legacy?.version === 4 ? legacy.aircraft?.["1"] : legacy;
  const badLead = leadRaw !== null && !leadValid(lead);
  const badFlight = raw !== null && !flightValid(flight);
  return {
    lead: leadValid(lead) ? lead : null,
    flight: flightValid(flight) ? flight : null,
    notice: badLead || badFlight ? "Some saved conditions could not be read; missing values use defaults. Save to replace this record" : null,
  };
}

export function writeOffsetWorkSave(storage, { lead, flight }) {
  if (!leadValid(lead) || !flightValid(flight)) throw new Error("Invalid save snapshot");
  // Preserve extensions owned by the other layout (notably Standard's unmounted
  // SEM & Rejoin). Mounted extensions in `flight` replace their own saved value.
  return writeWorkRecord(storage, OFFSET_FLIGHT_STORAGE_KEY, {
    schemaVersion: OFFSET_SAVE_SCHEMA_VERSION,
    build: (previous) => ({ ...(flightValid(previous) ? previous : {}), ...flight, schemaVersion: OFFSET_SAVE_SCHEMA_VERSION, lead }),
  });
}
