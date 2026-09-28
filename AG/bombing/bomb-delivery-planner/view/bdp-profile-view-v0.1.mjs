import {
  appendAngleArc,
  appendGrid,
  appendHorizontalDimension,
  appendText,
  appendVerticalDimension,
  createOpenArrowMarker,
  svgNode,
} from "../../../../common/diagram/svg-primitives-v0.1.mjs";
import { formatDeg, formatFt as formatFtValue, formatNm as formatNmValue } from "../../../../common/ui/display-precision-v0.1.mjs";

const FT_PER_NM = 6076.11549;

export const BDP_PROFILE_VIEW_V0_1 = Object.freeze({
  id: "bdp-profile-view-v0.1",
  version: "0.2.2",
  oracle: "Bomb Profile REV.1.9 · R_20260830 Dive Profile visual grammar",
  semanticStart: "TRACK_POINT",
});

function get(svg, id) {
  const element = svg.querySelector(`#${id}`);
  if (!element) throw new Error(`BDP Profile View requires #${id}`);
  return element;
}

function setLine(element, x1, y1, x2, y2) {
  element.setAttribute("x1", x1);
  element.setAttribute("y1", y1);
  element.setAttribute("x2", x2);
  element.setAttribute("y2", y2);
  element.style.display = "";
}

function setPoint(element, x, y, options = {}) {
  element.setAttribute("cx", x);
  element.setAttribute("cy", y);
  if (options.radius !== undefined) element.setAttribute("r", options.radius);
  if (options.fill !== undefined) element.setAttribute("fill", options.fill);
  if (options.stroke !== undefined) element.setAttribute("stroke", options.stroke);
  if (options.strokeWidth !== undefined) element.setAttribute("stroke-width", options.strokeWidth);
  element.style.display = options.visible === false ? "none" : "";
}

function ensureMarkers(svg) {
  const defs = svg.querySelector("defs") ?? svg.insertBefore(svgNode("defs"), svg.firstChild);
  defs.querySelectorAll("[data-bdp-profile-marker]").forEach((node) => node.remove());
  [
    ["bdp-profile-blue", "#176dac"],
    ["bdp-profile-amber", "#a35d00"],
    ["bdp-profile-green", "#087b4c"],
    ["bdp-profile-purple", "#7a4cb1"],
  ].forEach(([id, color]) => {
    const marker = createOpenArrowMarker(id, color, {
      markerWidth: 12,
      markerHeight: 12,
      refX: 10,
      refY: 6,
      path: "M2,2 L10,6 L2,10",
      strokeWidth: 2.1,
    });
    marker.setAttribute("data-bdp-profile-marker", "true");
    defs.append(marker);
  });
}

// Display precision and plot notation (docs/TERMINOLOGY.md): NM 1 decimal, ft and angles
// integer; one space before an alphabetic unit, degree symbol attached.
function formatNm(value) {
  return `${formatNmValue(value)} NM`;
}

function formatFt(value) {
  return `${formatFtValue(value)} ft`;
}

