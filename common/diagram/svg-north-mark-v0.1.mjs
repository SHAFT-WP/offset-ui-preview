// North mark of a 2D top view (owner 2026-11-12): the BMS TGP style — a letter N with an arrow pointing north drawn
// through its middle, overlapping it. One mark for every top view (Offset, S&R, the BDP Top View on a north-up map).
// The mark turns about its centre to point at the view's north (rotationDeg = −the heading drawn up), so the caller
// reserves the whole turning circle (the returned rect) for its labels.
//
// Presentation only: no world maths here; the caller gives the screen place and the turn.
import { svgNode } from "./svg-primitives-v0.1.mjs?v=0.1.6";

export const SVG_NORTH_MARK_V0_1 = Object.freeze({ id: "common-svg-north-mark-v0.1", version: "0.1.0" });

const INK = "#243240";
const HALO = "#ffffff";

// parent: an SVG element; cx, cy: the mark's centre (screen); size: the N's height; rotationDeg: clockwise screen turn
// (0 = north up). attributes: extra attributes of the mark's group (e.g. { "data-top-view-role": "north-arrow" }).
// Returns { node, rect } — rect is the square that holds the mark at any turn.
export function appendNorthMark(parent, { cx, cy, size, rotationDeg = 0, color = INK, attributes = {} }) {
  if (![cx, cy, size].every(Number.isFinite) || !(size > 0)) throw new RangeError("the north mark needs a finite centre and size > 0");
  const turn = Number.isFinite(rotationDeg) ? ((rotationDeg % 360) + 360) % 360 : 0;
  // The N's cap height is about 0.72 of its size: the arrow starts below it and its head sits above it.
  const half = size * 1.05;
  const head = size * 0.36;
  const tip = cy - half;
  const tail = cy + size * 0.62;
  const stroke = Math.max(1.6, size * 0.075);
  const group = svgNode("g", {
    "data-north-mark": "tgp",
    "data-north-rotation": String(Number(turn.toFixed(3))),
    ...(turn ? { transform: `rotate(${Number(turn.toFixed(3))} ${cx} ${cy})` } : {}),
    ...attributes,
  });
  // The N, centred on the mark (its own halo keeps it legible over lines).
  group.append(svgNode("text", {
    x: cx, y: cy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": size, "font-weight": 900,
    "font-family": "Arial, Helvetica, sans-serif", fill: color, stroke: HALO, "stroke-width": stroke * 1.4,
    "paint-order": "stroke", "stroke-linejoin": "round", "data-north-mark-part": "letter",
  }, "N"));
  // The arrow through the N's middle (over its diagonal, no halo so the N stays whole), from below it to above it.
  group.append(svgNode("line", {
    x1: cx, y1: tail, x2: cx, y2: tip + head * 0.9, stroke: color, "stroke-width": stroke, "stroke-linecap": "round",
    "data-north-mark-part": "shaft",
  }));
  group.append(svgNode("polygon", {
    points: `${cx},${tip} ${cx - head * 0.72},${tip + head * 1.25} ${cx + head * 0.72},${tip + head * 1.25}`,
    fill: color, stroke: HALO, "stroke-width": stroke * 0.8, "stroke-linejoin": "round", "paint-order": "stroke",
    "data-north-mark-part": "head",
  }));
  parent.append(group);
  const reach = half + stroke * 2;
  return { node: group, rect: { x: cx - reach, y: cy - reach, w: reach * 2, h: reach * 2 } };
}
