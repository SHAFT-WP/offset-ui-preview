// POP-UP Design tab, step 2 pictures (owner 2026-11-20, DESIGN-STEPS.md §2, S2). Drawing only: the numbers are the
// BE's (a Popup Angle sweep of #1, popupAngleRange, popupProfileLine in AG/bombing/popup/popup-design-steps-v0.1).
//   Angle charts: X = Popup Angle; one small chart each for Exposure, Apex speed, Min Pop-up Distance, Approach-Pop
//     Distance and Approach-Pop Time. Blue band = Apex 300–350 KCAS area, dashed line = AUTO angle, green area =
//     the Popup Angle range, red = the angle flown now.
//   Profile: the flown pop-up (Pop → Roll-in Start → Release) as a red line, the bomb's fall dashed; before the Pop,
//     the level Approach-Pop leg (grey). The red part from the Pop is the minimum pop-up at that Popup Angle (Min
//     Pop-up Distance); Min POPUP (Approach-Pop 0 s) is the same line with no grey leg.
// 0.1.1 (owner 2026-11-20 follow-up): every chart draws its first derivative behind the curve on its own right-hand
// scale (finite differences of the drawn points, hidden by the caller's button: options.derivative = false); the
// values are read with the mouse (installChartHover: a crosshair and a box with x, the value and the derivative);
// the svg nodes are kept between renders (fixed canvas) so a zoom set by the caller survives a redraw.
// 0.1.2 (owner 2026-11-22): the Popup Angle range is a filled green area (Approach-Pop 2 s .. Apex 300 KCAS or the arc
// limit), with the 0–2 s lead-in drawn light (marks.possibleFromDeg); the Apex 300–350 band stays as a reference.
export const POPUP_DESIGN_POPUP_CHART_V0_1 = Object.freeze({ id: "popup-design-popup-chart-v0.1", version: "0.1.2" });

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}, text = null) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) node.setAttribute(k, v);
  if (text !== null) node.textContent = text;
  return node;
};
const finite = (v) => Number.isFinite(v);
function niceStep(span, count) {
  const raw = span / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m >= 5 ? 10 : m >= 2 ? 5 : m >= 1 ? 2 : 1) * p;
}
const fmt = (v, step) => (step >= 1 ? Math.round(v).toLocaleString("en-US") : v.toFixed(step >= 0.1 ? 1 : 2));
const DERIV = "#4f8fd6";

export const ANGLE_CHARTS = Object.freeze([
  { key: "exposureTimeSec", label: "Exposure (Pop → Apex)", unit: "s", digits: 1 },
  { key: "apexKcas", label: "Apex Speed", unit: "KCAS", digits: 0, lines: [[300, "#e34948"], [350, "#2a78d6"]] },
  { key: "popToRollInNm", label: "Min Pop-up Distance", unit: "NM", digits: 2 },
  { key: "offsetPopupRangeNm", label: "Approach-Pop Distance", unit: "NM", digits: 2, lines: [[0, "#e34948"]] },
  { key: "offsetPopupTimeSec", label: "Approach-Pop Time", unit: "s", digits: 1, lines: [[0, "#e34948"], [2, "#e08a1e"]] },
]);

// First derivative of a sampled curve (central differences; one-sided at the ends). pts: [{ x, y }] sorted by x.
export function derivative(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    if (b.x - a.x > 1e-9) out.push({ x: pts[i].x, y: (b.y - a.y) / (b.x - a.x) });
  }
  return out;
}
// Straight-line value at x.
const at = (pts, x) => {
  if (!pts.length || x < pts[0].x - 1e-9 || x > pts[pts.length - 1].x + 1e-9) return null;
  for (let i = 1; i < pts.length; i += 1) if (x <= pts[i].x) {
    const a = pts[i - 1], b = pts[i];
    return b.x === a.x ? a.y : a.y + (b.y - a.y) * ((x - a.x) / (b.x - a.x));
  }
  return pts[pts.length - 1].y;
};
const span = (vals, extra = []) => {
  let lo = Math.min(...vals, ...extra), hi = Math.max(...vals, ...extra);
  if (!finite(lo) || !finite(hi)) { lo = 0; hi = 1; }
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
};

