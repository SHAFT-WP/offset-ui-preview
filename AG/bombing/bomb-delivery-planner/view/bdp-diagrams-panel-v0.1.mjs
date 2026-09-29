import { BDP_PROFILE_VIEW_V0_2, bdpProfileTitle, renderBdpProfileView } from "./bdp-profile-view-v0.2.mjs";
import { BDP_TOP_VIEW_V0_2, bdpTopViewTitle, renderBdpTopView } from "./bdp-top-view-v0.2.mjs?v=0.2.1";

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

export const BDP_DIAGRAMS_PANEL_V0_1 = Object.freeze({
  id: "bdp-diagrams-panel-v0.1",
  version: "0.3.0",
  views: Object.freeze([BDP_TOP_VIEW_V0_2.id, BDP_PROFILE_VIEW_V0_2.id]),
});

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

export function bdpDiagramsMarkup({ aircraftNumber } = {}) {
  const panel = (kind, title) => `<details class="input-panel bdp-diagram" open data-bdp-diagram="${kind}">`
    + `<summary>${escapeText(title)}</summary><div class="bdp-diagram-canvas">`
    + `<svg viewBox="0 0 900 700" role="img" aria-label="${escapeText(title)}"></svg></div></details>`;
  return `<div class="bdp-diagrams" data-bdp-diagrams>`
    + panel("top", bdpTopViewTitle({ aircraftNumber }))
    + panel("profile", bdpProfileTitle({ aircraftNumber }))
    + `</div>`;
}

export function renderBdpDiagrams(container, bdpResult, { scope = "bdp", aircraftNumber, topView = {} } = {}) {
  const top = container?.querySelector('[data-bdp-diagram="top"] svg');
  const profile = container?.querySelector('[data-bdp-diagram="profile"] svg');
  if (!top || !profile) return false;
  renderBdpTopView(top, bdpResult, { ...topView, scope: `${scope}-top`, aircraftNumber });
  renderBdpProfileView(profile, bdpResult, { scope: `${scope}-profile`, aircraftNumber });
  container.dataset.bdpDiagramsState = "rendered";
  return true;
}

export function clearBdpDiagrams(container) {
  container?.querySelectorAll("[data-bdp-diagram] svg").forEach((svg) => svg.replaceChildren());
  if (container) container.dataset.bdpDiagramsState = "empty";
}
