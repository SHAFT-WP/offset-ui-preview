// POP-UP Design tab, step 3 Top View (owner 2026-11-20, DESIGN-STEPS.md §3, the owner's sketch; S3). Drawing only:
// the points are the BE's (popup-offset-region-v0.1, one Flight solve per Angle Off) and the page's last answer.
//   Inner circle = MAP, outer circle = Roll-in Distance, both around the Target.
//   Yellow arc = possible Roll-in Points, green arc = possible Attack Headings (where each attack axis crosses the
//   MAP circle); solid = Approach-Pop ≥ 2 s, light = 0–2 s, nothing below 0 s. The Offset Angle of each point is
//   written beside it. The flown path (VRP → Offset Turn → Approach → Roll-in) is drawn as it is, with the APP Range;
//   the Attack Heading flown (or entered) is a red line through the Target.
export const POPUP_DESIGN_TOPVIEW_V0_1 = Object.freeze({ id: "popup-design-topview-v0.1", version: "0.1.0" });

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}, text = null) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== null) node.textContent = text;
  return node;
};
const finite = (v) => Number.isFinite(v);
const DEG = Math.PI / 180;
const hdg = (deg) => String(Math.round(((deg % 360) + 360) % 360)).padStart(3, "0");

const COLORS = Object.freeze({ yellow: "#e0b000", green: "#1baf7a", red: "#e34948", path: "#2e2d2a", circle: "#9a9893" });

