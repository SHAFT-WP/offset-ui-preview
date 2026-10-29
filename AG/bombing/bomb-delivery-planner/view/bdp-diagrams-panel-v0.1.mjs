import { BDP_PROFILE_VIEW_V0_2, bdpProfileTitle, renderBdpProfileView } from "./bdp-profile-view-v0.2.mjs?v=0.2.7";
import { BDP_TOP_VIEW_V0_2, bdpTopViewTitle, renderBdpTopView } from "./bdp-top-view-v0.2.mjs?v=0.2.11";
import { installSvgViewControls, svgViewControlsMarkup } from "../../../../common/diagram/svg-view-controls-v0.1.mjs?v=0.1.0";
import { installSvgLegend } from "../../../../common/diagram/svg-legend-v0.1.mjs?v=0.1.1";
import { BDP_FLIGHT_PATH_V0_1, buildBdpFlightPath } from "./bdp-flight-path-v0.1.mjs?v=0.1.5";
import { BDP_3D_VIEW_V0_1, bdp3dDefaultOrbit, bdp3dGestureInit, bdp3dGestureStep, renderBdp3dView, zoomAbout } from "./bdp-3d-view-v0.1.mjs?v=0.1.14";
import { BDP_HUD_VIEW_V0_1, renderBdpHudView } from "./bdp-hud-view-v0.1.mjs?v=0.1.7";
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
  // BDP v0.4.1 result). The 3D Profile turns by drag (Reset); the HUD inputs sit under the HUD
  // (size, screen FOV, AOA, FPM path, the host's time dial markup, Padlock held at 60°/s). renderBdpDiagrams
  // takes `flightView: { rollDirection, timeSec }` (seconds from the Roll-in Point; null: no aircraft in 3D,
  // the Track Point in the HUD).
  // 0.9.0 (2026-10-18, owner handoff §3–§5, §8): Top View Initial Up / North Up buttons (topOrientation); the 3D
  // Profile and HUD View title tools (Reset View, − / % / +), 3D pinch / wheel zoom and pan, HUD zoom by camera FOV,
  // the HUD starting at Roll-in −3 s with the host's approach samples (flightView.approach); the Profile Advanced
  // button (profileAdvanced: SEM, MINALT and the fragment envelope, off by default); legend notes.
  // 0.10.0 (2026-10-18, owner addendum "BDP view touch / layout"): panel order Dive Profile → 3D Profile → Top View →
  // HUD View (DOM order); 3D gestures through bdp3dGestureStep (drag turns, 0.5 s hold then drag pans, pinch only
  // zooms), drawing coalesced per animation frame, cleared on cancel / Reset View / collapse; no Altitude ×2.
  // 0.10.1 (2026-10-18, owner): renderBdpDiagrams takes the host's `viewportWidth` for the Offset-layout Top View and
  // Dive Profile text base (PC 1.2×, phone 2×); the 3D legend notes (3D 0.1.3).
  // 0.10.2 (2026-10-19, owner): views of the Level SEM turn (flight path 0.1.2, 3D 0.1.4, HUD 0.1.2, Profile 0.2.7).
  // 0.10.3 (2026-10-19, owner): the 3D Profile / HUD window, Roll-in −3 s to 1 s after the SEM's end (flight path
  // 0.1.3); bdpFlightViewWindow(container) gives it to the host (its HUD Play stops there).
  // 0.10.4 (2026-10-19, owner): the host's time dial copy under the 3D Profile title too (`threeDTimeMarkup`, a Play
  // for the 3D); a refresh with the same result and Top View options (a clock step) keeps the Top View as drawn.
  // 0.11.0 (2026-10-20, Offset): progressive draws the Profile first; other charts yield to paint.
  // Unchanged Profile/3D/HUD drawings and the flight path are reused. Other hosts remain synchronous.
  // 0.11.1 (2026-10-20, owner): 3D Profile 0.1.7 draws the bomb trajectory (flight path 0.1.4).
  // 0.11.2 (2026-10-21, owner: a smoother Play): a progressive clock step (only the time moved, nothing queued) redraws
  // the 3D Profile and HUD at once; 3D Profile 0.1.8 then redraws only its time layers, HUD 0.1.5 creates only the
  // ladder inside its square.
  // 0.11.3 (2026-10-28): flightView.startSec passes through for the Popup climb window.
  // 0.11.4: 3D 0.1.9 keeps the first Popup frame visible across clock conversion.
  // 0.11.5 (2026-10-29): 3D Profile 0.1.10, approved F-16 polygon aircraft.
  // 0.11.6 (2026-10-29): per-panel Aircraft size selector, Auto or 1–50× actual dimensions; camera zoom independent.
  // 0.11.7 (2026-10-29): HUD 0.1.6 overlays the shared 3D scene in its cockpit camera.
  version: "0.12.2",
  views: Object.freeze([BDP_TOP_VIEW_V0_2.id, BDP_PROFILE_VIEW_V0_2.id, BDP_3D_VIEW_V0_1.id, BDP_HUD_VIEW_V0_1.id]),
});

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

