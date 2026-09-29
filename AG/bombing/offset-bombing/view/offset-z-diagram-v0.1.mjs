import { buildBdpZDiagramData } from "../../bomb-delivery-planner/view/bdp-z-diagram-v0.1.mjs";
import { getWeaponById } from "../../bomb-delivery-planner/weapon-data-v0.1.mjs";
import { renderCommonZDiagram } from "../../../../common/diagram/z-diagram/z-diagram-v0.1.mjs";
import { svgNode } from "../../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { formatDeg, formatFt, formatNm } from "../../../../common/ui/display-precision-v0.1.mjs";
import { bearingDeg, formatHeadingDeg, offsetViewTitle } from "./offset-view-style-v0.1.mjs";

// Offset Z-Diagram — the BDP Z of the profile Offset solved, with Offset footer rows (Common Z
// grammar; formerly apps/bombing-calculator-v2/offset/offset-z-diagram-v0.1.mjs). Values use the
// Common display formatters; titles carry the aircraft number.

export const OFFSET_Z_DIAGRAM_V0_1 = Object.freeze({
  id: "offset-z-diagram-v0.1",
  version: "0.1.0",
  subject: "Offset",
  view: "Z-Diagram",
});

export const offsetZDiagramTitle = (options) => offsetViewTitle("Z-Diagram", options);

// In-plot profile title, e.g. "Offset LALD 45 #1".
export function offsetProfileTitle(result, { aircraftNumber = 1 } = {}) {
  const input = result.profile.canonicalInputs;
  const weapon = getWeaponById(input.weaponId);
  const delivery = weapon.name.includes("(HD)") ? "LAHD" : "LALD";
  return `Offset ${delivery} ${formatDeg(input.diveAngleDeg)} #${aircraftNumber}`;
}

// The Common Z renderer draws into [data-z-root]; a bare svg gets one.
function zRoot(svg) {
  return svg.querySelector("[data-z-root]") ?? svg.appendChild(svgNode("g", { "data-z-root": "" }));
}

export function renderOffsetZDiagram(svg, result, options = {}) {
  const aircraftNumber = options.aircraftNumber ?? 1;
  svg.setAttribute("aria-label", offsetZDiagramTitle({ aircraftNumber }));
  const root = zRoot(svg);
  const data = buildBdpZDiagramData(result.profile);
  const title = offsetProfileTitle(result, { aircraftNumber });
  if (!data.supported) {
    svg.setAttribute("viewBox", "0 0 650 220");
    svg.style.aspectRatio = "650 / 220";
    root.replaceChildren();
    for (const [y, message] of [[80, title], [135, "Dive angle below 10° · Z-Diagram unavailable"]]) {
      root.append(svgNode("text", { x: 325, y, "text-anchor": "middle", "font-size": 20, fill: "#14202c" }, message));
    }
    return false;
  }
  const points = result.geometry.points;
  const reference = result.reference?.point ?? points.ip;
  const targetRange = Math.hypot(points.target.x - reference.x, points.target.y - reference.y);
  renderCommonZDiagram(svg, {
    ...data,
    uniformBodyText: true,
    altitudeOnLeft: true,
    compactAngleLabels: true,
    profileTitle: title,
    initialAltitudeText: `Roll-in Alt ${formatFt(result.profile.public.resolvedInitialAltitudeMslFt)} ft`,
    footerRows: [
      { label: "Action Range", value: `${formatNm(result.geometry.actionRangeNm)} NM` },
      { label: "Offset Angle", value: `${formatDeg(result.geometry.offsetAngleDeg)}°` },
      { label: "Angle Off", value: `${formatDeg(result.geometry.angleOffDeg)}°` },
      { label: "Target Bearing", value: formatHeadingDeg(bearingDeg(reference, points.target)) },
      { label: "Range", value: `${formatNm(targetRange)} NM` },
    ],
  });
  return true;
}
