import {
  appendDirectedLine,
  createOpenArrowMarker,
  SVG_DIAGRAM_STYLE_V0_1,
  svgNode,
} from "./common/diagram/svg-primitives-v0.1.mjs";
import { createSmartLabelLayout, installSmartLabelDrag } from "./common/diagram/svg-smart-label-v0.1.mjs";
import { installSvgViewport } from "./common/diagram/svg-viewport-v0.1.mjs";
import { saveSvgAsPng } from "./common/diagram/svg-png-export-v0.1.mjs";

export const OFFSET_RENDERER_V0_1 = Object.freeze({
  id: "offset-renderer-v0.1",
  version: "0.1.5",
  common: ["svg-primitives-v0.1", "svg-smart-label-v0.1", "svg-viewport-v0.1", "svg-png-export-v0.1"],
});

const WIDTH = 1180;
const HEIGHT = 1440;
const TOP_VIEW_FONT_SCALE_DEFAULT = 1.5;
const TOP_VIEW_FONT_SCALE_MIN = 1.0;
const TOP_VIEW_FONT_SCALE_MAX = 2.0;
const COLORS = Object.freeze({ run: "#4c5966", offset: "#a35d00", roll: "#176dac", attack: "#087b4c", target: "#bd3333", reference: "#5b6f82", invalid: "#bd3333", helper: "#7a8793" });
const viewports = new WeakMap();
const labelDrags = new WeakMap();
const lastRenderedResults = new WeakMap();

function finitePoint(point) { return point && Number.isFinite(point.x) && Number.isFinite(point.y); }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function mul(a, k) { return { x: a.x * k, y: a.y * k }; }
function len(a) { return Math.hypot(a.x, a.y); }
function fmt(value, digits = 2) { return Number.isFinite(value) ? Number(value).toFixed(digits) : "-"; }
function fmtHeading(value) { const h = ((Math.round(value) % 360) + 360) % 360; return String(h === 0 ? 360 : h).padStart(3, "0") + "°"; }
function normalizeTopViewFontScale(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return TOP_VIEW_FONT_SCALE_DEFAULT;
  return Math.min(TOP_VIEW_FONT_SCALE_MAX, Math.max(TOP_VIEW_FONT_SCALE_MIN, numeric));
}

function projectFactory(points) {
  const valid = points.filter(finitePoint);
  if (!valid.length) return (point) => ({ x: WIDTH / 2 + point.x, y: HEIGHT / 2 - point.y });
  const minX = Math.min(...valid.map((point) => point.x));
  const maxX = Math.max(...valid.map((point) => point.x));
  const minY = Math.min(...valid.map((point) => point.y));
  const maxY = Math.max(...valid.map((point) => point.y));
  const margins = { left: 48, right: 48, top: 48, bottom: 48 };
  const usableWidth = WIDTH - margins.left - margins.right;
  const usableHeight = HEIGHT - margins.top - margins.bottom;
  const spanX = Math.max(0.5, maxX - minX);
  const spanY = Math.max(0.5, maxY - minY);
  const scale = Math.min(usableWidth / spanX, usableHeight / spanY);
  const usedWidth = spanX * scale;
  const usedHeight = spanY * scale;
  const left = margins.left + (usableWidth - usedWidth) / 2;
  const top = margins.top + (usableHeight - usedHeight) / 2;
  return (point) => ({
    x: left + (point.x - minX) * scale,
    y: top + (maxY - point.y) * scale,
  });
}

function sampleArc(center, start, end, turnDirection, steps = 48) {
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  let endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  const direction = turnDirection === "LEFT" ? 1 : -1;
  if (direction > 0) while (endAngle <= startAngle) endAngle += Math.PI * 2;
  else while (endAngle >= startAngle) endAngle -= Math.PI * 2;
  const radius = len(sub(start, center));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const f = index / steps;
    const angle = startAngle + (endAngle - startAngle) * f;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
}

