import { buildBdpZDiagramData } from "../../bomb-delivery-planner/view/bdp-z-diagram-v0.1.mjs";
import { renderCommonZDiagram } from "../../../../common/diagram/z-diagram/z-diagram-v0.1.mjs?v=0.1.14";
import { svgNode } from "../../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { formatDeg, formatG, formatKt, formatSec } from "../../../../common/ui/display-precision-v0.1.mjs";
import { boxZDiagramTitle } from "./box-view-style-v0.1.mjs";

// BOX #n Z-Diagram for the BOX v0.3 result (2026-10-25): the BDP Z of the BOX's own BDP v0.4 solve (Angle-Off 90°)
// in the Common Z grammar, with the BOX rows. Owner (2026-10-23, BOX handoff §7): the Abeam time is the last line of
// the upper-right Roll-in group as `Abeam +3sec` — the time flown on past the Target abeam before the Base Turn, given
// by the BOX BE. The `+` is always written (a valid 0 reads `Abeam +0sec`); a negative time (an invalid route) keeps
// its sign; no value hides the line. The lower Abeam Extension Time row of v0.2 is not repeated.
// box-z-diagram-v0.2 stays for the BOX v0.2 consumers.

export const BOX_Z_DIAGRAM_V0_3 = Object.freeze({
  id: "box-z-diagram-v0.3",
  version: "0.3.0",
  owner: "AG/bombing/box-pattern/SPEC.md",
  subject: "BOX",
  view: "Z-Diagram",
  commonRenderer: "common-z-diagram-v0.1",
});

export { boxZDiagramTitle };

// `Abeam +3sec` from the BE's seconds; null (no line) without a finite value.
export function boxAbeamText(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  const shown = Math.abs(Number(formatSec(seconds)));
  // A time below zero (beyond 1 ms, the BE's 0.5 m route tolerance) keeps its sign even when it shows as 0.
  return seconds >= -1e-3 ? `Abeam +${shown}sec` : `Abeam -${shown}sec`;
}

// The BOX rows under the Common Z body: the Base and Crosswind Turns (pattern speed, held G and bank).
export function buildBoxZDiagramRowsV0_3(boxResult) {
  const kcas = boxResult.pattern.patternSpeedKcas;
  const turn = (t) => `${formatKt(kcas)} KCAS / ${formatG(t.loadFactorG)} G / ${formatDeg(t.bankAngleDeg)}°`;
  return [
    { label: "Base Turn Speed / G / Bank", value: turn(boxResult.turns.base) },
    { label: "Crosswind Turn Speed / G / Bank", value: turn(boxResult.turns.cross) },
  ];
}

export function renderBoxZDiagramV0_3(svg, boxResult, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  if (!boxResult?.bombDelivery || !boxResult?.pattern || !boxResult?.turns) throw new TypeError("boxResult must be a BOX v0.3 pattern result");
  const title = boxZDiagramTitle({ aircraftNumber: options.aircraftNumber });
  svg.setAttribute("aria-label", title);
  const data = buildBdpZDiagramData(boxResult.bombDelivery);
  svg.replaceChildren();
  if (!data.supported) {
    svg.setAttribute("viewBox", "0 0 650 220");
    svg.style.aspectRatio = "650 / 220";
    svg.append(svgNode("rect", { x: 0, y: 0, width: 650, height: 220, fill: "#ffffff" }));
    const message = data.reason === "LEVEL_NO_Z_DIAGRAM" ? "LEVEL profile · Z-Diagram not applicable" : "Dive angle below 10° · Z-Diagram unavailable";
    for (const [y, text, size] of [[82, `${data.profileTitle} · BOX`, 24], [132, message, 16]]) {
      svg.append(svgNode("text", { x: 325, y, "text-anchor": "middle", "font-size": size, "font-weight": 850, fill: "#14202c" }, text));
    }
    return { title, rendered: false, data };
  }
  const abeam = boxAbeamText(boxResult.pattern.abeamExtensionTimeSec);
  const root = svg.appendChild(svgNode("g", { "data-z-root": "", "data-view": BOX_Z_DIAGRAM_V0_3.id }));
  renderCommonZDiagram(svg, {
    ...data,
    beTitle: "BOX",
    uniformBodyText: true,
    compactAngleLabels: true,
    extraRows: buildBoxZDiagramRowsV0_3(boxResult),
    rollInGroupTail: abeam ? [{ text: abeam, ariaLabel: `Abeam: ${abeam.slice(6)}` }] : [],
  });
  const box = svg.viewBox.baseVal;
  root.prepend(svgNode("rect", { x: 0, y: 0, width: box.width, height: box.height, fill: "#ffffff" }));
  return { title, rendered: true, data, abeam };
}
