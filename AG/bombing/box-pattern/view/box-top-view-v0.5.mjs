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
} from "../../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { createSmartLabelLayout } from "../../../../common/diagram/svg-smart-label-v0.1.mjs?v=0.1.5";
import { createSvgAutoCanvas } from "../../../../common/diagram/svg-viewport-v0.1.mjs?v=0.1.5";
import { formatDeg, formatG, formatKt, formatNm, formatSec } from "../../../../common/ui/display-precision-v0.1.mjs";
import { BOX_TOP_VIEW_LEGEND, BOX_VIEW_COLORS as C, boxTopViewTitle } from "./box-view-style-v0.1.mjs";

// BOX #n Top View — BOX-owned view in the V2 unified view grammar (common/diagram/SPEC.md; BOX SPEC
// "BOX #n Top View / Z-Diagram — V2 views"). Content and layout follow BOX Rev1.5 (user decision
// 2026-09-29): the whole racetrack — Tracking → Bombs Away → OUT Maneuver → OUT Turn → Crosswind Leg →
// Crosswind Turn → Downwind → Abeam → Abeam Extension → Base Turn → Base Leg → Roll-in — with the
// Target abeam line and the Roll-in Range dimension. The route comes with the BOX v0.3 result (`geometry`,
// box-pattern-geometry-v0.3, BE); this module only projects it. The Crosswind and Base Turns are the Common onset
// level turns (their samples); their labels give the held turn's G, bank and radius.
// - Attack Heading up, RIGHT pattern (Rev1.5 default): the pattern lies right of the attack run, the
//   Base Leg heads left into OA1 and the Roll-in turns right onto the attack run.
// - Self-contained: fills an empty <svg>; every stroke, fill and text halo is an attribute.
// - Labels are two-line (title + value) on their element or joined to it by a leader.
// For the BOX v0.3 result (2026-10-25); box-top-view-v0.4 stays for the BOX v0.2 consumers (the V2 BDP + BOX
// shell). iBT is retired: the Abeam Extension ends at the Base Turn start, which carries no label.

export const BOX_TOP_VIEW_V0_5 = Object.freeze({
  id: "box-top-view-v0.5",
  // 0.5.1 (2026-10-25, owner, BOX Formation): options.formation draws each aircraft at its place in the pattern (the
  // BE's positions: #1 at its Abeam, followers by their Formation), as an aircraft symbol on the Downwind heading.
  version: "0.5.1",
  owner: "AG/bombing/box-pattern/SPEC.md",
  subject: "BOX",
  view: "Top View",
  orientation: "ATTACK_HEADING_UP_RIGHT_PATTERN",
  canvas: Object.freeze({ width: 900, minHeight: 620, maxHeight: 1300 }),
  legend: BOX_TOP_VIEW_LEGEND,
});

export { boxTopViewTitle };

const WIDTH = BOX_TOP_VIEW_V0_5.canvas.width;
const MIN_SEGMENT_NM = 1 / 1852; // Rev1.5 draws a leg only when it is longer than 1 m

// Attack frame → drawing frame: x = pattern side (right), y = along the Attack Heading (up).
const w = (point) => ({ x: point.sideNm, y: point.alongNm });
const unit = (from, to) => {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
};
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// Label candidates beside a line: close first (no leader), then farther out, then the other side.
function lineCandidates(from, to, side = 1) {
  const d = unit(from, to);
  const n = { x: -d.y * side, y: d.x * side };
  const anchorFor = (dx) => (dx > 6 ? "start" : dx < -6 ? "end" : "middle");
  return [16, 44, 80, -16, -44].map((distance) => ({ dx: n.x * distance, dy: n.y * distance + 5, anchor: anchorFor(n.x * distance) }));
}

// Candidates outward from an arc's centre through its midpoint.
function arcCandidates(center, middle) {
  const out = unit(center, middle);
  const anchor = out.x > 0.3 ? "start" : out.x < -0.3 ? "end" : "middle";
  return [18, 46, 84].map((distance) => ({ dx: out.x * distance, dy: out.y * distance + 5, anchor }));
}

const stationCandidates = (preferred) => {
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
  return [...preferred, ...Object.keys(all).filter((key) => !preferred.includes(key))].map((key) => all[key]);
};

