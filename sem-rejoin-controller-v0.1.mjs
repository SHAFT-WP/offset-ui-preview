// SEM & Rejoin FE (index.html only; owning FE contract: SPEC.md "SEM & Rejoin — 2026-10-13").
//
// Mounted once by wide-layout.mjs into the left S&R input tab and the centre SEM & Rejoin panel. The
// FE never calculates: plan edits go as raw events to the S&R BE (in its Worker, through the same
// scheduler rules as the Offset requests: 200 ms typing delay, Enter / buttons at once, latest
// revision only), the answer's next plan is stored and its results drawn. Pointer previews and
// re-evaluation at another time call the BE's own functions on the page from the last Full answer.
// The Offset controller is reached only through the `offsetUi` hooks it exports (never imported here,
// so one controller instance exists whatever cache token the page loads it with).

import { createCalculationScheduler, createWorkerTransport } from "./calculation-client-v0.1.mjs?v=0.1.0";
import {
  createDefaultSemRejoinPlan,
  evaluateSemRejoin,
  normalizeSemRejoinPlan,
  previewSemRejoinManeuver,
  semRejoinUpstreamView,
} from "./AG/bombing/offset-bombing/sem-rejoin/sem-rejoin-be-v0.1.mjs?v=0.2.0";
import { renderSemRejoinTopView, semRejoinPalette, semRejoinTopViewLegend } from "./AG/bombing/offset-bombing/sem-rejoin/view/sem-rejoin-top-view-v0.1.mjs?v=0.1.0";
import { installSvgViewControls, svgViewControlsMarkup } from "./common/diagram/svg-view-controls-v0.1.mjs?v=0.1.0";
import { installSvgLegend } from "./common/diagram/svg-legend-v0.1.mjs";
import { saveSvgAsPng } from "./common/diagram/svg-png-export-v0.1.mjs";
import { formatDeg, formatFt, formatG, formatKt, formatNm, formatSec, formatSecTenths } from "./common/ui/display-precision-v0.1.mjs?v=0.1.1";

const SR_WORKER_URL = new URL("./AG/bombing/offset-bombing/sem-rejoin/sem-rejoin-worker-v0.1.mjs?v=0.2.0", import.meta.url);
export const SEM_REJOIN_FE_V0_1 = Object.freeze({ id: "sem-rejoin-controller-v0.1", version: "0.2.0" });
// SEM End labels (owner 2026-10-13: the SEM ends level by default; the +30° CLIMB SEM stays selectable).
const SEM_END_TEXT = { LEVEL: "Level (FPA 0°, then 1 G)", CLIMB: "+30° FPA (CLIMB SEM)" };
const semEndText = (sem) => SEM_END_TEXT[sem?.end] ?? "-";
const semKindText = (sem) => (sem?.end === "CLIMB" ? "CLIMB SEM" : "Level SEM");
// Drawing space kept on the canvas around the draw anchor (presentation only).
const DRAW_ROOM_NM = 5;

