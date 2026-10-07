import { BDP_PROFILE_VIEW_V0_2, bdpProfileTitle, renderBdpProfileView } from "./bdp-profile-view-v0.2.mjs?v=0.2.2";
import { BDP_TOP_VIEW_V0_2, bdpTopViewTitle, renderBdpTopView } from "./bdp-top-view-v0.2.mjs?v=0.2.7";
import { installSvgViewControls, svgViewControlsMarkup } from "../../../../common/diagram/svg-view-controls-v0.1.mjs?v=0.1.0";
import { installSvgLegend } from "../../../../common/diagram/svg-legend-v0.1.mjs";

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
  version: "0.5.1",
  views: Object.freeze([BDP_TOP_VIEW_V0_2.id, BDP_PROFILE_VIEW_V0_2.id]),
});

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

export function bdpDiagramsMarkup({ aircraftNumber, topTitle } = {}) {
  const panel = (kind, title) => `<details class="input-panel bdp-diagram" open data-bdp-diagram="${kind}">`
    + `<summary>${escapeText(title)}</summary><div class="diagram-actions">${svgViewControlsMarkup({ title })}</div><div class="bdp-diagram-canvas">`
    + `<svg viewBox="0 0 900 700" role="img" aria-label="${escapeText(title)}"></svg>`
    + `<svg class="diagram-legend-box" data-bdp-legend="${kind}" role="img" aria-label="${escapeText(title)} legend" hidden></svg></div></details>`;
  return `<div class="bdp-diagrams" data-bdp-diagrams>`
    + panel("top", topTitle || bdpTopViewTitle({ aircraftNumber }))
    + panel("profile", bdpProfileTitle({ aircraftNumber }))
    + `</div>`;
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
function showLegend(container, kind, items) {
  const box = container.querySelector(`[data-bdp-legend="${kind}"]`);
  if (!box) return;
  panelLegends.get(box)?.destroy();
  panelLegends.delete(box);
  box.toggleAttribute("hidden", !items?.length);
  if (items?.length) panelLegends.set(box, installSvgLegend(box, items));
}

export function renderBdpDiagrams(container, bdpResult, { scope = "bdp", aircraftNumber, topView = {}, layout } = {}) {
  if (!container) return false;
  const withLegend = (kind, rendered) => { showLegend(container, kind, rendered?.legend); return rendered; };
  const top = panelView(container, "top", (svg, textScale) =>
    withLegend("top", renderBdpTopView(svg, bdpResult, { ...topView, layout, textScale, movableLabels: true, scope: `${scope}-top`, aircraftNumber })));
  const profile = panelView(container, "profile", (svg, textScale) =>
    withLegend("profile", renderBdpProfileView(svg, bdpResult, { layout, textScale, movableLabels: true, scope: `${scope}-profile`, aircraftNumber })));
  if (!top || !profile) return false;
  top.redraw();
  profile.redraw();
  container.dataset.bdpDiagramsState = "rendered";
  return true;
}

export function clearBdpDiagrams(container) {
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
