import {
  appendDirectedLine,
  applyTextHalo,
  createOpenArrowMarker,
  resolveDiagramTextPhysicalScale,
  scopeSvgMarkerIds,
  SVG_DIAGRAM_COLORS_V0_1,
  SVG_DIAGRAM_STYLE_V0_1,
  svgNode,
} from "../../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { createSmartLabelLayout } from "../../../../common/diagram/svg-smart-label-v0.1.mjs?v=0.1.5";
import { createSvgAutoCanvas } from "../../../../common/diagram/svg-viewport-v0.1.mjs?v=0.1.5";
import { formatDeg, formatNm } from "../../../../common/ui/display-precision-v0.1.mjs";
import { offsetTimeline } from "./offset-time-path-v0.1.mjs";
import { rollInAngleRangeText } from "../../bomb-delivery-planner/view/bdp-view-style-v0.1.mjs";
import { formatHeadingDeg, OFFSET_PALETTE_COLORS, OFFSET_VIEW_COLORS, offsetTopViewLegend, offsetViewTitle } from "./offset-view-style-v0.1.mjs?v=0.1.3";

// Offset Top View — Offset-owned view in the V2 unified view grammar (common/diagram/SPEC.md;
// AG Offset SPEC owns the content; Offset FE SPEC "Top View").
// - Self-contained: fills an empty <svg>; every stroke, fill and text halo is an attribute.
// - 900-unit canvas, height fitted to the plot (Common createSvgAutoCanvas).
// - Two-line labels (title + value) placed by Common smart labels; a label placed away from its
//   element gets a leader line to it, and long-press moves it (Common, installed by the FE).
// - IP Bottom (upHeadingDeg = Run-In heading) or north-up with a north arrow.
// - BDP-derived segments use the BDP colours (Roll-in, Track Point → Target, Target, and the
//   approach leg, which is the BDP's Initial track); pattern segments use Offset colours.
// A Flight Top View draws two layers into one frame (offset-flight-top-view-v0.1.mjs) through
// createOffsetTopViewFrame / drawOffsetTopViewLayer.

export const OFFSET_TOP_VIEW_V0_1 = Object.freeze({
  id: "offset-top-view-v0.1",
  // 0.1.1 (2026-10-02): options.timeSec — the Time dial overlay (path flown up to T, aircraft and
  // velocity vector, the bomb after Release; offset-time-path-v0.1.mjs). The rest of the drawing fades.
  // 0.1.2 (2026-10-03, user feedback "화살표가 두개야"): one arrow per aircraft — the triangle at the head
  // of the flown path; the fixed-length velocity vector, which only repeated its direction, is removed.
  // 0.1.3 (2026-10-03, user): Roll-in label detail "NN°/N.NNM" (Roll-in Angle Off / Roll-in Range);
  // the VRP/VIP marker is drawn only in Advanced and only when it is not at the Action Point (0.002 NM).
  // 0.1.4 (2026-10-03, user answers): the mid-guide Action Range label stays (Action Point label
  // unchanged); followers show Roll-in with its note in Essential too.
  // 0.1.5 (2026-10-05): palette "companion" (label-less aircraft in a Flight view).
  // 0.1.6 (2026-10-05, user: one Top View with #1–#4 buttons): palette "fourth" (#4); options.role
  // ("lead" | "follower") decides the drawing rules apart from the palette, so any aircraft can be the
  // base layer (Target marker, full label set) in its own colours.
  version: "0.1.6",
  subject: "Offset",
  view: "Top View",
  canvas: Object.freeze({ width: 900, minHeight: 560, maxHeight: 1100, margins: 40 }),
  replaces: "apps/bombing-calculator-v2/offset/renderer-v0.1.mjs 0.1.19",
});

export const offsetTopViewTitle = (options) => offsetViewTitle("Top View", options);
export { offsetTopViewLegend };

const REFERENCE_AT_ACTION_POINT_NM = 0.002;

function finitePoint(point) { return point && Number.isFinite(point.x) && Number.isFinite(point.y); }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function mul(a, k) { return { x: a.x * k, y: a.y * k }; }
function len(a) { return Math.hypot(a.x, a.y); }

