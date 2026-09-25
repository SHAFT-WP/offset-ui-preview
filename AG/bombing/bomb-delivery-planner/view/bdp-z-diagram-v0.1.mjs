import { renderCommonZDiagram } from "../../../../common/diagram/z-diagram/z-diagram-v0.1.mjs";
import { getWeaponById } from "../weapon-data-v0.1.mjs";

const FT_PER_NM = 6076.11549;

export const BDP_Z_DIAGRAM_V0_1 = Object.freeze({
  id: "bdp-z-diagram-v0.1",
  version: "0.1.2",
  oracle: "Bomb Profile REV.1.9 · R_20260830",
  baseRenderer: "common/diagram/z-diagram/z-diagram-v0.1.mjs",
});

function profileName(input) {
  const angle = input.diveAngleDeg;
  const weapon = getWeaponById(input.weaponId);
  if (angle === 0) return "VLD";
  if (angle > 30) return "HADB";
  if (angle === 30) return "DB";
  return weapon.drag >= 1 || weapon.name.includes("(HD)") ? "LAHD" : "LALD";
}

export function bdpZTitle(result) {
  return `${Math.round(result.canonicalInputs.diveAngleDeg)}° ${profileName(result.canonicalInputs)}`;
}

export function buildBdpZDiagramData(result) {
  if (!result?.public || !result?.canonicalInputs) throw new TypeError("BDP result is required");
  const input = result.canonicalInputs;
  const diveAngleDeg = input.diveAngleDeg;
  if (diveAngleDeg < 10) {
    return {
      supported: false,
      reason: diveAngleDeg === 0 ? "LEVEL_NO_Z_DIAGRAM" : "BELOW_10_DEG_NO_Z_DIAGRAM",
      profileTitle: bdpZTitle(result),
    };
  }

  const initialAglFt = result.public.resolvedInitialAltitudeMslFt - input.targetElevationMslFt;
  const rollInRangeFt = result.public.rollInRangeNm * FT_PER_NM;
  const initialSlantFt = Math.hypot(initialAglFt, rollInRangeFt);


  return {
    supported: true,
    profileTitle: bdpZTitle(result),
    beTitle: "",
    initialKcas: result.public.resolvedInitialSpeedKcas,
    initialMsl: result.public.resolvedInitialAltitudeMslFt,
    diveAngle: diveAngleDeg,
    rollInRangeFt,
    slantFt: initialSlantFt,
    groundFt: result.public.groundRangeNm * FT_PER_NM,
    releaseMsl: result.public.effectiveReleaseAltitudeMslFt,
    releaseKcas: input.releaseSpeedKcas,
    nltMsl: result.public.nltReleaseMslFt,
    minAltMsl: result.public.minAltMslFt,
    rollInLead: result.public.leadAngleDeg,
    labels: { rollInPoint: "Roll-in Point", groundRange: "MAP", aimOffAngle: "IAA", releaseAltitude: "Release Altitude", rollInLead: "Roll-in Lead Angle" },
    aimOffAngle: result.local.aimOffAngleDeg,
    trackingTime: result.public.trackingTimeSec,
    rollInToImpactTime: result.public.rollInTimeSec + result.public.trackingTimeSec + result.public.bombTofSec,

  };
}

function unavailable(svg, title, reason) {
  const root = svg.querySelector("g") ?? svg;
  root.replaceChildren();
  svg.setAttribute("viewBox", "0 0 650 220");
  svg.style.aspectRatio = "650 / 220";
  const ns = "http://www.w3.org/2000/svg";
  const heading = document.createElementNS(ns, "text");
  heading.setAttribute("x", "325");
  heading.setAttribute("y", "82");
  heading.setAttribute("text-anchor", "middle");
  heading.setAttribute("font-size", "24");
  heading.setAttribute("font-weight", "900");
  heading.textContent = title;
  const note = document.createElementNS(ns, "text");
  note.setAttribute("x", "325");
  note.setAttribute("y", "132");
  note.setAttribute("text-anchor", "middle");
  note.setAttribute("font-size", "16");
  note.setAttribute("font-weight", "750");
  note.textContent = reason === "LEVEL_NO_Z_DIAGRAM"
    ? "LEVEL profile · Z-Diagram not applicable"
    : "Dive angle below 10° · MINALT concept only";
  root.append(heading, note);
}

export function renderBdpZDiagram(svg, result) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  const data = buildBdpZDiagramData(result);
  if (!data.supported) {
    unavailable(svg, data.profileTitle, data.reason);
    return data;
  }
  renderCommonZDiagram(svg, { ...data, uniformBodyText: true, compactAngleLabels: true });
  return data;
}
