import { buildBdpZDiagramData } from "../../bomb-delivery-planner/view/bdp-z-diagram-v0.1.mjs";
import { renderCommonZDiagram } from "../../../../common/diagram/z-diagram/z-diagram-v0.1.mjs?v=0.1.14";
import { svgNode } from "../../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { formatDeg, formatG, formatKt, formatNm, formatSec } from "../../../../common/ui/display-precision-v0.1.mjs";
import { boxAbeamText } from "../../box-pattern/view/box-z-diagram-v0.3.mjs";
import { wheelZDiagramTitle } from "./wheel-view-style-v0.1.mjs";
import { formatWheelRadiusNm } from "../../wheel-attack/wheel-box-geometry-v0.6.mjs";

// Wheel-BOX #n Z-Diagram for the Wheel-BOX v0.8 / v0.9 result (2026-10-25): the BDP Z of the Wheel's own BDP v0.4 solve
// (Angle-Off 90°) in the Common Z grammar, as BOX's (box-z-diagram-v0.3): the Roll-in group ends with `Abeam +Nsec`,
// the time flown past the Wheel's Abeam before the Base Turn, and the rows give the Wheel and the Base Turn.
// 0.1.1 (Wheel-BOX v0.9): a Base Turn G the BE raised to fit Base Distance reads `requested → flown G`.
// 0.1.2 (Wheel-BOX v0.10): a Return row (time, distance, recovery) when the Return is solved; the Roll-in group ends
// with OA2 (the Base Turn start, the Abeam Extension's visual reference) under `Abeam +Nsec`, `OA2 Range NM/angle °` as
// the Top View's.
export const WHEEL_BOX_Z_DIAGRAM_V0_1 = Object.freeze({
  id: "wheel-box-z-diagram-v0.1",
  version: "0.1.2",
  owner: "AG/bombing/wheel-attack/SPEC.md",
  subject: "Wheel-BOX",
  view: "Z-Diagram",
  commonRenderer: "common-z-diagram-v0.1",
});

export { wheelZDiagramTitle };
// `Abeam +Nsec` (BOX's text): the time flown past the Wheel's Abeam before the Base Turn.
export { boxAbeamText as wheelAbeamText };

export function buildWheelBoxZDiagramRowsV0_1(result) {
  const wheel = result.wheel;
  const base = result.turns.base;
  return [
    { label: "Wheel Radius / Speed / Bank", value: `${formatWheelRadiusNm(wheel.radiusNm)} NM / ${formatKt(wheel.wheelSpeedKcas)} KCAS / ${formatDeg(wheel.wheelBankAngleDeg)}°` },
    { label: "Wheel 180° Time", value: `${formatSec(wheel.wheelTurn180TimeSec)} sec` },
    { label: "Base Turn Speed / G / Bank", value: `${formatKt(result.pattern.patternSpeedKcas)} KCAS / ${base.autoRaised ? `${formatG(base.requestedLoadFactorG)} → ` : ""}${formatG(base.loadFactorG)} G / ${formatDeg(base.bankAngleDeg)}°` },
    ...(result.return?.status === "VALID" ? [{ label: "Return (CSEM End → Abeam)", value: `${formatSec(result.return.timeSec)} sec / ${formatNm(result.return.distanceNm)} NM · Roll-in Altitude at ${formatSec(result.return.recovery.timeSec)} sec` }] : []),
  ];
}

export function renderWheelBoxZDiagramV0_1(svg, result, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  if (!result?.bombDelivery || !result?.wheel || !result?.turns?.base) throw new TypeError("result must be a Wheel-BOX v0.8 – v0.10 result");
  const title = wheelZDiagramTitle({ aircraftNumber: options.aircraftNumber });
  svg.setAttribute("aria-label", title);
  const data = buildBdpZDiagramData(result.bombDelivery);
  svg.replaceChildren();
  if (!data.supported) {
    svg.setAttribute("viewBox", "0 0 650 220");
    svg.style.aspectRatio = "650 / 220";
    svg.append(svgNode("rect", { x: 0, y: 0, width: 650, height: 220, fill: "#ffffff" }));
    const message = data.reason === "LEVEL_NO_Z_DIAGRAM" ? "LEVEL profile · Z-Diagram not applicable" : "Dive angle below 10° · Z-Diagram unavailable";
    for (const [y, text, size] of [[82, `${data.profileTitle} · Wheel-BOX`, 24], [132, message, 16]]) {
      svg.append(svgNode("text", { x: 325, y, "text-anchor": "middle", "font-size": size, "font-weight": 850, fill: "#14202c" }, text));
    }
    return { title, rendered: false, data };
  }
  const abeam = boxAbeamText(result.pattern.abeamExtensionTimeSec);
  const values = result.geometry?.values ?? {};
  const oa2 = Number.isFinite(values.oa2RangeNm) && Number.isFinite(values.oa2AngleDeg) ? `OA2 ${formatNm(values.oa2RangeNm)}NM/${formatDeg(values.oa2AngleDeg)}°` : null;
  const root = svg.appendChild(svgNode("g", { "data-z-root": "", "data-view": WHEEL_BOX_Z_DIAGRAM_V0_1.id }));
  renderCommonZDiagram(svg, {
    ...data,
    beTitle: "Wheel-BOX",
    uniformBodyText: true,
    compactAngleLabels: true,
    extraRows: buildWheelBoxZDiagramRowsV0_1(result),
    rollInGroupTail: [
      ...(abeam ? [{ text: abeam, ariaLabel: `Abeam: ${abeam.slice(6)}` }] : []),
      ...(oa2 ? [{ text: oa2, ariaLabel: `OA2, the Base Turn start: ${oa2.slice(4)}` }] : []),
    ],
  });
  const box = svg.viewBox.baseVal;
  root.prepend(svgNode("rect", { x: 0, y: 0, width: box.width, height: box.height, fill: "#ffffff" }));
  return { title, rendered: true, data, abeam, oa2 };
}
