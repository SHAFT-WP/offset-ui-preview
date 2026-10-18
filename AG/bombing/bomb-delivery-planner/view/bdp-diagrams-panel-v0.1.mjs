import { BDP_PROFILE_VIEW_V0_2, bdpProfileTitle, renderBdpProfileView } from "./bdp-profile-view-v0.2.mjs?v=0.2.5";
import { BDP_TOP_VIEW_V0_2, bdpTopViewTitle, renderBdpTopView } from "./bdp-top-view-v0.2.mjs?v=0.2.10";
import { installSvgViewControls, svgViewControlsMarkup } from "../../../../common/diagram/svg-view-controls-v0.1.mjs?v=0.1.0";
import { installSvgLegend } from "../../../../common/diagram/svg-legend-v0.1.mjs?v=0.1.1";
import { BDP_FLIGHT_PATH_V0_1, buildBdpFlightPath, padlockStep } from "./bdp-flight-path-v0.1.mjs?v=0.1.1";
import { BDP_3D_VIEW_V0_1, orbitByDrag, renderBdp3dView, zoomAbout } from "./bdp-3d-view-v0.1.mjs?v=0.1.1";
import { BDP_HUD_VIEW_V0_1, padlockTotalDeg, renderBdpHudView } from "./bdp-hud-view-v0.1.mjs?v=0.1.1";
import { bdpViewTitle } from "./bdp-view-style-v0.1.mjs";

// Full BDP diagrams panel — BDP-owned presentation reused by every BE that embeds a BDP input tab
// (Offset now; BOX, Wheel and Wheel-BOX next). While the consumer's Full BDP is on, the tab shows
// the Roll-in Top View and the Dive Profile of the profile it solved, each in its own collapsible
// panel (open by default). While Full BDP is off, neither panel nor its title is shown.
//
// Contract with the consumer:
// - place bdpDiagramsMarkup({ aircraftNumber }) inside the element that receives the class
//   "show-full-bdp" when Full BDP is on (the app-common CSS shows .bdp-diagrams only there);
// - call renderBdpDiagrams(container, bdpResult, { scope }) after each solve with the BDP v0.3
//   result the BE used (for Offset, result.profile), or clearBdpDiagrams(container) without one.
// 0.2.0 (2026-09-29): the views are self-contained (bdp-top-view-v0.2 / bdp-profile-view-v0.2),
// so the panels hold empty svgs; titles follow TERMINOLOGY "Diagram titles" (Roll-in #n Top View,
// Dive #n Profile). The views scope their own marker ids per panel.
// 0.3.0 (2026-09-29): `topView` options pass through to the Roll-in Top View, e.g. Offset's north-up
// map `{ orientation: "NORTH_UP", inHeadingDeg, rollDirection }`. Without them the view keeps its
// default orientation.
// 0.4.0 (2026-09-29): each panel carries the Common Text / Size / Reset toolbar
// (common/diagram/svg-view-controls-v0.1.mjs); its labels move by the 0.5 s long-press.

