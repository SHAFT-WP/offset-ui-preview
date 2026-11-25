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

// 0.1.8 (owner 2026-11-23, the Offset page's planning steps): `labels` gives the level names, the footer and the point
// tooltip's last part, so the Offset Design tab draws its region with the same picture (no Approach-Pop there). The
// defaults are the POP-UP texts, unchanged.
// 0.1.11 (owner 2026-11-24, "2초 라인의 범위를 연한 색으로 표현해주라. 오프셋도 마찬가지"): a point may carry `min`, the same
// Angle Off flown with the Tracking Time at 2 s (the region modules' regionTask). Between each Roll-in Point and its
// 2 s point a light yellow band is drawn (where the point itself is not drawn, the 2 s line alone), the 2 s points
// joined by a light line; a legend row says so. The point tooltip gives its Tracking Time.
export const POPUP_DESIGN_TOPVIEW_V0_1 = Object.freeze({ id: "popup-design-topview-v0.1", version: "0.1.13", canvas: Object.freeze({ width: 640, height: 600 }) });
const POPUP_LABELS = Object.freeze({
  ok: "App-Pop Time ≥ 2초", warn: "App-Pop Time 0–2초", okDot: "≥ 2초 점", warnDot: "0–2초 점",
  footer: "R/L = Roll-in 방향 · App-Pop = Approach-Pop",
  pointTail: (p) => ` · Approach-Pop ${p.holdDownSec.toFixed(1)} s`,
});

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
export function renderRegionTopView(svg, { points: worldPoints = [], current: worldCurrent = null, summaries = {}, upHeadingDeg = 0, labels: labelsIn = null, maxJoinDeg = Infinity, marks: worldMarks = [], ghosts: worldGhosts = [], aircraftLabel = "#1" } = {}) {
  const labels = { ...POPUP_LABELS, ...(labelsIn ?? {}) };
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
  const points = worldPoints.filter((p) => !shownSide || p.rollDirection === shownSide).map((p) => ({ ...p, rollIn: turn(p.rollIn), attackHeadingDeg: turnHdg(p.attackHeadingDeg), min: p.min ? { ...p.min, rollIn: turn(p.min.rollIn) } : null }));
  // The 2 s points that fly (0.1.11).
  const minOk = (p) => !!p.min && p.min.level !== "bad" && pt(p.min.rollIn);
  const banded = points.some(minOk);
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
  // 0.1.6 (owner sketch 2026-11-20 "위 그림이 원하던 것", re-read 2026-11-22): the green arc is on the Roll-in Distance line, on
  // the far side of the Target the way each Attack Heading points (the arrow side): the point at the Roll-in Point's own
  // Roll-in Distance from the Target, along its Attack Heading. Yellow and green so sit on the same dashed line, the MAP
  // circle inside it. (0.1.3–0.1.5 drew it at each point's MAP, which put it outside the drawn MAP circle.)
  // 0.1.7 (owner 2026-11-22, "기체가 롤인 후 정확히 트랙포인트로 들어가려면 map에 들어가야"): the green arc is on the drawn MAP
  // circle; then (23:32Z, "초록원이 반대쪽으로 가야 한다. attack 화살표로 가는 쪽") on the side each Attack Heading points to, past the
  // Target (where the red arrow ends). The current MAP is used
  // for every point so the arc lies on the circle; each point's own MAP (it changes a little with the Angle Off) is in its
  // tooltip.
  const attackMark = (p) => { const r = finite(mapNm) ? mapNm : Math.hypot(p.rollIn.x, p.rollIn.y); return { x: r * Math.sin(p.attackHeadingDeg * DEG), y: r * Math.cos(p.attackHeadingDeg * DEG) }; };
  // 0.1.12 (Offset step 5, owner 2026-11-25 "2번기 ... 탑뷰에서 1번기의 영역도"): ghosts = other aircraft's regions,
  // drawn under this one in grey: [{ label, points (region points), geometry (its flown answer) }], each on its own
  // Roll-in side; included in the extent.
  const ghosts = (worldGhosts ?? []).map((gh) => {
    const side = gh.geometry?.direction?.rollDirection ?? null;
    const gg = gh.geometry;
    return {
      label: gh.label ?? "",
      points: (gh.points ?? []).filter((p) => p && p.level !== "bad" && pt(p.rollIn) && (!side || p.rollDirection === side)).map((p) => ({ ...p, rollIn: turn(p.rollIn), attackHeadingDeg: turnHdg(p.attackHeadingDeg) })).sort((a, b) => a.angleOffDeg - b.angleOffDeg),
      attackHeadingDeg: turnHdg(gg?.attackHeadingDeg),
      geometry: gg ? { points: turnPoints(gg.points), offsetTurnPath: (gg.offsetTurnPath ?? []).map(turn), rollInTrajectorySamples: (gg.rollInTrajectorySamples ?? []).map(turn) } : null,
    };
  });
  // Extent: the MAP circle, the Roll-in Points, the VRP and the flown path.
  const xy = [...ghosts.flatMap((gh) => [...gh.points.map((p) => p.rollIn), ...(pt(gh.geometry?.points?.vrp) ? [gh.geometry.points.vrp] : []), ...(gh.geometry?.offsetTurnPath ?? []).filter(pt)]), { x: 0, y: 0 }, ...withRollIn.map((p) => p.rollIn), ...withRollIn.map(attackMark), ...points.filter(minOk).map((p) => p.min.rollIn)];
  if (finite(mapNm)) xy.push({ x: mapNm * 1.3, y: mapNm * 1.3 }, { x: -mapNm * 1.3, y: -mapNm * 1.3 });
  if (pt(g?.points?.vrp)) xy.push(g.points.vrp);
  for (const p of g?.offsetTurnPath ?? []) if (pt(p)) xy.push(p);
  const minX = Math.min(...xy.map((p) => p.x)), maxX = Math.max(...xy.map((p) => p.x));
  const minY = Math.min(...xy.map((p) => p.y)), maxY = Math.max(...xy.map((p) => p.y));
  const top = 34, bottom = banded ? 78 : 62;
  const noteY = H - (banded ? 60 : 44);
  const span = Math.max((maxX - minX) / W, (maxY - minY) / (H - top - bottom), 1e-3) * 1.12;
  const s = 1 / span;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const X = (x) => W / 2 + (x - cx) * s;
  const Y = (y) => top + (H - top - bottom) / 2 - (y - cy) * s;
  const P = (p) => ({ x: X(p.x), y: Y(p.y) });
  const d = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");

  svg.append(svgEl("text", { x: 10, y: 20, "font-size": 13, "font-weight": 700, fill: "#2e2d2a" }, `Top View · 가능 영역 (${aircraftLabel}, ${shownSide === "RIGHT" ? "오른쪽(R) Roll-in" : shownSide === "LEFT" ? "왼쪽(L) Roll-in" : "양쪽 Roll-in"})`));
  appendNorthMark(svg, { cx: W - 26, cy: 34, size: 14, rotationDeg: -up });

  // Ghost regions (grey, under everything): Roll-in arc, Attack Heading arc, the flown path, a label.
  const GHOST = "#8a8f98";
  const ghostLabels = [];
  for (const gh of ghosts) {
    const pts = gh.points;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1], b = pts[i];
      if (b.angleOffDeg - a.angleOffDeg > maxJoinDeg) continue;
      svg.append(svgEl("line", { x1: X(a.rollIn.x), y1: Y(a.rollIn.y), x2: X(b.rollIn.x), y2: Y(b.rollIn.y), stroke: GHOST, "stroke-width": 6, "stroke-linecap": "round", opacity: 0.45, "data-ghost-arc": "rollIn" }));
      const pa = attackMark(a), pb = attackMark(b);
      svg.append(svgEl("line", { x1: X(pa.x), y1: Y(pa.y), x2: X(pb.x), y2: Y(pb.y), stroke: GHOST, "stroke-width": 6, "stroke-linecap": "round", opacity: 0.3, "data-ghost-arc": "attack" }));
    }
    for (const p of pts) {
      const dot = svgEl("circle", { cx: X(p.rollIn.x), cy: Y(p.rollIn.y), r: 2.5, fill: GHOST, opacity: 0.7, "data-ghost-point": `${gh.label}${p.angleOffDeg}` });
      dot.append(svgEl("title", {}, `${gh.label} Roll-in · Angle Off ${Math.round(p.angleOffDeg)}° · Attack Heading ${hdg(p.attackHeadingDeg + up)}${finite(p.offsetAngleDeg) ? ` · Offset Angle ${Math.abs(p.offsetAngleDeg).toFixed(1)}°` : ""}`));
      svg.append(dot);
    }
    const gp = gh.geometry?.points;
    if (gp) {
      const path = [gp.vrp, ...(gh.geometry.offsetTurnPath ?? []), gp.rollStart, ...(gh.geometry.rollInTrajectorySamples ?? []), gp.trackPoint].filter(pt);
      if (path.length >= 2) svg.append(svgEl("path", { d: d(path), fill: "none", stroke: GHOST, "stroke-width": 2, "stroke-dasharray": "5 4", "data-ghost-path": gh.label }));
      // At the start of its path (its VRP), clear of this aircraft's labels around the Roll-in.
      const at = pt(gp.vrp) ? gp.vrp : pt(gp.rollStart) ? gp.rollStart : pts[0]?.rollIn;
      // 0.1.13 (owner 2026-11-25, "#1의 어택헤딩도 표현해 주고"): its Attack Heading, a grey arrow through the Target.
      if (finite(gh.attackHeadingDeg)) {
        const r = finite(mapNm) ? mapNm : 1;
        const ux = Math.sin(gh.attackHeadingDeg * DEG), uy = Math.cos(gh.attackHeadingDeg * DEG);
        const a = { x: -ux * r, y: -uy * r }, b = { x: ux * r * 1.3, y: uy * r * 1.3 };
        svg.append(svgEl("path", { d: d([a, b]), fill: "none", stroke: GHOST, "stroke-width": 2.5, "stroke-dasharray": "8 5", "marker-end": arrow("ghost-attack", GHOST), "data-ghost-attack": gh.label }));
        ghostLabels.push(svgEl("text", { x: X(b.x) + 6, y: Y(b.y) + 4, "font-size": 11, "font-weight": 700, fill: "#5f5e5a", "data-region-end": "ghost" }, `${gh.label} Attack ${hdg(gh.attackHeadingDeg + up)}°`));
      }
      // Written last (over the arcs), moved clear of the other labels as an end tag.
      if (pt(at)) ghostLabels.push(svgEl("text", { x: X(at.x) - 10, y: Y(at.y) - 8, "text-anchor": "end", "font-size": 12, "font-weight": 800, fill: "#5f5e5a", "data-ghost-label": gh.label, "data-region-end": "ghost" }, `${gh.label} (회색)`));
    }
  }
  // MAP circle.
  if (finite(mapNm)) {
    svg.append(svgEl("circle", { cx: X(0), cy: Y(0), r: mapNm * s, fill: "none", stroke: C.attack, "stroke-width": 1.4, "stroke-dasharray": "9 7", "data-top": "map" }));
    // Written low on the circle, on the side away from the Roll-in Points (0.1.4: clear of the Roll-in path).
    const xs = points.filter((q) => pt(q.rollIn)).map((q) => q.rollIn.x);
    const away = xs.length && xs.reduce((a, b) => a + b, 0) / xs.length < 0 ? 1 : -1;
    const r = mapNm * s;
    svg.append(svgEl("text", { x: X(0) + away * (r * 0.72 + 6), y: Y(0) + r * 0.72 + 14, "text-anchor": away > 0 ? "start" : "end", "font-size": 10.5, fill: C.attackText, "data-region-end": "map" }, `MAP ${mapNm.toFixed(2)} NM`));
  }
  // Roll-in Distance: per Roll-in side, the line through every Roll-in Point the BE solved (Angle Off order).
  if (withRollIn.length >= 2) {
    for (const side of sides) {
      const line = withRollIn.filter((p) => p.rollDirection === side).sort((a, b) => a.angleOffDeg - b.angleOffDeg);
      if (line.length >= 2 && Number.isFinite(maxJoinDeg) && line.some((p, i) => i && p.angleOffDeg - line[i - 1].angleOffDeg > maxJoinDeg)) continue;
      if (line.length >= 2) {
        svg.append(svgEl("path", { d: d(line.map((p) => p.rollIn)), fill: "none", stroke: REGION_COLORS.circle, "stroke-width": 1.2, "stroke-dasharray": "6 4", "data-top": "roll-in-distance", "data-side": side }));
      }
    }
    const dist = withRollIn.map((p) => Math.hypot(p.rollIn.x, p.rollIn.y));
    svg.append(svgEl("text", { x: 10, y: noteY, "font-size": 10.5, fill: "#5f5e5a", "data-legend-note": "" }, `Roll-in Distance (점선) ${Math.min(...dist).toFixed(2)}–${Math.max(...dist).toFixed(2)} NM · Angle Off에 따라 바뀜`));
  }
  // 0.1.11: the Tracking Time 2 s band, per side, under the arcs: from each Roll-in Point (or, where the point is not
  // drawn, its 2 s point) to its 2 s point, consecutive Angle Offs joined; the 2 s points joined by a light line.
  for (const side of sides) {
    const all = points.filter((p) => p.rollDirection === side || (!p.rollDirection && p.min?.rollDirection === side)).sort((a, b) => a.angleOffDeg - b.angleOffDeg);
    const outer = (p) => (p.level !== "bad" && pt(p.rollIn) ? p.rollIn : p.min.rollIn);
    for (let i = 1; i < all.length; i += 1) {
      const a = all[i - 1], b = all[i];
      if (!minOk(a) || !minOk(b) || b.angleOffDeg - a.angleOffDeg > maxJoinDeg) continue;
      const band = svgEl("path", { d: `${d([outer(a), outer(b), b.min.rollIn, a.min.rollIn])}Z`, fill: REGION_COLORS.yellow, "fill-opacity": 0.2, stroke: "none", "data-band": side });
      band.append(svgEl("title", {}, `Tracking Time 2 s까지 · Angle Off ${Math.round(a.angleOffDeg)}–${Math.round(b.angleOffDeg)}°`));
      svg.append(band, svgEl("line", { x1: X(a.min.rollIn.x), y1: Y(a.min.rollIn.y), x2: X(b.min.rollIn.x), y2: Y(b.min.rollIn.y), stroke: REGION_COLORS.yellow, "stroke-width": 2.5, opacity: 0.55, "stroke-linecap": "round", "data-band-edge": side }));
    }
    for (const p of all.filter(minOk)) {
      const q = p.min;
      // Not drawn (a hollow dot reads as a WARNING point): a clear hover target for the tooltip only.
      const dot = svgEl("circle", { cx: X(q.rollIn.x), cy: Y(q.rollIn.y), r: 4, fill: "transparent", stroke: "none", "data-band-point": `${SIDE_TEXT[side]}${p.angleOffDeg}` });
      dot.append(svgEl("title", {}, `Tracking 2 s · Angle Off ${Math.round(p.angleOffDeg)}° · Roll-in Distance ${Math.hypot(q.rollIn.x, q.rollIn.y).toFixed(2)} NM${finite(q.rollInAltitudeFlownFt) ? ` · Roll-in ${Math.round(q.rollInAltitudeFlownFt).toLocaleString("en-US")} ft` : ""}${finite(q.mapNm) ? ` · MAP ${q.mapNm.toFixed(2)} NM` : ""}${finite(q.offsetAngleDeg) ? ` · Offset Angle ${Math.abs(q.offsetAngleDeg).toFixed(1)}°` : ""}`));
      svg.append(dot);
    }
  }
  // Region arcs, per side: consecutive Angle Offs joined, solid / light by the weaker of the two.
  for (const side of sides) {
    const all = points.filter((p) => p.rollDirection === side).sort((a, b) => a.angleOffDeg - b.angleOffDeg);
    for (let i = 1; i < all.length; i += 1) {
      const a = all[i - 1], b = all[i];
      // 0.1.9 (Offset step 3, 2026-11-24): points farther apart than maxJoinDeg of Angle Off are not joined (a gap,
      // or separate solutions); the default joins all as before.
      if (a.level === "bad" || b.level === "bad" || !pt(a.rollIn) || !pt(b.rollIn) || b.angleOffDeg - a.angleOffDeg > maxJoinDeg) continue;
      const light = a.level === "warn" || b.level === "warn";
      const style = { "stroke-width": light ? 5 : 8, "stroke-linecap": "round", opacity: light ? 0.35 : 0.9 };
      svg.append(svgEl("line", { x1: X(a.rollIn.x), y1: Y(a.rollIn.y), x2: X(b.rollIn.x), y2: Y(b.rollIn.y), stroke: REGION_COLORS.yellow, ...style, "data-arc": "rollIn", "data-side": side }));
      {
        const pa = attackMark(a), pb = attackMark(b);
        svg.append(svgEl("line", { x1: X(pa.x), y1: Y(pa.y), x2: X(pb.x), y2: Y(pb.y), stroke: REGION_COLORS.green, ...style, "data-arc": "attack", "data-side": side }));
      }
    }
    const drawn = all.filter((p) => p.level !== "bad" && pt(p.rollIn));
    for (const p of drawn) {
      const dot = svgEl("circle", { cx: X(p.rollIn.x), cy: Y(p.rollIn.y), r: 3, fill: p.level === "ok" ? REGION_COLORS.yellow : "#fff", stroke: REGION_COLORS.yellow, "stroke-width": 1.5, "data-region-point": `${SIDE_TEXT[side]}${p.angleOffDeg}` });
      dot.append(svgEl("title", {}, `${side === "RIGHT" ? "오른쪽" : "왼쪽"} Roll-in · Angle Off ${Math.round(p.angleOffDeg)}° · Attack Heading ${hdg(p.attackHeadingDeg + up)} · Offset Angle ${p.offsetAngleDeg.toFixed(1)}° · Roll-in Distance ${Math.hypot(p.rollIn.x, p.rollIn.y).toFixed(2)} NM · MAP ${finite(p.mapNm) ? p.mapNm.toFixed(2) : "-"} NM${finite(p.trackingTimeSec) ? ` · Track ${p.trackingTimeSec.toFixed(1)} s` : ""} · Approach ${p.approachRangeNm.toFixed(2)} NM${labels.pointTail(p)}`));
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
      // inward: written inside the circle (the green tags, so they keep clear of the Roll-in Points and the path).
      const tagAt = (q, text, color, inward = false) => {
        const out = (q.x < 0 ? -1 : 1) * (inward ? -1 : 1);
        const len = Math.hypot(q.x, q.y) || 1;
        const k = (inward ? -14 : 22) / s;
        svg.append(svgEl("text", { x: X(q.x + (q.x / len) * k) + out * 4, y: Y(q.y + (q.y / len) * k) + 4, "text-anchor": out < 0 ? "end" : "start", "font-size": 10.5, "font-weight": 700, fill: color, "data-region-end": side }, text));
      };
      // Yellow end: its Angle Off; green end: the Attack Heading it gives.
      const tag = (p) => {
        tagAt(p.rollIn, `${SIDE_TEXT[side]} AO ${Math.round(p.angleOffDeg)}°`, "#2e2d2a");
        tagAt(attackMark(p), `Attack ${hdg(p.attackHeadingDeg + up)}°`, "#0f7a52", true);
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
  // 0.1.10 (Offset step 3, owner 2026-11-24 "가용 오프셋 영역이나 헤딩 영역 그래프가 나오지 않고 그냥 픽스된 값만"): marks = the
  // points that fit a set value (the Roll-in Altitude held: the Angle Offs giving the set Offset Angle), drawn as red
  // rings on the region (Roll-in Point and Attack Heading) with their Angle Off.
  for (const m of worldMarks) {
    if (!pt(m?.rollIn) || !finite(m.angleOffDeg) || (shownSide && m.rollDirection && m.rollDirection !== shownSide)) continue;
    const q = { ...m, rollIn: turn(m.rollIn), attackHeadingDeg: turnHdg(m.attackHeadingDeg) };
    const ring = (c) => svgEl("circle", { cx: X(c.x), cy: Y(c.y), r: 7, fill: "none", stroke: REGION_COLORS.red, "stroke-width": 2.2, "data-region-mark": String(m.angleOffDeg) });
    const r1 = ring(q.rollIn);
    r1.append(svgEl("title", {}, `${m.label ?? ""}Angle Off ${m.angleOffDeg.toFixed(1)}° · Attack Heading ${finite(m.attackHeadingDeg) ? hdg(m.attackHeadingDeg) : "-"} · Offset Angle ${finite(m.offsetAngleDeg) ? Math.abs(m.offsetAngleDeg).toFixed(1) : "-"}°`));
    svg.append(r1);
    if (finite(q.attackHeadingDeg)) svg.append(ring(attackMark(q)));
    const len = Math.hypot(q.rollIn.x, q.rollIn.y) || 1;
    const k = -20 / s;
    svg.append(svgEl("text", { x: X(q.rollIn.x + (q.rollIn.x / len) * k), y: Y(q.rollIn.y + (q.rollIn.y / len) * k) + 4, "text-anchor": "middle", "font-size": 11, "font-weight": 700, fill: REGION_COLORS.red, "data-region-end": "mark" }, `AO ${m.angleOffDeg.toFixed(1)}°`));
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
  // 0.1.13 (owner 2026-11-25): the legend stays on screen when zoomed (pinTopView), on a white band.
  const lg = svgEl("g", { "data-pin": "screen" });
  lg.append(svgEl("rect", { x: 0, y: noteY - 14, width: W, height: H - noteY + 14, fill: "#fff", opacity: 0.92 }));
  svg.append(lg);
  for (const note of svg.querySelectorAll("[data-legend-note]")) lg.append(note); // over the band, pinned with it
  const key = (x, y, color, opacity, text) => {
    lg.append(svgEl("line", { x1: x, x2: x + 20, y1: y - 4, y2: y - 4, stroke: color, "stroke-width": 7, opacity, "stroke-linecap": "round" }));
    lg.append(svgEl("text", { x: x + 25, y, "font-size": 10.5, fill: "#2e2d2a" }, text));
  };
  const dot = (x, y, filled, text) => {
    lg.append(svgEl("circle", { cx: x + 10, cy: y - 4, r: 3.5, fill: filled ? REGION_COLORS.yellow : "#fff", stroke: REGION_COLORS.yellow, "stroke-width": 1.5 }));
    lg.append(svgEl("text", { x: x + 25, y, "font-size": 10.5, fill: "#2e2d2a" }, text));
  };
  key(10, ly1, REGION_COLORS.yellow, 0.9, `Roll-in Point · ${labels.ok}`);
  key(236, ly1, REGION_COLORS.yellow, 0.35, `Roll-in Point · ${labels.warn}`);
  dot(462, ly1, true, labels.okDot);
  dot(540, ly1, false, labels.warnDot);
  key(10, ly, REGION_COLORS.green, 0.9, `Attack Heading · ${labels.ok}`);
  key(236, ly, REGION_COLORS.green, 0.35, `Attack Heading · ${labels.warn}`);
  key(462, ly, REGION_COLORS.red, 1, "선택한 Attack Heading");
  if (banded) {
    const ly2 = H - 42;
    lg.append(svgEl("rect", { x: 10, y: ly2 - 10, width: 20, height: 9, fill: REGION_COLORS.yellow, "fill-opacity": 0.2 }));
    lg.append(svgEl("line", { x1: 10, x2: 30, y1: ly2 - 1.5, y2: ly2 - 1.5, stroke: REGION_COLORS.yellow, "stroke-width": 2.5, opacity: 0.55 }));
    // Reworded (owner 2026-11-25, "색이 칠해진 부분과 점으로만 표현되 지점의 차이는"): solid = as set now, light = Tracking Time cut to 2 s.
    lg.append(svgEl("text", { x: 35, y: ly2, "font-size": 10.5, fill: "#2e2d2a" }, "진한 띠 = 지금 조건 · 연한 띠/점선 = Tracking Time을 2 s까지 줄이면 (Roll-in 고도 바뀜)"));
  }
  lg.append(svgEl("text", { x: W - 8, y: noteY, "text-anchor": "end", "font-size": 10.5, fill: "#5f5e5a" }, labels.footer));
  svg.append(...ghostLabels);
  untangleLabels(svg);
}

// Keeps the legend (data-pin="screen") on screen at its 100% size for the visible box { x, y, w, h } (call on every zoom
// / pan and after a render).
export function pinTopView(svg, box) {
  const W = POPUP_DESIGN_TOPVIEW_V0_1.canvas.width;
  if (!box || !(box.w > 0)) return;
  const k = box.w / W;
  for (const node of svg.querySelectorAll('[data-pin="screen"]')) {
    if (k === 1 && box.x === 0 && box.y === 0) node.removeAttribute("transform");
    else node.setAttribute("transform", `translate(${box.x} ${box.y}) scale(${k})`);
  }
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
  for (const line of svg.querySelectorAll("line[data-arc]")) {
    const [x1, y1, x2, y2] = ["x1", "y1", "x2", "y2"].map((k) => Number(line.getAttribute(k)));
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 4));
    for (let i = 0; i <= n; i += 1) placed.push({ x: x1 + ((x2 - x1) * i) / n - 4, y: y1 + ((y2 - y1) * i) / n - 4, w: 8, h: 8 });
  }
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
    for (const [dx, dy] of [[out * 10, 0], [0, 13], [0, -13], [out * 10, 13], [out * 10, -13], [out * 20, 0], [out * 20, 13], [-out * 30, 13], [-out * 30, 26], [out * 30, 26]]) {
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
