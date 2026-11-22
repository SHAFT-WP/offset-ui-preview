// POP-UP Design tab: the four planning steps (owner 2026-11-20, "확정하고 진행하자"; AG/bombing/popup/DESIGN-STEPS.md, S1).
// 1 BDP, 2 POP-UP parameters (MAP confirmed with the pop-up), 3 Offset conditions, 4 fine tuning. #1 only.
// Nothing is computed here: every number is a readout of the page's last Flight answer (the POP-UP Flight BE).
//   Input links: each step's inputs are more copies of the page's own fields (the same data-key), so typing here is
//     typing there and every copy shows the one value (DESIGN-STEPS.md §0 "입력 링크").
//   확정 / 해제: each step turns its bundle of the page's existing LOCKs on or off by pressing the page's own LOCK
//     buttons (no new LOCK system): 1 Dive Angle; 2 Popup Angle (integer, the Roll-in Speed LOCK released, §6);
//     3 VRP and one of Angle Off / Attack Heading (exclusive, decision 3); the Offset Angle / Action / Approach Range
//     LOCKs are released so the BE solves them. Step 4's Fine tune comes with S4.
// The graph, ranges, Top View region and Fine tune are S2–S4 (DESIGN-STEPS.md §5).
import { sweepBaseline } from "./AG/bombing/popup/popup-dependency-sweep-v0.1.mjs?v=0.1.2";
import { POPUP_ANGLE_GRID, popupAngleRange, popupProfileLine } from "./AG/bombing/popup/popup-design-steps-v0.1.mjs?v=0.1.2";
import { defaultPopupAngleDeg } from "./AG/bombing/popup/popup-be-v0.2.mjs?v=0.2.5";
import { renderAngleCharts, renderProfile } from "./popup-design-popup-chart-v0.1.mjs?v=0.1.2";
import { ANGLE_OFF_GRID, coarseFirst, insideSpan, regionBaseline, regionMirrorBaseline, regionSummary } from "./AG/bombing/popup/popup-offset-region-v0.1.mjs?v=0.1.1";
import { POPUP_DESIGN_TOPVIEW_V0_1, renderRegionTopView } from "./popup-design-topview-v0.1.mjs?v=0.1.3";
import { installSvgViewport } from "./common/diagram/svg-viewport-v0.1.mjs?v=0.1.5";
import { fineTuneBaseline } from "./AG/bombing/popup/popup-fine-tune-v0.1.mjs?v=0.1.0";

// 0.1.1 (S2): step 2 shows the Popup Angle sweep first (five small charts over the Popup Angle: Exposure, Apex speed,
// Min Pop-up Distance, Approach-Pop Distance / Time; Apex 300–350 KCAS area, AUTO angle, the range), the range
// (AUTO and the Apex area together) with the Min Pop-up Distance at both ends, one value once step 2 is confirmed,
// and the flown pop-up profile as a red line. The sweep runs again when an input other than the Popup Angle changes.
// 0.1.2 (S3): step 3 draws the possible region on a Top View (popup-offset-region-v0.1: VRP held, Popup Angle LOCKed,
// Angle Off swept) with the Angle Off / Attack Heading range, says when the value typed is outside it, and once
// confirmed shows step 2 again (Popup Angle range, Approach-Pop, Apex at the new Offset).
// 0.1.3 (S4): step 4 Fine tune — the user picks one target (Approach-Pop Time in whole seconds, Roll-in Alt or Pull
// Down Alt), types it and presses Fine tune; the BE (popup-fine-tune-v0.1) finds the Apex-side input (Roll-in Altitude in
// height mode, Tracking Time in time mode) or, for the Approach-Pop Time, the Offset Angle through the step-3 LOCK,
// and that value is typed into the page's field.
// 0.1.4 (owner 2026-11-20 follow-up): the linked fields are the page's size (CSS); every chart draws its first
// derivative behind it (one "1차 미분" button hides / shows them all) and is read with the mouse; every picture zooms
// (common svg-viewport: − / % / + / Fit, drag when zoomed); the profile draws the Approach-Pop leg before the Pop;
// the Top View region is solved on both Roll-in sides (the Attack Heading mirrored about the Run-In) and drawn in
// the Offset Top View symbols with the turn paths.
export const POPUP_DESIGN_STEPS_UI_V0_1 = Object.freeze({ id: "popup-design-steps-ui-v0.1", version: "0.1.7" });
// 0.1.7 (owner 2026-11-22): the IP Bottom button sits in the Top View zoom row, left of the size buttons (zoomable lead).
// 0.1.6 (owner 2026-11-22): the step-2 range is Approach-Pop 2 s .. Apex 300 KCAS (or the arc limit), drawn as a green
// area with the 0–2 s lead-in light; the readout says what sets the upper end, or why the range is empty.
// 0.1.5 (owner 2026-11-22, "탑뷰 ip가 bottom에 있는 것이 default 옵션을 넣어서 북쪽이 위로"): the step 3 Top View has the
// Offset Top View's IP Bottom button, on by default (Run-In up, IP at the bottom); off = north up.

// A picture with the common zoom (the Offset Top View's button zoom: − / % / + / Fit; drag pans when zoomed).
// The renderers keep a fixed canvas, so svg.__viewport.refresh() after a redraw keeps the zoom.
export function zoomable(svg, width, height, { maxZoom = 4, lead = [] } = {}) {
  const button = (text, label) => el("button", { class: "capture-button design-zoom-button", type: "button", "aria-label": label, text });
  const out = button("−", "Zoom out"), size = button("100%", "Zoom 100%"), into = button("+", "Zoom in"), fit = button("Fit", "Fit");
  const bar = el("div", { class: "design-zoom-bar" }, ...lead, out, size, into, fit);
  const viewport = installSvgViewport(svg, {
    baseViewBox: { x: 0, y: 0, w: width, h: height },
    panOnlyWhenZoomed: true,
    buttonOnlyZoom: true,
    allowPageScrollWhenPanDisabled: true,
    maxZoom,
    maxZoomOut: 1,
    onViewBoxChange: (box) => {
      const percent = Math.round((width / box.w) * 100);
      size.textContent = `${percent}%`;
      into.disabled = percent >= maxZoom * 100;
      out.disabled = percent <= 100;
    },
  });
  const step = (delta) => {
    const now = width / viewport.getViewBox().w;
    const next = Math.max(1, Math.min(maxZoom, Math.round((now + delta) * 100) / 100));
    viewport.zoomCenter(now / next);
  };
  into.addEventListener("click", () => step(0.5));
  out.addEventListener("click", () => step(-0.5));
  size.addEventListener("click", () => viewport.reset());
  fit.addEventListener("click", () => viewport.reset());
  svg.__viewport = viewport;
  return el("div", { class: "design-zoom" }, bar, svg);
}