export function renderBdpProfileView(svg, result) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  if (!result?.public || !result?.visualization) throw new TypeError("BDP result is required");

  const input = result.canonicalInputs;
  const pub = result.public;
  const local = result.local;
  const grid = get(svg, "p-grid");
  const labels = get(svg, "p-labels");
  grid.replaceChildren();
  labels.replaceChildren();
  appendGrid(grid);
  ensureMarkers(svg);

  svg.setAttribute("viewBox", "0 0 900 700");

  // The Rev1.9 shell contains one anonymous legacy ground line. The V2 renderer owns
  // the Track-Point-forward baseline, so hide anonymous direct-child lines rather than
  // allowing an obsolete full-width baseline to remain underneath the new profile.
  [...svg.children].filter((element) => element.tagName.toLowerCase() === "line" && !element.id)
    .forEach((element) => { element.style.display = "none"; });

  // Rev1.9 canvas grammar retained; semantic profile starts at Track Point.
  const left = 105;
  const right = 825;
  const top = 95;
  const ground = 390;
  const trackAglFt = pub.trackPointAltitudeMslFt - input.targetElevationMslFt;
  const releaseAglFt = pub.effectiveReleaseAltitudeMslFt - input.targetElevationMslFt;
  const trackingHorizontalFt = pub.downRangeTravelNm * FT_PER_NM;
  const groundRangeFt = pub.groundRangeNm * FT_PER_NM;
  const bombRangeFt = pub.bombRangeNm * FT_PER_NM;
  const aimOffRangeFt = local.aimOffPointRangeNm === null ? groundRangeFt : local.aimOffPointRangeNm * FT_PER_NM;
  const maxXFt = Math.max(groundRangeFt, aimOffRangeFt, trackingHorizontalFt + bombRangeFt, 1) * 1.08;
  const maxH = Math.max(trackAglFt, releaseAglFt, 1) * 1.12;
  const xs = (value) => left + (value / maxXFt) * (right - left);
  const ys = (value) => ground - (value / maxH) * (ground - top);

  const track = { x: xs(0), y: ys(trackAglFt) };
  const release = { x: xs(trackingHorizontalFt), y: ys(releaseAglFt) };
  const target = { x: xs(groundRangeFt), y: ground };
  const aimOff = { x: xs(aimOffRangeFt), y: ground };

  // Remove the old Initial/Roll-in portion from the profile drawing.
  get(svg, "p-roll").setAttribute("d", "");
  get(svg, "p-roll").style.display = "none";
  setPoint(get(svg, "p-initial-point"), 0, 0, { visible: false });

  setLine(get(svg, "p-flight"), track.x, track.y, release.x, release.y);
  setLine(get(svg, "p-los"), track.x, track.y, target.x, target.y);
  setPoint(get(svg, "p-rollout-point"), track.x, track.y, { radius: 6, fill: "#176dac", visible: true });
  setPoint(get(svg, "p-release-point"), release.x, release.y, { radius: 6, fill: "#a35d00", visible: true });
  setPoint(get(svg, "p-target-point"), target.x, target.y, { radius: 7, fill: "#087b4c", visible: true });
  setPoint(get(svg, "p-fpm-point"), aimOff.x, aimOff.y, {
    radius: 5,
    fill: "none",
    stroke: "#087b4c",
    strokeWidth: 2,
    visible: input.diveAngleDeg > 0 && Math.abs(aimOff.x - target.x) > 1,
  });

  const bombSamples = result.visualization.bombTrajectorySamples ?? [];
  const bombPath = bombSamples.map((sample, index) => {
    const x = xs(trackingHorizontalFt + sample.downRangeNm * FT_PER_NM);
    const y = ys(sample.altitudeAglFt);
    return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  get(svg, "p-bomb").setAttribute("d", bombPath);
  get(svg, "p-bomb").style.display = "";

  // Legacy dimension elements are retained in the HTML shell only for oracle DOM compatibility.
  ["p-rollin-distance", "p-ground-range", "p-rollin-range", "p-aod"].forEach((id) => {
    get(svg, id).style.display = "none";
  });

  appendText(labels, track.x, track.y - 18, "Track Point", { anchor: "middle", size: 14 });
  appendText(labels, release.x, release.y - 18, "Release", { anchor: "middle", size: 14 });
  appendText(labels, target.x - 8, ground - 24, "Target", { anchor: "end", size: 14 });
  if (input.diveAngleDeg > 0 && Math.abs(aimOff.x - target.x) > 1) {
    appendText(labels, aimOff.x + 8, ground + 25, "Aim-off", { anchor: "start", size: 12, color: "#087b4c" });
  }

  appendText(labels, left, 38, `Track Point Altitude: ${formatFtValue(pub.trackPointAltitudeMslFt)} ft MSL`, {
    anchor: "start",
    size: 16,
    weight: 900,
    color: "#14202c",
  });

  // Ground/reference line begins at Track Point because the profile no longer includes the Initial/Roll-in segment.
  labels.append(svgNode("line", {
    x1: track.x,
    y1: ground,
    x2: Math.max(target.x, aimOff.x),
    y2: ground,
    stroke: "#14202c",
    "stroke-width": 2,
  }));

  // Rev1.9-style fixed dimension lanes, but with current Track-Point-forward content.
  appendHorizontalDimension(labels, {
    x1: track.x,
    x2: target.x,
    y: 470,
    color: "#a35d00",
    markerId: "bdp-profile-amber",
    title: "MAP",
    detail: formatNm(pub.groundRangeNm),
  });
  appendHorizontalDimension(labels, {
    x1: track.x,
    x2: release.x,
    y: 520,
    color: "#176dac",
    markerId: "bdp-profile-blue",
    title: "Tracking Distance",
    detail: formatNm(pub.downRangeTravelNm),
  });
  appendHorizontalDimension(labels, {
    x1: release.x,
    x2: target.x,
    y: 570,
    color: "#087b4c",
    markerId: "bdp-profile-green",
    title: "Bomb Range",
    detail: formatNm(pub.bombRangeNm),
  });

  const verticalTrackingFt = pub.trackPointAltitudeMslFt - pub.effectiveReleaseAltitudeMslFt;
  appendVerticalDimension(labels, {
    x: Math.max(55, track.x - 42),
    y1: track.y,
    y2: release.y,
    color: "#7a4cb1",
    markerId: "bdp-profile-purple",
    title: "Vertical Tracking Distance",
    detail: formatFt(verticalTrackingFt),
    anchor: "start",
    labelOffsetX: 12,
    clampY: [95, 350],
  });

  // Angle geometry uses actual Track Point→Release and Track Point→Target rays.
  const trackingAngleScreen = Math.atan2(release.y - track.y, release.x - track.x);
  const losAngleScreen = Math.atan2(target.y - track.y, target.x - track.x);
  if (input.diveAngleDeg > 0 && release.x > track.x) {
    appendAngleArc(labels, track, 42, 0, trackingAngleScreen, {
      color: "#176dac",
      width: 1.7,
      label: `Dive Angle: ${formatDeg(input.diveAngleDeg)}°`,
      labelRadiusOffset: 34,
      labelSize: 11.5,
    });
    appendAngleArc(labels, track, 67, trackingAngleScreen, losAngleScreen, {
      color: "#a35d00",
      width: 1.7,
      label: `IAA: ${formatDeg(local.aimOffAngleDeg)}°`,
      labelRadiusOffset: 36,
      labelSize: 11.5,
    });
  }

  appendText(labels, 450, 633, "Remark: MAP · Tracking Distance · Bomb Range", {
    anchor: "middle",
    size: 11.5,
    weight: 700,
    color: "#687787",
    detail: true,
  });
  appendText(labels, 450, 652, "Vertical Tracking Distance · IAA · Dive Angle", {
    anchor: "middle",
    size: 11.5,
    weight: 700,
    color: "#687787",
    detail: true,
  });

  return {
    semanticStart: "TRACK_POINT",
    trackPointAltitudeMslFt: pub.trackPointAltitudeMslFt,
    groundRangeNm: pub.groundRangeNm,
    trackingDistanceNm: pub.downRangeTravelNm,
    bombRangeNm: pub.bombRangeNm,
    verticalTrackingDistanceFt: verticalTrackingFt,
    aimOffAngleDeg: local.aimOffAngleDeg,
    diveAngleDeg: input.diveAngleDeg,
    bflVisible: false,
    viewBox: { width: 900, height: 700 },
  };
}