export const BDP_DIAGRAMS_PANEL_V0_1 = Object.freeze({
  id: "bdp-diagrams-panel-v0.1",
  // 0.4.1 (2026-10-03): Roll-in Top View 0.2.3 (hosts may pass topView.rollInRangeStyle).
  // 0.4.2 (2026-10-06): `topTitle` (markup) / `topView.title` name the Top View panel for a host
  // (Offset: "BDP (Bomb Delivery Planner) #n Top View").
  // 0.4.3 (2026-10-06): Roll-in Top View 0.2.5 (remarkDetail, oneLineLabels).
  // 0.5.0 (2026-10-07, user, Offset): `layout` passes to both views; a view that returns `legend`
  // items (layout "OFFSET") gets them in a legend box under its drawing (Offset Top View format).
  // 0.5.1 (2026-10-07): imports BDP Top View 0.2.7 (no Roll-in Radius label in the Offset layout).
  // 0.6.0 (2026-10-07, user, Offset): bdpDiagramsMarkup({ topAdvanced: true }) puts an
  // "Advanced: Off/On" button beside the Top View title; it redraws the Top View with
  // topView.advanced. Legend boxes follow a view's `legendColumns`.
  // 0.7.0 (2026-10-15, owner R5 / R6, Offset): `profileView` options pass to the Profile (SEM, fragment
  // cylinder and the aircraft at `timeAfterReleaseSec`); Top View 0.2.9 (upHeadingDeg), Profile 0.2.4.
  // 0.8.0 (2026-10-15, owner R6, Offset): bdpDiagramsMarkup({ flightViews: true }) adds the 3D Profile and
  // HUD View panels under the Top View (bdp-3d-view-v0.1 / bdp-hud-view-v0.1 from bdp-flight-path-v0.1 of a
  // BDP v0.4.1 result). The 3D Profile turns by drag (Reset, Altitude ×2); the HUD inputs sit under the HUD
  // (size, screen FOV, AOA, FPM path, the host's time dial markup, Padlock held at 60°/s). renderBdpDiagrams
  // takes `flightView: { rollDirection, timeSec }` (seconds from the Roll-in Point; null: no aircraft in 3D,
  // the Track Point in the HUD).
  // 0.9.0 (2026-10-18, owner handoff §3–§5, §8): Top View Initial Up / North Up buttons (topOrientation); the 3D
  // Profile and HUD View title tools (Reset View, − / % / +), 3D pinch / wheel zoom and pan, HUD zoom by camera FOV,
  // the HUD starting at Roll-in −3 s with the host's approach samples (flightView.approach); the Profile Advanced
  // button (profileAdvanced: SEM, MINALT and the fragment envelope, off by default); legend notes.
  version: "0.9.0",
  views: Object.freeze([BDP_TOP_VIEW_V0_2.id, BDP_PROFILE_VIEW_V0_2.id, BDP_3D_VIEW_V0_1.id, BDP_HUD_VIEW_V0_1.id]),
});

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

export function bdpDiagramsMarkup({ aircraftNumber, topTitle, topAdvanced = false, topOrientation = false, profileAdvanced = false, flightViews = false, threeDTitle, hudTitle, hudTimeMarkup = "" } = {}) {
  // Initial Up / North Up (0.9.0, Offset): the Top View's map up, Initial Up by default.
  const orientationButtons = (kind) => kind === "top" && topOrientation
    ? `<span class="bdp-orientation" role="group" aria-label="Top View up" style="margin-left:12px;display:inline-flex;gap:4px">`
      + `<button class="capture-button view-toggle" type="button" data-bdp-orientation="INITIAL_UP" aria-pressed="true" title="The Initial heading (into the Roll-in Point) points up">Initial Up</button>`
      + `<button class="capture-button view-toggle" type="button" data-bdp-orientation="NORTH_UP" aria-pressed="false" title="True north points up">North Up</button></span>`
    : "";
  const advancedButton = (kind) => (kind === "top" && topAdvanced
    ? `<button class="capture-button view-toggle bdp-advanced-toggle" type="button" data-bdp-advanced aria-pressed="false" style="margin-left:12px;margin-right:auto">Advanced: Off</button>`
    : kind === "profile" && profileAdvanced
      // Profile Advanced (0.9.0, owner handoff §8): off by default, it adds the SEM, MINALT and the fragment envelope.
      ? `<button class="capture-button view-toggle bdp-advanced-toggle" type="button" data-bdp-profile-advanced aria-pressed="false" style="margin-left:12px;margin-right:auto" title="SEM path, SEM Min Height, MINALT and the fragment envelope (Dive Angle over 10°)">Advanced: Off</button>`
      : "");
  const panel = (kind, title) => `<details class="input-panel bdp-diagram" open data-bdp-diagram="${kind}">`
    + `<summary>${escapeText(title)}${orientationButtons(kind)}${advancedButton(kind)}</summary><div class="diagram-actions">${svgViewControlsMarkup({ title })}</div><div class="bdp-diagram-canvas">`
    + `<svg viewBox="0 0 900 700" role="img" aria-label="${escapeText(title)}"></svg>`
    + `<svg class="diagram-legend-box" data-bdp-legend="${kind}" role="img" aria-label="${escapeText(title)} legend" hidden></svg></div></details>`;
  return `<div class="bdp-diagrams" data-bdp-diagrams>`
    + panel("top", topTitle || bdpTopViewTitle({ aircraftNumber }))
    + (flightViews ? flightViewsMarkup({ aircraftNumber, threeDTitle, hudTitle, hudTimeMarkup }) : "")
    + panel("profile", bdpProfileTitle({ aircraftNumber }))
    + `</div>`;
}

