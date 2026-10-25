// The BDP tab of a bombing page (bombing app shared FE, owner 2026-10-25: "the BDP list is one shared
// implementation"; shared SPEC "BDP tab composition"). Markup and display rules only: the page owns its record, its
// BE input and what a Default returns to; the BE decides every value. Every field carries `data-key` (the Flight
// record key), so a page's pattern tab can show the same field again (BDP Profile, Roll-in) and both are one value.
//
// Composition (owner 2026-10-25), in this order; Full BDP Off shows 1, 2, 4 and 5:
//   1 Target Elevation/Bomb type · 2 Wind · 3 BDP Profile (Full) · 4 Roll-in Turn · 5 Turn Onset · 6 SEM / Recovery (Full)
// The SEM Turn sits inside SEM / Recovery with no heading of its own: Level SEM → the SEM Turn choice and its fields;
// CSEM → CSEM Target FPA. The head reads "BDP #n" over the note "BDP : Bomb Delivery Planner"; the page puts the
// Full BDP toggle immediately before Tab Default (installSectionTools with ["fullBdp", "default"]).

export const BDP_TAB_V0_1 = Object.freeze({ id: "bombing-bdp-tab-v0.1", version: "0.1.0" });

export const BDP_TAB_NOTE = "BDP : Bomb Delivery Planner";

const esc = (text) => String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);

// A text field: [key, label, unit note, options].
function field(key, label, note = "", { extraClass = "", attrs = "", placeholder = "", readonly = false, lock = null, link = null } = {}) {
  const title = lock || link
    ? `<span class="lock-title"><span>${label}</span>${lock ? `<button class="lock-button" type="button" data-lock-key="${lock}" aria-label="Lock ${esc(label)}" aria-pressed="false">LOCK</button>` : ""}${link ? `<button class="lock-button" type="button" data-link-key="${link}" aria-label="Link ${esc(label)} to Roll-in Altitude" aria-pressed="true">LINKED</button>` : ""}</span>`
    : `<span>${label}</span>`;
  const input = `<input data-key="${key}" type="text" inputmode="decimal"${placeholder ? ` placeholder="${esc(placeholder)}"` : ""}${readonly ? " readonly data-bdp-result" : ""}>`;
  return `<label class="field${extraClass ? ` ${extraClass}` : ""}"${attrs}>${title}${input}${note ? `<span class="unit">${note}</span>` : ""}</label>`;
}

function select(key, label, options, note = "", { extraClass = "", attrs = "" } = {}) {
  const list = options.map(([value, text]) => `<option value="${esc(value)}">${text}</option>`).join("");
  return `<label class="field${extraClass ? ` ${extraClass}` : ""}"${attrs}><span>${label}</span><select data-key="${key}">${list}</select>${note ? `<span class="unit">${note}</span>` : ""}</label>`;
}

const group = (title, body, { full = false, attrs = "" } = {}) =>
  `<div class="bdp-tab-group${full ? " bdp-full-only bdp-extra" : ""}"${attrs}><h3 class="input-group-title">${title}</h3><div class="input-grid">${body}</div></div>`;

// ---- Field sets a pattern tab shows again ----------------------------------------------------------------------

// BDP Profile (group 3; the pattern tab's own copy). angleOff: { value, note } for a fixed Angle-Off shown read only
// (BOX 90°), { key } for the pattern's own Angle-Off field (Offset Geometry), or null (no Angle-Off row).
export function bdpProfileFieldsMarkup({ angleOff = null } = {}) {
  const speed = `<label class="field speed-field"><span>Initial Speed</span><span class="compound"><input data-key="initialSpeedValue" type="text" inputmode="decimal"><select data-key="initialSpeedMode"><option value="CAS">kcas</option><option value="MACH">Mach</option></select></span><span class="unit">Roll-in start speed</span></label>`;
  const angle = !angleOff ? ""
    : angleOff.key ? field(angleOff.key, "Angle-Off (deg)", angleOff.note ?? "Approaching Heading → Attack Heading")
      : `<label class="field"><span>Angle-Off (deg)</span><output class="readout" data-bdp-fixed="angleOffDeg">${esc(angleOff.value)}</output><span class="unit">${angleOff.note ?? "Fixed by the pattern"}</span></label>`;
  return speed
    + field("initialAltitudeMslFt", "Initial Altitude (ft MSL)", `<span data-initial-link-note>Linked to Roll-in Altitude</span>`, { link: "rollInAltitudeLinked" })
    + field("rollInAltitudeMslFt", "Roll-in Altitude (ft MSL)", "OA1 / BDP entry altitude · LOCK: Tracking Time → Release Alt", { lock: "rollInAltitudeMslFt" })
    + field("diveAngleDeg", "Dive Angle (deg)", "BDP parameter", { lock: "diveAngleDeg" })
    + field("trackingTimeSec", "Tracking Time (sec)", "Track Point → Release · 0.1 s")
    + field("releaseAltitudeMslFt", "Release Altitude (ft MSL)", "NLT clamp is BDP-owned")
    + field("releaseSpeedKcas", "Release Speed (kcas)", "Release speed")
    + angle;
}

