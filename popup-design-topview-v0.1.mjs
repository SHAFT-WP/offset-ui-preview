// POP-UP Design tab, step 3 Top View (owner 2026-11-20, DESIGN-STEPS.md §3, the owner's sketch; S3). Drawing only:
// the points are the BE's (popup-offset-region-v0.1, one Flight solve per Angle Off and Roll-in side) and the page's
// last answer.
//   MAP circle around the Target. Roll-in Distance = the line through every solved Roll-in Point (it is not a circle:
//   the Roll-in Distance changes with the Angle Off), both Roll-in sides.
//   Yellow arc = possible Roll-in Points, green arc = possible Attack Headings, drawn where each attack axis leaves
//   the MAP circle past the Target (the way the attack arrow points); solid = Approach-Pop ≥ 2 s, light = 0–2 s,
//   nothing below 0 s. The Offset Angle of every 15° of Angle Off is written beside its Roll-in Point.
//   The flown path in the Offset Top View colours and symbols: VRP (Action Point) → Offset turn → Approach → Pop →
//   Roll-in turn → Track Point → Target, with the turn paths and their arrows. The Attack Heading flown is a red arrow
//   through the Target.
// 0.1.1 (owner 2026-11-20 follow-up): both sides, the Roll-in Distance line, green on the arrow side, the common
// symbols (offset-view-style colours, the Offset Top View station markers, the POP-UP Pop marker), turn arrows,
// point tooltips. 0.1.2 (owner 2026-11-22): `upHeadingDeg` turns the view about the Target so that heading points up
// (the page's IP Bottom = the Run-In heading, default; 0 = north up); the north mark turns with it. 0.1.3 (owner 2026-11-22): only the Roll-in side flown is drawn; the green arc at each
// point's own MAP (it shrinks with the Angle Off). Zoom is the caller's (common svg-viewport); the canvas is fixed (W × H) so a zoom survives a redraw.
import { OFFSET_VIEW_COLORS as C } from "./AG/bombing/offset-bombing/view/offset-view-style-v0.1.mjs";
import { createOpenArrowMarker } from "./common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { appendNorthMark } from "./common/diagram/svg-north-mark-v0.1.mjs";

export const POPUP_DESIGN_TOPVIEW_V0_1 = Object.freeze({ id: "popup-design-topview-v0.1", version: "0.1.5", canvas: Object.freeze({ width: 640, height: 600 }) });

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}, text = null) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) node.setAttribute(k, v);
  if (text !== null) node.textContent = text;
  return node;
};
const finite = (v) => Number.isFinite(v);
const DEG = Math.PI / 180;
const hdg = (deg) => String(Math.round(((deg % 360) + 360) % 360)).padStart(3, "0");
const pt = (p) => p && finite(p.x) && finite(p.y);

export const REGION_COLORS = Object.freeze({ yellow: "#e0b000", green: "#1baf7a", red: "#e34948", circle: "#9a9893", pop: "#c2185b", locus: "#7a5c00" });
const SIDE_TEXT = Object.freeze({ RIGHT: "R", LEFT: "L" });

