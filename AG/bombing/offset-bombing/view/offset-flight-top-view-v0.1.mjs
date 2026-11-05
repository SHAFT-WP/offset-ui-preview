import {
  createOffsetTopViewFrame,
  drawOffsetTopViewLayer,
  finishOffsetTopViewFrame,
  offsetTopViewTitle,
  offsetTopViewWorldPoints,
} from "./offset-top-view-v0.1.mjs?v=0.1.10";
import { svgNode } from "../../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { OFFSET_AIRCRAFT_PALETTES } from "./offset-view-style-v0.1.mjs?v=0.1.5";
export { offsetAircraftColors, offsetFlightTopViewLegend } from "./offset-view-style-v0.1.mjs?v=0.1.5";

// Offset Flight Top View — aircraft #n drawn in one frame with its element lead (#1, or #3 for #4).
// Formerly composed in the Offset FE controller (renderFollowerTopView); now BE-owned view logic
// (common/diagram/SPEC.md V1). Both layers share one fit over both aircraft and one rotation (the
// lead's Run-In in IP Bottom: followers fly parallel Run-In lines), so their Target markers coincide.
// The lead layer is drawn as in its own Top View; the follower layer uses the follower palette and
// "#n"-prefixed labels. Every path of both layers is reserved before any label is placed, and the
// follower's labels avoid the lead's, so neither layer's labels cover the other's paths.

export const OFFSET_FLIGHT_TOP_VIEW_V0_1 = Object.freeze({
  id: "offset-flight-top-view-v0.1",
  // 0.1.1 (2026-10-02): options.timeSec passes the Time dial to both layers (one clock: seconds after IP).
  // 0.1.2 (2026-10-03): imports Top View 0.1.2 with the controller's cache token (one module instance).
  // 0.1.3 (2026-10-05): Top View 0.1.4 token (same instance as the controller's); re-exports
  // offsetFlightTopViewLegend for the #n Top View legend.
  // 0.1.4 (2026-10-05, user): options.companions — other aircraft drawn between the lead and this
  // aircraft as paths and stations only, no labels or values (Offset #3 Top View draws #2).
  // 0.1.5 (2026-10-05, user): renderOffsetCombinedTopView — one Offset Top View for the Flight,
  // drawing the aircraft chosen with the #1–#4 buttons in one frame fitted to all of them.
  // 0.1.6 (2026-10-06): Top View 0.1.7 token (same instance as the controller's).
  // 0.1.7 (2026-10-07): Top View 0.1.8 / view style 0.1.4 tokens (MAP circle, legend timing rows).
  // 0.1.8 (2026-10-12): Top View 0.1.9 / view style 0.1.5 tokens (Tracking Time 0.1 s).
  // 0.1.9 (2026-10-15): Top View 0.1.10 token (onset Offset turn path).
  // 0.1.10 (2026-10-27, owner, POP-UP step 4): options.markers [{ x, y, label, color }] on the combined view (the
  // POP-UP page's Pop Points), included in the fit; absent, nothing changes.
  // 0.1.11 (2026-11-02, owner): a marker's optional `value` is written after its label ("Pop Up : 3.9 NM"); a marker
  // whose one-line text would overlap another marker or label is written on two lines (label, then value): on the right,
  // else on the left, else lower on the right with a leader line.
  // 0.1.12 (2026-11-05, owner, HTML Save): options.fitResults [result] — more aircraft whose places are fitted but
  // not drawn, so several pictures of the same Flight share one frame and scale (the saved file's #1·#2 / #3·#4).
  version: "0.1.12",
  layers: Object.freeze(["offset-plot-lead-<n>", "offset-plot-companion-<k>", "offset-plot-<n>"]),
  combinedLayers: Object.freeze(["offset-plot-aircraft-<n>"]),
});

// Title of the combined view: "Offset #1 Top View", "Offset #1, #2 Top View", ...
export function offsetCombinedTopViewTitle(numbers) {
  const list = (numbers ?? []).map((number) => `#${number}`).join(", ");
  return list ? `Offset ${list} Top View` : "Offset Top View";
}

