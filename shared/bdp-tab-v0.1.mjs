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
//
// 0.1.1 (2026-10-26, Offset index): the follower form (`follower`) for a page whose #2–#4 own their BDP values, and
// a LOCK on the pattern's Angle-Off copy (angleOff.lock). Without `follower` the markup is 0.1.0's.
//   follower: { leadNumber, lockKeys: { fieldKey: optionKey }, linkKey, followKeys }
//   - every field is [data-flight-field] (the page's follower record key) instead of [data-key];
//   - a LOCK / LINK button is [data-flight-field] with the page's option key (lockKeys, linkKey);
//   - a key in followKeys follows the element lead while blank: its note ([data-follow-note]) is the page's;
//   - SEM End / SEM Turn start with "Follow #lead"; Initial Speed is KCAS only;
//   - Wind is the Flight's (#1's), a readout ([data-flight-readout="wind"]) the page fills.

export const BDP_TAB_V0_1 = Object.freeze({ id: "bombing-bdp-tab-v0.1", version: "0.1.1" });

export const BDP_TAB_NOTE = "BDP : Bomb Delivery Planner";

const esc = (text) => String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);

// The record attribute of a field: [data-key] (one record) or [data-flight-field] (a follower).
const keyAttr = (key, follower) => (follower ? `data-flight-field="${key}"` : `data-key="${key}"`);
// LOCK / LINK buttons: [data-lock-key] / [data-link-key] on one record; the page's option key on a follower.
function lockButton(lock, label, follower) {
  const option = follower ? follower.lockKeys?.[lock] : lock;
  if (!option) return "";
  return `<button class="lock-button" type="button" ${follower ? `data-flight-field="${option}"` : `data-lock-key="${lock}"`} aria-label="Lock ${esc(label)}" aria-pressed="false">LOCK</button>`;
}
function linkButton(link, label, follower) {
  const option = follower ? follower.linkKey : link;
  if (!option) return "";
  return `<button class="lock-button" type="button" ${follower ? `data-flight-field="${option}"` : `data-link-key="${link}"`} aria-label="Link ${esc(label)} to Roll-in Altitude" aria-pressed="true">LINKED</button>`;
}
const follows = (key, follower) => !!follower?.followKeys?.includes(key);

// A text field: [key, label, unit note, options].
function field(key, label, note = "", { extraClass = "", attrs = "", placeholder = "", readonly = false, lock = null, link = null, follower = null } = {}) {
  const buttons = (lock ? lockButton(lock, label, follower) : "") + (link ? linkButton(link, label, follower) : "");
  const title = buttons ? `<span class="lock-title"><span>${label}</span>${buttons}</span>` : `<span>${label}</span>`;
  const input = `<input ${keyAttr(key, follower)} type="text" inputmode="decimal"${placeholder ? ` placeholder="${esc(placeholder)}"` : ""}${readonly ? " readonly data-bdp-result" : ""}>`;
  const unit = follows(key, follower) ? `<span class="unit" data-follow-note></span>` : note ? `<span class="unit">${note}</span>` : "";
  return `<label class="field${extraClass ? ` ${extraClass}` : ""}"${attrs}>${title}${input}${unit}</label>`;
}

// A follower's SEM End / SEM Turn may follow its element lead (blank).
function select(key, label, options, note = "", { extraClass = "", attrs = "", follower = null, followChoice = false } = {}) {
  const choices = follower && followChoice ? [["", `Follow #${follower.leadNumber}`], ...options] : options;
  const list = choices.map(([value, text]) => `<option value="${esc(value)}">${text}</option>`).join("");
  return `<label class="field${extraClass ? ` ${extraClass}` : ""}"${attrs}><span>${label}</span><select ${keyAttr(key, follower)}>${list}</select>${note ? `<span class="unit">${note}</span>` : ""}</label>`;
}

const group = (title, body, { full = false, attrs = "" } = {}) =>
  `<div class="bdp-tab-group${full ? " bdp-full-only bdp-extra" : ""}"${attrs}><h3 class="input-group-title">${title}</h3><div class="input-grid">${body}</div></div>`;

// ---- Field sets a pattern tab shows again ----------------------------------------------------------------------

