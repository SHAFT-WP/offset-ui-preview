// Offset Design tab: the planning steps (owner 2026-11-23, "핍업 부분 뺀 나머지를 옮겨줘": the POP-UP planning steps of
// popup-design-steps-ui-v0.1 0.1.11 without the pop-up parts — no Popup Angle step, no Apex, no Approach-Pop).
// 1 BDP, 2 Offset conditions (the possible region on the Top View), 3 fine tuning. #1 only.
// Nothing new is computed here: every number is a readout of the page's last Offset Flight answer, or of the BE's
// region (offset-design-region-v0.1) and Fine tune (offset-fine-tune-v0.1).
//   Input links: each step's inputs are more copies of the page's own fields (the same data-key), so typing here is
//     typing there and every copy shows the one value.
//   확정 / 해제: each step turns its bundle of the page's existing LOCKs on or off by pressing the page's own LOCK
//     buttons: 1 Dive Angle; 2 VRP and one of Angle Off / Attack Heading (exclusive), with the Offset Angle / Action /
//     Approach Range LOCKs released so the BE solves them.
import { mirrorFieldControls, syncFieldControls } from "./shared/design-field-mirror-v0.1.mjs?v=0.1.0";
import { ANGLE_OFF_GRID, coarseFirst, regionBaseline, regionSummary } from "./AG/bombing/offset-bombing/offset-design-region-v0.1.mjs?v=0.2.1";
import { fineTuneBaseline } from "./AG/bombing/offset-bombing/offset-fine-tune-v0.1.mjs?v=0.1.0";
import { followerTimeBaseline, releaseFromPredecessorImpactSec } from "./AG/bombing/offset-bombing/offset-follower-time-v0.1.mjs?v=0.1.3";
import { attackPairing, pumpingPath } from "./AG/bombing/offset-bombing/offset-follower-pumping-v0.1.mjs?v=0.1.0";
import { OFFSET_DESIGN_VRP_MAP_V0_1, renderVrpMap } from "./offset-design-vrp-map-v0.1.mjs?v=0.1.0";
import { POPUP_DESIGN_TOPVIEW_V0_1, renderRegionTopView } from "./popup-design-topview-v0.1.mjs?v=0.1.9";
import { installSvgViewport } from "./common/diagram/svg-viewport-v0.1.mjs?v=0.1.5";

// 0.1.1 (owner 2026-11-23, "2번기 셋팅은 좀 다르다", S1): a #2 step after the three — the Formation, the attack side
// (and whether a cross-over is needed; the cross-over path itself is S2), the release time relative to #1's impact as
// a target (− = before the impact) with #1's Bomb TOF beside it, #2's Offset fields with their LOCKs (copies of the #2
// slot's fields), and "시간 맞추기" (offset-follower-time-v0.1: #2's Angle Off or its Roll-in position).
export const OFFSET_DESIGN_STEPS_UI_V0_1 = Object.freeze({ id: "offset-design-steps-ui-v0.1", version: "0.1.7" });

// The Top View's texts on the Offset page: the level is the Flight's status (there is no Approach-Pop).
const REGION_LABELS = Object.freeze({
  ok: "VALID", warn: "WARNING", okDot: "VALID 점", warnDot: "WARNING 점",
  footer: "R/L = Roll-in 방향 · INVALID / Approach < 0은 그리지 않음",
  pointTail: (p) => `${p.rollInFree && Number.isFinite(p.rollInAltitudeMslFt) ? ` · Roll-in ${Math.round(p.rollInAltitudeMslFt).toLocaleString("en-US")} ft` : ""}${Number.isFinite(p.approachSec) ? ` · Approach ${p.approachSec.toFixed(1)} s` : ""}`,
});

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

