import {
  appendDirectedLine,
  createOpenArrowMarker,
  resolveDiagramTextPhysicalScale,
  SVG_DIAGRAM_STYLE_V0_1,
  svgNode,
} from "./common/diagram/svg-primitives-v0.1.mjs";
import { createSmartLabelLayout, installSmartLabelDrag } from "./common/diagram/svg-smart-label-v0.1.mjs";
import { createSvgAutoFitProjection, installSvgViewport } from "./common/diagram/svg-viewport-v0.1.mjs";
import { saveSvgAsPng } from "./common/diagram/svg-png-export-v0.1.mjs";
import { formatNm } from "./common/ui/display-precision-v0.1.mjs";

export const OFFSET_RENDERER_V0_1 = Object.freeze({
  id: "offset-renderer-v0.1",
  version: "0.1.13",
  common: ["svg-primitives-v0.1", "svg-smart-label-v0.1", "svg-viewport-v0.1", "svg-png-export-v0.1"],
});

const WIDTH = 1180;
const HEIGHT = 1440;
const COLORS = Object.freeze({
  run: "#4c5966",
  offset: "#a35d00",
  roll: "#176dac",
  attack: "#087b4c",
  target: "#bd3333",
  reference: "#5b6f82",
  invalid: "#bd3333",
  helper: "#7a8793",
});
// Formation follower track (Top View #2/#3/#4): one distinct violet family so the follower's own
// path reads apart from the element lead's full-colour profile drawn in the same frame.
const FOLLOWER_COLORS = Object.freeze({
  ...COLORS,
  run: "#5e4a8c",
  offset: "#8a3ab9",
  roll: "#5b50c8",
  attack: "#b0307a",
});
const viewports = new WeakMap();
const labelDrags = new WeakMap();
const lastRenderedResults = new WeakMap();

function finitePoint(point) { return point && Number.isFinite(point.x) && Number.isFinite(point.y); }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function mul(a, k) { return { x: a.x * k, y: a.y * k }; }
function len(a) { return Math.hypot(a.x, a.y); }
function fmt(value, digits = 2) { return Number.isFinite(value) ? Number(value).toFixed(digits) : "-"; }
function fmtHeading(value) {
  if (!Number.isFinite(value)) return "-";
  const heading = ((Math.round(value) % 360) + 360) % 360;
  return String(heading).padStart(3, "0") + "°";
}
function labelAnchorForDx(dx) {
  if (dx > 8) return "start";
  if (dx < -8) return "end";
  return "middle";
}
function candidatesAwayFromLine(from, to, distance = 58) {
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
    "stroke-width": options.width ?? 5,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "stroke-dasharray": options.dasharray,
    "marker-end": options.markerEndId ? `url(#${options.markerEndId})` : undefined,
  });
  root.append(node);
  return node;
}
function appendCircle(root, point, radius, fill, stroke = "#fff", strokeWidth = 2) {
  root.append(svgNode("circle", { cx: point.x, cy: point.y, r: radius, fill, stroke, "stroke-width": strokeWidth }));
}
function appendSquare(root, point, size, fill, stroke = "#fff") {
  root.append(svgNode("rect", {
    x: point.x - size / 2,
    y: point.y - size / 2,
    width: size,
    height: size,
    rx: 2,
    ry: 2,
    fill,
    stroke,
    "stroke-width": 2,
  }));
}
// Follower labels share the frame with a fully labelled lead layer, so they get the smart-label
// defaults plus a farther ring before falling back to an overlapping position.
const FOLLOWER_LABEL_CANDIDATES = Object.freeze([
  { dx: 18, dy: -18, anchor: "start" },
  { dx: 18, dy: 32, anchor: "start" },
  { dx: -18, dy: -18, anchor: "end" },
  { dx: -18, dy: 32, anchor: "end" },
  { dx: 0, dy: -38, anchor: "middle" },
  { dx: 0, dy: 48, anchor: "middle" },
  { dx: 38, dy: 7, anchor: "start" },
  { dx: -38, dy: 7, anchor: "end" },
  { dx: 42, dy: -30, anchor: "start" },
  { dx: -42, dy: -30, anchor: "end" },
  { dx: -70, dy: 7, anchor: "end" },
  { dx: 70, dy: 7, anchor: "start" },
  { dx: -64, dy: -56, anchor: "end" },
  { dx: 64, dy: -56, anchor: "start" },
  { dx: -64, dy: 66, anchor: "end" },
  { dx: 64, dy: 66, anchor: "start" },
  { dx: -110, dy: 7, anchor: "end" },
  { dx: 110, dy: 7, anchor: "start" },
  { dx: -90, dy: -96, anchor: "end" },
  { dx: 90, dy: -96, anchor: "start" },
  { dx: -90, dy: 106, anchor: "end" },
  { dx: 90, dy: 106, anchor: "start" },
  { dx: -160, dy: -44, anchor: "end" },
  { dx: 160, dy: -44, anchor: "start" },
  { dx: -160, dy: 54, anchor: "end" },
  { dx: 160, dy: 54, anchor: "start" },
]);