export function bdpDiagramsMarkup({ aircraftNumber, topTitle, topAdvanced = false, topOrientation = false, profileAdvanced = false, flightViews = false, threeDTitle, hudTitle, hudTimeMarkup = "", threeDTimeMarkup = "" } = {}) {
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
  // Owner 2026-10-30: 2D Top View first, then Dive Profile, 3D and HUD; DOM and focus order agree.
  const flight = flightViews ? flightViewsMarkup({ aircraftNumber, threeDTitle, hudTitle, hudTimeMarkup, threeDTimeMarkup }) : { threeD: "", hud: "" };
  return `<div class="bdp-diagrams" data-bdp-diagrams>`
    + panel("top", topTitle || bdpTopViewTitle({ aircraftNumber }))
    + panel("profile", bdpProfileTitle({ aircraftNumber }))
    + flight.threeD
    + flight.hud
    + `</div>`;
}

export function bdpHudPanelMarkup(options = {}) { return flightViewsMarkup(options).hud; }
export function renderBdpHudPanel(container, context, scope = "offset-hud") {
  const state = flightState(container);
  const previous = state.hudContext;
  if (previous?.you !== context?.you || previous?.aircraft?.some((a, i) => a.path !== context?.aircraft?.[i]?.path)) state.stopHud?.();
  state.hudContext = context;
  state.path = context?.aircraft?.find(a => a.number === context.you)?.path ?? null;
  installFlightControls(container, scope);
  drawHud(container, scope);
}

const CONTROL_STYLE = "min-height:32px;padding:4px 6px;font-size:12px;border-radius:9px";