// A picture with the common zoom (− / % / + / Fit; drag pans when zoomed), as on the POP-UP Design tab.
function zoomable(svg, width, height, { maxZoom = 4, lead = [] } = {}) {
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

// The fields linked into the Design tab: label, unit note.
const LINKS = Object.freeze({
  diveAngleDeg: ["Dive Angle (deg)", "BDP"],
  releaseAltitudeMslFt: ["Release Altitude (ft MSL)", "BDP"],
  releaseSpeedKcas: ["Release Speed (kcas)", "BDP"],
  trackingTimeSec: ["Tracking Time (sec)", "Track Point → Release"],
  rollInAltitudeMslFt: ["Roll-in Altitude (ft MSL)", "BDP entry"],
  vrpRangeNm: ["VRP Range (NM)", "Target → VRP"],
  angleOffDeg: ["Angle Off (deg)", "Run-In → Attack Heading"],
  attackHeadingDeg: ["Attack Heading (deg)", "Final attack axis"],
  offsetAngleDeg: ["Offset Angle (deg)", "Run-In → Approaching Heading"],
  actionRangeNm: ["Action Range (NM)", "Target → Action Point"],
  rollInG: ["Roll-in G (G)", "Roll-in"],
  offsetG: ["Offset G (G)", "Offset Turn"],
  gOnsetRateGSec: ["G Onset Rate (G/s)", "Roll-in · Offset"],
  offsetSpeedValue: ["Offset Speed", "Offset Turn"],
  initialSpeedValue: ["Initial Speed", "Roll-in start speed"],
  initialAltitudeMslFt: ["Initial Altitude (ft MSL)", "Roll-in start"],
});
// A linked field whose page field has a LOCK gets a Design LOCK that presses the page's and shows its state.
const LINK_LOCKS = Object.freeze({
  diveAngleDeg: "diveAngleDeg",
  rollInAltitudeMslFt: "rollInAltitudeMslFt",
  vrpRangeNm: "vrpReference",
  offsetG: "offsetG",
  offsetSpeedValue: "offsetSpeedValue",
  actionRangeNm: "actionRangeNm",
  offsetAngleDeg: "offsetAngleDeg",
});

// The page's own control (never a Design copy, never a follower's).
const mainOf = (selector, host) => [...document.querySelectorAll(selector)].find((node) => !host.contains(node) && !node.closest(".flight-slot")) ?? null;
const pressed = (button) => button?.getAttribute("aria-pressed") === "true";

export function mountOffsetDesignSteps({ host, offsetUi, regionPool = null, tunePool = null, mapPool = null }) {
  const root = el("section", { class: "design-wizard", "data-design-wizard": "" });
  const statusLine = el("p", { class: "design-graph-status", role: "status", text: "-" });
  const outs = new Map();
  const cards = {};
  const linkInputs = [];

  const lockButton = (name, label) => el("button", { class: "lock-button", type: "button", "data-design-lock": name, "aria-pressed": "false", "aria-label": `Lock ${label}`, text: "LOCK" });
  const linkLocks = []; // [button, page LOCK key]
  const link = (key, extra = {}) => {
    const [label, unit] = LINKS[key];
    if (!extra.lock && LINK_LOCKS[key]) {
      extra = { ...extra, lock: lockButton(key, label) };
      linkLocks.push([extra.lock, LINK_LOCKS[key]]);
    }
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
  const LAST = 4; // cards 1–3 have 확정 / 해제
  const card = (n, title, note, body) => {
    const pill = el("span", { class: "design-step-pill", text: "미확정" });
    const confirm = el("button", { class: "btn", type: "button", "data-design-confirm": String(n), text: "확정" });
    const release = el("button", { class: "capture-button", type: "button", "data-design-release": String(n), text: "해제" });
    const node = el("details", { class: "design-step", "data-design-step": String(n), open: "" },
      el("summary", { class: "design-step-head" }, el("b", { class: "step", text: String(n) }), el("span", { class: "design-step-title", text: title }), ...(n < LAST ? [pill] : [])),
      el("p", { class: "flight-draft-note", text: note }),
      ...body,
      ...(n < LAST ? [el("div", { class: "design-graph-actions" }, confirm, release)] : []));
    cards[n] = { node, pill, confirm, release };
    return node;
  };
  const grid = (...nodes) => el("div", { class: "input-grid design-step-grid" }, ...nodes);

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
  // Step 2 (owner 2026-11-24): the Offset Angle wanted and whether the Roll-in Altitude may change.
  const targetOa = el("input", { type: "text", inputmode: "decimal", "aria-label": "Offset Angle (deg)", "data-design-target-oa": "" });
  const altFree = el("input", { type: "checkbox", "data-design-alt-free": "", "aria-label": "Roll-in 고도 변경 허용" });
  const altFreeField = el("label", { class: "field design-check" }, el("span", { text: "Roll-in 고도 변경" }), el("span", { class: "design-check-row" }, altFree, el("span", { text: "허용 (Angle Off마다 Roll-in Altitude를 찾음)" })), el("span", { class: "unit", text: "끄면 지금 Roll-in Altitude 그대로" }));
  let targetEdited = false;
  // Step 3, the VRP × Angle Off map (owner 2026-11-24): the Offset Angle of every VRP / Angle Off pair, altitude held.
  const mapSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  mapSvg.setAttribute("class", "design-steps-svg design-vrp-map-svg");
  mapSvg.setAttribute("data-design-vrp-map", "");
  mapSvg.setAttribute("role", "img");
  mapSvg.setAttribute("aria-label", "VRP Range by Angle Off map of the Offset Angle");
  const mapStatus = el("p", { class: "design-graph-status", role: "status", "data-design-map-status": "", text: "VRP × Angle Off 지도: Design 탭을 열면 계산합니다." });
  // Step 3: the Angle Off to fly (applied with 확정).
  const pickAo = el("input", { type: "text", inputmode: "decimal", "aria-label": "Angle Off (deg)", "data-design-pick-ao": "" });
  const angleOffLock = lockButton("angleOffDeg", "Angle Off");
  const attackLock = lockButton("attackHeadingDeg", "Attack Heading");
  const fineTune = el("button", { class: "btn", type: "button", "data-design-fine-tune": "", text: "Fine tune" });
  const tuneTarget = el("select", { "aria-label": "Fine tune target", "data-design-tune-target": "" },
    el("option", { value: "approachSec", text: "Approach Time (s)" }),
    el("option", { value: "approachRangeNm", text: "Approach Range (NM)" }),
    el("option", { value: "rollInAltitudeMslFt", text: "Roll-in Alt (ft)" }));
  const tuneValue = el("input", { type: "text", inputmode: "decimal", "aria-label": "Fine tune value", "data-design-tune-value": "" });
  const tuneKnob = el("select", { "aria-label": "Fine tune knob", "data-design-tune-knob": "" },
    el("option", { value: "bdp", text: "BDP 쪽 (기본)" }),
    el("option", { value: "offset", text: "Offset Angle" }));
  const tuneStatus = el("p", { class: "design-graph-status", role: "status", "data-design-tune-status": "", text: "목표 하나를 골라 값을 고친 뒤 Fine tune을 누르세요." });
  const tuneField = (label, node, unit) => el("label", { class: "field" }, el("span", { text: label }), node, el("span", { class: "unit", text: unit }));

  // ---- #2 step: copies of the #2 slot's fields (data-flight-field) and LOCK / Angle #1 / Time #1 buttons ----
  const FOLLOWER = 2;
  const slotOf = () => document.querySelector(`.flight-slot[data-aircraft="${FOLLOWER}"]`);
  const followerMain = (key) => slotOf()?.querySelector(`[data-flight-field="${key}"]`) ?? null;
  const followerInputs = [];
  const followerButtons = [];
  const followerLink = (key, label, unit, lockKeys = []) => {
    const input = el("input", { "data-design-follower": key, type: "text", inputmode: "decimal", "aria-label": `#2 ${label}` });
    followerInputs.push(input);
    // Typing here types into the #2 slot's own field (its input / change events reach the page's follower handler).
    const forward = (type) => {
      const main = followerMain(key);
      if (!main) return;
      main.value = input.value;
      main.dispatchEvent(new Event(type, { bubbles: true }));
    };
    input.addEventListener("input", () => forward("input"));
    input.addEventListener("change", () => forward("change"));
    const buttons = lockKeys.map((lk) => {
      const b = el("button", { class: "lock-button", type: "button", "data-design-follower-lock": lk, "aria-pressed": "false", text: "LOCK" });
      b.addEventListener("click", (event) => { event.preventDefault(); run(async () => { const main = followerMain(lk); if (main) { const answered = nextAnswer(); main.click(); await settled(answered); } }); });
      followerButtons.push(b);
      return b;
    });
    const title = buttons.length ? el("span", { class: "lock-title" }, el("span", { text: label }), el("span", { class: "lock-group" }, ...buttons)) : el("span", { text: label });
    return el("label", { class: "field" }, title, input, el("span", { class: "unit", text: unit }));
  };
  const timeTarget = el("input", { type: "text", inputmode: "decimal", "aria-label": "#1 Impact 기준 #2 Release (s)", "data-design-time-target": "" });
  const timeKnob = el("select", { "aria-label": "시간 맞추는 쪽", "data-design-time-knob": "" },
    el("option", { value: "auto", text: "자동 (아래 순서대로)" }),
    el("option", { value: "angleOff", text: "#2 Angle Off" }),
    el("option", { value: "offsetAngle", text: "Roll-in 위치: #2 Offset Angle" }),
    el("option", { value: "actionRange", text: "Roll-in 위치: #2 Action Range" }),
    el("option", { value: "leadAngleOff", text: "해가 없을 때: #1 Angle Off" }),
    el("option", { value: "leadDive", text: "해가 없을 때: #1 Dive Angle" }),
    el("option", { value: "rollInAltitude", text: "그래도 없을 때: #2 Roll-in Altitude (피치)" }));
  const timeButton = el("button", { class: "btn", type: "button", "data-design-time-solve": "", text: "시간 맞추기" });
  const timeStatus = el("p", { class: "design-graph-status", role: "status", "data-design-time-status": "", text: "목표 시간을 넣고 시간 맞추기를 누르세요. − = #1 Impact 전." });
  const pumpG = el("input", { type: "text", inputmode: "decimal", "aria-label": "Pumping G", "data-design-pump-g": "", value: "4" });
  const pumpButton = el("button", { class: "btn", type: "button", "data-design-pump-apply": "", text: "Pumping 적용" });
  const pumpStatus = el("p", { class: "design-graph-status", role: "status", "data-design-pump-status": "", text: "" });
  const followerCard = card(5, "#2 설정", "2번기는 포메이션부터 봅니다. 공격방향(L/R)은 #1과 같으면 Echelon, 반대면 Bracket. 공격방향이 포메이션 쪽과 다르면 pumping: 공격 쪽으로 90° 선회, Run-In을 가로질러 리더 꼬리 뒤를 지날 때 반대로 90° 선회 (기본 4G, #2 Offset 속도). Pumping 적용은 끝난 위치를 #2 Formation에 넣습니다. 시간차 = #1 폭탄 Impact 기준 #2 Release 시간 (− = Impact 전 몇 초). 시간 맞추기는 #2의 Angle Off, 또는 Offset 조건(Offset Angle / Action Range, Angle Off는 그대로)으로 Roll-in 위치를 옮겨 맞춥니다.", [
    grid(readout("formation2", "Formation #2", "#1 기준 · L/R · 각도 · 거리"), readout("attackSide2", "공격방향 #2", "Roll-in 방향"), readout("crossover2", "Pumping", "포메이션 쪽 ≠ 공격방향")),
    grid(tuneField("Pumping G (G)", pumpG, "기본 4G · 수평 선회"), readout("pumpPath", "Pumping 경로", "선회반경 · 직선 · 시간"), readout("pumpEnd", "Pumping 후 #2", "공격 쪽 · 각도 · 거리")),
    el("div", { class: "design-graph-actions" }, pumpButton),
    pumpStatus,
    grid(readout("release2", "#1 Impact → #2 Release (s)", "현재 · − = Impact 전"), readout("tof1", "#1 Bomb TOF (s)", "참고")),
    grid(followerLink("offsetAngleDeg", "Offset Angle (deg)", "#2", ["offsetAngleLocked", "sameAngleAsLead"]),
      followerLink("angleOffDeg", "Angle-Off (deg)", "#2", ["angleOffLocked"]),
      followerLink("attackHeadingDeg", "Attack Heading (deg)", "#2", ["attackHeadingLocked"]),
      followerLink("actionRangeNm", "Action Range (NM)", "#2", ["actionRangeLocked", "sameTimeAsLead"]),
      followerLink("approachRangeNm", "Approach Range (NM)", "#2 · Roll-in 위치", ["approachRangeLocked"])),
    grid(tuneField("목표: #1 Impact 기준 Release (s)", timeTarget, "− = Impact 전"), tuneField("맞추는 쪽", timeKnob, "자동: #2 → #1 Angle Off·Dive → #2 고도")),
    el("div", { class: "design-graph-actions" }, timeButton),
    timeStatus,
  ]);

  root.append(
    el("h3", { class: "design-steps-title", text: "단계별 플래닝 (#1)" }),
    statusLine,
    card(1, "BDP", "Dive, Release, Tracking (또는 Roll-in Altitude)를 정합니다. 확정 = Dive Angle LOCK.", [
      grid(link("diveAngleDeg"), link("releaseAltitudeMslFt"), link("releaseSpeedKcas"), link("trackingTimeSec"), link("rollInAltitudeMslFt"),
        readout("map", "MAP (NM)", "result"), readout("rollInAlt", "Roll-in Altitude (ft MSL)", "result"), readout("tracking", "Tracking Time (sec)", "result"), readout("minAlt", "MINALT (ft MSL)", "BDP recovery bottom")),
    ]),
    card(2, "Offset 조건", "VRP와 Offset Angle을 정하고, Roll-in 고도를 바꿔도 되는지 고릅니다. VRP·Offset Angle·Angle Off를 모두 고정하면 BDP(Roll-in 고도)만 남으므로, 고도를 고정하면 맞는 Angle Off가 한두 개뿐이고, 고도 변경을 허용하면 Angle Off마다 맞는 Roll-in 고도를 찾습니다. 확정 = VRP LOCK.", [
      grid(readout("reference", "Reference", "VRP / VIP"), link("vrpRangeNm"),
        tuneField("Offset Angle (deg)", targetOa, "Run-In → Approaching Heading · 목표"), altFreeField),
    ]),
    card(3, "Angle Off 가용 범위", "위 지도: Roll-in 고도를 고정하면 VRP와 Angle Off가 Offset Angle을 정합니다. VRP Range(세로)와 Angle Off(가로)마다 나오는 Offset Angle을 색으로, 목표 Offset Angle이 되는 곳을 빨간 점으로 그립니다. 칸을 누르면 그 VRP와 Angle Off가 페이지에 들어갑니다. 아래 Top View: 2단계의 VRP와 Offset Angle로 Angle Off 5–175°를 5° 간격으로 계산해 Top View에 그립니다 (현재 Roll-in 쪽). 확정 = 고른 Angle Off LOCK (Offset Angle은 BE가 풀어 목표와 같아짐), 고도 변경 허용이면 그 Angle Off의 Roll-in Altitude도 입력.", [
      mapStatus,
      el("div", { class: "design-steps-shell" }, zoomable(mapSvg, OFFSET_DESIGN_VRP_MAP_V0_1.canvas.width, OFFSET_DESIGN_VRP_MAP_V0_1.canvas.height)),
      grid(readout("mapTarget", "목표 Offset Angle이 되는 VRP / Angle Off", "지도의 빨간 점 · VRP NM: Angle Off")),
      regionStatus,
      el("div", { class: "design-steps-shell" }, zoomable(topSvg, POPUP_DESIGN_TOPVIEW_V0_1.canvas.width, POPUP_DESIGN_TOPVIEW_V0_1.canvas.height, { lead: [ipBottomButton] })),
      grid(readout("regionAo", "가능 Angle Off", "VALID · WARNING (VALID만)"), readout("regionAtk", "가능 Attack Heading", "VALID · WARNING"), readout("regionAlt", "필요 Roll-in Altitude (ft)", "고도 변경 허용일 때")),
      regionNote,
      grid(el("label", { class: "field" }, el("span", { class: "lock-title" }, el("span", { text: "Angle Off (deg)" }), angleOffLock), pickAo, el("span", { class: "unit", text: "가능 범위 안에서 고르기 · LOCK = 페이지 Angle Off LOCK" })), readout("pickOa", "Offset Angle (deg)", "현재 계산값"),
        readout("approach", "Approach Range (NM)", "Turn End → Roll-in Start"), readout("approachSec", "Approach Time (sec)", "Turn End → Roll-in Start")),
    ]),
    card(4, "미세튜닝", "G와 속도·고도로 다듬습니다. Fine tune: Approach Time, Approach Range, Roll-in Alt 중 하나를 목표로 고치고 누르면, BE가 BDP 쪽(Roll-in Altitude 또는 Tracking Time) 또는 Offset Angle(3단계 LOCK)을 바꿔 맞춥니다. BDP 쪽을 바꾸면 MAP과 Roll-in Point도 같이 바뀝니다.", [
      grid(link("rollInG"), link("offsetG"), link("gOnsetRateGSec"), link("offsetSpeedValue"), link("initialSpeedValue"), link("initialAltitudeMslFt"),
        readout("approachSec3", "Approach Time (sec)", "result"), readout("approach3", "Approach Range (NM)", "result"), readout("rollInAlt3", "Roll-in Altitude (ft MSL)", "result")),
      grid(tuneField("Fine tune 목표", tuneTarget, "하나만 고릅니다"), tuneField("목표값", tuneValue, "계산값에서 고치기"), tuneField("맞추는 쪽", tuneKnob, "Offset Angle은 Approach만, 3단계 확정 후")),
      el("div", { class: "design-graph-actions" }, fineTune),
      tuneStatus,
    ]),
    followerCard,
  );
  host.prepend(root);

  // ---- the page's controls ----
  const mainLock = (key) => mainOf(`[data-lock-key="${key}"]`, root);
  const mainField = (key) => mainOf(`[data-key="${key}"]`, root);
  const isVip = () => answer?.input?.aircraft?.[1]?.state?.referenceMode === "VIP";
  let answer = null;
  let waiting = [];
  const nextAnswer = () => new Promise((resolve) => {
    const timer = setTimeout(() => { waiting = waiting.filter((w) => w !== done); resolve(); }, 6000);
    const done = () => { clearTimeout(timer); resolve(); };
    waiting.push(done);
  });
  // A press / field waits until every edit sent has its answer (the page's calculation scheduler is idle); a long
  // guard keeps the steps from waiting forever on a lost answer (as on the POP-UP Design tab, 0.1.11).
  const IDLE_GUARD_MS = 120000;
  const settled = (sent) => (typeof offsetUi.whenIdle !== "function" ? sent
    : Promise.race([offsetUi.whenIdle(), new Promise((resolve) => setTimeout(resolve, IDLE_GUARD_MS))]));
  const press = async (button, on) => {
    if (!button || pressed(button) === on) return;
    const answered = nextAnswer();
    button.click();
    await settled(answered);
  };
  const setField = async (key, text) => {
    const input = mainField(key);
    if (!input || input.value === text) return;
    const answered = nextAnswer();
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await settled(answered);
  };
  let busy = false;
  const run = async (job) => {
    if (busy) return;
    busy = true;
    root.classList.add("design-wizard-busy");
    try { await settled(Promise.resolve()); await job(); } finally { busy = false; root.classList.remove("design-wizard-busy"); render(); }
  };
  const releaseSolved = async () => {
    for (const key of ["offsetAngleDeg", "actionRangeNm", "approachRangeNm"]) await press(mainLock(key), false);
  };
  // Angle Off / Attack Heading: one LOCK at a time (VRP + both is a CONSTRAINT CONFLICT).
  const exclusive = (key) => run(async () => {
    const other = key === "angleOffDeg" ? "attackHeadingDeg" : "angleOffDeg";
    const on = !pressed(mainLock(key));
    if (on) { await press(mainLock(other), false); await releaseSolved(); }
    await press(mainLock(key), on);
  });
  angleOffLock.addEventListener("click", (event) => { event.preventDefault(); exclusive("angleOffDeg"); });
  attackLock.addEventListener("click", (event) => { event.preventDefault(); exclusive("attackHeadingDeg"); });
  for (const [button, name] of linkLocks) button.addEventListener("click", (event) => {
    event.preventDefault();
    run(async () => { const main = mainLock(name); await press(main, !pressed(main)); });
  });

  const confirmed = {
    1: () => pressed(mainLock("diveAngleDeg")),
    2: () => isVip() || pressed(mainLock("vrpReference")),
    3: () => (isVip() || pressed(mainLock("vrpReference"))) && pressed(mainLock("angleOffDeg")) && !pressed(mainLock("attackHeadingDeg")),
  };
  const confirmStep = {
    1: () => press(mainLock("diveAngleDeg"), true),
    2: async () => { if (!isVip()) await press(mainLock("vrpReference"), true); },
    3: () => applyAngleOff(),
  };
  const releaseStep = {
    1: () => press(mainLock("diveAngleDeg"), false),
    2: async () => { if (!isVip()) await press(mainLock("vrpReference"), false); },
    3: async () => {
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
  const mirrorPress = (fn) => run(async () => { const answered = nextAnswer(); fn(); await settled(answered); });
  function syncLinks() {
    for (const input of linkInputs) {
      if (document.activeElement === input) continue;
      const main = mainField(input.dataset.key);
      if (!main) { input.closest(".field").hidden = true; continue; }
      input.value = main.value;
      input.placeholder = main.placeholder ?? "";
      input.readOnly = main.readOnly;
      input.toggleAttribute("data-lock-solved", main.hasAttribute("data-lock-solved"));
      // Every other control of the page field (LINK, TIME / ANGLE, unit select) mirrored, same state both sides.
      mirrorFieldControls(input, main, { covered: (b) => linkLocks.some(([, name]) => mainLock(name) === b), press: mirrorPress });
      syncFieldControls(input, { busy });
    }
  }
  function render() {
    const ar = answer?.output?.aircraftResults?.[1];
    const pub = ar?.result?.profile?.public ?? {};
    const resolved = ar?.result?.resolved ?? {};
    const approachSec = ar?.result?.timing?.approachSec;
    syncLinks();
    const notes = [...(ar?.errors ?? []), ...(ar?.warnings ?? [])];
    statusLine.textContent = !ar ? "#1의 계산 결과가 아직 없습니다." : `#1 ${ar.status}${notes.length ? ` · ${notes[0]}` : ""}`;
    statusLine.dataset.level = !ar ? "none" : ar.status === "VALID" ? "ok" : ar.status === "WARNING" ? "warn" : "bad";
    setOut("map", Number.isFinite(pub.groundRangeNm) ? one(pub.groundRangeNm, 2) : "-");
    for (const key of ["rollInAlt", "rollInAlt3"]) setOut(key, ft(pub.resolvedInitialAltitudeMslFt));
    setOut("tracking", one(pub.trackingTimeSec));
    setOut("minAlt", ft(pub.minAltMslFt));
    setOut("reference", !ar ? "-" : isVip() ? "VIP (VRP LOCK 없음)" : `VRP${pressed(mainLock("vrpReference")) ? " · LOCK" : ""}`);
    const approachLevel = Number.isFinite(resolved.approachRangeNm) && resolved.approachRangeNm < 0 ? "bad" : null;
    for (const key of ["approach", "approach3"]) setOut(key, Number.isFinite(resolved.approachRangeNm) ? one(resolved.approachRangeNm, 2) : "-", approachLevel);
    for (const key of ["approachSec", "approachSec3"]) setOut(key, Number.isFinite(approachSec) ? one(approachSec) : "-", approachLevel);
    for (const [button, name] of linkLocks) {
      const main = mainLock(name);
      const on = pressed(main);
      button.hidden = !main;
      button.setAttribute("aria-pressed", String(on));
      button.classList.toggle("active", on);
      button.textContent = on ? "LOCKED" : "LOCK";
      button.disabled = busy;
    }
    for (const [button, key] of [[angleOffLock, "angleOffDeg"], [attackLock, "attackHeadingDeg"]]) {
      const on = pressed(mainLock(key));
      button.setAttribute("aria-pressed", String(on));
      button.classList.toggle("active", on);
      button.textContent = on ? "LOCKED" : "LOCK";
    }
    if (!targetEdited && document.activeElement !== targetOa) targetOa.value = Number.isFinite(ar?.result?.geometry?.offsetAngleDeg) ? Math.abs(ar.result.geometry.offsetAngleDeg).toFixed(1) : "";
    if (document.activeElement !== pickAo && !pickEdited) pickAo.value = Number.isFinite(ar?.result?.geometry?.angleOffDeg) ? ar.result.geometry.angleOffDeg.toFixed(1) : "";
    setOut("pickOa", Number.isFinite(ar?.result?.geometry?.offsetAngleDeg) ? one(Math.abs(ar.result.geometry.offsetAngleDeg)) : "-");
    renderRegionStep(ar);
    if (vrpMap) renderMapStep(ar);
    syncTune(ar);
    renderFollower();
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

  // ---- #2 step ----
  const AUTO_ORDER = ["angleOff", "offsetAngle", "actionRange", "leadAngleOff", "leadDive", "rollInAltitude"];
  const KNOB_LABEL = { angleOff: "#2 Angle Off", offsetAngle: "#2 Offset Angle", actionRange: "#2 Action Range", leadAngleOff: "#1 Angle Off", leadDive: "#1 Dive", rollInAltitude: "#2 Roll-in Altitude" };
  const SIDE_LR = { LEFT: "L", RIGHT: "R" };
  let timeEdited = false;
  function renderFollower() {
    const size = Number(answer?.input?.flightSize ?? 1);
    followerCard.hidden = size < FOLLOWER;
    if (size < FOLLOWER) return;
    const rec = answer?.input?.aircraft?.[FOLLOWER];
    const ar2 = answer?.output?.aircraftResults?.[FOLLOWER];
    const f = rec?.formation;
    setOut("formation2", f ? `${SIDE_LR[f.side] ?? f.side} ${one(Number(f.bearingDeg), 0)}° · ${one(Number(f.distanceNm), 1)} NM` : "-");
    const attack = ar2?.result?.geometry?.direction?.rollDirection ?? null;
    const pairing = attackPairing(answer?.output?.aircraftResults?.[1]?.result?.geometry?.direction?.rollDirection, attack);
    setOut("attackSide2", attack ? `${SIDE_LR[attack]} · ${pairing === "ECHELON" ? "Echelon" : pairing === "BRACKET" ? "Bracket" : "-"}` : "-");
    const cross = f && attack ? f.side !== attack : null;
    setOut("crossover2", cross === null ? "-" : cross ? `필요 (편대 ${SIDE_LR[f.side]} → 공격 ${SIDE_LR[attack]})` : "불필요", cross ? "warn" : cross === false ? "ok" : null);
    pump = cross ? pumpingPath({ formation: f, attackSide: attack, tasKt: ar2?.result?.resolved?.offsetTasKt, g: Number(pumpG.value) }) : null;
    setOut("pumpPath", pump?.needed && pump.radiusNm ? `R ${one(pump.radiusNm, 2)} NM · 직선 ${one(pump.legNm, 2)} NM · ${one(pump.timeSec)} s` : "-", pump?.message ? "warn" : null);
    setOut("pumpEnd", pump?.end ? `${SIDE_LR[pump.end.side]} ${one(pump.end.bearingDeg)}° · ${one(pump.end.distanceNm, 2)} NM` : "-");
    if (!pumpEdited) pumpStatus.textContent = pump?.message ?? (cross === false ? "포메이션 쪽 = 공격방향: pumping 없이 갑니다." : "");
    pumpButton.disabled = busy || !pump?.end;
    const t = releaseFromPredecessorImpactSec(answer?.output, FOLLOWER);
    setOut("release2", Number.isFinite(t) ? `${t >= 0 ? "+" : ""}${one(t)}${ar2 && ar2.status === "INVALID" ? " · #2 INVALID" : ""}` : "-", ar2?.status === "INVALID" ? "bad" : null);
    setOut("tof1", one(answer?.output?.flightTiming?.[FOLLOWER]?.predecessorBombTofSec ?? answer?.output?.aircraftResults?.[1]?.result?.profile?.public?.bombTofSec));
    for (const input of followerInputs) {
      if (document.activeElement === input) continue;
      const main = followerMain(input.dataset.designFollower);
      input.closest(".field").hidden = !main;
      if (main) { input.value = main.value; input.placeholder = main.placeholder ?? ""; }
    }
    for (const b of followerButtons) {
      const main = followerMain(b.dataset.designFollowerLock);
      b.hidden = !main;
      const on = pressed(main);
      b.setAttribute("aria-pressed", String(on));
      b.classList.toggle("active", on);
      b.textContent = main?.textContent?.trim() || "LOCK";
      b.disabled = busy;
    }
    if (!timeEdited && document.activeElement !== timeTarget) timeTarget.value = Number.isFinite(t) ? t.toFixed(1) : "";
    timeButton.disabled = busy || !tunePool || !ar2;
  }
  let pump = null;
  let pumpEdited = false;
  pumpG.addEventListener("input", () => { pumpEdited = false; renderFollower(); });
  // Pumping 적용: #2's formation becomes the end of the pumping (side, bearing, distance typed into #2's own fields).
  pumpButton.addEventListener("click", () => run(async () => {
    const path = pump;
    if (!path?.end) return;
    for (const [key, value] of [["side", path.end.side], ["bearingDeg", path.end.bearingDeg.toFixed(1)], ["distanceNm", path.end.distanceNm.toFixed(2)]]) {
      const main = followerMain(key);
      if (!main) continue;
      const answered = nextAnswer();
      main.value = value;
      main.dispatchEvent(new Event("input", { bubbles: true }));
      main.dispatchEvent(new Event("change", { bubbles: true }));
      await settled(answered);
    }
    pumpEdited = true;
    pumpStatus.textContent = `Pumping ${path.g}G 적용: #2 Formation ${SIDE_LR[path.end.side]} ${path.end.bearingDeg.toFixed(1)}° · ${path.end.distanceNm.toFixed(2)} NM (pumping ${path.timeSec.toFixed(1)} s, IP 전에 끝난다고 봅니다)${path.message ? ` · ${path.message}` : ""}`;
  }));
  timeTarget.addEventListener("input", () => { timeEdited = true; });
  timeButton.addEventListener("click", () => run(async () => {
    const value = Number(timeTarget.value);
    if (!Number.isFinite(value)) { timeStatus.textContent = "목표 시간을 숫자로 넣어 주세요 (− = #1 Impact 전)."; return; }
    let base;
    try { base = followerTimeBaseline(answer, FOLLOWER); } catch { timeStatus.textContent = "#2의 계산 결과가 있어야 합니다."; return; }
    const knob = timeKnob.value;
    const started = performance.now();
    timeStatus.textContent = "시간 맞추는 중…";
    // 자동 (owner 2026-11-23): #2's Angle Off / Roll-in position first, then #1's Angle Off / Dive, then #2's altitude;
    // the first that fits is used, else the closest of all.
    const order = knob === "auto" ? AUTO_ORDER : [knob];
    let r = null;
    const missed = [];
    for (const k of order) {
      timeStatus.textContent = `시간 맞추는 중… (${KNOB_LABEL[k]})`;
      const res = await tunePool.point(base, { number: FOLLOWER, request: { value, knob: k } }, "followerTime");
      if (res && res.status !== "FAILED" && Number.isFinite(res.value) && (!r || Math.abs(res.achieved - value) < Math.abs(r.achieved - value))) r = res;
      if (res?.status === "OK") break;
      missed.push(KNOB_LABEL[k]);
    }
    if (!r || r.status === "FAILED" || !Number.isFinite(r.value)) { timeStatus.textContent = `실패: ${r?.message ?? "답이 없습니다"}`; return; }
    // Type the value into #2's own field, its LOCK on (Roll-in position: Angle Off LOCKed as it is, then the Approach).
    const setFollower = async (key, text) => {
      const main = followerMain(key);
      if (!main) return;
      const answered = nextAnswer();
      main.value = text;
      main.dispatchEvent(new Event("input", { bubbles: true }));
      main.dispatchEvent(new Event("change", { bubbles: true }));
      await settled(answered);
    };
    const lockOn = async (key) => { const main = followerMain(key); if (main && !pressed(main)) { const answered = nextAnswer(); main.click(); await settled(answered); } };
    const lockOff = async (key) => { const main = followerMain(key); if (main && pressed(main)) { const answered = nextAnswer(); main.click(); await settled(answered); } };
    if (r.knob === "leadAngleOff") {
      await press(mainLock("attackHeadingDeg"), false);
      await releaseSolved();
      await press(mainLock("angleOffDeg"), true);
      await setField("angleOffDeg", r.value.toFixed(1));
    } else if (r.knob === "leadDive") {
      await setField("diveAngleDeg", r.value.toFixed(1));
      await press(mainLock("diveAngleDeg"), true);
    } else if (r.knob === "rollInAltitude") {
      await setFollower("rollInAltitudeMslFt", String(Math.round(r.value)));
      await lockOn("rollInAltitudeLocked");
    } else {
    await lockOn("angleOffLocked");
    if (r.key === "angleOffDeg") {
      await setFollower("angleOffDeg", r.value.toFixed(1));
    } else if (r.key === "offsetAngleDeg") {
      // Roll-in position by the Offset Angle: Angle Off held, the Action Range solved.
      for (const k of ["sameAngleAsLead", "sameTimeAsLead", "actionRangeLocked", "approachRangeLocked"]) await lockOff(k);
      await setFollower("offsetAngleDeg", r.value.toFixed(1));
      await lockOn("offsetAngleLocked");
    } else {
      // Roll-in position by the Action Range: Angle Off held, the Offset Angle solved.
      for (const k of ["sameAngleAsLead", "sameTimeAsLead", "offsetAngleLocked", "approachRangeLocked"]) await lockOff(k);
      await setFollower("actionRangeNm", r.value.toFixed(2));
      await lockOn("actionRangeLocked");
    }
    }
    timeEdited = false;
    const flown = releaseFromPredecessorImpactSec(answer?.output, FOLLOWER);
    const label = {
      angleOff: `#2 Angle Off ${r.value.toFixed(1)}°`, offsetAngle: `#2 Offset Angle ${r.value.toFixed(1)}°`, actionRange: `#2 Action Range ${r.value.toFixed(2)} NM`,
      leadAngleOff: `#1 Angle Off ${r.value.toFixed(1)}°`, leadDive: `#1 Dive Angle ${r.value.toFixed(1)}°`,
      rollInAltitude: `#2 Roll-in Altitude ${Math.round(r.value).toLocaleString("en-US")} ft${r.pitch ? ` · 요구 피치 ${r.pitch.requiredPitchDeg >= 0 ? "+" : ""}${r.pitch.requiredPitchDeg.toFixed(1)}° (${r.pitch.deltaFt >= 0 ? "+" : ""}${Math.round(r.pitch.deltaFt).toLocaleString("en-US")} ft / ${r.pitch.groundNm.toFixed(1)} NM, ${Math.round(r.pitch.verticalFpm).toLocaleString("en-US")} fpm, Approach 시작 → Roll-in 3초 전, 등속)` : ""}`,
    }[r.knob] ?? `${r.key} ${r.value}`;
    timeStatus.textContent = `${label} 입력 → #1 Impact 기준 Release ${Number.isFinite(flown) ? `${flown >= 0 ? "+" : ""}${flown.toFixed(1)}` : "-"} s (목표 ${r.want}) · 계산 ${r.runs}회, ${((performance.now() - started) / 1000).toFixed(1)} s${r.status === "CLOSEST" ? ` · ${r.message}` : ""}${knob === "auto" && missed.length && r.status === "OK" ? ` · 앞 단계(${missed.join(", ")})로는 안 맞음` : ""}`;
  }));

  // ---- step 3: Fine tune ----
  let tuneEdited = false;
  const tuneNow = (ar) => {
    const t = tuneTarget.value;
    if (t === "approachSec") return Number.isFinite(ar?.result?.timing?.approachSec) ? ar.result.timing.approachSec.toFixed(1) : "";
    if (t === "approachRangeNm") return Number.isFinite(ar?.result?.resolved?.approachRangeNm) ? ar.result.resolved.approachRangeNm.toFixed(2) : "";
    const alt = ar?.result?.profile?.public?.resolvedInitialAltitudeMslFt;
    return Number.isFinite(alt) ? String(Math.round(alt)) : "";
  };
  function syncTune(ar) {
    tuneKnob.disabled = tuneTarget.value === "rollInAltitudeMslFt";
    if (tuneKnob.disabled) tuneKnob.value = "bdp";
    if (!tuneEdited && document.activeElement !== tuneValue) tuneValue.value = tuneNow(ar);
    fineTune.disabled = busy || !tunePool || !ar;
  }
  tuneTarget.addEventListener("change", () => { tuneEdited = false; syncTune(answer?.output?.aircraftResults?.[1]); });
  tuneValue.addEventListener("input", () => { tuneEdited = true; });
  const KNOB_TEXT = { rollInAltitudeMslFt: ["Roll-in Altitude", "ft", 0], trackingTimeSec: ["Tracking Time", "s", 1], angleOffDeg: ["Angle Off", "°", 0], attackHeadingDeg: ["Attack Heading", "°", 0] };
  const TARGET_TEXT = { approachSec: ["Approach Time", "s", 1], approachRangeNm: ["Approach Range", "NM", 2], rollInAltitudeMslFt: ["Roll-in Alt", "ft", 0] };
  fineTune.addEventListener("click", () => run(async () => {
    const request = { target: tuneTarget.value, value: Number(tuneValue.value), knob: tuneKnob.value };
    if (!Number.isFinite(request.value)) { tuneStatus.textContent = "목표값을 숫자로 넣어 주세요."; return; }
    if (request.knob === "offset" && !((isVip() || pressed(mainLock("vrpReference"))) && (pressed(mainLock("angleOffDeg")) || pressed(mainLock("attackHeadingDeg"))))) {
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
    const flown = Number(tuneNow(answer?.output?.aircraftResults?.[1]));
    tuneStatus.textContent = `${kLabel} ${Number(text).toFixed(kDigits)}${kUnit === "°" ? "°" : ` ${kUnit}`} 입력 → ${tLabel} ${Number.isFinite(flown) ? flown.toFixed(tDigits) : "-"} ${tUnit} (목표 ${r.want}) · 계산 ${r.runs}회, ${((performance.now() - started) / 1000).toFixed(1)} s${r.status === "CLOSEST" ? ` · ${r.message}` : ""}`;
  }));

  // ---- step 3: the Angle Off range for the step-2 VRP and Offset Angle ----
  let region = null; // { signature, points, solutions, done, total, ms, rollInFree, offsetAngleDeg }
  let regionJob = 0;
  let regionTimer = null;
  let active = false;
  let pickEdited = false;
  const round = (k, v) => (typeof v === "number" ? +v.toFixed(3) : v);
  const wantOa = () => Math.abs(Number(targetOa.value));
  // The baseline's own Angle Off / heading / solved Offset values and LOCKs do not change the region; the Roll-in
  // Altitude does only when it is held.
  const regionSignatureOf = (base) => {
    const b = structuredClone(base);
    for (const key of ["angleOffDeg", "attackHeadingDeg", "offsetAngleDeg", "actionRangeNm", "approachRangeNm"]) delete b.values[key];
    if (altFree.checked) { delete b.values.rollInAltitudeMslFt; delete b.values.initialAltitudeMslFt; delete b.values.trackingTimeSec; delete b.state.enteredTrackingTimeSec; delete b.state.solveMode; }
    delete b.locks; delete b.state.driver;
    return JSON.stringify([b, wantOa(), altFree.checked], round);
  };
  function scheduleRegion(delay = 700) {
    if (!active || !regionPool || isVip() || !(wantOa() > 0)) return;
    let base;
    try { base = regionBaseline(answer); } catch { return; }
    const signature = regionSignatureOf(base);
    if (region?.signature === signature) return;
    clearTimeout(regionTimer);
    regionTimer = setTimeout(() => runRegion(base, signature), delay);
  }
  targetOa.addEventListener("input", () => { targetEdited = true; scheduleRegion(900); });
  targetOa.addEventListener("change", () => { targetEdited = true; scheduleRegion(0); });
  altFree.addEventListener("change", () => scheduleRegion(0));
  pickAo.addEventListener("input", () => { pickEdited = true; });
  async function runRegion(base, signature) {
    const id = ++regionJob;
    regionPool.clear();
    const started = performance.now();
    const points = [];
    const offsetAngleDeg = wantOa();
    const rollInFree = altFree.checked;
    region = { signature, base, points, solutions: [], done: 0, total: ANGLE_OFF_GRID.length, ms: 0, rollInFree, offsetAngleDeg };
    renderRegionStep(answer?.output?.aircraftResults?.[1]);
    let queued = false;
    await Promise.all(coarseFirst(ANGLE_OFF_GRID).map((ao) => regionPool.point(base, { angleOffDeg: ao, offsetAngleDeg, rollInFree }, "region").then((point) => {
      if (id !== regionJob || !point) return;
      points.push(point);
      region.done += 1;
      if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; if (id === regionJob) renderRegionStep(answer?.output?.aircraftResults?.[1]); }); }
    })));
    if (id !== regionJob) return;
    // Roll-in Altitude held: the Angle Offs where the solved Offset Angle crosses the set one.
    if (!rollInFree) {
      const slim = points.map(({ angleOffDeg, offsetResidualDeg, level }) => ({ angleOffDeg, offsetResidualDeg, level }));
      const found = await regionPool.point(base, { points: slim, offsetAngleDeg }, "regionHeld");
      if (id !== regionJob) return;
      region.solutions = Array.isArray(found) ? found.filter((p) => p.fits) : [];
    }
    region.ms = performance.now() - started;
    renderRegionStep(answer?.output?.aircraftResults?.[1]);
  }
  // The points drawn: with the altitude free, every Angle Off that found its Roll-in Altitude; held, the solutions only.
  const drawnPoints = () => (!region ? [] : region.rollInFree ? region.points.map((p) => (p.fits ? p : { ...p, level: "bad" })) : region.solutions);
  const span = (r, key, f) => (r && Number.isFinite(r[`${key}FromDeg`]) ? `${f(r[`${key}FromDeg`])}–${f(r[`${key}ToDeg`])}` : null);
  const hdg3 = (v) => String(Math.round(((v % 360) + 360) % 360)).padStart(3, "0");
  const deg0 = (v) => `${Math.round(v)}°`;
  const deg1 = (v) => `${v.toFixed(1)}°`;
  const SIDE_NAME = { RIGHT: "R", LEFT: "L" };
  function renderRegionStep(ar) {
    const g = ar?.result?.geometry;
    const pts = drawnPoints();
    const side = g?.direction?.rollDirection ?? null;
    const summary = regionSummary(pts);
    const summaries = side ? { [side]: summary } : {};
    const done = region && region.done >= region.total && region.ms > 0;
    if (isVip()) regionStatus.textContent = "VIP 모드: 가능 범위는 VRP 모드에서 그립니다.";
    else if (!(wantOa() > 0)) regionStatus.textContent = "2단계에 Offset Angle을 넣으세요.";
    else if (!regionPool) regionStatus.textContent = "-";
    else if (!region) regionStatus.textContent = "Angle Off 가용 범위: 계산 대기";
    else {
      const mode = region.rollInFree ? "Roll-in 고도 변경 허용" : "Roll-in 고도 고정";
      regionStatus.textContent = !done
        ? `Angle Off 가용 범위 계산 중 ${region.done} / ${region.total} (VRP 고정, Offset Angle ${region.offsetAngleDeg}°, ${mode})`
        : `VRP 고정 · Offset Angle ${region.offsetAngleDeg}° · ${mode} · 현재 Roll-in 쪽 · Angle Off ${ANGLE_OFF_GRID[0]}–${ANGLE_OFF_GRID.at(-1)}° 5° 간격 · ${(region.ms / 1000).toFixed(1)} s · 점에 마우스를 올리면 값`;
    }
    renderRegionTopView(topSvg, {
      points: pts, summaries, labels: REGION_LABELS, maxJoinDeg: 5.01,
      current: g ? { geometry: g, popPoint: null, approachRangeNm: ar.result.resolved?.approachRangeNm, attackHeadingDeg: g.attackHeadingDeg } : null,
      upHeadingDeg: topIpBottom ? Number(ar?.result?.resolved?.runInHeadingDeg ?? g?.runInHeadingDeg ?? 0) : 0,
    });
    topSvg.__viewport?.refresh();
    const fitting = pts.filter((p) => p.level === "ok" || p.level === "warn").sort((a, b) => a.angleOffDeg - b.angleOffDeg);
    if (region && !region.rollInFree) {
      setOut("regionAo", !done ? "-" : fitting.length ? fitting.map((p) => `${deg1(p.angleOffDeg)}${p.level === "warn" ? " (WARNING)" : ""}`).join(" · ") : "없음");
      setOut("regionAtk", fitting.length ? fitting.map((p) => hdg3(p.attackHeadingDeg)).join(" · ") : done ? "없음" : "-");
      setOut("regionAlt", "고정");
    } else {
      const a = span(summary?.possible, "angleOff", deg0);
      const v = span(summary?.recommended, "angleOff", deg0);
      setOut("regionAo", a ? `${a}${v && v !== a ? ` (VALID ${v})` : ""}` : done ? "없음" : "-");
      setOut("regionAtk", span(summary?.possible, "attackHeading", hdg3) ?? (done ? "없음" : "-"));
      const alts = fitting.map((p) => p.rollInAltitudeMslFt).filter(Number.isFinite);
      setOut("regionAlt", alts.length ? `${ft(Math.min(...alts))}–${ft(Math.max(...alts))}` : done ? "없음" : "-");
    }
    const gaps = region && region.rollInFree && fitting.length > 1 && fitting.some((p, i) => i && p.angleOffDeg - fitting[i - 1].angleOffDeg > 5.01);
    regionNote.textContent = !done || !g ? ""
      : !fitting.length ? (region.rollInFree
        ? `이 VRP와 Offset Angle ${region.offsetAngleDeg}°로는 Roll-in 고도를 바꿔도 맞는 Angle Off가 없습니다. Offset Angle이나 VRP Range를 바꿔 보세요.`
        : `Roll-in 고도를 고정하면 Offset Angle ${region.offsetAngleDeg}°에 맞는 Angle Off가 없습니다. 2단계에서 Roll-in 고도 변경을 허용하거나 Offset Angle을 바꿔 보세요.`)
      : gaps ? "가능 범위 중간에 비는 Angle Off가 있습니다 (Top View의 점 참고)." : "";
    regionNote.dataset.level = regionNote.textContent ? "warn" : "none";
  }
  // 확정 3: the Angle Off picked (or the nearest fitting one), its Roll-in Altitude first when the altitude is free.
  async function applyAngleOff() {
    if (isVip() || !region) return;
    const fitting = drawnPoints().filter((p) => p.level === "ok" || p.level === "warn");
    let ao = Number(pickAo.value);
    if (!Number.isFinite(ao)) ao = fitting[0]?.angleOffDeg;
    if (!Number.isFinite(ao)) { regionNote.textContent = "Angle Off를 넣으세요."; return; }
    if (!region.rollInFree && !pickEdited && fitting.length) ao = fitting.reduce((b, p) => (Math.abs(p.angleOffDeg - ao) < Math.abs(b.angleOffDeg - ao) ? p : b)).angleOffDeg;
    if (region.rollInFree) {
      const c = await regionPool.point(region.base, { angleOffDeg: ao, offsetAngleDeg: region.offsetAngleDeg, rollInFree: true }, "region");
      if (!c?.fits || !Number.isFinite(c.rollInAltitudeMslFt)) { regionNote.textContent = `Angle Off ${deg1(ao)}에는 맞는 Roll-in 고도가 없습니다. 가능 범위 안에서 고르세요.`; regionNote.dataset.level = "warn"; return; }
      await setField("rollInAltitudeMslFt", String(Math.round(c.rollInAltitudeMslFt)));
    }
    await press(mainLock("attackHeadingDeg"), false);
    await releaseSolved();
    await press(mainLock("angleOffDeg"), true);
    await setField("angleOffDeg", ao.toFixed(1));
    pickEdited = false;
  }
  // ---- step 3: the VRP × Angle Off map ----
  const MAP_AO = Object.freeze(Array.from({ length: 17 }, (_, i) => 10 + i * 10));
  let vrpMap = null; // { signature, vrps, cells, done, total, ms }
  let mapJob = 0;
  let mapTimer = null;
  const mapSignatureOf = (base) => {
    const b = structuredClone(base);
    for (const key of ["angleOffDeg", "attackHeadingDeg", "offsetAngleDeg", "actionRangeNm", "approachRangeNm", "vrpRangeNm", "ipRangeNm"]) delete b.values[key];
    delete b.locks; delete b.state.driver;
    return JSON.stringify(b, round);
  };
  const mapVrps = (cur) => {
    const c = Math.round(Number.isFinite(cur) ? cur : 7);
    const from = Math.max(2, c - 5);
    return Array.from({ length: 11 }, (_, i) => from + i);
  };
  function scheduleMap() {
    if (!active || !mapPool || isVip()) return;
    let base;
    try { base = regionBaseline(answer); } catch { return; }
    const signature = mapSignatureOf(base);
    const vrps = mapVrps(Number(base.values.vrpRangeNm));
    // A VRP outside the drawn rows redraws the rows; otherwise the same map stays.
    if (vrpMap?.signature === signature && vrpMap.vrps.includes(Math.round(Number(base.values.vrpRangeNm)))) return;
    clearTimeout(mapTimer);
    mapTimer = setTimeout(() => runMap(base, vrps, signature), 700);
  }
  async function runMap(base, vrps, signature) {
    const id = ++mapJob;
    mapPool.clear();
    const started = performance.now();
    const cells = [];
    vrpMap = { signature, vrps, cells, done: 0, total: vrps.length * MAP_AO.length, ms: 0 };
    renderMapStep(answer?.output?.aircraftResults?.[1]);
    let queued = false;
    // Coarse first (every 15° and every other VRP), so the map shows early.
    const jobs = vrps.flatMap((v, vi) => MAP_AO.map((ao) => [v, ao, (ao % 30 === 10 && vi % 2 === 0) ? 0 : 1])).sort((a, b) => a[2] - b[2]);
    await Promise.all(jobs.map(([v, ao]) => {
      const b = structuredClone(base);
      b.values.vrpRangeNm = v;
      return mapPool.point(b, { angleOffDeg: ao }, "region").then((cell) => {
        if (id !== mapJob || !cell) return;
        cells.push({ ...cell, vrpRangeNm: v, angleOffDeg: ao });
        vrpMap.done += 1;
        if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; if (id === mapJob) renderMapStep(answer?.output?.aircraftResults?.[1]); }); }
      });
    }));
    if (id !== mapJob) return;
    vrpMap.ms = performance.now() - started;
    renderMapStep(answer?.output?.aircraftResults?.[1]);
  }
  function renderMapStep(ar) {
    if (isVip()) { mapStatus.textContent = "VIP 모드: 지도는 VRP 모드에서 그립니다."; mapSvg.replaceChildren(); setOut("mapTarget", "-"); return; }
    if (!vrpMap) { mapStatus.textContent = mapPool ? "VRP × Angle Off 지도: 계산 대기" : "-"; return; }
    const g = ar?.result?.geometry;
    const out = renderVrpMap(mapSvg, vrpMap.cells, {
      vrps: vrpMap.vrps, angleOffs: MAP_AO, targetOffsetAngleDeg: wantOa(),
      current: g ? { vrpRangeNm: Number(ar?.result?.resolved?.vrpRangeNm), angleOffDeg: g.angleOffDeg } : null,
      onPick: busy ? null : pickCell,
    });
    mapSvg.__viewport?.refresh();
    const done = vrpMap.done >= vrpMap.total && vrpMap.ms > 0;
    mapStatus.textContent = done
      ? `Roll-in ${ft(Number(regionBaseOf()?.values?.rollInAltitudeMslFt))} ft 고정 · VRP ${vrpMap.vrps[0]}–${vrpMap.vrps.at(-1)} NM × Angle Off ${MAP_AO[0]}–${MAP_AO.at(-1)}° · ${vrpMap.total}칸 ${(vrpMap.ms / 1000).toFixed(1)} s · 칸에 마우스를 올리면 값, 누르면 적용`
      : `VRP × Angle Off 지도 계산 중 ${vrpMap.done} / ${vrpMap.total}`;
    const byVrp = new Map();
    for (const c of out?.crossings ?? []) byVrp.set(c.vrpRangeNm, [...(byVrp.get(c.vrpRangeNm) ?? []), c.angleOffDeg]);
    setOut("mapTarget", !(wantOa() > 0) ? "2단계에 Offset Angle을 넣으세요" : byVrp.size
      ? [...byVrp].sort((a, b) => a[0] - b[0]).map(([v, aos]) => `${v}: ${aos.map((a) => `${Math.round(a)}°`).join("/")}`).join(" · ")
      : done ? `이 범위에 Offset Angle ${wantOa()}°가 되는 곳이 없습니다` : "-");
  }
  const regionBaseOf = () => { try { return regionBaseline(answer); } catch { return null; } };
  // A cell pressed: its VRP and Angle Off go to the page (VRP LOCK, Angle Off LOCK; the Offset Angle is solved), and
  // its Offset Angle becomes the step-2 target so the Top View below follows.
  function pickCell(cell) {
    run(async () => {
      targetOa.value = Math.abs(cell.offsetAngleDeg).toFixed(1);
      targetEdited = true;
      await setField("vrpRangeNm", String(cell.vrpRangeNm));
      await press(mainLock("vrpReference"), true);
      await press(mainLock("attackHeadingDeg"), false);
      await releaseSolved();
      await press(mainLock("angleOffDeg"), true);
      await setField("angleOffDeg", String(cell.angleOffDeg));
      pickEdited = false;
      scheduleRegion(0);
    });
  }
  targetOa.addEventListener("input", () => renderMapStep(answer?.output?.aircraftResults?.[1]));

  offsetUi.onFlightAnswer?.((next) => {
    answer = next;
    const done = waiting;
    waiting = [];
    render();
    scheduleRegion();
    scheduleMap();
    done.forEach((resolve) => resolve());
  });
  return {
    root,
    activate() { active = true; answer = offsetUi.flightAnswer?.() ?? answer; render(); scheduleRegion(); scheduleMap(); },
    deactivate() { active = false; },
    // Read-only hook for the browser checks.
    state: () => ({ busy, map: vrpMap && { done: vrpMap.done, total: vrpMap.total, ms: vrpMap.ms, vrps: vrpMap.vrps, flying: vrpMap.cells.filter((c) => c.level !== "bad").length }, confirmed: { 1: confirmed[1](), 2: confirmed[2](), 3: confirmed[3]() }, region: region && { done: region.done, total: region.total, ms: region.ms, rollInFree: region.rollInFree, offsetAngleDeg: region.offsetAngleDeg, summary: regionSummary(drawnPoints()), solutions: region.solutions.map((p) => p.angleOffDeg), fitting: drawnPoints().filter((p) => p.level !== "bad").map((p) => [p.angleOffDeg, p.rollInAltitudeMslFt]) } }),
  };
}
