import { buildBdpZDiagramData } from "../../bomb-delivery-planner/view/bdp-z-diagram-v0.1.mjs";
import { renderCommonZDiagram } from "../../../../common/diagram/z-diagram/z-diagram-v0.1.mjs?v=0.1.14";
import { svgNode } from "../../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { formatDeg, formatG, formatKt, formatNm, formatSec } from "../../../../common/ui/display-precision-v0.1.mjs";
import { wheelAttackZDiagramTitle } from "./wheel-attack-view-style-v0.1.mjs";

// Wheel #n Z-Diagram for the Wheel Attack v0.1 result (Wheel SPEC §20): the BDP Z of the Wheel's own BDP v0.4 solve (at
// the tangent Angle-Off) in the Common Z grammar, as BOX's and Wheel-BOX's, with the Wheel rows (Rev0.4's Wheel
// outputs): Wheel Range / Slant, the Wheel turn, the Angle-Off and the attack order and interval.
export const WHEEL_ATTACK_Z_DIAGRAM_V0_1 = Object.freeze({
  id: "wheel-attack-z-diagram-v0.1",
  version: "0.1.0",
  owner: "AG/bombing/wheel-attack/SPEC.md",
  subject: "Wheel",
  view: "Z-Diagram",
  commonRenderer: "common-z-diagram-v0.1",
});

export { wheelAttackZDiagramTitle };

export function buildWheelAttackZDiagramRowsV0_1(result) {
  const wheel = result.wheel;
  const flight = result.flight;
  return [
    { label: "Wheel Range / Slant", value: `${formatNm(wheel.radiusNm)} NM / ${formatNm(wheel.slantRangeNm)} NM` },
    { label: "Wheel Speed / Bank / G", value: `${formatKt(wheel.wheelSpeedKcas)} KCAS / ${formatDeg(wheel.wheelBankAngleDeg)}° / ${formatG(wheel.wheelLoadFactorG)} G` },
    { label: "Angle-Off (AUTO) / Intercept", value: `${formatDeg(result.angleOffDeg)}° ${result.direction} / ${formatDeg(result.interceptAngleDeg)}°` },
    { label: "Order / Interval", value: `${flight.sequence.join(" → ")} / ${formatSec(flight.attackIntervalSec)} sec` },
  ];
}

export function renderWheelAttackZDiagramV0_1(svg, result, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  if (!result?.bombDelivery || !result?.wheel || !result?.flight) throw new TypeError("result must be a Wheel Attack v0.1 result");
  const title = wheelAttackZDiagramTitle({ aircraftNumber: options.aircraftNumber });
  svg.setAttribute("aria-label", title);
  const data = buildBdpZDiagramData(result.bombDelivery);
  svg.replaceChildren();
  if (!data.supported) {
    svg.setAttribute("viewBox", "0 0 650 220");
    svg.style.aspectRatio = "650 / 220";
    svg.append(svgNode("rect", { x: 0, y: 0, width: 650, height: 220, fill: "#ffffff" }));
    const message = data.reason === "LEVEL_NO_Z_DIAGRAM" ? "LEVEL profile · Z-Diagram not applicable" : "Dive angle below 10° · Z-Diagram unavailable";
    for (const [y, text, size] of [[82, `${data.profileTitle} · Wheel`, 24], [132, message, 16]]) {
      svg.append(svgNode("text", { x: 325, y, "text-anchor": "middle", "font-size": size, "font-weight": 850, fill: "#14202c" }, text));
    }
    return { title, rendered: false, data };
  }
  const root = svg.appendChild(svgNode("g", { "data-z-root": "", "data-view": WHEEL_ATTACK_Z_DIAGRAM_V0_1.id }));
  renderCommonZDiagram(svg, {
    ...data,
    beTitle: "Wheel",
    uniformBodyText: true,
    compactAngleLabels: true,
    extraRows: buildWheelAttackZDiagramRowsV0_1(result),
  });
  const box = svg.viewBox.baseVal;
  root.prepend(svgNode("rect", { x: 0, y: 0, width: box.width, height: box.height, fill: "#ffffff" }));
  return { title, rendered: true, data };
}