const CONTROL_STYLE = "min-height:32px;padding:4px 6px;font-size:12px;border-radius:9px";

// 3D Profile and HUD View panels (0.8.0). The HUD inputs are only the HUD's own (BDP values are not repeated).
function flightViewsMarkup({ aircraftNumber, threeDTitle, hudTitle, hudTimeMarkup }) {
  const t3 = escapeText(threeDTitle || bdpViewTitle("BDP", "3D Profile", { aircraftNumber }));
  const th = escapeText(hudTitle || bdpViewTitle("BDP", "HUD View", { aircraftNumber }));
  const { width: w3, height: h3 } = BDP_3D_VIEW_V0_1.canvas;
  const { width: wh, height: hh } = BDP_HUD_VIEW_V0_1.canvas;
  const d = BDP_HUD_VIEW_V0_1.defaults;
  const fov = [30, 70, 120].map((value) => `<option value="${value}"${value === d.fovDeg ? " selected" : ""}>${value}°</option>`).join("");
  // Title tools (0.9.0, owner handoff §3.2 / §4.4): Reset View and − / % / + beside each title.
  const viewTools = (kind, extra = "") => `<span class="bdp-view-tools" style="margin-left:12px;margin-right:auto;display:inline-flex;flex-wrap:wrap;gap:4px">`
    + `<button class="capture-button" type="button" data-bdp-${kind}="reset" title="Back to the default view (camera, zoom${kind === "3d" ? ", pan, Altitude ×1" : ", FOV, padlock"})">Reset View</button>`
    + `<button class="capture-button" type="button" data-bdp-${kind}="zoom-out" aria-label="Zoom out">−</button>`
    + `<button class="capture-button diagram-scale-output" type="button" data-bdp-${kind}="zoom-reset" aria-label="Zoom 100%">100%</button>`
    + `<button class="capture-button" type="button" data-bdp-${kind}="zoom-in" aria-label="Zoom in">+</button>${extra}</span>`;
  return `<details class="input-panel bdp-diagram" open data-bdp-diagram="3d"><summary>${t3}${viewTools("3d", `<button class="capture-button view-toggle" type="button" data-bdp-3d="altitude" aria-pressed="false">Altitude ×1</button>`)}</summary>`
    + `<div class="diagram-actions"><div class="diagram-action-row" data-bdp-3d-controls>`
    + `<span class="diagram-control-label">Drag: turn · Shift-drag or two fingers: pan · Wheel or pinch: zoom</span></div></div>`
    + `<div class="bdp-diagram-canvas"><svg class="bdp-3d-svg" viewBox="0 0 ${w3} ${h3}" role="img" aria-label="${t3}" style="touch-action:none;cursor:grab"></svg>`
    + `<svg class="diagram-legend-box" data-bdp-legend="3d" role="img" aria-label="${t3} legend" hidden></svg></div></details>`
    + `<details class="input-panel bdp-diagram" open data-bdp-diagram="hud"><summary>${th}${viewTools("hud")}</summary>`
    + `<div class="bdp-diagram-canvas"><svg class="bdp-hud-svg" viewBox="0 0 ${wh} ${hh}" role="img" aria-label="${th}"></svg></div>`
    + `<div class="diagram-actions bdp-hud-controls" data-bdp-hud-controls><div class="diagram-action-row">`
    + `<span class="diagram-control-label">HUD</span><input type="number" data-bdp-hud="size" min="4" max="40" step="1" value="${d.hudSizeDeg}" inputmode="numeric" style="${CONTROL_STYLE};width:4.2em" aria-label="HUD size (degrees, square)"><span class="diagram-control-label">°</span>`
    + `<span class="diagram-control-label">FOV</span><select data-bdp-hud="fov" style="${CONTROL_STYLE};width:auto" aria-label="Screen vertical field of view">${fov}</select>`
    + `<button class="capture-button view-toggle" type="button" data-bdp-hud="aoa" aria-pressed="${d.aoa}">AOA: ${d.aoa ? "On" : "Off"}</button>`
    + `<button class="capture-button view-toggle" type="button" data-bdp-hud="fpm-path" aria-pressed="${d.fpmPath}">FPM path: ${d.fpmPath ? "On" : "Off"}</button>`
    + `<button class="capture-button view-toggle" type="button" data-bdp-hud="padlock" aria-pressed="false" style="touch-action:none;user-select:none;-webkit-user-select:none" title="Hold: the view turns to the Target at 60°/s; release: it returns">Padlock</button>`
    + `</div>${hudTimeMarkup}</div></details>`;
}