// Roll-in Turn (group 4; Offset's tab calls its copy "Roll-in Condition"). The Roll-In Bank is BDP v0.4's result.
export function rollInTurnFieldsMarkup() {
  return field("rollInBankAngleDeg", "Roll-In Bank Angle (deg)", "Result · solved by BDP (Roll-in model B)", { readonly: true })
    + field("rollInG", "Roll-in G (G)", "BDP roll-in input");
}

// Turn Onset (group 5): one set per aircraft, flown by the Roll-in, the pattern's Level Turns and the SEM Turn
// (owner 2026-10-23 / 25, option A). turnNote names the pattern's turns.
export function turnOnsetFieldsMarkup({ turnNote = "pattern Level Turns", extraClass = "" } = {}) {
  return field("rollInRollRateDegSec", "Roll-in Rate (deg/s)", `Roll-in, ${turnNote} and SEM Turn roll · linear`, { extraClass })
    + field("rollOutRollRateDegSec", "Roll-out Rate (deg/s)", "Roll-out · linear", { extraClass })
    + field("gOnsetRateGSec", "G Onset Rate (G/s)", `Roll-in, ${turnNote} and SEM Turn pull · linear`, { extraClass });
}

// SEM / Recovery (group 6) with the SEM Turn inside it.
export function semRecoveryFieldsMarkup() {
  return select("semEnd", "SEM End", [["LEVEL", "Level (pull to FPA 0°, then 1 G)"], ["CLIMB", "CSEM (climb to Target FPA)"]], "Every BDP view flies this SEM")
    + select("semTurnType", "SEM Turn", [["LEVEL", "Level turn (bank AUTO)"], ["SLICE", "Slice (entered bank, descends)"]], "Right at the level-off · speed and G held · Roll-in onsets", { attrs: " data-level-sem-only" })
    + select("semTurnDirection", "Turn Direction", [["", "Roll-in direction"], ["LEFT", "Left"], ["RIGHT", "Right"]], "Blank: this aircraft's Roll-in side", { attrs: " data-level-sem-only" })
    + field("semTurnDeg", "Turn Amount (deg)", "Heading change · 0 = no turn · up to 360", { attrs: " data-level-sem-only" })
    + field("semTurnG", "Turn G (G)", "Sustained · blank: Recovery G", { attrs: " data-level-sem-only", placeholder: "Recovery G" })
    + field("semTurnSpeedKcas", "Turn Speed (kcas)", "Held · blank: the level-off speed", { attrs: " data-level-sem-only", placeholder: "Level-off" })
    + `<label class="field" data-level-sem-only data-sem-turn-level-only><span>Turn Bank</span><output data-sem-turn-auto-bank>AUTO</output><span class="unit">Level turn: acos(1/G)</span></label>`
    + field("semTurnBankDeg", "Turn Bank (deg)", "Slice: above acos(1/G), up to 150° · G held, the nose falls · then a pull to level at G", { attrs: " data-level-sem-only data-sem-turn-slice-only" })
    + field("csemTargetFpaDeg", "CSEM Target FPA (deg)", "Flight path angle, &gt; 20° and &lt; 90° · G falls linearly from +20°", { attrs: " data-csem-only" })
    + field("recoveryG", "Recovery G (G)", "V2 canonical safety input")
    + field("gOnsetTimeSec", "G Onset Time (sec)", "V2 SEM/NLT input · onset starts at Release")
    + field("speedOvershootKcas", "Speed Overshoot (kcas)", "BDP safety input")
    + field("fragmentHeightMarginPercent", "Fragment Height Margin (%)", "");
}

// ---- The whole tab ---------------------------------------------------------------------------------------------

