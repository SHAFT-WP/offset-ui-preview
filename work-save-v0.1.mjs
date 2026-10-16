// Offset-only persistence. One setItem commits the whole Flight; the legacy #1
// record is migration input only. No calculations or display rounding live here.
export const OFFSET_INPUT_STORAGE_KEY = "flight-sim-tools.offset.v2.input.v1";
export const OFFSET_FLIGHT_STORAGE_KEY = "flight-sim-tools.offset.v2.flight-layout.v1";
export const OFFSET_SAVE_SCHEMA_VERSION = 3;

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const leadValid = (value) => object(value) && object(value.inputs);
const flightValid = (value) => object(value) && Number.isInteger(value.size) && value.size >= 1 && value.size <= 4
  && (value.aircraft === undefined || object(value.aircraft));
const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };

export function readOffsetWorkSave(storage) {
  // Read the new record first: an obsolete/broken legacy #1 record must not stop
  // a complete snapshot from loading, even if that legacy key cannot be read.
  const raw = storage.getItem(OFFSET_FLIGHT_STORAGE_KEY);
  const flight = parse(raw);
  if (object(flight) && flight.schemaVersion >= OFFSET_SAVE_SCHEMA_VERSION) {
    if (flight.schemaVersion !== OFFSET_SAVE_SCHEMA_VERSION || !flightValid(flight) || !leadValid(flight.lead)) {
      return { lead: null, flight: null, notice: "Saved conditions could not be read; defaults loaded" };
    }
    return { lead: flight.lead, flight, notice: null };
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
  const previous = parse(storage.getItem(OFFSET_FLIGHT_STORAGE_KEY));
  if (object(previous) && previous.schemaVersion > OFFSET_SAVE_SCHEMA_VERSION) {
    throw new Error("Saved conditions use a newer format; reload the latest app before saving");
  }
  // Preserve extensions owned by the other layout (notably Standard's unmounted
  // SEM & Rejoin). Mounted extensions in `flight` replace their own saved value.
  const record = {
    ...(flightValid(previous) ? previous : {}), ...flight,
    schemaVersion: OFFSET_SAVE_SCHEMA_VERSION, lead,
  };
  const text = JSON.stringify(record);
  // Web Storage setItem is atomic: a quota/security error leaves the previous
  // complete record intact. There is no second write and no cross-key rollback.
  storage.setItem(OFFSET_FLIGHT_STORAGE_KEY, text);
  if (storage.getItem(OFFSET_FLIGHT_STORAGE_KEY) !== text) {
    // Do not overwrite a possible newer save from another tab with a rollback.
    throw new Error("Could not verify the saved conditions; please save again");
  }
  return record;
}