// 3D Profile and HUD View panels (0.8.0). The HUD inputs are only the HUD's own (BDP values are not repeated).
function flightViewsMarkup({ aircraftNumber, threeDTitle, hudTitle, hudTimeMarkup, threeDTimeMarkup }) {
  const t3 = escapeText(threeDTitle || bdpViewTitle("BDP", "3D Profile", { aircraftNumber }));
  const th = escapeText(hudTitle || bdpViewTitle("BDP", "HUD View", { aircraftNumber }));
  const { width: w3, height: h3 } = BDP_3D_VIEW_V0_1.canvas;
  const { width: wh, height: hh } = BDP_HUD_VIEW_V0_1.canvas;
  const d = BDP_HUD_VIEW_V0_1.defaults;
  const fov = [30, 70, 120].map((value) => `<option value="${value}"${value === d.fovDeg ? " selected" : ""}>${value}°</option>`).join("");
  const aircraftScales = BDP_3D_VIEW_V0_1.aircraftScaleOptions.map((value) => `<option value="${value}">${value}×</option>`).join("");
  // Title tools (0.9.0, owner handoff §3.2 / §4.4): Reset View and − / % / + beside each title.
  const viewTools = (kind, extra = "") => `<span class="bdp-view-tools" style="margin-left:12px;margin-right:auto;display:inline-flex;flex-wrap:wrap;gap:4px">`
    + `<button class="capture-button" type="button" data-bdp-${kind}="reset" title="Back to the default view (camera, zoom${kind === "3d" ? ", pan" : ", FOV, padlock"})">Reset View</button>`
    + `<button class="capture-button" type="button" data-bdp-${kind}="zoom-out" aria-label="Zoom out">−</button>`
    + `<button class="capture-button diagram-scale-output" type="button" data-bdp-${kind}="zoom-reset" aria-label="Zoom 100%">100%</button>`
    + `<button class="capture-button" type="button" data-bdp-${kind}="zoom-in" aria-label="Zoom in">+</button>${extra}</span>`;
  // 3D (0.10.0, addendum §4–§7): no Altitude ×2; the gesture area alone takes the touch (no page scroll / selection
  // / long-press menu inside it).
  const threeD = `<details class="input-panel bdp-diagram" open data-bdp-diagram="3d"><summary>${t3}${viewTools("3d")}</summary>`
    + `<div class="diagram-actions"><div class="diagram-action-row" data-bdp-3d-controls>`
    + `<label data-bdp-fleet-label hidden>Show aircraft <select data-bdp-3d="fleet" aria-label="3D aircraft selection" style="${CONTROL_STYLE};width:auto"><option value="all">All</option></select></label><span data-bdp-fleet-status role="status"></span>`
    + `<label class="diagram-control-label" style="display:inline-flex;align-items:center;gap:6px">Aircraft <select data-bdp-3d="aircraft-scale" style="${CONTROL_STYLE};width:auto" aria-label="Aircraft size (times actual)" title="Aircraft size relative to the real F-16. Auto sizes it to the flight path."><option value="auto" selected>Auto</option>${aircraftScales}</select></label>`
    + `<span class="diagram-control-label">Drag: turn · Hold 0.5 s, then drag: pan · Pinch / wheel: zoom</span></div>${threeDTimeMarkup}</div>`
    + `<div class="bdp-diagram-canvas"><svg class="bdp-3d-svg" viewBox="0 0 ${w3} ${h3}" role="img" aria-label="${t3}" style="touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none"></svg>`
    + `<svg class="diagram-legend-box" data-bdp-legend="3d" role="img" aria-label="${t3} legend" hidden></svg></div></details>`;
  const hud = `<details class="input-panel bdp-diagram" open data-bdp-diagram="hud"><summary>${th}${viewTools("hud")}</summary>`
    + `<div class="diagram-actions"><div class="diagram-action-row" role="tablist" aria-label="HUD observer"><button class="capture-button" type="button" role="tab" data-hud-observer="you" aria-selected="true">You</button><button class="capture-button" type="button" role="tab" data-hud-observer="wingman" aria-selected="false" disabled>Wingman</button><label data-hud-pair-label hidden>Wingman <select data-hud-pair aria-label="Wingman aircraft" style="${CONTROL_STYLE};width:auto"></select></label><span data-hud-availability role="status"></span></div></div>`
    + `<div class="bdp-diagram-canvas"><svg class="bdp-hud-svg" viewBox="0 0 ${wh} ${hh}" role="img" aria-label="${th}"></svg></div>`
    + `<div class="diagram-actions bdp-hud-controls" data-bdp-hud-controls><div class="diagram-action-row">`
    + `<span class="diagram-control-label">HUD</span><input type="number" data-bdp-hud="size" min="4" max="40" step="1" value="${d.hudSizeDeg}" inputmode="numeric" style="${CONTROL_STYLE};width:4.2em" aria-label="HUD size (degrees, square)"><span class="diagram-control-label">°</span>`
    + `<span class="diagram-control-label">FOV</span><select data-bdp-hud="fov" style="${CONTROL_STYLE};width:auto" aria-label="Screen vertical field of view">${fov}</select>`
    + `<button class="capture-button view-toggle" type="button" data-bdp-hud="aoa" aria-pressed="${d.aoa}">AOA: ${d.aoa ? "On" : "Off"}</button>`
    + `<button class="capture-button view-toggle" type="button" data-bdp-hud="fpm-path" aria-pressed="${d.fpmPath}">FPM path: ${d.fpmPath ? "On" : "Off"}</button>`
    + `<span class="diagram-control-label">PAD LOCK :</span><button class="capture-button view-toggle" type="button" data-bdp-hud="padlock" data-hud-lock="TGT" aria-pressed="false" style="touch-action:none;user-select:none">TGT</button><button class="capture-button view-toggle" type="button" data-hud-lock="WM" aria-pressed="false" disabled style="touch-action:none;user-select:none">WM</button>`
    + `</div>${hudTimeMarkup}</div></details>`;
  return { threeD, hud };
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

// The Top View does not depend on the clock: a refresh with the same result and options keeps it as drawn (0.10.4).
const drawnTopViews = new WeakMap();

// Run one queued chart after a paint, not inside the animation-frame callback that precedes it.
function afterPaint(draw) {
  let timer = null;
  const frame = requestAnimationFrame(() => { timer = setTimeout(draw, 0); });
  return () => { cancelAnimationFrame(frame); if (timer !== null) clearTimeout(timer); };
}

// One shared queue across aircraft. Replacing a pending chart keeps its place, so rapid clock/input
// changes cannot starve the HUD. Each callback uses the newest request; hidden/removed hosts cancel.
export function createBdpRenderQueue(schedule = afterPaint) {
  const owners = new Map();
  let cancelFrame = null;
  function arm() {
    if (cancelFrame || !owners.size) return;
    cancelFrame = schedule(() => {
      cancelFrame = null;
      const [owner, charts] = owners.entries().next().value;
      const [name, draw] = charts.entries().next().value;
      charts.delete(name);
      owners.delete(owner);
      if (charts.size) owners.set(owner, charts);
      try { draw(); } finally { arm(); }
    });
  }
  return {
    enqueue(owner, name, draw) {
      if (!owners.has(owner)) owners.set(owner, new Map());
      owners.get(owner).set(name, draw);
      arm();
    },
    has: (owner) => owners.has(owner),
    cancel(owner) {
      owners.delete(owner);
      if (!owners.size && cancelFrame) { cancelFrame(); cancelFrame = null; }
    },
  };
}

// A cached render also keeps the DOM nodes (and the user's moved labels/zoom) intact. An emptied
// SVG is always rebuilt, including after an invalid result. Keys contain every presentation input.
export function createBdpViewCache() {
  const drawn = new WeakMap();
  return {
    draw(svg, result, key, render) {
      const previous = drawn.get(svg);
      if (previous?.result === result && previous.key === key && svg.childElementCount > 0) return previous.rendered;
      const rendered = render();
      drawn.set(svg, { result, key, rendered });
      return rendered;
    },
  };
}
const renderQueue = createBdpRenderQueue();
const viewCache = createBdpViewCache();

export function cancelBdpDiagramRender(container) {
  if (!container) return;
  renderQueue.cancel(container);
  flightStates.get(container)?.stopHud?.();
  container.dataset.bdpDiagramsState = "paused";
}

export function renderBdpDiagrams(container, bdpResult, { scope = "bdp", aircraftNumber, topView = {}, profileView = {}, flightView, layout, viewportWidth, progressive = false } = {}) {
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
    withLegend("top", renderBdpTopView(svg, bdpResult, { ...topView, ...orientationUp(), ...(advancedButton ? { advanced: advancedOn() } : {}), layout, viewportWidth, textScale, movableLabels: true, scope: `${scope}-top`, aircraftNumber })));
  const profileAdvancedButton = container.querySelector("[data-bdp-profile-advanced]");
  const profileDetail = () => (profileAdvancedButton ? { semDetail: profileAdvancedButton.getAttribute("aria-pressed") === "true" } : {});
  const profile = panelView(container, "profile", (svg, textScale) => {
    const options = { ...profileView, ...profileDetail(), layout, viewportWidth, textScale, movableLabels: true, scope: `${scope}-profile`, aircraftNumber };
    const draw = () => withLegend("profile", renderBdpProfileView(svg, bdpResult, options));
    // With Advanced off the Profile has no time overlay; clock ticks leave its static picture alone.
    const key = JSON.stringify({ ...options, timeAfterReleaseSec: options.semDetail === false ? null : options.timeAfterReleaseSec });
    return progressive ? viewCache.draw(svg, bdpResult, key, draw) : draw();
  });
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
  const topKey = JSON.stringify({ scope, aircraftNumber, topView, layout, viewportWidth });
  const drawTop = () => {
    const drawn = drawnTopViews.get(container);
    const topSvg = container.querySelector('[data-bdp-diagram="top"] svg:not([data-bdp-legend])');
    if (!(drawn?.result === bdpResult && drawn.key === topKey && topSvg?.childElementCount > 0)) {
      top.redraw();
      drawnTopViews.set(container, { result: bdpResult, key: topKey });
    }
  };
  if (progressive) {
    drawTop();
    profile.redraw();
    // Prepare the small path/state now so Play knows the current start/end even before 3D is drawn.
    const previousPath = flightStates.get(container)?.path ?? null;
    const hasFlight = prepareFlightViews(container, bdpResult, flightView, true);
    // A clock step (0.11.2): everything drawn, nothing queued, and the same result, Top View and flight path — only the
    // time moved. The 3D Profile (its time layers) and the HUD redraw at once, in step with the Profile, rather than
    // one per paint; the Top View stays as drawn.
    const drawnTop = drawnTopViews.get(container);
    if (hasFlight && container.dataset.bdpDiagramsState === "rendered" && !renderQueue.has(container)
      && flightStates.get(container).path === previousPath && drawnTop?.result === bdpResult && drawnTop.key === topKey) {
      draw3d(container, scope);
      drawHud(container, scope);
      return true;
    }
    container.dataset.bdpDiagramsState = "profile-ready";
    const later = (name, draw) => renderQueue.enqueue(container, name, () => {
      if (!container.isConnected) { cancelBdpDiagramRender(container); return; }
      try {
        draw();
        if (!renderQueue.has(container)) container.dataset.bdpDiagramsState = "rendered";
      } catch (error) { showFlightViewError(container, name, error); }
    });
    // Both 2D charts are ready before any deferred 3D/HUD work.
    if (hasFlight) later("3d", () => draw3d(container, scope));
    if (hasFlight) later("hud", () => drawHud(container, scope));
    return true;
  }
  renderQueue.cancel(container);
  drawTop();
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
    state = { hudContext: null, fleetChoice: "all", observer: "you", pair: null, lockTarget: null, lockOwner: null, path: null, timeSec: null, orbit: null, zoom3d: 1, aircraftScale: null, pan3d: { x: 0, y: 0 }, panHint: false, resetGesture: null, hudZoom: 1, progressDeg: 0, holding: false, frame: 0, lastFrame: null };
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

function showFlightViewError(container, kind, error) {
  const panel = container.querySelector(`[data-bdp-diagram="${kind}"]`);
  if (!panel) return;
  if (kind === 'hud') {
    const state = flightStates.get(container);
    if (state) { if (state.frame) cancelAnimationFrame(state.frame); Object.assign(state, { frame: 0, holding: false, progressDeg: 0, lockOwner: null, lastFrame: null }); }
    panel.querySelectorAll('[data-hud-lock]').forEach(b => b.setAttribute('aria-pressed', 'false'));
  }
  let note = panel.querySelector('[data-view-error]');
  if (!note) { note = document.createElement('p'); note.dataset.viewError = ''; note.setAttribute('role', 'status'); panel.append(note); }
  note.textContent = `${kind.toUpperCase()} view unavailable: ${error?.message ?? 'Render error'}`;
  panel.querySelector('svg')?.replaceChildren();
}
function draw3d(container, scope) {
  try { draw3dFrame(container, scope); container.querySelector('[data-bdp-diagram="3d"] [data-view-error]')?.remove(); }
  catch (error) { showFlightViewError(container, '3d', error); }
}
function draw3dFrame(container, scope) {
  const svg = container.querySelector('[data-bdp-diagram="3d"] svg.bdp-3d-svg');
  const state = flightState(container);
  if (!svg || !state.path) return;
  const context = state.hudContext, entries = context?.aircraft ?? [];
  const select = container.querySelector('[data-bdp-3d="fleet"]');
  if (state.fleetChoice !== "all" && !entries.some(a => String(a.number) === state.fleetChoice)) state.fleetChoice = "all";
  if (select) {
    const key = entries.map(a => a.number).join(',');
    if (select.dataset.options !== key) { select.innerHTML = '<option value="all">All</option>' + entries.map(a => `<option value="${a.number}">#${a.number}</option>`).join(''); select.dataset.options = key; }
    select.value = state.fleetChoice;
    container.querySelector('[data-bdp-fleet-label]').hidden = !entries.length;
  }
  const fleet = entries.filter(a => state.fleetChoice === "all" || String(a.number) === state.fleetChoice);
  const path = fleet.find(a => a.number === context.you)?.path ?? fleet[0]?.path ?? state.path;
  state.viewPath = path;
  const clock = fleet.length ? context.threeDClockSec ?? context.clockSec : state.timeSec;
  const note = container.querySelector('[data-bdp-fleet-status]');
  if (note) note.textContent = fleet.flatMap(a => [a.warning, !a.at(clock) ? `#${a.number}: ${a.unavailableReason}` : '']).filter(Boolean).join(' · ');
  // Heights are true (0.10.0: no altitude stretch, whatever an older state held).
  const options = { orbit: state.orbit ?? undefined, zoom: state.zoom3d, aircraftScale: state.aircraftScale, pan: state.pan3d, panHint: state.panHint, timeSec: clock, scope: `${scope}-3d`, ...(fleet.length ? { fleet } : {}) };
  const draw = () => renderBdp3dView(svg, path, options);
  const rendered = state.progressive && !fleet.length ? viewCache.draw(svg, path, JSON.stringify(options), draw) : draw();
  svg.dataset.aircraftSelection = state.fleetChoice;
  svg.dataset.timeSec = String(clock ?? '');
  svg.dataset.orbit = `${Math.round(rendered.orbit.azimuthDeg)}/${Math.round(rendered.orbit.elevationDeg)}`;
  svg.dataset.zoom = String(Math.round(rendered.zoom * 100));
  svg.dataset.pan = `${Math.round(rendered.pan.x)}/${Math.round(rendered.pan.y)}`;
  svg.dataset.aircraftScale = String(rendered.aircraftScale);
  const autoScale = container.querySelector('[data-bdp-3d="aircraft-scale"] option[value="auto"]');
  if (autoScale) autoScale.textContent = state.aircraftScale === null ? `Auto (${rendered.aircraftScale.toFixed(1)}×)` : "Auto";
  const output = container.querySelector('[data-bdp-3d="zoom-reset"]');
  if (output) output.textContent = `${Math.round(rendered.zoom * 100)}%`;
  showLegend(container, "3d", rendered.legend, rendered.legendColumns, rendered.legendNotes);
}

function hudFrame(container) {
  const state = flightState(container), context = state.hudContext;
  if (!context) return { path: state.path, timeSec: hudTime(state), otherAircraft: null, number: null };
  const entries = context.aircraft ?? [];
  const you = entries.find(a => a.number === context.you);
  const others = entries.filter(a => a.number !== context.you);
  if (!others.some(a => a.number === state.pair)) {
    const pair = others.find(a => a.number === (context.you % 2 ? context.you + 1 : context.you - 1))?.number ?? others[0]?.number ?? null;
    if (pair !== state.pair) { state.pair = pair; state.holding = false; state.progressDeg = 0; state.lockOwner = null; }
  }
  if (!others.length) state.observer = "you";
  const wm = others.find(a => a.number === state.pair);
  const observer = state.observer === "wingman" ? wm : you;
  const other = state.observer === "wingman" ? you : wm;
  const time = Number.isFinite(context.clockSec) ? context.clockSec : context.defaultTimeSec ?? 0;
  const pose = observer?.at(time), otherPose = other?.at(time);
  const tab = name => container.querySelector(`[data-hud-observer="${name}"]`);
  if (tab("you")) tab("you").textContent = `You #${context.you}`;
  if (tab("wingman")) { tab("wingman").textContent = wm ? `Wingman #${wm.number}` : "Wingman"; tab("wingman").disabled = !wm; }
  const select = container.querySelector('[data-hud-pair]');
  if (select) {
    const key = others.map(a => a.number).join(',');
    if (select.dataset.options !== key) { select.innerHTML = others.map(a => `<option value="${a.number}">#${a.number}</option>`).join(''); select.dataset.options = key; }
    select.value = String(state.pair);
    container.querySelector('[data-hud-pair-label]').hidden = others.length < 2;
  }
  const note = container.querySelector('[data-hud-availability]');
  if (note) note.textContent = [observer?.warning, other?.warning, !pose ? observer?.unavailableReason ?? 'No current flight path' : !wm ? 'No available wingman' : !otherPose ? `Wingman: ${other?.unavailableReason ?? 'Outside flight window'}` : ''].filter(Boolean).join(' · ');
  return { path: observer?.path, state: pose, unavailable: !pose, number: observer?.number, timeSec: time,
    gridStepFt: context.gridStepFt, otherAircraft: otherPose ? { number: other.number, state: otherPose } : null };
}
function drawHud(container, scope) {
  try { drawHudFrame(container, scope); container.querySelector('[data-bdp-diagram="hud"] [data-view-error]')?.remove(); }
  catch (error) { showFlightViewError(container, 'hud', error); }
}
function drawHudFrame(container, scope) {
  const svg = container.querySelector('[data-bdp-diagram="hud"] svg.bdp-hud-svg');
  const state = flightState(container);
  if (!svg || !svg.getClientRects().length) return;
  const frame = hudFrame(container);
  container.querySelectorAll('[data-hud-observer]').forEach(b => { b.setAttribute('aria-selected', String(b.dataset.hudObserver === state.observer)); b.setAttribute('aria-pressed', String(b.dataset.hudObserver === state.observer)); });
  const wmButton = container.querySelector('[data-hud-lock="WM"]');
  const separation = frame.otherAircraft && frame.state ? Math.hypot(frame.otherAircraft.state.x-frame.state.x, frame.otherAircraft.state.y-frame.state.y, frame.otherAircraft.state.z-frame.state.z) : 0;
  if (wmButton) wmButton.disabled = !frame.path || frame.unavailable || separation < 1e-6;
  const tgtButton = container.querySelector('[data-hud-lock="TGT"]');
  if (tgtButton) tgtButton.disabled = !frame.path || frame.unavailable;
  if (frame.unavailable || !frame.path || (state.lockTarget === 'WM' && wmButton?.disabled)) { state.holding = false; state.progressDeg = 0; state.lockOwner = null; }
  container.querySelectorAll('[data-hud-lock]').forEach(b => b.setAttribute('aria-pressed', String(state.holding && b.dataset.hudLock === state.lockTarget)));
  if (!frame.path || frame.unavailable) { svg.replaceChildren(); svg.dataset.available = 'false'; return; }
  svg.dataset.available = 'true';
  svg.dataset.observer = String(frame.number ?? 'you');
  const options = { ...hudOptions(container), ...frame, gazeProgressDeg: state.holding ? state.progressDeg : 0, scope: `${scope}-hud`, padlockTarget: state.lockTarget,
    lookAt: state.lockTarget === 'WM' ? frame.otherAircraft?.state : undefined };
  const key = JSON.stringify({ ...hudOptions(container), state: frame.state, timeSec: frame.timeSec, gridStepFt: frame.gridStepFt,
    otherAircraft: frame.otherAircraft, gazeProgressDeg: options.gazeProgressDeg, padlockTarget: state.lockTarget });
  const rendered = viewCache.draw(svg, frame.path, key, () => renderBdpHudView(svg, frame.path, options));
  state.progressDeg = rendered.progressDeg;
  svg.dataset.fovDeg = rendered.fovDeg.toFixed(2);
  svg.dataset.zoom = String(Math.round((state.hudZoom || 1) * 100));
  const output = container.querySelector('[data-bdp-hud="zoom-reset"]');
  if (output) output.textContent = `${Math.round((state.hudZoom || 1) * 100)}%`;
  svg.dataset.padlockDeg = rendered.progressDeg.toFixed(1);
  svg.dataset.padlockTotalDeg = rendered.totalDeg.toFixed(1);
  svg.dataset.padlockLocked = String(rendered.locked);
  svg.dataset.timeSec = String(frame.timeSec);
}

// The HUD's time: the clock's, else its start, Roll-in −3 s (owner handoff §3.1).
const hudTime = (state) => (Number.isFinite(state.timeSec) ? state.timeSec : BDP_FLIGHT_PATH_V0_1.hudStartSec);

// While held, gaze approaches the selected target at 60°/s. Release immediately restores forward view.
// One animation frame loop per container runs only while held.
function padlockFrame(container, scope, now) {
  const state = flightState(container);
  if (!state.holding || !container.isConnected || !container.querySelector("svg.bdp-hud-svg")?.getClientRects().length) { state.holding = false; state.progressDeg = 0; state.lockOwner = null; state.frame = 0; container.querySelectorAll('[data-hud-lock]').forEach(b => b.setAttribute('aria-pressed', 'false')); return; }
  const dt = state.lastFrame === null ? 0 : Math.min(.1, (now - state.lastFrame) / 1000);
  state.lastFrame = now;
  state.progressDeg += 60 * dt;
  drawHud(container, scope);
  state.frame = state.holding ? requestAnimationFrame(time => padlockFrame(container, scope, time)) : 0;
}

function installFlightControls(container, scope) {
  if (container.dataset.bdpFlightReady) return;
  container.dataset.bdpFlightReady = "true";
  const state = flightState(container);
  container.querySelector('[data-bdp-3d="fleet"]')?.addEventListener('change', event => { state.fleetChoice = event.target.value; draw3d(container, scope); });
  const svg3d = container.querySelector('[data-bdp-diagram="3d"] svg.bdp-3d-svg');
  // 3D gestures (0.10.0, owner addendum 2026-10-18 §4–§6; bdp3dGestureStep): drag turns about the fixed scene centre;
  // a 0.5 s hold within 8 CSS px, then drag, pans ("PAN" shows); two pointers only zoom about their starting midpoint;
  // Shift-drag or the middle button pans at once; the wheel zooms about the cursor. View state only: no solve, no
  // Save; drawing is coalesced to one per animation frame.
  let gesture = bdp3dGestureInit();
  let holdTimer = 0;
  let frame = 0;
  const request3d = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; draw3d(container, scope); });
  };
  const viewNow = () => ({ orbit: state.orbit ?? bdp3dDefaultOrbit(state.viewPath ?? state.path), zoom: state.zoom3d, pan: state.pan3d });
  const step = (event) => {
    if (!state.path) return;
    const before = viewNow();
    const out = bdp3dGestureStep(gesture, event, before);
    gesture = out.gesture;
    const moved = out.view.orbit !== before.orbit || out.view.zoom !== before.zoom || out.view.pan !== before.pan;
    if (out.view.orbit !== before.orbit) state.orbit = out.view.orbit;
    state.zoom3d = out.view.zoom;
    state.pan3d = out.view.pan;
    if (out.armTimer) {
      clearTimeout(holdTimer);
      const seq = gesture.seq;
      holdTimer = setTimeout(() => step({ type: "timer", seq, t: performance.now() }), BDP_3D_VIEW_V0_1.gesture.holdMs);
    }
    if (gesture.mode === "idle" || gesture.mode === "pinch") clearTimeout(holdTimer);
    const hint = out.panHint;
    if (hint !== state.panHint || moved) {
      state.panHint = hint;
      request3d();
    }
    svg3d.style.cursor = gesture.mode === "idle" ? "grab" : hint ? "move" : "grabbing";
  };
  const resetGesture = () => {
    clearTimeout(holdTimer);
    gesture = bdp3dGestureStep(gesture, { type: "reset" }, viewNow()).gesture;
    if (state.panHint) { state.panHint = false; request3d(); }
    if (svg3d) svg3d.style.cursor = "grab";
  };
  state.resetGesture = resetGesture;
  const at = (event) => {
    const box = svg3d.getBoundingClientRect();
    const k = BDP_3D_VIEW_V0_1.canvas.width / Math.max(1, box.width);
    return { id: event.pointerId, x: event.clientX, y: event.clientY, cx: (event.clientX - box.left) * k, cy: (event.clientY - box.top) * k, t: event.timeStamp || performance.now() };
  };
  svg3d?.addEventListener("pointerdown", (event) => {
    if (!state.path) return;
    try { svg3d.setPointerCapture(event.pointerId); } catch { /* synthetic or ended pointer */ }
    event.preventDefault();
    step({ type: "down", ...at(event), t: performance.now(), button: event.button, shiftKey: event.shiftKey });
  });
  svg3d?.addEventListener("pointermove", (event) => step({ type: "move", ...at(event) }));
  svg3d?.addEventListener("pointerup", (event) => step({ type: "up", id: event.pointerId }));
  ["pointercancel", "lostpointercapture"].forEach((name) => svg3d?.addEventListener(name, (event) => step({ type: "cancel", id: event.pointerId })));
  svg3d?.addEventListener("contextmenu", (event) => event.preventDefault());
  // A collapsed panel leaves no gesture or timer behind.
  container.querySelector('[data-bdp-diagram="3d"]')?.addEventListener("toggle", (event) => { if (!event.currentTarget.open) resetGesture(); });
  svg3d?.addEventListener("wheel", (event) => {
    if (!state.path) return;
    event.preventDefault();
    const p = at(event);
    const zoomed = zoomAbout({ zoom: state.zoom3d, pan: state.pan3d }, Math.exp(-event.deltaY * 0.0015), p.cx, p.cy);
    state.zoom3d = zoomed.zoom;
    state.pan3d = zoomed.pan;
    request3d();
  }, { passive: false });
  // Title tools sit in <summary>: keep the panel open on their clicks.
  const tool = (selector, action) => container.querySelector(selector)?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    action(event.currentTarget);
  });
  const { width: W3, height: H3 } = BDP_3D_VIEW_V0_1.canvas;
  container.querySelector('[data-bdp-3d="aircraft-scale"]')?.addEventListener("change", (event) => {
    const value = Number(event.currentTarget.value);
    state.aircraftScale = BDP_3D_VIEW_V0_1.aircraftScaleOptions.includes(value) ? value : null;
    draw3d(container, scope);
  });
  const zoom3dBy = (step) => {
    const zoomed = zoomAbout({ zoom: state.zoom3d, pan: state.pan3d }, (state.zoom3d + step) / state.zoom3d, W3 / 2, H3 / 2);
    state.zoom3d = zoomed.zoom;
    state.pan3d = zoomed.pan;
    draw3d(container, scope);
  };
  tool('[data-bdp-3d="reset"]', () => {
    resetGesture();
    state.orbit = null;
    state.zoom3d = 1;
    state.pan3d = { x: 0, y: 0 };
    draw3d(container, scope);
  });
  tool('[data-bdp-3d="zoom-in"]', () => zoom3dBy(ZOOM_STEP));
  tool('[data-bdp-3d="zoom-out"]', () => zoom3dBy(-ZOOM_STEP));
  tool('[data-bdp-3d="zoom-reset"]', () => { state.zoom3d = 1; state.pan3d = { x: 0, y: 0 }; draw3d(container, scope); });
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
  const stop = () => {
    state.holding = false; state.progressDeg = 0; state.lockOwner = null; state.lastFrame = null;
    if (state.frame) cancelAnimationFrame(state.frame);
    state.frame = 0;
    drawHud(container, scope);
  };
  state.stopHud = stop;
  for (const button of container.querySelectorAll('[data-hud-lock]')) {
    const begin = owner => {
      if (button.disabled) return;
      stop(); state.lockTarget = button.dataset.hudLock; state.lockOwner = owner; state.holding = true;
      drawHud(container, scope);
      state.frame = requestAnimationFrame(time => padlockFrame(container, scope, time));
    };
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      try { button.setPointerCapture(event.pointerId); } catch {}
      begin(`p:${event.pointerId}`);
    });
    for (const name of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(name, event => { if (state.lockOwner === `p:${event.pointerId}`) stop(); });
    button.addEventListener('keydown', event => { if ([' ','Enter'].includes(event.key)) { event.preventDefault(); if (!event.repeat) begin(`k:${button.dataset.hudLock}:${event.key}`); } });
    button.addEventListener('keyup', event => { if (state.lockOwner === `k:${button.dataset.hudLock}:${event.key}`) { event.preventDefault(); stop(); } });
    button.addEventListener('blur', () => { if (state.lockOwner?.startsWith('k:')) stop(); });
    button.addEventListener('contextmenu', event => event.preventDefault());
  }
  container.querySelectorAll('[data-hud-observer]').forEach(button => button.addEventListener('click', () => { stop(); state.observer = button.dataset.hudObserver; drawHud(container, scope); }));
  container.querySelector('[data-hud-pair]')?.addEventListener('change', event => { const number = Number(event.target.value); stop(); state.pair = number; drawHud(container, scope); });
  container.querySelector('[data-bdp-diagram="hud"]')?.addEventListener('toggle', event => { if (!event.currentTarget.open) stop(); });
  window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  container.addEventListener('toggle', event => { if (event.target instanceof HTMLDetailsElement && !event.target.open) stop(); }, true);

}