// Mouse reading: a crosshair and a value box on the chart (svg.__chartRead = { L, T, pw, ph, xOf(svgX), rows(x) }).
export function installChartHover(svg) {
  if (svg.__chartHover) return;
  svg.__chartHover = true;
  const clear = () => svg.querySelector("[data-chart-hover]")?.remove();
  const move = (event) => {
    const read = svg.__chartRead;
    if (!read || event.buttons) { clear(); return; }
    const m = svg.getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(m.inverse());
    if (p.x < read.L || p.x > read.L + read.pw || p.y < read.T || p.y > read.T + read.ph) { clear(); return; }
    const x = read.xOf(p.x);
    const rows = read.rows(x).filter(Boolean);
    clear();
    const g = svgEl("g", { "data-chart-hover": "", "pointer-events": "none" });
    g.append(svgEl("line", { x1: p.x, x2: p.x, y1: read.T, y2: read.T + read.ph, stroke: "#2e2d2a", "stroke-width": 0.8, "stroke-dasharray": "3 2" }));
    for (const r of rows) if (finite(r.cy)) g.append(svgEl("circle", { cx: p.x, cy: r.cy, r: 3.2, fill: r.color, stroke: "#fff", "stroke-width": 1.2 }));
    const lines = rows.map((r) => r.text);
    const fs = 10.5, lh = 13, boxW = Math.max(...lines.map((t) => t.length)) * fs * 0.56 + 12, boxH = lines.length * lh + 8;
    const bx = p.x + boxW + 10 > read.L + read.pw ? p.x - boxW - 8 : p.x + 8;
    const by = read.T + 4;
    g.append(svgEl("rect", { x: bx, y: by, width: boxW, height: boxH, rx: 5, fill: "#1f1f1e", opacity: 0.88 }));
    lines.forEach((t, i) => g.append(svgEl("text", { x: bx + 6, y: by + 4 + lh * (i + 1) - 3, "font-size": fs, fill: rows[i].textColor ?? "#fff" }, t)));
    svg.append(g);
  };
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerleave", clear);
  svg.addEventListener("pointerdown", clear);
}