// Approach-Pop (Hold-Down) time: 0 s allowed with a warning, 2 s recommended, under 0 INVALID (DESIGN-STEPS.md §0).
export const APPROACH_POP_RECOMMENDED_SEC = 2;
export function approachPopLevel(sec) {
  if (!Number.isFinite(sec)) return "none";
  if (sec < 0) return "bad";
  if (sec < APPROACH_POP_RECOMMENDED_SEC) return "warn";
  return "ok";
}

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
const one = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "-");
const ft = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString("en-US") : "-");

// The fields linked into the Design tab: label, unit note.
const LINKS = Object.freeze({
  diveAngleDeg: ["Dive Angle (deg)", "BDP"],
  releaseAltitudeMslFt: ["Release Altitude (ft MSL)", "BDP"],
  trackingTimeSec: ["Tracking Time (sec)", "Track Point → Release"],
  rollInAltitudeMslFt: ["Roll-in Altitude (ft MSL)", "BDP entry"],
  popupSpeedKcas: ["Pop-up Speed (kcas)", "blank = Initial Speed"],
  popupAngleDeg: ["Popup Angle (deg)", "0–55°"],
  popupG: ["Popup G (G)", "Pull-up G"],
  vrpRangeNm: ["VRP Range (NM)", "Target → VRP"],
  angleOffDeg: ["Angle Off (deg)", "Run-In → Attack Heading"],
  attackHeadingDeg: ["Attack Heading (deg)", "Final attack axis"],
  rollInG: ["Roll-in G (G)", "Roll-in"],
  offsetG: ["Offset G (G)", "Offset Turn"],
  gOnsetRateGSec: ["G Onset Rate (G/s)", "Roll-in · Offset · Popup"],
  offsetSpeedValue: ["Initial Speed (kcas)", "IP → Offset → Pop"],
  initialAltitudeMslFt: ["Initial Altitude (ft MSL)", "= Offset Altitude (Pop)"],
});

// The page's own control for a LOCK (never a Design copy, never a follower's).
const mainOf = (selector, host) => [...document.querySelectorAll(selector)].find((node) => !host.contains(node) && !node.closest(".flight-slot")) ?? null;
const pressed = (button) => button?.getAttribute("aria-pressed") === "true";

