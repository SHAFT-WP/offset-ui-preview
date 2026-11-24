// Offset Design step 3, the VRP × Angle Off map (owner 2026-11-24: "오프셋은 파라가 적어서 오프셋 조건 주면 그냥 결정되는 것
// 같아. vrp와 오프셋 앵글을 변수로 가용 앵글 오프를 그려주면 어떨까?"). With the Roll-in Altitude held, a VRP and an Angle
// Off decide the Offset Angle (VRP + Angle Off LOCK, one Flight solve each, offset-design-region-v0.1 regionPoint). The map
// shows that Offset Angle for every cell (sequential blue, one hue), the cells that do not fly left empty, WARNING
// cells hatched, the wanted Offset Angle as a line through the cells where it is crossed, and the page's own VRP /
// Angle Off as a ring. Reading it: pick a VRP row, follow it to the line, read the Angle Off; or pick an Offset Angle
// (the colour) and see the VRP / Angle Off pairs that give it. Pure SVG drawing: no calculation, no storage.
export const OFFSET_DESIGN_VRP_MAP_V0_1 = Object.freeze({ id: "offset-design-vrp-map-v0.1", version: "0.1.0", canvas: Object.freeze({ width: 640, height: 380 }) });

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}, text = null) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== null) n.textContent = text;
  return n;
};
const finite = (v) => Number.isFinite(v);
// Sequential blue (reference palette, steps 150 → 650): light → dark on a light surface, reversed on a dark one so
// small values recede toward the surface in both.
const RAMP = ["#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281"];
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => { const x = hexToRgb(a), y = hexToRgb(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`; };
function rampColor(t, dark) {
  const u = Math.min(1, Math.max(0, dark ? 1 - t : t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(u));
  return mix(RAMP[i], RAMP[i + 1], u - i);
}
const surfaceIsDark = (svg) => {
  let node = svg;
  while (node && node.nodeType === 1) {
    const bg = getComputedStyle(node).backgroundColor;
    const m = bg && bg.match(/rgba?\(([^)]+)\)/);
    if (m) { const [r, g, b, a = 1] = m[1].split(",").map(Number); if (a > 0.5) return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128; }
    node = node.parentElement;
  }
  return false;
};

// cells: [{ vrpRangeNm, angleOffDeg, offsetAngleDeg, level, attackHeadingDeg, approachRangeNm, approachSec, messages }]
// options: { vrps, angleOffs, targetOffsetAngleDeg, current: { vrpRangeNm, angleOffDeg }, onPick(cell) }
export function renderVrpMap(svg, cells, { vrps = [], angleOffs = [], targetOffsetAngleDeg = null, current = null, onPick = null } = {}) {
  const { width: W, height: H } = OFFSET_DESIGN_VRP_MAP_V0_1.canvas;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.replaceChildren();
  const dark = surfaceIsDark(svg);
  const ink = dark ? "#e8e6e1" : "#2e2d2a";
  const muted = dark ? "#a3a19b" : "#6b6a65";
  const grid = dark ? "#3a3a37" : "#e4e2dd";
  const accent = "#e0563b";
  const L = 58, R = 18, T = 34, B = 74;
  const pw = W - L - R, ph = H - T - B;
  if (!vrps.length || !angleOffs.length) return;
  const cw = pw / angleOffs.length, ch = ph / vrps.length;
  const col = new Map(angleOffs.map((a, i) => [a, i]));
  const row = new Map(vrps.map((v, i) => [v, vrps.length - 1 - i])); // larger VRP on top
  const X = (ao) => L + (col.get(ao) + 0.5) * cw;
  const Xc = (ao) => L + ((ao - angleOffs[0]) / (angleOffs.at(-1) - angleOffs[0])) * (pw - cw) + cw / 2;
  const Y = (v) => T + (row.get(v) + 0.5) * ch;
  const defs = svgEl("defs");
  const hatch = svgEl("pattern", { id: "vrp-map-hatch", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
  hatch.append(svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: dark ? "#1b1b19" : "#ffffff", "stroke-width": 2, opacity: 0.7 }));
  defs.append(hatch);
  svg.append(defs);
  svg.append(svgEl("text", { x: 10, y: 20, "font-size": 13, "font-weight": 700, fill: ink }, "VRP × Angle Off · 칸 색 = Offset Angle (Roll-in 고도 고정)"));
  const flying = cells.filter((c) => (c.level === "ok" || c.level === "warn") && finite(c.offsetAngleDeg));
  const oas = flying.map((c) => Math.abs(c.offsetAngleDeg));
  const lo = oas.length ? Math.min(...oas) : 0, hi = oas.length ? Math.max(...oas) : 1;
  const tOf = (oa) => (hi > lo ? (Math.abs(oa) - lo) / (hi - lo) : 0.5);
  // Rows' guide lines (recessive) and axes.
  for (const v of vrps) svg.append(svgEl("line", { x1: L, x2: L + pw, y1: Y(v), y2: Y(v), stroke: grid, "stroke-width": 1 }));
  const gap = 1; // surface gap between cells
  for (const c of cells) {
    if (!col.has(c.angleOffDeg) || !row.has(c.vrpRangeNm)) continue;
    const x = L + col.get(c.angleOffDeg) * cw, y = T + row.get(c.vrpRangeNm) * ch;
    const g = svgEl("g", { "data-vrp-cell": `${c.vrpRangeNm}/${c.angleOffDeg}`, style: onPick && (c.level === "ok" || c.level === "warn") ? "cursor:pointer" : "" });
    const ok = c.level === "ok" || c.level === "warn";
    if (ok && finite(c.offsetAngleDeg)) {
      g.append(svgEl("rect", { x: x + gap, y: y + gap, width: Math.max(1, cw - 2 * gap), height: Math.max(1, ch - 2 * gap), rx: 2, fill: rampColor(tOf(c.offsetAngleDeg), dark) }));
      if (c.level === "warn") g.append(svgEl("rect", { x: x + gap, y: y + gap, width: Math.max(1, cw - 2 * gap), height: Math.max(1, ch - 2 * gap), rx: 2, fill: "url(#vrp-map-hatch)" }));
    }
    // The hit target is the whole cell (bigger than the fill).
    const hit = svgEl("rect", { x, y, width: cw, height: ch, fill: "transparent" });
    hit.append(svgEl("title", {}, ok
      ? `VRP ${c.vrpRangeNm} NM · Angle Off ${c.angleOffDeg}° → Offset Angle ${Math.abs(c.offsetAngleDeg).toFixed(1)}° · Attack ${String(Math.round(((c.attackHeadingDeg % 360) + 360) % 360)).padStart(3, "0")}° · Approach ${finite(c.approachRangeNm) ? c.approachRangeNm.toFixed(2) : "-"} NM${finite(c.approachSec) ? ` / ${c.approachSec.toFixed(1)} s` : ""}${c.level === "warn" ? " · WARNING" : ""}${onPick ? " · 누르면 이 VRP와 Angle Off를 넣음" : ""}`
      : `VRP ${c.vrpRangeNm} NM · Angle Off ${c.angleOffDeg}° · 날 수 없음${c.messages?.[0] ? ` (${c.messages[0]})` : ""}`));
    g.append(hit);
    if (onPick && ok) g.addEventListener("click", () => onPick(c));
    svg.append(g);
  }
  // The wanted Offset Angle: per VRP row, the Angle Off where it is crossed (linear between flying neighbours).
  const want = Math.abs(Number(targetOffsetAngleDeg));
  const crossings = [];
  if (want > 0) {
    for (const v of vrps) {
      const r = flying.filter((c) => c.vrpRangeNm === v).sort((a, b) => a.angleOffDeg - b.angleOffDeg);
      for (let i = 1; i < r.length; i += 1) {
        const a = r[i - 1], b = r[i];
        if (b.angleOffDeg - a.angleOffDeg > (angleOffs[1] - angleOffs[0]) + 1e-6) continue;
        const da = Math.abs(a.offsetAngleDeg) - want, db = Math.abs(b.offsetAngleDeg) - want;
        if (da === 0 || Math.sign(da) !== Math.sign(db)) {
          const ao = a.angleOffDeg + (da / (da - db || 1)) * (b.angleOffDeg - a.angleOffDeg);
          crossings.push({ vrpRangeNm: v, angleOffDeg: ao });
        }
      }
    }
    for (const p of crossings) {
      svg.append(svgEl("circle", { cx: Xc(p.angleOffDeg), cy: Y(p.vrpRangeNm), r: 4, fill: accent, stroke: dark ? "#1b1b19" : "#ffffff", "stroke-width": 2, "data-vrp-cross": `${p.vrpRangeNm}/${p.angleOffDeg.toFixed(1)}` }));
    }
  }
  // The page's VRP / Angle Off (nearest cell centre in VRP, exact in Angle Off).
  if (current && finite(current.vrpRangeNm) && finite(current.angleOffDeg)) {
    const nearest = vrps.reduce((b, v) => (Math.abs(v - current.vrpRangeNm) < Math.abs(b - current.vrpRangeNm) ? v : b), vrps[0]);
    if (Math.abs(nearest - current.vrpRangeNm) <= 0.5 && current.angleOffDeg >= angleOffs[0] && current.angleOffDeg <= angleOffs.at(-1)) {
      svg.append(svgEl("circle", { cx: Xc(current.angleOffDeg), cy: Y(nearest), r: 7, fill: "none", stroke: ink, "stroke-width": 2, "data-vrp-current": "" }));
    }
  }
  // Axes: Angle Off below (every 30°), VRP Range left (every row).
  for (const a of angleOffs) if (a % 30 === 0) svg.append(svgEl("text", { x: X(a), y: T + ph + 14, "text-anchor": "middle", "font-size": 10.5, fill: muted }, `${a}°`));
  svg.append(svgEl("text", { x: L + pw / 2, y: T + ph + 30, "text-anchor": "middle", "font-size": 11, fill: muted }, "Angle Off"));
  for (const v of vrps) svg.append(svgEl("text", { x: L - 6, y: Y(v) + 4, "text-anchor": "end", "font-size": 10.5, fill: muted }, String(v)));
  svg.append(svgEl("text", { x: 12, y: T + ph / 2, "text-anchor": "middle", "font-size": 11, fill: muted, transform: `rotate(-90 12 ${T + ph / 2})` }, "VRP Range (NM)"));
  // Legend: the ramp with its ends, the line, the ring, WARNING, empty.
  const ly = H - 22;
  const steps = 24, lw = 150;
  for (let i = 0; i < steps; i += 1) svg.append(svgEl("rect", { x: L + (i * lw) / steps, y: ly - 9, width: lw / steps + 0.5, height: 10, fill: rampColor(i / (steps - 1), dark) }));
  svg.append(svgEl("text", { x: L, y: ly + 14, "font-size": 10, fill: muted }, oas.length ? `${lo.toFixed(0)}°` : "-"));
  svg.append(svgEl("text", { x: L + lw, y: ly + 14, "text-anchor": "end", "font-size": 10, fill: muted }, oas.length ? `${hi.toFixed(0)}°` : "-"));
  svg.append(svgEl("text", { x: L + lw / 2, y: ly + 14, "text-anchor": "middle", "font-size": 10, fill: muted }, "Offset Angle"));
  let lx = L + lw + 18;
  if (want > 0) {
    svg.append(svgEl("circle", { cx: lx + 4, cy: ly - 4, r: 4, fill: accent }));
    svg.append(svgEl("text", { x: lx + 12, y: ly, "font-size": 10.5, fill: ink }, `목표 ${want.toFixed(1)}°`));
    lx += 82;
  }
  svg.append(svgEl("circle", { cx: lx + 6, cy: ly - 4, r: 6, fill: "none", stroke: ink, "stroke-width": 2 }));
  svg.append(svgEl("text", { x: lx + 16, y: ly, "font-size": 10.5, fill: ink }, "현재"));
  lx += 52;
  svg.append(svgEl("rect", { x: lx, y: ly - 9, width: 12, height: 10, fill: rampColor(0.6, dark) }));
  svg.append(svgEl("rect", { x: lx, y: ly - 9, width: 12, height: 10, fill: "url(#vrp-map-hatch)" }));
  svg.append(svgEl("text", { x: lx + 16, y: ly, "font-size": 10.5, fill: ink }, "WARNING"));
  lx += 74;
  svg.append(svgEl("rect", { x: lx, y: ly - 9, width: 12, height: 10, fill: "none", stroke: grid }));
  svg.append(svgEl("text", { x: lx + 16, y: ly, "font-size": 10.5, fill: ink }, "빈 칸 = 날 수 없음"));
  return { crossings, range: oas.length ? [lo, hi] : null };
}
