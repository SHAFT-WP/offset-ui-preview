import {
  appendAlignedDimension,
  appendDirectedLine,
  applyTextHalo,
  clamp,
  createOpenArrowMarker,
  scopeSvgMarkerIds,
  SVG_DIAGRAM_COLORS_V0_1,
  SVG_DIAGRAM_STYLE_V0_1,
  svgNode,
} from "../../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.5";
import { createSmartLabelLayout } from "../../../../common/diagram/svg-smart-label-v0.1.mjs?v=0.1.4";
import { createSvgAutoCanvas } from "../../../../common/diagram/svg-viewport-v0.1.mjs?v=0.1.4";
import { formatDeg, formatFt, formatKt, formatMach, formatNm } from "../../../../common/ui/display-precision-v0.1.mjs";
import { BDP_TOP_VIEW_LEGEND, BDP_VIEW_COLORS as C, bdpTopViewTitle } from "./bdp-view-style-v0.1.mjs";

// Roll-in Top View — BDP-owned view in the V2 unified view grammar (common/diagram/SPEC.md;
// BDP FE SPEC "Roll-in Top View rules — 2026-09-28").
// - Initial (the BDP entry, OA1 in the current BDP) is at the bottom and the Target straight up:
//   every point turns about OA1 so the OA1 → Target bearing points up.
// - Roll-in Range is dimensioned along that (vertical) OA1 → Target line, so it is the true range.
// - Self-contained: fills an empty <svg>, sets every stroke, fill and text halo as attributes.
// - Labels sit on their element or are joined to it by a leader line (Common smart labels).
// 0.2.1 (2026-09-29, user decision for Offset): option `orientation: "NORTH_UP"` draws the same view on
// a north-up map (south at the bottom, north arrow). The host passes the true heading of the
// Initial → OA1 leg (`inHeadingDeg`; Offset: Approaching Heading) and the Roll-in turn direction
// (`rollDirection`), which place the BDP frame on the map. The default stays Initial bottom, Target up
// (BDP FE).

export const BDP_TOP_VIEW_V0_2 = Object.freeze({
  id: "bdp-top-view-v0.2",
  version: "0.2.1",
  subject: "Roll-in",
  view: "Top View",
  orientation: "INITIAL_BOTTOM_TARGET_UP",
  orientations: Object.freeze(["INITIAL_BOTTOM_TARGET_UP", "NORTH_UP"]),
  canvas: Object.freeze({ width: 900, minHeight: 620, maxHeight: 1300 }),
  legend: BDP_TOP_VIEW_LEGEND,
});

export { bdpTopViewTitle };

const WIDTH = BDP_TOP_VIEW_V0_2.canvas.width;
const DIMENSION_LANE_PX = 175;

export function applyBdpTopViewZoom(svg, zoom = 1) {
  const normalized = clamp(Number(zoom) || 1, 0.5, 2);
  const height = Number(svg.dataset?.canvasHeight) || 700;
  const w = WIDTH / normalized;
  const h = height / normalized;
  svg.setAttribute("viewBox", `${WIDTH / 2 - w / 2} ${height / 2 - h / 2} ${w} ${h}`);
  return normalized;
}

function rotateAbout(origin, angleRad) {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return (point) => {
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    return { x: origin.x + dx * cos - dy * sin, y: origin.y + dx * sin + dy * cos };
  };
}

// North-up placement of the BDP frame: forward (+x) runs along the Initial → OA1 true heading, the turn
// side (+y) 90° to the Roll-in side of it. World result: x = east, y = north (NM), about OA1.
function northUpAbout(origin, inHeadingDeg, rollDirection) {
  const h = (inHeadingDeg * Math.PI) / 180;
  const turn = rollDirection === "RIGHT" ? 1 : -1;
  const forward = { x: Math.sin(h), y: Math.cos(h) };
  const side = { x: turn * Math.cos(h), y: -turn * Math.sin(h) };
  return (point) => {
    const f = point.x - origin.x;
    const t = point.y - origin.y;
    return { x: origin.x + f * forward.x + t * side.x, y: origin.y + f * forward.y + t * side.y };
  };
}