// points: region points (both sides); current: { geometry, popPoint, approachRangeNm, attackHeadingDeg } of the answer;
// summaries: { RIGHT, LEFT } from regionSummary per side.
export function renderRegionTopView(svg, { points: worldPoints = [], current: worldCurrent = null, summaries = {}, upHeadingDeg = 0 } = {}) {
  svg.replaceChildren();
  // The view turned about the Target (the Offset Top View's rotation): `upHeadingDeg` is drawn up.
  const up = Number.isFinite(Number(upHeadingDeg)) ? Number(upHeadingDeg) : 0;
  const cosU = Math.cos(up * DEG), sinU = Math.sin(up * DEG);
  const turn = (q) => (pt(q) ? { ...q, x: q.x * cosU - q.y * sinU, y: q.x * sinU + q.y * cosU } : q);
  const turnHdg = (h) => (finite(h) ? h - up : h);
  const turnPoints = (obj) => (obj ? Object.fromEntries(Object.entries(obj).map(([k, q]) => [k, turn(q)])) : obj);
  // Only the Roll-in side flown is drawn (owner 2026-11-22); both sides when there is no answer yet. The other side's
  // ranges stay in the readouts.
  const shownSide = worldCurrent?.geometry?.direction?.rollDirection ?? null;
  const sides = shownSide ? [shownSide] : ["RIGHT", "LEFT"];
  const points = worldPoints.filter((p) => !shownSide || p.rollDirection === shownSide).map((p) => ({ ...p, rollIn: turn(p.rollIn), attackHeadingDeg: turnHdg(p.attackHeadingDeg) }));
  const wg = worldCurrent?.geometry;
  const current = worldCurrent ? {
    ...worldCurrent,
    popPoint: turn(worldCurrent.popPoint),
    attackHeadingDeg: turnHdg(worldCurrent.attackHeadingDeg),
    geometry: wg ? { ...wg, attackHeadingDeg: turnHdg(wg.attackHeadingDeg), points: turnPoints(wg.points), offsetTurnPath: (wg.offsetTurnPath ?? []).map(turn), rollInTrajectorySamples: (wg.rollInTrajectorySamples ?? []).map(turn) } : wg,
  } : null;
  const { width: W, height: H } = POPUP_DESIGN_TOPVIEW_V0_1.canvas;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const defs = svgEl("defs");
  svg.append(defs, svgEl("rect", { x: -W, y: -H, width: 3 * W, height: 3 * H, fill: "#fff" }));
  const arrow = (name, color) => {
    const id = `design-top-${name}-${Math.random().toString(36).slice(2, 8)}`;
    defs.append(createOpenArrowMarker(id, color));
    return `url(#${id})`;
  };
  const g = current?.geometry;
  const mapNm = g?.groundRangeNm ?? points.find((p) => finite(p.mapNm))?.mapNm;
  const withRollIn = points.filter((p) => pt(p.rollIn));
  // Extent: the MAP circle, the Roll-in Points, the VRP and the flown path.
  const xy = [{ x: 0, y: 0 }, ...withRollIn.map((p) => p.rollIn)];
  if (finite(mapNm)) xy.push({ x: mapNm * 1.3, y: mapNm * 1.3 }, { x: -mapNm * 1.3, y: -mapNm * 1.3 });
  if (pt(g?.points?.vrp)) xy.push(g.points.vrp);
  for (const p of g?.offsetTurnPath ?? []) if (pt(p)) xy.push(p);
  const minX = Math.min(...xy.map((p) => p.x)), maxX = Math.max(...xy.map((p) => p.x));
  const minY = Math.min(...xy.map((p) => p.y)), maxY = Math.max(...xy.map((p) => p.y));
  const top = 34, bottom = 62;
  const span = Math.max((maxX - minX) / W, (maxY - minY) / (H - top - bottom), 1e-3) * 1.12;
  const s = 1 / span;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const X = (x) => W / 2 + (x - cx) * s;
  const Y = (y) => top + (H - top - bottom) / 2 - (y - cy) * s;
  const P = (p) => ({ x: X(p.x), y: Y(p.y) });
  const d = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");

  svg.append(svgEl("text", { x: 10, y: 20, "font-size": 13, "font-weight": 700, fill: "#2e2d2a" }, `Top View · 가능 영역 (#1, ${shownSide === "RIGHT" ? "오른쪽(R) Roll-in" : shownSide === "LEFT" ? "왼쪽(L) Roll-in" : "양쪽 Roll-in"})`));
  appendNorthMark(svg, { cx: W - 26, cy: 34, size: 14, rotationDeg: -up });

  // MAP circle.
  if (finite(mapNm)) {
    svg.append(svgEl("circle", { cx: X(0), cy: Y(0), r: mapNm * s, fill: "none", stroke: C.attack, "stroke-width": 1.4, "stroke-dasharray": "9 7", "data-top": "map" }));
    // Written low on the circle, on the side away from the Roll-in Points (0.1.4: clear of the Roll-in path).
    const xs = points.filter((q) => pt(q.rollIn)).map((q) => q.rollIn.x);
    const away = xs.length && xs.reduce((a, b) => a + b, 0) / xs.length < 0 ? 1 : -1;
    const r = mapNm * s;
    svg.append(svgEl("text", { x: X(0) + away * (r * 0.72 + 6), y: Y(0) + r * 0.72 + 14, "text-anchor": away > 0 ? "start" : "end", "font-size": 10.5, fill: C.attackText }, `MAP ${mapNm.toFixed(2)} NM`));
  }
  // Roll-in Distance: per Roll-in side, the line through every Roll-in Point the BE solved (Angle Off order).
  if (withRollIn.length >= 2) {
    for (const side of sides) {
      const line = withRollIn.filter((p) => p.rollDirection === side).sort((a, b) => a.angleOffDeg - b.angleOffDeg);
      if (line.length >= 2) svg.append(svgEl("path", { d: d(line.map((p) => p.rollIn)), fill: "none", stroke: REGION_COLORS.circle, "stroke-width": 1.2, "stroke-dasharray": "6 4", "data-top": "roll-in-distance", "data-side": side }));
    }
    const dist = withRollIn.map((p) => Math.hypot(p.rollIn.x, p.rollIn.y));
    svg.append(svgEl("text", { x: 10, y: H - 44, "font-size": 10.5, fill: "#5f5e5a" }, `Roll-in Distance (점선) ${Math.min(...dist).toFixed(2)}–${Math.max(...dist).toFixed(2)} NM · Angle Off에 따라 바뀜`));
  }
  // Region arcs, per side: consecutive Angle Offs joined, solid / light by the weaker of the two.
  // Each point at its own MAP (the MAP shrinks as the Angle Off grows: the Roll-in Altitude drops with the longer
  // Roll-in turn when the Tracking Time is held), so the green arc is not on the current MAP circle.
  const mapOf = (p) => (finite(p.mapNm) ? p.mapNm : mapNm);
  // 0.1.4 (owner 2026-11-22, "왼쪽으로 옵셋하는 경우 오른쪽 롤인포인트와 왼쪽 Attack Heading만"): the green arc is on the side the
  // attack comes from (the Track Point side, where the red arrow starts), the same side as the Roll-in Points.
  const onMapAhead = (p) => ({ x: -mapOf(p) * Math.sin(p.attackHeadingDeg * DEG), y: -mapOf(p) * Math.cos(p.attackHeadingDeg * DEG) });
  for (const side of sides) {
    const all = points.filter((p) => p.rollDirection === side).sort((a, b) => a.angleOffDeg - b.angleOffDeg);
    for (let i = 1; i < all.length; i += 1) {
      const a = all[i - 1], b = all[i];
      if (a.level === "bad" || b.level === "bad" || !pt(a.rollIn) || !pt(b.rollIn)) continue;
      const light = a.level === "warn" || b.level === "warn";
      const style = { "stroke-width": light ? 5 : 8, "stroke-linecap": "round", opacity: light ? 0.35 : 0.9 };
      svg.append(svgEl("line", { x1: X(a.rollIn.x), y1: Y(a.rollIn.y), x2: X(b.rollIn.x), y2: Y(b.rollIn.y), stroke: REGION_COLORS.yellow, ...style, "data-arc": "rollIn", "data-side": side }));
      if (finite(mapNm)) {
        const pa = onMapAhead(a), pb = onMapAhead(b);
        svg.append(svgEl("line", { x1: X(pa.x), y1: Y(pa.y), x2: X(pb.x), y2: Y(pb.y), stroke: REGION_COLORS.green, ...style, "data-arc": "attack", "data-side": side }));
      }
    }
    const drawn = all.filter((p) => p.level !== "bad" && pt(p.rollIn));
    for (const p of drawn) {
      const dot = svgEl("circle", { cx: X(p.rollIn.x), cy: Y(p.rollIn.y), r: 3, fill: p.level === "ok" ? REGION_COLORS.yellow : "#fff", stroke: REGION_COLORS.yellow, "stroke-width": 1.5, "data-region-point": `${SIDE_TEXT[side]}${p.angleOffDeg}` });
      dot.append(svgEl("title", {}, `${side === "RIGHT" ? "오른쪽" : "왼쪽"} Roll-in · Angle Off ${Math.round(p.angleOffDeg)}° · Attack Heading ${hdg(p.attackHeadingDeg + up)} · Offset Angle ${p.offsetAngleDeg.toFixed(1)}° · Roll-in Distance ${Math.hypot(p.rollIn.x, p.rollIn.y).toFixed(2)} NM · MAP ${finite(p.mapNm) ? p.mapNm.toFixed(2) : "-"} NM · Approach ${p.approachRangeNm.toFixed(2)} NM · Approach-Pop ${p.holdDownSec.toFixed(1)} s`));
      svg.append(dot);
      if (Math.round(p.angleOffDeg) % 15 === 0) {
        const len = Math.hypot(p.rollIn.x, p.rollIn.y) || 1;
        const k = 16 / s;
        svg.append(svgEl("text", { x: X(p.rollIn.x + (p.rollIn.x / len) * k), y: Y(p.rollIn.y + (p.rollIn.y / len) * k) + 4, "text-anchor": "middle", "font-size": 10, fill: REGION_COLORS.locus, "data-text-low": "" }, `${Math.round(p.offsetAngleDeg)}°`));
      }
    }
    // The ends of the possible arc on this side.
    if (summaries[side]?.possible && drawn.length) {
      const first = drawn[0], last = drawn[drawn.length - 1];
      // Written beside the end, away from the attack axis (left of a left-side point, right of a right-side one).
      const tag = (p) => {
        const out = p.rollIn.x < 0 ? -1 : 1;
        const len = Math.hypot(p.rollIn.x, p.rollIn.y) || 1;
        const k = 30 / s;
        svg.append(svgEl("text", { x: X(p.rollIn.x + (p.rollIn.x / len) * k) + out * 6, y: Y(p.rollIn.y + (p.rollIn.y / len) * k) + 4, "text-anchor": out < 0 ? "end" : "start", "font-size": 10.5, "font-weight": 700, fill: "#2e2d2a", "data-region-end": side }, `${SIDE_TEXT[side]} AO ${Math.round(p.angleOffDeg)}° / Attack ${hdg(p.attackHeadingDeg + up)}°`));
      };
      tag(first);
      if (last !== first) tag(last);
    }
  }

  // The flown path (Offset Top View colours): VRP → Offset turn → Approach (with the Pop) → Roll-in turn → Target.
  if (g?.points) {
    const p = g.points;
    const turn = (g.offsetTurnPath ?? []).filter(pt);
    const turnEnd = turn.length ? turn[turn.length - 1] : p.turnEnd ?? p.vrp;
    const roll = (g.rollInTrajectorySamples ?? []).filter(pt);
    const midArrow = (pts, color, name) => {
      if (pts.length < 3) return;
      const i = Math.max(1, Math.floor(pts.length * 0.55));
      svg.append(svgEl("path", { d: d([pts[i - 1], pts[i]]), fill: "none", stroke: color, "stroke-width": 2.4, "marker-end": arrow(name, color) }));
    };
    if (pt(p.vrp) && turn.length >= 2) {
      const path = [p.vrp, ...turn];
      svg.append(svgEl("path", { d: d(path), fill: "none", stroke: C.offset, "stroke-width": 3.5, "stroke-linejoin": "round", "data-path": "offset-turn" }));
      midArrow(turn, C.offset, "offset");
    }
    if (pt(turnEnd) && pt(p.rollStart)) {
      const invalid = finite(current.approachRangeNm) && current.approachRangeNm < 0;
      svg.append(svgEl("path", { d: d([turnEnd, p.rollStart]), fill: "none", stroke: invalid ? C.invalid : C.approach, "stroke-width": 3, "stroke-dasharray": invalid ? "7 6" : null, "data-path": "approach" }));
      if (finite(current.approachRangeNm)) {
        const a = P(turnEnd), b = P(p.rollStart);
        const nx = -(b.y - a.y), ny = b.x - a.x, nl = Math.hypot(nx, ny) || 1;
        const side = (nx / nl) * (a.x - X(0)) + (ny / nl) * (a.y - Y(0)) > 0 ? 1 : -1;
        svg.append(svgEl("text", { x: (a.x + b.x) / 2 + side * (nx / nl) * 14, y: (a.y + b.y) / 2 + side * (ny / nl) * 14 + 4, "text-anchor": "middle", "font-size": 11, "font-weight": 700, fill: C.approach }, `APP ${current.approachRangeNm.toFixed(2)} NM`));
      }
    }
    if (roll.length >= 2) {
      svg.append(svgEl("path", { d: d(roll), fill: "none", stroke: C.roll, "stroke-width": 3.5, "stroke-linejoin": "round", "data-path": "roll-in-turn" }));
      midArrow(roll, C.roll, "roll");
    }
    if (pt(p.trackPoint)) {
      const from = roll.length ? roll[roll.length - 1] : p.rollStart;
      if (pt(from)) svg.append(svgEl("path", { d: d([from, p.trackPoint]), fill: "none", stroke: C.roll, "stroke-width": 2 }));
    }
    // The Attack Heading flown: a red arrow from the Track Point through the Target to the MAP circle beyond it.
    const h = finite(current.attackHeadingDeg) ? current.attackHeadingDeg : g.attackHeadingDeg;
    if (finite(h) && finite(mapNm)) {
      const back = pt(p.trackPoint) ? p.trackPoint : { x: -mapNm * Math.sin(h * DEG), y: -mapNm * Math.cos(h * DEG) };
      const tip = { x: mapNm * 1.18 * Math.sin(h * DEG), y: mapNm * 1.18 * Math.cos(h * DEG) };
      svg.append(svgEl("path", { d: d([back, tip]), fill: "none", stroke: REGION_COLORS.red, "stroke-width": 2.5, "marker-end": arrow("attack", REGION_COLORS.red), "data-attack-heading": "" }));
      const nearRight = X(tip.x) > W - 70;
      svg.append(svgEl("text", { x: X(tip.x) + (nearRight ? -8 : 8), y: Y(tip.y) - 8, "text-anchor": nearRight ? "end" : "start", "font-size": 11, "font-weight": 700, fill: REGION_COLORS.red }, `Attack ${hdg(h + up)}°`));
    }
    // Stations (Offset Top View markers; Pop as the POP-UP Top View's Pop Up marker).
    const label = (q, text, color, dx = 10, dy = 4, anchor = "start") => svg.append(svgEl("text", { x: X(q.x) + dx, y: Y(q.y) + dy, "text-anchor": anchor, "font-size": 11, "font-weight": 700, fill: color }, text));
    if (pt(p.vrp)) {
      svg.append(svgEl("circle", { cx: X(p.vrp.x), cy: Y(p.vrp.y), r: 7, fill: C.offset, stroke: "#fff", "stroke-width": 2, "data-station": "vrp" }));
      label(p.vrp, "VRP", C.offset);
    }
    if (pt(current.popPoint)) {
      svg.append(svgEl("circle", { cx: X(current.popPoint.x), cy: Y(current.popPoint.y), r: 7, fill: "#fff", stroke: REGION_COLORS.pop, "stroke-width": 3, "data-station": "pop" }));
      label(current.popPoint, "Pop Up", REGION_COLORS.pop, -11, 4, "end");
    }
    if (pt(p.rollStart)) {
      svg.append(svgEl("circle", { cx: X(p.rollStart.x), cy: Y(p.rollStart.y), r: 7, fill: "#fff", stroke: C.roll, "stroke-width": 3, "data-station": "roll-in" }));
      label(p.rollStart, "Roll-in", C.rollText, 10, 16);
    }
    if (pt(p.trackPoint)) svg.append(svgEl("circle", { cx: X(p.trackPoint.x), cy: Y(p.trackPoint.y), r: 4.5, fill: "#fff", stroke: C.roll, "stroke-width": 2, "data-station": "track" }));
  }
  // Target (BDP Target marker).
  svg.append(svgEl("circle", { cx: X(0), cy: Y(0), r: 6, fill: C.target, stroke: "#fff", "stroke-width": 2, "data-station": "target" }));
  svg.append(svgEl("line", { x1: X(0) - 10, y1: Y(0), x2: X(0) + 10, y2: Y(0), stroke: C.target, "stroke-width": 2 }));
  svg.append(svgEl("line", { x1: X(0), y1: Y(0) - 10, x2: X(0), y2: Y(0) + 10, stroke: C.target, "stroke-width": 2 }));
  svg.append(svgEl("text", { x: X(0) + 10, y: Y(0) - 8, "font-size": 11, fill: "#2e2d2a" }, "Target"));
  // Legend.
  // Legend, two rows (owner 2026-11-22: the light green is written too): solid = Approach-Pop ≥ 2 s, light = 0–2 s;
  // a filled dot is a ≥ 2 s Roll-in Point, a hollow one 0–2 s.
  const ly = H - 10, ly1 = H - 26;
  const key = (x, y, color, opacity, text) => {
    svg.append(svgEl("line", { x1: x, x2: x + 20, y1: y - 4, y2: y - 4, stroke: color, "stroke-width": 7, opacity, "stroke-linecap": "round" }));
    svg.append(svgEl("text", { x: x + 25, y, "font-size": 10.5, fill: "#2e2d2a" }, text));
  };
  const dot = (x, y, filled, text) => {
    svg.append(svgEl("circle", { cx: x + 10, cy: y - 4, r: 3.5, fill: filled ? REGION_COLORS.yellow : "#fff", stroke: REGION_COLORS.yellow, "stroke-width": 1.5 }));
    svg.append(svgEl("text", { x: x + 25, y, "font-size": 10.5, fill: "#2e2d2a" }, text));
  };
  key(10, ly1, REGION_COLORS.yellow, 0.9, "Roll-in Point · App-Pop Time ≥ 2초");
  key(236, ly1, REGION_COLORS.yellow, 0.35, "Roll-in Point · App-Pop Time 0–2초");
  dot(462, ly1, true, "≥ 2초 점");
  dot(540, ly1, false, "0–2초 점");
  key(10, ly, REGION_COLORS.green, 0.9, "Attack Heading · App-Pop Time ≥ 2초");
  key(236, ly, REGION_COLORS.green, 0.35, "Attack Heading · App-Pop Time 0–2초");
  key(462, ly, REGION_COLORS.red, 1, "선택한 Attack Heading");
  svg.append(svgEl("text", { x: W - 8, y: H - 44, "text-anchor": "end", "font-size": 10.5, fill: "#5f5e5a" }, "R/L = Roll-in 방향 · App-Pop = Approach-Pop"));
  untangleLabels(svg);
}