function reservePolyline(layout, points, pad = 7) {
  for (let index = 1; index < points.length; index += 1) layout.reserveSegment(points[index - 1], points[index], pad);
}

export function installOffsetTopViewControls(svg, controls = {}) {
  let viewport = viewports.get(svg);
  if (!viewport) {
    viewport = installSvgViewport(svg, {
      baseViewBox: { x: 0, y: 0, w: WIDTH, h: HEIGHT },
      panOnlyWhenZoomed: true,
      buttonOnlyZoom: true,
      allowPageScrollWhenPanDisabled: true,
      maxZoom: 2,
      maxZoomOut: 2,
      onViewBoxChange: (box) => {
        const percent = Math.round(WIDTH / box.w * 100);
        if (controls.sizeResetButton) controls.sizeResetButton.textContent = `${percent}%`;
        if (controls.zoomInButton) controls.zoomInButton.disabled = percent >= 200;
        if (controls.zoomOutButton) controls.zoomOutButton.disabled = percent <= 50;
      },
      resetButton: controls.resetButton,
    });
    viewports.set(svg, viewport);
    const stepSize = (delta) => {
      const current = WIDTH / viewport.getViewBox().w;
      const next = Math.max(0.5, Math.min(2, Math.round((current + delta) * 100) / 100));
      viewport.zoomCenter(current / next);
    };
    controls.zoomInButton?.addEventListener("click", () => stepSize(0.25));
    controls.zoomOutButton?.addEventListener("click", () => stepSize(-0.25));
    controls.sizeResetButton?.addEventListener("click", () => viewport.reset());
  }
  if (!labelDrags.has(svg)) {
    const labelDrag = installSmartLabelDrag(svg);
    labelDrags.set(svg, labelDrag);
  }
  return viewport;
}

