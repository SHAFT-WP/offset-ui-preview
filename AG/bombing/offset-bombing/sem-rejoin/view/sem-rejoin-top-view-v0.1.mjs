import {
  applyTextHalo,
  createOpenArrowMarker,
  resolveDiagramTextPhysicalScale,
  scopeSvgMarkerIds,
  SVG_DIAGRAM_COLORS_V0_1,
  SVG_DIAGRAM_STYLE_V0_1,
  svgNode,
} from "../../../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { createSmartLabelLayout } from "../../../../../common/diagram/svg-smart-label-v0.1.mjs?v=0.1.5";
import { createSvgAutoCanvas } from "../../../../../common/diagram/svg-viewport-v0.1.mjs?v=0.1.5";
import { formatNm, formatSec } from "../../../../../common/ui/display-precision-v0.1.mjs?v=0.1.1";
import { BDP_VIEW_COLORS } from "../../../bomb-delivery-planner/view/bdp-view-style-v0.1.mjs";
import { formatHeadingDeg, offsetAircraftColors, OFFSET_VIEW_COLORS } from "../../view/offset-view-style-v0.1.mjs?v=0.1.5";

// SEM & Rejoin Top View — S&R-owned view in the V2 unified view grammar (common/diagram/SPEC.md;
// content owned by ../SPEC.md "Top View").
// - Self-contained: fills an empty <svg>; every stroke, fill and halo is an attribute.
// - 900-unit canvas, height fitted to the committed geometry (Common createSvgAutoCanvas); a draw
//   preview never refits the canvas, so the picture holds still under the pointer.
// - IP Bottom (upHeadingDeg = #1's Run-In) or north-up with a north arrow, as the Offset Top View.
// - Each aircraft keeps its Offset colour family: the attack run (run), the SEM (attack), the rows
//   (offset); derived Arc-entry rows are dashed, the selected row is drawn wider over a light band.
// - At the evaluation time: one triangle per aircraft and, for #2–#4, the formation slot (ring) with
//   a dashed line to the aircraft.
// - Returns project / unproject (world NM ↔ svg units) for the FE's pointer mapping, and
//   updatePreview(), which redraws only the preview layer.

export const SEM_REJOIN_TOP_VIEW_V0_1 = Object.freeze({
  id: "sem-rejoin-top-view-v0.1",
  version: "0.1.0",
  subject: "SEM & Rejoin",
  view: "Top View",
  canvas: Object.freeze({ width: 900, minHeight: 560, maxHeight: 1100, margins: 48, minSpanNm: 4 }),
  // Context: the attack run drawn for the last seconds before Release.
  attackContextSec: 30,
});