// BDP Profile (group 3; the pattern tab's own copy). angleOff: { value, note } for a fixed Angle-Off shown read only
// (BOX 90°), { key, note, lock } for the pattern's own Angle-Off field (Offset Geometry; lock: its LOCK too), or null
// (no Angle-Off row).
export function bdpProfileFieldsMarkup({ angleOff = null, follower = null } = {}) {
  const speed = follower
    ? field("initialSpeedValue", "Initial Speed (kcas)", "Roll-in start speed", { follower })
    : `<label class="field speed-field"><span>Initial Speed</span><span class="compound"><input data-key="initialSpeedValue" type="text" inputmode="decimal"><select data-key="initialSpeedMode"><option value="CAS">kcas</option><option value="MACH">Mach</option></select></span><span class="unit">Roll-in start speed</span></label>`;
  const angle = !angleOff ? ""
    : angleOff.key ? field(angleOff.key, "Angle-Off (deg)", angleOff.note ?? "Approaching Heading → Attack Heading", { lock: angleOff.lock ? angleOff.key : null, follower })
      : `<label class="field"><span>Angle-Off (deg)</span><output class="readout" data-bdp-fixed="angleOffDeg">${esc(angleOff.value)}</output><span class="unit">${angleOff.note ?? "Fixed by the pattern"}</span></label>`;
  return speed
    + field("initialAltitudeMslFt", "Initial Altitude (ft MSL)", `<span data-initial-link-note>Linked to Roll-in Altitude</span>`, { link: "rollInAltitudeLinked", follower })
    + field("rollInAltitudeMslFt", "Roll-in Altitude (ft MSL)", "OA1 / BDP entry altitude · LOCK: Tracking Time → Release Alt", { lock: "rollInAltitudeMslFt", follower })
    + field("diveAngleDeg", "Dive Angle (deg)", "BDP parameter", { lock: "diveAngleDeg", follower })
    + field("trackingTimeSec", "Tracking Time (sec)", "Track Point → Release · 0.1 s", { follower })
    + field("releaseAltitudeMslFt", "Release Altitude (ft MSL)", "NLT clamp is BDP-owned", { follower })
    + field("releaseSpeedKcas", "Release Speed (kcas)", "Release speed", { follower })
    + angle;
}

// Roll-in Turn (group 4; Offset's tab calls its copy "Roll-in Condition"). The Roll-In Bank is BDP v0.4's result.
export function rollInTurnFieldsMarkup({ follower = null } = {}) {
  return field("rollInBankAngleDeg", "Roll-In Bank Angle (deg)", "Result · solved by BDP (Roll-in model B)", { readonly: true, follower })
    + field("rollInG", "Roll-in G (G)", "BDP roll-in input", { follower });
}

// Turn Onset (group 5): one set per aircraft, flown by the Roll-in, the pattern's Level Turns and the SEM Turn
// (owner 2026-10-23 / 25, option A). turnNote names the pattern's turns.
export function turnOnsetFieldsMarkup({ turnNote = "pattern Level Turns", extraClass = "", follower = null } = {}) {
  return field("rollInRollRateDegSec", "Roll-in Rate (deg/s)", `Roll-in, ${turnNote} and SEM Turn roll · linear`, { extraClass, follower })
    + field("rollOutRollRateDegSec", "Roll-out Rate (deg/s)", "Roll-out · linear", { extraClass, follower })
    + field("gOnsetRateGSec", "G Onset Rate (G/s)", `Roll-in, ${turnNote} and SEM Turn pull · linear`, { extraClass, follower });
}