// One toolbar per panel svg, installed on its first render; each redraw draws the panel's latest
// arguments at the panel's own Text scale.
const panelControls = new WeakMap();
function panelView(container, kind, draw) {
  const panel = container.querySelector(`[data-bdp-diagram="${kind}"]`);
  const svg = panel?.querySelector("svg");
  if (!svg) return null;
  let entry = panelControls.get(svg);
  if (!entry) {
    entry = { draw: null };
    entry.controls = installSvgViewControls(svg, { controls: panel, render: ({ textScale }) => entry.draw?.(svg, textScale) ?? null });
    panelControls.set(svg, entry);
  }
  entry.draw = draw;
  return entry.controls;
}

// The legend box under a panel's drawing, rebuilt with each draw's items (hidden without any).
const panelLegends = new WeakMap();
function showLegend(container, kind, items, columns, notes = []) {
  const box = container.querySelector(`[data-bdp-legend="${kind}"]`);
  if (!box) return;
  // Rebuilt only when its content changes (the 3D view redraws on every drag and clock step).
  const key = JSON.stringify([items ?? [], columns ?? 0, notes ?? []]);
  if (panelLegends.has(box) && box.dataset.legendKey === key) return;
  panelLegends.get(box)?.destroy();
  panelLegends.delete(box);
  box.dataset.legendKey = key;
  box.toggleAttribute("hidden", !items?.length);
  if (items?.length) panelLegends.set(box, installSvgLegend(box, items, notes ?? [], { columns: columns ?? 0 }));
}

export function renderBdpDiagrams(container, bdpResult, { scope = "bdp", aircraftNumber, topView = {}, profileView = {}, flightView, layout } = {}) {
  if (!container) return false;
  container.dataset.bdpScope = scope;
  const withLegend = (kind, rendered) => { showLegend(container, kind, rendered?.legend, rendered?.legendColumns); return rendered; };
  // Advanced button (bdpDiagramsMarkup topAdvanced): its state lives on the button.
  const advancedButton = container.querySelector("[data-bdp-advanced]");
  const advancedOn = () => advancedButton?.getAttribute("aria-pressed") === "true";
  // Initial Up / North Up buttons (0.9.0): Initial Up turns the map so the host's Initial heading
  // (topView.inHeadingDeg) points up; North Up keeps true north up.
  const orientationButtons = [...container.querySelectorAll("[data-bdp-orientation]")];
  const orientationUp = () => {
    if (!orientationButtons.length || !Number.isFinite(Number(topView.inHeadingDeg))) return {};
    const mode = orientationButtons.find((button) => button.getAttribute("aria-pressed") === "true")?.dataset.bdpOrientation ?? "INITIAL_UP";
    return { upHeadingDeg: mode === "INITIAL_UP" ? Number(topView.inHeadingDeg) : 0 };
  };
  const top = panelView(container, "top", (svg, textScale) =>
    withLegend("top", renderBdpTopView(svg, bdpResult, { ...topView, ...orientationUp(), ...(advancedButton ? { advanced: advancedOn() } : {}), layout, textScale, movableLabels: true, scope: `${scope}-top`, aircraftNumber })));
  const profileAdvancedButton = container.querySelector("[data-bdp-profile-advanced]");
  const profileDetail = () => (profileAdvancedButton ? { semDetail: profileAdvancedButton.getAttribute("aria-pressed") === "true" } : {});
  const profile = panelView(container, "profile", (svg, textScale) =>
    withLegend("profile", renderBdpProfileView(svg, bdpResult, { ...profileView, ...profileDetail(), layout, textScale, movableLabels: true, scope: `${scope}-profile`, aircraftNumber })));
  if (profileAdvancedButton && !profileAdvancedButton.dataset.bdpAdvancedReady) {
    profileAdvancedButton.dataset.bdpAdvancedReady = "true";
    profileAdvancedButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const on = profileAdvancedButton.getAttribute("aria-pressed") !== "true";
      profileAdvancedButton.setAttribute("aria-pressed", String(on));
      profileAdvancedButton.textContent = `Advanced: ${on ? "On" : "Off"}`;
      panelControls.get(container.querySelector('[data-bdp-diagram="profile"] svg'))?.controls.redraw();
    });
  }
  if (!top || !profile) return false;
  if (advancedButton && !advancedButton.dataset.bdpAdvancedReady) {
    advancedButton.dataset.bdpAdvancedReady = "true";
    advancedButton.addEventListener("click", (event) => {
      // The button sits in the panel's <summary>: keep the panel open.
      event.preventDefault();
      event.stopPropagation();
      const on = !advancedOn();
      advancedButton.setAttribute("aria-pressed", String(on));
      advancedButton.textContent = `Advanced: ${on ? "On" : "Off"}`;
      panelControls.get(container.querySelector('[data-bdp-diagram="top"] svg'))?.controls.redraw();
    });
  }
  orientationButtons.forEach((button) => {
    if (button.dataset.bdpOrientationReady) return;
    button.dataset.bdpOrientationReady = "true";
    button.addEventListener("click", (event) => {
      // The buttons sit in the panel's <summary>: keep the panel open.
      event.preventDefault();
      event.stopPropagation();
      orientationButtons.forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
      panelControls.get(container.querySelector('[data-bdp-diagram="top"] svg'))?.controls.redraw();
    });
  });
  top.redraw();
  profile.redraw();
  renderFlightViews(container, bdpResult, flightView);
  container.dataset.bdpDiagramsState = "rendered";
  return true;
}

