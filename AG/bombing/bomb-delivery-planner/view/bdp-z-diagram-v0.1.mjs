import { renderCommonZDiagram } from "../../../../common/diagram/z-diagram/z-diagram-v0.1.mjs?v=0.1.10";
import { formatDeg, formatNm, formatSec } from "../../../../common/ui/display-precision-v0.1.mjs";
import { getWeaponById } from "../weapon-data-v0.1.mjs";

const FT_PER_NM = 6076.11549;

export const BDP_Z_DIAGRAM_V0_1 = Object.freeze({
  id: "bdp-z-diagram-v0.1",
  // 0.1.3 (2026-10-01): profileName exported for Offset; Common Z 0.1.8 top row / label groups.
  // 0.1.4 (2026-10-01): two-column lower block (bdpZLowerColumns) on Common Z 0.1.9.
  // 0.1.5 (2026-10-01, user): upper group reads Roll-in Range; MAP takes the lower Roll-in Range row.
  version: "0.1.5",
  oracle: "Bomb Profile REV.1.9 · R_20260830",
  baseRenderer: "common/diagram/z-diagram/z-diagram-v0.1.mjs",
});

// Delivery classification shared by the BDP and Offset Z titles: VLD at 0°, HADB above 30°, DB at
// 30°, otherwise LAHD / LALD by the weapon's drag.
export function profileName(input) {
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
    labels: { rollInRange: "Roll-in Range", groundRange: "MAP", aimOffAngle: "IAA", releaseAltitude: "Release Altitude", rollInLead: "Roll-in Lead Angle" },
    aimOffAngle: result.local.aimOffAngleDeg,
    trackingTime: result.public.trackingTimeSec,
    rollInToImpactTime: result.public.rollInTimeSec + result.public.trackingTimeSec + result.public.bombTofSec,

  };
}

// BDP lower block (user layout 2026-10-01), two columns. Left: Angle Off, Attack Heading (only
// when the host has one; the standalone BDP has no Attack Heading input), Roll-in Lead Angle,
// MAP (user 2026-10-01: Roll-in Range is the upper-right group). Right: Tracking Time, Bomb TOF.
// Offset builds on these lists.
export function bdpZLowerColumns(result, { attackHeadingText = null } = {}) {
  const p = result.public;
  return {
    left: [
      { label: "Angle Off", value: `${formatDeg(result.canonicalInputs.angleOffDeg)}°` },
      ...(attackHeadingText ? [{ label: "Attack Heading", value: attackHeadingText }] : []),
      { label: "Roll-in Lead Angle", value: `${formatDeg(p.leadAngleDeg)}°` },
      { label: "MAP", value: `${formatNm(p.groundRangeNm)} NM` },
    ],
    right: [
      { label: "Tracking Time", value: `${formatSec(p.trackingTimeSec)} s` },
      { label: "Bomb TOF", value: `${formatSec(p.bombTofSec)} s` },
    ],
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
  renderCommonZDiagram(svg, { ...data, uniformBodyText: true, compactAngleLabels: true, lowerColumns: bdpZLowerColumns(result) });
  return data;
}