// Edits that change the plan: one Undo step per adopted request that carried any of them.
const UNDOABLE = new Set(["addRow", "deleteRow", "updateRow", "commitDraw", "detachArcEntry", "setSettings", "setEgress", "setFormation", "setTolerance", "resetAircraft"]);
const ROW_KIND_LABEL = { STRAIGHT: "Straight", TURN: "Turn", TARGET_ARC: "Target Arc" };
const END_LABEL = { TIME: "Time", DISTANCE: "Distance", ALTITUDE: "Target Altitude", SPEED: "Target Speed", HEADING: "Heading", HEADING_CHANGE: "Heading Change", ARC_ANGLE: "Arc Angle", END_RADIAL: "End Radial" };
const END_UNIT = { TIME: "s", DISTANCE: "NM", ALTITUDE: "ft MSL", SPEED: "KCAS", HEADING: "°T", HEADING_CHANGE: "°", ARC_ANGLE: "°", END_RADIAL: "°T" };
const STATUS_CLASS = { VALID: "ok", WARNING: "warn", DRAFT: "warn", INVALID: "bad", UNSUPPORTED: "bad", BLOCKED: "warn", NO_UPSTREAM: "bad", UPSTREAM_INVALID: "bad" };

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const clock = (timeSec) => (finite(timeSec) ? `IP+${formatSec(timeSec)} s` : "-");
const heading = (value) => (finite(value) ? `${String(((Math.round(value) % 360) + 360) % 360).padStart(3, "0")}°` : "-");
const signed = (value, digits = 0) => (finite(value) ? `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}` : "-");
// An entered value shows as typed (up to 3 decimals); a solved one rounded to its display precision.
function fieldText(value, digits) {
  if (!finite(value)) return "";
  return Number.isInteger(Math.round(value * 1000) / 1000 * 1000) && Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6 ? String(Math.round(value * 1000) / 1000) : value.toFixed(digits);
}
// Field text → number (null when blank); undefined when it is not a number (nothing is sent).
function parseField(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

export function mountSemRejoin({ offsetUi, inputSection, centerHost, getEditAircraft, requestEditAircraft }) {
  let upstream = null;
  let plan = normalizeSemRejoinPlan(offsetUi.savedExtension("semRejoin"));
  let output = null;
  let lastError = null;
  let evaluation = null;
  let evaluationRequest = { mode: "AUTO" };
  let selected = null;
  let mode = "select";
  let preview = null;
  let viewHandle = null;
  let ipBottom = true;
  let active = false;
  let dirty = true;
  let shown = [1];
  let editAircraft = getEditAircraft();
  let undoStack = [];
  let redoStack = [];
  let drag = null;
  let adoptedCount = 0;
  let previewCount = 0;
  let lastPointer = null;

  // ---- DOM: left input tab ------------------------------------------------------------------------
  inputSection.classList.add("section", "sr-input-section");
  inputSection.dataset.tab = "sr";
  inputSection.dataset.allAircraft = "true";
  inputSection.setAttribute("aria-labelledby", "sr-input-title");
  inputSection.innerHTML = `
    <div class="section-head"><h2 id="sr-input-title">S&amp;R #1</h2><span class="status ok" data-sr-status>-</span>
      <div class="section-tools"><button class="btn tab-tool" type="button" data-sr-tab-default title="Reset this aircraft's S&amp;R rows, settings and formation slot">Tab Default</button></div></div>
    <div class="status-message valid" data-sr-message>-</div>
    <details class="input-group-panel" open data-sr-group="sem"><summary class="input-group-title">SEM</summary>
      <div class="input-grid">
        <label class="field"><span>SEM End</span><select data-sr-setting="semEnd"><option value="LEVEL">Level (pull to FPA 0°, then 1 G)</option><option value="CLIMB">+30° climb (CLIMB SEM)</option></select><span class="unit">This aircraft · Recovery G / G Onset are the BDP tab's</span></label>
      </div>
    </details>
    <details class="input-group-panel" open data-sr-group="draw"><summary class="input-group-title">Draw Next Maneuver</summary>
      <div class="input-grid">
        <label class="field"><span>Heading (°T)</span><input data-sr-setting="drawHeadingDeg" type="text" inputmode="decimal" placeholder="-"><span class="unit">Turn end heading · blank: Straight only</span></label>
        <label class="field"><span>Direction</span><select data-sr-setting="drawDirection"><option value="AUTO">Auto (shorter)</option><option value="LEFT">Left</option><option value="RIGHT">Right</option></select><span class="unit">A drawn Turn stores Left / Right</span></label>
        <label class="field"><span>Turn</span><span class="compound"><input data-sr-setting="turnDriverValue" type="text" inputmode="decimal"><select data-sr-setting="turnDriverKind"><option value="G">G</option><option value="BANK">Bank (°)</option></select></span><span class="unit" data-sr-note="turn">-</span></label>
        <label class="field"><span>Vertical</span><select data-sr-setting="drawVertical"><option value="LEVEL">Level (level off)</option><option value="HOLD_FPA">Hold FPA (climb)</option></select><span class="unit">Lead-in Straight (Level levels off first when climbing)</span></label>
        <label class="field"><span>Level-off G (G)</span><input data-sr-setting="levelOffG" type="text" inputmode="decimal"><span class="unit" data-sr-note="leveloff">-</span></label>
      </div>
      <p class="flight-draft-note">Draw: press Draw above the SEM &amp; Rejoin view, move over it to preview and click to add (Straight + Turn in one action). Esc cancels the preview; Ctrl+Z undoes.</p>
    </details>
    <details class="input-group-panel" open data-sr-group="row"><summary class="input-group-title">Selected Maneuver</summary>
      <div data-sr-row-editor></div>
    </details>
    <details class="input-group-panel" open data-sr-group="egress"><summary class="input-group-title">Egress &amp; Formation</summary>
      <div class="input-grid">
        <label class="field"><span>Egress Heading (°T)</span><input data-sr-egress="headingDeg" type="text" inputmode="decimal"><span class="unit">Shared by the Flight · formation axis</span></label>
        <label class="field"><span>Egress Speed (KCAS)</span><input data-sr-egress="speedKcas" type="text" inputmode="decimal"><span class="unit">Shared · error only</span></label>
        <label class="field"><span>Egress Altitude (ft MSL)</span><input data-sr-egress="altitudeMslFt" type="text" inputmode="decimal"><span class="unit">Shared · error only</span></label>
      </div>
      <div data-sr-formation></div>
      <h3 class="input-group-title sr-subtitle">Tolerance (shared)</h3>
      <div class="input-grid">
        <label class="field"><span>Position (NM)</span><input data-sr-tolerance="positionNm" type="text" inputmode="decimal"></label>
        <label class="field"><span>Heading (°)</span><input data-sr-tolerance="headingDeg" type="text" inputmode="decimal"></label>
        <label class="field"><span>Altitude (ft)</span><input data-sr-tolerance="altitudeFt" type="text" inputmode="decimal"></label>
        <label class="field"><span>Relative Speed (kt)</span><input data-sr-tolerance="relativeSpeedKt" type="text" inputmode="decimal"></label>
      </div>
      <p class="flight-draft-note">Blank tolerances: errors only, no judgement. "Within tolerance" needs all four, relative speed included; it is an instant check, not a formed-formation call.</p>
    </details>
    <p class="flight-draft-note sr-model-note">Model: from each aircraft's BDP Release, the SEM pulls at Recovery G to level (1 G at FPA 0°), or the +30° CLIMB SEM when chosen; after it an energy-neutral point mass (no thrust / drag provider: level flight holds TAS, a climb trades speed for height) in the Flight's wind. Power, Target Speed in level flight and descents are not available.</p>`;
  const $in = (selector) => inputSection.querySelector(selector);

  // ---- DOM: centre panel --------------------------------------------------------------------------
  centerHost.classList.add("sr-center");
  centerHost.innerHTML = `
    <div class="diagram-actions">
      <div class="diagram-action-row sr-toolbar">
        <div class="sr-mode" role="group" aria-label="SEM &amp; Rejoin edit mode"><button class="capture-button view-toggle" type="button" data-sr-mode="select" aria-pressed="true">Select</button><button class="capture-button view-toggle" type="button" data-sr-mode="draw" aria-pressed="false">Draw</button></div>
        ${svgViewControlsMarkup({ title: "SEM & Rejoin Top View" })}
        <button class="capture-button" type="button" data-sr-png>PNG</button>
        <button class="capture-button view-toggle" type="button" data-sr-ip-bottom aria-pressed="true" title="#1 Run-In (IP → Target) up; off = north up">IP Bottom</button>
        <button class="capture-button" type="button" data-sr-undo title="Undo (Ctrl+Z)">Undo</button>
        <button class="capture-button" type="button" data-sr-redo title="Redo (Ctrl+Y)">Redo</button>
      </div>
      <div class="diagram-action-row time-dial sr-time-row" role="group" aria-label="Evaluation time on the IP clock">
        <span class="diagram-control-label">Time</span>
        <input class="time-dial-range" type="range" min="0" max="1" step="0.1" value="0" data-sr-time aria-label="Seconds after IP">
        <output class="sr-time-output" data-sr-time-output>-</output>
        <button class="capture-button" type="button" data-sr-time-auto title="Back to the selected row's end (or the edited aircraft's last row)">Row End</button>
      </div>
    </div>
    <div class="status-message" data-sr-preview-status hidden></div>
    <div class="top-view-shell sr-shell" data-sr-shell><svg id="sr-top-view" data-export-legend="sr-legend" viewBox="0 0 900 700" role="img" aria-label="SEM &amp; Rejoin Top View"></svg></div>
    <svg class="diagram-legend-box" id="sr-legend" role="img" aria-label="SEM &amp; Rejoin legend"></svg>
    <div class="sr-table-wrap"><table class="sr-table"><thead><tr><th>Aircraft</th><th>Step</th><th>Maneuver</th><th>End Condition</th><th>Settings</th><th>Start / End</th><th>Duration</th><th>Action</th></tr></thead><tbody data-sr-rows></tbody></table></div>
    <div class="sr-evaluation" data-sr-evaluation></div>`;
  const $c = (selector) => centerHost.querySelector(selector);
  const svg = $c("#sr-top-view");
  const shell = $c("[data-sr-shell]");
  const legendItems = [];
  const legend = installSvgLegend($c("#sr-legend"), legendItems);
  const viewControls = installSvgViewControls(svg, { controls: $c(".sr-toolbar"), render: ({ textScale }) => draw(textScale) });

  // ---- requests -----------------------------------------------------------------------------------
  const transport = createWorkerTransport({ workerUrl: SR_WORKER_URL, hostFactory: "createSemRejoinHost" });
  const scheduler = createCalculationScheduler({ collect, apply, transport });
  function collect(edits) {
    const input = { schemaVersion: 1, upstream, plan, evaluation: evaluationRequest, editAircraft };
    return edits.length ? { ...input, edits } : input;
  }
  function apply(message, sent) {
    if (!message.output) {
      lastError = message.error ?? "no result";
      output = null;
      evaluation = null;
      renderAll();
      return;
    }
    lastError = null;
    if (sent.input.edits?.some((edit) => UNDOABLE.has(edit.kind))) {
      undoStack.push(sent.input.plan);
      if (undoStack.length > 100) undoStack.shift();
      redoStack = [];
    }
    output = message.output;
    plan = output.nextPlan;
    // A drawn / added row becomes the selection, so the next draw continues from it.
    const added = (output.editResults ?? []).filter((result) => result.added?.length).at(-1);
    if (added) selected = { aircraft: added.aircraft, rowId: added.added.at(-1) };
    const failedEdit = (output.editResults ?? []).find((result) => result.error);
    if (selected && !rowExists(selected)) selected = null;
    evaluationRequest = selected ? { mode: "ROW_END", aircraft: selected.aircraft, rowId: selected.rowId } : evaluationRequest.mode === "FREE" ? evaluationRequest : { mode: "AUTO" };
    evaluation = selected || evaluationRequest.mode === "FREE" ? reevaluate() : output.evaluation;
    adoptedCount += 1;
    // A preview made before this answer started from the old anchor: redo it from the new one.
    preview = null;
    renderAll();
    if (mode === "draw" && lastPointer && active) updateDrawPreview();
    else showPreviewStatus(failedEdit ? `Not applied: ${failedEdit.error}` : null, "invalid");
  }
  const send = (edit) => scheduler.immediate(edit);
  // A state replaced as a whole (Undo / Redo / Load Default) goes at once; nothing waits on an answer
  // that cannot come before the first Offset result.
  function sendState() {
    if (upstream) scheduler.reset();
    else dirty = true;
  }

  function rowExists({ aircraft, rowId }) {
    if (rowId === "sem") return !!output?.aircraft?.[aircraft]?.sem;
    return !!plan.aircraft[aircraft]?.rows.some((row) => row.id === rowId);
  }

  function reevaluate() {
    if (!output || !upstream) return null;
    try {
      return evaluateSemRejoin({ output, upstream, evaluation: evaluationRequest, editAircraft });
    } catch {
      return output.evaluation;
    }
  }

  // ---- upstream (Offset answers) ------------------------------------------------------------------
  function takeAnswer(answer) {
    if (!answer) return;
    upstream = semRejoinUpstreamView({ flightInput: answer.input, flightOutput: answer.output });
    dirty = true;
    // One logical request per Offset revision, now if the panel is open, else on its next opening.
    if (active) {
      dirty = false;
      scheduler.immediate(null);
    }
  }
  offsetUi.onFlightAnswer(takeAnswer);
  takeAnswer(offsetUi.flightAnswer());

  // Save keeps the plan (no separate S&R storage); a pending edit is committed and answered first.
  offsetUi.registerSaveExtension("semRejoin", {
    capture: () => JSON.parse(JSON.stringify(plan)),
    flush: () => scheduler.flush(),
  });
  offsetUi.onFlightDefaults(() => {
    plan = createDefaultSemRejoinPlan();
    undoStack = [];
    redoStack = [];
    selected = null;
    evaluationRequest = { mode: "AUTO" };
    clearPreview();
    sendState();
    renderAll();
  });

  // ---- rendering ----------------------------------------------------------------------------------
  function drawnAircraft() {
    const list = new Set(shown);
    if (output?.aircraft?.[editAircraft]) {
      list.add(editAircraft);
      const reference = editAircraft === 1 ? null : editAircraft === 4 ? 3 : 1;
      if (reference && output.aircraft[reference]) list.add(reference);
    }
    return [...list].filter((number) => output?.aircraft?.[number]).sort();
  }

  function draw(textScale) {
    if (!active) return null;
    if (!output) {
      svg.replaceChildren();
      legendItems.splice(0);
      legend.render();
      return null;
    }
    const aircraft = drawnAircraft();
    const upHeadingDeg = ipBottom ? upstreamRunIn() : 0;
    // Room to draw the next maneuver around the edited aircraft's anchor (no zoom-out needed).
    const anchor = drawAnchor();
    const room = anchor.start ? [{ point: anchor.start, radiusNm: DRAW_ROOM_NM }] : [];
    viewHandle = renderSemRejoinTopView(svg, output, {
      aircraft, editAircraft, selected, evaluation, upHeadingDeg, northArrow: !ipBottom, room,
      textScale: textScale ?? viewControls?.getTextScale?.() ?? 1, viewportWidth: globalThis.innerWidth, preview,
    });
    legendItems.splice(0, legendItems.length, ...semRejoinTopViewLegend(output, { aircraft, preview: !!preview }));
    legend.render();
    return viewHandle;
  }
  function upstreamRunIn() {
    const runIn = upstream?.aircraft?.[1]?.result?.resolved?.runInHeadingDeg;
    return finite(runIn) ? runIn : 0;
  }

  function renderAll() {
    renderInputs();
    renderTable();
    renderEvaluation();
    renderTime();
    if (active) viewControls.redraw();
    syncUndoButtons();
  }

  function aircraftStatus(number) {
    if (lastError) return { status: "INVALID", message: lastError };
    const entry = output?.aircraft?.[number];
    if (!entry) return { status: "NO_UPSTREAM", message: upstream ? `#${number} has no S&R result` : "Waiting for the Offset result" };
    return { status: entry.status, message: entry.message };
  }

  function setStatus(node, status) {
    node.textContent = status;
    node.className = `status ${STATUS_CLASS[status] ?? "warn"}`;
  }

  function renderInputs() {
    const number = editAircraft;
    // The title may hold the section's collapse toggle (controller section disclosure).
    const title = $in("#sr-input-title");
    (title.querySelector(".section-disclosure-toggle") ?? title).textContent = `S&R #${number}`;
    const state = aircraftStatus(number);
    setStatus($in("[data-sr-status]"), state.status);
    const message = $in("[data-sr-message]");
    message.hidden = !state.message || state.message === "-";
    message.textContent = state.message ?? "";
    message.className = `status-message ${state.status === "VALID" ? "valid" : ["INVALID", "UNSUPPORTED", "NO_UPSTREAM", "UPSTREAM_INVALID"].includes(state.status) ? "invalid" : "warning"}`;
    const settings = plan.aircraft[number].settings;
    const resolved = output?.aircraft?.[number]?.resolvedSettings;
    for (const field of inputSection.querySelectorAll("[data-sr-setting]")) {
      if (document.activeElement === field) continue;
      const key = field.dataset.srSetting;
      if (field.tagName === "SELECT") field.value = settings[key];
      else field.value = fieldText(settings[key], key === "drawHeadingDeg" ? 0 : 1);
    }
    const turn = resolved?.turnDriver;
    const turnInput = $in('[data-sr-setting="turnDriverValue"]');
    turnInput.placeholder = turn && turn.source !== "explicit" && finite(turn.value) ? fieldText(turn.value, turn.kind === "G" ? 1 : 0) : "-";
    $in('[data-sr-note="turn"]').textContent = turn?.source === "explicit" ? "Own value · clear to use the Offset Turn condition" : turn?.source === "offsetTurn" ? `Offset Turn ${turn.kind === "G" ? `${formatG(turn.value)} G` : `${formatDeg(turn.value)}°`} (blank uses it)` : "Required to draw a Turn";
    const levelOff = resolved?.levelOffG;
    const levelInput = $in('[data-sr-setting="levelOffG"]');
    levelInput.placeholder = levelOff?.source === "inherited" ? `#${levelOff.fromAircraft} ${fieldText(levelOff.value, 1)}` : "-";
    $in('[data-sr-note="leveloff"]').textContent = levelOff?.source === "explicit" ? (number === 1 ? "Wings-level push to level from a climb" : `Own value · clear to follow #${number === 4 ? 3 : 1}`) : levelOff?.source === "inherited" ? `Follows #${levelOff.fromAircraft}` : "Needed only to level off from a climb (CLIMB SEM, Hold FPA); no approved default";
    for (const field of inputSection.querySelectorAll("[data-sr-egress]")) if (document.activeElement !== field) field.value = fieldText(plan.egress[field.dataset.srEgress], field.dataset.srEgress === "headingDeg" ? 0 : 0);
    for (const field of inputSection.querySelectorAll("[data-sr-tolerance]")) if (document.activeElement !== field) field.value = fieldText(plan.tolerance[field.dataset.srTolerance], 2);
    renderFormationInputs();
    renderRowEditor();
  }

  function renderFormationInputs() {
    const host = $in("[data-sr-formation]");
    const number = editAircraft;
    if (number === 1) {
      host.innerHTML = `<p class="flight-draft-note">#1 is the formation reference of #2 and #3 (#3 of #4). Edit #2–#4 to set their egress slots; the entry Formation tab is separate.</p>`;
      return;
    }
    const slot = plan.formation[number];
    const reference = number === 4 ? 3 : 1;
    const focused = host.contains(document.activeElement) ? document.activeElement.dataset.srFormation : null;
    if (!host.dataset.built || Number(host.dataset.built) !== number) {
      host.innerHTML = `
        <h3 class="input-group-title sr-subtitle">#${number} Egress Slot (from #${reference})</h3>
        <div class="input-grid">
          <label class="field"><span>Formation</span><select data-sr-formation="preset"><option value="">-</option><option value="COMBAT_SPREAD">Combat Spread (abeam)</option><option value="WEDGE">Wedge</option><option value="CUSTOM">Custom</option></select><span class="unit">Combat Spread fixes 90°; Wedge / Custom take the bearing</span></label>
          <label class="field"><span>Side</span><select data-sr-formation="side"><option value="">-</option><option value="LEFT">Left</option><option value="RIGHT">Right</option></select><span class="unit">Of #${reference}, on the Egress Heading</span></label>
          <label class="field"><span>Bearing (°)</span><input data-sr-formation="bearingDeg" type="text" inputmode="decimal"><span class="unit">From #${reference}'s tail: 0° behind, 90° abeam</span></label>
          <label class="field"><span>Range (NM)</span><input data-sr-formation="rangeNm" type="text" inputmode="decimal"><span class="unit">No preset range: enter it</span></label>
        </div>`;
      host.dataset.built = String(number);
    }
    for (const field of host.querySelectorAll("[data-sr-formation]")) {
      const key = field.dataset.srFormation;
      if (key === focused) continue;
      if (field.tagName === "SELECT") field.value = slot[key] ?? "";
      else field.value = key === "bearingDeg" && slot.preset === "COMBAT_SPREAD" ? "90" : fieldText(slot[key], 1);
      if (key === "bearingDeg") field.disabled = slot.preset === "COMBAT_SPREAD";
    }
  }

  function selectedRowResult() {
    if (!selected || !output) return null;
    const entry = output.aircraft[selected.aircraft];
    if (!entry) return null;
    if (selected.rowId === "sem") return { sem: true, entry };
    return { row: entry.rows.find((row) => row.id === selected.rowId) ?? null, entry, planRow: plan.aircraft[selected.aircraft].rows.find((row) => row.id === selected.rowId) ?? null };
  }

  function rowEditorMarkup(planRow, resultRow) {
    const end = planRow.end ?? { kind: null, value: null };
    const endOptions = { STRAIGHT: ["TIME", "DISTANCE", "ALTITUDE", "SPEED"], TURN: ["HEADING", "HEADING_CHANGE"], TARGET_ARC: ["ARC_ANGLE", "END_RADIAL", "HEADING"] }[planRow.kind] ?? [];
    const option = (value, label, current) => `<option value="${value}"${value === current ? " selected" : ""}>${label}</option>`;
    const parts = [];
    parts.push(`<label class="field"><span>Maneuver</span><select data-sr-row-field="kind">${Object.entries(ROW_KIND_LABEL).map(([value, label]) => option(value, label, planRow.kind)).join("")}</select><span class="unit">Changing it starts the new kind's empty conditions</span></label>`);
    parts.push(`<label class="field"><span>End Condition</span><select data-sr-row-field="end.kind">${endOptions.map((value) => option(value, END_LABEL[value], end.kind)).join("")}</select><span class="unit">One condition; the rest is calculated</span></label>`);
    parts.push(`<label class="field"><span>${END_LABEL[end.kind] ?? "Value"} (${END_UNIT[end.kind] ?? ""})</span><input data-sr-row-field="end.value" type="text" inputmode="decimal" value="${fieldText(end.value, end.kind === "TIME" ? 1 : end.kind === "DISTANCE" ? 2 : 0)}"></label>`);
    if (planRow.kind === "STRAIGHT") {
      parts.push(`<label class="field"><span>Vertical</span><select data-sr-row-field="vertical">${option("LEVEL", "Level (level off)", planRow.vertical)}${option("HOLD_FPA", "Hold FPA (climb)", planRow.vertical)}</select><span class="unit">Heading held from the step before</span></label>`);
    }
    if (planRow.kind === "TURN" || planRow.kind === "TARGET_ARC") {
      parts.push(`<label class="field"><span>Direction</span><select data-sr-row-field="direction">${option("", "-", planRow.direction ?? "")}${option("LEFT", "Left", planRow.direction)}${option("RIGHT", "Right", planRow.direction)}</select></label>`);
    }
    if (planRow.kind === "TURN") {
      const driver = resultRow?.driver;
      parts.push(`<label class="field"><span>Turn</span><span class="compound"><input data-sr-row-field="driverValue" type="text" inputmode="decimal" value="${fieldText(planRow.driverValue, 1)}" placeholder="${driver && !finite(planRow.driverValue) && finite(driver.value) ? fieldText(driver.value, 1) : "-"}"><select data-sr-row-field="driverKind">${option("G", "G", planRow.driverKind)}${option("BANK", "Bank (°)", planRow.driverKind)}</select></span><span class="unit">${finite(planRow.driverValue) ? "Own value" : "Blank uses the S&amp;R turn setting"} · level turn (levels off first)</span></label>`);
    }
    if (planRow.kind === "TARGET_ARC") {
      parts.push(`<label class="field"><span>Arc Radius (NM)</span><input data-sr-row-field="radiusNm" type="text" inputmode="decimal" value="${fieldText(planRow.radiusNm, 2)}"><span class="unit">Target-centred, horizontal (not slant)</span></label>`);
      parts.push(`<label class="field"><span>Entry</span><select data-sr-row-field="entry">${option("AUTO", "Auto (Turn + Straight)", planRow.entry)}${option("DIRECT", "Direct (already on it)", planRow.entry)}</select></label>`);
      parts.push(`<label class="field"><span>G Limit (G)</span><input data-sr-row-field="gLimit" type="text" inputmode="decimal" value="${fieldText(planRow.gLimit, 1)}"><span class="unit">Blank: no limit · required G is calculated</span></label>`);
    }
    return `<div class="input-grid">${parts.join("")}</div>`;
  }

  function renderRowEditor() {
    const host = $in("[data-sr-row-editor]");
    const picked = selectedRowResult();
    if (!picked || picked.entry.number !== editAircraft || (!picked.sem && !picked.planRow)) {
      const lastId = plan.aircraft[editAircraft].rows.at(-1)?.id ?? "sem";
      const key = `none:${editAircraft}:${lastId}`;
      if (host.dataset.editorKey !== key) {
        host.dataset.rowId = "";
        host.innerHTML = `<p class="flight-draft-note">Select a step of #${editAircraft} in the table or the drawing, or add one at the end.</p><div class="sr-row-actions"><select class="sr-add" data-sr-add-after="${escapeHtml(lastId)}" data-sr-add-aircraft="${editAircraft}" aria-label="Add a maneuver at the end"><option value="">+ Add at end…</option><option value="STRAIGHT">Straight</option><option value="TURN">Turn</option><option value="TARGET_ARC">Target Arc</option></select></div>`;
        host.dataset.editorKey = key;
      }
      return;
    }
    if (picked.sem) {
      const sem = picked.entry.sem;
      host.dataset.editorKey = `sem:${editAircraft}`;
      host.dataset.rowId = "";
      host.innerHTML = `<p class="flight-draft-note"><b>Step 1 · SEM (${semKindText(sem)})</b> — from the BDP Release; fixed, not deleted. Its end is the SEM End above; Recovery G and G Onset are the BDP tab's (one shared state).</p>
        <dl class="sr-facts"><dt>Release</dt><dd>${clock(sem?.release?.timeSec)}</dd><dt>SEM End</dt><dd>${clock(sem?.endState?.timeSec)} · ${semEndText(sem)}</dd><dt>Recovery G / Onset</dt><dd>${formatG(sem?.inputs?.recoveryG)} G / ${formatSecTenths(sem?.inputs?.gOnsetTimeSec)} s</dd><dt>End altitude / speed</dt><dd>${formatFt(sem?.endState?.altitudeMslFt)} ft / ${formatKt(sem?.terminationSpeedKcas)} KCAS</dd><dt>Minimum altitude</dt><dd>${formatFt(sem?.minAltitudeMslFt)} ft MSL</dd></dl>
        <div class="sr-row-actions"><select class="sr-add" data-sr-add-after="sem" data-sr-add-aircraft="${editAircraft}" aria-label="Add a maneuver after the SEM"><option value="">+ Add below…</option><option value="STRAIGHT">Straight</option><option value="TURN">Turn</option><option value="TARGET_ARC">Target Arc</option></select></div>`;
      return;
    }
    const { planRow, row } = picked;
    const key = `row:${editAircraft}:${planRow.id}:${JSON.stringify(planRow)}`;
    // A field being typed in keeps its text while its own row is shown; another row replaces the
    // editor (that field's typed edits are already queued).
    const focused = host.contains(document.activeElement) && host.dataset.rowId === `${editAircraft}:${planRow.id}` ? document.activeElement : null;
    if (host.dataset.editorKey !== key && !focused) {
      host.dataset.rowId = `${editAircraft}:${planRow.id}`;
      host.innerHTML = `<p class="flight-draft-note"><b>Step ${row?.step ?? "-"} · ${ROW_KIND_LABEL[planRow.kind] ?? planRow.kind}</b> <span data-sr-row-status></span></p>
        ${rowEditorMarkup(planRow, row)}
        <p data-sr-row-message></p>
        <div class="sr-row-actions">
          <select class="sr-add" data-sr-add-after="${planRow.id}" data-sr-add-aircraft="${editAircraft}" aria-label="Add a maneuver below"><option value="">+ Add below…</option><option value="STRAIGHT">Straight</option><option value="TURN">Turn</option><option value="TARGET_ARC">Target Arc</option></select>
          <button class="btn" type="button" data-sr-delete="${planRow.id}" data-sr-delete-aircraft="${editAircraft}">Delete</button>
          ${planRow.kind === "TARGET_ARC" && planRow.entry === "AUTO" && picked.entry.rows.some((candidate) => candidate.autoFor === planRow.id) ? `<button class="btn" type="button" data-sr-detach="${planRow.id}">Entry as Rows</button>` : ""}
        </div>`;
      host.dataset.editorKey = key;
    }
    // The row's result (status and message) is current even while one of its fields keeps its text.
    const badge = host.querySelector("[data-sr-row-status]");
    if (badge) {
      badge.hidden = !row;
      badge.textContent = row?.status ?? "";
      badge.className = `status ${STATUS_CLASS[row?.status] ?? "warn"}`;
    }
    const message = host.querySelector("[data-sr-row-message]");
    if (message) {
      message.textContent = row?.errors?.[0] ?? row?.warnings?.[0] ?? rowSummaryText(row) ?? "-";
      message.className = `status-message ${row?.status === "VALID" ? "valid" : "warning"}`;
    }
  }

  function endText(definition) {
    const end = definition?.end;
    if (!end) return "-";
    if (!finite(end.value)) return `${END_LABEL[end.kind]} -`;
    const value = end.kind === "TIME" ? `${formatSecTenths(end.value)} s` : end.kind === "DISTANCE" ? `${formatNm(end.value)} NM` : end.kind === "ALTITUDE" ? `${formatFt(end.value)} ft` : end.kind === "SPEED" ? `${formatKt(end.value)} KCAS` : end.kind === "HEADING" || end.kind === "END_RADIAL" ? heading(end.value) : `${formatDeg(end.value)}°`;
    return `${END_LABEL[end.kind]} ${value}`;
  }

  function rowSummaryText(row) {
    if (!row) return null;
    const s = row.summary ?? {};
    const def = row.definition ?? {};
    const parts = [];
    if (def.kind === "STRAIGHT") parts.push(def.vertical === "HOLD_FPA" ? "Hold FPA" : "Level");
    if (def.kind === "TURN") {
      parts.push(def.direction === "LEFT" ? "L" : def.direction === "RIGHT" ? "R" : "-");
      if (finite(s.loadFactorG)) parts.push(`${formatG(s.loadFactorG)} G / ${formatDeg(s.bankDeg)}°`);
      if (finite(s.radiusNm)) parts.push(`r ${formatNm(s.radiusNm)} NM`);
    }
    if (def.kind === "TARGET_ARC") {
      parts.push(def.direction === "LEFT" ? "L" : def.direction === "RIGHT" ? "R" : "-");
      if (finite(def.radiusNm)) parts.push(`R ${formatNm(def.radiusNm)} NM`);
      if (finite(s.maxLoadFactorG)) parts.push(`max ${formatG(s.maxLoadFactorG)} G`);
      parts.push(`Entry ${def.entry === "DIRECT" ? "Direct" : "Auto"}`);
    }
    if (finite(s.levelOffSec)) parts.push(`level-off ${formatSec(s.levelOffSec)} s`);
    if (finite(s.groundDistanceNm)) parts.push(`${formatNm(s.groundDistanceNm)} NM`);
    // A row that ends before its level-off is complete (or in a climb) says so.
    if (finite(row.end?.fpaDeg) && Math.abs(row.end.fpaDeg) >= 0.5) parts.push(`end FPA ${formatDeg(row.end.fpaDeg)}°`);
    return parts.join(" · ");
  }

  function renderTable() {
    const body = $c("[data-sr-rows]");
    const rows = [];
    const aircraftList = output ? drawnAircraft() : [];
    if (!aircraftList.length) {
      body.innerHTML = `<tr><td colspan="8" class="sr-empty">${escapeHtml(lastError ?? (upstream ? "No S&R result yet" : "Waiting for the Offset result"))}</td></tr>`;
      return;
    }
    for (const number of aircraftList) {
      const entry = output.aircraft[number];
      const color = semRejoinPalette(number).row;
      const state = aircraftStatus(number);
      rows.push(`<tr class="sr-group" data-sr-group-aircraft="${number}" style="--aircraft-color:${color}"><td colspan="8"><span class="sr-aircraft-chip">#${number}</span> <span class="status ${STATUS_CLASS[state.status] ?? "warn"}">${state.status}</span> ${escapeHtml(state.message && state.message !== "-" ? state.message : "")}</td></tr>`);
      const isSel = (rowId) => selected && selected.aircraft === number && selected.rowId === rowId;
      if (entry.sem) {
        const sem = entry.sem;
        rows.push(`<tr class="sr-row${isSel("sem") ? " selected" : ""}" data-sr-row-id="sem" data-sr-aircraft="${number}" style="--aircraft-color:${color}">
          <td>#${number}</td><td>1</td><td>SEM <span class="sr-muted">(${semKindText(sem)})</span></td><td>${semEndText(sem)}</td><td>${formatG(sem.inputs?.recoveryG)} G · onset ${formatSecTenths(sem.inputs?.gOnsetTimeSec)} s</td>
          <td>${clock(sem.release?.timeSec)} / ${clock(sem.endState?.timeSec)}</td><td>${finite(sem.durationSec) ? `${formatSec(sem.durationSec)} s` : "-"}</td>
          <td><select class="sr-add" data-sr-add-after="sem" data-sr-add-aircraft="${number}" aria-label="Add below the SEM of #${number}"><option value="">＋</option><option value="STRAIGHT">Straight</option><option value="TURN">Turn</option><option value="TARGET_ARC">Target Arc</option></select></td></tr>`);
      }
      for (const row of entry.rows) {
        const auto = !!row.autoFor;
        const id = row.autoFor ?? row.id;
        const status = row.status === "VALID" ? "" : ` <span class="status ${STATUS_CLASS[row.status] ?? "warn"}" title="${escapeHtml(row.errors?.join(" / "))}">${row.status}</span>`;
        rows.push(`<tr class="sr-row${isSel(id) ? " selected" : ""}${auto ? " auto" : ""}" data-sr-row-id="${escapeHtml(id)}" data-sr-result-id="${escapeHtml(row.id)}" data-sr-aircraft="${number}" data-sr-status="${row.status}" style="--aircraft-color:${color}">
          <td>#${number}</td><td>${row.step}</td><td>${ROW_KIND_LABEL[row.kind] ?? row.kind}${auto ? ' <span class="sr-muted">auto · Arc entry</span>' : ""}${status}</td>
          <td>${escapeHtml(endText(row.definition))}</td><td>${escapeHtml(rowSummaryText(row))}</td>
          <td>${clock(row.startSec)} / ${clock(row.endSec)}</td><td>${finite(row.durationSec) ? `${formatSec(row.durationSec)} s` : "-"}</td>
          <td>${auto ? "" : `<select class="sr-add" data-sr-add-after="${escapeHtml(row.id)}" data-sr-add-aircraft="${number}" aria-label="Add below step ${row.step}"><option value="">＋</option><option value="STRAIGHT">Straight</option><option value="TURN">Turn</option><option value="TARGET_ARC">Target Arc</option></select> <button class="capture-button sr-delete" type="button" data-sr-delete="${escapeHtml(row.id)}" data-sr-delete-aircraft="${number}" aria-label="Delete step ${row.step}">✕</button>`}</td></tr>`);
      }
    }
    body.innerHTML = rows.join("");
  }

  function renderEvaluation() {
    const host = $c("[data-sr-evaluation]");
    if (!output || !evaluation || !finite(evaluation.timeSec)) {
      host.innerHTML = `<p class="flight-draft-note">No evaluation time yet.</p>`;
      return;
    }
    const source = evaluation.source ? `#${evaluation.source.aircraft} Step ${evaluation.source.step} end` : "";
    const modeText = evaluation.mode === "FREE" ? "Free time" : evaluation.mode === "ROW_END" ? "Selected row end" : "Last row end";
    const lines = [`<h3 class="input-group-title">Evaluation · ${modeText}${source ? ` · ${source}` : ""} · ${clock(evaluation.timeSec)}</h3>`];
    const egress = plan.egress;
    for (const number of drawnAircraft()) {
      const at = evaluation.aircraft?.[number];
      const color = semRejoinPalette(number).row;
      let text;
      if (!at) text = "-";
      else if (!at.available) text = escapeHtml(at.reason ?? "not available");
      else if (at.partial) text = `Attack run (before Release) · track ${heading(at.state.trackDeg)}`;
      else {
        const s = at.state;
        const phase = at.phase === "sem" ? "SEM" : at.phase === "continuation" ? `continuing +${formatSec(at.extendedSec)} s` : `Step ${at.step}`;
        text = `${phase} · ${heading(s.headingDeg)} · ${formatKt(s.kcas)} KCAS · ${formatFt(s.altitudeMslFt)} ft · FPA ${formatDeg(s.fpaDeg)}°`;
        const common = evaluation.common?.[number];
        const errors = [];
        if (finite(common?.headingErrorDeg)) errors.push(`Δhdg ${signed(common.headingErrorDeg)}°`);
        if (finite(common?.speedErrorKcas)) errors.push(`ΔKCAS ${signed(common.speedErrorKcas)}`);
        if (finite(common?.altitudeErrorFt)) errors.push(`Δalt ${signed(common.altitudeErrorFt)} ft`);
        if (errors.length) text += ` · vs Egress ${errors.join(", ")}`;
      }
      const formation = evaluation.formation?.[number];
      let slot = "";
      if (formation) {
        if (formation.judgement === "NOT_SET") slot = `Slot: set ${formation.missing.join(", ")}`;
        else if (formation.judgement === "UNAVAILABLE" || formation.judgement === "INVALID") slot = `Slot: ${escapeHtml(formation.reason)}`;
        else {
          const e = formation.errors;
          const verdict = { NOT_JUDGED: "not judged (tolerances not set)", WITHIN_TOLERANCE: "within tolerance at T", OUT_OF_TOLERANCE: `out of tolerance (${formation.failing.join(", ")})` }[formation.judgement];
          slot = `Slot vs #${formation.reference}: ${formatNm(e.distanceNm)} NM off (${signed(e.longitudinalNm, 2)} ahead, ${signed(e.lateralNm, 2)} right) · rel speed ${formatKt(e.relativeSpeedKt)} kt (closure ${signed(e.closureKt)}) · ${verdict}`;
        }
      }
      lines.push(`<div class="sr-eval-line" data-sr-eval-aircraft="${number}" style="--aircraft-color:${color}"><span class="sr-aircraft-chip">#${number}</span> ${text}${slot ? `<br><span class="sr-eval-slot" data-sr-eval-slot="${number}">${slot}</span>` : ""}</div>`);
    }
    if (!finite(egress.headingDeg)) lines.push(`<p class="flight-draft-note">Set the Egress Heading for heading errors and formation slots.</p>`);
    host.innerHTML = lines.join("");
  }

  function renderTime() {
    const range = $c("[data-sr-time]");
    const out = $c("[data-sr-time-output]");
    const releases = Object.values(output?.timeline?.releaseSec ?? {}).filter(finite);
    const min = releases.length ? Math.floor(Math.min(...releases) - 5) : 0;
    const max = Math.ceil(Math.max(min + 10, (output?.timeline?.maxSec ?? 0) + 60));
    range.min = String(Math.max(0, min));
    range.max = String(max);
    if (evaluation && finite(evaluation.timeSec) && document.activeElement !== range) range.value = String(evaluation.timeSec);
    range.disabled = !output;
    out.textContent = evaluation && finite(evaluation.timeSec) ? `${clock(evaluation.timeSec)} · ${evaluation.mode === "FREE" ? "free" : "row end"}` : "-";
    out.dataset.mode = evaluation?.mode ?? "";
  }

  function syncUndoButtons() {
    for (const button of centerHost.querySelectorAll("[data-sr-undo]")) button.disabled = !undoStack.length;
    for (const button of centerHost.querySelectorAll("[data-sr-redo]")) button.disabled = !redoStack.length;
  }

  // ---- edits from the left panel ------------------------------------------------------------------
  function editFor(field) {
    const number = editAircraft;
    if (field.dataset.srSetting) {
      const key = field.dataset.srSetting;
      if (field.tagName === "SELECT") return { kind: "setSettings", aircraft: number, patch: { [key]: field.value } };
      const value = parseField(field.value);
      return value === undefined ? null : { kind: "setSettings", aircraft: number, patch: { [key]: value } };
    }
    if (field.dataset.srEgress) {
      const value = parseField(field.value);
      return value === undefined ? null : { kind: "setEgress", patch: { [field.dataset.srEgress]: value } };
    }
    if (field.dataset.srTolerance) {
      const value = parseField(field.value);
      return value === undefined ? null : { kind: "setTolerance", patch: { [field.dataset.srTolerance]: value } };
    }
    if (field.dataset.srFormation) {
      const key = field.dataset.srFormation;
      if (field.tagName === "SELECT") return { kind: "setFormation", aircraft: number, patch: { [key]: field.value || null } };
      const value = parseField(field.value);
      return value === undefined ? null : { kind: "setFormation", aircraft: number, patch: { [key]: value } };
    }
    if (field.dataset.srRowField && selected) {
      const key = field.dataset.srRowField;
      const rowId = selected.rowId;
      if (key === "kind") return { kind: "updateRow", aircraft: selected.aircraft, rowId, patch: { kind: field.value } };
      if (key === "end.kind") return { kind: "updateRow", aircraft: selected.aircraft, rowId, patch: { end: { kind: field.value, value: null } } };
      if (key === "end.value") {
        const value = parseField(field.value);
        return value === undefined ? null : { kind: "updateRow", aircraft: selected.aircraft, rowId, patch: { end: { value } } };
      }
      if (field.tagName === "SELECT") return { kind: "updateRow", aircraft: selected.aircraft, rowId, patch: { [key]: field.value || null } };
      const value = parseField(field.value);
      return value === undefined ? null : { kind: "updateRow", aircraft: selected.aircraft, rowId, patch: { [key]: value } };
    }
    return null;
  }
  const srField = (target) => target?.matches?.("[data-sr-setting], [data-sr-egress], [data-sr-tolerance], [data-sr-formation], [data-sr-row-field]") ? target : null;
  function markParse(field) {
    const bad = field.tagName !== "SELECT" && parseField(field.value) === undefined;
    field.closest("label.field")?.classList.toggle("input-invalid", bad);
    field.setAttribute("aria-invalid", String(bad));
    return !bad;
  }
  // Typing: 200 ms trailing request; leaving the field: its commit rides on a waiting request (or goes
  // now); Enter: at once. Selects go at once. The commit after Enter for the same text is not sent.
  let enterCommitted = null;
  inputSection.addEventListener("input", (event) => {
    const field = srField(event.target);
    if (!field || field.tagName === "SELECT") return;
    enterCommitted = null;
    if (!markParse(field)) return;
    const edit = editFor(field);
    if (edit) scheduler.input(edit);
  });
  inputSection.addEventListener("change", (event) => {
    const field = srField(event.target);
    if (!field) return;
    if (field.tagName === "SELECT") {
      const edit = editFor(field);
      if (edit) send(edit);
      return;
    }
    if (enterCommitted === field) {
      enterCommitted = null;
      return;
    }
    if (!markParse(field)) return;
    const edit = editFor(field);
    if (edit) scheduler.commit(edit);
  });
  inputSection.addEventListener("keydown", (event) => {
    const field = srField(event.target);
    if (!field || event.key !== "Enter" || field.tagName === "SELECT") return;
    event.preventDefault();
    if (!markParse(field)) return;
    const edit = editFor(field);
    if (edit) {
      enterCommitted = field;
      send(edit);
    }
  });
  $in("[data-sr-tab-default]").addEventListener("click", () => {
    if (selected?.aircraft === editAircraft) selected = null;
    send({ kind: "resetAircraft", aircraft: editAircraft });
  });

  // Table and editor actions (delegated; both panes).
  function onAction(event) {
    const add = event.target.closest?.("select.sr-add");
    if (add && event.type === "change") {
      const kind = add.value;
      add.value = "";
      if (kind) send({ kind: "addRow", aircraft: Number(add.dataset.srAddAircraft), afterRowId: add.dataset.srAddAfter, rowKind: kind });
      return;
    }
    if (event.type !== "click") return;
    const del = event.target.closest?.("[data-sr-delete]");
    if (del) {
      const aircraft = Number(del.dataset.srDeleteAircraft);
      if (selected?.aircraft === aircraft && selected.rowId === del.dataset.srDelete) selected = null;
      send({ kind: "deleteRow", aircraft, rowId: del.dataset.srDelete });
      return;
    }
    const detach = event.target.closest?.("[data-sr-detach]");
    if (detach) {
      send({ kind: "detachArcEntry", aircraft: editAircraft, rowId: detach.dataset.srDetach });
      return;
    }
    const row = event.target.closest?.("tr[data-sr-row-id]");
    if (row && !event.target.closest("select, button")) selectRow(Number(row.dataset.srAircraft), row.dataset.srRowId);
  }
  centerHost.addEventListener("click", onAction);
  centerHost.addEventListener("change", onAction);
  inputSection.addEventListener("click", onAction);
  inputSection.addEventListener("change", onAction);

  function selectRow(aircraft, rowId) {
    if (selected && selected.aircraft === aircraft && selected.rowId === rowId) return;
    selected = rowId ? { aircraft, rowId } : null;
    if (selected && aircraft !== editAircraft) requestEditAircraft(aircraft);
    evaluationRequest = selected ? { mode: "ROW_END", aircraft, rowId } : { mode: "AUTO" };
    evaluation = reevaluate();
    clearPreview();
    renderAll();
  }

  // ---- toolbar ------------------------------------------------------------------------------------
  function setMode(next) {
    if (mode === next) return;
    mode = next;
    for (const button of centerHost.querySelectorAll("[data-sr-mode]")) button.setAttribute("aria-pressed", String(button.dataset.srMode === mode));
    shell.dataset.srMode = mode;
    shell.style.cursor = mode === "draw" ? "crosshair" : "";
    clearPreview();
  }
  centerHost.querySelectorAll("[data-sr-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.srMode)));
  $c("[data-sr-png]").addEventListener("click", () => saveSvgAsPng(svg, `${(svg.dataset.exportTitle || "SEM & Rejoin Top View").replace(/[^A-Za-z0-9-]+/g, "_")}.png`, { scale: 2, background: "#ffffff" }));
  $c("[data-sr-ip-bottom]").addEventListener("click", (event) => {
    ipBottom = !ipBottom;
    event.currentTarget.setAttribute("aria-pressed", String(ipBottom));
    viewControls.redraw();
  });
  centerHost.querySelectorAll("[data-sr-undo]").forEach((button) => button.addEventListener("click", undo));
  centerHost.querySelectorAll("[data-sr-redo]").forEach((button) => button.addEventListener("click", redo));
  $c("[data-sr-time]").addEventListener("input", (event) => {
    evaluationRequest = { mode: "FREE", timeSec: Number(event.currentTarget.value) };
    evaluation = reevaluate();
    renderEvaluation();
    renderTime();
    viewControls.redraw();
  });
  $c("[data-sr-time-auto]").addEventListener("click", () => {
    evaluationRequest = selected ? { mode: "ROW_END", aircraft: selected.aircraft, rowId: selected.rowId } : { mode: "AUTO" };
    evaluation = reevaluate();
    renderAll();
  });

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(plan);
    plan = undoStack.pop();
    clearPreview();
    sendState();
    syncUndoButtons();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(plan);
    plan = redoStack.pop();
    clearPreview();
    sendState();
    syncUndoButtons();
  }

  // ---- pointer: draw preview / commit, selection, handles ------------------------------------------
  function clientToWorld(event) {
    const matrix = svg.getScreenCTM();
    if (!matrix || !viewHandle) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return viewHandle.unproject(point);
  }

  function showPreviewStatus(text, state = "warning") {
    const node = $c("[data-sr-preview-status]");
    node.hidden = !text;
    node.textContent = text ?? "";
    node.className = `status-message ${state}`;
  }
  function clearPreview() {
    preview = null;
    viewHandle?.updatePreview(null);
    showPreviewStatus(null);
  }

  // The draw anchor: after the selected step of the edited aircraft, else after its last step.
  function drawAnchor() {
    const entry = output?.aircraft?.[editAircraft];
    if (!entry?.sem || entry.sem.status !== "VALID") return { error: entry?.message ?? `#${editAircraft} has no SEM` };
    const rows = plan.aircraft[editAircraft].rows;
    const afterRowId = selected?.aircraft === editAircraft ? selected.rowId : rows.at(-1)?.id ?? "sem";
    if (afterRowId === "sem") return { afterRowId, start: entry.sem.endState };
    const results = entry.rows.filter((row) => row.id === afterRowId || row.autoFor === afterRowId);
    const last = results.at(-1);
    if (!last?.end) return { error: `Step ${last?.step ?? "-"} has no end state (${last?.status ?? "not computed"}): complete it first` };
    return { afterRowId, start: last.end };
  }

  function drawSettings() {
    const read = (key) => $in(`[data-sr-setting="${key}"]`);
    const resolved = output?.aircraft?.[editAircraft]?.resolvedSettings;
    const headingValue = parseField(read("drawHeadingDeg").value);
    const driverKind = read("turnDriverKind").value;
    const ownDriver = parseField(read("turnDriverValue").value);
    const levelOff = parseField(read("levelOffG").value);
    const inheritedDriver = resolved?.turnDriver?.kind === driverKind && resolved.turnDriver.source !== "explicit" ? resolved.turnDriver.value : null;
    return {
      headingDeg: finite(headingValue) ? headingValue : null,
      direction: read("drawDirection").value,
      vertical: read("drawVertical").value,
      driverKind,
      driverValue: finite(ownDriver) ? ownDriver : null,
      driver: { kind: driverKind, value: finite(ownDriver) ? ownDriver : inheritedDriver },
      levelOffG: finite(levelOff) ? levelOff : resolved?.levelOffG?.value ?? null,
    };
  }

  let pointerFrame = null;
  function updateDrawPreview() {
    pointerFrame = null;
    if (mode !== "draw" || !lastPointer || !output) return;
    const anchor = drawAnchor();
    if (anchor.error) {
      showPreviewStatus(anchor.error, "invalid");
      return;
    }
    const settings = drawSettings();
    const result = previewSemRejoinManeuver({ start: anchor.start, windKt: output.wind.vectorKt, heading: settings.headingDeg, direction: settings.direction, driver: settings.driver, vertical: settings.vertical, levelOffG: settings.levelOffG, point: lastPointer });
    previewCount += 1;
    preview = { ...result, aircraft: editAircraft, anchor, settings, point: lastPointer };
    viewHandle?.updatePreview(preview);
    if (result.status === "VALID") {
      const parts = result.rows.map((row) => (row.kind === "STRAIGHT" ? `Straight ${formatNm(row.end.value)} NM` : `Turn ${row.direction === "LEFT" ? "L" : "R"} to ${heading(row.end.value)}`));
      showPreviewStatus(`Preview · ${parts.join(" → ")}${result.diagnostics?.length ? ` · ${result.diagnostics.join(" · ")}` : ""} · click to add`, "valid");
    } else {
      showPreviewStatus(`Preview · ${result.errors?.[0] ?? result.status}`, result.status === "EMPTY" ? "warning" : "invalid");
    }
  }

  function commitDraw() {
    if (!preview || preview.status !== "VALID") return;
    const { anchor, settings, point } = preview;
    send({ kind: "commitDraw", aircraft: editAircraft, afterRowId: anchor.afterRowId, point, headingDeg: settings.headingDeg, direction: settings.direction, vertical: settings.vertical, driverKind: settings.driverKind, driverValue: settings.driverValue });
    clearPreview();
  }

  // Handle drags (Select mode): the value follows the pointer; one edit on release.
  function handleValue(handle, world) {
    const entry = output.aircraft[Number(handle.dataset.srAircraft)];
    const row = entry?.rows.find((candidate) => candidate.id === handle.dataset.srRow);
    if (!row) return null;
    const definition = row.definition;
    if (handle.dataset.srHandle === "straight-end") {
      const settings = drawSettings();
      const result = previewSemRejoinManeuver({ start: row.start, windKt: output.wind.vectorKt, heading: null, vertical: definition.vertical, levelOffG: entry.resolvedSettings?.levelOffG?.value ?? settings.levelOffG, point: world });
      const straight = result.straight;
      if (!straight?.end) return { ghost: { kind: "point", point: row.start }, error: "At the start: the Straight needs a length" };
      const value = definition.end.kind === "TIME" ? straight.end.timeSec - row.start.timeSec : straight.summary.groundDistanceNm;
      return { patch: { end: { value } }, ghost: { kind: "point", point: straight.end }, text: `${END_LABEL[definition.end.kind]} ${definition.end.kind === "TIME" ? `${formatSecTenths(value)} s` : `${formatNm(value)} NM`}` };
    }
    if (handle.dataset.srHandle === "arc-radius") {
      const radius = Math.hypot(world.x, world.y);
      return { patch: { radiusNm: radius }, ghost: { kind: "circle", radiusNm: radius }, text: `Arc Radius ${formatNm(radius)} NM` };
    }
    if (handle.dataset.srHandle === "arc-end") {
      const bearing = ((Math.atan2(world.x, world.y) * 180) / Math.PI + 360) % 360;
      if (definition.end.kind === "END_RADIAL") return { patch: { end: { value: bearing } }, ghost: { kind: "point", point: world }, text: `End Radial ${heading(bearing)}` };
      const startBearing = ((Math.atan2(row.start.x, row.start.y) * 180) / Math.PI + 360) % 360;
      // LEFT arcs run counter-clockwise (bearing decreasing), RIGHT arcs clockwise.
      let angle = definition.direction === "LEFT" ? (startBearing - bearing + 360) % 360 : (bearing - startBearing + 360) % 360;
      if (angle < 0.5) angle = 360;
      return { patch: { end: { value: angle } }, ghost: { kind: "point", point: world }, text: `Arc Angle ${formatDeg(angle)}°` };
    }
    return null;
  }

  shell.addEventListener("pointerdown", (event) => {
    if (!active || event.button !== 0) return;
    if (mode === "draw") {
      // Draw mode owns the pointer: no pan, no label move.
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    const handle = event.target.closest?.("[data-sr-handle]");
    if (handle) {
      event.stopPropagation();
      event.preventDefault();
      try { shell.setPointerCapture(event.pointerId); } catch { /* capture is optional */ }
      drag = { handle, pointerId: event.pointerId, value: null };
      return;
    }
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  }, { capture: true });
  shell.addEventListener("pointermove", (event) => {
    if (!active) return;
    if (mode === "draw") {
      event.stopPropagation();
      lastPointer = clientToWorld(event);
      if (!pointerFrame) pointerFrame = requestAnimationFrame(updateDrawPreview);
      return;
    }
    if (drag?.handle && drag.pointerId === event.pointerId) {
      event.stopPropagation();
      const world = clientToWorld(event);
      const value = world ? handleValue(drag.handle, world) : null;
      drag.value = value;
      if (value) {
        viewHandle?.updatePreview({ status: "VALID", aircraft: Number(drag.handle.dataset.srAircraft), ghost: value.ghost });
        showPreviewStatus(value.error ?? `${value.text} · release to apply`, value.error ? "warning" : "valid");
      }
      return;
    }
    if (drag && drag.pointerId === event.pointerId && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) drag.moved = true;
  }, { capture: true });
  shell.addEventListener("pointerup", (event) => {
    if (!active || mode === "draw") return;
    if (drag?.handle && drag.pointerId === event.pointerId) {
      event.stopPropagation();
      const { handle, value } = drag;
      drag = null;
      clearPreview();
      if (value?.patch && !value.error) send({ kind: "updateRow", aircraft: Number(handle.dataset.srAircraft), rowId: handle.dataset.srRow, patch: value.patch });
      return;
    }
  }, { capture: true });
  shell.addEventListener("click", (event) => {
    if (!active) return;
    if (mode === "draw") {
      event.stopPropagation();
      lastPointer = clientToWorld(event);
      updateDrawPreview();
      commitDraw();
      return;
    }
    const moved = drag?.moved;
    drag = null;
    if (moved || event.target.closest?.("[data-movable-label], [data-sr-handle]")) return;
    const hit = event.target.closest?.("[data-sr-row]");
    if (hit) {
      const aircraft = Number(hit.dataset.srAircraft);
      const rowId = hit.dataset.srRow;
      const result = output?.aircraft?.[aircraft]?.rows.find((row) => row.id === rowId);
      selectRow(aircraft, result?.autoFor ?? rowId);
    } else {
      // Background: deselect only (never creates a maneuver in Select mode).
      selectRow(null, null);
    }
  }, { capture: true });
  shell.addEventListener("pointerleave", () => {
    lastPointer = null;
    if (mode === "draw") clearPreview();
  });

  document.addEventListener("keydown", (event) => {
    if (!active) return;
    const typing = event.target?.matches?.("input, select, textarea, [contenteditable='true']");
    if (event.key === "Escape") {
      if (preview || drag?.handle) {
        drag = null;
        clearPreview();
        event.stopPropagation();
      } else if (mode === "draw") {
        setMode("select");
        event.stopPropagation();
      }
      return;
    }
    if (typing) return;
    if ((event.key === "Delete" || event.key === "Backspace") && selected && selected.rowId !== "sem" && plan.aircraft[selected.aircraft]?.rows.some((row) => row.id === selected.rowId)) {
      event.preventDefault();
      const { aircraft, rowId } = selected;
      selected = null;
      send({ kind: "deleteRow", aircraft, rowId });
      return;
    }
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "z" && !event.shiftKey) {
      event.preventDefault();
      undo();
    } else if ((event.ctrlKey || event.metaKey) && (key === "y" || (key === "z" && event.shiftKey))) {
      event.preventDefault();
      redo();
    }
  }, true);

  // ---- mount API (wide-layout) ---------------------------------------------------------------------
  // Diagnostics for the browser oracle (nothing here calculates).
  globalThis.semRejoinCalculation = Object.freeze({
    whenIdle: () => scheduler.whenIdle(),
    state: () => ({ ...scheduler.state(), adopted: adoptedCount, previews: previewCount, mode, active, selected, undo: undoStack.length, redo: redoStack.length }),
    output: () => output,
    plan: () => plan,
    evaluation: () => evaluation,
    preview: () => preview,
    project: (point) => viewHandle?.project(point) ?? null,
  });

  renderAll();
  return {
    // The centre panel opened: draw the latest valid result; one request when the upstream changed.
    activate() {
      if (active) return;
      active = true;
      if (dirty && upstream) {
        dirty = false;
        scheduler.immediate(null);
      }
      renderAll();
    },
    deactivate() {
      if (!active) return;
      active = false;
      clearPreview();
      setMode("select");
    },
    setEditAircraft(number) {
      if (number === editAircraft) return;
      editAircraft = number;
      if (selected && selected.aircraft !== number) selected = null;
      if (!selected && evaluationRequest.mode !== "FREE") evaluationRequest = { mode: "AUTO" };
      evaluation = reevaluate() ?? evaluation;
      clearPreview();
      renderAll();
    },
    setShownAircraft(list) {
      shown = [...list];
      renderTable();
      renderEvaluation();
      if (active) viewControls.redraw();
    },
    isActive: () => active,
  };
}