function appendPolyline(root, points, options = {}) {
  const node = svgNode("polyline", {
    points: points.map((p) => `${p.x},${p.y}`).join(" "),
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
function appendCircle(root, point, radius, fill, stroke = "#fff") { root.append(svgNode("circle", { cx: point.x, cy: point.y, r: radius, fill, stroke, "stroke-width": 2 })); }
function appendSquare(root, point, size, fill, stroke = "#fff") { root.append(svgNode("rect", { x: point.x - size / 2, y: point.y - size / 2, width: size, height: size, rx: 2, ry: 2, fill, stroke, "stroke-width": 2 })); }
function reservePolyline(layout, points, pad = 7) { for (let i = 1; i < points.length; i += 1) layout.reserveSegment(points[i - 1], points[i], pad); }

export function installOffsetTopViewControls(svg, controls = {}) {
  let viewport = viewports.get(svg);
  if (!viewport) {
    viewport = installSvgViewport(svg, {
      baseViewBox: { x: 0, y: 0, w: WIDTH, h: HEIGHT },
      panOnlyWhenZoomed: true,
      zoomInButton: controls.zoomInButton,
      zoomOutButton: controls.zoomOutButton,
      resetButton: controls.resetButton,
    });
    viewports.set(svg, viewport);
  }
  if (!labelDrags.has(svg)) {
    const labelDrag = installSmartLabelDrag(svg);
    labelDrags.set(svg, labelDrag);
    controls.resetButton?.addEventListener("click", () => labelDrag.reset());
  }
  return viewport;
}

export function renderOffsetTopView(svg, result, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  const fontScale = normalizeTopViewFontScale(options.fontScale);
  const root = svg.querySelector("#offset-plot") ?? svg.appendChild(svgNode("g", { id: "offset-plot" }));
  root.replaceChildren();
  const viewport = viewports.get(svg);
  const geometryChanged = lastRenderedResults.get(svg) !== result;
  if (geometryChanged) viewport?.reset(false);
  else viewport?.ensureBaseWhenUnadjusted();
  lastRenderedResults.set(svg, result);

  const geometry = result.geometry;
  const points = geometry.points;
  const allWorldPoints = [points.target, points.ip, points.realActionPoint, points.turnEnd, points.offsetCenter, points.rollStart, points.trackPoint, points.rollCenter, result.reference.point, ...geometry.rollInTrajectorySamples].filter(finitePoint);
  const project = projectFactory(allWorldPoints);
  const p = Object.fromEntries(Object.entries(points).map(([key, point]) => [key, finitePoint(point) ? project(point) : null]));
  const referencePoint = project(result.reference.point);
  const rollPath = geometry.rollInTrajectorySamples.map(project);
  const offsetArc = sampleArc(points.offsetCenter, points.realActionPoint, points.turnEnd, geometry.direction.offsetDirection).map(project);

  root.append(svgNode("rect", { x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: "#fff" }));

  const defs = svg.querySelector("defs") ?? svg.insertBefore(svgNode("defs"), svg.firstChild);
  defs.replaceChildren(
    createOpenArrowMarker("offset-arrow-run", COLORS.run),
    createOpenArrowMarker("offset-arrow-offset", COLORS.offset),
    createOpenArrowMarker("offset-arrow-roll", COLORS.roll),
    createOpenArrowMarker("offset-arrow-attack", COLORS.attack),
    createOpenArrowMarker("offset-arrow-label", COLORS.helper, SVG_DIAGRAM_STYLE_V0_1.arrow.leader),
  );

  const vipMatch = result.referenceMode === "VIP" && Math.abs(result.resolved.ipRangeNm - geometry.actionRangeNm) <= 0.01;
  if (result.referenceMode === "VRP") appendDirectedLine(root, p.ip, p.realActionPoint, { color: COLORS.run, width: 5, markerEndId: "offset-arrow-run", fromGap: 13, toGap: 8 });
  else if (!vipMatch) appendDirectedLine(root, p.ip, p.realActionPoint, { color: COLORS.invalid, width: 2.5, dasharray: "7 6", fromGap: 13, toGap: 8 });
  appendDirectedLine(root, p.realActionPoint, p.target, { color: "#b1bbc4", width: 1.4, dasharray: "7 6" });
  appendPolyline(root, offsetArc, { color: COLORS.offset, width: 6, markerEndId: "offset-arrow-offset" });
  appendDirectedLine(root, p.turnEnd, p.rollStart, { color: geometry.actionLegDistanceNm < 0 ? COLORS.invalid : COLORS.offset, width: geometry.actionLegDistanceNm < 0 ? 3 : 5, dasharray: geometry.actionLegDistanceNm < 0 ? "7 6" : undefined });
  appendPolyline(root, rollPath, { color: COLORS.roll, width: 6, markerEndId: "offset-arrow-roll" });
  appendDirectedLine(root, p.trackPoint, p.target, { color: COLORS.attack, width: 6, markerEndId: "offset-arrow-attack", fromGap: 6, toGap: 15 });

  appendDirectedLine(root, p.realActionPoint, p.offsetCenter, { color: COLORS.offset, width: 1.2, dasharray: "4 4" });
  appendDirectedLine(root, p.turnEnd, p.offsetCenter, { color: COLORS.offset, width: 1.2, dasharray: "4 4" });
  if (p.rollCenter) {
    appendDirectedLine(root, p.rollStart, p.rollCenter, { color: COLORS.roll, width: 1.2, dasharray: "4 4" });
    appendDirectedLine(root, p.trackPoint, p.rollCenter, { color: COLORS.roll, width: 1.2, dasharray: "4 4" });
    appendCircle(root, p.rollCenter, 2.5, "#fff", COLORS.roll);
  }

  appendSquare(root, p.ip, 24, COLORS.run, result.referenceMode === "VIP" ? COLORS.offset : "#fff");
  if (result.referenceMode === "VRP" || !vipMatch) appendCircle(root, p.realActionPoint, 7, result.state === "INVALID" && result.referenceMode === "VIP" ? COLORS.invalid : COLORS.offset);
  appendCircle(root, p.rollStart, 6, COLORS.roll);
  appendCircle(root, p.trackPoint, 5, COLORS.roll);
  appendCircle(root, p.target, 14, COLORS.target);

  const sameVrpAp = result.referenceMode === "VRP" && Math.abs(result.reference.displayRangeNm - geometry.actionRangeNm) <= 0.01;
  const sameVrpIp = result.referenceMode === "VRP" && Math.abs(result.reference.displayRangeNm - result.resolved.ipRangeNm) <= 0.01;
  const sameVipIp = result.referenceMode === "VIP" && Math.abs(result.reference.displayRangeNm - result.resolved.ipRangeNm) <= 0.01;
  if ((result.referenceMode === "VRP" && !sameVrpAp && !sameVrpIp) || (result.referenceMode === "VIP" && !sameVipIp)) appendCircle(root, referencePoint, 4.5, COLORS.reference);

  const labels = createSmartLabelLayout(root, { width: WIDTH, height: HEIGHT, labelPad: 10, pathPad: 7 });
  const appendLabel = (point, text, labelOptions = {}) => labels.append(point, text, {
    ...labelOptions,
    fontSize: (labelOptions.fontSize ?? SVG_DIAGRAM_STYLE_V0_1.font.smartLabelPx) * fontScale,
  });
  [p.ip, p.realActionPoint, p.rollStart, p.trackPoint, p.target].filter(Boolean).forEach((point) => labels.reservePoint(point, 14));
  reservePolyline(labels, [p.ip, p.realActionPoint]);
  reservePolyline(labels, offsetArc);
  reservePolyline(labels, [p.turnEnd, p.rollStart]);
  reservePolyline(labels, rollPath);
  reservePolyline(labels, [p.trackPoint, p.target]);
  reservePolyline(labels, [p.realActionPoint, p.offsetCenter], 4);
  reservePolyline(labels, [p.turnEnd, p.offsetCenter], 4);
  if (p.rollCenter) {
    reservePolyline(labels, [p.rollStart, p.rollCenter], 4);
    reservePolyline(labels, [p.trackPoint, p.rollCenter], 4);
  }

  appendLabel(p.ip, result.referenceMode === "VIP" ? `IP / ACTION POINT · ${fmt(result.resolved.ipRangeNm, 2)} NM` : `IP · ${fmt(result.resolved.ipRangeNm, 2)} NM`, {
    labelKey: "ip", color: COLORS.run, leader: false, leaderMarkerId: "offset-arrow-label", textAttributes: { "data-result-key": "ipRangeNm" },
  });
  if (result.referenceMode === "VRP") appendLabel(p.realActionPoint, `ACTION POINT · ${fmt(geometry.actionRangeNm, 2)} NM`, {
    labelKey: "action-point", color: COLORS.offset, leaderMarkerId: "offset-arrow-label", textAttributes: { "data-result-key": "actionRangeNm" },
  });
  else if (!vipMatch) appendLabel(p.realActionPoint, `CALC ACTION POINT · ${fmt(geometry.actionRangeNm, 2)} NM`, {
    labelKey: "action-point", color: COLORS.invalid, leaderMarkerId: "offset-arrow-label", textAttributes: { "data-result-key": "actionRangeNm" },
  });

  if (len(sub(points.realActionPoint, points.ip)) > 0.05) {
    const runMid = project(add(points.ip, mul(sub(points.realActionPoint, points.ip), 0.5)));
    appendLabel(runMid, `RUN-IN · ${fmtHeading(geometry.runInHeadingDeg)}`, {
      labelKey: "run-in", color: COLORS.run, leaderMarkerId: "offset-arrow-label", textAttributes: { "data-result-key": "runInHeadingDeg" },
    });
  }

  const actionMid = project(add(points.turnEnd, mul(sub(points.rollStart, points.turnEnd), 0.5)));
  appendLabel(actionMid, `OFFSET ${fmt(geometry.offsetAngleDeg, 0)}° · HEADING ${fmtHeading(geometry.actionHeadingDeg)}`, {
    labelKey: "action-heading",
    color: geometry.actionLegDistanceNm < 0 ? COLORS.invalid : COLORS.offset,
    leaderMarkerId: "offset-arrow-label",
    textAttributes: { "data-result-key": "actionHeadingDeg" },
  });
  const offsetRangeAnchor = project(add(points.turnEnd, mul(sub(points.rollStart, points.turnEnd), 0.72)));
  appendLabel(offsetRangeAnchor, `OFFSET RANGE · ${fmt(result.resolved.offsetRangeNm, 2)} NM`, {
    labelKey: "offset-range",
    color: geometry.actionLegDistanceNm < 0 ? COLORS.invalid : COLORS.offset,
    fontSize: SVG_DIAGRAM_STYLE_V0_1.font.compactPx,
    leaderMarkerId: "offset-arrow-label",
    textAttributes: { "data-result-key": "offsetRangeNm" },
  });
  appendLabel(p.rollStart, "ROLL IN", { labelKey: "roll-in", color: COLORS.roll, leaderMarkerId: "offset-arrow-label" });
  appendLabel(p.trackPoint, "TRACK POINT", { labelKey: "track-point", color: COLORS.roll, leaderMarkerId: "offset-arrow-label" });
  const attackMid = project(add(points.trackPoint, mul(sub(points.target, points.trackPoint), 0.5)));
  appendLabel(attackMid, `ATTACK · ${fmtHeading(geometry.attackHeadingDeg)}`, { labelKey: "attack", color: COLORS.attack, leaderMarkerId: "offset-arrow-label" });
  appendLabel(p.target, "TARGET", { labelKey: "target", color: COLORS.target, fontSize: SVG_DIAGRAM_STYLE_V0_1.font.lineTitlePx, leaderMarkerId: "offset-arrow-label" });

  const offsetRadiusMid = project(add(points.offsetCenter, mul(sub(points.realActionPoint, points.offsetCenter), 0.5)));
  appendLabel(offsetRadiusMid, `OFFSET R · ${fmt(result.resolved.offsetRadiusNm, 2)} NM`, {
    labelKey: "offset-radius", color: COLORS.offset, fontSize: SVG_DIAGRAM_STYLE_V0_1.font.compactPx, leaderMarkerId: "offset-arrow-label", textAttributes: { "data-result-key": "offsetRadiusNm" },
  });
  if (p.rollCenter) {
    const rollRadiusMid = project(add(points.rollCenter, mul(sub(points.rollStart, points.rollCenter), 0.5)));
    appendLabel(rollRadiusMid, `ROLL-IN R(EFF) · ${fmt(geometry.rollInRadiusNm, 2)} NM`, {
      labelKey: "roll-radius", color: COLORS.roll, fontSize: SVG_DIAGRAM_STYLE_V0_1.font.compactPx, leaderMarkerId: "offset-arrow-label", textAttributes: { "data-result-key": "rollInRadiusNm" },
    });
  }

  if (result.referenceMode === "VRP" && !sameVrpAp && !sameVrpIp) appendLabel(referencePoint, `VRP · ${fmt(result.reference.displayRangeNm, 2)} NM`, { labelKey: "reference", color: COLORS.reference, fontSize: SVG_DIAGRAM_STYLE_V0_1.font.compactPx, leaderMarkerId: "offset-arrow-label" });
  if (result.referenceMode === "VIP" && !sameVipIp) appendLabel(referencePoint, `VIP · ${fmt(result.reference.displayRangeNm, 2)} NM`, { labelKey: "reference", color: COLORS.reference, fontSize: SVG_DIAGRAM_STYLE_V0_1.font.compactPx, leaderMarkerId: "offset-arrow-label" });
  if (result.reference.clampedAtTarget) appendLabel(p.target, "VRP CONSTRAINED AT TARGET", { labelKey: "reference-constraint", color: COLORS.invalid, fontSize: SVG_DIAGRAM_STYLE_V0_1.font.compactPx, leaderMarkerId: "offset-arrow-label" });
  if (result.reference.clampedAtIp) appendLabel(p.ip, "VRP CONSTRAINED AT IP", { labelKey: "reference-constraint", color: COLORS.invalid, fontSize: SVG_DIAGRAM_STYLE_V0_1.font.compactPx, leaderMarkerId: "offset-arrow-label" });

  labelDrags.get(svg)?.applyStoredPositions();
}

export function exportOffsetTopView(svg, filename = "offset-bombing-v2-top-view.png") {
  return saveSvgAsPng(svg, filename, { scale: 2, background: "#ffffff" });
}