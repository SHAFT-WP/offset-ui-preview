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

export const OFFSET_RENDERER_V0_1 = Object.freeze({
  id: "offset-renderer-v0.1",
  version: "0.1.12",
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
  const backgroundGeometry = options.backgroundGeometry ?? null;
  const backgroundWorldPoints = backgroundGeometry
    ? [
        backgroundGeometry.points.target,
        backgroundGeometry.points.ip,
        backgroundGeometry.points.realActionPoint,
        backgroundGeometry.points.turnEnd,
        backgroundGeometry.points.rollStart,
        backgroundGeometry.points.trackPoint,
        ...backgroundGeometry.rollInTrajectorySamples,
      ].filter(finitePoint)
    : [];
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
    ...backgroundWorldPoints,
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

  root.append(svgNode("rect", { x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: "#fff" }));

  // Background profile (element lead) shares this same Target-centered frame and projection, so
  // its Target marker coincides with the follower's own. It is a rendering composition only: the
  // element lead's already-solved geometry is drawn once, dimmed, behind the follower's own track.
  // The current straight-ingress-only geometry model (offset-geometry-v0.2.mjs) cannot place the
  // follower's own IP off that shared Run-In axis, so this does not yet apply a lateral Formation
  // offset to either track.
  if (backgroundGeometry) {
    const bgPoints = backgroundGeometry.points;
    const bp = Object.fromEntries(Object.entries(bgPoints).map(([key, point]) => [key, finitePoint(point) ? project(point) : null]));
    const bgRollPath = backgroundGeometry.rollInTrajectorySamples.map(project);
    const bgColor = "#aab2ba";
    if (bp.ip && bp.realActionPoint) appendDirectedLine(root, bp.ip, bp.realActionPoint, { color: bgColor, width: 4 });
    if (bp.turnEnd && bp.rollStart) appendDirectedLine(root, bp.turnEnd, bp.rollStart, { color: bgColor, width: 4 });
    if (bgRollPath.length > 1) appendPolyline(root, bgRollPath, { color: bgColor, width: 4 });
    if (bp.trackPoint) appendDirectedLine(root, bp.trackPoint, bp.target, { color: bgColor, width: 4 });
    if (bp.ip) appendSquare(root, bp.ip, 20, bgColor, "#fff");
  }

  const defs = svg.querySelector("defs") ?? svg.insertBefore(svgNode("defs"), svg.firstChild);
  defs.replaceChildren(
    createOpenArrowMarker("offset-arrow-run", COLORS.run),
    createOpenArrowMarker("offset-arrow-offset", COLORS.offset),
    createOpenArrowMarker("offset-arrow-roll", COLORS.roll),
    createOpenArrowMarker("offset-arrow-attack", COLORS.attack),
    createOpenArrowMarker("offset-arrow-label", COLORS.helper, SVG_DIAGRAM_STYLE_V0_1.arrow.leader),
  );

  if (len(sub(points.realActionPoint, points.ip)) > 0.001) {
    appendDirectedLine(root, p.ip, p.realActionPoint, {
      color: COLORS.run,
      width: 5,
      markerEndId: "offset-arrow-run",
      fromGap: 13,
      toGap: 8,
    });
  }
  appendDirectedLine(root, p.realActionPoint, p.target, { color: "#b1bbc4", width: 1.4, dasharray: "7 6" });
  appendPolyline(root, offsetArc, { color: COLORS.offset, width: 6 });
  appendDirectedLine(root, offsetArc[18], offsetArc[25], { color: COLORS.offset, width: 3, markerEndId: "offset-arrow-offset" });
  appendDirectedLine(root, p.turnEnd, p.rollStart, {
    color: approachInvalid ? COLORS.invalid : COLORS.offset,
    width: approachInvalid ? 3 : 5,
    dasharray: approachInvalid ? "7 6" : undefined,
  });
  appendPolyline(root, rollPath, { color: COLORS.roll, width: 6 });
  if (rollPath.length > 4) {
    const middle = Math.floor(rollPath.length / 2);
    appendDirectedLine(root, rollPath[Math.max(0, middle - 2)], rollPath[middle], { color: COLORS.roll, width: 3, markerEndId: "offset-arrow-roll" });
  }
  appendDirectedLine(root, p.trackPoint, p.target, {
    color: COLORS.attack,
    width: 6,
    markerEndId: "offset-arrow-attack",
    fromGap: 6,
    toGap: 15,
  });

  appendDirectedLine(root, p.realActionPoint, p.offsetCenter, { color: COLORS.offset, width: 1.2, dasharray: "4 4" });
  appendDirectedLine(root, p.turnEnd, p.offsetCenter, { color: COLORS.offset, width: 1.2, dasharray: "4 4" });
  if (p.rollCenter) {
    appendDirectedLine(root, p.rollStart, p.rollCenter, { color: COLORS.roll, width: 1.2, dasharray: "4 4" });
    appendDirectedLine(root, p.trackPoint, p.rollCenter, { color: COLORS.roll, width: 1.2, dasharray: "4 4" });
    appendCircle(root, p.rollCenter, 2.5, "#fff", COLORS.roll);
    if (advanced) root.append(svgNode("circle", {
      cx: p.rollCenter.x, cy: p.rollCenter.y,
      r: len(sub(p.rollStart, p.rollCenter)), fill: "none", stroke: COLORS.roll,
      "stroke-width": 1, "stroke-dasharray": "5 7", opacity: 0.55,
    }));
  }

  appendSquare(root, p.ip, 24, COLORS.run, "#fff");
  if (referencePoint) appendCircle(root, referencePoint, 10, "none", COLORS.reference, 3);
  appendCircle(root, p.realActionPoint, 7, COLORS.offset);
  appendCircle(root, p.rollStart, 6, COLORS.roll);
  appendCircle(root, p.trackPoint, 5, COLORS.roll);
  appendCircle(root, p.target, 14, COLORS.target);

  const labels = createSmartLabelLayout(root, { width: WIDTH, height: HEIGHT, labelPad: 10, pathPad: 7 });
  const labelFontSize = SVG_DIAGRAM_STYLE_V0_1.font.lineTitlePx * fontScale;
  svg.dataset.topViewTextScale = String(textScale);
  svg.dataset.topViewPhysicalFontScale = String(fontScale);
  const appendLabel = (point, text, labelOptions = {}) => {
    if (!point) return null;
    const { textAttributes = {}, ...rest } = labelOptions;
    const display = text.length > 23 && text.includes(" · ") ? text.replace(" · ", "\n") : text;
    return labels.append(point, display, {
      background: false,
      ...rest,
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
  reservePolyline(labels, [p.realActionPoint, p.target], 4);
  reservePolyline(labels, offsetArc);
  reservePolyline(labels, [p.turnEnd, p.rollStart]);
  reservePolyline(labels, rollPath);
  reservePolyline(labels, [p.trackPoint, p.target], 9);
  reservePolyline(labels, [p.realActionPoint, p.offsetCenter], 4);
  reservePolyline(labels, [p.turnEnd, p.offsetCenter], 4);
  if (p.rollCenter) {
    reservePolyline(labels, [p.rollStart, p.rollCenter], 4);
    reservePolyline(labels, [p.trackPoint, p.rollCenter], 4);
  }

  appendLabel(p.target, "Target", {
    labelKey: "target",
    color: COLORS.target,
    leaderMarkerId: "offset-arrow-label",
    candidates: candidatesAwayFromLine(p.trackPoint, p.target),
    textAttributes: { "data-top-view-role": "target" },
  });

  appendLabel(p.ip, `IP · ${fmt(result.resolved.ipRangeNm, 2)} NM`, {
    labelKey: "ip",
    color: COLORS.run,
    leader: false,
    leaderMarkerId: "offset-arrow-label",
    textAttributes: { "data-result-key": "ipRangeNm", "data-top-view-role": "ip" },
  });

  if (referencePoint) {
    appendLabel(referencePoint, `${result.referenceMode} · ${fmt(result.reference.displayRangeNm, 2)} NM`, {
      labelKey: `reference-${String(result.referenceMode).toLowerCase()}`,
      color: COLORS.reference,
      leaderMarkerId: "offset-arrow-label",
      textAttributes: { "data-result-key": "referenceSummary", "data-top-view-role": "reference" },
    });
  }

  appendLabel(p.realActionPoint, "Action Point", {
    labelKey: "action-point",
    color: COLORS.offset,
    leaderMarkerId: "offset-arrow-label",
  });

  const actionRangeMid = project(add(points.realActionPoint, mul(sub(points.target, points.realActionPoint), 0.5)));
  appendLabel(actionRangeMid, `Action Range · ${fmt(geometry.actionRangeNm, 2)} NM`, {
    labelKey: "action-range",
    color: COLORS.offset,
    leaderMarkerId: "offset-arrow-label",
    textAttributes: { "data-result-key": "actionRangeNm" },
  });

  if (len(sub(points.realActionPoint, points.ip)) > 0.05) {
    const runMid = project(add(points.ip, mul(sub(points.realActionPoint, points.ip), 0.5)));
    appendLabel(runMid, `Run-in · ${fmtHeading(geometry.runInHeadingDeg)}`, {
      labelKey: "run-in",
      color: COLORS.run,
      leaderMarkerId: "offset-arrow-label",
      textAttributes: { "data-result-key": "runInHeadingDeg" },
    });
  }

  const offsetArcMid = offsetArc[Math.floor(offsetArc.length / 2)];
  appendLabel(offsetArcMid, `Offset Angle · ${fmt(geometry.offsetAngleDeg, 0)}°`, {
    labelKey: "offset-angle",
    color: COLORS.offset,
    leaderMarkerId: "offset-arrow-label",
    textAttributes: { "data-result-key": "offsetAngleDeg" },
  });

  const approachHeadingAnchor = project(add(points.turnEnd, mul(sub(points.rollStart, points.turnEnd), 0.36)));
  appendLabel(approachHeadingAnchor, `Approaching Heading · ${fmtHeading(geometry.offsetHeadingDeg)}`, {
    labelKey: "offset-heading",
    color: approachInvalid ? COLORS.invalid : COLORS.offset,
    leaderMarkerId: "offset-arrow-label",
    textAttributes: { "data-result-key": "offsetHeadingDeg" },
  });

  const approachRangeAnchor = project(add(points.turnEnd, mul(sub(points.rollStart, points.turnEnd), 0.72)));
  appendLabel(approachRangeAnchor, `Approach Range · ${fmt(approachRangeNm, 2)} NM`, {
    labelKey: "approach-range",
    color: approachInvalid ? COLORS.invalid : COLORS.offset,
    leaderMarkerId: "offset-arrow-label",
    textAttributes: { "data-result-key": "approachRangeNm" },
  });

  appendLabel(p.rollStart, "Roll-in", {
    labelKey: "roll-in",
    color: COLORS.roll,
    leaderMarkerId: "offset-arrow-label",
  });
  appendLabel(p.trackPoint, "Track Point", {
    labelKey: "track-point",
    color: COLORS.roll,
    leaderMarkerId: "offset-arrow-label",
  });

  const attackMid = project(add(points.trackPoint, mul(sub(points.target, points.trackPoint), 0.5)));
  appendLabel(attackMid, `Attack Heading · ${fmtHeading(geometry.attackHeadingDeg)}`, {
    labelKey: "attack",
    color: COLORS.attack,
    leaderMarkerId: "offset-arrow-label",
  });

  if (advanced) {
    const offsetRadiusMid = project(add(points.offsetCenter, mul(sub(points.realActionPoint, points.offsetCenter), 0.5)));
    appendLabel(offsetRadiusMid, `Offset R · ${fmt(result.resolved.offsetRadiusNm, 2)} NM`, {
    labelKey: "offset-radius",
    color: COLORS.offset,
    leaderMarkerId: "offset-arrow-label",
    textAttributes: { "data-result-key": "offsetRadiusNm" },
  });

  if (p.rollCenter) {
    const rollRadiusMid = project(add(points.rollCenter, mul(sub(points.rollStart, points.rollCenter), 0.5)));
    appendLabel(rollRadiusMid, `Radius (EFF) · ${fmt(geometry.rollInRadiusNm, 2)} NM`, {
      labelKey: "roll-radius",
      color: COLORS.roll,
      leaderMarkerId: "offset-arrow-label",
      textAttributes: { "data-result-key": "rollInRadiusNm" },
    });
  }
  }

  labelDrags.get(svg)?.applyStoredPositions();
}

export function exportOffsetTopView(svg, filename = "offset-bombing-v2-top-view.png") {
  return saveSvgAsPng(svg, filename, { scale: 2, background: "#ffffff" });
}