export function renderOffsetTopView(svg, result, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  const textScale = Number.isFinite(Number(options.textScale)) ? Number(options.textScale) : 1;
  const fontScale = resolveDiagramTextPhysicalScale(textScale, options.viewportWidth);
  const plotGroupId = typeof options.plotGroupId === "string" && options.plotGroupId ? options.plotGroupId : "offset-plot";
  const root = svg.querySelector(`#${plotGroupId}`) ?? svg.appendChild(svgNode("g", { id: plotGroupId }));
  root.replaceChildren();
  const viewport = viewports.get(svg);
  const geometryChanged = lastRenderedResults.get(svg) !== result;
  if (geometryChanged) viewport?.autoFit();
  else viewport?.ensureBaseWhenUnadjusted();
  lastRenderedResults.set(svg, result);

  const geometry = result.geometry;
  const points = geometry.points;
  const referenceWorldPoint = result.reference?.point;
  // Formation composition: when a Flight follower's Top View is rendered in the same shared
  // frame as another aircraft's (see controller-v0.1.mjs's renderFollowerTopView), both calls
  // pass the other aircraft's world points here so a single shared auto-fit projection covers
  // both — otherwise each call would compute its own scale and the two renders would not align.
  // This affects only the fit; it draws nothing by itself.
  const extraFitPoints = Array.isArray(options.extraFitPoints) ? options.extraFitPoints.filter(finitePoint) : [];
  const allWorldPoints = [
    points.target,
    points.ip,
    points.vip,
    points.vrp,
    points.realActionPoint,
    points.turnEnd,
    points.offsetCenter,
    points.rollStart,
    points.trackPoint,
    points.rollCenter,
    referenceWorldPoint,
    ...geometry.rollInTrajectorySamples,
    ...extraFitPoints,
  ].filter(finitePoint);
  const fit = createSvgAutoFitProjection(allWorldPoints, {
    width: WIDTH,
    height: HEIGHT,
    margins: 48,
    minSpan: 0.5,
    flipY: true,
  });
  const project = fit.project;
  svg.dataset.autoFitAxis = Math.abs(fit.usedWidth - fit.usableWidth) <= Math.abs(fit.usedHeight - fit.usableHeight) ? "width" : "height";
  svg.dataset.autoFitScale = String(fit.scale);

  const p = Object.fromEntries(Object.entries(points).map(([key, point]) => [key, finitePoint(point) ? project(point) : null]));
  const referencePoint = finitePoint(referenceWorldPoint) ? project(referenceWorldPoint) : null;
  const rollPath = geometry.rollInTrajectorySamples.map(project);
  const offsetArc = sampleArc(points.offsetCenter, points.realActionPoint, points.turnEnd, geometry.direction.offsetDirection).map(project);
  const approachRangeNm = result.resolved.approachRangeNm;
  const approachInvalid = approachRangeNm < 0;
  const advanced = options.advanced === true;
  // Formation follower layer (see renderFollowerTopView in controller-v0.1.mjs).
  const follower = options.palette === "follower";
  const C = follower ? FOLLOWER_COLORS : COLORS;
  const tag = typeof options.aircraftTag === "string" && options.aircraftTag ? `${options.aircraftTag} ` : "";
  const markerSuffix = follower ? `-${plotGroupId}` : "";
  const markerId = (name) => `offset-arrow-${name}${markerSuffix}`;

  // Formation composition (see renderFollowerTopView in controller-v0.1.mjs): two calls share one
  // svg to render two aircraft in the same frame. The second call must not paint over the first,
  // since SVG paints in document order regardless of which <g> a shape belongs to.
  if (options.paintBackground !== false) root.append(svgNode("rect", { x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: "#fff" }));

  const defs = svg.querySelector("defs") ?? svg.insertBefore(svgNode("defs"), svg.firstChild);
  const markers = [
    createOpenArrowMarker(markerId("run"), C.run),
    createOpenArrowMarker(markerId("offset"), C.offset),
    createOpenArrowMarker(markerId("roll"), C.roll),
    createOpenArrowMarker(markerId("attack"), C.attack),
    createOpenArrowMarker("offset-arrow-label", COLORS.helper, SVG_DIAGRAM_STYLE_V0_1.arrow.leader),
  ];
  // A layered (paintBackground:false) call keeps the markers the first layer already defined.
  if (options.paintBackground !== false) defs.replaceChildren(...markers);
  else markers.forEach((marker) => { defs.querySelector(`[id="${marker.id}"]`)?.remove(); defs.append(marker); });

  if (len(sub(points.realActionPoint, points.ip)) > 0.001) {
    appendDirectedLine(root, p.ip, p.realActionPoint, {
      color: C.run,
      width: 5,
      markerEndId: markerId("run"),
      fromGap: 13,
      toGap: 8,
    });
  }
  // Target-referenced Action Range guide; a follower's Action Range is IP-referenced instead.
  if (!follower) appendDirectedLine(root, p.realActionPoint, p.target, { color: "#b1bbc4", width: 1.4, dasharray: "7 6" });
  appendPolyline(root, offsetArc, { color: C.offset, width: 6 });
  appendDirectedLine(root, offsetArc[18], offsetArc[25], { color: C.offset, width: 3, markerEndId: markerId("offset") });
  appendDirectedLine(root, p.turnEnd, p.rollStart, {
    color: approachInvalid ? C.invalid : C.offset,
    width: approachInvalid ? 3 : 5,
    dasharray: approachInvalid ? "7 6" : undefined,
  });
  appendPolyline(root, rollPath, { color: C.roll, width: 6 });
  if (rollPath.length > 4) {
    const middle = Math.floor(rollPath.length / 2);
    appendDirectedLine(root, rollPath[Math.max(0, middle - 2)], rollPath[middle], { color: C.roll, width: 3, markerEndId: markerId("roll") });
  }
  appendDirectedLine(root, p.trackPoint, p.target, {
    color: C.attack,
    width: 6,
    markerEndId: markerId("attack"),
    fromGap: 6,
    toGap: 15,
  });

  // Turn construction guides (both the Offset turn and the Roll-in turn centres) are
  // Advanced-only; Essential view shows only the flown path.
  if (advanced) {
    appendDirectedLine(root, p.realActionPoint, p.offsetCenter, { color: C.offset, width: 1.2, dasharray: "4 4" });
    appendDirectedLine(root, p.turnEnd, p.offsetCenter, { color: C.offset, width: 1.2, dasharray: "4 4" });
  }
  if (advanced && p.rollCenter) {
    appendDirectedLine(root, p.rollStart, p.rollCenter, { color: C.roll, width: 1.2, dasharray: "4 4" });
    appendDirectedLine(root, p.trackPoint, p.rollCenter, { color: C.roll, width: 1.2, dasharray: "4 4" });
    appendCircle(root, p.rollCenter, 2.5, "#fff", C.roll);
    root.append(svgNode("circle", {
      cx: p.rollCenter.x, cy: p.rollCenter.y,
      r: len(sub(p.rollStart, p.rollCenter)), fill: "none", stroke: C.roll,
      "stroke-width": 1, "stroke-dasharray": "5 7", opacity: 0.55,
    }));
  }

  appendSquare(root, p.ip, 24, C.run, "#fff");
  if (referencePoint) appendCircle(root, referencePoint, 10, "none", C.reference, 3);
  appendCircle(root, p.realActionPoint, 7, C.offset);
  appendCircle(root, p.rollStart, 6, C.roll);
  appendCircle(root, p.trackPoint, 5, C.roll);
  // The Target is shared by the whole Flight; the lead layer already marks it.
  if (!follower) appendCircle(root, p.target, 14, COLORS.target);

  const labels = createSmartLabelLayout(root, { width: WIDTH, height: HEIGHT, labelPad: 10, pathPad: 7 });
  const labelFontSize = SVG_DIAGRAM_STYLE_V0_1.font.lineTitlePx * fontScale;
  svg.dataset.topViewTextScale = String(textScale);
  svg.dataset.topViewPhysicalFontScale = String(fontScale);
  // A layered call avoids the labels and paths another layer already placed in this svg.
  const avoid = options.labelObstacles ?? {};
  (avoid.rects ?? []).forEach((rect) => labels.reserveRect(rect));
  (avoid.segments ?? []).forEach((segment) => labels.reserveSegment(segment.from, segment.to, segment.pad));
  // ... and the first layer keeps its labels off the other layer's world-space paths.
  (Array.isArray(options.obstacleWorldPolylines) ? options.obstacleWorldPolylines : []).forEach((line) => {
    const projected = (Array.isArray(line) ? line : []).filter(finitePoint).map(project);
    if (projected.length > 1) reservePolyline(labels, projected);
  });
  const appendLabel = (point, rawText, labelOptions = {}) => {
    if (!point) return null;
    const { textAttributes = {}, ...rest } = labelOptions;
    const text = `${tag}${rawText}`;
    const display = text.length > 23 && text.includes(" · ") ? text.replace(" · ", "\n") : text;
    return labels.append(point, display, {
      background: false,
      ...rest,
      labelKey: follower && rest.labelKey ? `${plotGroupId}-${rest.labelKey}` : rest.labelKey,
      candidates: rest.candidates ?? (follower ? FOLLOWER_LABEL_CANDIDATES : undefined),
      fontSize: labelFontSize,
      textAttributes: {
        ...textAttributes,
        "data-top-view-label": "true",
        "data-top-view-font-size": String(labelFontSize),
      },
    });
  };

  [p.ip, p.realActionPoint, p.rollStart, p.trackPoint].filter(Boolean).forEach((point) => labels.reservePoint(point, 14));
  if (referencePoint) labels.reservePoint(referencePoint, 15);
  labels.reservePoint(p.target, 30);
  reservePolyline(labels, [p.ip, p.realActionPoint]);
  if (!follower) reservePolyline(labels, [p.realActionPoint, p.target], 4);
  reservePolyline(labels, offsetArc);
  reservePolyline(labels, [p.turnEnd, p.rollStart]);
  reservePolyline(labels, rollPath);
  reservePolyline(labels, [p.trackPoint, p.target], 9);
  if (advanced) {
    reservePolyline(labels, [p.realActionPoint, p.offsetCenter], 4);
    reservePolyline(labels, [p.turnEnd, p.offsetCenter], 4);
  }
  if (advanced && p.rollCenter) {
    reservePolyline(labels, [p.rollStart, p.rollCenter], 4);
    reservePolyline(labels, [p.trackPoint, p.rollCenter], 4);
  }

  if (!follower) appendLabel(p.target, "Target", {
    labelKey: "target",
    color: COLORS.target,
    leaderMarkerId: "offset-arrow-label",
    candidates: candidatesAwayFromLine(p.trackPoint, p.target),
    textAttributes: { "data-top-view-role": "target" },
  });

  // Read straight-line distance from the points themselves (not a named result field): this
  // stays correct whether IP sits on the Target-through Run-In axis (single-aircraft results,
  // where it also equals resolved.ipRangeNm exactly) or off that axis (Formation composition
  // results from offset-formation-geometry-v0.1.mjs, which has no ipRangeNm field at all).
  appendLabel(p.ip, `IP · ${formatNm(len(points.ip))} NM`, {
    labelKey: "ip",
    color: C.run,
    leader: false,
    leaderMarkerId: "offset-arrow-label",
    textAttributes: { "data-result-key": "ipRangeNm", "data-top-view-role": "ip" },
  });

  if (referencePoint) {
    appendLabel(referencePoint, `${result.referenceMode} · ${formatNm(result.reference.displayRangeNm)} NM`, {
      labelKey: `reference-${String(result.referenceMode).toLowerCase()}`,
      color: C.reference,
      leaderMarkerId: "offset-arrow-label",
      textAttributes: { "data-result-key": "referenceSummary", "data-top-view-role": "reference" },
    });
  }

  appendLabel(p.realActionPoint, "Action Point", {
    labelKey: "action-point",
    color: C.offset,
    leaderMarkerId: "offset-arrow-label",
  });

  if (follower) {
    // A follower's Run-In is parallel to the lead's (already labelled); its Action Range is
    // measured along that line from its own IP, so it is labelled on the Run-In segment
    // (omitted when the Action Point sits on IP, like the lead's own zero-length Run-In).
    const runMid = project(add(points.ip, mul(sub(points.realActionPoint, points.ip), 0.5)));
    if (len(sub(points.realActionPoint, points.ip)) > 0.05) appendLabel(runMid, `Action Range · ${formatNm(result.resolved.actionRangeFromIpNm)} NM`, {
      labelKey: "action-range",
      color: C.run,
      leaderMarkerId: "offset-arrow-label",
      textAttributes: { "data-result-key": "actionRangeFromIpNm" },
    });
  } else {
    const actionRangeMid = project(add(points.realActionPoint, mul(sub(points.target, points.realActionPoint), 0.5)));
    appendLabel(actionRangeMid, `Action Range · ${formatNm(len(points.realActionPoint))} NM`, {
      labelKey: "action-range",
      color: C.offset,
      leaderMarkerId: "offset-arrow-label",
      textAttributes: { "data-result-key": "actionRangeNm" },
    });
  }

  if (!follower && len(sub(points.realActionPoint, points.ip)) > 0.05) {
    const runMid = project(add(points.ip, mul(sub(points.realActionPoint, points.ip), 0.5)));
    appendLabel(runMid, `Run-in · ${fmtHeading(geometry.runInHeadingDeg)}`, {
      labelKey: "run-in",
      color: C.run,
      leaderMarkerId: "offset-arrow-label",
      textAttributes: { "data-result-key": "runInHeadingDeg" },
    });
  }

  const offsetArcMid = offsetArc[Math.floor(offsetArc.length / 2)];
  appendLabel(offsetArcMid, `Offset Angle · ${fmt(geometry.offsetAngleDeg, 0)}°`, {
    labelKey: "offset-angle",
    color: C.offset,
    leaderMarkerId: "offset-arrow-label",
    textAttributes: { "data-result-key": "offsetAngleDeg" },
  });

  const approachHeadingAnchor = project(add(points.turnEnd, mul(sub(points.rollStart, points.turnEnd), 0.36)));
  appendLabel(approachHeadingAnchor, `Approaching Heading · ${fmtHeading(geometry.offsetHeadingDeg)}`, {
    labelKey: "offset-heading",
    color: approachInvalid ? C.invalid : C.offset,
    leaderMarkerId: "offset-arrow-label",
    textAttributes: { "data-result-key": "offsetHeadingDeg" },
  });

  const approachRangeAnchor = project(add(points.turnEnd, mul(sub(points.rollStart, points.turnEnd), 0.72)));
  appendLabel(approachRangeAnchor, `Approach Range · ${formatNm(approachRangeNm)} NM`, {
    labelKey: "approach-range",
    color: approachInvalid ? C.invalid : C.offset,
    leaderMarkerId: "offset-arrow-label",
    textAttributes: { "data-result-key": "approachRangeNm" },
  });

  // Follower Essential view keeps its own Roll-in / Track Point as marked points only (labels in
  // Advanced) and drops an Attack Heading label identical to the lead's.
  const followerDetail = !follower || advanced;
  if (followerDetail) appendLabel(p.rollStart, "Roll-in", {
    labelKey: "roll-in",
    color: C.roll,
    leaderMarkerId: "offset-arrow-label",
  });
  if (followerDetail) appendLabel(p.trackPoint, "Track Point", {
    labelKey: "track-point",
    color: C.roll,
    leaderMarkerId: "offset-arrow-label",
  });

  const attackMid = project(add(points.trackPoint, mul(sub(points.target, points.trackPoint), 0.5)));
  const sameAttackAsLead = follower && fmtHeading(geometry.attackHeadingDeg) === fmtHeading(options.leadAttackHeadingDeg);
  if (followerDetail || !sameAttackAsLead) appendLabel(attackMid, `Attack Heading · ${fmtHeading(geometry.attackHeadingDeg)}`, {
    labelKey: "attack",
    color: C.attack,
    leaderMarkerId: "offset-arrow-label",
  });

  if (advanced) {
    const offsetRadiusMid = project(add(points.offsetCenter, mul(sub(points.realActionPoint, points.offsetCenter), 0.5)));
    appendLabel(offsetRadiusMid, `Offset R · ${formatNm(result.resolved.offsetRadiusNm)} NM`, {
    labelKey: "offset-radius",
    color: C.offset,
    leaderMarkerId: "offset-arrow-label",
    textAttributes: { "data-result-key": "offsetRadiusNm" },
  });

  if (p.rollCenter) {
    const rollRadiusMid = project(add(points.rollCenter, mul(sub(points.rollStart, points.rollCenter), 0.5)));
    appendLabel(rollRadiusMid, `Radius (EFF) · ${formatNm(geometry.rollInRadiusNm)} NM`, {
      labelKey: "roll-radius",
      color: C.roll,
      leaderMarkerId: "offset-arrow-label",
      textAttributes: { "data-result-key": "rollInRadiusNm" },
    });
  }
  }

  labelDrags.get(svg)?.applyStoredPositions();
  return { labelRects: labels.labels.slice(), segments: labels.obstacleSegments.slice() };
}

export function exportOffsetTopView(svg, filename = "offset-bombing-v2-top-view.png") {
  return saveSvgAsPng(svg, filename, { scale: 2, background: "#ffffff" });
}
