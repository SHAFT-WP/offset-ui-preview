// Speed conversions under a speed input (owner 2026-11-24: "bdp에서 마하 설정시 아래 설명에 기존 설명대신 cas tas 값 표시,
// cas선택시 tas, mach 표시 모든 be 동일"). Every field that has a speed value and a unit select (kcas / Mach) shows,
// in place of its description line, the speed in the other units at that speed's altitude (ISA, common/airspeed):
//   Mach selected → CAS and TAS;  kcas selected → TAS and Mach.
// The altitude is the field's own: Initial Speed → Initial Altitude, Offset Speed → Offset Altitude (else the Initial
// Altitude), looked up in the same scope (a follower slot, the Design tab, else the page). The description comes back
// when there is nothing to convert. Installs itself once on import; DOM only, no calculation state.
import { casToTas, machToTas, tasToCas, tasToMach } from "../common/airspeed/airspeed-v0.1.mjs";

export const SPEED_READOUT_V0_1 = Object.freeze({ id: "speed-readout-v0.1", version: "0.1.0", refreshMs: 600 });

const SELECTS = 'select[data-key$="SpeedMode"], select[data-design-mirror$="SpeedMode"]';
const ALTITUDE_FOR = Object.freeze({ initialSpeedValue: ["initialAltitudeMslFt"], offsetSpeedValue: ["offsetAltitudeMslFt", "initialAltitudeMslFt"] });
const num = (el) => { const v = Number(String(el?.value || el?.placeholder || "").replace(/,/g, "")); return Number.isFinite(v) ? v : null; };
const fmt = (v) => Math.round(v).toLocaleString("en-US");

function altitudeFor(field, speedKey) {
  const scope = field.closest(".flight-slot, [data-design-wizard]") ?? document;
  for (const key of ALTITUDE_FOR[speedKey] ?? ["initialAltitudeMslFt"]) {
    const inScope = [...scope.querySelectorAll(`input[data-key="${key}"]`)].find((n) => scope !== document || (!n.closest(".flight-slot") && !n.closest("[data-design-wizard]")));
    const page = inScope ?? [...document.querySelectorAll(`input[data-key="${key}"]`)].find((n) => !n.closest(".flight-slot") && !n.closest("[data-design-wizard]"));
    const v = num(page);
    if (v !== null) return v;
  }
  return null;
}

// The text for one speed: { mode: "CAS" | "MACH", value, altitudeFt } → "TAS 437 kt · M 0.70 @16,000 ft", or null.
export function speedConversionText({ mode, value, altitudeFt }) {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(altitudeFt)) return null;
  try {
    if (mode === "MACH") {
      const tas = machToTas(value, altitudeFt);
      return `CAS ${fmt(tasToCas(tas, altitudeFt))} kt · TAS ${fmt(tas)} kt @${fmt(altitudeFt)} ft`;
    }
    const tas = casToTas(value, altitudeFt);
    return `TAS ${fmt(tas)} kt · M ${tasToMach(tas, altitudeFt).toFixed(2)} @${fmt(altitudeFt)} ft`;
  } catch {
    return null;
  }
}

export function refreshSpeedReadouts(root = document) {
  for (const select of root.querySelectorAll(SELECTS)) {
    const field = select.closest("label, .field");
    const input = field?.querySelector('input[data-key$="SpeedValue"]');
    if (!input) continue;
    let unit = field.querySelector(":scope > .unit");
    if (!unit) { unit = document.createElement("span"); unit.className = "unit"; field.append(unit); }
    if (!unit.hasAttribute("data-speed-description")) unit.setAttribute("data-speed-description", unit.textContent);
    const text = speedConversionText({ mode: select.value, value: num(input), altitudeFt: altitudeFor(field, input.dataset.key) });
    const next = text ?? unit.getAttribute("data-speed-description");
    if (unit.textContent !== next) unit.textContent = next;
    unit.toggleAttribute("data-speed-readout", text !== null);
  }
}

if (typeof document !== "undefined" && !globalThis.__speedReadoutInstalled) {
  globalThis.__speedReadoutInstalled = true;
  const run = () => setTimeout(() => refreshSpeedReadouts(), 0); // after the Design mirror has synced its selects
  document.addEventListener("input", run, true);
  document.addEventListener("change", run, true);
  // Values the calculation writes back (no event) are picked up by a light refresh.
  setInterval(run, SPEED_READOUT_V0_1.refreshMs);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
}