export function mountPopupDesignSteps({ host, offsetUi, rangeTools = null, pool = null, regionPool = null, tunePool = null }) {
  const root = el("section", { class: "design-wizard", "data-design-wizard": "" });
  const statusLine = el("p", { class: "design-graph-status", role: "status", text: "-" });
  const outs = new Map();
  const cards = {};
  const linkInputs = [];

  const link = (key, extra = {}) => {
    const [label, unit] = LINKS[key];
    const input = el("input", { "data-key": key, "data-design-link": "", type: "text", inputmode: "decimal", "aria-label": label });
    linkInputs.push(input);
    const title = extra.lock ? el("span", { class: "lock-title" }, el("span", { text: label }), extra.lock) : el("span", { text: label });
    return el("label", { class: "field" }, title, input, el("span", { class: "unit", text: unit }));
  };
  const readout = (key, label, unit = "") => {
    const out = el("output", { class: "readout", "data-design-out": key, text: "-" });
    outs.set(key, out);
    return el("div", { class: "field" }, el("span", { text: label }), out, el("span", { class: "unit", text: unit }));
  };
  // A Design LOCK button standing for a page LOCK (pressing it presses the page's).
  const lockButton = (name, label) => el("button", { class: "lock-button", type: "button", "data-design-lock": name, "aria-pressed": "false", "aria-label": `Lock ${label}`, text: "LOCK" });
  const card = (n, title, note, body) => {
    const pill = el("span", { class: "design-step-pill", text: "미확정" });
    const confirm = el("button", { class: "btn", type: "button", "data-design-confirm": String(n), text: "확정" });
    const release = el("button", { class: "capture-button", type: "button", "data-design-release": String(n), text: "해제" });
    const node = el("details", { class: "design-step", "data-design-step": String(n), open: "" },
      el("summary", { class: "design-step-head" }, el("b", { class: "step", text: String(n) }), el("span", { class: "design-step-title", text: title }), ...(n < 4 ? [pill] : [])),
      el("p", { class: "flight-draft-note", text: note }),
      ...body,
      ...(n < 4 ? [el("div", { class: "design-graph-actions" }, confirm, release)] : []));
    cards[n] = { node, pill, confirm, release };
    return node;
  };
  const grid = (...nodes) => el("div", { class: "input-grid design-step-grid" }, ...nodes);

  let showDerivative = true;
  const derivativeButton = el("button", { class: "capture-button", type: "button", "data-design-derivative": "", "aria-pressed": "true", text: "1차 미분 숨기기" });
  derivativeButton.addEventListener("click", () => {
    showDerivative = !showDerivative;
    derivativeButton.setAttribute("aria-pressed", String(showDerivative));
    derivativeButton.textContent = showDerivative ? "1차 미분 숨기기" : "1차 미분 보이기";
    renderPopupStep(answer?.output?.aircraftResults?.[1]);
  });
  const sweepStatus = el("p", { class: "design-graph-status", role: "status", text: "Popup Angle 그래프: Design 탭을 열면 계산합니다." });
  const profileSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  profileSvg.setAttribute("class", "design-steps-svg");
  profileSvg.setAttribute("data-design-profile", "");
  profileSvg.setAttribute("role", "img");
  profileSvg.setAttribute("aria-label", "Pop-up profile");
  const regionStatus = el("p", { class: "design-graph-status", role: "status", text: "Top View 가능 영역: Design 탭을 열면 계산합니다." });
  const regionNote = el("p", { class: "design-region-note", role: "status", text: "" });
  const topSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  topSvg.setAttribute("class", "design-steps-svg design-topview-svg");
  topSvg.setAttribute("data-design-topview", "");
  topSvg.setAttribute("role", "img");
  topSvg.setAttribute("aria-label", "Top View possible region");
  let topIpBottom = true;
  const ipBottomButton = el("button", { class: "capture-button view-toggle active", type: "button", "data-design-ip-bottom": "", "aria-pressed": "true", title: "Run-In (IP → Target) up; off = north up", text: "IP Bottom" });
  ipBottomButton.addEventListener("click", () => {
    topIpBottom = !topIpBottom;
    ipBottomButton.setAttribute("aria-pressed", String(topIpBottom));
    ipBottomButton.classList.toggle("active", topIpBottom);
    renderRegionStep(answer?.output?.aircraftResults?.[1]);
  });
  const angleOffLock = lockButton("angleOffDeg", "Angle Off");
  const attackLock = lockButton("attackHeadingDeg", "Attack Heading");
  const fineTune = el("button", { class: "btn", type: "button", "data-design-fine-tune": "", text: "Fine tune" });
  const tuneTarget = el("select", { "aria-label": "Fine tune target", "data-design-tune-target": "" },
    el("option", { value: "holdDownSec", text: "Approach-Pop (s)" }),
    el("option", { value: "rollInAltitudeMslFt", text: "Roll-in Alt (ft)" }),
    el("option", { value: "pullDownAltitudeMslFt", text: "Pull Down Alt (ft)" }));
  const tuneValue = el("input", { type: "text", inputmode: "decimal", "aria-label": "Fine tune value", "data-design-tune-value": "" });
  const tuneKnob = el("select", { "aria-label": "Fine tune knob", "data-design-tune-knob": "" },
    el("option", { value: "apex", text: "Apex 쪽 (기본)" }),
    el("option", { value: "offset", text: "Offset Angle" }));
  const tuneStatus = el("p", { class: "design-graph-status", role: "status", "data-design-tune-status": "", text: "목표 하나를 골라 값을 고친 뒤 Fine tune을 누르세요. Apex는 직접 넣지 않습니다." });
  const tuneField = (label, node, unit) => el("label", { class: "field" }, el("span", { text: label }), node, el("span", { class: "unit", text: unit }));
  const folded = el("details", { class: "design-step-fold" }, el("summary", { text: "Dive Angle · Release Altitude" }), grid(link("diveAngleDeg"), link("releaseAltitudeMslFt")));
  const rangeFold = rangeTools ? el("details", { class: "design-step-fold" }, el("summary", { text: "범위 계산 (Step by Step)" }), rangeTools) : null;

  root.append(
    el("h3", { class: "design-steps-title", text: "단계별 플래닝 (#1)" }),
    statusLine,
    card(1, "BDP", "Dive, Release, Tracking (또는 Roll-in Altitude)를 정합니다. MAP은 2단계에서 Popup Angle과 함께 확정됩니다 (Popup Angle이 Roll-in 속도와 Release 속도를 바꿉니다). 확정 = Dive Angle LOCK.", [
      grid(link("diveAngleDeg"), link("releaseAltitudeMslFt"), link("trackingTimeSec"), link("rollInAltitudeMslFt"),
        readout("map", "MAP (NM)", "잠정 · 2단계에서 확정"), readout("rollInAlt", "Roll-in Altitude (ft MSL)", "result"), readout("releaseSpeed", "Release Speed (kcas)", "MIL dive · result")),
    ]),
    card(2, "POP-UP 파라미터 (MAP 확정)", "그래프를 먼저 보고 Popup Angle을 정합니다. 범위(초록) = Approach-Pop 2 s가 되는 각도 ~ Apex 300 KCAS가 되는 각도(그 전에 비행 한계면 거기까지). 연한 초록 = Approach-Pop 0–2 s. Approach-Pop은 0 s 경고, 2 s 권장. 확정 = Popup Angle을 정수로 LOCK (Roll-in Speed LOCK은 풀림), MAP과 Min Pop-up Distance 확정.", [
      sweepStatus,
      el("div", { class: "design-angle-charts", "data-design-angle-charts": "" }),
      el("p", { class: "design-chart-key" },
        el("i", { class: "key-apex" }), document.createTextNode("Apex 300–350 KCAS (참고) "),
        el("i", { class: "key-range" }), document.createTextNode("Popup Angle 범위 (연한 = 0–2 s) "),
        el("i", { class: "key-auto" }), document.createTextNode("AUTO "),
        el("i", { class: "key-current" }), document.createTextNode("현재 각도 "),
        el("i", { class: "key-derivative" }), document.createTextNode("1차 미분 (오른쪽 눈금) "), derivativeButton),
      grid(readout("angleRange", "Popup Angle 범위", "Approach-Pop 2 s ~ Apex 300 KCAS"), readout("minPopRange", "Min Pop-up Distance (NM)", "범위 양 끝 · 확정하면 하나")),
      el("div", { class: "design-steps-shell" }, zoomable(profileSvg, 640, 240)),
      grid(link("popupAngleDeg"), link("popupSpeedKcas"), link("trackingTimeSec"), link("popupG"),
        readout("popupAngle", "Popup Angle 비행값", "driver"), readout("minPop", "Min Pop-up Distance (NM)", "Pop → Roll-in Start · 수평"),
        readout("appPopNm", "Approach-Pop Distance (NM)", "Approach start → Pop"), readout("appPopSec", "Approach-Pop Time (sec)", "0 s 경고 · 2 s 권장"),
        readout("apex", "Apex", "ft MSL · KCAS"), readout("exposure", "Exposure (sec)", "Pop → Apex"), readout("map2", "MAP (NM)", "확정하면 고정")),
      folded,
      ...(rangeFold ? [rangeFold] : []),
    ]),
    card(3, "Offset 조건", "VRP를 고정하고 Angle Off를 바꿔 가며 계산한 가능 영역입니다 (2단계 Popup Angle로). Angle Off나 Attack Heading 중 하나를 LOCK하면 BE가 Offset Angle, Approach Range, Approach-Pop을 찾습니다. 둘은 같이 LOCK할 수 없습니다. 확정 = VRP LOCK + 선택한 하나, 그 뒤 2단계 값을 다시 확인합니다.", [
      regionStatus,
      el("div", { class: "design-steps-shell" }, zoomable(topSvg, POPUP_DESIGN_TOPVIEW_V0_1.canvas.width, POPUP_DESIGN_TOPVIEW_V0_1.canvas.height, { lead: [ipBottomButton] })),
      grid(readout("regionAo", "가능 Angle Off", "Approach-Pop ≥ 0 s · (≥ 2 s)"), readout("regionAtk", "가능 Attack Heading", "Approach-Pop ≥ 0 s · (≥ 2 s)")),
      regionNote,
      grid(readout("reference", "Reference", "VRP / VIP"), link("vrpRangeNm"),
        link("angleOffDeg", { lock: angleOffLock }), link("attackHeadingDeg", { lock: attackLock }),
        readout("offsetAngle", "Offset Angle (deg)", "result"), readout("approach", "Approach Range (NM)", "Turn End → Roll-in Start"),
        readout("appPopSec3", "Approach-Pop Time (sec)", "0 s 경고 · 2 s 권장")),
      grid(readout("recheckAngle", "2단계 재확인: Popup Angle", "범위 안 / 밖"), readout("recheckApex", "2단계 재확인: Apex", "300–350 KCAS"), readout("recheckAppPop", "2단계 재확인: Approach-Pop", "Distance · Time")),
    ]),
    card(4, "미세튜닝", "G와 진입 속도·고도로 다듬습니다. Fine tune: Approach-Pop Time(정수 초), Roll-in Alt, Pull Down Alt 중 하나를 목표로 고치고 누르면, BE가 Apex 쪽(Roll-in Altitude 또는 Tracking Time) 또는 Offset Angle을 바꿔 맞춥니다. Apex를 바꾸면 MAP과 Tracking Time도 같이 바뀝니다.", [
      grid(link("rollInG"), link("offsetG"), link("gOnsetRateGSec"), link("offsetSpeedValue"), link("initialAltitudeMslFt"),
        readout("appPopSec4", "Approach-Pop Time (sec)", "0 s 경고 · 2 s 권장"), readout("rollInAlt4", "Roll-in Altitude (ft MSL)", "result"),
        readout("pullDown", "Pull Down Alt (ft MSL)", "롤 끝, 당기기 시작"), readout("apex4", "Apex", "ft MSL · KCAS · 유저 입력 아님")),
      grid(tuneField("Fine tune 목표", tuneTarget, "하나만 고릅니다"), tuneField("목표값", tuneValue, "계산값에서 고치기"), tuneField("맞추는 쪽", tuneKnob, "Approach-Pop만 Offset Angle 선택 가능")),
      el("div", { class: "design-graph-actions" }, fineTune),
      tuneStatus,
    ]),
  );
  host.prepend(root);

  // ---- the page's controls ----
  const mainLock = (key) => mainOf(`[data-lock-key="${key}"]`, root);
  const mainPopupLock = (kind) => mainOf(`[data-popup-lock="${kind}"]`, root);
  const mainField = (key) => mainOf(`[data-key="${key}"]`, root);
  const isVip = () => answer?.input?.aircraft?.[1]?.state?.referenceMode === "VIP";
  let answer = null;
  // The next Flight answer (each press waits for its answer before the next, so the edits keep their order).
  let waiting = [];
  const nextAnswer = () => new Promise((resolve) => {
    const timer = setTimeout(() => { waiting = waiting.filter((w) => w !== done); resolve(); }, 6000);
    const done = () => { clearTimeout(timer); resolve(); };
    waiting.push(done);
  });
  const press = async (button, on) => {
    if (!button || pressed(button) === on) return;
    const answered = nextAnswer();
    button.click();
    await answered;
  };
  const setField = async (key, text) => {
    const input = mainField(key);
    if (!input || input.value === text) return;
    const answered = nextAnswer();
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await answered;
  };
  let busy = false;
  const run = async (job) => {
    if (busy) return;
    busy = true;
    root.classList.add("design-wizard-busy");
    try { await job(); } finally { busy = false; root.classList.remove("design-wizard-busy"); render(); }
  };
  const releaseSolved = async () => {
    for (const key of ["offsetAngleDeg", "actionRangeNm", "approachRangeNm"]) await press(mainLock(key), false);
  };
  // Angle Off / Attack Heading: one LOCK at a time (decision 3: VRP + both is always a CONSTRAINT CONFLICT).
  const exclusive = (key) => run(async () => {
    const other = key === "angleOffDeg" ? "attackHeadingDeg" : "angleOffDeg";
    const on = !pressed(mainLock(key));
    if (on) { await press(mainLock(other), false); await releaseSolved(); }
    await press(mainLock(key), on);
  });
  angleOffLock.addEventListener("click", (event) => { event.preventDefault(); exclusive("angleOffDeg"); });
  attackLock.addEventListener("click", (event) => { event.preventDefault(); exclusive("attackHeadingDeg"); });

  const confirmed = {
    1: () => pressed(mainLock("diveAngleDeg")),
    2: () => pressed(mainPopupLock("angle")),
    3: () => (isVip() || pressed(mainLock("vrpReference"))) && (pressed(mainLock("angleOffDeg")) !== pressed(mainLock("attackHeadingDeg"))),
  };
  const confirmStep = {
    1: () => press(mainLock("diveAngleDeg"), true),
    2: async () => {
      const deg = answer?.output?.aircraftResults?.[1]?.popup?.popupAngleDeg;
      await press(mainPopupLock("rollInSpeed"), false);
      if (Number.isFinite(deg)) await setField("popupAngleDeg", String(Math.round(deg)));
      await press(mainPopupLock("angle"), true);
    },
    3: async () => {
      await releaseSolved();
      if (pressed(mainLock("angleOffDeg")) && pressed(mainLock("attackHeadingDeg"))) await press(mainLock("attackHeadingDeg"), false);
      if (!pressed(mainLock("angleOffDeg")) && !pressed(mainLock("attackHeadingDeg"))) await press(mainLock("angleOffDeg"), true);
      if (!isVip()) await press(mainLock("vrpReference"), true);
    },
  };
  const releaseStep = {
    1: () => press(mainLock("diveAngleDeg"), false),
    2: () => press(mainPopupLock("angle"), false),
    3: async () => {
      if (!isVip()) await press(mainLock("vrpReference"), false);
      await press(mainLock("angleOffDeg"), false);
      await press(mainLock("attackHeadingDeg"), false);
    },
  };
  for (const n of [1, 2, 3]) {
    cards[n].confirm.addEventListener("click", () => run(confirmStep[n]));
    cards[n].release.addEventListener("click", () => run(releaseStep[n]));
  }

  // ---- render from the last answer ----
  const setOut = (key, text, level = null) => {
    const out = outs.get(key);
    if (!out) return;
    out.textContent = text;
    if (level) out.dataset.level = level; else delete out.dataset.level;
  };
  function syncLinks() {
    for (const input of linkInputs) {
      if (document.activeElement === input) continue;
      const main = mainField(input.dataset.key);
      if (!main) { input.closest(".field").hidden = true; continue; }
      input.value = main.value;
      input.placeholder = main.placeholder ?? "";
      input.readOnly = main.readOnly;
      input.toggleAttribute("data-lock-solved", main.hasAttribute("data-lock-solved"));
    }
  }
  function render() {
    const ar = answer?.output?.aircraftResults?.[1];
    const p = ar?.popup ?? null;
    const pub = ar?.result?.profile?.public ?? {};
    const resolved = ar?.result?.resolved ?? {};
    syncLinks();
    statusLine.textContent = !ar ? "#1의 계산 결과가 아직 없습니다." : `#1 ${ar.status}${[...(ar.errors ?? []), ...(ar.warnings ?? [])].length ? ` · ${[...(ar.errors ?? []), ...(ar.warnings ?? [])][0]}` : ""}`;
    statusLine.dataset.level = !ar ? "none" : ar.status === "VALID" ? "ok" : ar.status === "WARNING" ? "warn" : "bad";
    const apex = p?.events?.find((e) => e.name === "APEX");
    const pullDown = p?.events?.find((e) => e.name === "PULL_DOWN");
    const apexText = Number.isFinite(apex?.altitudeMslFt) ? `${ft(apex.altitudeMslFt)} ft · ${one(p.apexKcas, 0)} KCAS` : "-";
    const apexLevel = Number.isFinite(p?.apexKcas) ? (p.apexKcas < 300 ? "bad" : p.apexKcas > 350 ? "warn" : "ok") : null;
    const sec = p?.holdDownSec;
    const secText = Number.isFinite(sec) ? `${one(sec)} s${sec < 0 ? " · INVALID" : sec < APPROACH_POP_RECOMMENDED_SEC ? " · 경고 (2 s 권장)" : ""}` : "-";
    setOut("map", Number.isFinite(pub.groundRangeNm) ? `${one(pub.groundRangeNm, 2)}` : "-");
    setOut("map2", Number.isFinite(pub.groundRangeNm) ? `${one(pub.groundRangeNm, 2)}${confirmed[2]() ? " · 확정" : ""}` : "-");
    setOut("rollInAlt", ft(pub.resolvedInitialAltitudeMslFt));
    setOut("rollInAlt4", ft(pub.resolvedInitialAltitudeMslFt));
    setOut("releaseSpeed", Number.isFinite(p?.releaseSpeedKcas) ? one(p.releaseSpeedKcas, 0) : "-");
    setOut("popupAngle", Number.isFinite(p?.popupAngleDeg) ? `${one(p.popupAngleDeg)}°${confirmed[2]() ? " · LOCK" : ""}` : "-");
    setOut("minPop", Number.isFinite(p?.groundDistanceNm) ? one(p.groundDistanceNm, 2) : "-");
    setOut("appPopNm", Number.isFinite(p?.holdDownNm) ? one(p.holdDownNm, 2) : "-", approachPopLevel(sec));
    for (const key of ["appPopSec", "appPopSec3", "appPopSec4"]) setOut(key, secText, approachPopLevel(sec));
    setOut("apex", apexText, apexLevel);
    setOut("apex4", apexText, apexLevel);
    setOut("exposure", Number.isFinite(p?.exposureTimeSec) ? one(p.exposureTimeSec) : "-");
    setOut("pullDown", ft(pullDown?.altitudeMslFt));
    setOut("reference", !ar ? "-" : isVip() ? "VIP (VRP LOCK 없음)" : `VRP${pressed(mainLock("vrpReference")) ? " · LOCK" : ""}`);
    setOut("offsetAngle", Number.isFinite(resolved.offsetAngleDeg) ? one(resolved.offsetAngleDeg) : "-");
    setOut("approach", Number.isFinite(resolved.approachRangeNm) ? one(resolved.approachRangeNm, 2) : "-");
    for (const [button, key] of [[angleOffLock, "angleOffDeg"], [attackLock, "attackHeadingDeg"]]) {
      const on = pressed(mainLock(key));
      button.setAttribute("aria-pressed", String(on));
      button.classList.toggle("active", on);
      button.textContent = on ? "LOCKED" : "LOCK";
    }
    renderPopupStep(ar);
    renderRegionStep(ar);
    syncTune(ar);
    for (const n of [1, 2, 3]) {
      const on = confirmed[n]();
      cards[n].pill.textContent = on ? "확정" : "미확정";
      cards[n].pill.dataset.on = String(on);
      cards[n].confirm.disabled = busy || on || !ar;
      cards[n].release.disabled = busy || !on;
    }
    const vrpField = root.querySelector('[data-design-link][data-key="vrpRangeNm"]')?.closest(".field");
    if (vrpField) vrpField.hidden = isVip();
  }
  // ---- step 2: the Popup Angle sweep (S2) ----
  let sweep = null; // { signature, points, done, total, ms }
  let sweepJob = 0;
  let sweepTimer = null;
  let active = false;
  let lastAutoDeg = null;
  const round = (k, v) => (typeof v === "number" ? +v.toFixed(3) : v);
  const signatureOf = (base) => {
    const b = structuredClone(base);
    for (const key of ["popupAngleDeg", "popupGroundDistanceNm", "popupExposureTimeSec", "initialSpeedValue", "initialSpeedMode"]) delete b.values[key];
    delete b.state.popupDriver;
    return JSON.stringify(b, round);
  };
  function scheduleSweep() {
    if (!active || !pool) return;
    let base;
    try { base = sweepBaseline(answer, 1); } catch { return; }
    const signature = signatureOf(base);
    if (sweep?.signature === signature) return;
    clearTimeout(sweepTimer);
    sweepTimer = setTimeout(() => runSweep(base, signature), 500);
  }
  async function runSweep(base, signature) {
    const id = ++sweepJob;
    pool.clear();
    const started = performance.now();
    const points = POPUP_ANGLE_GRID.map((x) => ({ x }));
    sweep = { signature, points, done: 0, total: points.length, ms: 0 };
    renderPopupStep(answer?.output?.aircraftResults?.[1]);
    // Coarse first (every 5°), then the rest.
    const order = [...points.keys()].sort((i, j) => ((points[i].x % 5 === 0 ? 0 : 1) - (points[j].x % 5 === 0 ? 0 : 1)) || i - j);
    let queued = false;
    await Promise.all(order.map((i) => pool.point(base, { popupAngleDeg: points[i].x }).then((point) => {
      if (id !== sweepJob || !point) return;
      Object.assign(points[i], point);
      sweep.done += 1;
      if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; if (id === sweepJob) renderPopupStep(answer?.output?.aircraftResults?.[1]); }); }
    })));
    if (id !== sweepJob) return;
    sweep.ms = performance.now() - started;
    renderPopupStep(answer?.output?.aircraftResults?.[1]);
  }
  function renderPopupStep(ar) {
    const p = ar?.popup ?? null;
    if (p?.driver === "DEFAULT" && Number.isFinite(p.popupAngleDeg)) lastAutoDeg = p.popupAngleDeg;
    const dive = answer?.input?.aircraft?.[1]?.values?.diveAngleDeg;
    const autoDeg = p?.driver === "DEFAULT" ? p.popupAngleDeg : lastAutoDeg ?? (Number.isFinite(Number(dive)) ? Math.min(55, defaultPopupAngleDeg(Number(dive))) : null);
    const chartsHost = root.querySelector("[data-design-angle-charts]");
    const flown = sweep?.points.filter((pt) => pt.status) ?? [];
    const range = flown.length >= 2 ? popupAngleRange(flown, autoDeg) : null;
    if (sweep && flown.length >= 2) {
      const currentY = p ? { exposureTimeSec: p.exposureTimeSec, apexKcas: p.apexKcas, popToRollInNm: p.groundDistanceNm, offsetPopupRangeNm: p.holdDownNm, offsetPopupTimeSec: p.holdDownSec } : null;
      chartsHost.hidden = false;
      const svgs = renderAngleCharts(chartsHost, sweep.points.filter((pt) => pt.status), { apexArea: range?.apexArea, fromDeg: range?.fromDeg, toDeg: range?.toDeg, possibleFromDeg: range?.possibleFromDeg, autoDeg, currentDeg: p?.popupAngleDeg, currentY },
        { derivative: showDerivative, wrap: (svg) => zoomable(svg, 320, 170) });
      for (const svg of svgs) svg.__viewport?.refresh();
    } else chartsHost.hidden = true;
    sweepStatus.textContent = !pool ? "-" : !sweep ? "Popup Angle 그래프: 계산 대기" : sweep.done < sweep.total
      ? `Popup Angle 그래프 계산 중 ${sweep.done} / ${sweep.total}` : `Popup Angle ${POPUP_ANGLE_GRID[0]}–${POPUP_ANGLE_GRID.at(-1)}° · ${sweep.total}점 · ${(sweep.ms / 1000).toFixed(1)} s · 다른 값은 현재 그대로`;
    const done = sweep && sweep.done >= sweep.total;
    const upper = range?.highBy === "arc" ? "비행 한계" : "Apex 300";
    setOut("angleRange", range && Number.isFinite(range.fromDeg) ? `${one(range.fromDeg)}–${one(range.toDeg)}° (위: ${upper})${done ? "" : " (계산 중)"}`
      : range?.empty === "short" ? "없음 · Approach-Pop 2 s 부족" : range?.empty === "slow" ? "없음 · Apex 300 KCAS 미만" : "-", range?.empty ? "bad" : null);
    if (confirmed[2]() && Number.isFinite(p?.groundDistanceNm)) setOut("minPopRange", `${one(p.groundDistanceNm, 2)} · 확정`);
    else setOut("minPopRange", range?.ends ? `${one(range.ends.to.minPopupNm, 2)} – ${one(range.ends.from.minPopupNm, 2)}` : "-");
    renderProfile(profileSvg, ar ? popupProfileLine(ar) : null, {
      title: `Pop-up Profile (#1) · Popup ${one(p?.popupAngleDeg)}° · 빨간 선 = 이 각도의 Min Pop-up`,
      derivative: showDerivative,
      approach: p ? { nm: p.holdDownNm, sec: p.holdDownSec } : null,
    });
    profileSvg.__viewport?.refresh();
  }
  // ---- step 4: Fine tune (S4) ----
  let tuneEdited = false;
  const tuneNow = (ar) => {
    const t = tuneTarget.value;
    const p = ar?.popup;
    if (t === "holdDownSec") return Number.isFinite(p?.holdDownSec) ? String(Math.round(p.holdDownSec)) : "";
    if (t === "rollInAltitudeMslFt") return Number.isFinite(ar?.result?.profile?.public?.resolvedInitialAltitudeMslFt) ? String(Math.round(ar.result.profile.public.resolvedInitialAltitudeMslFt)) : "";
    const e = p?.events?.find((x) => x.name === "PULL_DOWN");
    return Number.isFinite(e?.altitudeMslFt) ? String(Math.round(e.altitudeMslFt)) : "";
  };
  function syncTune(ar) {
    tuneKnob.disabled = tuneTarget.value !== "holdDownSec";
    if (tuneKnob.disabled) tuneKnob.value = "apex";
    if (!tuneEdited && document.activeElement !== tuneValue) tuneValue.value = tuneNow(ar);
    fineTune.disabled = busy || !tunePool || !ar;
  }
  tuneTarget.addEventListener("change", () => { tuneEdited = false; syncTune(answer?.output?.aircraftResults?.[1]); });
  tuneValue.addEventListener("input", () => { tuneEdited = true; });
  const KNOB_TEXT = { rollInAltitudeMslFt: ["Roll-in Altitude", "ft", 0], trackingTimeSec: ["Tracking Time", "s", 1], angleOffDeg: ["Angle Off", "°", 0], attackHeadingDeg: ["Attack Heading", "°", 0] };
  const TARGET_TEXT = { holdDownSec: ["Approach-Pop Time", "s", 1], rollInAltitudeMslFt: ["Roll-in Alt", "ft", 0], pullDownAltitudeMslFt: ["Pull Down Alt", "ft", 0] };
  fineTune.addEventListener("click", () => run(async () => {
    const request = { target: tuneTarget.value, value: Number(tuneValue.value), knob: tuneKnob.value };
    if (!Number.isFinite(request.value)) { tuneStatus.textContent = "목표값을 숫자로 넣어 주세요."; return; }
    if (request.knob === "offset" && !(pressed(mainLock("vrpReference")) && (pressed(mainLock("angleOffDeg")) || pressed(mainLock("attackHeadingDeg"))))) {
      tuneStatus.textContent = "Offset Angle로 맞추려면 3단계를 먼저 확정하세요 (VRP LOCK + Angle Off 또는 Attack Heading LOCK).";
      return;
    }
    let base;
    try { base = fineTuneBaseline(answer); } catch { tuneStatus.textContent = "#1의 계산 결과가 있어야 합니다."; return; }
    const started = performance.now();
    tuneStatus.textContent = "Fine tune 계산 중…";
    const r = await tunePool.point(base, request, "fineTune");
    if (!r || r.status === "FAILED" || !Number.isFinite(r.value)) { tuneStatus.textContent = `Fine tune 실패: ${r?.message ?? "답이 없습니다"}`; return; }
    const [kLabel, kUnit, kDigits] = KNOB_TEXT[r.key] ?? [r.key, "", 1];
    const [tLabel, tUnit, tDigits] = TARGET_TEXT[r.target];
    const text = r.key === "trackingTimeSec" ? r.value.toFixed(1) : String(Math.round(r.value));
    await setField(r.key, text);
    tuneEdited = false;
    const ar = answer?.output?.aircraftResults?.[1];
    const flown = Number(tuneNow(ar));
    const exact = r.target === "holdDownSec" ? ar?.popup?.holdDownSec : flown;
    tuneStatus.textContent = `${kLabel} ${Number(text).toFixed(kDigits)}${kUnit === "°" ? "°" : ` ${kUnit}`} 입력 → ${tLabel} ${Number.isFinite(exact) ? exact.toFixed(tDigits) : "-"} ${tUnit} (목표 ${r.want}) · 계산 ${r.runs}회, ${((performance.now() - started) / 1000).toFixed(1)} s${r.status === "CLOSEST" ? ` · ${r.message}` : ""}`;
  }));

  // ---- step 3: the possible region (S3) ----
  let region = null; // { signature, points, done, total, ms }
  let regionJob = 0;
  let regionTimer = null;
  const regionSignatureOf = (base) => {
    const b = structuredClone(base);
    for (const key of ["angleOffDeg", "attackHeadingDeg", "offsetAngleDeg", "actionRangeNm", "approachRangeNm", "popupGroundDistanceNm", "popupExposureTimeSec", "initialSpeedValue", "initialSpeedMode"]) delete b.values[key];
    delete b.locks; delete b.state.driver; delete b.state.popupDriver;
    return JSON.stringify(b, round);
  };
  function scheduleRegion() {
    if (!active || !regionPool || isVip()) return;
    let base, mirror;
    try { base = regionBaseline(answer); mirror = regionMirrorBaseline(base, answer); } catch { return; }
    const signature = regionSignatureOf(base);
    if (region?.signature === signature) return;
    clearTimeout(regionTimer);
    regionTimer = setTimeout(() => runRegion([base, mirror], signature), 700);
  }
  async function runRegion(bases, signature) {
    const id = ++regionJob;
    regionPool.clear();
    const started = performance.now();
    const points = [];
    region = { signature, points, done: 0, total: ANGLE_OFF_GRID.length * bases.length, ms: 0 };
    renderRegionStep(answer?.output?.aircraftResults?.[1]);
    let queued = false;
    // Coarse points of both sides first, so both arcs show early.
    const jobs = coarseFirst(ANGLE_OFF_GRID).flatMap((ao) => bases.map((base) => [base, ao]));
    await Promise.all(jobs.map(([base, ao]) => regionPool.point(base, { angleOffDeg: ao }, "region").then((point) => {
      if (id !== regionJob || !point) return;
      points.push(point);
      region.done += 1;
      if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; if (id === regionJob) renderRegionStep(answer?.output?.aircraftResults?.[1]); }); }
    })));
    if (id !== regionJob) return;
    region.ms = performance.now() - started;
    renderRegionStep(answer?.output?.aircraftResults?.[1]);
  }
  const span = (r, key, f) => (r && Number.isFinite(r[`${key}FromDeg`]) ? `${f(r[`${key}FromDeg`])}–${f(r[`${key}ToDeg`])}` : null);
  const hdg3 = (v) => String(Math.round(((v % 360) + 360) % 360)).padStart(3, "0");
  const deg0 = (v) => `${Math.round(v)}°`;
  const SIDE_NAME = { RIGHT: "R", LEFT: "L" };
  function renderRegionStep(ar) {
    const g = ar?.result?.geometry;
    const p = ar?.popup;
    const summaries = region ? { RIGHT: regionSummary(region.points, "RIGHT"), LEFT: regionSummary(region.points, "LEFT") } : {};
    const side = g?.direction?.rollDirection ?? null;
    const summary = side ? summaries[side] : null;
    if (isVip()) {
      regionStatus.textContent = "VIP 모드: 가능 영역은 VRP 모드에서 그립니다 (VIP도 Angle Off에 따라 Approach Range가 바뀝니다).";
    } else {
      regionStatus.textContent = !regionPool ? "-" : !region ? "Top View 가능 영역: 계산 대기" : region.done < region.total
        ? `Top View 가능 영역 계산 중 ${region.done} / ${region.total} (VRP 고정, 양쪽 Roll-in, Angle Off ${ANGLE_OFF_GRID[0]}–${ANGLE_OFF_GRID.at(-1)}°)`
        : `VRP 고정 · Popup Angle ${one(p?.popupAngleDeg)}° · 그림은 현재 Roll-in 쪽 · Angle Off ${ANGLE_OFF_GRID[0]}–${ANGLE_OFF_GRID.at(-1)}° 5° 간격 · ${(region.ms / 1000).toFixed(1)} s · 점에 마우스를 올리면 값`;
    }
    renderRegionTopView(topSvg, { points: region?.points ?? [], summaries, current: g ? { geometry: g, popPoint: p?.popPoint, approachRangeNm: ar.result.resolved?.approachRangeNm, attackHeadingDeg: g.attackHeadingDeg } : null, upHeadingDeg: topIpBottom ? Number(ar?.result?.resolved?.runInHeadingDeg ?? g?.runInHeadingDeg ?? 0) : 0 });
    topSvg.__viewport?.refresh();
    const done = region && region.done >= region.total;
    const bothSides = (key, f) => {
      const parts = ["RIGHT", "LEFT"].map((sd) => {
        const a = span(summaries[sd]?.possible, key, f);
        const b = span(summaries[sd]?.recommended, key, f);
        return a ? `${SIDE_NAME[sd]}${sd === side ? "(현재)" : ""} ${a}${b && b !== a ? ` (2 s↑ ${b})` : ""}` : null;
      }).filter(Boolean);
      return parts.length ? parts.join(" · ") : done ? "없음" : "-";
    };
    setOut("regionAo", bothSides("angleOff", deg0));
    setOut("regionAtk", bothSides("attackHeading", hdg3));
    // A value outside the region still calculates; the range is said beside it (DESIGN-STEPS.md §3.5).
    const aoIn = insideSpan(summary?.possible, "angleOff", g?.angleOffDeg);
    const atkIn = insideSpan(summary?.possible, "attackHeading", g?.attackHeadingDeg);
    const other = side === "RIGHT" ? "LEFT" : "RIGHT";
    const otherText = summaries[other]?.possible ? ` 반대쪽(${SIDE_NAME[other]}) Roll-in은 Attack Heading ${span(summaries[other].possible, "attackHeading", hdg3)}을 Attack Heading LOCK으로 넣으면 됩니다.` : "";
    regionNote.textContent = !done || !g ? "" : !summary?.possible ? `이 VRP와 Popup Angle로는 현재 쪽(${SIDE_NAME[side] ?? "-"}) Approach-Pop ≥ 0 s인 Angle Off가 없습니다. VRP Range를 늘리거나 2단계 Popup Angle을 바꿔 보세요.${otherText}`
      : aoIn === false || atkIn === false ? `현재 Angle Off ${deg0(g.angleOffDeg)} / Attack Heading ${hdg3(g.attackHeadingDeg)}은 가능 영역(5° 간격으로 계산) 밖입니다. 현재 쪽(${SIDE_NAME[side]}) 가능 범위: Angle Off ${span(summary.possible, "angleOff", deg0)}, Attack Heading ${span(summary.possible, "attackHeading", hdg3)}.${otherText}`
      : "";
    regionNote.dataset.level = regionNote.textContent ? "warn" : "none";
    // Step 2 again (DESIGN-STEPS.md §3.6): the step-2 sweep runs again on the new Offset; its range and values here.
    const flown = sweep?.points.filter((pt) => pt.status) ?? [];
    const dive = Number(answer?.input?.aircraft?.[1]?.values?.diveAngleDeg);
    const autoDeg = lastAutoDeg ?? (Number.isFinite(dive) ? Math.min(55, defaultPopupAngleDeg(dive)) : null);
    const r2 = flown.length >= 2 ? popupAngleRange(flown, autoDeg) : null;
    const a = p?.popupAngleDeg;
    const inside = r2 && Number.isFinite(a) && Number.isFinite(r2.fromDeg) ? a >= r2.fromDeg - 0.05 && a <= r2.toDeg + 0.05 : null;
    setOut("recheckAngle", Number.isFinite(a) ? `${one(a)}° · 범위 ${r2 && Number.isFinite(r2.fromDeg) ? `${one(r2.fromDeg)}–${one(r2.toDeg)}°` : "-"}${inside === null ? "" : inside ? " · 안" : " · 밖"}` : "-", inside === null ? null : inside ? "ok" : "warn");
    setOut("recheckApex", Number.isFinite(p?.apexKcas) ? `${one(p.apexKcas, 0)} KCAS` : "-", Number.isFinite(p?.apexKcas) ? (p.apexKcas < 300 ? "bad" : p.apexKcas > 350 ? "warn" : "ok") : null);
    setOut("recheckAppPop", Number.isFinite(p?.holdDownSec) ? `${one(p.holdDownNm, 2)} NM · ${one(p.holdDownSec)} s` : "-", approachPopLevel(p?.holdDownSec));
  }
  offsetUi.onFlightAnswer?.((next) => {
    answer = next;
    const done = waiting;
    waiting = [];
    render();
    scheduleSweep();
    scheduleRegion();
    done.forEach((resolve) => resolve());
  });
  return {
    root,
    activate() { active = true; answer = offsetUi.flightAnswer?.() ?? answer; render(); scheduleSweep(); scheduleRegion(); },
    deactivate() { active = false; },
    // Read-only hook for the browser checks.
    state: () => ({ busy, confirmed: { 1: confirmed[1](), 2: confirmed[2](), 3: confirmed[3]() }, sweep: sweep && { done: sweep.done, total: sweep.total, ms: sweep.ms }, region: region && { done: region.done, total: region.total, ms: region.ms, summary: regionSummary(region.points), right: regionSummary(region.points, "RIGHT"), left: regionSummary(region.points, "LEFT") } }),
  };
}