// 3D Profile and HUD View state of one container: the flight path, its clock, the orbit and the padlock.
const flightStates = new WeakMap();
function flightState(container) {
  let state = flightStates.get(container);
  if (!state) {
    state = { path: null, timeSec: null, orbit: null, altitudeScale: 1, zoom3d: 1, pan3d: { x: 0, y: 0 }, hudZoom: 1, progressDeg: 0, holding: false, frame: 0, lastFrame: null };
    flightStates.set(container, state);
  }
  return state;
}

// HUD zoom (0.9.0): the camera FOV from the selected FOV F0 and the zoom z, FOV = 2·atan(tan(F0/2)/z); the HUD
// size (the glass) is not changed by it.
const HUD_ZOOM_LIMITS = [0.5, 2];
const ZOOM_STEP = 0.25;
function hudOptions(container) {
  const control = (name) => container.querySelector(`[data-bdp-hud="${name}"]`);
  const baseFovDeg = Number(control("fov")?.value) || BDP_HUD_VIEW_V0_1.defaults.fovDeg;
  const zoom = flightState(container).hudZoom || 1;
  return {
    hudSizeDeg: Number(control("size")?.value) || BDP_HUD_VIEW_V0_1.defaults.hudSizeDeg,
    fovDeg: (2 * Math.atan(Math.tan((baseFovDeg / 2) * Math.PI / 180) / zoom) * 180) / Math.PI,
    aoa: control("aoa") ? control("aoa").getAttribute("aria-pressed") === "true" : BDP_HUD_VIEW_V0_1.defaults.aoa,
    fpmPath: control("fpm-path") ? control("fpm-path").getAttribute("aria-pressed") === "true" : BDP_HUD_VIEW_V0_1.defaults.fpmPath,
  };
}

function draw3d(container, scope) {
  const svg = container.querySelector('[data-bdp-diagram="3d"] svg.bdp-3d-svg');
  const state = flightState(container);
  if (!svg || !state.path) return;
  const rendered = renderBdp3dView(svg, state.path, { orbit: state.orbit ?? undefined, altitudeScale: state.altitudeScale, zoom: state.zoom3d, pan: state.pan3d, timeSec: state.timeSec, scope: `${scope}-3d` });
  svg.dataset.orbit = `${Math.round(rendered.orbit.azimuthDeg)}/${Math.round(rendered.orbit.elevationDeg)}`;
  svg.dataset.zoom = String(Math.round(rendered.zoom * 100));
  svg.dataset.pan = `${Math.round(rendered.pan.x)}/${Math.round(rendered.pan.y)}`;
  const output = container.querySelector('[data-bdp-3d="zoom-reset"]');
  if (output) output.textContent = `${Math.round(rendered.zoom * 100)}%`;
  showLegend(container, "3d", rendered.legend, rendered.legendColumns, rendered.legendNotes);
}

