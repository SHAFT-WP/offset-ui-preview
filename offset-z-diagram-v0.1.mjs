import { buildBdpZDiagramData } from "./AG/bombing/bomb-delivery-planner/view/bdp-z-diagram-v0.1.mjs";
import { getWeaponById } from "./AG/bombing/bomb-delivery-planner/weapon-data-v0.1.mjs";
import { renderCommonZDiagram } from "./common/diagram/z-diagram/z-diagram-v0.1.mjs";

const heading = (from, to) => ((Math.atan2(to.x - from.x, to.y - from.y) * 180 / Math.PI) + 360) % 360;
const degrees = (value) => `${Math.round(value).toString().padStart(3, "0")}°`;
const nm = (value) => `${Number(value).toFixed(2)} NM`;

export function offsetProfileTitle(result) {
  const input = result.profile.canonicalInputs;
  const weapon = getWeaponById(input.weaponId);
  const delivery = weapon.name.includes("(HD)") ? "LAHD" : "LALD";
  return `Offset ${delivery} ${Math.round(input.diveAngleDeg)} #1`;
}

export function renderOffsetZDiagram(svg, result) {
  const data = buildBdpZDiagramData(result.profile);
  const title = offsetProfileTitle(result);
  if (!data.supported) {
    svg.setAttribute("viewBox", "0 0 650 220");
    svg.style.aspectRatio = "650 / 220";
    const root = svg.querySelector("[data-z-root]");
    root.replaceChildren();
    for (const [y, message] of [[80, title], [135, "Dive angle below 10° · Z-Diagram unavailable"]]) {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", "325"); text.setAttribute("y", String(y));
      text.setAttribute("text-anchor", "middle"); text.setAttribute("font-size", "20");
      text.textContent = message; root.append(text);
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
    initialAltitudeText: `Roll-in Alt ${Math.round(result.profile.public.resolvedInitialAltitudeMslFt)} ft`,
    footerRows: [
      { label: "Action Range", value: nm(result.geometry.actionRangeNm) },
      { label: "Offset Angle", value: degrees(result.geometry.offsetAngleDeg) },
      { label: "Angle Off", value: degrees(result.geometry.angleOffDeg) },
      { label: "Target Bearing", value: degrees(heading(reference, points.target)) },
      { label: "Range", value: nm(targetRange) },
    ],
  });
  return true;
}
