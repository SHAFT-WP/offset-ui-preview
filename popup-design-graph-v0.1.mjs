// POP-UP Design tab: dependency graph (owner 2026-11-18: "디자인 탭에 내가 분석할 수 있게 그래프 툴 하나", "현재 상태에서
// 축 선택후 변수 하나만 몇가지 조건을 줬을 때 그래프", "밸리드하든 아니든 그래프만", "고정방식 해보자", "지금껏 그림 그려서
// 해석했던 방식을 프로그램에서"). Pick X (an input), Y (a result) and, optionally, one condition with a few values: one
// curve per value, overlaid. Every point is #1 under the page's current conditions with the automatic choices frozen
// (popup-dependency-sweep-v0.1); VALID points solid, WARNING dashed, INVALID dashed and faded. Mouse wheel zooms at the
// cursor (Shift: X only, Alt: Y only), drag pans, double-click resets; on a phone two fingers pinch. Points are solved
// in Web Workers side by side (in-thread when a Worker cannot start). Nothing is saved.
import { POPUP_SWEEP_INPUTS, POPUP_SWEEP_OUTPUTS, sweepBaseline, sweepInputValue, sweepModeOf, sweepValues } from "./AG/bombing/popup/popup-dependency-sweep-v0.1.mjs?v=0.1.2";
import { mountPopupDesignSteps } from "./popup-design-steps-ui-v0.1.mjs?v=0.1.9";
import { OFFSET_ANGLE_GRID, POPUP_ANGLE_GRID, POPUP_DESIGN_LIMITS, designSteps, offsetAngleRange, popupAngleWindow } from "./AG/bombing/popup/popup-design-steps-v0.1.mjs?v=0.1.1";

// 0.1.1 (owner 2026-11-18, the planning procedure): Step by Step above the graph — BDP, Popup Angle window (Offset-Popup
// 2 s / Apex 300 KCAS / arc), Min Exposure window (Apex 300–350 KCAS), Offset Angle range, one more pass, what to change,
// and a centring chart (popup-design-steps-v0.1). "Popup Angle에 넣기" types the suggestion into #1's Popup Angle.
// 0.1.2 (owner 2026-11-20, DESIGN-STEPS.md S1): the four planning steps (popup-design-steps-ui-v0.1) on top; the
// Step by Step box folds inside step 2 as "범위 계산" until S2 replaces it; the graph stays below.
// 0.1.3 (owner 2026-11-20 follow-up): import tokens only (steps UI 0.1.4, worker 0.1.5, region 0.1.1 both Roll-in sides).
export const POPUP_DESIGN_GRAPH_V0_1 = Object.freeze({ id: "popup-design-graph-v0.1", version: "0.1.8" });
// 0.1.6: mounts steps UI 0.1.7 (IP Bottom in the zoom row).
// 0.1.7: mounts steps UI 0.1.8 (Action Range / Offset Angle in step 2).
// 0.1.5 (owner 2026-11-22): mounts steps UI 0.1.6 (step-2 range Approach-Pop 2 s .. Apex 300; Top View one side).
// 0.1.4 (owner 2026-11-22): mounts steps UI 0.1.5 (Top View IP Bottom button, default on).

const WORKER_URL = new URL("./AG/bombing/popup/popup-dependency-worker-v0.1.mjs?v=0.1.5", import.meta.url);
const FINE_TUNE_URL = new URL("./AG/bombing/popup/popup-fine-tune-v0.1.mjs?v=0.1.0", import.meta.url);
const REGION_URL = new URL("./AG/bombing/popup/popup-offset-region-v0.1.mjs?v=0.1.1", import.meta.url);
const SWEEP_URL = new URL("./AG/bombing/popup/popup-dependency-sweep-v0.1.mjs?v=0.1.2", import.meta.url);
const COLORS = ["#2a78d6", "#e34948", "#1baf7a", "#eb6834", "#8e5bd6"];
const MAX_CONDITIONS = 5;
// Default X range and condition values per input (the owner's charts so far); `v` = the current value.
const X_RANGE = {
  offsetAngleDeg: () => [5, 40], vrpRangeNm: () => [3.5, 8], offsetSpeedValue: () => [400, 560], offsetG: () => [1.5, 5],
  popupAngleDeg: () => [15, 50], popupG: () => [3, 6], diveAngleDeg: () => [10, 35], trackingTimeSec: () => [2, 12],
  rollInAltitudeMslFt: (v) => [Math.round((v - 1500) / 100) * 100, Math.round((v + 1500) / 100) * 100],
  releaseAltitudeMslFt: () => [2500, 6000], rollInG: () => [2, 5],
};
const CONDITION_VALUES = {
  offsetAngleDeg: "10, 15, 20", vrpRangeNm: "4.5, 5, 6", offsetSpeedValue: "450, 480, 500", offsetG: "2, 3, 4",
  popupAngleDeg: "30, 40, 45", popupG: "3, 4, 5", diveAngleDeg: "15, 20, 25", trackingTimeSec: "3, 5, 8",
  releaseAltitudeMslFt: "3300, 4000, 4500", rollInG: "3, 4",
};
const DEFAULT_GRAPH = { x: "offsetAngleDeg", y: "offsetPopupTimeSec", condition: "offsetG" };

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
};
const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
const fmt = (v, step = 0.01) => {
  if (!Number.isFinite(v)) return "-";
  const d = step >= 1 ? 0 : Math.min(3, Math.max(0, Math.ceil(-Math.log10(step))));
  return v.toFixed(d);
};
const parseList = (text) => String(text ?? "").split(/[,\s]+/).map(Number).filter(Number.isFinite).slice(0, MAX_CONDITIONS);