function drawHud(container, scope) {
  const svg = container.querySelector('[data-bdp-diagram="hud"] svg.bdp-hud-svg');
  const state = flightState(container);
  if (!svg || !state.path) return;
  const rendered = renderBdpHudView(svg, state.path, { ...hudOptions(container), timeSec: hudTime(state), gazeProgressDeg: state.progressDeg, scope: `${scope}-hud` });
  state.progressDeg = rendered.progressDeg;
  svg.dataset.fovDeg = rendered.fovDeg.toFixed(2);
  svg.dataset.zoom = String(Math.round((state.hudZoom || 1) * 100));
  const output = container.querySelector('[data-bdp-hud="zoom-reset"]');
  if (output) output.textContent = `${Math.round((state.hudZoom || 1) * 100)}%`;
  svg.dataset.padlockDeg = rendered.progressDeg.toFixed(1);
  svg.dataset.padlockTotalDeg = rendered.totalDeg.toFixed(1);
  svg.dataset.padlockLocked = String(rendered.locked);
}

// The HUD's time: the clock's, else its start, Roll-in −3 s (owner handoff §3.1).
const hudTime = (state) => (Number.isFinite(state.timeSec) ? state.timeSec : BDP_FLIGHT_PATH_V0_1.hudStartSec);

// Padlock (owner 2026-10-15, plan §0.1 / §4.6): while held the gaze angle grows at 60°/s up to the Target and
// stays locked on it; released, it shrinks at the same rate; held again on the way back, it grows from there.
// One animation frame loop per container runs while held or until the gaze is back at the HUD centre.
function padlockFrame(container, scope, now) {
  const state = flightState(container);
  if (!state.path) { state.frame = 0; state.lastFrame = null; return; }
  const dtSec = state.lastFrame === null ? 0 : Math.min(0.1, (now - state.lastFrame) / 1000);
  state.lastFrame = now;
  const timeSec = hudTime(state);
  state.progressDeg = padlockStep(state.progressDeg, { holding: state.holding, dtSec, totalDeg: padlockTotalDeg(state.path, timeSec, hudOptions(container)) });
  drawHud(container, scope);
  if (state.holding || state.progressDeg > 0) state.frame = requestAnimationFrame((time) => padlockFrame(container, scope, time));
  else { state.frame = 0; state.lastFrame = null; }
}