export function renderBoxTopView(svg, boxResult, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  // The route and its validation come with the BOX result; the view only draws them.
  const geometry = boxResult?.geometry;
  if (!geometry?.stations?.baseTurnStart || !geometry?.paths || !geometry?.validation || !boxResult?.turns) throw new TypeError("boxResult must be a BOX v0.3 result with its route geometry");
  const pattern = boxResult.pattern;
  const turns = boxResult.turns;
  const out = boxResult.out;
  const v = geometry.values;
  const textScale = clamp(Number(options.textScale) || 1, 0.5, 2);
  const s = geometry.stations;
  const pathKeys = ["outTurn", "crossTurn", "baseTurn", "rollIn"];
  const W = Object.fromEntries(Object.entries(s).map(([key, value]) => [key, w(value)]));
  pathKeys.forEach((key) => { W[key] = geometry.paths[key].map(w); });
  // Target abeam line across the pattern (Rev1.5 draws it through the Target on both sides).
  W.abeamLineFrom = { x: -0.22 * v.patternWidthNm, y: 0 };
  W.abeamLineTo = { x: 1.12 * v.patternWidthNm, y: 0 };

  // Rev1.5 GEOMETRY ERROR lines sit under the header; the plot starts below them.
  const errorLines = geometry.validation.valid ? [] : ["GEOMETRY ERROR", ...geometry.validation.errors];
  const headerSize = 15 * textScale;
  const errorSize = 12 * textScale;
  const headerBlockHeight = 22 + headerSize + errorLines.length * errorSize * 1.45;

  // Formation (0.5.1): [{ number, alongNm, sideNm, headingDeg, color }] in the attack frame, from the BOX Flight BE.
  const formation = Array.isArray(options.formation) ? options.formation.filter((item) => Number.isFinite(item?.alongNm) && Number.isFinite(item?.sideNm)) : [];
  const fitPoints = [W.abeamLineFrom, W.abeamLineTo, ...Object.values(s).map(w), ...pathKeys.flatMap((key) => W[key]), ...formation.map(w)];
  const fit = createSvgAutoCanvas(fitPoints, {
    width: WIDTH,
    minHeight: BOX_TOP_VIEW_V0_5.canvas.minHeight,
    maxHeight: BOX_TOP_VIEW_V0_5.canvas.maxHeight,
    // Left: the Roll-in Range dimension and the attack-run labels; right: the Downwind labels.
    margins: { top: Math.max(86, headerBlockHeight + 40), bottom: 76, left: 190, right: 190 },
    minSpan: 0.3,
    flipY: true,
  });
  const HEIGHT = fit.height;
  const P = Object.fromEntries(Object.entries(W).map(([key, value]) => [key, Array.isArray(value) ? value.map(fit.project) : fit.project(value)]));
  const shown = (nm) => Math.abs(nm) > MIN_SEGMENT_NM;
  // A leg drawn shorter than 10 px keeps its line but not its label (the value stays in the Result).
  const labelled = (from, to) => Math.hypot(to.x - from.x, to.y - from.y) >= 10;

  // Self-contained canvas.
  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
  svg.dataset.canvasHeight = String(HEIGHT);
  svg.style.aspectRatio = `${WIDTH} / ${HEIGHT}`;
  const title = boxTopViewTitle({ aircraftNumber: options.aircraftNumber });
  svg.setAttribute("aria-label", title);
  const defs = svgNode("defs");
  [["track", C.attack], ["out", C.out], ["cross", C.crosswind], ["down", C.downwind], ["abeam", C.abeam], ["base", C.baseLeg], ["roll", C.roll], ["ref", C.reference]]
    .forEach(([name, color]) => defs.append(createOpenArrowMarker(`box-top-${name}`, color)));
  defs.append(createOpenArrowMarker("box-top-leader", SVG_DIAGRAM_COLORS_V0_1.helper, SVG_DIAGRAM_STYLE_V0_1.arrow.leader));
  const root = svgNode("g", { "data-view": BOX_TOP_VIEW_V0_5.id });
  svg.append(defs, root);
  root.append(svgNode("rect", { x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: SVG_DIAGRAM_COLORS_V0_1.background }));

  const polyline = (points) => points.map((p, index) => `${index ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const arc = (points, color, markerId, role, width = 3.5) => root.append(svgNode("path", {
    d: polyline(points), fill: "none", stroke: color, "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round",
    "marker-end": `url(#${markerId})`, "data-top-view-role": role,
  }));

  // Target abeam line (dashed guide).
  root.append(svgNode("line", {
    x1: P.abeamLineFrom.x, y1: P.abeamLineFrom.y, x2: P.abeamLineTo.x, y2: P.abeamLineTo.y,
    stroke: C.downwind, "stroke-width": 1.3, "stroke-dasharray": "7 6", opacity: 0.7, "data-top-view-role": "abeam-line",
  }));

  // Racetrack in flight order.
  appendDirectedLine(root, P.trackPoint, P.release, { color: C.attack, width: 3.6, markerEndId: "box-top-track", fromGap: 7, toGap: 6 });
  appendDirectedLine(root, P.release, P.outTurnStart, { color: C.out, width: 3.5, markerEndId: "box-top-out", fromGap: 4, toGap: 4 });
  arc(P.outTurn, C.out, "box-top-out", "out-turn");
  if (shown(v.crossLegExtensionNm)) appendDirectedLine(root, P.outTurnEnd, P.crossTurnStart, { color: C.crosswind, width: 3.5, markerEndId: "box-top-cross", toGap: 3 });
  arc(P.crossTurn, C.crosswind, "box-top-cross", "crosswind-turn");
  if (v.downwindNm > MIN_SEGMENT_NM) appendDirectedLine(root, P.crossTurnEnd, P.abeam, { color: C.downwind, width: 3.5, markerEndId: "box-top-down", toGap: 8 });
  if (shown(v.abeamExtensionDistanceNm)) appendDirectedLine(root, P.abeam, P.baseTurnStart, { color: C.abeam, width: 3.5, markerEndId: "box-top-abeam", fromGap: 7, toGap: 3 });
  arc(P.baseTurn, C.abeam, "box-top-abeam", "base-turn");
  if (shown(v.baseLegNm)) appendDirectedLine(root, P.baseTurnEnd, P.oa1, { color: C.baseLeg, width: 3.5, markerEndId: "box-top-base", toGap: 10 });
  arc(P.rollIn, C.roll, "box-top-roll", "roll-in", 4.5);

  // Roll-in Range: the true OA1 → Target range, on the side away from the pattern (left).
  const rollInRangeOffset = -(Math.abs(P.oa1.x - P.target.x) + 58);
  const rangeDimension = appendAlignedDimension(root, {
    from: P.oa1, to: P.target, offset: rollInRangeOffset, color: C.reference, markerId: "box-top-ref",
    title: "Roll-in Range", detail: `${formatNm(v.rollInRangeNm)} NM`,
    titleSize: SVG_DIAGRAM_STYLE_V0_1.font.dimensionTitlePx * textScale, detailSize: SVG_DIAGRAM_STYLE_V0_1.font.detailPx * textScale,
  });

  // Stations.
  const dot = (point, color, key, radius = 5.5, fill = "#ffffff") => root.append(svgNode("circle", {
    cx: point.x, cy: point.y, r: radius, fill, stroke: color, "stroke-width": 2.5, "data-box-station": key,
  }));
  dot(P.abeam, C.downwind, "abeam", 5.5, C.downwind);
  dot(P.oa1, C.roll, "oa1", 7);
  dot(P.trackPoint, C.attack, "track-point", 4.5);
  dot(P.release, C.attack, "release", 3.5);
  root.append(svgNode("circle", { cx: P.target.x, cy: P.target.y, r: 6, fill: C.target, stroke: "#ffffff", "stroke-width": 2, "data-box-station": "target" }));
  root.append(svgNode("line", { x1: P.target.x - 10, y1: P.target.y, x2: P.target.x + 10, y2: P.target.y, stroke: C.target, "stroke-width": 2 }));
  root.append(svgNode("line", { x1: P.target.x, y1: P.target.y - 10, x2: P.target.x, y2: P.target.y + 10, stroke: C.target, "stroke-width": 2 }));

  // Formation: an aircraft symbol (a triangle on its heading) per aircraft, in its colour.
  const aircraftPoints = formation.map((item) => {
    const at = fit.project(w(item));
    const relative = ((item.headingDeg - boxResult.attackHeadingDeg) * Math.PI) / 180;
    const ahead = fit.project(w({ alongNm: item.alongNm + 0.1 * Math.cos(relative), sideNm: item.sideNm + 0.1 * Math.sin(relative) }));
    const length = Math.hypot(ahead.x - at.x, ahead.y - at.y) || 1;
    const u = { x: (ahead.x - at.x) / length, y: (ahead.y - at.y) / length };
    const n = { x: -u.y, y: u.x };
    const size = 11;
    const tip = { x: at.x + u.x * size, y: at.y + u.y * size };
    const left = { x: at.x - u.x * size * 0.7 + n.x * size * 0.75, y: at.y - u.y * size * 0.7 + n.y * size * 0.75 };
    const right = { x: at.x - u.x * size * 0.7 - n.x * size * 0.75, y: at.y - u.y * size * 0.7 - n.y * size * 0.75 };
    root.append(svgNode("path", {
      d: `M${tip.x.toFixed(1)},${tip.y.toFixed(1)} L${left.x.toFixed(1)},${left.y.toFixed(1)} L${right.x.toFixed(1)},${right.y.toFixed(1)} Z`,
      fill: item.color ?? C.reference, stroke: "#ffffff", "stroke-width": 1.5, "data-box-aircraft": String(item.number),
    }));
    return { item, at };
  });

  // In-plot header (top left) and Rev1.5 GEOMETRY ERROR lines.
  root.append(svgNode("text", {
    x: 22, y: 22 + headerSize, fill: C.reference, "font-size": headerSize, "font-weight": 850, "data-top-view-role": "header",
  }, `Angle-Off ${formatDeg(boxResult.fixedAngleOffDeg)}°`));
  errorLines.forEach((line, index) => root.append(svgNode("text", {
    x: 22, y: 22 + headerSize + (index + 1) * errorSize * 1.45, fill: C.invalid, "font-size": errorSize, "font-weight": index ? 700 : 900,
    "data-top-view-role": "geometry-error",
  }, line)));

  // Labels: on their element, or joined to it by a leader (Common smart labels).
  const labels = createSmartLabelLayout(root, { width: WIDTH, height: HEIGHT, labelPad: 8, pathPad: 6, charWidthEm: 0.7 });
  [P.abeam, P.oa1, P.trackPoint, P.target].forEach((point) => labels.reservePoint(point, 11));
  aircraftPoints.forEach(({ at }) => labels.reservePoint(at, 12));
  labels.reservePoint(P.release, 7);
  const headerWidth = Math.max(240 * textScale, ...errorLines.map((line) => line.length * errorSize * 0.62));
  labels.reserveRect({ x: 16, y: 16, w: headerWidth, h: headerBlockHeight - 8 });
  const reserve = (points, pad = 6) => { for (let i = 1; i < points.length; i += 1) labels.reserveSegment(points[i - 1], points[i], pad); };
  reserve([P.trackPoint, P.release]);
  reserve([P.release, P.outTurnStart]);
  reserve(P.outTurn);
  reserve([P.outTurnEnd, P.crossTurnStart]);
  reserve(P.crossTurn);
  reserve([P.crossTurnEnd, P.abeam]);
  reserve([P.abeam, P.baseTurnStart]);
  reserve(P.baseTurn);
  reserve([P.baseTurnEnd, P.oa1]);
  reserve(P.rollIn);
  reserve([P.abeamLineFrom, P.abeamLineTo], 3);
  if (rangeDimension) {
    reserve([rangeDimension.a, rangeDimension.b], 4);
    reserve([P.oa1, rangeDimension.a], 3);
    reserve([P.target, rangeDimension.b], 3);
  }
  const titleSize = SVG_DIAGRAM_STYLE_V0_1.font.lineTitlePx * textScale;
  const detailSize = SVG_DIAGRAM_STYLE_V0_1.font.detailPx * textScale;
  const stationSize = 12 * textScale;
  const label = (point, text, labelOptions) => labels.append(point, text, {
    background: false,
    movable: options.movableLabels === true,
    fontSize: titleSize,
    detailFontSize: detailSize,
    leaderMarkerId: "box-top-leader",
    ...labelOptions,
  });
  const kcas = `${formatKt(v.patternSpeedKcas)} KCAS`;
  // The held (steady) part of an onset turn: its G, level-turn bank and radius (as the Offset Turn shows them).
  const turnDetail = (turn) => `${kcas} · ${formatG(turn.loadFactorG)} G · ${formatDeg(turn.bankAngleDeg)}° · R ${formatNm(turn.instantaneous.radiusNm)} NM`;
  // Label direction: out from the turn's inside corner (a circular turn's centre: Crosswind = (its end's along,
  // its start's side); Base = (its start's along, its end's side)).
  const crossInside = fit.project(w({ alongNm: s.crossTurnEnd.alongNm, sideNm: s.crossTurnStart.sideNm }));
  const baseInside = fit.project(w({ alongNm: s.baseTurnStart.alongNm, sideNm: s.baseTurnEnd.sideNm }));

  label(P.target, "Target", { labelKey: "target", color: C.target, fontSize: stationSize, candidates: stationCandidates(["downLeft", "left", "upLeft"]) });
  label(P.release, "Bombs Away", { labelKey: "bombs-away", color: C.attackText, fontSize: stationSize, candidates: stationCandidates(["left", "downLeft", "upLeft", "right"]) });
  label(P.trackPoint, "Track Point", { labelKey: "track-point", color: C.attackText, fontSize: stationSize, candidates: stationCandidates(["left", "upLeft", "downLeft"]) });
  label(P.oa1, "Roll-in", { labelKey: "roll-in", color: C.rollText, fontSize: stationSize, candidates: stationCandidates(["below", "downRight", "downLeft"]) });
  label(P.abeam, "Abeam", { labelKey: "abeam", color: C.downwindText, fontSize: stationSize, candidates: stationCandidates(["upRight", "right", "downRight"]) });
  const outDetail = out.inputs.mode === "CLIMB"
    ? `${formatG(out.inputs.recoveryG)} G · Level · Climb Angle ${formatDeg(out.inputs.climbPitchDeg)}°`
    : `${formatG(out.inputs.recoveryG)} G · Level`;
  // Anchored toward the OUT Turn Start, clear of the Target abeam line that crosses the OUT run.
  const outAnchor = { x: P.release.x + (P.outTurnStart.x - P.release.x) * 0.7, y: P.release.y + (P.outTurnStart.y - P.release.y) * 0.7 };
  label(outAnchor, "OUT Maneuver", {
    labelKey: "out-maneuver", color: C.outText, detail: outDetail,
    candidates: lineCandidates(P.release, P.outTurnStart, -1),
  });
  if (shown(v.crossLegExtensionNm) && labelled(P.outTurnEnd, P.crossTurnStart)) label(mid(P.outTurnEnd, P.crossTurnStart), "Crosswind Leg", {
    labelKey: "crosswind-leg", color: C.crosswindText, detail: `${formatNm(v.crossLegExtensionNm)} NM · ${formatSec(pattern.crossLegTimeSec)} s`,
    candidates: lineCandidates(P.outTurnEnd, P.crossTurnStart, -1),
  });
  label(P.crossTurn[Math.floor(P.crossTurn.length / 2)], "Crosswind Turn", {
    labelKey: "crosswind-turn", color: C.crosswindText, detail: turnDetail(turns.cross),
    candidates: arcCandidates(crossInside, P.crossTurn[Math.floor(P.crossTurn.length / 2)]),
  });
  if (v.downwindNm > MIN_SEGMENT_NM && labelled(P.crossTurnEnd, P.abeam)) label(mid(P.crossTurnEnd, P.abeam), "Downwind", {
    labelKey: "downwind", color: C.downwindText, detail: `${formatNm(v.downwindNm)} NM · ${kcas} · ${formatSec(v.downwindTimeSec)} s`,
    candidates: lineCandidates(P.crossTurnEnd, P.abeam, -1),
  });
  if (shown(v.abeamExtensionDistanceNm) && labelled(P.abeam, P.baseTurnStart)) label(mid(P.abeam, P.baseTurnStart), "Abeam Extension", {
    labelKey: "abeam-extension", color: C.abeamText,
    detail: `${formatNm(v.abeamExtensionDistanceNm)} NM · ${kcas} · ${formatSec(pattern.abeamExtensionTimeSec)} s`,
    candidates: lineCandidates(P.abeam, P.baseTurnStart, -1),
  });
  label(P.baseTurn[Math.floor(P.baseTurn.length / 2)], "Base Turn", {
    labelKey: "base-turn", color: C.abeamText, detail: turnDetail(turns.base),
    candidates: arcCandidates(baseInside, P.baseTurn[Math.floor(P.baseTurn.length / 2)]),
  });
  if (shown(v.baseLegNm) && labelled(P.baseTurnEnd, P.oa1)) label(mid(P.baseTurnEnd, P.oa1), "Base Leg", {
    labelKey: "base-leg", color: C.baseLegText, detail: `${formatNm(v.baseLegNm)} NM · ${formatSec(v.baseLegTimeSec)} s`,
    candidates: lineCandidates(P.baseTurnEnd, P.oa1, -1),
  });

  aircraftPoints.forEach(({ item, at }) => label(at, `#${item.number}`, {
    labelKey: `aircraft-${item.number}`, color: item.color ?? C.reference, fontSize: stationSize * 1.15,
    candidates: stationCandidates(["right", "left", "upRight", "downRight"]),
  }));

  applyTextHalo(root);
  scopeSvgMarkerIds(svg, options.scope ?? "box-top");
  return {
    title,
    orientation: BOX_TOP_VIEW_V0_5.orientation,
    canvas: { width: WIDTH, height: HEIGHT },
    geometry,
    screen: Object.fromEntries(Object.keys(s).map((key) => [key, P[key]])),
  };
}
