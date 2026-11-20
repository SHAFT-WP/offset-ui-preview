// POP-UP Design tab, step 2 pictures (owner 2026-11-20, DESIGN-STEPS.md §2, S2). Drawing only: the numbers are the
// BE's (a Popup Angle sweep of #1, popupAngleRange, popupProfileLine in AG/bombing/popup/popup-design-steps-v0.1).
//   Angle charts: X = Popup Angle; one small chart each for Exposure, Apex speed, Min Pop-up Distance, Approach-Pop
//     Distance and Approach-Pop Time. Blue band = Apex 300–350 KCAS area, dashed line = AUTO angle, green outline =
//     the Popup Angle range, red = the angle flown now.
//   Profile: the flown pop-up (Pop → Roll-in Start → Release) as a red line, the bomb's fall dashed.
export const POPUP_DESIGN_POPUP_CHART_V0_1 = Object.freeze({ id: "popup-design-popup-chart-v0.1", version: "0.1.0" });

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}, text = null) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
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

export const ANGLE_CHARTS = Object.freeze([
  { key: "exposureTimeSec", label: "Exposure (Pop → Apex)", unit: "s" },
  { key: "apexKcas", label: "Apex Speed", unit: "KCAS", lines: [[300, "#e34948"], [350, "#2a78d6"]] },
  { key: "popToRollInNm", label: "Min Pop-up Distance", unit: "NM" },
  { key: "offsetPopupRangeNm", label: "Approach-Pop Distance", unit: "NM", lines: [[0, "#e34948"]] },
  { key: "offsetPopupTimeSec", label: "Approach-Pop Time", unit: "s", lines: [[0, "#e34948"], [2, "#e08a1e"]] },
]);