function installFlightControls(container, scope) {
  if (container.dataset.bdpFlightReady) return;
  container.dataset.bdpFlightReady = "true";
  const state = flightState(container);
  const svg3d = container.querySelector('[data-bdp-diagram="3d"] svg.bdp-3d-svg');
  // 3D gestures (0.9.0, owner handoff §4.4): one pointer turns (Shift or the middle button pans); two pointers
  // zoom by their distance and pan by their centre, both at once; the wheel zooms about the cursor. A change in
  // the number of pointers restarts from the current pointers. View state only: no solve, no Save.
  const pointers = new Map();
  let gesture = null;
  const toCanvas = (event) => {
    const box = svg3d.getBoundingClientRect();
    const k = BDP_3D_VIEW_V0_1.canvas.width / Math.max(1, box.width);
    return { x: (event.clientX - box.left) * k, y: (event.clientY - box.top) * k, k };
  };
  const currentOrbit = () => state.orbit ?? { azimuthDeg: Number(svg3d.dataset.orbit?.split("/")[0]), elevationDeg: Number(svg3d.dataset.orbit?.split("/")[1]) };
  const startGesture = () => {
    const list = [...pointers.values()];
    if (list.length >= 2) {
      const [a, b] = list;
      gesture = { kind: "pinch", distance: Math.hypot(a.x - b.x, a.y - b.y), centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    } else if (list.length === 1) {
      gesture = { kind: list[0].pan ? "pan" : "orbit", last: { x: list[0].x, y: list[0].y } };
    } else gesture = null;
    svg3d.style.cursor = gesture ? "grabbing" : "grab";
  };
  svg3d?.addEventListener("pointerdown", (event) => {
    if (!state.path) return;
    try { svg3d.setPointerCapture(event.pointerId); } catch { /* synthetic or ended pointer */ }
    pointers.set(event.pointerId, { ...toCanvas(event), pan: event.shiftKey || event.button === 1 });
    event.preventDefault();
    startGesture();
  });
  svg3d?.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    pointers.set(event.pointerId, { ...toCanvas(event), pan: pointers.get(event.pointerId).pan });
    const list = [...pointers.values()];
    if (gesture.kind === "pinch" && list.length >= 2) {
      const [a, b] = list;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const zoomed = zoomAbout({ zoom: state.zoom3d, pan: state.pan3d }, gesture.distance > 0 ? distance / gesture.distance : 1, gesture.centre.x, gesture.centre.y);
      state.zoom3d = zoomed.zoom;
      state.pan3d = { x: zoomed.pan.x + centre.x - gesture.centre.x, y: zoomed.pan.y + centre.y - gesture.centre.y };
      gesture.distance = distance;
      gesture.centre = centre;
    } else if (list.length === 1) {
      const p = list[0];
      const dx = p.x - gesture.last.x;
      const dy = p.y - gesture.last.y;
      if (gesture.kind === "pan") state.pan3d = { x: state.pan3d.x + dx, y: state.pan3d.y + dy };
      else state.orbit = orbitByDrag(currentOrbit(), dx, dy);
      gesture.last = { x: p.x, y: p.y };
    }
    draw3d(container, scope);
  });
  const endPointer = (event) => {
    if (!pointers.delete(event.pointerId)) return;
    startGesture();
  };
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((name) => svg3d?.addEventListener(name, endPointer));
  svg3d?.addEventListener("wheel", (event) => {
    if (!state.path) return;
    event.preventDefault();
    const p = toCanvas(event);
    const zoomed = zoomAbout({ zoom: state.zoom3d, pan: state.pan3d }, Math.exp(-event.deltaY * 0.0015), p.x, p.y);
    state.zoom3d = zoomed.zoom;
    state.pan3d = zoomed.pan;
    draw3d(container, scope);
  }, { passive: false });
  // Title tools sit in <summary>: keep the panel open on their clicks.
  const tool = (selector, action) => container.querySelector(selector)?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    action(event.currentTarget);
  });
  const { width: W3, height: H3 } = BDP_3D_VIEW_V0_1.canvas;
  const zoom3dBy = (step) => {
    const zoomed = zoomAbout({ zoom: state.zoom3d, pan: state.pan3d }, (state.zoom3d + step) / state.zoom3d, W3 / 2, H3 / 2);
    state.zoom3d = zoomed.zoom;
    state.pan3d = zoomed.pan;
    draw3d(container, scope);
  };
  const altitudeButton = container.querySelector('[data-bdp-3d="altitude"]');
  const setAltitude = (scale) => {
    state.altitudeScale = scale;
    altitudeButton?.setAttribute("aria-pressed", String(scale === 2));
    if (altitudeButton) altitudeButton.textContent = `Altitude ×${scale}`;
  };
  tool('[data-bdp-3d="reset"]', () => {
    state.orbit = null;
    state.zoom3d = 1;
    state.pan3d = { x: 0, y: 0 };
    setAltitude(1);
    draw3d(container, scope);
  });
  tool('[data-bdp-3d="zoom-in"]', () => zoom3dBy(ZOOM_STEP));
  tool('[data-bdp-3d="zoom-out"]', () => zoom3dBy(-ZOOM_STEP));
  tool('[data-bdp-3d="zoom-reset"]', () => { state.zoom3d = 1; state.pan3d = { x: 0, y: 0 }; draw3d(container, scope); });
  tool('[data-bdp-3d="altitude"]', () => { setAltitude(state.altitudeScale === 2 ? 1 : 2); draw3d(container, scope); });
  const hudZoomTo = (zoom) => { state.hudZoom = Math.min(HUD_ZOOM_LIMITS[1], Math.max(HUD_ZOOM_LIMITS[0], Math.round(zoom * 100) / 100)); drawHud(container, scope); };
  tool('[data-bdp-hud="zoom-in"]', () => hudZoomTo(state.hudZoom + ZOOM_STEP));
  tool('[data-bdp-hud="zoom-out"]', () => hudZoomTo(state.hudZoom - ZOOM_STEP));
  tool('[data-bdp-hud="zoom-reset"]', () => hudZoomTo(1));
  tool('[data-bdp-hud="reset"]', () => {
    // Camera only: FOV, zoom and the padlock gaze; never the inputs, the SEM or the clock.
    const fov = container.querySelector('[data-bdp-hud="fov"]');
    if (fov) fov.value = String(BDP_HUD_VIEW_V0_1.defaults.fovDeg);
    state.holding = false;
    state.progressDeg = 0;
    container.querySelector('[data-bdp-hud="padlock"]')?.setAttribute("aria-pressed", "false");
    hudZoomTo(1);
  });
  container.querySelectorAll('[data-bdp-hud="size"], [data-bdp-hud="fov"]').forEach((input) => {
    input.addEventListener(input.type === "number" ? "input" : "change", () => drawHud(container, scope));
  });
  container.querySelectorAll('[data-bdp-hud="aoa"], [data-bdp-hud="fpm-path"]').forEach((button) => {
    button.addEventListener("click", () => {
      const on = button.getAttribute("aria-pressed") !== "true";
      button.setAttribute("aria-pressed", String(on));
      button.textContent = `${button.dataset.bdpHud === "aoa" ? "AOA" : "FPM path"}: ${on ? "On" : "Off"}`;
      drawHud(container, scope);
    });
  });
  const padlock = container.querySelector('[data-bdp-hud="padlock"]');
  const hold = (on) => {
    if (on && !state.path) return;
    state.holding = on;
    padlock?.setAttribute("aria-pressed", String(on));
    if (on && !state.frame) state.frame = requestAnimationFrame((time) => padlockFrame(container, scope, time));
  };
  padlock?.addEventListener("pointerdown", (event) => {
    try { padlock.setPointerCapture(event.pointerId); } catch { /* synthetic or ended pointer */ }
    hold(true);
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((name) => padlock?.addEventListener(name, () => hold(false)));
  padlock?.addEventListener("keydown", (event) => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); hold(true); } });
  padlock?.addEventListener("keyup", (event) => { if (event.key === " " || event.key === "Enter") hold(false); });
  padlock?.addEventListener("contextmenu", (event) => event.preventDefault());
}