// points: region points; current: { geometry, popPoint, approachRangeNm, holdDownSec } of the answer; summary from
// regionSummary.
export function renderRegionTopView(svg, { points = [], current = null, summary = null } = {}) {
  svg.replaceChildren();
  const W = 640, H = 560;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.append(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#fff" }));
  const g = current?.geometry;
  const mapNm = g?.groundRangeNm ?? points.find((p) => finite(p.mapNm))?.mapNm;
  const rollInNm = g?.rollInRangeNm ?? points.find((p) => finite(p.rollInRangeNm))?.rollInRangeNm;
  // Extent: the circles, the VRP and the drawn points.
  const xy = [{ x: 0, y: 0 }];
  if (finite(rollInNm)) xy.push({ x: rollInNm, y: rollInNm }, { x: -rollInNm, y: -rollInNm });
  if (g?.points?.vrp) xy.push(g.points.vrp);
  for (const p of points) if (p.level !== "bad" && p.rollIn) xy.push(p.rollIn);
  const minX = Math.min(...xy.map((p) => p.x)), maxX = Math.max(...xy.map((p) => p.x));
  const minY = Math.min(...xy.map((p) => p.y)), maxY = Math.max(...xy.map((p) => p.y));
  const span = Math.max(maxX - minX, maxY - minY, 1) * 1.15;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const s = Math.min(W, H - 40) / span;
  const X = (x) => W / 2 + (x - cx) * s;
  const Y = (y) => (H - 40) / 2 + 20 - (y - cy) * s;
  // North arrow and title.
  svg.append(svgEl("text", { x: 10, y: 18, "font-size": 13, "font-weight": 700, fill: "#2e2d2a" }, "Top View · 가능 영역 (#1)"));
  svg.append(svgEl("path", { d: `M${W - 24},40 l-6,14 h12 z`, fill: "#5f5e5a" }), svgEl("text", { x: W - 24, y: 34, "text-anchor": "middle", "font-size": 11, fill: "#5f5e5a" }, "N"));
  // Circles.
  if (finite(rollInNm)) svg.append(svgEl("circle", { cx: X(0), cy: Y(0), r: rollInNm * s, fill: "none", stroke: COLORS.circle, "stroke-dasharray": "6 4" }));
  if (finite(mapNm)) svg.append(svgEl("circle", { cx: X(0), cy: Y(0), r: mapNm * s, fill: "none", stroke: COLORS.circle }));
  if (finite(rollInNm)) svg.append(svgEl("text", { x: X(0) + rollInNm * s * 0.71 + 4, y: Y(0) + rollInNm * s * 0.71 + 12, "font-size": 10.5, fill: "#5f5e5a" }, `Roll-in ${rollInNm.toFixed(2)} NM`));
  if (finite(mapNm)) svg.append(svgEl("text", { x: X(0) + 4, y: Y(0) + mapNm * s + 12, "font-size": 10.5, fill: "#5f5e5a" }, `MAP ${mapNm.toFixed(2)} NM`));
  // Arcs: consecutive drawn points joined, solid / light by the weaker of the two.
  const drawn = [...points].filter((p) => p.level !== "bad" && p.rollIn).sort((a, b) => a.angleOffDeg - b.angleOffDeg);
  const onMap = (p) => ({ x: -mapNm * Math.sin(p.attackHeadingDeg * DEG), y: -mapNm * Math.cos(p.attackHeadingDeg * DEG) });
  const all = [...points].sort((a, b) => a.angleOffDeg - b.angleOffDeg);
  for (let i = 1; i < all.length; i += 1) {
    const a = all[i - 1], b = all[i];
    if (a.level === "bad" || b.level === "bad" || !a.rollIn || !b.rollIn) continue;
    const light = a.level === "warn" || b.level === "warn";
    const style = { "stroke-width": light ? 5 : 8, "stroke-linecap": "round", opacity: light ? 0.35 : 0.95 };
    svg.append(svgEl("line", { x1: X(a.rollIn.x), y1: Y(a.rollIn.y), x2: X(b.rollIn.x), y2: Y(b.rollIn.y), stroke: COLORS.yellow, ...style, "data-arc": "rollIn" }));
    if (finite(mapNm)) {
      const pa = onMap(a), pb = onMap(b);
      svg.append(svgEl("line", { x1: X(pa.x), y1: Y(pa.y), x2: X(pb.x), y2: Y(pb.y), stroke: COLORS.green, ...style, "data-arc": "attack" }));
    }
  }
  drawn.forEach((p, i) => {
    svg.append(svgEl("circle", { cx: X(p.rollIn.x), cy: Y(p.rollIn.y), r: 3, fill: p.level === "ok" ? COLORS.yellow : "#fff", stroke: COLORS.yellow, "stroke-width": 1.5 }));
    // The Offset Angle of every other point (every point when there are few).
    if (drawn.length <= 12 || i % 2 === 0) {
      const dx = p.rollIn.x, dy = p.rollIn.y, len = Math.hypot(dx, dy) || 1;
      svg.append(svgEl("text", { x: X(p.rollIn.x + (dx / len) * 0.18), y: Y(p.rollIn.y + (dy / len) * 0.18) + 4, "text-anchor": "middle", "font-size": 10, fill: "#7a5c00" }, `${Math.round(p.offsetAngleDeg)}°`));
    }
  });
  // The ends of the possible arcs.
  const range = summary?.possible;
  if (range && drawn.length) {
    const first = drawn[0], last = drawn[drawn.length - 1];
    const tag = (p, text) => svg.append(svgEl("text", { x: X(p.rollIn.x), y: Y(p.rollIn.y) - 10, "text-anchor": "middle", "font-size": 10.5, "font-weight": 700, fill: "#2e2d2a" }, text));
    tag(first, `AO ${Math.round(first.angleOffDeg)}° / ATK ${hdg(first.attackHeadingDeg)}`);
    if (last !== first) tag(last, `AO ${Math.round(last.angleOffDeg)}° / ATK ${hdg(last.attackHeadingDeg)}`);
  }
  // The flown path: VRP → Offset Turn → Approach → Roll-in → Track Point.
  if (g?.points) {
    const turn = Array.isArray(g.offsetTurnPath) ? g.offsetTurnPath : [];
    const turnEnd = turn.length ? turn[turn.length - 1] : g.points.vrp;
    const line = (pts, attrs) => svg.append(svgEl("path", { d: pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(""), fill: "none", ...attrs }));
    if (g.points.vrp) line([g.points.vrp, ...turn], { stroke: COLORS.path, "stroke-width": 2 });
    line([turnEnd, g.points.rollStart], { stroke: COLORS.path, "stroke-width": 2, "data-path": "approach" });
    if (Array.isArray(g.rollInTrajectorySamples)) line(g.rollInTrajectorySamples, { stroke: COLORS.path, "stroke-width": 2 });
    if (g.points.trackPoint) line([g.rollInTrajectorySamples?.at?.(-1) ?? g.points.rollStart, g.points.trackPoint, { x: 0, y: 0 }], { stroke: COLORS.path, "stroke-width": 1.5, "stroke-dasharray": "4 3" });
    if (finite(current.approachRangeNm)) {
      const mx = (turnEnd.x + g.points.rollStart.x) / 2, my = (turnEnd.y + g.points.rollStart.y) / 2;
      svg.append(svgEl("text", { x: X(mx) - 8, y: Y(my), "text-anchor": "end", "font-size": 11, "font-weight": 700, fill: "#2e2d2a" }, `APP ${current.approachRangeNm.toFixed(2)} NM`));
    }
    if (g.points.vrp) {
      svg.append(svgEl("rect", { x: X(g.points.vrp.x) - 5, y: Y(g.points.vrp.y) - 5, width: 10, height: 10, fill: "#2a78d6" }));
      svg.append(svgEl("text", { x: X(g.points.vrp.x) + 9, y: Y(g.points.vrp.y) + 4, "font-size": 11, fill: "#2a78d6" }, "VRP"));
    }
    if (current.popPoint) {
      svg.append(svgEl("circle", { cx: X(current.popPoint.x), cy: Y(current.popPoint.y), r: 4.5, fill: "#8e5bd6" }));
      svg.append(svgEl("text", { x: X(current.popPoint.x) - 8, y: Y(current.popPoint.y) + 4, "text-anchor": "end", "font-size": 10.5, fill: "#8e5bd6" }, "Pop"));
    }
    // The Attack Heading: a red line through the Target from the Roll-in circle.
    const h = finite(current.attackHeadingDeg) ? current.attackHeadingDeg : g.attackHeadingDeg;
    if (finite(h) && finite(rollInNm)) {
      const r = rollInNm * 1.15;
      const from = { x: -r * Math.sin(h * DEG), y: -r * Math.cos(h * DEG) };
      const to = { x: 0.35 * r * Math.sin(h * DEG), y: 0.35 * r * Math.cos(h * DEG) };
      svg.append(svgEl("line", { x1: X(from.x), y1: Y(from.y), x2: X(to.x), y2: Y(to.y), stroke: COLORS.red, "stroke-width": 2.5, "data-attack-heading": "" }));
      svg.append(svgEl("text", { x: X(to.x) + 6, y: Y(to.y) - 4, "font-size": 11, "font-weight": 700, fill: COLORS.red }, `ATK ${hdg(h)}`));
    }
  }
  // Target.
  svg.append(svgEl("circle", { cx: X(0), cy: Y(0), r: 5, fill: "#2e2d2a" }));
  svg.append(svgEl("text", { x: X(0) + 8, y: Y(0) - 6, "font-size": 11, fill: "#2e2d2a" }, "Target"));
  // Legend.
  const ly = H - 12;
  const key = (x, color, opacity, text) => {
    svg.append(svgEl("line", { x1: x, x2: x + 22, y1: ly - 4, y2: ly - 4, stroke: color, "stroke-width": 7, opacity, "stroke-linecap": "round" }));
    svg.append(svgEl("text", { x: x + 28, y: ly, "font-size": 10.5, fill: "#2e2d2a" }, text));
  };
  key(10, COLORS.yellow, 0.95, "Roll-in Point (≥ 2 s)");
  key(150, COLORS.yellow, 0.35, "0–2 s");
  key(225, COLORS.green, 0.95, "Attack Heading");
  key(345, COLORS.red, 1, "선택한 Attack Heading");
}