// One small chart. `points`: [{ x, status, y }]; `marks`: { apexArea, fromDeg, toDeg, autoDeg, currentDeg }.
function angleChart(chart, points, marks) {
  const W = 320, H = 170, L = 46, R = 10, T = 22, B = 26;
  const pw = W - L - R, ph = H - T - B;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "design-angle-chart", role: "img", "aria-label": `${chart.label} by Popup Angle`, "data-chart": chart.key });
  const pts = points.filter((p) => finite(p.y?.[chart.key])).sort((a, b) => a.x - b.x);
  const xs = points.map((p) => p.x).filter(finite);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...pts.map((p) => p.y[chart.key]), ...(chart.lines ?? []).map(([v]) => v));
  let y1 = Math.max(...pts.map((p) => p.y[chart.key]), ...(chart.lines ?? []).map(([v]) => v));
  if (!finite(y0) || !finite(y1)) { y0 = 0; y1 = 1; }
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * 0.08;
  y0 -= pad; y1 += pad;
  const X = (v) => L + ((v - x0) / (x1 - x0)) * pw;
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * ph;
  svg.append(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#fff" }));
  svg.append(svgEl("text", { x: 6, y: 14, "font-size": 12, "font-weight": 700, fill: "#2e2d2a" }, `${chart.label} (${chart.unit})`));
  // Bands: Apex 300–350 area (blue), the range (green outline).
  const a = marks.apexArea;
  if (a && finite(a.fromDeg) && finite(a.toDeg)) svg.append(svgEl("rect", { x: X(a.fromDeg), y: T, width: Math.max(1, X(a.toDeg) - X(a.fromDeg)), height: ph, fill: "#d9e7f8", "data-band": "apex" }));
  if (finite(marks.fromDeg) && finite(marks.toDeg)) svg.append(svgEl("rect", { x: X(marks.fromDeg), y: T + 1, width: Math.max(1, X(marks.toDeg) - X(marks.fromDeg)), height: ph - 2, fill: "none", stroke: "#1baf7a", "stroke-width": 2, "data-band": "range" }));
  // Grid.
  const ys = niceStep(y1 - y0, 4);
  for (let v = Math.ceil(y0 / ys) * ys; v <= y1 + 1e-9; v += ys) {
    svg.append(svgEl("line", { x1: L, x2: L + pw, y1: Y(v), y2: Y(v), stroke: "#ebeae6" }));
    svg.append(svgEl("text", { x: L - 5, y: Y(v) + 4, "text-anchor": "end", "font-size": 10, fill: "#5f5e5a" }, fmt(v, ys)));
  }
  for (let v = Math.ceil(x0 / 5) * 5; v <= x1 + 1e-9; v += 5) {
    svg.append(svgEl("text", { x: X(v), y: H - 9, "text-anchor": "middle", "font-size": 10, fill: "#5f5e5a" }, `${v}°`));
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
  return svg;
}

export function renderAngleCharts(host, points, marks) {
  host.replaceChildren(...ANGLE_CHARTS.map((chart) => angleChart(chart, points, marks)));
}

// The profile: x = ground distance from the Pop Point along the path (NM), y = altitude (ft MSL).
export function renderProfile(svg, profile, { title = "Pop-up Profile (#1)" } = {}) {
  svg.replaceChildren();
  const W = 640, H = 230, L = 56, R = 16, T = 24, B = 30;
  const pw = W - L - R, ph = H - T - B;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.append(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#fff" }));
  svg.append(svgEl("text", { x: 8, y: 15, "font-size": 12, "font-weight": 700, fill: "#2e2d2a" }, title));
  if (!profile?.line?.length) return;
  const all = [...profile.line, ...profile.bomb];
  const x1 = Math.max(...all.map((p) => p.distNm));
  const y1 = Math.max(...all.map((p) => p.altFt)) * 1.08;
  const y0 = Math.min(0, ...all.map((p) => p.altFt));
  const X = (v) => L + (v / x1) * pw;
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * ph;
  const ys = niceStep(y1 - y0, 4);
  for (let v = Math.ceil(y0 / ys) * ys; v <= y1; v += ys) {
    svg.append(svgEl("line", { x1: L, x2: L + pw, y1: Y(v), y2: Y(v), stroke: "#ebeae6" }));
    svg.append(svgEl("text", { x: L - 5, y: Y(v) + 4, "text-anchor": "end", "font-size": 10, fill: "#5f5e5a" }, fmt(v, ys)));
  }
  const xs = niceStep(x1, 6);
  for (let v = 0; v <= x1 + 1e-9; v += xs) svg.append(svgEl("text", { x: X(v), y: H - 12, "text-anchor": "middle", "font-size": 10, fill: "#5f5e5a" }, `${fmt(v, xs)}`));
  svg.append(svgEl("text", { x: L + pw, y: H - 1, "text-anchor": "end", "font-size": 10, fill: "#5f5e5a" }, "NM from Pop (ground, along the path)"));
  svg.append(svgEl("rect", { x: L, y: T, width: pw, height: ph, fill: "none", stroke: "#9a9893" }));
  const path = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${X(p.distNm).toFixed(1)},${Y(p.altFt).toFixed(1)}`).join("");
  if (profile.bomb.length) svg.append(svgEl("path", { d: path(profile.bomb), fill: "none", stroke: "#5f5e5a", "stroke-width": 1.5, "stroke-dasharray": "4 3" }));
  svg.append(svgEl("path", { d: path(profile.line), fill: "none", stroke: "#e34948", "stroke-width": 2.5, "data-profile": "user" }));
  const mark = (p, text, anchor = "middle", dy = -8) => {
    if (!p) return;
    svg.append(svgEl("circle", { cx: X(p.distNm), cy: Y(p.altFt), r: 3.5, fill: "#e34948" }));
    svg.append(svgEl("text", { x: X(p.distNm), y: Y(p.altFt) + dy, "text-anchor": anchor, "font-size": 10.5, fill: "#2e2d2a" }, text));
  };
  const ft = (v) => `${Math.round(v).toLocaleString("en-US")} ft`;
  mark(profile.marks.pop, `Pop ${ft(profile.marks.pop.altFt)}`, "start", -8);
  mark(profile.marks.rollInStart, `Roll-in ${ft(profile.marks.rollInStart.altFt)}`, "end", -8);
  mark(profile.marks.apex, `Apex ${ft(profile.marks.apex.altFt)}`, "middle", -8);
  mark(profile.marks.release, `Release ${ft(profile.marks.release.altFt)}`, "start", 14);
}
