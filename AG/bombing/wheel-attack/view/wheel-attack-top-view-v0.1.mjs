import {
  appendDirectedLine,
  applyTextHalo,
  clamp,
  createOpenArrowMarker,
  scopeSvgMarkerIds,
  SVG_DIAGRAM_COLORS_V0_1,
  SVG_DIAGRAM_STYLE_V0_1,
  svgNode,
} from "../../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { createSmartLabelLayout } from "../../../../common/diagram/svg-smart-label-v0.1.mjs?v=0.1.5";
import { createSvgAutoCanvas } from "../../../../common/diagram/svg-viewport-v0.1.mjs?v=0.1.5";
import { formatDeg, formatG, formatNm, formatSec } from "../../../../common/ui/display-precision-v0.1.mjs";
import { WHEEL_ATTACK_TOP_VIEW_ADVANCED_LEGEND, WHEEL_ATTACK_TOP_VIEW_LEGEND, WHEEL_ATTACK_VIEW_COLORS as C, wheelAttackTopViewTitle } from "./wheel-attack-view-style-v0.1.mjs";

// Wheel #n Top View — Wheel-owned view in the V2 unified view grammar (common/diagram/SPEC.md; Wheel SPEC §20), drawn
// on the Wheel-BOX Top View's layout for the Wheel Attack v0.1 route (wheel-attack-geometry-v0.1, BE); this module only
// projects it. The Official Rev0.4 Wheel view's content:
//   the Target-centred Wheel (the quarter flown into the Roll-in Start drawn solid), the Target → Roll-in Start radius
//   (the tangent), the Roll-in, the Tracking, and every aircraft of the Aircraft Count at its place on the Wheel when #1
//   is at the Roll-in Start, numbered in the attack order 1 → N → … → 2.
// - Attack Heading up. RIGHT: the Wheel side is right of the attack run; LEFT mirrors it.
// - options.aircraft: the page's Flight aircraft drawn in their colours ([{ number, color }]); the others in grey.
// - Advanced: the MAP circle and each aircraft's Roll-in time after #1 (`+N s`).
// - Self-contained: fills an empty <svg>; every stroke, fill and text halo is an attribute.
export const WHEEL_ATTACK_TOP_VIEW_V0_1 = Object.freeze({
  id: "wheel-attack-top-view-v0.1",
  version: "0.1.0",
  owner: "AG/bombing/wheel-attack/SPEC.md",
  subject: "Wheel",
  view: "Top View",
  orientation: "ATTACK_HEADING_UP",
  canvas: Object.freeze({ width: 900, minHeight: 620, maxHeight: 1300 }),
  legend: WHEEL_ATTACK_TOP_VIEW_LEGEND,
  advancedLegend: WHEEL_ATTACK_TOP_VIEW_ADVANCED_LEGEND,
});

export { wheelAttackTopViewTitle };

const WIDTH = WHEEL_ATTACK_TOP_VIEW_V0_1.canvas.width;

const unit = (from, to) => {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
};

function arcCandidates(center, middle) {
  const out = unit(center, middle);
  const anchor = out.x > 0.3 ? "start" : out.x < -0.3 ? "end" : "middle";
  return [18, 46, 84].map((distance) => ({ dx: out.x * distance, dy: out.y * distance + 5, anchor }));
}

// Station label candidates; `mirror` swaps left / right (LEFT Wheel).
const stationCandidates = (preferred, mirror = false) => {
  const all = {
    left: { dx: -14, dy: 4, anchor: "end" },
    right: { dx: 14, dy: 4, anchor: "start" },
    above: { dx: 0, dy: -16, anchor: "middle" },
    below: { dx: 0, dy: 26, anchor: "middle" },
    upLeft: { dx: -16, dy: -14, anchor: "end" },
    upRight: { dx: 16, dy: -14, anchor: "start" },
    downLeft: { dx: -16, dy: 22, anchor: "end" },
    downRight: { dx: 16, dy: 22, anchor: "start" },
  };
  const swap = { left: "right", right: "left", upLeft: "upRight", upRight: "upLeft", downLeft: "downRight", downRight: "downLeft" };
  const keys = preferred.map((key) => (mirror ? swap[key] ?? key : key));
  return [...keys, ...Object.keys(all).filter((key) => !keys.includes(key))].map((key) => all[key]);
};