function renderFlightViews(container, bdpResult, flightView) {
  const panels = container.querySelector('[data-bdp-diagram="3d"], [data-bdp-diagram="hud"]');
  if (!panels) return;
  const scope = container.dataset.bdpScope || "bdp";
  const state = flightState(container);
  try {
    state.path = buildBdpFlightPath(bdpResult, { rollDirection: flightView?.rollDirection, approach: flightView?.approach ?? null });
  } catch {
    clearFlightViews(container);
    return;
  }
  state.timeSec = Number.isFinite(flightView?.timeSec) ? flightView.timeSec : null;
  installFlightControls(container, scope);
  draw3d(container, scope);
  drawHud(container, scope);
}

function clearFlightViews(container) {
  const state = flightStates.get(container);
  if (state) {
    if (state.frame) cancelAnimationFrame(state.frame);
    Object.assign(state, { path: null, frame: 0, lastFrame: null, holding: false, progressDeg: 0 });
  }
  container.querySelector('[data-bdp-hud="padlock"]')?.setAttribute("aria-pressed", "false");
  container.querySelectorAll('[data-bdp-diagram="3d"] svg.bdp-3d-svg, [data-bdp-diagram="hud"] svg.bdp-hud-svg').forEach((svg) => svg.replaceChildren());
}

export function clearBdpDiagrams(container) {
  if (container) clearFlightViews(container);
  container?.querySelectorAll("[data-bdp-legend]").forEach((box) => {
    panelLegends.get(box)?.destroy();
    panelLegends.delete(box);
    box.replaceChildren();
    box.setAttribute("hidden", "");
  });
  container?.querySelectorAll("[data-bdp-diagram] svg:not([data-bdp-legend])").forEach((svg) => {
    const entry = panelControls.get(svg);
    if (entry) entry.draw = null;
    svg.replaceChildren();
  });
  if (container) container.dataset.bdpDiagramsState = "empty";
}
