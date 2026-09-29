import {
  appendAngleArc,
  appendHorizontalDimension,
  appendText,
  appendVerticalDimension,
  applyTextHalo,
  clamp,
  createOpenArrowMarker,
  scopeSvgMarkerIds,
  SVG_DIAGRAM_COLORS_V0_1,
  SVG_DIAGRAM_STYLE_V0_1,
  svgNode,
} from "../../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.5";
import { createSmartLabelLayout } from "../../../../common/diagram/svg-smart-label-v0.1.mjs?v=0.1.4";
import { formatDeg, formatFt, formatNm } from "../../../../common/ui/display-precision-v0.1.mjs";
import { BDP_PROFILE_LEGEND, BDP_VIEW_COLORS as C, bdpProfileTitle } from "./bdp-view-style-v0.1.mjs";

// Dive Profile — BDP-owned view in the V2 unified view grammar (common/diagram/SPEC.md; BDP FE SPEC
// "Dive Profile rules — 2026-09-28"; BDP SPEC §8 / §10.1).
// - One scale for horizontal and vertical: the drawn Dive Angle and IAA are the real angles.
// - FPM line: Track Point → Release (solid) → Aim-off Point (dashed); Dive Angle is its angle.
// - AOD (Target → Aim-off Point) in ft; IAA between the FPM line and the Target line of sight.
// - Self-contained: fills an empty <svg>, sets every stroke, fill and text halo as attributes.

const FT_PER_NM = 6076.11549;

export const BDP_PROFILE_VIEW_V0_2 = Object.freeze({
  id: "bdp-profile-view-v0.2",
  // 0.2.1 (2026-09-29, user request): Tracking Distance, Bomb Range and AOD on one chained ground row.
  version: "0.2.1",
  subject: "Dive",
  view: "Profile",
  semanticStart: "TRACK_POINT",
  trueAngles: true,
  canvas: Object.freeze({ width: 900, maxPlotHeight: 400 }),
  legend: BDP_PROFILE_LEGEND,
});

export { bdpProfileTitle };

const WIDTH = BDP_PROFILE_VIEW_V0_2.canvas.width;
const PLOT_LEFT = 230;
const PLOT_RIGHT = 815;
const PLOT_TOP = 104;
const LANE_GAP = 46;