// View rotation about Target (the world origin): the heading `upHeadingDeg` is drawn pointing up.
function worldRotation(upHeadingDeg) {
  const rad = (upHeadingDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  if (Math.abs(sin) < 1e-12 && cos > 0) return (point) => point;
  return (point) => ({ x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos });
}

function labelAnchorForDx(dx) {
  if (dx > 8) return "start";
  if (dx < -8) return "end";
  return "middle";
}
function candidatesAwayFromLine(from, to, distance = 46) {
  const vector = sub(to, from);
  const magnitude = len(vector) || 1;
  const forward = { x: vector.x / magnitude, y: vector.y / magnitude };
  const normal = { x: -forward.y, y: forward.x };
  const candidate = (direction, scale = 1) => {
    const dx = direction.x * distance * scale;
    const dy = direction.y * distance * scale;
    return { dx, dy, anchor: labelAnchorForDx(dx) };
  };
  return [
    candidate(forward, 1.05),
    candidate(normal),
    candidate(mul(normal, -1)),
    candidate(forward, 1.35),
    candidate(add(forward, normal), 0.85),
    candidate(add(forward, mul(normal, -1)), 0.85),
  ];
}

function sampleArc(center, start, end, turnDirection, steps = 48) {
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  let endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  const direction = turnDirection === "LEFT" ? 1 : -1;
  if (direction > 0) while (endAngle <= startAngle) endAngle += Math.PI * 2;
  else while (endAngle >= startAngle) endAngle -= Math.PI * 2;
  const radius = len(sub(start, center));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const fraction = index / steps;
    const angle = startAngle + (endAngle - startAngle) * fraction;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
}

function appendPolyline(root, points, options = {}) {
  const node = svgNode("polyline", {
    points: points.map((point) => `${point.x},${point.y}`).join(" "),
    fill: "none",
    stroke: options.color,
    "stroke-width": options.width ?? 4,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "stroke-dasharray": options.dasharray,
    "marker-end": options.markerEndId ? `url(#${options.markerEndId})` : undefined,
  });
  root.append(node);
  return node;
}
function appendCircle(root, point, radius, fill, stroke, strokeWidth, extra = {}) {
  root.append(svgNode("circle", { cx: point.x, cy: point.y, r: radius, fill, stroke, "stroke-width": strokeWidth, ...extra }));
}

// Follower labels share the frame with a fully labelled lead layer, so they get the smart-label
// defaults plus a farther ring before falling back to an overlapping position.
const FOLLOWER_LABEL_CANDIDATES = Object.freeze([
  { dx: 16, dy: -16, anchor: "start" }, { dx: 16, dy: 30, anchor: "start" },
  { dx: -16, dy: -16, anchor: "end" }, { dx: -16, dy: 30, anchor: "end" },
  { dx: 0, dy: -34, anchor: "middle" }, { dx: 0, dy: 44, anchor: "middle" },
  { dx: 34, dy: 6, anchor: "start" }, { dx: -34, dy: 6, anchor: "end" },
  { dx: 38, dy: -28, anchor: "start" }, { dx: -38, dy: -28, anchor: "end" },
  { dx: -62, dy: 6, anchor: "end" }, { dx: 62, dy: 6, anchor: "start" },
  { dx: -58, dy: -50, anchor: "end" }, { dx: 58, dy: -50, anchor: "start" },
  { dx: -58, dy: 60, anchor: "end" }, { dx: 58, dy: 60, anchor: "start" },
  { dx: -98, dy: 6, anchor: "end" }, { dx: 98, dy: 6, anchor: "start" },
  { dx: -80, dy: -86, anchor: "end" }, { dx: 80, dy: -86, anchor: "start" },
  { dx: -80, dy: 96, anchor: "end" }, { dx: 80, dy: 96, anchor: "start" },
  { dx: -140, dy: -40, anchor: "end" }, { dx: 140, dy: -40, anchor: "start" },
  { dx: -140, dy: 50, anchor: "end" }, { dx: 140, dy: 50, anchor: "start" },
]);

// World points a layer draws. Only the active reference point (VRP or VIP, per result.reference)
// is included: the inactive one is not drawn, and fitting it would squeeze the plot.
export function offsetTopViewWorldPoints(result) {
  const geometry = result.geometry;
  const points = geometry.points;
  return [
    points.target, points.ip, points.realActionPoint, points.turnEnd, points.offsetCenter,
    points.rollStart, points.trackPoint, points.rollCenter, result.reference?.point,
    ...geometry.rollInTrajectorySamples,
  ].filter(finitePoint);
}

// One canvas for one or more layers: rotation, fit, background, north arrow and text sizes.
export function createOffsetTopViewFrame(svg, worldPoints, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  const { width, minHeight, maxHeight, margins } = OFFSET_TOP_VIEW_V0_1.canvas;
  const upHeadingDeg = Number.isFinite(Number(options.upHeadingDeg)) ? Number(options.upHeadingDeg) : 0;
  const rotate = worldRotation(upHeadingDeg);
  const fit = createSvgAutoCanvas(worldPoints.filter(finitePoint).map(rotate), {
    width, minHeight, maxHeight, margins, minSpan: 0.5, flipY: true,
  });
  const height = fit.height;
  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.aspectRatio = `${width} / ${height}`;
  svg.dataset.canvasHeight = String(height);
  svg.dataset.autoFitAxis = Math.abs(fit.usedWidth - fit.usableWidth) <= Math.abs(fit.usedHeight - fit.usableHeight) ? "width" : "height";
  svg.dataset.autoFitScale = String(fit.scale);
  if (options.title) svg.setAttribute("aria-label", options.title);

  // Text: the Common Text percentage at the same physical size as on the former 1180 canvas.
  const textScale = Number.isFinite(Number(options.textScale)) ? Number(options.textScale) : 1;
  const fontScale = resolveDiagramTextPhysicalScale(textScale, options.viewportWidth, { canvasWidth: width });
  svg.dataset.topViewTextScale = String(textScale);
  svg.dataset.topViewPhysicalFontScale = String(fontScale);

  const defs = svgNode("defs");
  const root = svgNode("g", { "data-view": OFFSET_TOP_VIEW_V0_1.id });
  svg.append(defs, root);
  root.append(svgNode("rect", { x: 0, y: 0, width, height, fill: SVG_DIAGRAM_COLORS_V0_1.background }));
  defs.append(createOpenArrowMarker("offset-arrow-label", SVG_DIAGRAM_COLORS_V0_1.helper, SVG_DIAGRAM_STYLE_V0_1.arrow.leader));

  const frame = {
    svg, defs, root, width, height, rotate,
    // project: world point → screen; projectRotated: an already rotated point → screen.
    project: (point) => fit.project(rotate(point)),
    projectRotated: fit.project,
    scale: fit.scale,
    titleSize: SVG_DIAGRAM_STYLE_V0_1.font.lineTitlePx * fontScale,
    detailSize: SVG_DIAGRAM_STYLE_V0_1.font.detailPx * fontScale,
    fontScale,
    obstacles: { segments: [], points: [], rects: [] },
    placedLabels: [],
  };

  // North arrow (north-up view only): top-left, arrow twice the title size pointing north with "N".
  if (options.northArrow === true) {
    const size = frame.titleSize;
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
    frame.obstacles.rects.push({ x: left - size, y: top, w: size * 2, h: tailY - top + 6 });
  }
  return frame;
}

// Draws one aircraft's paths and stations into its own group and registers them as label
// obstacles; returns placeLabels(), called once every layer's paths are known.
export function drawOffsetTopViewLayer(frame, result, options = {}) {
  const groupId = typeof options.groupId === "string" && options.groupId ? options.groupId : "offset-plot";
  const group = svgNode("g", { id: groupId });
  frame.root.append(group);
  const geometry = result.geometry;
  // A companion layer (Flight view, user 2026-10-05) follows the follower rules in its own palette;
  // its host never calls placeLabels(), so it shows paths and stations only.
  const C = OFFSET_PALETTE_COLORS[options.palette] ?? OFFSET_VIEW_COLORS;
  const follower = options.role ? options.role === "follower" : C !== OFFSET_VIEW_COLORS;
  const tag = typeof options.aircraftTag === "string" && options.aircraftTag ? `${options.aircraftTag} ` : "";
  const advanced = options.advanced === true;
  const markerId = (name) => `offset-arrow-${name}-${groupId}`;
  ["run", "offset", "approach", "roll", "attack"].forEach((name) => frame.defs.append(createOpenArrowMarker(markerId(name), C[name])));

  // Rotated world points (view frame) for the turn arc; screen points for drawing.
  const points = Object.fromEntries(Object.entries(geometry.points).map(([key, point]) => [key, finitePoint(point) ? frame.rotate(point) : point]));
  const project = frame.projectRotated;
  const p = Object.fromEntries(Object.entries(points).map(([key, point]) => [key, finitePoint(point) ? project(point) : null]));
  // VRP / VIP: Advanced only, and only when it is not the Action Point (Offset SPEC tolerance).
  const referenceWorld = result.reference?.point;
  const referenceApart = finitePoint(referenceWorld) && len(sub(referenceWorld, geometry.points.realActionPoint)) > REFERENCE_AT_ACTION_POINT_NM;
  const referencePoint = options.advanced === true && referenceApart ? frame.project(referenceWorld) : null;
  const rollPath = geometry.rollInTrajectorySamples.filter(finitePoint).map((point) => frame.project(point));
  const offsetArc = sampleArc(points.offsetCenter, points.realActionPoint, points.turnEnd, geometry.direction.offsetDirection).map(project);
  const approachRangeNm = result.resolved.approachRangeNm;
  const approachInvalid = approachRangeNm < 0;

  // Paths.
  if (len(sub(points.realActionPoint, points.ip)) > 0.001) {
    appendDirectedLine(group, p.ip, p.realActionPoint, { color: C.run, width: 4, markerEndId: markerId("run"), fromGap: 12, toGap: 9 });
  }
  // Target-referenced Action Range guide (a follower's Action Range is Target-referenced too).
  appendDirectedLine(group, p.realActionPoint, p.target, { color: C.guide, width: 1.4, dasharray: "7 6" });
  appendPolyline(group, offsetArc, { color: C.offset, width: 4.5 });
  appendDirectedLine(group, offsetArc[18], offsetArc[25], { color: C.offset, width: 2.6, markerEndId: markerId("offset") });
  appendDirectedLine(group, p.turnEnd, p.rollStart, {
    color: approachInvalid ? C.invalid : C.approach,
    width: approachInvalid ? 2.6 : 3.8,
    dasharray: approachInvalid ? "7 6" : undefined,
    toGap: 9,
  });
  appendPolyline(group, rollPath, { color: C.roll, width: 4.5 });
  if (rollPath.length > 4) {
    const middle = Math.floor(rollPath.length / 2);
    appendDirectedLine(group, rollPath[Math.max(0, middle - 2)], rollPath[middle], { color: C.roll, width: 2.6, markerEndId: markerId("roll") });
  }
  appendDirectedLine(group, p.trackPoint, p.target, { color: C.attack, width: 4.2, markerEndId: markerId("attack"), fromGap: 6, toGap: 12 });

  // Turn construction guides are Advanced-only; Essential shows only the flown path.
  if (advanced) {
    appendDirectedLine(group, p.realActionPoint, p.offsetCenter, { color: C.offset, width: 1.2, dasharray: "4 4" });
    appendDirectedLine(group, p.turnEnd, p.offsetCenter, { color: C.offset, width: 1.2, dasharray: "4 4" });
  }
  if (advanced && p.rollCenter) {
    appendDirectedLine(group, p.rollStart, p.rollCenter, { color: C.roll, width: 1.2, dasharray: "4 4" });
    appendDirectedLine(group, p.trackPoint, p.rollCenter, { color: C.roll, width: 1.2, dasharray: "4 4" });
    appendCircle(group, p.rollCenter, 2.5, "#ffffff", C.roll, 2);
    group.append(svgNode("circle", {
      cx: p.rollCenter.x, cy: p.rollCenter.y, r: len(sub(p.rollStart, p.rollCenter)), fill: "none", stroke: C.roll,
      "stroke-width": 1, "stroke-dasharray": "5 7", opacity: 0.55,
    }));
  }

  // IP limit (follower rule): when the Action Point is below the Flight IP (#1's IP), draw the limit
  // line through that IP across the Run-In so the violation is visible.
  const ipLimit = options.ipLimit;
  let ipLimitPoint = null;
  if (ipLimit?.violated && finitePoint(ipLimit.point) && geometry.vectors?.runVector) {
    const run = geometry.vectors.runVector;
    const normal = { x: -run.y, y: run.x };
    const across = Math.abs((geometry.points.realActionPoint.x - ipLimit.point.x) * normal.x + (geometry.points.realActionPoint.y - ipLimit.point.y) * normal.y);
    const halfLength = across + 1.5;
    const ends = [add(ipLimit.point, mul(normal, -halfLength)), add(ipLimit.point, mul(normal, halfLength))].map((point) => frame.project(point));
    appendPolyline(group, ends, { color: C.invalid, width: 2.5, dasharray: "10 7" }).setAttribute("data-top-view-role", "ip-limit");
    ipLimitPoint = frame.project(ipLimit.point);
  }

  // Stations (drawn after the paths).
  group.append(svgNode("rect", {
    x: p.ip.x - 9, y: p.ip.y - 9, width: 18, height: 18, rx: 2, ry: 2, fill: C.run, stroke: "#ffffff", "stroke-width": 2,
  }));
  if (referencePoint) appendCircle(group, referencePoint, 10, "none", C.reference, 3);
  appendCircle(group, p.realActionPoint, 7, C.offset, "#ffffff", 2);
  appendCircle(group, p.rollStart, 7, "#ffffff", C.roll, 3);
  appendCircle(group, p.trackPoint, 4.5, "#ffffff", C.roll, 2);
  // The Target is shared by the whole Flight; the lead layer marks it (BDP Target marker).
  if (!follower) {
    appendCircle(group, p.target, 6, C.target, "#ffffff", 2, { "data-top-view-role": "target-marker" });
    group.append(svgNode("line", { x1: p.target.x - 10, y1: p.target.y, x2: p.target.x + 10, y2: p.target.y, stroke: C.target, "stroke-width": 2 }));
    group.append(svgNode("line", { x1: p.target.x, y1: p.target.y - 10, x2: p.target.x, y2: p.target.y + 10, stroke: C.target, "stroke-width": 2 }));
  }

  if (Number.isFinite(options.timeSec)) drawTimeOverlay(frame, group, result, options.timeSec, C);

  // Label obstacles shared by every layer of the frame.
  const obstacles = frame.obstacles;
  [p.ip, p.realActionPoint, p.rollStart, p.trackPoint].filter(Boolean).forEach((point) => obstacles.points.push({ point, radius: 13 }));
  if (referencePoint) obstacles.points.push({ point: referencePoint, radius: 14 });
  obstacles.points.push({ point: p.target, radius: 18 });
  const reserve = (line, pad = 7) => { for (let i = 1; i < line.length; i += 1) obstacles.segments.push({ from: line[i - 1], to: line[i], pad }); };
  reserve([p.ip, p.realActionPoint]);
  if (!follower) reserve([p.realActionPoint, p.target], 4);
  reserve(offsetArc);
  reserve([p.turnEnd, p.rollStart]);
  reserve(rollPath);
  reserve([p.trackPoint, p.target], 9);
  if (advanced) {
    reserve([p.realActionPoint, p.offsetCenter], 4);
    reserve([p.turnEnd, p.offsetCenter], 4);
  }
  if (advanced && p.rollCenter) {
    reserve([p.rollStart, p.rollCenter], 4);
    reserve([p.trackPoint, p.rollCenter], 4);
  }

  function placeLabels() {
    const labels = createSmartLabelLayout(group, { width: frame.width, height: frame.height, labelPad: 9, pathPad: 7, charWidthEm: 0.62 });
    obstacles.points.forEach(({ point, radius }) => labels.reservePoint(point, radius));
    obstacles.segments.forEach(({ from, to, pad }) => labels.reserveSegment(from, to, pad));
    obstacles.rects.forEach((rect) => labels.reserveRect(rect, 6));
    frame.placedLabels.forEach((rect) => labels.reserveRect(rect));
    const appendLabel = (point, title, labelOptions = {}) => {
      if (!point) return null;
      const { textAttributes = {}, key, untagged = false, ...rest } = labelOptions;
      return labels.append(point, `${untagged ? "" : tag}${title}`, {
        background: false,
        leaderMarkerId: "offset-arrow-label",
        ...rest,
        labelKey: follower || tag ? `${groupId}-${key}` : key,
        // Two layers in one frame (Flight view): every label gets the wider candidate ring.
        candidates: rest.candidates ?? (follower || options.crowded ? FOLLOWER_LABEL_CANDIDATES : undefined),
        fontSize: frame.titleSize,
        detailFontSize: frame.detailSize,
        textAttributes: { ...textAttributes, "data-top-view-label": "true", "data-top-view-font-size": String(frame.titleSize) },
      });
    };

    // The Target is the Flight's, so its label carries no aircraft tag.
    if (!follower) appendLabel(p.target, "Target", {
      key: "target", color: C.target, untagged: true,
      candidates: candidatesAwayFromLine(p.trackPoint, p.target),
      textAttributes: { "data-top-view-role": "target" },
    });
    // Straight-line IP distance from the points themselves: correct on and off the Run-In axis.
    appendLabel(p.ip, "IP", {
      key: "ip", color: C.run, leader: false, detail: `${formatNm(len(geometry.points.ip))} NM`,
      textAttributes: { "data-result-key": "ipRangeNm", "data-top-view-role": "ip" },
    });
    if (referencePoint) appendLabel(referencePoint, String(result.referenceMode), {
      key: `reference-${String(result.referenceMode).toLowerCase()}`, color: C.reference,
      detail: `${formatNm(result.reference.displayRangeNm)} NM`,
      textAttributes: { "data-result-key": "referenceSummary", "data-top-view-role": "reference" },
    });
    if (ipLimitPoint) appendLabel(ipLimitPoint, "IP limit", {
      key: "ip-limit", color: C.invalid, textAttributes: { "data-top-view-role": "ip-limit-label" },
    });
    appendLabel(p.realActionPoint, "Action Point", { key: "action-point", color: C.offset });
    // Action Range is Target → Action Point for the lead and followers alike.
    appendLabel(frame.project(add(geometry.points.realActionPoint, mul(sub(geometry.points.target, geometry.points.realActionPoint), 0.5))), "Action Range", {
      key: "action-range", color: C.offset, detail: `${formatNm(len(geometry.points.realActionPoint))} NM`,
      textAttributes: { "data-result-key": "actionRangeNm" },
    });
    if (!follower && len(sub(points.realActionPoint, points.ip)) > 0.05) {
      appendLabel(frame.project(add(geometry.points.ip, mul(sub(geometry.points.realActionPoint, geometry.points.ip), 0.5))), "Run-in", {
        key: "run-in", color: C.run, detail: formatHeadingDeg(geometry.runInHeadingDeg),
        textAttributes: { "data-result-key": "runInHeadingDeg" },
      });
    }
    appendLabel(offsetArc[Math.floor(offsetArc.length / 2)], "Offset Angle", {
      key: "offset-angle", color: C.offset, detail: `${formatDeg(geometry.offsetAngleDeg)}°`,
      textAttributes: { "data-result-key": "offsetAngleDeg" },
    });
    const along = (fraction) => frame.project(add(geometry.points.turnEnd, mul(sub(geometry.points.rollStart, geometry.points.turnEnd), fraction)));
    appendLabel(along(0.36), "Approaching Heading", {
      key: "offset-heading", color: approachInvalid ? C.invalid : C.approach, detail: formatHeadingDeg(geometry.offsetHeadingDeg),
      textAttributes: { "data-result-key": "offsetHeadingDeg" },
    });
    appendLabel(along(0.72), "Approach Range", {
      key: "approach-range", color: approachInvalid ? C.invalid : C.approach, detail: `${formatNm(approachRangeNm)} NM`,
      textAttributes: { "data-result-key": "approachRangeNm" },
    });
    // A follower's Essential view keeps its own Track Point as a marked point only (label in Advanced)
    // and drops an Attack Heading label identical to the lead's.
    const followerDetail = !follower || advanced;
    // Roll-in with its "NN°/N.NNM" note shows for every aircraft (user 2026-10-03).
    appendLabel(p.rollStart, "Roll-in", {
      key: "roll-in", color: C.rollText, detail: rollInAngleRangeText(result.profile?.public),
      textAttributes: { "data-top-view-role": "roll-in" },
    });
    if (followerDetail) appendLabel(p.trackPoint, "Track Point", { key: "track-point", color: C.rollText });
    const sameAttackAsLead = follower && formatHeadingDeg(geometry.attackHeadingDeg) === formatHeadingDeg(options.leadAttackHeadingDeg);
    if (followerDetail || !sameAttackAsLead) {
      appendLabel(frame.project(add(geometry.points.trackPoint, mul(sub(geometry.points.target, geometry.points.trackPoint), 0.5))), "Attack Heading", {
        key: "attack", color: C.attackText, detail: formatHeadingDeg(geometry.attackHeadingDeg),
      });
    }
    if (advanced) {
      appendLabel(frame.project(add(geometry.points.offsetCenter, mul(sub(geometry.points.realActionPoint, geometry.points.offsetCenter), 0.5))), "Offset R", {
        key: "offset-radius", color: C.offset, detail: `${formatNm(result.resolved.offsetRadiusNm)} NM`,
        textAttributes: { "data-result-key": "offsetRadiusNm" },
      });
      if (p.rollCenter) {
        appendLabel(frame.project(add(geometry.points.rollCenter, mul(sub(geometry.points.rollStart, geometry.points.rollCenter), 0.5))), "Radius (EFF)", {
          key: "roll-radius", color: C.rollText, detail: `${formatNm(geometry.rollInRadiusNm)} NM`,
          textAttributes: { "data-result-key": "rollInRadiusNm" },
        });
      }
    }
    frame.placedLabels.push(...labels.labels);
    return labels;
  }

  return { group, placeLabels };
}

// Time dial overlay: everything drawn so far fades, then the path flown up to T (Offset Time path)
// with the aircraft as the one arrowhead at its end (a triangle pointing along its track), and after
// Release the bomb on its way to the Target. Not a label obstacle, so moving the dial never moves a label.
function drawTimeOverlay(frame, group, result, timeSec, C) {
  let state;
  try {
    state = offsetTimeline(result).at(timeSec);
  } catch (_) {
    return;
  }
  [...group.children].forEach((node) => {
    const opacity = Number(node.getAttribute("opacity") ?? 1);
    node.setAttribute("opacity", String(opacity * 0.3));
  });
  const overlay = svgNode("g", { "data-top-view-role": "time-overlay", "data-time-sec": String(state.timeSec), "data-time-phase": state.phase });
  group.append(overlay);
  const flown = state.flown.filter(finitePoint).map((point) => frame.project(point));
  if (flown.length >= 2) appendPolyline(overlay, flown, { color: C.time, width: 5.5 }).setAttribute("data-top-view-role", "time-path");
  if (!finitePoint(state.aircraft)) return;
  const at = frame.project(state.aircraft);
  let direction = null;
  if (state.heading) {
    const ahead = frame.project({ x: state.aircraft.x + state.heading.x * 0.05, y: state.aircraft.y + state.heading.y * 0.05 });
    const magnitude = len(sub(ahead, at));
    if (magnitude > 1e-9) direction = mul(sub(ahead, at), 1 / magnitude);
  }
  if (state.bomb) {
    const bomb = frame.project(state.bomb);
    appendDirectedLine(overlay, at, bomb, { color: C.time, width: 1.6, dasharray: "4 5" });
    appendCircle(overlay, bomb, 5.5, "#243240", "#ffffff", 2, { "data-top-view-role": "time-bomb" });
  }
  if (direction) {
    const normal = { x: -direction.y, y: direction.x };
    const size = 12 * frame.fontScale;
    const nose = add(at, mul(direction, size));
    const left = add(sub(at, mul(direction, size * 0.7)), mul(normal, size * 0.75));
    const right = sub(sub(at, mul(direction, size * 0.7)), mul(normal, size * 0.75));
    overlay.append(svgNode("polygon", {
      points: [nose, left, right].map((point) => `${point.x},${point.y}`).join(" "),
      fill: C.time, stroke: "#ffffff", "stroke-width": 2, "stroke-linejoin": "round", "data-top-view-role": "time-aircraft",
    }));
  } else {
    appendCircle(overlay, at, 8, C.time, "#ffffff", 2, { "data-top-view-role": "time-aircraft" });
  }
}

export function finishOffsetTopViewFrame(frame, { scope = "offset-top" } = {}) {
  applyTextHalo(frame.root);
  scopeSvgMarkerIds(frame.svg, scope);
}

// Self-contained single-aircraft Offset Top View (#1).
export function renderOffsetTopView(svg, result, options = {}) {
  const title = offsetTopViewTitle({ aircraftNumber: options.aircraftNumber ?? 1 });
  const frame = createOffsetTopViewFrame(svg, offsetTopViewWorldPoints(result), { ...options, title });
  drawOffsetTopViewLayer(frame, result, { ...options, groupId: "offset-plot" }).placeLabels();
  finishOffsetTopViewFrame(frame, { scope: options.scope ?? "offset-top" });
  return { title, canvas: { width: frame.width, height: frame.height }, fontScale: frame.fontScale };
}