// "Nice" tick step for a span and a wished count.
function niceStep(span, count) {
  const raw = span / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m >= 5 ? 10 : m >= 2 ? 5 : m >= 1 ? 2 : 1) * p;
}

// The point pool: Workers side by side, or the sweep module in-thread.
function createPool() {
  const size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  let workers = null;
  let inThread = null;
  const queue = [];
  const busy = new Map();
  let seq = 0;
  const start = () => {
    if (workers || inThread) return;
    try {
      workers = Array.from({ length: size }, () => {
        const w = new Worker(WORKER_URL, { type: "module" });
        w.onmessage = (event) => { const job = busy.get(w); busy.delete(w); job?.resolve(event.data.point); pump(); };
        w.onerror = () => { const job = busy.get(w); busy.delete(w); job?.resolve({ status: "FAILED", messages: ["Worker error"], y: {} }); pump(); };
        return w;
      });
    } catch {
      workers = null;
      inThread = import(SWEEP_URL.href);
    }
  };
  function pump() {
    if (inThread) {
      if (!queue.length || busy.size) return;
      const job = queue.shift();
      busy.set("thread", job);
      setTimeout(() => (job.kind === "region" ? import(REGION_URL.href).then((m) => m.regionPoint(job.base, job.assignments.angleOffDeg))
        : job.kind === "fineTune" ? import(FINE_TUNE_URL.href).then((m) => m.fineTune(job.base, job.assignments)) : inThread.then((m) => m.sweepPoint(job.base, job.assignments)))
        .then((point) => { job.resolve(point); busy.delete("thread"); pump(); }), 0);
      return;
    }
    for (const w of workers ?? []) {
      if (busy.has(w) || !queue.length) continue;
      const job = queue.shift();
      busy.set(w, job);
      w.postMessage({ id: ++seq, base: job.base, assignments: job.assignments, kind: job.kind });
    }
  }
  return {
    size: () => (workers ? workers.length : 1),
    // kind "region": a step-3 region point (popup-offset-region-v0.1); else a sweep point.
    point(base, assignments, kind = "sweep") {
      start();
      return new Promise((resolve) => { queue.push({ base, assignments, kind, resolve }); pump(); });
    },
    // Drops the points not started yet (a new graph replaces the old one).
    clear() { queue.splice(0).forEach((job) => job.resolve(null)); },
  };
}

