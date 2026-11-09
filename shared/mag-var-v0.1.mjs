// Magnetic Var (bombing app shared FE, owner 2026-11-09). Every heading and bearing the bombing pages take and show is
// magnetic, like the F-16's HUD, HSI and HSD. Falcon BMS's DED offset pages (VIP / VRP / VIPPUP / VRPPUP / OA1 / OA2
// TBRG) take a true bearing (TO 1F-16CM/AM-34-1-1 BMS, BMS 4.38, §4.2.2.2.1.2.2–4), so the DED boxes show
// TBRG = magnetic bearing + variation (east positive). The variation is one choice for the whole calculator, kept in
// this browser, and shown beside the choice. There is no "off" (owner 2026-11-09): Korea is the default.
//
// Values (east positive, degrees):
// - Korea −7.5 (7.5°W): read on the BMS 4.38 cockpit MAGV page (LIST → 0 → 2) by the owner, 2026-11-09. BMS's own
//   Korea map spans about 6.1–10.5°W across the theater; this is one representative value, not the value at the target.
// - Israel +5.0, Balkans +5.2: PROVISIONAL real-world values (Israel 3.95–4.85°E in 2014, rising; Sarajevo +5.2°,
//   WMM2025), not yet read in BMS. Replace with the cockpit MAGV reading when available.
export const MAG_VAR_V0_1 = Object.freeze({ id: "bombing-mag-var-v0.1", version: "0.1.0" });

export const MAG_VAR_STORAGE_KEY = "flight-sim-tools.bombing.mag-var.v1";

export const MAG_VAR_THEATERS = Object.freeze([
  Object.freeze({ id: "KOREA", label: "Korea", deg: -7.5, source: "BMS MAGV" }),
  Object.freeze({ id: "ISRAEL", label: "Israel", deg: 5.0, source: "provisional" }),
  Object.freeze({ id: "BALKANS", label: "Balkans", deg: 5.2, source: "provisional" }),
]);

export const MAG_VAR_DEFAULT = "KOREA";
const theaterOf = (id) => MAG_VAR_THEATERS.find((theater) => theater.id === id) ?? MAG_VAR_THEATERS.find((theater) => theater.id === MAG_VAR_DEFAULT);
const normalizeDeg = (value) => ((value % 360) + 360) % 360;

// "7.5°W", "5.0°E", "0.0°"; no value → "—".
export function magVarText(deg) {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return "—";
  if (Math.abs(deg) < 0.05) return "0.0°";
  return `${Math.abs(deg).toFixed(1)}°${deg < 0 ? "W" : "E"}`;
}

// True bearing from a magnetic one: T = M + variation (east positive). No variation → the bearing unchanged.
export function trueFromMagneticDeg(magneticDeg, varDeg) {
  if (!Number.isFinite(magneticDeg)) return magneticDeg;
  if (varDeg === null || varDeg === undefined || !Number.isFinite(varDeg)) return magneticDeg;
  return normalizeDeg(magneticDeg + varDeg);
}

// ---- the calculator's one choice ----------------------------------------------------------------------------------
let current = MAG_VAR_DEFAULT;
const listeners = new Set();

function storage() {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
function readStored() {
  try { const value = storage()?.getItem(MAG_VAR_STORAGE_KEY); return theaterOf(value).id; } catch { return MAG_VAR_DEFAULT; }
}
current = readStored();

export function currentMagVar() {
  const theater = theaterOf(current);
  return { id: theater.id, label: theater.label, deg: theater.deg, source: theater.source, text: magVarText(theater.deg) };
}
export const currentMagVarDeg = () => theaterOf(current).deg;

export function setMagVar(id, { persist = true } = {}) {
  const next = theaterOf(id).id;
  if (persist) { try { storage()?.setItem(MAG_VAR_STORAGE_KEY, next); } catch { /* storage refused: the choice lasts this page */ } }
  if (next === current) return;
  current = next;
  listeners.forEach((listener) => listener(currentMagVar()));
}
export function onMagVarChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }

// The DED basis line: what the TBRG rows hold.
export function dedBasisText(magVar = currentMagVar()) {
  return magVar.deg === null
    ? "TBRG = magnetic (no Magnetic Var)"
    : `TBRG = true · Magnetic Var ${magVar.label} ${magVar.text}${magVar.source === "provisional" ? " (provisional)" : ""}`;
}

// ---- the Advanced field -------------------------------------------------------------------------------------------
export function magVarFieldMarkup({ extraClass = "advanced-only" } = {}) {
  const options = MAG_VAR_THEATERS.map((theater) => `<option value="${theater.id}">${theater.label}</option>`).join("");
  return `<label class="field${extraClass ? ` ${extraClass}` : ""}"><span>Magnetic Var <span class="adv-tag">ADV</span></span><select data-mag-var-select aria-label="Magnetic Var theater">${options}</select><span class="unit" data-mag-var-value>${magVarText(theaterOf(MAG_VAR_DEFAULT).deg)}</span></label>`;
}

function syncFields(root) {
  const magVar = currentMagVar();
  root.querySelectorAll("[data-mag-var-select]").forEach((select) => { if (select.value !== magVar.id) select.value = magVar.id; });
  root.querySelectorAll("[data-mag-var-value]").forEach((node) => {
    node.textContent = `${magVar.text} · ${magVar.source} · DED TBRG = M ${magVar.deg < 0 ? "−" : "+"} ${Math.abs(magVar.deg).toFixed(1)}`;
  });
}

let installed = false;
// Wires every Magnetic Var field in the page (also ones added later, through event delegation) and keeps them and
// other open pages of the calculator in step.
export function installMagVarFields(root = typeof document === "undefined" ? null : document) {
  if (!root || installed) return;
  installed = true;
  root.addEventListener("change", (event) => {
    const select = event.target.closest?.("[data-mag-var-select]");
    if (select) setMagVar(select.value);
  });
  onMagVarChange(() => syncFields(root));
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (event) => { if (event.key === MAG_VAR_STORAGE_KEY) setMagVar(event.newValue ?? MAG_VAR_DEFAULT, { persist: false }); });
  }
  syncFields(root);
}
export const syncMagVarFields = (root = document) => syncFields(root);