const SELECTED_BAND = "#ffe066";
const PREVIEW_DASH = "10 7";
// Several aircraft's stations crowd around the Target: the wider candidate ring of the Offset Flight
// Top View (offset-top-view-v0.1.mjs, crowded / follower labels), so a label moves out before it
// falls back onto another.
const LABEL_CANDIDATES = Object.freeze([
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

// docs/TERMINOLOGY.md "Diagram titles": <Subject>[ #n] <View>; several aircraft list their numbers.
export function semRejoinTopViewTitle({ aircraft = [1] } = {}) {
  const numbers = [...new Set(aircraft.map(Number).filter((n) => n >= 1 && n <= 4))].sort();
  return `SEM & Rejoin ${numbers.length ? numbers.map((n) => `#${n}`).join(", ") : "#1"} Top View`;
}

export function semRejoinPalette(number) {
  const C = offsetAircraftColors(number);
  return { attack: C.run, sem: C.attack, row: C.offset, time: C.time, label: C.offset };
}

// Legend items (fixed footer, Common installSvgLegend): per drawn aircraft, then the shared items.
export function semRejoinTopViewLegend(output = null, { aircraft = [1], preview = false } = {}) {
  const items = [];
  for (const number of aircraft) {
    const P = semRejoinPalette(number);
    const entry = output?.aircraft?.[number];
    const sem = entry?.sem?.status === "VALID" ? ` · ${formatSec(entry.sem.durationSec)} s` : "";
    items.push({ label: `#${number} SEM${sem}`, color: P.sem });
    items.push({ label: `#${number} Rejoin`, color: P.row });
  }
  items.push({ label: "Arc entry (auto)", color: OFFSET_VIEW_COLORS.reference, dashed: true });
  items.push({ label: "Formation slot", color: OFFSET_VIEW_COLORS.reference, dashed: true });
  if (preview) items.push({ label: "Draw preview", color: OFFSET_VIEW_COLORS.time, dashed: true });
  return items;
}

const finitePoint = (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y);

function worldRotation(upHeadingDeg) {
  const rad = (upHeadingDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    forward: (point) => ({ x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos }),
    inverse: (point) => ({ x: point.x * cos + point.y * sin, y: -point.x * sin + point.y * cos }),
  };
}

function circlePoints(center, radius, steps = 72) {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = (2 * Math.PI * index) / steps;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
}

function shownRows(entry) {
  return (entry?.rows ?? []).filter((row) => row.samples?.length >= 2);
}

// World points of the committed geometry (the preview is not a fit point). `room` adds drawing space
// (presentation only): [{ point, radiusNm }] squares the FE wants on the canvas, e.g. around the
// draw anchor, so the next maneuver can be drawn without zooming out first.
export function semRejoinTopViewWorldPoints(output, { aircraft = [1], evaluation = null, room = [] } = {}) {
  const points = [];
  for (const { point, radiusNm } of room) {
    if (!finitePoint(point) || !(radiusNm > 0)) continue;
    points.push({ x: point.x - radiusNm, y: point.y - radiusNm }, { x: point.x + radiusNm, y: point.y + radiusNm });
  }
  const contextSec = SEM_REJOIN_TOP_VIEW_V0_1.attackContextSec;
  for (const number of aircraft) {
    const entry = output?.aircraft?.[number];
    if (!entry) continue;
    if (entry.release) {
      points.push(entry.release.point);
      for (const sample of entry.attackSamples ?? []) if (sample.t >= entry.release.timeSec - contextSec) points.push(sample);
    }
    for (const sample of entry.sem?.samples ?? []) points.push(sample);
    for (const row of shownRows(entry)) {
      for (const sample of row.samples) points.push(sample);
      if (row.kind === "TARGET_ARC" && Number.isFinite(row.summary?.radiusNm)) points.push(...circlePoints({ x: 0, y: 0 }, row.summary.radiusNm, 24));
    }
    const state = evaluation?.aircraft?.[number];
    if (state?.available) points.push(state.state);
    const slot = evaluation?.formation?.[number];
    if (slot?.slotPoint) points.push(slot.slotPoint);
  }
  points.push({ x: 0, y: 0 });
  return points.filter(finitePoint);
}

function polyline(root, points, attributes) {
  const node = svgNode("polyline", {
    points: points.map((point) => `${point.x},${point.y}`).join(" "),
    fill: "none",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    ...attributes,
  });
  root.append(node);
  return node;
}

function triangle(root, at, headingUnit, size, fill, attributes = {}) {
  const forward = headingUnit;
  const side = { x: -forward.y, y: forward.x };
  const nose = { x: at.x + forward.x * size, y: at.y + forward.y * size };
  const left = { x: at.x - forward.x * size * 0.6 + side.x * size * 0.6, y: at.y - forward.y * size * 0.6 + side.y * size * 0.6 };
  const right = { x: at.x - forward.x * size * 0.6 - side.x * size * 0.6, y: at.y - forward.y * size * 0.6 - side.y * size * 0.6 };
  root.append(svgNode("polygon", { points: [nose, left, right].map((p) => `${p.x},${p.y}`).join(" "), fill, stroke: "#ffffff", "stroke-width": 2, "stroke-linejoin": "round", ...attributes }));
}

function clockText(timeSec) {
  return Number.isFinite(timeSec) ? `IP+${formatSec(timeSec)} s` : "-";
}

// One render of the whole view. options: aircraft (drawn numbers), editAircraft, selected
// ({ aircraft, rowId }), evaluation (output.evaluation or an in-page one), upHeadingDeg | northArrow,
// textScale, viewportWidth, scope, room (drawing space), preview (see updatePreview).
export function renderSemRejoinTopView(svg, output, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  const aircraft = (options.aircraft ?? [1]).filter((number) => output?.aircraft?.[number]);
  const title = semRejoinTopViewTitle({ aircraft });
  const evaluation = options.evaluation ?? output?.evaluation ?? null;
  const { width, minHeight, maxHeight, margins, minSpanNm } = SEM_REJOIN_TOP_VIEW_V0_1.canvas;
  const upHeadingDeg = Number.isFinite(Number(options.upHeadingDeg)) ? Number(options.upHeadingDeg) : 0;
  const rotation = worldRotation(upHeadingDeg);
  const fit = createSvgAutoCanvas(semRejoinTopViewWorldPoints(output, { aircraft, evaluation, room: options.room ?? [] }).map(rotation.forward), { width, minHeight, maxHeight, margins, minSpan: minSpanNm, flipY: true });
  const height = fit.height;
  const project = (point) => fit.project(rotation.forward(point));
  const unproject = (point) => {
    const bounds = fit.bounds ?? { minX: 0, maxY: 0 };
    const rotated = { x: (point.x - fit.offsetX) / fit.scale + bounds.minX, y: bounds.maxY - (point.y - fit.offsetY) / fit.scale };
    return rotation.inverse(rotated);
  };

  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.aspectRatio = `${width} / ${height}`;
  svg.setAttribute("aria-label", title);
  svg.dataset.exportTitle = title;
  svg.dataset.canvasHeight = String(height);
  const textScale = Number.isFinite(Number(options.textScale)) ? Number(options.textScale) : 1;
  const fontScale = resolveDiagramTextPhysicalScale(textScale, options.viewportWidth, { canvasWidth: width });
  const titleSize = SVG_DIAGRAM_STYLE_V0_1.font.lineTitlePx * fontScale;
  const detailSize = SVG_DIAGRAM_STYLE_V0_1.font.detailPx * fontScale;

  const defs = svgNode("defs");
  const root = svgNode("g", { "data-view": SEM_REJOIN_TOP_VIEW_V0_1.id });
  svg.append(defs, root);
  root.append(svgNode("rect", { x: 0, y: 0, width, height, fill: SVG_DIAGRAM_COLORS_V0_1.background, "data-sr-background": "true" }));
  defs.append(createOpenArrowMarker("sr-arrow-label", SVG_DIAGRAM_COLORS_V0_1.helper, SVG_DIAGRAM_STYLE_V0_1.arrow.leader));

  const obstacles = { segments: [], points: [] };
  const reservePath = (points, pad = 7) => {
    for (let index = 1; index < points.length; index += 1) obstacles.segments.push({ from: points[index - 1], to: points[index], pad });
  };
  const labelRequests = [];

  if (options.northArrow === true) {
    const size = titleSize;
    const left = 36;
    const top = 18;
    const tipY = top + size + 8;
    const tailY = tipY + size * 2;
    const head = size * 0.45;
    const arrow = svgNode("g", { "data-sr-role": "north-arrow" });
    arrow.append(svgNode("text", { x: left, y: top + size * 0.85, "text-anchor": "middle", "font-size": size, "font-weight": 900, fill: "#243240" }, "N"));
    arrow.append(svgNode("line", { x1: left, y1: tailY, x2: left, y2: tipY + head, stroke: "#243240", "stroke-width": 3, "stroke-linecap": "round" }));
    arrow.append(svgNode("polygon", { points: `${left},${tipY} ${left - head * 0.7},${tipY + head * 1.2} ${left + head * 0.7},${tipY + head * 1.2}`, fill: "#243240" }));
    root.append(arrow);
  }

  // Target Arc circles (all drawn aircraft), under the paths.
  const arcs = svgNode("g", { "data-sr-layer": "arcs" });
  root.append(arcs);
  const target = project({ x: 0, y: 0 });
  for (const number of aircraft) {
    const P = semRejoinPalette(number);
    for (const row of shownRows(output.aircraft[number])) {
      if (row.kind !== "TARGET_ARC" || !Number.isFinite(row.summary?.radiusNm)) continue;
      polyline(arcs, circlePoints({ x: 0, y: 0 }, row.summary.radiusNm).map(project), { stroke: P.row, "stroke-width": 1.4, "stroke-dasharray": "3 6", opacity: 0.55, "data-sr-arc-circle": row.id });
    }
  }

  const paths = svgNode("g", { "data-sr-layer": "paths" });
  root.append(paths);
  const selected = options.selected ?? null;
  for (const number of aircraft) {
    const entry = output.aircraft[number];
    const P = semRejoinPalette(number);
    const group = svgNode("g", { "data-sr-aircraft-layer": String(number) });
    paths.append(group);
    if (entry.release) {
      const context = (entry.attackSamples ?? []).filter((sample) => sample.t >= entry.release.timeSec - SEM_REJOIN_TOP_VIEW_V0_1.attackContextSec).map(project);
      if (context.length >= 2) polyline(group, context, { stroke: P.attack, "stroke-width": 2.2, opacity: 0.35, "stroke-dasharray": "2 5", "data-sr-role": "attack-run" });
    }
    if (entry.sem?.samples?.length >= 2) {
      const sem = entry.sem.samples.map(project);
      polyline(group, sem, { stroke: P.sem, "stroke-width": 4, "data-sr-row": "sem", "data-sr-aircraft": String(number), "data-sr-role": "sem" });
      reservePath(sem);
      const release = project(entry.release.point);
      group.append(svgNode("circle", { cx: release.x, cy: release.y, r: 5, fill: "#ffffff", stroke: P.sem, "stroke-width": 2.5, "data-sr-role": "release" }));
      obstacles.points.push({ point: release, radius: 8 });
      const semEnd = sem[sem.length - 1];
      group.append(svgNode("circle", { cx: semEnd.x, cy: semEnd.y, r: 5, fill: P.sem, stroke: "#ffffff", "stroke-width": 2, "data-sr-role": "sem-end" }));
      obstacles.points.push({ point: semEnd, radius: 8 });
      labelRequests.push({ point: semEnd, key: `sem-end-${number}`, title: `#${number} SEM End`, detail: clockText(entry.sem.endState.timeSec), color: P.sem });
    }
    let lastEnd = null;
    for (const row of shownRows(entry)) {
      const points = row.samples.map(project);
      const isSelected = selected && selected.aircraft === number && selected.rowId === (row.autoFor ?? row.id);
      if (isSelected) polyline(group, points, { stroke: SELECTED_BAND, "stroke-width": 11, opacity: 0.9, "data-sr-role": "selected-band" });
      const valid = row.status === "VALID" || row.status === "WARNING";
      polyline(group, points, {
        stroke: valid ? P.row : OFFSET_VIEW_COLORS.invalid,
        "stroke-width": isSelected ? 5 : 3.6,
        "stroke-dasharray": row.source === "auto" ? "9 6" : undefined,
        "data-sr-row": row.id,
        "data-sr-aircraft": String(number),
        "data-sr-role": "row",
      });
      reservePath(points);
      if (row.end) {
        const end = project(row.end);
        group.append(svgNode("circle", { cx: end.x, cy: end.y, r: 3.8, fill: "#ffffff", stroke: P.row, "stroke-width": 2, "data-sr-role": "row-end", "data-sr-row-end": row.id }));
        obstacles.points.push({ point: end, radius: 6 });
        lastEnd = { row, end };
        if (isSelected) labelRequests.push({ point: end, key: `row-${number}-${row.id}`, title: `#${number} Step ${row.step}`, detail: `${clockText(row.end.timeSec)} · ${formatHeadingDeg(row.end.headingDeg)}`, color: P.row });
      }
    }
    // A step that stopped the path (draft / invalid / unsupported) is marked where the path ends.
    const stopped = entry.rows?.find((row) => !["VALID", "WARNING", "BLOCKED"].includes(row.status));
    if (stopped) {
      const at = project(stopped.start ?? entry.endState ?? entry.sem?.endState ?? entry.release?.point ?? { x: 0, y: 0 });
      const s = 7;
      group.append(svgNode("path", { d: `M${at.x - s},${at.y - s} L${at.x + s},${at.y + s} M${at.x - s},${at.y + s} L${at.x + s},${at.y - s}`, stroke: OFFSET_VIEW_COLORS.invalid, "stroke-width": 3, "stroke-linecap": "round", "data-sr-role": "stopped" }));
      labelRequests.push({ point: at, key: `stopped-${number}`, title: `#${number} Step ${stopped.step} ${stopped.status}`, detail: stopped.errors?.[0]?.slice(0, 48) ?? "", color: OFFSET_VIEW_COLORS.invalid });
    } else if (lastEnd && !(selected && selected.aircraft === number && selected.rowId === (lastEnd.row.autoFor ?? lastEnd.row.id))) {
      labelRequests.push({ point: lastEnd.end, key: `end-${number}`, title: `#${number} End`, detail: `${clockText(lastEnd.row.end.timeSec)} · ${formatHeadingDeg(lastEnd.row.end.headingDeg)}`, color: P.row });
    }
  }

  // Selected-row handles (FE drags them): Straight end, Target Arc radius and end.
  const handles = svgNode("g", { "data-sr-layer": "handles" });
  root.append(handles);
  if (selected && output.aircraft[selected.aircraft] && options.handles !== false) {
    const entry = output.aircraft[selected.aircraft];
    const row = entry.rows.find((candidate) => candidate.id === selected.rowId && !candidate.autoFor);
    const handle = (point, name, extra = {}) => {
      const p = project(point);
      handles.append(svgNode("rect", { x: p.x - 7, y: p.y - 7, width: 14, height: 14, rx: 2, fill: "#ffffff", stroke: "#243240", "stroke-width": 2, "data-sr-handle": name, "data-sr-row": row.id, "data-sr-aircraft": String(selected.aircraft), style: "cursor:grab", ...extra }));
    };
    if (row?.end && row.kind === "STRAIGHT" && ["TIME", "DISTANCE"].includes(row.definition?.end?.kind)) handle(row.end, "straight-end");
    if (row?.end && row.kind === "TARGET_ARC") {
      const radius = row.summary.radiusNm;
      const start = row.start;
      const startAngle = Math.atan2(start.y, start.x);
      handle({ x: radius * Math.cos(startAngle), y: radius * Math.sin(startAngle) }, "arc-radius");
      if (["ARC_ANGLE", "END_RADIAL"].includes(row.definition?.end?.kind)) handle(row.end, "arc-end");
    }
  }

  // Target: the BDP red dot with crosshair.
  const targetGroup = svgNode("g", { "data-sr-role": "target" });
  targetGroup.append(svgNode("line", { x1: target.x - 11, y1: target.y, x2: target.x + 11, y2: target.y, stroke: BDP_VIEW_COLORS.target, "stroke-width": 1.6 }));
  targetGroup.append(svgNode("line", { x1: target.x, y1: target.y - 11, x2: target.x, y2: target.y + 11, stroke: BDP_VIEW_COLORS.target, "stroke-width": 1.6 }));
  targetGroup.append(svgNode("circle", { cx: target.x, cy: target.y, r: 6, fill: BDP_VIEW_COLORS.target, stroke: "#ffffff", "stroke-width": 2 }));
  root.append(targetGroup);
  obstacles.points.push({ point: target, radius: 14 });

  // Evaluation overlay: aircraft at T, formation slots with their error line.
  const overlay = svgNode("g", { "data-sr-layer": "evaluation" });
  root.append(overlay);
  if (evaluation && Number.isFinite(evaluation.timeSec)) {
    for (const number of aircraft) {
      const at = evaluation.aircraft?.[number];
      const P = semRejoinPalette(number);
      const slot = evaluation.formation?.[number];
      if (slot?.slotPoint && at?.available && !at.partial) {
        const s = project(slot.slotPoint);
        const a = project(at.state);
        overlay.append(svgNode("line", { x1: s.x, y1: s.y, x2: a.x, y2: a.y, stroke: P.row, "stroke-width": 1.6, "stroke-dasharray": "5 4", "data-sr-role": "slot-error" }));
        overlay.append(svgNode("circle", { cx: s.x, cy: s.y, r: 9, fill: "none", stroke: P.row, "stroke-width": 2.2, "stroke-dasharray": "4 3", "data-sr-role": "slot", "data-sr-slot": String(number) }));
        obstacles.points.push({ point: s, radius: 11 });
        labelRequests.push({ point: s, key: `slot-${number}`, title: `#${number} Slot`, detail: `${formatNm(slot.errors.distanceNm)} NM off`, color: P.row });
      }
      if (!at?.available) continue;
      const p = project(at.state);
      const headingDeg = Number.isFinite(at.state.headingDeg) ? at.state.headingDeg : at.state.trackDeg;
      if (Number.isFinite(headingDeg)) {
        const ahead = project({ x: at.state.x + Math.sin((headingDeg * Math.PI) / 180) * 0.01, y: at.state.y + Math.cos((headingDeg * Math.PI) / 180) * 0.01 });
        const unit = { x: ahead.x - p.x, y: ahead.y - p.y };
        const length = Math.hypot(unit.x, unit.y) || 1;
        triangle(overlay, p, { x: unit.x / length, y: unit.y / length }, 12, P.time, { "data-sr-role": "time-aircraft", "data-sr-time-aircraft": String(number) });
      } else {
        overlay.append(svgNode("circle", { cx: p.x, cy: p.y, r: 7, fill: P.time, stroke: "#ffffff", "stroke-width": 2, "data-sr-role": "time-aircraft", "data-sr-time-aircraft": String(number) }));
      }
      obstacles.points.push({ point: p, radius: 14 });
    }
  }

  // Labels last, clear of every path, station and marker.
  const labelGroup = svgNode("g", { "data-sr-layer": "labels" });
  root.append(labelGroup);
  const labels = createSmartLabelLayout(labelGroup, { width, height, labelPad: 9, pathPad: 7, charWidthEm: 0.62 });
  obstacles.points.forEach(({ point, radius }) => labels.reservePoint(point, radius));
  obstacles.segments.forEach(({ from, to, pad }) => labels.reserveSegment(from, to, pad));
  if (options.northArrow === true) labels.reserveRect({ x: 36 - titleSize, y: 18, w: titleSize * 2, h: titleSize * 4 + 14 }, 6);
  labels.append(target, "Target", { labelKey: "sr-target", color: BDP_VIEW_COLORS.target, background: false, leaderMarkerId: "sr-arrow-label", fontSize: titleSize, detailFontSize: detailSize, textAttributes: { "data-sr-label": "target" } });
  for (const request of labelRequests) {
    labels.append(request.point, request.title, {
      labelKey: `sr-${request.key}`, color: request.color, detail: request.detail, background: false, leaderMarkerId: "sr-arrow-label", candidates: LABEL_CANDIDATES,
      fontSize: titleSize, detailFontSize: detailSize, textAttributes: { "data-sr-label": request.key },
    });
  }

  const previewLayer = svgNode("g", { "data-sr-layer": "preview" });
  root.append(previewLayer);
  applyTextHalo(root);
  scopeSvgMarkerIds(svg, options.scope ?? "sem-rejoin-top");

  // Redraws the preview layer only (pointer moves): no refit, no label layout.
  // preview: { aircraft, rows: { straight, turn } results (previewSemRejoinManeuver), mousePoint,
  // turnStart, turnEnd, status } or a handle ghost { ghost: { kind: "circle" | "line", … } }.
  function updatePreview(preview) {
    previewLayer.replaceChildren();
    if (!preview) return;
    const color = preview.aircraft ? semRejoinPalette(preview.aircraft).time : OFFSET_VIEW_COLORS.time;
    const valid = preview.status === "VALID";
    for (const part of [preview.straight, preview.turn]) {
      if (part?.samples?.length >= 2) polyline(previewLayer, part.samples.map(project), { stroke: valid ? color : OFFSET_VIEW_COLORS.invalid, "stroke-width": 3.4, "stroke-dasharray": PREVIEW_DASH, "data-sr-role": "preview-path" });
    }
    if (preview.leadIn?.length >= 2 && !valid) polyline(previewLayer, preview.leadIn.map(project), { stroke: OFFSET_VIEW_COLORS.invalid, "stroke-width": 2, "stroke-dasharray": "3 4", "data-sr-role": "preview-path" });
    if (preview.mousePoint) {
      const m = project(preview.mousePoint);
      previewLayer.append(svgNode("path", { d: `M${m.x - 6},${m.y - 6} L${m.x + 6},${m.y + 6} M${m.x - 6},${m.y + 6} L${m.x + 6},${m.y - 6}`, stroke: "#243240", "stroke-width": 2, "data-sr-role": "preview-mouse" }));
    }
    if (preview.turnStart && preview.turn) {
      const t = project(preview.turnStart);
      previewLayer.append(svgNode("path", { d: `M${t.x},${t.y - 8} L${t.x + 8},${t.y} L${t.x},${t.y + 8} L${t.x - 8},${t.y} Z`, fill: "#ffffff", stroke: color, "stroke-width": 2.4, "data-sr-role": "preview-turn-start" }));
    }
    if (preview.turnEnd && valid) {
      const e = project(preview.turnEnd);
      previewLayer.append(svgNode("circle", { cx: e.x, cy: e.y, r: 6, fill: color, stroke: "#ffffff", "stroke-width": 2, "data-sr-role": "preview-end" }));
    }
    if (preview.ghost?.kind === "circle") {
      polyline(previewLayer, circlePoints({ x: 0, y: 0 }, preview.ghost.radiusNm).map(project), { stroke: color, "stroke-width": 2, "stroke-dasharray": PREVIEW_DASH, "data-sr-role": "preview-ghost" });
    }
    if (preview.ghost?.kind === "point") {
      const g = project(preview.ghost.point);
      previewLayer.append(svgNode("circle", { cx: g.x, cy: g.y, r: 7, fill: "none", stroke: color, "stroke-width": 2.4, "data-sr-role": "preview-ghost" }));
    }
  }
  updatePreview(options.preview ?? null);

  return { title, canvas: { width, height }, fontScale, project, unproject, updatePreview, upHeadingDeg };
}