function prepareFlightViews(container, bdpResult, flightView, progressive = false) {
  const panels = container.querySelector('[data-bdp-diagram="3d"], [data-bdp-diagram="hud"]');
  if (!panels) return false;
  const scope = container.dataset.bdpScope || "bdp";
  const state = flightState(container);
  const pathOptions = { rollDirection: flightView?.rollDirection, approach: flightView?.approach ?? null, startSec: flightView?.startSec };
  const pathKey = JSON.stringify(pathOptions);
  try {
    if (!progressive || !state.path || state.result !== bdpResult || state.pathKey !== pathKey) {
      state.path = buildBdpFlightPath(bdpResult, pathOptions);
      state.result = bdpResult;
      state.pathKey = pathKey;
    }
  } catch {
    clearFlightViews(container);
    return false;
  }
  const nextContext = flightView?.hudContext ?? null;
  if (state.hudContext?.you !== nextContext?.you || state.hudContext?.aircraft?.some((a,i) => a.path !== nextContext?.aircraft?.[i]?.path)) state.stopHud?.();
  state.hudContext = nextContext;
  state.progressive = progressive;
  state.timeSec = Number.isFinite(flightView?.timeSec) ? flightView.timeSec : null;
  installFlightControls(container, scope);
  return true;
}

function renderFlightViews(container, bdpResult, flightView) {
  if (!prepareFlightViews(container, bdpResult, flightView)) return;
  const scope = container.dataset.bdpScope || "bdp";
  draw3d(container, scope);
  drawHud(container, scope);
}

// The 3D Profile / HUD window of the path last drawn in this container (seconds from the Roll-in Point), or null.
export function bdpFlightViewWindow(container) {
  const path = container ? flightStates.get(container)?.path : null;
  return path ? { startSec: path.startT, endSec: path.endT } : null;
}

function clearFlightViews(container) {
  const state = flightStates.get(container);
  if (state) {
    state.hudContext = null;
    if (state.frame) cancelAnimationFrame(state.frame);
    Object.assign(state, { path: null, frame: 0, lastFrame: null, holding: false, progressDeg: 0 });
  }
  container.querySelector('[data-bdp-hud="padlock"]')?.setAttribute("aria-pressed", "false");
  container.querySelectorAll('[data-bdp-diagram="3d"] svg.bdp-3d-svg, [data-bdp-diagram="hud"] svg.bdp-hud-svg').forEach((svg) => svg.replaceChildren());
}

export function clearBdpDiagrams(container) {
  if (container) renderQueue.cancel(container);
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