// One Offset Top View for the Flight (user 2026-10-05): `aircraft` is [{ number, result }] for the
// aircraft switched on (#1–#4), each drawn in its own colour family (OFFSET_AIRCRAFT_PALETTES) in one
// frame fitted to all of them, so the canvas follows the selection. The lowest-numbered aircraft is
// the base layer (Target marker, full label set); the highest-numbered one is labelled with its "#n"
// tag; aircraft in between show paths and stations only (as #2 in the former #3 Top View). Every
// path is a label obstacle before any label is placed.
export function renderOffsetCombinedTopView(svg, aircraft, options = {}) {
  const drawn = (Array.isArray(aircraft) ? aircraft : [])
    .filter((item) => item?.result && Number.isInteger(Number(item.number)))
    .map((item) => ({ number: Number(item.number), result: item.result }))
    .sort((a, b) => a.number - b.number);
  if (!drawn.length) throw new TypeError("at least one solved aircraft is required");
  const numbers = drawn.map((item) => item.number);
  const title = offsetCombinedTopViewTitle(numbers);
  const markers = (Array.isArray(options.markers) ? options.markers : []).filter((m) => Number.isFinite(m?.x) && Number.isFinite(m?.y));
  const fitExtra = (Array.isArray(options.fitResults) ? options.fitResults : []).filter(Boolean).flatMap((result) => offsetTopViewWorldPoints(result));
  const frame = createOffsetTopViewFrame(svg, [...drawn.flatMap((item) => offsetTopViewWorldPoints(item.result)), ...markers.map(({ x, y }) => ({ x, y })), ...fitExtra], { ...options, title });
  const common = { advanced: options.advanced, upHeadingDeg: options.upHeadingDeg, timeSec: options.timeSec };
  const base = drawn[0];
  const top = drawn[drawn.length - 1];
  const layers = drawn.map((item) => {
    const isBase = item === base;
    const layer = drawOffsetTopViewLayer(frame, item.result, {
      ...common,
      groupId: `offset-plot-aircraft-${item.number}`,
      palette: OFFSET_AIRCRAFT_PALETTES[item.number] ?? "lead",
      role: isBase ? "lead" : "follower",
      aircraftTag: item.number === 1 ? "" : `#${item.number}`,
      crowded: drawn.length > 1,
      leadAttackHeadingDeg: isBase ? undefined : base.result.geometry.attackHeadingDeg,
      ipLimit: !isBase && item.result.ipLimit?.violated ? item.result.ipLimit : null,
    });
    layer.group.setAttribute("data-top-view-aircraft", String(item.number));
    layer.group.setAttribute("data-labelled", String(isBase || item === top));
    return { item, layer };
  });
  layers.filter(({ item }) => item === base || item === top).forEach(({ layer }) => layer.placeLabels());
  if (markers.length) {
    const group = svgNode("g", { "data-top-view-role": "markers" });
    const size = frame.detailSize;
    const k = frame.fontScale;
    const widthOf = (text) => text.length * size * 0.62; // bold text, about 0.62 em per character
    const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const taken = markers.map((marker) => { const at = frame.project({ x: marker.x, y: marker.y }); return { left: at.x - 8 * k, right: at.x + 8 * k, top: at.y - 8 * k, bottom: at.y + 8 * k }; });
    // Markers whose one-line texts (on the right) would overlap each other or another marker are all written on two lines.
    const oneLineBox = (marker) => {
      const at = frame.project({ x: marker.x, y: marker.y });
      const text = marker.value ? `${marker.label} : ${marker.value}` : marker.label;
      return { left: at.x - 8 * k, right: at.x + 11 * k + widthOf(text), top: at.y - size, bottom: at.y + size * 0.5 };
    };
    const crowded = markers.map((marker, i) => !!marker.value && markers.some((other, j) => j !== i && (overlaps(oneLineBox(marker), oneLineBox(other)) || overlaps(oneLineBox(marker), taken[j]))));
    markers.forEach((marker, index) => {
      const at = frame.project({ x: marker.x, y: marker.y });
      const color = marker.color ?? "#c2185b";
      const one = marker.value ? `${marker.label} : ${marker.value}` : marker.label;
      // Places in order: one line on the right; two lines (label, value) on the right, then on the left, then lower
      // on the right; the first that overlaps no other label or marker.
      const twoWidth = Math.max(widthOf(marker.label), widthOf(marker.value ?? ""));
      const places = crowded[index] ? [] : [{ lines: 1, side: 1, dy: 0, width: widthOf(one) }];
      if (marker.value) {
        places.push({ lines: 2, side: 1, dy: 0, width: twoWidth }, { lines: 2, side: -1, dy: 0, width: twoWidth });
        for (let step = 1; step <= 4; step += 1) places.push({ lines: 2, side: 1, dy: step * 2.3 * size, width: twoWidth });
      }
      const boxOf = ({ lines, side, dy, width }) => {
        const x0 = at.x + side * 11 * k;
        const top = at.y + dy - size;
        return { left: side > 0 ? x0 : x0 - width, right: side > 0 ? x0 + width : x0, top, bottom: top + size * (lines === 2 ? 2.3 : 1.5) };
      };
      const place = places.find((candidate) => !taken.some((box) => overlaps(boxOf(candidate), box))) ?? places[places.length - 1];
      const box = boxOf(place);
      taken.push(box);
      const x = place.side > 0 ? box.left : box.right;
      const attrs = { x, "font-size": size, "font-weight": 700, fill: color, "text-anchor": place.side > 0 ? "start" : "end", "data-marker-text": marker.label, "data-marker-lines": place.lines };
      const label = svgNode("text", { ...attrs, y: at.y + place.dy + (place.lines === 2 ? -2 * k : 4 * k) }, place.lines === 2 ? undefined : one);
      if (place.lines === 2) label.append(svgNode("tspan", { x }, marker.label), svgNode("tspan", { x, dy: size * 1.1 }, marker.value));
      group.append(svgNode("circle", { cx: at.x, cy: at.y, r: 7 * k, fill: "#ffffff", stroke: color, "stroke-width": 3 * k, "data-marker": marker.label }), label);
      if (place.dy) group.append(svgNode("line", { x1: at.x + 6 * k, y1: at.y + 6 * k, x2: x, y2: at.y + place.dy - size * 0.9, stroke: color, "stroke-width": 1 * k }));
    });
    frame.root.append(group);
  }
  finishOffsetTopViewFrame(frame, { scope: "offset-top" });
  svg.dataset.topViewAircraft = numbers.join(",");
  return { title, numbers, canvas: { width: frame.width, height: frame.height }, fontScale: frame.fontScale };
}