// Outward from the Target first: an aircraft label stays off the Wheel's inside.
const outwardCandidates = (center, point) => {
  const out = unit(center, point);
  const anchor = out.x > 0.3 ? "start" : out.x < -0.3 ? "end" : "middle";
  return [[22, anchor], [44, anchor]].map(([distance, a]) => ({ dx: out.x * distance, dy: out.y * distance + 5, anchor: a }))
    .concat(stationCandidates(["right", "left", "above", "below"]));
};

export function renderWheelAttackTopView(svg, wheelResult, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  const geometry = wheelResult?.geometry;
  if (!geometry?.stations?.oa1 || !geometry?.paths?.wheel || !geometry?.validation || !wheelResult?.flight?.slots) {
    throw new TypeError("wheelResult must be a Wheel Attack v0.1 result with its route geometry");
  }
  const sign = wheelResult.direction === "LEFT" ? -1 : 1;
  // Attack frame → drawing frame: x = toward the Wheel side (mirrored for LEFT), y = along the Attack Heading (up).
  const w = (point) => ({ x: sign * point.sideNm, y: point.alongNm });
  const wheel = wheelResult.wheel;
  const flight = wheelResult.flight;
  const v = geometry.values;
  const textScale = clamp(Number(options.textScale) || 1, 0.5, 2);
  const advanced = options.advanced === true;
  const s = geometry.stations;
  const pathKeys = ["wheel", "wheelArc", "rollIn"];
  const W = Object.fromEntries(Object.entries(s).map(([key, value]) => [key, w(value)]));
  pathKeys.forEach((key) => { W[key] = geometry.paths[key].map(w); });
  const radius = v.wheelRadiusNm;
  // The attack axis through the Target: from behind the Track Point to ahead of the Target.
  W.axisFrom = w({ alongNm: Math.min(s.trackPoint.alongNm, -radius) - 0.25 * radius, sideNm: 0 });
  W.axisTo = w({ alongNm: 0.6 * radius, sideNm: 0 });
  W.slots = flight.slots.map(w);
  const errorLines = geometry.validation.valid ? [] : ["GEOMETRY ERROR", ...geometry.validation.errors];
  const headerSize = 15 * textScale;
  const errorSize = 12 * textScale;
  const headerBlockHeight = 22 + 2 * headerSize * 1.35 + errorLines.length * errorSize * 1.45;

  const fit = createSvgAutoCanvas([W.axisFrom, W.axisTo, ...Object.values(s).map(w), ...pathKeys.flatMap((key) => W[key]), ...W.slots], {
    width: WIDTH,
    minHeight: WHEEL_ATTACK_TOP_VIEW_V0_1.canvas.minHeight,
    maxHeight: WHEEL_ATTACK_TOP_VIEW_V0_1.canvas.maxHeight,
    margins: { top: Math.max(96, headerBlockHeight + 40), bottom: 76, left: 190, right: 190 },
    minSpan: 0.3,
    flipY: true,
  });
  const HEIGHT = fit.height;
  const P = Object.fromEntries(Object.entries(W).map(([key, value]) => [key, Array.isArray(value) ? value.map(fit.project) : fit.project(value)]));
  const pxPerNm = Math.hypot(fit.project({ x: 1, y: 0 }).x - fit.project({ x: 0, y: 0 }).x, fit.project({ x: 1, y: 0 }).y - fit.project({ x: 0, y: 0 }).y);

  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
  svg.dataset.canvasHeight = String(HEIGHT);
  svg.style.aspectRatio = `${WIDTH} / ${HEIGHT}`;
  const title = wheelAttackTopViewTitle({ aircraftNumber: options.aircraftNumber });
  svg.setAttribute("aria-label", title);
  const defs = svgNode("defs");
  [["wheel", C.wheel], ["track", C.attack], ["roll", C.roll], ["axis", C.reference]]
    .forEach(([name, color]) => defs.append(createOpenArrowMarker(`wheel-attack-top-${name}`, color)));
  defs.append(createOpenArrowMarker("wheel-attack-top-leader", SVG_DIAGRAM_COLORS_V0_1.helper, SVG_DIAGRAM_STYLE_V0_1.arrow.leader));
  const root = svgNode("g", { "data-view": WHEEL_ATTACK_TOP_VIEW_V0_1.id });
  svg.append(defs, root);
  root.append(svgNode("rect", { x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: SVG_DIAGRAM_COLORS_V0_1.background }));

  const polyline = (points) => points.map((p, index) => `${index ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const path = (points, color, { markerId, role, width = 3.5, dasharray, opacity } = {}) => root.append(svgNode("path", {
    d: polyline(points), fill: "none", stroke: color, "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round",
    "stroke-dasharray": dasharray, opacity, "marker-end": markerId ? `url(#${markerId})` : undefined, "data-top-view-role": role,
  }));

  // The attack axis through the Target (dashed guide, toward the Attack Heading).
  appendDirectedLine(root, P.axisFrom, P.axisTo, { color: C.reference, width: 1.3, dasharray: "7 6", markerEndId: "wheel-attack-top-axis" });
  // Advanced: the MAP circle (never in the fit).
  const mapNm = wheelResult.bombDelivery.public.groundRangeNm;
  const showMap = advanced && Number.isFinite(mapNm) && mapNm > 0;
  if (showMap) {
    root.append(svgNode("circle", { cx: P.target.x, cy: P.target.y, r: mapNm * pxPerNm, fill: "none", stroke: C.attack, "stroke-width": 1.8, "stroke-dasharray": "9 7", "data-top-view-role": "map-circle" }));
  }
  // The Wheel: the whole circle thin, the quarter flown into the Roll-in Start solid; the Target → Roll-in Start radius.
  path(P.wheel, C.wheel, { role: "wheel", width: 1.6, opacity: 0.55 });
  path(P.wheelArc, C.wheel, { markerId: "wheel-attack-top-wheel", role: "wheel-arc", width: 3.5 });
  root.append(svgNode("line", {
    x1: P.target.x, y1: P.target.y, x2: P.oa1.x, y2: P.oa1.y, stroke: C.wheel, "stroke-width": 1.3, "stroke-dasharray": "5 5", opacity: 0.8, "data-top-view-role": "radius",
  }));
  // The Roll-in and the Tracking.
  path(P.rollIn, C.roll, { markerId: "wheel-attack-top-roll", role: "roll-in", width: 4.5 });
  appendDirectedLine(root, P.trackPoint, P.release, { color: C.attack, width: 3.6, markerEndId: "wheel-attack-top-track", fromGap: 7, toGap: 6 });

  // Stations.
  const dot = (point, color, key, radius = 5.5, fill = "#ffffff") => root.append(svgNode("circle", {
    cx: point.x, cy: point.y, r: radius, fill, stroke: color, "stroke-width": 2.5, "data-wheel-station": key,
  }));
  dot(P.oa1, C.roll, "oa1", 7);
  dot(P.trackPoint, C.attack, "track-point", 4.5);
  dot(P.release, C.attack, "release", 3.5);
  root.append(svgNode("circle", { cx: P.target.x, cy: P.target.y, r: 6, fill: C.target, stroke: "#ffffff", "stroke-width": 2, "data-wheel-station": "target" }));
  root.append(svgNode("line", { x1: P.target.x - 10, y1: P.target.y, x2: P.target.x + 10, y2: P.target.y, stroke: C.target, "stroke-width": 2 }));
  root.append(svgNode("line", { x1: P.target.x, y1: P.target.y - 10, x2: P.target.x, y2: P.target.y + 10, stroke: C.target, "stroke-width": 2 }));

  // The aircraft on the Wheel: a triangle on its heading, the page's Flight in its colours, the others grey.
  const colorOf = new Map((Array.isArray(options.aircraft) ? options.aircraft : []).map((item) => [item.number, item.color]));
  const aircraftPoints = flight.slots.map((slot, index) => {
    const at = P.slots[index];
    const relative = ((slot.headingDeg - wheelResult.attackHeadingDeg) * Math.PI) / 180;
    // The heading in the drawing: up = along the Attack Heading, +x = right of it (for RIGHT and LEFT alike).
    const ahead = fit.project({ x: W.slots[index].x + 0.1 * Math.sin(relative), y: W.slots[index].y + 0.1 * Math.cos(relative) });
    const length = Math.hypot(ahead.x - at.x, ahead.y - at.y) || 1;
    const u = { x: (ahead.x - at.x) / length, y: (ahead.y - at.y) / length };
    const n = { x: -u.y, y: u.x };
    const size = 11;
    const tip = { x: at.x + u.x * size, y: at.y + u.y * size };
    const left = { x: at.x - u.x * size * 0.7 + n.x * size * 0.75, y: at.y - u.y * size * 0.7 + n.y * size * 0.75 };
    const right = { x: at.x - u.x * size * 0.7 - n.x * size * 0.75, y: at.y - u.y * size * 0.7 - n.y * size * 0.75 };
    const color = colorOf.get(slot.aircraft) ?? C.aircraft;
    root.append(svgNode("path", {
      d: `M${tip.x.toFixed(1)},${tip.y.toFixed(1)} L${left.x.toFixed(1)},${left.y.toFixed(1)} L${right.x.toFixed(1)},${right.y.toFixed(1)} Z`,
      fill: color, stroke: "#ffffff", "stroke-width": 1.5, "data-wheel-aircraft": String(slot.aircraft),
    }));
    return { slot, at, color };
  });

  // In-plot header: the Angle-Off (the tangent solution) and the Flight on the Wheel; GEOMETRY ERROR lines.
  const header = [
    `Angle-Off ${formatDeg(wheelResult.angleOffDeg)}° (AUTO) · ${wheelResult.direction}`,
    `${flight.aircraftCount} aircraft · ${flight.sequence.join(" → ")} · ${formatSec(flight.attackIntervalSec)} s apart · 360° ${formatSec(wheel.wheelTimeSec)} s`,
  ];
  header.forEach((line, index) => root.append(svgNode("text", {
    x: 22, y: 22 + headerSize * (1 + index * 1.35), fill: index ? C.wheelText : C.reference, "font-size": headerSize * (index ? 0.9 : 1), "font-weight": index ? 750 : 850, "data-top-view-role": "header",
  }, line)));
  const errorTop = 22 + headerSize * 2.35;
  errorLines.forEach((line, index) => root.append(svgNode("text", {
    x: 22, y: errorTop + (index + 1) * errorSize * 1.45, fill: C.invalid, "font-size": errorSize, "font-weight": index ? 700 : 900,
    "data-top-view-role": "geometry-error",
  }, line)));

  // Labels: on their element, or joined to it by a leader (Common smart labels).
  const labels = createSmartLabelLayout(root, { width: WIDTH, height: HEIGHT, labelPad: 8, pathPad: 6, charWidthEm: 0.7 });
  [P.oa1, P.trackPoint, P.target].forEach((point) => labels.reservePoint(point, 11));
  aircraftPoints.forEach(({ at }) => labels.reservePoint(at, 12));
  labels.reservePoint(P.release, 7);
  const headerWidth = Math.max(380 * textScale, ...errorLines.map((line) => line.length * errorSize * 0.62));
  labels.reserveRect({ x: 16, y: 16, w: headerWidth, h: headerBlockHeight - 8 });
  const reserve = (points, pad = 6) => { for (let i = 1; i < points.length; i += 1) labels.reserveSegment(points[i - 1], points[i], pad); };
  reserve([P.trackPoint, P.release]);
  reserve(P.wheel, 3);
  reserve(P.wheelArc);
  reserve(P.rollIn);
  reserve([P.axisFrom, P.axisTo], 3);
  reserve([P.target, P.oa1], 3);
  const titleSize = SVG_DIAGRAM_STYLE_V0_1.font.lineTitlePx * textScale;
  const detailSize = SVG_DIAGRAM_STYLE_V0_1.font.detailPx * textScale;
  const stationSize = 12 * textScale;
  const mirror = sign < 0;
  const label = (point, text, labelOptions) => labels.append(point, text, {
    background: false,
    movable: options.movableLabels === true,
    fontSize: titleSize,
    detailFontSize: detailSize,
    leaderMarkerId: "wheel-attack-top-leader",
    ...labelOptions,
  });

  label(P.target, "Target", { labelKey: "target", color: C.target, fontSize: stationSize, candidates: stationCandidates(["downLeft", "left", "upLeft"], mirror) });
  label(P.release, "Bombs Away", { labelKey: "bombs-away", color: C.attackText, fontSize: stationSize, candidates: stationCandidates(["left", "downLeft", "upLeft", "right"], mirror) });
  label(P.trackPoint, "Track Point", { labelKey: "track-point", color: C.attackText, fontSize: stationSize, candidates: stationCandidates(["left", "upLeft", "downLeft"], mirror) });
  const pub = wheelResult.bombDelivery.public;
  const rollInNote = Number.isFinite(pub.rollInRangeNm) && Number.isFinite(pub.leadAngleDeg) ? `${formatNm(pub.rollInRangeNm)}NM/${formatDeg(pub.leadAngleDeg)}°` : undefined;
  // #1 is at the Roll-in Start: one label for both.
  label(P.oa1, "#1 Roll-in", { labelKey: "roll-in", color: C.rollText, fontSize: stationSize, detail: rollInNote, detailFontSize: stationSize, candidates: outwardCandidates(P.target, P.oa1) });
  // The Wheel: its radius, speed, bank / G and the 360° time on the flown quarter.
  const arcMiddle = P.wheelArc[Math.floor(P.wheelArc.length / 2)];
  label(arcMiddle, "Wheel", {
    labelKey: "wheel", color: C.wheelText,
    detail: `R ${formatNm(radius)} NM · ${formatDeg(wheel.wheelBankAngleDeg)}° / ${formatG(wheel.wheelLoadFactorG)} G`,
    candidates: arcCandidates(P.target, arcMiddle),
  });
  if (showMap) {
    const spot = { x: P.target.x - sign * pxPerNm * mapNm * 0.71, y: P.target.y - pxPerNm * mapNm * 0.71 };
    label(spot, `MAP: ${formatNm(mapNm)} NM`, { labelKey: "map", color: C.attackText, fontSize: stationSize, candidates: stationCandidates(["upLeft", "left", "upRight"], mirror) });
  }
  // Each aircraft: its number; Advanced adds its Roll-in time after #1.
  aircraftPoints.filter(({ slot }) => slot.slot > 0).forEach(({ slot, at, color }) => label(at, `#${slot.aircraft}`, {
    labelKey: `aircraft-${slot.aircraft}`, color: color === C.aircraft ? C.reference : color, fontSize: stationSize * 1.15,
    detail: advanced ? `+${formatSec(slot.rollInDelaySec)} s` : undefined, detailFontSize: stationSize,
    candidates: outwardCandidates(P.target, at),
  }));

  applyTextHalo(root);
  scopeSvgMarkerIds(svg, options.scope ?? "wheel-attack-top");
  return {
    title,
    orientation: WHEEL_ATTACK_TOP_VIEW_V0_1.orientation,
    canvas: { width: WIDTH, height: HEIGHT },
    geometry,
    screen: Object.fromEntries(Object.keys(s).map((key) => [key, P[key]])),
  };
}