export function renderBdpProfileView(svg, result, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  if (!result?.public || !result?.visualization) throw new TypeError("BDP result is required");
  const input = result.canonicalInputs;
  const pub = result.public;
  const local = result.local;
  const textScale = clamp(Number(options.textScale) || 1, 0.5, 2);
  const font = SVG_DIAGRAM_STYLE_V0_1.font;

  // World (ft): x = horizontal distance from Track Point along Attack Heading, y = height AGL.
  const trackAglFt = pub.trackPointAltitudeMslFt - input.targetElevationMslFt;
  const releaseAglFt = pub.effectiveReleaseAltitudeMslFt - input.targetElevationMslFt;
  const downRangeFt = pub.downRangeTravelNm * FT_PER_NM;
  const groundRangeFt = pub.groundRangeNm * FT_PER_NM;
  const bombRangeFt = pub.bombRangeNm * FT_PER_NM;
  const aimOffRangeFt = local.aimOffPointRangeNm === null ? null : local.aimOffPointRangeNm * FT_PER_NM;
  const diving = input.diveAngleDeg > 0 && aimOffRangeFt !== null;
  const xMaxFt = Math.max(groundRangeFt, aimOffRangeFt ?? 0, downRangeFt + bombRangeFt, 1);
  const yMaxFt = Math.max(trackAglFt, releaseAglFt, 1);

  // One scale for both axes (true angles); the plot height follows the geometry.
  const scale = Math.min((PLOT_RIGHT - PLOT_LEFT) / (xMaxFt * 1.04), BDP_PROFILE_VIEW_V0_2.canvas.maxPlotHeight / yMaxFt);
  const usedWidth = xMaxFt * 1.04 * scale;
  const originX = PLOT_LEFT + Math.max(0, ((PLOT_RIGHT - PLOT_LEFT) - usedWidth) / 2);
  const groundY = PLOT_TOP + yMaxFt * scale;
  const xs = (x) => originX + x * scale;
  const ys = (y) => groundY - y * scale;
  // Two ground rows: MAP, then Tracking Distance · Bomb Range · AOD chained on one row.
  const lanes = [groundY + 64, groundY + 64 + LANE_GAP];
  const remarkY = lanes[1] + 62;
  const HEIGHT = Math.round(remarkY + 19 * textScale + 32);

  const track = { x: xs(0), y: ys(trackAglFt) };
  const release = { x: xs(downRangeFt), y: ys(releaseAglFt) };
  const target = { x: xs(groundRangeFt), y: groundY };
  const aimOff = diving ? { x: xs(aimOffRangeFt), y: groundY } : null;

  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
  svg.style.aspectRatio = `${WIDTH} / ${HEIGHT}`;
  svg.dataset.canvasHeight = String(HEIGHT);
  const title = bdpProfileTitle({ aircraftNumber: options.aircraftNumber });
  svg.setAttribute("aria-label", title);
  const defs = svgNode("defs");
  const markerOptions = { markerWidth: 12, markerHeight: 12, refX: 10, refY: 6, path: "M2,2 L10,6 L2,10", strokeWidth: 2.1 };
  [["blue", C.flightPath], ["amber", C.los], ["green", C.bomb], ["purple", C.verticalTracking]]
    .forEach(([name, color]) => defs.append(createOpenArrowMarker(`bdp-profile-${name}`, color, markerOptions)));
  defs.append(createOpenArrowMarker("bdp-profile-leader", SVG_DIAGRAM_COLORS_V0_1.helper, SVG_DIAGRAM_STYLE_V0_1.arrow.leader));
  const root = svgNode("g", { "data-view": BDP_PROFILE_VIEW_V0_2.id });
  svg.append(defs, root);
  root.append(svgNode("rect", { x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: SVG_DIAGRAM_COLORS_V0_1.background }));

  appendText(root, 48, 44, `Track Point Altitude: ${formatFt(pub.trackPointAltitudeMslFt)} ft MSL`, {
    anchor: "start", size: 16 * textScale, weight: 900, color: SVG_DIAGRAM_COLORS_V0_1.text,
  });

  // Ground line from Track Point forward.
  const groundEnd = Math.max(target.x, aimOff?.x ?? 0) + 34;
  root.append(svgNode("line", { x1: track.x - 24, y1: groundY, x2: groundEnd, y2: groundY, stroke: C.ground, "stroke-width": 2 }));

  // FPM line (Dive Angle line): Track Point → Release solid, Release → Aim-off Point dashed.
  root.append(svgNode("line", {
    x1: track.x, y1: track.y, x2: release.x, y2: release.y,
    stroke: C.flightPath, "stroke-width": 3, "stroke-linecap": "round", "data-profile-role": "fpm-line",
  }));
  if (aimOff) root.append(svgNode("line", {
    x1: release.x, y1: release.y, x2: aimOff.x, y2: aimOff.y,
    stroke: C.flightPath, "stroke-width": 2, "stroke-dasharray": "8 6", "data-profile-role": "fpm-extension",
  }));
  // Target line of sight from Track Point.
  root.append(svgNode("line", {
    x1: track.x, y1: track.y, x2: target.x, y2: target.y,
    stroke: C.los, "stroke-width": 2.2, "stroke-dasharray": "8 6", "data-profile-role": "target-los",
  }));
  // Bomb trajectory from Release.
  const bombPath = (result.visualization.bombTrajectorySamples ?? []).map((sample, index) =>
    `${index ? "L" : "M"}${xs(downRangeFt + sample.downRangeNm * FT_PER_NM).toFixed(1)},${ys(sample.altitudeAglFt).toFixed(1)}`).join(" ");
  root.append(svgNode("path", {
    d: bombPath, fill: "none", stroke: C.bomb, "stroke-width": 4, "stroke-linecap": "round", "stroke-linejoin": "round",
  }));

  // Angles at Track Point: Dive Angle from the horizontal, IAA from the FPM line to the Target LOS.
  const fpmAngle = Math.atan2(release.y - track.y, release.x - track.x);
  const losAngle = Math.atan2(target.y - track.y, target.x - track.x);
  const diveArc = diving ? 48 : 0;
  if (diving) {
    root.append(svgNode("line", {
      x1: track.x, y1: track.y, x2: track.x + 78, y2: track.y,
      stroke: SVG_DIAGRAM_COLORS_V0_1.guide, "stroke-width": 1.2, "stroke-dasharray": "4 4",
    }));
    appendAngleArc(root, track, diveArc, 0, fpmAngle, { color: C.flightPath, width: 1.7 });
    appendAngleArc(root, track, 84, fpmAngle, losAngle, { color: C.los, width: 1.7 });
  }

  // Dimensions.
  const verticalTrackingFt = pub.trackPointAltitudeMslFt - pub.effectiveReleaseAltitudeMslFt;
  appendVerticalDimension(root, {
    x: track.x - 46, y1: track.y, y2: release.y, color: C.verticalTracking, markerId: "bdp-profile-purple",
  });
  const lane = (index, x1, x2, color, markerId, titleText, detail) => appendHorizontalDimension(root, {
    x1, x2, y: lanes[index], color, markerId, title: titleText, detail,
    titleSize: font.dimensionTitlePx * textScale, detailSize: font.detailPx * textScale,
  });
  lane(0, track.x, target.x, C.los, "bdp-profile-amber", "MAP", `${formatNm(pub.groundRangeNm)} NM`);
  // Chained row: Track Point → Release → Target → Aim-off Point. A label wider than its segment moves
  // out of the way: the first to the left, the last to the right, a middle one below the row.
  const chain = [
    [track.x, release.x, C.flightPath, "bdp-profile-blue", "Tracking Distance", `${formatNm(pub.downRangeTravelNm)} NM`],
    [release.x, target.x, C.bomb, "bdp-profile-green", "Bomb Range", `${formatNm(pub.bombRangeNm)} NM`],
    ...(aimOff ? [[target.x, aimOff.x, C.impact, "bdp-profile-green", "AOD", `${formatFt(local.aimOffDistanceFt)} ft`]] : []),
  ];
  const chainY = lanes[1];
  chain.forEach(([x1, x2, color, markerId, titleText, detail], index) => {
    // Grouped per segment with a test hook (V8).
    appendHorizontalDimension(root.appendChild(svgNode("g", { "data-profile-dimension": titleText })), { x1, x2, y: chainY, color, markerId });
    const titleSize = font.dimensionTitlePx * textScale;
    const detailSize = font.detailPx * textScale;
    const labelWidth = Math.max(titleText.length * titleSize, detail.length * detailSize) * 0.62;
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const fits = labelWidth + 10 <= right - left;
    const last = index === chain.length - 1;
    let x = (left + right) / 2;
    let anchor = "middle";
    let titleY = chainY - 9;
    if (!fits && last && index > 0) { x = right + 10; anchor = "start"; titleY = chainY - 3; }
    else if (!fits && index === 0) { x = left - 10; anchor = "end"; titleY = chainY - 3; }
    else if (!fits) { titleY = chainY + 30; }
    const detailY = titleY === chainY - 9 ? chainY + 14 : titleY + detailSize * 1.3;
    appendText(root, x, titleY, titleText, { anchor, size: titleSize, color, weight: 850 });
    appendText(root, x, detailY, detail, { anchor, size: detailSize, color, detail: true });
  });

  // Stations.
  root.append(svgNode("circle", { cx: track.x, cy: track.y, r: 6, fill: C.flightPath, stroke: "#ffffff", "stroke-width": 2 }));
  root.append(svgNode("circle", { cx: release.x, cy: release.y, r: 6, fill: C.release, stroke: "#ffffff", "stroke-width": 2 }));
  root.append(svgNode("circle", { cx: target.x, cy: target.y, r: 7, fill: C.impact, stroke: "#ffffff", "stroke-width": 2 }));
  if (aimOff) root.append(svgNode("circle", { cx: aimOff.x, cy: aimOff.y, r: 5, fill: "#ffffff", stroke: C.impact, "stroke-width": 2 }));

  // Labels: on their element, or joined to it by a leader (Common smart labels).
  const labels = createSmartLabelLayout(root, { width: WIDTH, height: HEIGHT, labelPad: 8, pathPad: 5, charWidthEm: 0.64 });
  [track, release, target].forEach((point) => labels.reservePoint(point, 9));
  if (aimOff) labels.reservePoint(aimOff, 8);
  labels.reserveSegment(track, release, 5);
  if (aimOff) labels.reserveSegment(release, aimOff, 4);
  labels.reserveSegment(track, target, 4);
  labels.reserveSegment({ x: track.x - 24, y: groundY }, { x: groundEnd, y: groundY }, 3);
  labels.reserveSegment({ x: track.x - 46, y: track.y }, { x: track.x - 46, y: release.y }, 4);
  if (diving) labels.reserveSegment(track, { x: track.x + 78, y: track.y }, 3);
  const bombPoints = (result.visualization.bombTrajectorySamples ?? []).map((sample) => ({ x: xs(downRangeFt + sample.downRangeNm * FT_PER_NM), y: ys(sample.altitudeAglFt) }));
  for (let i = 1; i < bombPoints.length; i += 3) labels.reserveSegment(bombPoints[i - 1], bombPoints[Math.min(i + 2, bombPoints.length - 1)], 4);
  const label = (point, text, labelOptions) => labels.append(point, text, {
    background: false,
    movable: options.movableLabels === true,
    fontSize: 14 * textScale,
    leaderMarkerId: "bdp-profile-leader",
    ...labelOptions,
  });
  label(track, "Track Point", {
    labelKey: "track-point", color: SVG_DIAGRAM_COLORS_V0_1.text,
    candidates: [{ dx: 0, dy: -16, anchor: "middle" }, { dx: -12, dy: -16, anchor: "end" }, { dx: 14, dy: -20, anchor: "start" }, { dx: -24, dy: -30, anchor: "end" }],
  });
  label(release, "Release", {
    labelKey: "release", color: SVG_DIAGRAM_COLORS_V0_1.text,
    candidates: [{ dx: 12, dy: -12, anchor: "start" }, { dx: 0, dy: -16, anchor: "middle" }, { dx: -12, dy: -12, anchor: "end" }, { dx: 26, dy: -32, anchor: "start" }, { dx: 30, dy: 10, anchor: "start" }],
  });
  label(target, "Target", {
    labelKey: "target", color: SVG_DIAGRAM_COLORS_V0_1.text,
    candidates: [{ dx: -12, dy: -14, anchor: "end" }, { dx: -26, dy: -30, anchor: "end" }, { dx: -40, dy: -52, anchor: "end" }, { dx: 0, dy: 26, anchor: "middle" }],
  });
  if (aimOff) label(aimOff, "Aim-off Point", {
    labelKey: "aim-off", color: C.impact, fontSize: 12.5 * textScale,
    candidates: [{ dx: 10, dy: 22, anchor: "start" }, { dx: 12, dy: -14, anchor: "start" }, { dx: 24, dy: 38, anchor: "start" }, { dx: 28, dy: -34, anchor: "start" }],
  });
  label({ x: track.x - 46, y: (track.y + release.y) / 2 }, "Vertical Tracking\nDistance", {
    labelKey: "vertical-tracking", color: C.verticalTracking, fontSize: font.dimensionTitlePx * textScale,
    detail: `${formatFt(verticalTrackingFt)} ft`, detailFontSize: font.detailPx * textScale,
    candidates: [{ dx: -12, dy: 0, anchor: "end" }, { dx: -12, dy: -28, anchor: "end" }, { dx: -12, dy: 28, anchor: "end" }, { dx: 14, dy: 0, anchor: "start" }],
  });
  if (diving) {
    const bisector = (a, b, radius) => ({ x: track.x + radius * Math.cos((a + b) / 2), y: track.y + radius * Math.sin((a + b) / 2) });
    const outward = (angle, distances) => distances.map((distance) => ({
      dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance + 4, anchor: "start",
    }));
    const diveMid = (0 + fpmAngle) / 2;
    label(bisector(0, fpmAngle, diveArc), `Dive Angle: ${formatDeg(input.diveAngleDeg)}°`, {
      labelKey: "dive-angle", color: C.flightPath, fontSize: font.detailPx * textScale,
      candidates: [...outward(diveMid, [14, 36]), { dx: 60, dy: -8, anchor: "start" }, { dx: 90, dy: 14, anchor: "start" }, { dx: 120, dy: -10, anchor: "start" }],
    });
    const iaaMid = (fpmAngle + losAngle) / 2;
    label(bisector(fpmAngle, losAngle, 84), `IAA: ${formatDeg(local.aimOffAngleDeg)}°`, {
      labelKey: "iaa", color: C.los, fontSize: font.detailPx * textScale,
      candidates: [...outward(iaaMid, [14, 40]), { dx: -30, dy: 34, anchor: "end" }, { dx: 50, dy: -30, anchor: "start" }, { dx: -40, dy: 60, anchor: "end" }, { dx: 80, dy: -40, anchor: "start" }],
    });
  }

  appendText(root, WIDTH / 2, remarkY, `Remark: MAP · Tracking Distance · Bomb Range${aimOff ? " · AOD" : ""}`, {
    anchor: "middle", size: font.detailPx * textScale, weight: 700, color: SVG_DIAGRAM_COLORS_V0_1.muted, detail: true,
  });
  appendText(root, WIDTH / 2, remarkY + 19 * textScale, "Vertical Tracking Distance · IAA · Dive Angle", {
    anchor: "middle", size: font.detailPx * textScale, weight: 700, color: SVG_DIAGRAM_COLORS_V0_1.muted, detail: true,
  });

  applyTextHalo(root);
  scopeSvgMarkerIds(svg, options.scope ?? "bdp-profile");
  return {
    title,
    semanticStart: BDP_PROFILE_VIEW_V0_2.semanticStart,
    trueAngles: true,
    drawnDiveAngleDeg: diving ? (fpmAngle * 180) / Math.PI : 0,
    drawnIaaDeg: diving ? ((losAngle - fpmAngle) * 180) / Math.PI : 0,
    trackPointAltitudeMslFt: pub.trackPointAltitudeMslFt,
    groundRangeNm: pub.groundRangeNm,
    trackingDistanceNm: pub.downRangeTravelNm,
    bombRangeNm: pub.bombRangeNm,
    aimOffDistanceFt: local.aimOffDistanceFt ?? null,
    verticalTrackingDistanceFt: verticalTrackingFt,
    aimOffAngleDeg: local.aimOffAngleDeg,
    diveAngleDeg: input.diveAngleDeg,
    canvas: { width: WIDTH, height: HEIGHT },
  };
}