// leaderResult: the element lead's solved Offset result; result: this aircraft's (null when its own
// solve failed — the lead's profile then stays visible instead of a blank frame).
export function renderOffsetFlightTopView(svg, leaderResult, result, options = {}) {
  const number = Number(options.aircraftNumber);
  const title = offsetTopViewTitle({ aircraftNumber: number });
  const companions = (Array.isArray(options.companions) ? options.companions : []).filter((companion) => companion?.result);
  const worldPoints = [
    ...offsetTopViewWorldPoints(leaderResult),
    ...companions.flatMap((companion) => offsetTopViewWorldPoints(companion.result)),
    ...(result ? offsetTopViewWorldPoints(result) : []),
  ];
  const frame = createOffsetTopViewFrame(svg, worldPoints, { ...options, title });
  const common = { advanced: options.advanced, upHeadingDeg: options.upHeadingDeg, timeSec: options.timeSec };
  const lead = drawOffsetTopViewLayer(frame, leaderResult, { ...common, groupId: `offset-plot-lead-${number}`, crowded: Boolean(result) });
  // Companions: paths and stations only (placeLabels is not called); their paths stay label obstacles.
  companions.forEach((companion) => {
    const layer = drawOffsetTopViewLayer(frame, companion.result, {
      ...common, groupId: `offset-plot-companion-${companion.number}`, palette: "companion", aircraftTag: `#${companion.number}`,
    });
    layer.group.setAttribute("data-companion-aircraft", String(companion.number));
  });
  const own = result
    ? drawOffsetTopViewLayer(frame, result, {
        ...common,
        groupId: `offset-plot-${number}`,
        palette: "follower",
        aircraftTag: `#${number}`,
        leadAttackHeadingDeg: leaderResult.geometry.attackHeadingDeg,
        ipLimit: result.ipLimit?.violated ? result.ipLimit : null,
      })
    : null;
  lead.placeLabels();
  own?.placeLabels();
  finishOffsetTopViewFrame(frame, { scope: `flight-${number}` });
  if (Number.isFinite(Number(options.leadNumber))) svg.dataset.leadAircraft = String(options.leadNumber);
  return { title, canvas: { width: frame.width, height: frame.height }, fontScale: frame.fontScale, ownLayer: Boolean(own) };
}