// 0.1.4 (owner 2026-11-22, "글자들 겹치지 않게"): after drawing, an end tag that hits another label moves down a line at a
// time (up to three), and an Offset Angle number (the least important text) that still hits a label or a station is left out.
function untangleLabels(svg) {
  const box = (node) => {
    try {
      const b = node.getBBox();
      if (b.width > 0) return { x: b.x - 2, y: b.y - 1, w: b.width + 4, h: b.height + 2 };
    } catch { /* not laid out */ }
    return null;
  };
  const hit = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const texts = [...svg.querySelectorAll("text")];
  const low = texts.filter((t) => t.hasAttribute("data-text-low"));
  const tags = texts.filter((t) => t.hasAttribute("data-region-end"));
  const fixed = texts.filter((t) => !low.includes(t) && !tags.includes(t));
  const placed = fixed.map(box).filter(Boolean);
  // The flown path counts too (small boxes along it), so no text sits on the line.
  for (const path of svg.querySelectorAll("[data-path]")) {
    try {
      const len = path.getTotalLength();
      for (let l = 0; l <= len; l += 5) { const q = path.getPointAtLength(l); placed.push({ x: q.x - 2, y: q.y - 2, w: 4, h: 4 }); }
    } catch { /* not laid out */ }
  }
  for (const tag of tags) {
    const x0 = Number(tag.getAttribute("x")), y0 = Number(tag.getAttribute("y"));
    const out = tag.getAttribute("text-anchor") === "end" ? -1 : 1;
    let b = box(tag);
    for (const [dx, dy] of [[out * 10, 0], [0, 13], [0, -13], [out * 10, 13], [out * 10, -13], [out * 20, 0], [out * 20, 13]]) {
      if (!b || !placed.some((q) => hit(b, q))) break;
      tag.setAttribute("x", x0 + dx);
      tag.setAttribute("y", y0 + dy);
      b = box(tag);
    }
    if (b) placed.push(b);
  }
  for (const c of svg.querySelectorAll("[data-station]")) placed.push(box(c));
  for (const t of low) {
    const b = box(t);
    if (b && placed.some((q) => hit(b, q))) t.remove();
    else if (b) placed.push(b);
  }
}