// SEM / Recovery (group 6) with the SEM Turn inside it.
export function semRecoveryFieldsMarkup({ follower = null } = {}) {
  const level = { attrs: " data-level-sem-only", follower };
  return select("semEnd", "SEM End", [["LEVEL", "Level (pull to FPA 0°, then 1 G)"], ["CLIMB", "CSEM (climb to Target FPA)"]], "Every BDP view flies this SEM", { follower, followChoice: true })
    + select("semTurnType", "SEM Turn", [["LEVEL", "Level turn (bank AUTO)"], ["SLICE", "Slice (entered bank, descends)"]], "Right at the level-off · speed and G held · Roll-in onsets", { ...level, followChoice: true })
    + select("semTurnDirection", "Turn Direction", [["", "Roll-in direction"], ["LEFT", "Left"], ["RIGHT", "Right"]], follower ? "This aircraft's own · blank: its Roll-in side" : "Blank: this aircraft's Roll-in side", level)
    + field("semTurnDeg", "Turn Amount (deg)", "Heading change · 0 = no turn · up to 360", level)
    + field("semTurnG", "Turn G (G)", "Sustained · blank: Recovery G", { ...level, placeholder: "Recovery G" })
    + field("semTurnSpeedKcas", "Turn Speed (kcas)", "Held · blank: the level-off speed", { ...level, placeholder: "Level-off" })
    + `<label class="field" data-level-sem-only data-sem-turn-level-only><span>Turn Bank</span><output data-sem-turn-auto-bank>AUTO</output><span class="unit">Level turn: acos(1/G)</span></label>`
    + field("semTurnBankDeg", "Turn Bank (deg)", "Slice: above acos(1/G), up to 150° · G held, the nose falls · then a pull to level at G", { attrs: " data-level-sem-only data-sem-turn-slice-only", follower })
    + field("csemTargetFpaDeg", "CSEM Target FPA (deg)", "Flight path angle, &gt; 20° and &lt; 90° · G falls linearly from +20°", { attrs: " data-csem-only", follower })
    + field("recoveryG", "Recovery G (G)", "V2 canonical safety input", { follower })
    + field("gOnsetTimeSec", "G Onset Time (sec)", "V2 SEM/NLT input · onset starts at Release", { follower })
    + field("speedOvershootKcas", "Speed Overshoot (kcas)", "BDP safety input", { follower })
    + field("fragmentHeightMarginPercent", "Fragment Height Margin (%)", "", { follower });
}

// ---- The whole tab ---------------------------------------------------------------------------------------------

// The BDP section's content (head + groups) of aircraft `number`. weapons: [{ id, label }] for the Bomb select.
// angleOff: as bdpProfileFieldsMarkup. turnNote: as turnOnsetFieldsMarkup. targetNote / windNote: the Target
// Elevation and Wind Direction notes. follower: the follower form (above).
export function bdpTabMarkup({ number = 1, weapons = [], angleOff = null, turnNote, targetNote = "Target MSL", windNote = "TRUE · wind FROM", follower = null } = {}) {
  const options = weapons.map((weapon) => `<option value="${esc(weapon.id)}">${esc(weapon.label ?? weapon.id)}</option>`).join("");
  const bomb = `<label class="field${follower ? " flight-weapon-field" : ""}"><span>Bomb</span><select ${keyAttr("weaponId", follower)}>${options}</select><span class="unit">BDP weapon database</span></label>`;
  const wind = follower
    ? `<label class="field"><span>Wind FROM / Speed</span><output data-flight-readout="wind">-</output><span class="unit">Shared with #1 · TRUE FROM</span></label>`
    : field("windDirectionDeg", "Wind Direction FROM (deg)", windNote) + field("windSpeedKt", "Wind Speed (kt)", "");
  return `<div class="section-head"><div class="bdp-tab-head"><h2 id="bdp-title-${number}">BDP #${number}</h2><p class="bdp-tab-note">${BDP_TAB_NOTE}</p></div></div>`
    + group("Target Elevation/Bomb type", field("targetElevationMslFt", "Target Elevation (ft MSL)", targetNote, { follower }) + bomb)
    + group("Wind", wind)
    + group("BDP Profile", bdpProfileFieldsMarkup({ angleOff, follower }), { full: true })
    + group("Roll-in Turn", rollInTurnFieldsMarkup({ follower }))
    + group("Turn Onset", turnOnsetFieldsMarkup({ turnNote, follower }))
    + `<div class="bdp-tab-group bdp-full-only bdp-extra"><h3 class="input-group-title">SEM / Recovery</h3><div class="input-grid">${semRecoveryFieldsMarkup({ follower })}</div><div data-sem-readouts></div></div>`;
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