// One small chart into `svg`. `points`: [{ x, status, y }]; `marks`: { apexArea, fromDeg, toDeg, autoDeg, currentDeg }.
function angleChart(svg, chart, points, marks, showDerivative) {
  const W = 320, H = 170, L = 46, R = showDerivative ? 40 : 10, T = 22, B = 26;
  const pw = W - L - R, ph = H - T - B;
  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const pts = points.filter((p) => finite(p.y?.[chart.key])).sort((a, b) => a.x - b.x);
  const curve = pts.map((p) => ({ x: p.x, y: p.y[chart.key] }));
  const dcurve = derivative(curve);
  const xs = points.map((p) => p.x).filter(finite);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const [y0, y1] = span(curve.map((p) => p.y), (chart.lines ?? []).map(([v]) => v));
  const [d0, d1] = span(dcurve.map((p) => p.y), [0]);
  const X = (v) => L + ((v - x0) / (x1 - x0)) * pw;
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * ph;
  const DY = (v) => T + (1 - (v - d0) / (d1 - d0)) * ph;
  svg.append(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#fff" }));
  svg.append(svgEl("text", { x: 6, y: 14, "font-size": 12, "font-weight": 700, fill: "#2e2d2a" }, `${chart.label} (${chart.unit})`));
  if (showDerivative) svg.append(svgEl("text", { x: W - 4, y: 14, "text-anchor": "end", "font-size": 10, fill: DERIV }, `d/dθ (${chart.unit}/°)`));
  // Bands: Apex 300–350 area (blue), the range (green outline).
  const a = marks.apexArea;
  if (a && finite(a.fromDeg) && finite(a.toDeg)) svg.append(svgEl("rect", { x: X(a.fromDeg), y: T, width: Math.max(1, X(a.toDeg) - X(a.fromDeg)), height: ph, fill: "#d9e7f8", "data-band": "apex" }));
  // 0.1.2: the range is a green area (Approach-Pop 2 s .. Apex 300 KCAS / arc limit); its 0–2 s lead-in light.
  if (finite(marks.possibleFromDeg) && finite(marks.fromDeg) && marks.fromDeg > marks.possibleFromDeg) {
    svg.append(svgEl("rect", { x: X(Math.max(x0, marks.possibleFromDeg)), y: T + 1, width: Math.max(1, X(marks.fromDeg) - X(Math.max(x0, marks.possibleFromDeg))), height: ph - 2, fill: "#1baf7a", opacity: 0.08, stroke: "#1baf7a", "stroke-dasharray": "3 3", "data-band": "range-warn" }));
  }
  if (finite(marks.fromDeg) && finite(marks.toDeg)) {
    svg.append(svgEl("rect", { x: X(marks.fromDeg), y: T + 1, width: Math.max(1, X(marks.toDeg) - X(marks.fromDeg)), height: ph - 2, fill: "#1baf7a", opacity: 0.16, "data-band": "range-fill" }));
    svg.append(svgEl("rect", { x: X(marks.fromDeg), y: T + 1, width: Math.max(1, X(marks.toDeg) - X(marks.fromDeg)), height: ph - 2, fill: "none", stroke: "#1baf7a", "stroke-width": 2, "data-band": "range" }));
  }
  // Grid.
  const ys = niceStep(y1 - y0, 4);
  for (let v = Math.ceil(y0 / ys) * ys; v <= y1 + 1e-9; v += ys) {
    svg.append(svgEl("line", { x1: L, x2: L + pw, y1: Y(v), y2: Y(v), stroke: "#ebeae6" }));
    svg.append(svgEl("text", { x: L - 5, y: Y(v) + 4, "text-anchor": "end", "font-size": 10, fill: "#5f5e5a" }, fmt(v, ys)));
  }
  for (let v = Math.ceil(x0 / 5) * 5; v <= x1 + 1e-9; v += 5) {
    svg.append(svgEl("text", { x: X(v), y: H - 9, "text-anchor": "middle", "font-size": 10, fill: "#5f5e5a" }, `${v}°`));
  }
  // The derivative, behind the curve, on the right-hand scale.
  if (showDerivative && dcurve.length >= 2) {
    const g = svgEl("g", { "data-derivative": chart.key });
    const ds = niceStep(d1 - d0, 4);
    for (let v = Math.ceil(d0 / ds) * ds; v <= d1 + 1e-9; v += ds) g.append(svgEl("text", { x: L + pw + 4, y: DY(v) + 4, "font-size": 9.5, fill: DERIV }, fmt(v, ds)));
    if (d0 < 0 && d1 > 0) g.append(svgEl("line", { x1: L, x2: L + pw, y1: DY(0), y2: DY(0), stroke: DERIV, "stroke-width": 0.8, opacity: 0.5 }));
    const dd = dcurve.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${DY(p.y).toFixed(1)}`).join("");
    g.append(svgEl("path", { d: `${dd}L${X(dcurve.at(-1).x).toFixed(1)},${DY(Math.max(d0, Math.min(d1, 0))).toFixed(1)}L${X(dcurve[0].x).toFixed(1)},${DY(Math.max(d0, Math.min(d1, 0))).toFixed(1)}Z`, fill: DERIV, opacity: 0.1, stroke: "none" }));
    g.append(svgEl("path", { d: dd, fill: "none", stroke: DERIV, "stroke-width": 1.6, opacity: 0.75 }));
    svg.append(g);
  }
  svg.append(svgEl("rect", { x: L, y: T, width: pw, height: ph, fill: "none", stroke: "#9a9893" }));
  for (const [v, color] of chart.lines ?? []) if (v >= y0 && v <= y1) svg.append(svgEl("line", { x1: L, x2: L + pw, y1: Y(v), y2: Y(v), stroke: color, "stroke-width": 1.2, "stroke-dasharray": "4 3" }));
  // The curve: VALID / WARNING solid, INVALID faded.
  for (let i = 1; i < pts.length; i += 1) {
    const p = pts[i - 1], q = pts[i];
    const bad = [p.status, q.status].some((s) => s === "INVALID" || s === "FAILED");
    svg.append(svgEl("line", { x1: X(p.x), y1: Y(p.y[chart.key]), x2: X(q.x), y2: Y(q.y[chart.key]), stroke: "#2e2d2a", "stroke-width": 2, ...(bad ? { opacity: 0.3, "stroke-dasharray": "4 3" } : {}) }));
  }
  if (finite(marks.autoDeg)) {
    svg.append(svgEl("line", { x1: X(marks.autoDeg), x2: X(marks.autoDeg), y1: T, y2: T + ph, stroke: "#8e5bd6", "stroke-width": 1.5, "stroke-dasharray": "5 3", "data-mark": "auto" }));
  }
  if (finite(marks.currentDeg) && marks.currentDeg >= x0 && marks.currentDeg <= x1) {
    svg.append(svgEl("line", { x1: X(marks.currentDeg), x2: X(marks.currentDeg), y1: T, y2: T + ph, stroke: "#e34948", "stroke-width": 1.5, "data-mark": "current" }));
    if (finite(marks.currentY?.[chart.key])) svg.append(svgEl("circle", { cx: X(marks.currentDeg), cy: Y(marks.currentY[chart.key]), r: 4, fill: "#e34948", stroke: "#fff", "stroke-width": 1.5 }));
  }
  svg.__chartRead = {
    L, T, pw, ph,
    xOf: (sx) => x0 + ((sx - L) / pw) * (x1 - x0),
    rows: (x) => {
      const y = at(curve, x), dy = at(dcurve, x);
      return [
        { text: `Popup Angle ${x.toFixed(1)}°`, color: "#2e2d2a" },
        finite(y) ? { text: `${chart.label} ${y.toFixed(chart.digits)} ${chart.unit}`, cy: Y(y), color: "#2e2d2a" } : null,
        showDerivative && finite(dy) ? { text: `d/dθ ${dy.toFixed(chart.digits + 1)} ${chart.unit}/°`, cy: DY(dy), color: DERIV, textColor: "#a9cdf5" } : null,
      ];
    },
  };
  installChartHover(svg);
}

// The charts keep their svg nodes (one per chart, by key) so the caller's zoom on each survives a redraw.
// Returns the svgs in ANGLE_CHARTS order.
export function renderAngleCharts(host, points, marks, { derivative: showDerivative = true, wrap = (svg) => svg } = {}) {
  host.__charts ||= new Map();
  return ANGLE_CHARTS.map((chart) => {
    let svg = host.__charts.get(chart.key);
    if (!svg) {
      svg = svgEl("svg", { class: "design-angle-chart", role: "img", "aria-label": `${chart.label} by Popup Angle`, "data-chart": chart.key });
      host.__charts.set(chart.key, svg);
      host.append(wrap(svg));
    }
    angleChart(svg, chart, points, marks, showDerivative);
    return svg;
  });
}

// The profile: x = ground distance from the Pop Point along the path (NM), y = altitude (ft MSL).
// options.approach = { nm, sec } (the BE's holdDownNm / holdDownSec): the level leg drawn before the Pop.
export function renderProfile(svg, profile, { title = "Pop-up Profile (#1)", derivative: showDerivative = true, approach = null } = {}) {
  svg.replaceChildren();
  const W = 640, H = 240, L = 56, R = showDerivative ? 50 : 16, T = 24, B = 30;
  const pw = W - L - R, ph = H - T - B;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.append(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#fff" }));
  svg.append(svgEl("text", { x: 8, y: 15, "font-size": 12, "font-weight": 700, fill: "#2e2d2a" }, title));
  svg.__chartRead = null;
  if (!profile?.line?.length) return;
  const lead = finite(approach?.nm) && approach.nm > 0 ? approach.nm : 0;
  const all = [...profile.line, ...profile.bomb];
  const xMin = -lead;
  const x1 = Math.max(...all.map((p) => p.distNm));
  const y1 = Math.max(...all.map((p) => p.altFt)) * 1.08;
  const y0 = Math.min(0, ...all.map((p) => p.altFt));
  const X = (v) => L + ((v - xMin) / (x1 - xMin)) * pw;
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * ph;
  // Slope of the flown line, ft per NM (points closer than 1 ft apart along x are merged).
  const line = [];
  for (const p of profile.line) if (!line.length || p.distNm - line[line.length - 1].x > 1e-4) line.push({ x: p.distNm, y: p.altFt });
  const dcurve = derivative(line);
  const [d0, d1] = span(dcurve.map((p) => p.y), [0]);
  const DY = (v) => T + (1 - (v - d0) / (d1 - d0)) * ph;
  const ys = niceStep(y1 - y0, 4);
  for (let v = Math.ceil(y0 / ys) * ys; v <= y1; v += ys) {
    svg.append(svgEl("line", { x1: L, x2: L + pw, y1: Y(v), y2: Y(v), stroke: "#ebeae6" }));
    svg.append(svgEl("text", { x: L - 5, y: Y(v) + 4, "text-anchor": "end", "font-size": 10, fill: "#5f5e5a" }, fmt(v, ys)));
  }
  const xs = niceStep(x1 - xMin, 6);
  for (let v = Math.ceil(xMin / xs) * xs; v <= x1 + 1e-9; v += xs) svg.append(svgEl("text", { x: X(v), y: H - 12, "text-anchor": "middle", "font-size": 10, fill: "#5f5e5a" }, `${fmt(v, xs)}`));
  svg.append(svgEl("text", { x: L + pw, y: H - 1, "text-anchor": "end", "font-size": 10, fill: "#5f5e5a" }, "NM from Pop (ground, along the path)"));
  if (showDerivative && dcurve.length >= 2) {
    const g = svgEl("g", { "data-derivative": "profile" });
    g.append(svgEl("text", { x: W - 4, y: 15, "text-anchor": "end", "font-size": 10, fill: DERIV }, "d(Alt)/d(Dist) ft/NM"));
    const ds = niceStep(d1 - d0, 4);
    for (let v = Math.ceil(d0 / ds) * ds; v <= d1 + 1e-9; v += ds) g.append(svgEl("text", { x: L + pw + 4, y: DY(v) + 4, "font-size": 9.5, fill: DERIV }, fmt(v, ds)));
    if (d0 < 0 && d1 > 0) g.append(svgEl("line", { x1: L, x2: L + pw, y1: DY(0), y2: DY(0), stroke: DERIV, "stroke-width": 0.8, opacity: 0.5 }));
    g.append(svgEl("path", { d: dcurve.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${DY(p.y).toFixed(1)}`).join(""), fill: "none", stroke: DERIV, "stroke-width": 1.6, opacity: 0.7 }));
    svg.append(g);
  }
  svg.append(svgEl("rect", { x: L, y: T, width: pw, height: ph, fill: "none", stroke: "#9a9893" }));
  const path = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${X(p.distNm).toFixed(1)},${Y(p.altFt).toFixed(1)}`).join("");
  // The Approach-Pop leg (level, at the Pop altitude) before the Pop.
  const pop = profile.marks.pop;
  if (lead > 0 && pop) {
    svg.append(svgEl("path", { d: `M${X(-lead).toFixed(1)},${Y(pop.altFt).toFixed(1)}L${X(0).toFixed(1)},${Y(pop.altFt).toFixed(1)}`, fill: "none", stroke: "#9a9893", "stroke-width": 3, "data-profile": "approach-pop" }));
    svg.append(svgEl("text", { x: X(-lead / 2), y: Y(pop.altFt) - 8, "text-anchor": "middle", "font-size": 10.5, fill: "#5f5e5a" }, `Approach-Pop ${lead.toFixed(2)} NM${finite(approach.sec) ? ` · ${approach.sec.toFixed(1)} s` : ""}`));
  }
  if (profile.bomb.length) svg.append(svgEl("path", { d: path(profile.bomb), fill: "none", stroke: "#5f5e5a", "stroke-width": 1.5, "stroke-dasharray": "4 3" }));
  svg.append(svgEl("path", { d: path(profile.line), fill: "none", stroke: "#e34948", "stroke-width": 2.5, "data-profile": "user" }));
  const mark = (p, text, anchor = "middle", dy = -8) => {
    if (!p) return;
    svg.append(svgEl("circle", { cx: X(p.distNm), cy: Y(p.altFt), r: 3.5, fill: "#e34948" }));
    svg.append(svgEl("text", { x: X(p.distNm), y: Y(p.altFt) + dy, "text-anchor": anchor, "font-size": 10.5, fill: "#2e2d2a" }, text));
  };
  const ft = (v) => `${Math.round(v).toLocaleString("en-US")} ft`;
  mark(pop, `Pop ${ft(pop.altFt)}`, "start", 16);
  mark(profile.marks.rollInStart, `Roll-in ${ft(profile.marks.rollInStart.altFt)}`, "end", -8);
  mark(profile.marks.apex, `Apex ${ft(profile.marks.apex.altFt)}`, "middle", -8);
  mark(profile.marks.release, `Release ${ft(profile.marks.release.altFt)}`, "start", 14);
  const bomb = profile.bomb.map((p) => ({ x: p.distNm, y: p.altFt }));
  svg.__chartRead = {
    L, T, pw, ph,
    xOf: (sx) => xMin + ((sx - L) / pw) * (x1 - xMin),
    rows: (x) => {
      const onLeg = x < 0 && pop;
      const y = onLeg ? pop.altFt : at(line, x);
      const b = at(bomb, x);
      const dy = onLeg ? 0 : at(dcurve, x);
      return [
        { text: `${x.toFixed(2)} NM from Pop${onLeg ? " (Approach-Pop)" : ""}`, color: "#2e2d2a" },
        finite(y) ? { text: `Alt ${Math.round(y).toLocaleString("en-US")} ft`, cy: Y(y), color: onLeg ? "#9a9893" : "#e34948" } : null,
        finite(b) && !finite(y) ? { text: `Bomb ${Math.round(b).toLocaleString("en-US")} ft`, cy: Y(b), color: "#5f5e5a" } : null,
        showDerivative && finite(dy) && finite(y) ? { text: `d(Alt)/d(Dist) ${Math.round(dy).toLocaleString("en-US")} ft/NM`, cy: DY(dy), color: DERIV, textColor: "#a9cdf5" } : null,
      ];
    },
  };
  installChartHover(svg);
}