export function mountPopupDesignGraph({ host, offsetUi }) {
  if (!host) return { activate() {}, deactivate() {} };
  const pool = createPool();
  const stepsPool = createPool();
  const option = (value, text) => el("option", { value, text });
  const inputOptions = (sel, mode, skip = null, withNone = false) => {
    sel.replaceChildren(...(withNone ? [option("", "None")] : []), ...Object.entries(POPUP_SWEEP_INPUTS)
      .filter(([k, d]) => k !== skip && (!d.mode || d.mode === mode))
      .map(([k, d]) => option(k, `${d.label} (${d.unit})${d.slow ? " · slow" : ""}`)));
  };

  const xSel = el("select", { "aria-label": "X axis" });
  const ySel = el("select", { "aria-label": "Y axis" });
  ySel.append(...Object.entries(POPUP_SWEEP_OUTPUTS).map(([k, d]) => option(k, `${d.label} (${d.unit})`)));
  const fromIn = el("input", { type: "text", inputmode: "decimal", "aria-label": "X from" });
  const toIn = el("input", { type: "text", inputmode: "decimal", "aria-label": "X to" });
  const countIn = el("input", { type: "text", inputmode: "numeric", "aria-label": "Points per curve", value: "21" });
  const condSel = el("select", { "aria-label": "Condition" });
  const condIn = el("input", { type: "text", "aria-label": "Condition values", placeholder: "e.g. 2, 3, 4" });
  const drawBtn = el("button", { class: "btn", type: "button", text: "Draw" });
  const regionBtn = el("button", { class: "capture-button", type: "button", text: "이 구간 다시 계산", title: "Solve again over the X range now shown" });
  const resetBtn = el("button", { class: "capture-button", type: "button", text: "Zoom Reset" });
  const status = el("p", { class: "design-graph-status", role: "status", text: "-" });
  const legend = el("div", { class: "design-graph-legend" });
  const svg = svgEl("svg", { class: "design-graph-svg", viewBox: "0 0 900 560", role: "img", "aria-label": "Design graph" });
  const tip = el("div", { class: "design-graph-tip", hidden: "" });
  const field = (label, ...nodes) => el("label", { class: "design-graph-field" }, el("span", { text: label }), ...nodes);
  host.classList.add("design-graph");
  // ---- Step by Step ----
  const stepsBtn = el("button", { class: "btn", type: "button", text: "단계 계산" });
  const applyBtn = el("button", { class: "capture-button", type: "button", text: "Popup Angle에 넣기", disabled: "" });
  const stepsStatus = el("p", { class: "design-graph-status", role: "status", text: "단계 계산을 누르면 #1을 현재 조건으로 Step 1–6까지 계산합니다 (약 100점)." });
  const stepsList = el("ol", { class: "design-steps-list" });
  const centreSvg = svgEl("svg", { class: "design-steps-svg", viewBox: "0 0 900 150", role: "img", "aria-label": "Centring chart" });
  const stepsBox = el("section", { class: "design-steps", "data-design-steps": "" },
    el("h3", { class: "design-steps-title", text: "Step by Step (#1)" }),
    el("div", { class: "design-graph-actions" }, stepsBtn, applyBtn),
    stepsStatus, stepsList, el("div", { class: "design-steps-shell" }, centreSvg),
    el("p", { class: "flight-draft-note", text: "옅은 파랑 = Popup Angle 범위 (Offset-Popup 2 s ~ Apex 300 KCAS·상승 호) · 진한 파랑 = 추천 (Min EXP, Apex 300–350 KCAS) · 점선 = 가운데 · 초록 = Offset-Popup 2 s 이상인 Offset Angle · 빨간 삼각형 = 현재 값. 모든 점은 #1을 현재 조건으로 직접 계산합니다 (AUTO 조정 없음)." }));
  stepsBox.querySelector(".design-steps-title")?.remove();
  host.replaceChildren(
    el("h3", { class: "design-steps-title", text: "Graph" }),
    el("div", { class: "design-graph-controls" },
      field("X axis", xSel), field("From", fromIn), field("To", toIn), field("Points", countIn),
      field("Y axis", ySel), field("Condition", condSel), field("Values", condIn)),
    el("div", { class: "design-graph-actions" }, drawBtn, regionBtn, resetBtn),
    status, legend,
    el("div", { class: "design-graph-shell" }, svg, tip),
    el("p", { class: "flight-draft-note", text: "휠: 확대·축소 (Shift+휠 X만, Alt+휠 Y만) · 드래그: 이동 · 더블클릭: 원래대로 · 휴대폰: 두 손가락으로 확대·이동. #1을 현재 화면 조건으로 계산합니다: Offset Angle과 Popup Angle은 현재 값으로 고정(AUTO 조정 없음), VALID가 아니어도 그립니다. 실선 VALID · 점선 WARNING · 흐린 점선 INVALID · 검은 점 = 현재 값." }),
  );

  const wizard = mountPopupDesignSteps({ host, offsetUi, rangeTools: stepsBox, pool: createPool(), regionPool: createPool(), tunePool: createPool() });
  let answer = null;
  let base = null;
  let mode = "time";
  let graph = null; // { xKey, yKey, condKey, curves: [{ value, points: [{ x, status, messages, y }] }], job }
  let view = null; // { x0, x1, y0, y1 } or null = fit
  let job = 0;
  let stale = false;
  let drawnOnce = false;

  const setXDefaults = () => {
    const key = xSel.value;
    const v = base ? sweepInputValue(base, key) : NaN;
    const [a, b] = X_RANGE[key]?.(v) ?? [v * 0.7, v * 1.3];
    fromIn.value = String(a);
    toIn.value = String(b);
  };
  const setCondDefaults = () => {
    const key = condSel.value;
    condIn.disabled = !key;
    condIn.value = key ? (CONDITION_VALUES[key] ?? (base ? String(fmt(sweepInputValue(base, key), POPUP_SWEEP_INPUTS[key].step)) : "")) : "";
  };
  const fillSelectors = () => {
    const keepX = xSel.value || DEFAULT_GRAPH.x;
    inputOptions(xSel, mode);
    xSel.value = [...xSel.options].some((o) => o.value === keepX) ? keepX : xSel.options[0].value;
    const keepC = condSel.value;
    inputOptions(condSel, mode, xSel.value, true);
    condSel.value = [...condSel.options].some((o) => o.value === keepC) ? keepC : "";
  };

  function takeAnswer(next) {
    answer = next;
    try {
      base = sweepBaseline(answer, 1);
      mode = sweepModeOf(base);
    } catch {
      base = null;
    }
    if (graph) { stale = true; renderStatus(); }
  }

  function renderStatus(text) {
    if (text) { status.textContent = text; return; }
    if (!graph) { status.textContent = base ? "Draw를 누르면 그립니다." : "#1의 계산 결과가 있어야 그릴 수 있습니다."; return; }
    const total = graph.curves.reduce((n, c) => n + c.points.length, 0);
    const done = graph.curves.reduce((n, c) => n + c.points.filter((p) => p.status).length, 0);
    const modeText = mode === "height" ? "Roll-in Altitude 고정" : "Tracking Time 고정";
    const time = graph.doneMs ? ` · ${(graph.doneMs / 1000).toFixed(1)} s` : "";
    status.textContent = `${done < total ? `계산 중 ${done} / ${total}` : `${total}점${time}`} · #1 · ${modeText}${stale ? " · 화면 조건이 바뀌었습니다: Draw로 다시 그리기" : ""}`;
  }

  async function draw({ from, to } = {}) {
    if (!answer) takeAnswer(offsetUi.flightAnswer());
    if (!base) { renderStatus("#1의 계산 결과가 있어야 그릴 수 있습니다."); return; }
    const xKey = xSel.value;
    const yKey = ySel.value;
    const condKey = condSel.value || null;
    const a = Number(from ?? fromIn.value);
    const b = Number(to ?? toIn.value);
    const count = Math.min(60, Math.max(3, Math.round(Number(countIn.value) || 21)));
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) { renderStatus("From / To를 확인해 주세요."); return; }
    const condValues = condKey ? parseList(condIn.value) : [null];
    if (condKey && !condValues.length) { renderStatus("조건 값을 쉼표로 넣어 주세요. 예: 2, 3, 4"); return; }
    const keepVrp = xKey === "vrpRangeNm" || condKey === "vrpRangeNm";
    const sweepBase = keepVrp ? sweepBaseline(answer, 1, { keepVrp: true }) : base;
    pool.clear();
    const id = ++job;
    stale = false;
    const xs = sweepValues(Math.min(a, b), Math.max(a, b), count);
    graph = { xKey, yKey, condKey, curves: condValues.map((value) => ({ value, points: xs.map((x) => ({ x })) })), startedAt: performance.now(), doneMs: 0 };
    if (from === undefined) view = null;
    else view = view ? { ...view } : null;
    render();
    renderStatus();
    // Coarse first: every curve's ends and middle, then the rest, so the shape shows early.
    const order = [...xs.keys()].sort((i, j) => coarseRank(i, xs.length) - coarseRank(j, xs.length));
    const tasks = [];
    for (const i of order) {
      graph.curves.forEach((curve) => {
        const assignments = { ...(condKey ? { [condKey]: curve.value } : {}), [xKey]: xs[i] };
        tasks.push(pool.point(sweepBase, assignments).then((point) => {
          if (id !== job || !point) return;
          Object.assign(curve.points[i], point);
          scheduleRender();
        }));
      });
    }
    await Promise.all(tasks);
    if (id !== job) return;
    graph.doneMs = performance.now() - graph.startedAt;
    render();
    renderStatus();
  }
  const coarseRank = (i, n) => {
    for (let level = 0, step = n - 1; step >= 1; level += 1, step = Math.floor(step / 2)) if (i % Math.max(1, step) === 0) return level * 1000 + i;
    return 99999 + i;
  };
  let renderQueued = false;
  const scheduleRender = () => {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); renderStatus(); });
  };

  // ---- drawing ----
  // The picture is laid out in screen pixels (text stays readable on a phone): width = the shell, height from it.
  let W = 900, H = 560, L = 76, pw = 0, ph = 0;
  const R = 22, T = 18, B = 58;
  const layout = () => {
    const width = svg.parentElement?.clientWidth || 900;
    W = Math.round(Math.min(900, Math.max(320, width)));
    H = Math.round(W < 600 ? W * 0.95 : W * 0.62);
    L = W < 600 ? 58 : 76;
    pw = W - L - R;
    ph = H - T - B;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  };
  let scale = null;
  function dataExtent() {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of graph.curves) for (const p of c.points) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      const y = p.y?.[graph.yKey];
      if (Number.isFinite(y)) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    }
    const cur = currentPoint();
    if (cur && Number.isFinite(cur.y)) { y0 = Math.min(y0, cur.y); y1 = Math.max(y1, cur.y); }
    if (!Number.isFinite(y0)) { y0 = 0; y1 = 1; }
    if (y0 === y1) { y0 -= 1; y1 += 1; }
    const pad = (y1 - y0) * 0.06;
    return { x0, x1, y0: y0 - pad, y1: y1 + pad };
  }
  function currentPoint() {
    const ar = answer?.output?.aircraftResults?.[1];
    if (!graph || !ar || !base) return null;
    const x = sweepInputValue(graph.xKey === "vrpRangeNm" ? sweepBaseline(answer, 1, { keepVrp: true }) : base, graph.xKey);
    return { x, y: POPUP_SWEEP_OUTPUTS[graph.yKey].of(ar) };
  }
  function render() {
    svg.replaceChildren();
    legend.replaceChildren();
    if (!graph) return;
    layout();
    const ext = view ?? dataExtent();
    const X = (v) => L + ((v - ext.x0) / (ext.x1 - ext.x0)) * pw;
    const Y = (v) => T + (1 - (v - ext.y0) / (ext.y1 - ext.y0)) * ph;
    scale = { ext, X, Y };
    const xIn = POPUP_SWEEP_INPUTS[graph.xKey];
    const yOut = POPUP_SWEEP_OUTPUTS[graph.yKey];
    svg.append(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#fff" }));
    const defs = svgEl("defs");
    const clip = svgEl("clipPath", { id: "design-graph-clip" });
    clip.append(svgEl("rect", { x: L, y: T, width: pw, height: ph }));
    defs.append(clip);
    svg.append(defs);
    // Grid: major with labels, minor between.
    const grid = (lo, hi, count, along) => {
      const step = niceStep(hi - lo, count);
      const minor = step / 5;
      for (let v = Math.ceil(lo / minor) * minor; v <= hi + 1e-9; v += minor) {
        const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
        const p = along === "x" ? X(v) : Y(v);
        svg.append(svgEl("line", along === "x"
          ? { x1: p, x2: p, y1: T, y2: T + ph, stroke: major ? "#cfcdc8" : "#f0efeb" }
          : { x1: L, x2: L + pw, y1: p, y2: p, stroke: major ? "#cfcdc8" : "#f0efeb" }));
        if (!major) continue;
        const label = svgEl("text", along === "x"
          ? { x: p, y: T + ph + 18, "text-anchor": "middle", "font-size": 12, fill: "#5f5e5a" }
          : { x: L - 8, y: p + 4, "text-anchor": "end", "font-size": 12, fill: "#5f5e5a" });
        label.textContent = fmt(v, step);
        svg.append(label);
      }
    };
    grid(ext.x0, ext.x1, 8, "x");
    grid(ext.y0, ext.y1, 7, "y");
    svg.append(svgEl("rect", { x: L, y: T, width: pw, height: ph, fill: "none", stroke: "#9a9893" }));
    const xl = svgEl("text", { x: L + pw / 2, y: H - 14, "text-anchor": "middle", "font-size": 13, fill: "#2e2d2a" });
    xl.textContent = `${xIn.label} (${xIn.unit})`;
    const yl = svgEl("text", { transform: `translate(18,${T + ph / 2}) rotate(-90)`, "text-anchor": "middle", "font-size": 13, fill: "#2e2d2a" });
    yl.textContent = `${yOut.label} (${yOut.unit})`;
    svg.append(xl, yl);
    const plot = svgEl("g", { "clip-path": "url(#design-graph-clip)" });
    svg.append(plot);
    const condDef = graph.condKey ? POPUP_SWEEP_INPUTS[graph.condKey] : null;
    graph.curves.forEach((curve, ci) => {
      const color = COLORS[ci % COLORS.length];
      const pts = curve.points.filter((p) => p.status && Number.isFinite(p.y?.[graph.yKey]));
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1], b = pts[i];
        const worst = [a.status, b.status].includes("INVALID") || [a.status, b.status].includes("FAILED") ? "INVALID" : [a.status, b.status].includes("WARNING") ? "WARNING" : "VALID";
        plot.append(svgEl("line", {
          x1: X(a.x), y1: Y(a.y[graph.yKey]), x2: X(b.x), y2: Y(b.y[graph.yKey]), stroke: color, "stroke-width": 2.5,
          "stroke-linecap": "round", ...(worst === "VALID" ? {} : { "stroke-dasharray": "6 5" }), ...(worst === "INVALID" ? { opacity: 0.4 } : {}),
        }));
      }
      for (const p of pts) {
        plot.append(svgEl("circle", { cx: X(p.x), cy: Y(p.y[graph.yKey]), r: 3.2, fill: p.status === "VALID" ? color : "#fff", stroke: color, "stroke-width": 1.8, ...(p.status === "INVALID" || p.status === "FAILED" ? { opacity: 0.45 } : {}) }));
      }
      const name = condDef ? `${condDef.label} ${fmt(curve.value, condDef.step)} ${condDef.unit}` : yOut.label;
      legend.append(el("span", { class: "design-graph-key" }, el("i", { style: `background:${color}` }), document.createTextNode(name)));
    });
    const cur = currentPoint();
    if (cur && Number.isFinite(cur.x) && Number.isFinite(cur.y)) {
      plot.append(svgEl("circle", { cx: X(cur.x), cy: Y(cur.y), r: 5.5, fill: "#1f1f1e", stroke: "#fff", "stroke-width": 2 }));
      legend.append(el("span", { class: "design-graph-key" }, el("b", { class: "design-graph-dot" }), document.createTextNode(`현재 ${fmt(cur.x, xIn.step)}${xIn.unit === "°" ? "°" : ` ${xIn.unit}`} → ${fmt(cur.y)} ${yOut.unit}`)));
    }
  }

  // ---- zoom / pan / tooltip ----
  const toData = (clientX, clientY) => {
    const box = svg.getBoundingClientRect();
    const sx = ((clientX - box.left) / box.width) * W;
    const sy = ((clientY - box.top) / box.height) * H;
    const { ext } = scale;
    return { sx, sy, x: ext.x0 + ((sx - L) / pw) * (ext.x1 - ext.x0), y: ext.y0 + (1 - (sy - T) / ph) * (ext.y1 - ext.y0) };
  };
  const zoomAt = (d, fx, fy) => {
    const e = scale.ext;
    view = { x0: d.x - (d.x - e.x0) * fx, x1: d.x + (e.x1 - d.x) * fx, y0: d.y - (d.y - e.y0) * fy, y1: d.y + (e.y1 - d.y) * fy };
    render();
  };
  svg.addEventListener("wheel", (event) => {
    if (!graph || !scale) return;
    event.preventDefault();
    const f = Math.exp(Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY), 200) / 600);
    zoomAt(toData(event.clientX, event.clientY), event.altKey ? 1 : f, event.shiftKey ? 1 : f);
  }, { passive: false });
  const pointers = new Map();
  let pinch = null;
  svg.addEventListener("pointerdown", (event) => {
    if (!graph || !scale) return;
    svg.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), ext: { ...scale.ext } };
    }
  });
  svg.addEventListener("pointermove", (event) => {
    if (!graph || !scale) return;
    const prev = pointers.get(event.pointerId);
    if (!prev) { hover(event); return; }
    const now = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, now);
    if (pointers.size >= 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist > 0) {
        const f = pinch.dist / dist;
        pinch.dist = dist;
        zoomAt(toData((a.x + b.x) / 2, (a.y + b.y) / 2), f, f);
      }
      return;
    }
    const box = svg.getBoundingClientRect();
    const e = scale.ext;
    const dx = ((now.x - prev.x) / box.width) * W / pw * (e.x1 - e.x0);
    const dy = ((now.y - prev.y) / box.height) * H / ph * (e.y1 - e.y0);
    view = { x0: e.x0 - dx, x1: e.x1 - dx, y0: e.y0 + dy, y1: e.y1 + dy };
    tip.hidden = true;
    render();
  });
  const release = (event) => { pointers.delete(event.pointerId); if (pointers.size < 2) pinch = null; };
  svg.addEventListener("pointerup", release);
  svg.addEventListener("pointercancel", release);
  svg.addEventListener("pointerleave", () => { tip.hidden = true; });
  svg.addEventListener("dblclick", () => { view = null; render(); });
  function hover(event) {
    const d = toData(event.clientX, event.clientY);
    let best = null;
    graph.curves.forEach((curve) => curve.points.forEach((p) => {
      const y = p.y?.[graph.yKey];
      if (!Number.isFinite(y)) return;
      const dist = Math.hypot(scale.X(p.x) - d.sx, scale.Y(y) - d.sy);
      if (dist < 14 && (!best || dist < best.dist)) best = { dist, p, curve, y };
    }));
    if (!best) { tip.hidden = true; return; }
    const xIn = POPUP_SWEEP_INPUTS[graph.xKey];
    const yOut = POPUP_SWEEP_OUTPUTS[graph.yKey];
    const c = graph.condKey ? POPUP_SWEEP_INPUTS[graph.condKey] : null;
    tip.replaceChildren(
      el("b", { text: `${c ? `${c.label} ${fmt(best.curve.value, c.step)} ${c.unit} · ` : ""}${xIn.label} ${fmt(best.p.x, xIn.step)} ${xIn.unit}` }),
      el("div", { text: `${yOut.label} ${fmt(best.y)} ${yOut.unit} · ${best.p.status}` }),
      ...(best.p.messages?.length && best.p.status !== "VALID" ? [el("div", { class: "design-graph-tip-msg", text: best.p.messages[0] })] : []),
    );
    const box = svg.getBoundingClientRect();
    const shell = svg.parentElement.getBoundingClientRect();
    tip.style.left = `${Math.min(shell.width - 260, ((scale.X(best.p.x) / W) * box.width) + box.left - shell.left + 12)}px`;
    tip.style.top = `${((scale.Y(best.y) / H) * box.height) + box.top - shell.top + 12}px`;
    tip.hidden = false;
  }

  // ---- Step by Step: the sweeps, the windows, the picture ----
  let steps = null;
  let stepsJob = 0;
  const num1 = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "-");
  const ft = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString("en-US") : "-");
  async function runSteps() {
    const next = offsetUi.flightAnswer();
    if (next) takeAnswer(next);
    const ar = answer?.output?.aircraftResults?.[1];
    if (!base || !ar?.result) { stepsStatus.textContent = "#1의 계산 결과가 있어야 계산할 수 있습니다."; return; }
    const id = ++stepsJob;
    stepsPool.clear();
    const started = performance.now();
    const pub = ar.result.profile?.public ?? {};
    const current = {
      popupAngleDeg: ar.popup?.popupAngleDeg, offsetAngleDeg: ar.result.resolved?.offsetAngleDeg, approachRangeNm: ar.result.resolved?.approachRangeNm,
      offsetPopupTimeSec: POPUP_SWEEP_OUTPUTS.offsetPopupTimeSec.of(ar), apexKcas: ar.popup?.apexKcas, mapNm: pub.groundRangeNm,
      rollInAltitudeMslFt: pub.resolvedInitialAltitudeMslFt, trackingTimeSec: pub.trackingTimeSec, releaseAltitudeMslFt: pub.effectiveReleaseAltitudeMslFt ?? base.values?.releaseAltitudeMslFt, diveAngleDeg: base.values?.diveAngleDeg,
    };
    let done = 0;
    let total = POPUP_ANGLE_GRID.length + OFFSET_ANGLE_GRID.length;
    const progress = (label) => { stepsStatus.textContent = `계산 중 ${done} / ${total} · ${label}`; };
    const sweep = (grid, key, extra, label) => Promise.all(grid.map((x) => stepsPool.point(base, { ...extra, [key]: x }).then((point) => { done += 1; if (id === stepsJob) progress(label); return { x, ...(point ?? { status: "FAILED", y: {} }) }; })));
    applyBtn.disabled = true;
    progress("Step 2–3 Popup Angle");
    const popup = await sweep(POPUP_ANGLE_GRID, "popupAngleDeg", {}, "Step 2–3 Popup Angle");
    if (id !== stepsJob) return;
    const w = popupAngleWindow(popup);
    const atPopup = w.recommended?.centreDeg ?? current.popupAngleDeg;
    const offset = await sweep(OFFSET_ANGLE_GRID, "offsetAngleDeg", { popupAngleDeg: atPopup }, "Step 4 Offset Angle");
    if (id !== stepsJob) return;
    const o = offsetAngleRange(offset);
    // Step 5: once more, only when the page's Offset Angle is past the Step 4 limit (else the same window again).
    let popup2 = null;
    let againAt = null;
    if (Number.isFinite(o.highDeg) && current.offsetAngleDeg > o.highDeg + 0.05) {
      againAt = Math.max(OFFSET_ANGLE_GRID[0], Math.floor(o.highDeg * 2) / 2);
      total += POPUP_ANGLE_GRID.length;
      popup2 = await sweep(POPUP_ANGLE_GRID, "popupAngleDeg", { offsetAngleDeg: againAt }, "Step 5 반복");
      if (id !== stepsJob) return;
    }
    steps = { ...designSteps({ current, popup, offset, popup2 }), atPopup, againAt, current, ms: performance.now() - started };
    renderSteps();
  }
  function renderSteps() {
    if (!steps) return;
    const { step1: b, popupWindow: w, offsetRange: o, popupWindow2: w2, limits, current, atPopup, againAt } = steps;
    const win = (x) => (x?.recommended ? `${num1(x.recommended.fromDeg)}–${num1(x.recommended.toDeg)}° (가운데 ${num1(x.recommended.centreDeg)}°)` : "없음");
    const li = (title, text) => el("li", {}, el("b", { text: title }), document.createTextNode(` ${text}`));
    const rows = [
      li("BDP", `Dive ${num1(b.diveAngleDeg)}° · Release ${ft(b.releaseAltitudeMslFt)} ft · Tracking ${num1(b.trackingTimeSec)} s → MAP ${num1(b.mapNm, 2)} NM · Roll-in ${ft(b.rollInAltitudeMslFt)} ft · Approach ${num1(b.approachRangeNm, 2)} NM`),
      li("Popup Angle 범위", `하한 ${num1(w.lowDeg)}° (Offset-Popup ${limits.minOffsetPopupSec} s) · 상한 ${num1(w.highDeg)}° (${w.highBy === "arc" ? `상승 호가 Roll-in Altitude에 닿는 한계, Apex${Number.isFinite(w.apex300Deg) ? ` ${limits.apexMinKcas} KCAS는 ${num1(w.apex300Deg)}°` : `는 끝까지 ${limits.apexMinKcas} KCAS 이상`}` : `Apex ${limits.apexMinKcas} KCAS`}) · Offset Angle ${num1(current.offsetAngleDeg)}° 기준`),
      li("Min EXP 범위", `${w.minExposure ? `${num1(w.minExposure.fromDeg)}–${num1(w.minExposure.toDeg)}°` : "없음"} (Apex ${limits.apexMaxKcas}→${limits.apexMinKcas} KCAS) → 추천 ${win(w)} · 현재 ${num1(current.popupAngleDeg)}°, Apex ${num1(current.apexKcas, 0)} KCAS`),
      li("Offset Angle 범위", o?.highDeg !== null && o ? `Popup ${num1(atPopup)}°에서 상한 ${num1(o.highDeg)}° (Offset-Popup ${limits.minOffsetPopupSec} s), 하한 없음${Number.isFinite(o.longBelowDeg) ? ` · 참고: ${num1(o.longBelowDeg)}° 아래는 Offset-Popup ${limits.longOffsetPopupSec} s 넘음` : ""} · 현재 ${num1(current.offsetAngleDeg)}°` : `Popup ${num1(atPopup)}°에서 Offset-Popup ${limits.minOffsetPopupSec} s를 만드는 Offset Angle이 없음`),
      li("반복", w2 ? `Offset Angle ${num1(againAt)}°에서 Popup Angle 다시: 추천 ${win(w2)}` : "현재 Offset Angle이 상한 안이라 Step 2–3 결과 그대로입니다"),
      li("수정할 것", steps.hints.length ? steps.hints.map((h) => h.text).join(" / ") : "없음: 현재 값이 범위 안입니다"),
    ];
    stepsList.replaceChildren(...rows);
    stepsStatus.textContent = `${(steps.ms / 1000).toFixed(1)} s · #1 · ${mode === "height" ? "Roll-in Altitude 고정" : "Tracking Time 고정"} · Popup Angle ${POPUP_ANGLE_GRID[0]}–${POPUP_ANGLE_GRID.at(-1)}°, Offset Angle ${OFFSET_ANGLE_GRID[0]}–${OFFSET_ANGLE_GRID.at(-1)}° 1° 간격`;
    applyBtn.disabled = !Number.isFinite(steps.suggestion.popupAngleDeg);
    applyBtn.textContent = Number.isFinite(steps.suggestion.popupAngleDeg) ? `Popup Angle ${num1(steps.suggestion.popupAngleDeg)}° 넣기` : "Popup Angle에 넣기";
    renderCentring();
  }
  // Centring chart: one bar per pick, its range, the centre tick and the current value.
  function renderCentring() {
    centreSvg.replaceChildren();
    if (!steps) return;
    const width = Math.round(Math.min(900, Math.max(320, centreSvg.parentElement?.clientWidth || 900)));
    const narrow = width < 600;
    const L0 = narrow ? 92 : 150, R0 = 24, rowH = 56, height = 22 + rowH * 2;
    centreSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    centreSvg.append(svgEl("rect", { x: 0, y: 0, width, height, fill: "#fff" }));
    const w = steps.popupWindow2 ?? steps.popupWindow;
    const rows = [
      { label: "Popup Angle", lo: 10, hi: 55, bands: [
        ...(Number.isFinite(w.lowDeg) && Number.isFinite(w.highDeg) && w.lowDeg < w.highDeg ? [{ from: w.lowDeg, to: w.highDeg, fill: "#d9e7f8" }] : []),
        ...(w.recommended ? [{ from: w.recommended.fromDeg, to: w.recommended.toDeg, fill: "#2a78d6" }] : []),
      ], centre: w.recommended?.centreDeg, value: steps.current.popupAngleDeg },
      { label: "Offset Angle", lo: 0, hi: 40, bands: Number.isFinite(steps.offsetRange?.highDeg) ? [{ from: 0, to: steps.offsetRange.highDeg, fill: "#1baf7a" }] : [], centre: null, value: steps.current.offsetAngleDeg },
    ];
    rows.forEach((row, i) => {
      const y = 14 + i * rowH;
      const X = (v) => L0 + ((Math.min(row.hi, Math.max(row.lo, v)) - row.lo) / (row.hi - row.lo)) * (width - L0 - R0);
      const label = svgEl("text", { x: 8, y: y + 21, "font-size": narrow ? 12 : 13, fill: "#2e2d2a" });
      label.textContent = row.label;
      centreSvg.append(label, svgEl("rect", { x: L0, y: y + 8, width: width - L0 - R0, height: 18, fill: "#f0efeb", rx: 4 }));
      for (const band of row.bands) centreSvg.append(svgEl("rect", { x: X(band.from), y: y + 8, width: Math.max(1, X(band.to) - X(band.from)), height: 18, fill: band.fill, rx: 4 }));
      if (Number.isFinite(row.centre)) centreSvg.append(svgEl("line", { x1: X(row.centre), x2: X(row.centre), y1: y + 4, y2: y + 30, stroke: "#1f1f1e", "stroke-width": 1.5, "stroke-dasharray": "3 2" }));
      for (let v = row.lo; v <= row.hi + 1e-9; v += 10) {
        const t = svgEl("text", { x: X(v), y: y + 44, "text-anchor": "middle", "font-size": 11, fill: "#5f5e5a" });
        t.textContent = `${v}°`;
        centreSvg.append(t);
      }
      if (Number.isFinite(row.value)) {
        centreSvg.append(svgEl("path", { d: `M${X(row.value)},${y + 7} l-6,-8 h12 z`, fill: "#e34948" }));
        const t = svgEl("text", { x: Math.min(width - R0, X(row.value) + 9), y: y + 3, "font-size": 11, fill: "#e34948" });
        t.textContent = `현재 ${row.value.toFixed(1)}°`;
        centreSvg.append(t);
      }
    });
  }
  stepsBtn.addEventListener("click", () => runSteps());
  applyBtn.addEventListener("click", () => {
    const deg = steps?.suggestion?.popupAngleDeg;
    const input = document.querySelector('input[data-key="popupAngleDeg"]');
    if (!Number.isFinite(deg) || !input) return;
    input.value = deg.toFixed(1);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    stepsStatus.textContent = `#1 Popup Angle에 ${deg.toFixed(1)}°를 넣었습니다. 결과가 바뀌면 단계 계산을 다시 누르세요.`;
  });

  xSel.addEventListener("change", () => { fillSelectors(); setXDefaults(); });
  condSel.addEventListener("change", setCondDefaults);
  drawBtn.addEventListener("click", () => draw());
  regionBtn.addEventListener("click", () => { if (graph && scale) draw({ from: scale.ext.x0, to: scale.ext.x1 }); });
  resetBtn.addEventListener("click", () => { view = null; render(); });

  offsetUi.onFlightAnswer?.((next) => takeAnswer(next));
  // Redraw at the new width (the picture is laid out in pixels).
  if (typeof ResizeObserver === "function") {
    let lastWidth = 0;
    new ResizeObserver(() => { const w = svg.parentElement?.clientWidth || 0; if (graph && Math.abs(w - lastWidth) > 4) { lastWidth = w; render(); } }).observe(svg.parentElement);
    let lastStepsWidth = 0;
    new ResizeObserver(() => { const w = centreSvg.parentElement?.clientWidth || 0; if (steps && Math.abs(w - lastStepsWidth) > 4) { lastStepsWidth = w; renderCentring(); } }).observe(centreSvg.parentElement);
  }
  let active = false;
  return {
    activate() {
      active = true;
      wizard.activate();
      takeAnswer(offsetUi.flightAnswer());
      if (!drawnOnce) {
        fillSelectors();
        xSel.value = DEFAULT_GRAPH.x;
        ySel.value = DEFAULT_GRAPH.y;
        inputOptions(condSel, mode, xSel.value, true);
        condSel.value = DEFAULT_GRAPH.condition;
        setXDefaults();
        setCondDefaults();
        if (base) { drawnOnce = true; draw(); } else renderStatus();
      } else renderStatus();
    },
    deactivate() { active = false; wizard.deactivate(); },
    // Read-only hooks for the browser checks.
    state: () => ({ active, graph, view, mode, steps, wizard: wizard.state() }),
  };
}