// The BDP section's content (head + groups) of aircraft `number`. weapons: [{ id, label }] for the Bomb select.
// angleOff: as bdpProfileFieldsMarkup. turnNote: as turnOnsetFieldsMarkup. targetNote: the Target Elevation note.
export function bdpTabMarkup({ number = 1, weapons = [], angleOff = null, turnNote, targetNote = "Target MSL" } = {}) {
  const bomb = `<label class="field"><span>Bomb</span><select data-key="weaponId">${weapons.map((weapon) => `<option value="${esc(weapon.id)}">${esc(weapon.label ?? weapon.id)}</option>`).join("")}</select><span class="unit">BDP weapon database</span></label>`;
  return `<div class="section-head"><div class="bdp-tab-head"><h2 id="bdp-title-${number}">BDP #${number}</h2><p class="bdp-tab-note">${BDP_TAB_NOTE}</p></div></div>`
    + group("Target Elevation/Bomb type", field("targetElevationMslFt", "Target Elevation (ft MSL)", targetNote) + bomb)
    + group("Wind", field("windDirectionDeg", "Wind Direction FROM (deg)", "TRUE · wind FROM") + field("windSpeedKt", "Wind Speed (kt)", ""))
    + group("BDP Profile", bdpProfileFieldsMarkup({ angleOff }), { full: true })
    + group("Roll-in Turn", rollInTurnFieldsMarkup())
    + group("Turn Onset", turnOnsetFieldsMarkup({ turnNote }))
    + `<div class="bdp-tab-group bdp-full-only bdp-extra"><h3 class="input-group-title">SEM / Recovery</h3><div class="input-grid">${semRecoveryFieldsMarkup()}</div><div data-sem-readouts></div></div>`;
}

// Record keys of the BDP tab (its Tab Default restores these). Angle-Off is the pattern's, never the BDP tab's.
export const BDP_TAB_KEYS = Object.freeze([
  "targetElevationMslFt", "weaponId", "windDirectionDeg", "windSpeedKt",
  "initialSpeedValue", "initialSpeedMode", "initialAltitudeMslFt", "rollInAltitudeMslFt", "diveAngleDeg", "trackingTimeSec", "releaseAltitudeMslFt", "releaseSpeedKcas",
  "rollInG", "rollInRollRateDegSec", "rollOutRollRateDegSec", "gOnsetRateGSec",
  "semEnd", "semTurnType", "semTurnDirection", "semTurnDeg", "semTurnG", "semTurnSpeedKcas", "semTurnBankDeg", "csemTargetFpaDeg",
  "recoveryG", "gOnsetTimeSec", "speedOvershootKcas", "fragmentHeightMarginPercent",
]);

// Display digits of the BDP values a solve writes back or a page shows (docs/TERMINOLOGY.md): ft and degrees integer,
// G and Tracking Time one decimal. Initial Speed in Mach shows two decimals (initialSpeedText).
export const BDP_FIELD_DIGITS = Object.freeze({
  targetElevationMslFt: 0, windDirectionDeg: 0, windSpeedKt: 0, initialAltitudeMslFt: 0, rollInAltitudeMslFt: 0, diveAngleDeg: 0,
  trackingTimeSec: 1, releaseAltitudeMslFt: 0, releaseSpeedKcas: 0, rollInBankAngleDeg: 0, rollInG: 1,
});

// Shows only the fields of the chosen SEM (owner 2026-10-18 / 19 / 25): CSEM → CSEM Target FPA; Level → the SEM Turn
// with its Level / Slice bank row.
export function syncSemChoices(root, { semEnd, semTurnType }) {
  const climb = semEnd === "CLIMB";
  const slice = semTurnType === "SLICE";
  root.querySelectorAll("[data-csem-only], [data-level-sem-only], [data-sem-turn-level-only], [data-sem-turn-slice-only]").forEach((node) => {
    node.hidden = (node.hasAttribute("data-csem-only") && !climb)
      || (node.hasAttribute("data-level-sem-only") && climb)
      || (node.hasAttribute("data-sem-turn-level-only") && slice)
      || (node.hasAttribute("data-sem-turn-slice-only") && !slice);
  });
}

// LINK buttons (`[data-link-key]`, every copy) and the Initial Altitude note.
export function syncLinkButtons(root, state) {
  root.querySelectorAll("[data-link-key]").forEach((button) => {
    const on = state[button.dataset.linkKey] !== false;
    button.setAttribute("aria-pressed", String(on));
    button.textContent = on ? "LINKED" : "LINK";
  });
  root.querySelectorAll("[data-initial-link-note]").forEach((note) => {
    note.textContent = state.rollInAltitudeLinked !== false ? "Linked to Roll-in Altitude" : "Reference only (not linked)";
  });
}