// Three-digit true heading with the degree sign (Offset SPEC "Canonical heading").
const headingText = (deg) => `${String(((Math.round(deg) % 360) + 360) % 360).padStart(3, "0")}°`;

const station = (value) => (value ? { x: value.forwardNm, y: value.turnSideNm } : null);
const unit = (from, to) => {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
};

// Label candidates placed on a line: beside its middle first (no leader), then farther out.
function lineCandidates(from, to, side = 1) {
  const d = unit(from, to);
  const n = { x: -d.y * side, y: d.x * side };
  const anchorFor = (dx) => (dx > 6 ? "start" : dx < -6 ? "end" : "middle");
  return [16, 44, 80, -16, -44].map((distance) => {
    const dx = n.x * distance;
    const dy = n.y * distance + 5;
    return { dx, dy, anchor: anchorFor(dx) };
  });
}

export function renderBdpTopView(svg, result, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  const semantic = result?.visualization?.semanticState;
  if (!semantic?.stations || !semantic?.paths) throw new TypeError("BDP semantic visualization state is required");
  const pub = result.public;
  const input = result.canonicalInputs;
  const textScale = clamp(Number(options.textScale) || 1, 0.5, 2);

  // World frame (NM): x = pre-roll-in forward, y = turn side (drawn up before rotation).
  const s = semantic.stations;
  const oa1 = station(s.rollInStart);
  const track = station(s.trackPoint);
  const target = station(s.target);
  const aimOffWorld = station(s.aimOffPoint);
  const groundRangeNm = pub.groundRangeNm;
  const ingressLengthNm = Math.max(groundRangeNm, 0.8);

  // Default: Initial at the bottom, Target straight up (OA1 → Target bearing turned to +Y, screen up).
  // NORTH_UP: the BDP frame placed on a north-up map by the Initial → OA1 heading and the turn side.
  const northUp = options.orientation === "NORTH_UP";
  if (northUp && (!Number.isFinite(Number(options.inHeadingDeg)) || !["LEFT", "RIGHT"].includes(options.rollDirection))) {
    throw new TypeError("NORTH_UP needs a finite inHeadingDeg and rollDirection LEFT or RIGHT");
  }
  const bearing = Math.atan2(target.y - oa1.y, target.x - oa1.x);
  const rotationRad = Math.PI / 2 - bearing;
  const rotate = northUp ? northUpAbout(oa1, Number(options.inHeadingDeg), options.rollDirection) : rotateAbout(oa1, rotationRad);
  const w = {
    oa1,
    track: rotate(track),
    target: rotate(target),
    aimOff: aimOffWorld ? rotate(aimOffWorld) : null,
    ingress: rotate({ x: oa1.x - ingressLengthNm, y: oa1.y }),
    rollPath: semantic.paths.rollIn.map((p) => rotate({ x: p.forwardNm, y: p.turnSideNm })),
  };
  // Roll-in Long. D / Lat. D: OA1-frame components of OA1 → Track Point. Lat. D is measured from the
  // Initial track extended through OA1 (to its foot at Long. D) across to Track Point.
  const longitudinalNm = track.x - oa1.x;
  const lateralNm = track.y - oa1.y;
  w.lateralFoot = rotate({ x: oa1.x + longitudinalNm, y: oa1.y });
  w.initialExtension = rotate({ x: oa1.x + Math.max(longitudinalNm, 0) + 0.25 * groundRangeNm, y: oa1.y });

  // The Roll-in Range dimension goes on the side away from the Initial track. On a north-up map the
  // OA1 → Target line runs in any direction, so both sides keep room for it.
  let side = w.ingress.x <= w.oa1.x ? 1 : -1;
  const margins = northUp
    ? { top: 110, bottom: 110, left: DIMENSION_LANE_PX - 25, right: DIMENSION_LANE_PX - 25 }
    : { top: 64, bottom: 92, left: 56, right: 56 };
  if (!northUp) {
    if (side > 0) margins.right = DIMENSION_LANE_PX; else margins.left = DIMENSION_LANE_PX;
  }
  const fitPoints = [w.ingress, w.oa1, w.track, w.target, w.aimOff, w.initialExtension, ...w.rollPath,
    { x: w.target.x - groundRangeNm, y: w.target.y - groundRangeNm },
    { x: w.target.x + groundRangeNm, y: w.target.y + groundRangeNm }].filter(Boolean);
  if (northUp) {
    // The Roll-in Range dimension runs parallel to OA1 → Target, one Ground Range out on either side.
    const along = unit(w.oa1, w.target);
    const normal = { x: -along.y * groundRangeNm, y: along.x * groundRangeNm };
    for (const end of [w.oa1, w.target]) for (const sign of [1, -1]) fitPoints.push({ x: end.x + sign * normal.x, y: end.y + sign * normal.y });
  }
  const fit = createSvgAutoCanvas(fitPoints, {
    width: WIDTH,
    minHeight: BDP_TOP_VIEW_V0_2.canvas.minHeight,
    maxHeight: BDP_TOP_VIEW_V0_2.canvas.maxHeight,
    margins,
    minSpan: 0.3,
    flipY: true,
  });
  const HEIGHT = fit.height;
  const px = (point) => (point ? fit.project(point) : null);
  const P = {
    oa1: px(w.oa1), track: px(w.track), target: px(w.target), aimOff: px(w.aimOff),
    ingress: px(w.ingress), lateralFoot: px(w.lateralFoot), initialExtension: px(w.initialExtension), rollPath: w.rollPath.map(px),
  };
  const radiusPx = groundRangeNm * fit.scale;
  if (northUp) {
    // Screen normal (−dy, dx) of OA1 → Target, the dimension's offset direction: away from the ingress.
    const normal = { x: -(P.target.y - P.oa1.y), y: P.target.x - P.oa1.x };
    side = normal.x * (P.ingress.x - P.oa1.x) + normal.y * (P.ingress.y - P.oa1.y) > 0 ? -1 : 1;
  }

  // Self-contained canvas.
  svg.replaceChildren();
  svg.dataset.canvasHeight = String(HEIGHT);
  svg.style.aspectRatio = `${WIDTH} / ${HEIGHT}`;
  const title = bdpTopViewTitle({ aircraftNumber: options.aircraftNumber });
  svg.setAttribute("aria-label", title);
  const defs = svgNode("defs");
  [["initial", C.initialTrack], ["roll", C.rollIn], ["map", C.map], ["red", C.rollInTarget], ["aim", C.aimOff]]
    .forEach(([name, color]) => defs.append(createOpenArrowMarker(`bdp-top-${name}`, color)));
  defs.append(createOpenArrowMarker("bdp-top-leader", SVG_DIAGRAM_COLORS_V0_1.helper, SVG_DIAGRAM_STYLE_V0_1.arrow.leader));
  const root = svgNode("g", { "data-view": BDP_TOP_VIEW_V0_2.id });
  svg.append(defs, root);
  root.append(svgNode("rect", { x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: SVG_DIAGRAM_COLORS_V0_1.background }));

  // Target-centred Ground Range circle through Track Point.
  root.append(svgNode("circle", {
    cx: P.target.x, cy: P.target.y, r: radiusPx,
    fill: C.groundRangeFill, "fill-opacity": 0.68, stroke: C.frame, "stroke-width": 2.5,
  }));

  appendDirectedLine(root, P.ingress, P.oa1, { color: C.initialTrack, width: 3.5, markerEndId: "bdp-top-initial", toGap: 15 });
  // Initial track extended through OA1: the reference line of Roll-in Long. D / Lat. D.
  root.append(svgNode("line", {
    x1: P.oa1.x, y1: P.oa1.y, x2: P.initialExtension.x, y2: P.initialExtension.y,
    stroke: C.initialTrack, "stroke-width": 1.3, "stroke-dasharray": "6 5", opacity: 0.75, "data-top-view-role": "initial-extension",
  }));
  appendDirectedLine(root, P.target, P.oa1, { color: C.rollInTarget, width: 3.2, markerEndId: "bdp-top-red", fromGap: 12, toGap: 15 });
  appendDirectedLine(root, P.track, P.target, { color: C.map, width: 3.6, markerEndId: "bdp-top-map", fromGap: 8, toGap: 12 });
  const aimOffVisible = P.aimOff && Math.hypot(P.aimOff.x - P.target.x, P.aimOff.y - P.target.y) > 12;
  if (aimOffVisible) appendDirectedLine(root, P.target, P.aimOff, { color: C.aimOff, width: 2.6, markerEndId: "bdp-top-aim", fromGap: 10, toGap: 9 });
  root.append(svgNode("path", {
    d: P.rollPath.map((p, index) => `${index ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "),
    fill: "none", stroke: C.rollIn, "stroke-width": 4.5, "stroke-linecap": "round", "stroke-linejoin": "round",
    "marker-end": "url(#bdp-top-roll)",
  }));

  // Dimensions: true Roll-in Range along OA1 → Target; Roll-in Lat. D along the OA1 turn-side axis.
  const rangeOffset = side * ((northUp ? radiusPx : Math.max(radiusPx, Math.abs(P.oa1.x - P.target.x))) + 38);
  appendAlignedDimension(root, {
    // Default: OA1 → Target points up on screen, so the dimension's left normal is +x (right). North-up:
    // `side` was taken from the screen normal above.
    from: P.oa1, to: P.target, offset: rangeOffset, color: C.initialTrack, markerId: "bdp-top-initial",
    title: "Roll-in Range", detail: `${formatNm(pub.rollInRangeNm)} NM`,
    titleSize: SVG_DIAGRAM_STYLE_V0_1.font.dimensionTitlePx * textScale, detailSize: SVG_DIAGRAM_STYLE_V0_1.font.detailPx * textScale,
  });
  // Lat. D: from the Initial track extension (at Long. D) across to Track Point, drawn just forward of
  // Track Point so its extension lines run along the Initial track.
  const forward = unit(P.oa1, P.initialExtension);
  const lateral = unit(P.lateralFoot, P.track);
  const lateralSign = (-lateral.y) * forward.x + lateral.x * forward.y >= 0 ? 1 : -1;
  // Too short to read (e.g. a small Angle-Off): the value stays in Roll-in Information.
  const lateralVisible = Math.hypot(P.track.x - P.lateralFoot.x, P.track.y - P.lateralFoot.y) >= 24;
  // Its label goes through the smart layout below (it sits among the Roll-in stations).
  const lateralDimension = lateralVisible
    ? appendAlignedDimension(root, { from: P.lateralFoot, to: P.track, offset: lateralSign * 30, color: C.initialTrack, markerId: "bdp-top-initial" })
    : null;

  // Stations.
  root.append(svgNode("circle", { cx: P.oa1.x, cy: P.oa1.y, r: 7, fill: "#ffffff", stroke: C.rollIn, "stroke-width": 3, "data-bdp-station": "oa1" }));
  root.append(svgNode("circle", { cx: P.track.x, cy: P.track.y, r: 4.5, fill: "#ffffff", stroke: C.rollIn, "stroke-width": 2, "data-bdp-station": "track-point" }));
  if (aimOffVisible) root.append(svgNode("circle", { cx: P.aimOff.x, cy: P.aimOff.y, r: 5, fill: "#ffffff", stroke: C.aimOff, "stroke-width": 2 }));
  root.append(svgNode("circle", { cx: P.target.x, cy: P.target.y, r: 6, fill: C.target, stroke: "#ffffff", "stroke-width": 2, "data-bdp-station": "target" }));
  root.append(svgNode("line", { x1: P.target.x - 10, y1: P.target.y, x2: P.target.x + 10, y2: P.target.y, stroke: C.target, "stroke-width": 2 }));
  root.append(svgNode("line", { x1: P.target.x, y1: P.target.y - 10, x2: P.target.x, y2: P.target.y + 10, stroke: C.target, "stroke-width": 2 }));

  // North-up map: north arrow at the top left (the Offset Top View's north arrow).
  let northArrowRect = null;
  if (northUp) {
    const size = SVG_DIAGRAM_STYLE_V0_1.font.lineTitlePx * textScale * 1.4;
    const left = 36;
    const top = 18;
    const tipY = top + size + 8;
    const tailY = tipY + size * 2;
    const head = size * 0.45;
    const northArrow = svgNode("g", { "data-top-view-role": "north-arrow" });
    northArrow.append(svgNode("text", { x: left, y: top + size * 0.85, "text-anchor": "middle", "font-size": size, "font-weight": 900, fill: "#243240" }, "N"));
    northArrow.append(svgNode("line", { x1: left, y1: tailY, x2: left, y2: tipY + head, stroke: "#243240", "stroke-width": 3, "stroke-linecap": "round" }));
    northArrow.append(svgNode("polygon", { points: `${left},${tipY} ${left - head * 0.7},${tipY + head * 1.2} ${left + head * 0.7},${tipY + head * 1.2}`, fill: "#243240" }));
    root.append(northArrow);
    northArrowRect = { x: left - size, y: top, w: size * 2, h: tailY - top + 6 };
  }

  // Labels: on their element, or joined to it by a leader (Common smart labels).
  const labels = createSmartLabelLayout(root, { width: WIDTH, height: HEIGHT, labelPad: 8, pathPad: 6, charWidthEm: 0.64 });
  if (northArrowRect) labels.reserveRect(northArrowRect);
  [P.oa1, P.track, P.target].forEach((point) => labels.reservePoint(point, 11));
  if (aimOffVisible) labels.reservePoint(P.aimOff, 9);
  const reserve = (points, pad = 6) => { for (let i = 1; i < points.length; i += 1) labels.reserveSegment(points[i - 1], points[i], pad); };
  reserve([P.ingress, P.oa1]);
  reserve([P.oa1, P.target]);
  reserve([P.track, P.target]);
  reserve(P.rollPath);
  if (lateralDimension) reserve([lateralDimension.a, lateralDimension.b], 4);
  if (aimOffVisible) reserve([P.target, P.aimOff]);
  const titleSize = SVG_DIAGRAM_STYLE_V0_1.font.lineTitlePx * textScale;
  const detailSize = SVG_DIAGRAM_STYLE_V0_1.font.detailPx * textScale;
  const label = (point, text, labelOptions) => labels.append(point, text, {
    background: false,
    movable: options.movableLabels === true,
    fontSize: titleSize,
    detailFontSize: detailSize,
    leaderMarkerId: "bdp-top-leader",
    ...labelOptions,
  });
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const awaySide = (a, b) => {
    // Beside a line, on the side away from the Ground Range circle centre.
    const d = unit(a, b);
    const m = mid(a, b);
    return (-d.y) * (m.x - P.target.x) + d.x * (m.y - P.target.y) >= 0 ? 1 : -1;
  };
  label(P.target, `Angle-Off ${formatDeg(input.angleOffDeg)}°`, {
    labelKey: "angle-off", color: C.frame, fontSize: 17 * textScale,
    candidates: [{ dx: 0, dy: -24, anchor: "middle" }, { dx: 22, dy: -22, anchor: "start" }, { dx: -22, dy: -22, anchor: "end" }, { dx: 0, dy: -52, anchor: "middle" }],
  });
  label(P.target, "Target", {
    labelKey: "target", color: C.frame, fontSize: 12 * textScale,
    candidates: [{ dx: 14, dy: 20, anchor: "start" }, { dx: -14, dy: 20, anchor: "end" }, { dx: 0, dy: 34, anchor: "middle" }, { dx: 24, dy: 42, anchor: "start" }],
  });
  label(mid(P.track, P.target), "MAP", {
    labelKey: "map", color: C.mapText, detail: `${formatNm(groundRangeNm)} NM`,
    candidates: lineCandidates(P.track, P.target, awaySide(P.track, P.target) * -1),
  });
  label(mid(P.oa1, P.target), "Roll-in Lead Angle", {
    labelKey: "lead-angle", color: C.rollInTarget, detail: `${formatDeg(pub.leadAngleDeg)}°`,
    candidates: lineCandidates(P.oa1, P.target, -side),
  });
  label(P.oa1, "Roll-in", {
    labelKey: "roll-in", color: C.rollInText, fontSize: 12 * textScale,
    candidates: [{ dx: 0, dy: 28, anchor: "middle" }, { dx: -14, dy: 24, anchor: "end" }, { dx: 14, dy: 24, anchor: "start" }, { dx: 0, dy: 48, anchor: "middle" }],
  });
  label(P.track, "Track Point", {
    labelKey: "track-point", color: C.rollInText, fontSize: 12 * textScale,
    candidates: [{ dx: 14, dy: -8, anchor: "start" }, { dx: -14, dy: -8, anchor: "end" }, { dx: 14, dy: 20, anchor: "start" }, { dx: -14, dy: 20, anchor: "end" }, { dx: 30, dy: -30, anchor: "start" }, { dx: -30, dy: -30, anchor: "end" }],
  });
  if (aimOffVisible) label(P.aimOff, "Aim-off Point", {
    labelKey: "aim-off", color: C.aimOff, fontSize: 12 * textScale,
    candidates: [{ dx: 12, dy: -8, anchor: "start" }, { dx: -12, dy: -8, anchor: "end" }, { dx: 12, dy: 20, anchor: "start" }, { dx: -12, dy: 20, anchor: "end" }, { dx: 30, dy: -30, anchor: "start" }],
  });
  if (lateralDimension) {
    const dimensionMid = mid(lateralDimension.a, lateralDimension.b);
    const out = unit(P.track, P.initialExtension);
    label(dimensionMid, "Roll-in Lat. D", {
      labelKey: "lateral-distance", color: C.initialTrack, fontSize: SVG_DIAGRAM_STYLE_V0_1.font.dimensionTitlePx * textScale,
      detail: `${formatNm(Math.abs(lateralNm))} NM`,
      candidates: [14, 40, 70].flatMap((distance) => [
        { dx: out.x * distance, dy: out.y * distance + 4, anchor: out.x >= 0 ? "start" : "end" },
        { dx: -out.x * distance, dy: -out.y * distance + 4, anchor: out.x >= 0 ? "end" : "start" },
      ]),
    });
  }
  const initialSpeedText = input.initialSpeedMode === "MACH"
    ? `Mach ${formatMach(input.initialSpeedValue)}`
    : `${formatKt(pub.resolvedInitialSpeedKcas)} KCAS`;
  // North-up: the Initial label also carries the true heading of the Initial → OA1 leg, and the ingress
  // can point any way, so it gets candidates on every side.
  const initialCandidates = [{ dx: 0, dy: 44, anchor: "start" }, { dx: 0, dy: -18, anchor: "start" }, { dx: 0, dy: 64, anchor: "start" }, { dx: 10, dy: 84, anchor: "start" }];
  if (northUp) initialCandidates.push({ dx: -12, dy: 44, anchor: "end" }, { dx: -12, dy: -18, anchor: "end" }, { dx: 16, dy: 5, anchor: "start" }, { dx: -16, dy: 5, anchor: "end" });
  label(P.ingress, "Initial", {
    labelKey: "initial", color: C.initialTrack, fontSize: 15 * textScale, detailFontSize: 12.5 * textScale,
    detail: `${northUp ? `${headingText(Number(options.inHeadingDeg))} · ` : ""}${formatFt(pub.resolvedInitialAltitudeMslFt)} ft MSL · ${initialSpeedText}`,
    candidates: initialCandidates,
  });

  applyTextHalo(root);
  const zoom = applyBdpTopViewZoom(svg, options.zoom ?? 1);
  scopeSvgMarkerIds(svg, options.scope ?? "bdp-top");
  return {
    title,
    orientation: northUp ? "NORTH_UP" : BDP_TOP_VIEW_V0_2.orientation,
    rotationDeg: northUp ? null : (rotationRad * 180) / Math.PI,
    inHeadingDeg: northUp ? Number(options.inHeadingDeg) : null,
    canvas: { width: WIDTH, height: HEIGHT },
    groundRangeCircleCenter: "TARGET",
    rollInRangeNm: pub.rollInRangeNm,
    rollInLateralDistanceNm: Math.abs(lateralNm),
    groundRangeNm,
    screen: { oa1: P.oa1, target: P.target, track: P.track },
    zoom,
  };
}
