import { scopeSvgMarkerIds } from "../../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.4";
import { renderBdpProfileView } from "./bdp-profile-view-v0.1.mjs";
import { renderBdpTopView } from "./bdp-top-view-v0.1.mjs";

// Full BDP diagrams panel — BDP-owned presentation reused by every BE that embeds a BDP input tab
// (Offset now; BOX, Wheel and Wheel-BOX next). While the consumer's Full BDP is on, the tab shows
// the BDP Top View and the BDP Profile of the profile it solved, each in its own collapsible panel
// (open by default). While Full BDP is off, neither panel nor its title is shown.
//
// Contract with the consumer:
// - place bdpDiagramsMarkup() inside the element that receives the class "show-full-bdp" when
//   Full BDP is on (the app-common CSS shows .bdp-diagrams only there);
// - call renderBdpDiagrams(container, bdpResult, { scope }) after each solve with the BDP v0.3
//   result the BE used (for Offset, result.profile), or clearBdpDiagrams(container) without one.
// Several panels may share one page, so marker ids are scoped per panel (Common scopeSvgMarkerIds).

export const BDP_DIAGRAMS_PANEL_V0_1 = Object.freeze({
  id: "bdp-diagrams-panel-v0.1",
  version: "0.1.0",
  views: Object.freeze(["bdp-top-view-v0.1", "bdp-profile-view-v0.1"]),
});

const VIEW_BOX = "0 0 900 700";

// Element skeleton bdp-profile-view-v0.1 draws into (same as the standalone BDP app).
const PROFILE_SKELETON = `<defs></defs><rect x="0" y="0" width="900" height="700" fill="#fff"></rect><g id="p-grid"></g>`
  + `<line id="p-flight" stroke="#176dac" stroke-width="3"></line>`
  + `<path id="p-roll" fill="none" stroke="#176dac" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>`
  + `<line id="p-los" stroke="#a35d00" stroke-width="2.4" stroke-dasharray="8 6"></line>`
  + `<path id="p-bomb" fill="none" stroke="#087b4c" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>`
  + `<line id="p-rollin-distance"></line><line id="p-ground-range"></line><line id="p-rollin-range"></line><line id="p-aod"></line>`
  + `<circle id="p-initial-point" r="6"></circle><circle id="p-rollout-point" r="6"></circle><circle id="p-release-point" r="6"></circle>`
  + `<circle id="p-target-point" r="7"></circle><circle id="p-fpm-point" r="5"></circle><g id="p-labels"></g>`;
const TOP_SKELETON = `<rect x="0" y="0" width="900" height="700" fill="#fff"></rect><g id="top-view-root"></g>`;

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

// `titleSuffix` names the aircraft or pattern, e.g. " #2".
export function bdpDiagramsMarkup({ titleSuffix = "" } = {}) {
  const suffix = escapeText(titleSuffix);
  const panel = (kind, title, skeleton) => `<details class="input-panel bdp-diagram" open data-bdp-diagram="${kind}">`
    + `<summary>${title}${suffix}</summary><div class="bdp-diagram-canvas">`
    + `<svg viewBox="${VIEW_BOX}" role="img" aria-label="${title}${suffix}">${skeleton}</svg></div></details>`;
  return `<div class="bdp-diagrams" data-bdp-diagrams>`
    + panel("top", "BDP Top View", TOP_SKELETON)
    + panel("profile", "BDP Profile", PROFILE_SKELETON)
    + `</div>`;
}

export function renderBdpDiagrams(container, bdpResult, { scope = "bdp" } = {}) {
  const top = container?.querySelector('[data-bdp-diagram="top"] svg');
  const profile = container?.querySelector('[data-bdp-diagram="profile"] svg');
  if (!top || !profile) return false;
  renderBdpTopView(top, bdpResult);
  renderBdpProfileView(profile, bdpResult);
  scopeSvgMarkerIds(top, `${scope}-top`);
  scopeSvgMarkerIds(profile, `${scope}-profile`);
  container.dataset.bdpDiagramsState = "rendered";
  return true;
}

export function clearBdpDiagrams(container) {
  const top = container?.querySelector('[data-bdp-diagram="top"] svg #top-view-root');
  top?.replaceChildren();
  const labels = container?.querySelector('[data-bdp-diagram="profile"] svg #p-labels');
  labels?.replaceChildren();
  if (container) container.dataset.bdpDiagramsState = "empty";
}
