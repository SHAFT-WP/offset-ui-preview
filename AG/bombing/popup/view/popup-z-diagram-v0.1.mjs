import { svgNode } from "../../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { buildBdpZDiagramData, profileName } from "../../bomb-delivery-planner/view/bdp-z-diagram-v0.1.mjs?v=0.1.8";
import { formatHeadingDeg } from "../../offset-bombing/view/offset-view-style-v0.1.mjs?v=0.1.5";
import { formatDeg, formatG, formatNm, formatSec, formatSecTenths } from "../../../../common/ui/display-precision-v0.1.mjs";

// POP-UP Z-Diagram v0.1 (owner 2026-10-27, POP-UP SPEC §13.8, §13.8a; owner sketch reference/popup-z-diagram-
// owner-2026-10-27.jpg). POP-UP only. A triangle: the climb leg from the Action Point up at the Climb Angle to the
// Apex, the dive leg down to the MRA; ticks for the climb-leg altitude (Roll-in or Pull Down, the page's option) and
// the PRA. Altitudes in thousands of feet MSL, one decimal (§13.8). The altitude not on the tick is written under
// the diagram, so both are always on it (§13.8a). The view reads the POP-UP Flight result; nothing is solved here.
// 0.1.1 (owner 2026-11-02, "팝업 Z diagram 아래에 정보들에 offset 쪽 정보들 넣어줘"): under the POP-UP lines, the Offset
// Z-Diagram's lower block — the same two columns (Offset view offsetZLowerColumns: Essential, or every row with the
// Z head's Advanced), with ΔTime on the POP-UP clock. The canvas grows with the rows.
// 0.1.2 (owner 2026-11-03, "Pop-up z diagram 오른쪽에 roll in angle off, roll in range, Roll in range (s) IAA 추가 /
// 오른쪽 하단에 Roll in lead 추가 / Action range 밑에 Pop-up range 추가"): on the diagram, the Roll-in group at the
// upper right (Roll-in Angle Off, Roll-in Range Ground / Slant, IAA — the Offset Z's values, BDP Z data), Roll-in
// Lead Angle at the lower right, and the Pop-up Range (Pop-up Point → Target, §13.8f) under the Action Range.
// 0.1.3 (owner 2026-11-03, "Pop-up range roll in lead 모두 리젠드 항목임 / Pull down range와 roll in range 라인도 밑으로
// 폰트 사이즈 리젠드랑 통일 오와 열을 맞춰서 작성"): the legend (the two-column rows under the diagram) takes Pop-up
// Range (under Action Range) and Roll-in Lead Angle (right column, last), and the Roll-in / Pull Down altitude line
// becomes the legend's last row pair (same size, same grid). With it, the §13.9 notes 10–13: the speed is the CAS at
// the Pop (`480 KCAS`), the climb angle `30° (Pop-up 3.9Nm)`, the Action Range `7.0Nm (Offset 12°)`, the tick value
// with its name on the next line (`(Roll-in)` / `(Pull Down)`). Owner the same day ("Pra 3.3 mra=min..... 요라인 중복이니
// 지워. 밑에 라인도 지우고"): the PRA · MRA · Apex line (the diagram already writes them) and the rule under it go.
// Then ("4.0 (rolllin)은 가운디 정렬 / 다이어그램을 왼쪽으로 이동시켜서 오른쪽 상단 블록이 내려올 수 있게 한다 / 폰트
// 사이즈는 모두 동일"): the tick value and its name centred on one axis; the triangle 40 units left and the Roll-in
// block lower; every text of the Z at one size, the legend's (15). Then ("폰트 사이즈 옵셋과 같냐?" → "같게 맞춰줘"): as the
// Offset Z (Common Z with uniformBodyText) — the title 27, every other text 15, every text weight 900. Then ("다시 생각하니
// roll in과 pull down만 이전처럼 제일 윗라인에 수평으로 적어주고 밑에 선하나 이전처럼 그어주는게 좋겠다. 레전드에서는
// 제거 하자"): the Roll-in / Pull Down altitudes are one line again above the legend, with the rule under it, and leave
// the legend. Then (owner's legend list, "왼쪽 컬럼부터 쓸 것이고 (a)는 advanced 항목 … Advanced가 아닐 때, 남은
// 아이템들을 왼쪽 컬럼부터 다시 작성 / 다이어그램도 글자 크기 옵션 제공하자"): the legend is the owner's own list
// (POPUP_Z_LEGEND), written down the left column first, the (a) rows only with Advanced; and a text size option
// (`fontSize`, 13–17, the title moving with it; the page's Text control). Owner ("기본 폰트 사이즈는 제일 마지막에
// 보여준 결과물로 하자"): the default is the last one shown, +2 — body 17, title 29.
export const POPUP_Z_DIAGRAM_V0_1 = Object.freeze({
  id: "popup-z-diagram-v0.1",
  // 0.1.6 (owner 2026-11-11, own IP rule): a VRP beyond the aircraft's own IP reads "#n VRP to Impact Time", timed from
  // the VRP (IP to Impact Time − the negative IP → Action time).
  version: "0.1.6",
  ticks: Object.freeze(["ROLL_IN", "PULL_DOWN"]),
  canvas: Object.freeze({ width: 650, height: 520 }),
  // 0.1.4 (owner 2026-11-03, "롤인 alt라인부터 그 아래까지 2줄 밀자", then "두줄 말고 한줄만"): the Roll-in / Pull Down line, its rule and the
  // legend move down one legend row (30); the diagram above them stays.
  lowerShift: 30,
  offsetRows: Object.freeze({ firstY: 576, rowHeight: 30, bottomGap: 26, leftX: 40, rightX: 340 }),
  // Default sizes (owner 2026-11-03): body 17, title 29 (the Offset Z's 15 / 27 + 2), weight 900. The Text option
  // (owner) steps the body size by 1 within fontSizes; the title moves by the same step. Above 17 the Roll-in Range
  // (Slant) line of the upper-right block reaches the dive leg.
  fontSize: 17,
  fontSizes: Object.freeze([13, 14, 15, 16, 17]),
  titleFontSize: 29,
  fontWeight: 900,
  // The fixed triangle: base corner and Apex (40 units left of 0.1.2, owner 2026-11-03).
  shape: Object.freeze({ baseX: 110, baseY: 420, apexX: 290, apexY: 120 }),
  // Right-aligned at x; the Roll-in group from firstY down.
  rollInGroup: Object.freeze({ x: 630, firstY: 96, rowHeight: 26 }),
});

const FT_PER_NM = 6076.11549;

// The legend, the owner's list and order (2026-11-03). `advanced`: an (a) row, shown only with Advanced.
export const POPUP_Z_LEGEND = Object.freeze([
  { key: "attackHeading", label: "Attack Heading" },
  { key: "angleOff", label: "Angle Off" },
  { key: "offsetTurnG", label: "Offset Turn G" },
  { key: "approachingHeading", label: "Approaching Heading", advanced: true },
  { key: "popupG", label: "Popup G" },
  { key: "popupToRollIn", label: "Pop to Roll-in Distance", advanced: true },
  { key: "map", label: "MAP", advanced: true },
  { key: "rollInBank", label: "Roll-in Bank Angle", advanced: true },
  { key: "rollInG", label: "Roll-in G" },
  { key: "rollInLead", label: "Roll-in Lead Angle", advanced: true },
  { key: "trackingTime", label: "Tracking Time" },
  { key: "bombTof", label: "Bomb TOF", advanced: true },
  { key: "ipToImpact", label: "IP to Impact Time", advanced: true },
].map(Object.freeze));
const kft = (ft) => (Number.isFinite(ft) ? (ft / 1000).toFixed(1) : "-");
const event = (popup, name) => popup?.events?.find((e) => e.name === name) ?? null;

// The numbers on the diagram (pure; tested). `tick` is "ROLL_IN" (default, owner) or "PULL_DOWN". `advanced` shows the
// (a) legend rows; `aircraftNumber` names this aircraft's own IP to Impact Time. `deltaTime` is accepted and unused
// (the legend has no ΔTime row since the owner's list).
export function buildPopupZDiagramData(result, popup, { tick = "ROLL_IN", advanced = false, aircraftNumber = 1 } = {}) {
  if (!result?.profile || !popup) return { supported: false, reason: "No POP-UP result" };
  if (!POPUP_Z_DIAGRAM_V0_1.ticks.includes(tick)) throw new RangeError(`tick must be one of ${POPUP_Z_DIAGRAM_V0_1.ticks.join(", ")}`);
  const input = result.profile.canonicalInputs;
  const p = result.profile.public;
  // The Roll-in values exactly as the Offset Z shows them (BDP Z data; 0.1.2). "-" where the BDP Z has none.
  const bdpZ = buildBdpZDiagramData(result.profile);
  const z = bdpZ.supported ? bdpZ : {};
  const labels = bdpZ.labels ?? { rollInAngleOff: "Roll-in Angle Off", rollInRange: "Roll-in Range", aimOffAngle: "IAA", rollInLead: "Roll-in Lead Angle" };
  const nmOf = (ft) => (Number.isFinite(ft) ? ft / FT_PER_NM : null);
  const rollIn = event(popup, "ROLL_IN_START");
  const pullDown = event(popup, "PULL_DOWN");
  const apex = event(popup, "APEX");
  // CAS at the Pop (0.1.3, §13.9 item 10): the climb's Pop state, else the Offset speed when it is entered as CAS.
  const r = result.resolved ?? {};
  const popCasKt = popup.climb?.pop?.casKt ?? event(popup, "POP")?.kcas ?? (r.offsetSpeedMode === "CAS" ? r.offsetSpeedValue : null);
  const climbTick = tick === "PULL_DOWN"
    ? { label: "PULL DOWN ALT", altitudeMslFt: pullDown?.altitudeMslFt ?? null }
    : { label: "ROLL-IN ALT", altitudeMslFt: rollIn?.altitudeMslFt ?? null };
  const other = tick === "PULL_DOWN"
    ? { label: "ROLL-IN ALT", altitudeMslFt: rollIn?.altitudeMslFt ?? null }
    : { label: "PULL DOWN ALT", altitudeMslFt: pullDown?.altitudeMslFt ?? null };
  return {
    supported: true,
    // 0.1.5 (owner 2026-11-03, "z 다이어그램 헤더 처음에 #1 #2 글자를 넣어줘 출력할 때 헷갈림"): the aircraft number first.
    title: `#${aircraftNumber} ${Math.round(input.diveAngleDeg)} ${profileName(input)}`,
    diveAngleDeg: input.diveAngleDeg,
    climbAngleDeg: popup.popupAngleDeg,
    tick,
    climbTick,
    other,
    apexAltitudeMslFt: apex?.altitudeMslFt ?? null,
    praMslFt: p.effectiveReleaseAltitudeMslFt,
    mraMslFt: p.nltReleaseMslFt,
    popCasKt,
    actionRangeNm: result.geometry?.actionRangeNm ?? null,
    popupRangeNm: Number.isFinite(popup.popToTargetNm) ? popup.popToTargetNm : null,
    // Upper right (0.1.2): Roll-in Angle Off, Roll-in Range (Ground), Roll-in Range (Slant), IAA.
    rollInGroup: [
      { label: labels.rollInAngleOff, value: `${formatDeg(z.rollInAngleOff)}°` },
      { label: labels.rollInRange, value: `${formatNm(nmOf(z.rollInRangeFt))} NM (Ground)` },
      { label: labels.rollInRange, value: `${formatNm(nmOf(z.slantFt))} NM (Slant)` },
      { label: labels.aimOffAngle, value: `${formatDeg(z.aimOffAngle)}°` },
    ],
    // The legend (owner's list): two columns, the left one filled first.
    legendColumns: legendColumns(legendRows(result, popup, { advanced: advanced === true, aircraftNumber })),
    text: {
      apex: kft(apex?.altitudeMslFt),
      tick: kft(climbTick.altitudeMslFt),
      other: kft(other.altitudeMslFt),
      pra: kft(p.effectiveReleaseAltitudeMslFt),
      mra: kft(p.nltReleaseMslFt),
      climbAngle: `${Math.round(popup.popupAngleDeg)}° (Pop-up ${formatNm(popup.popToTargetNm)}Nm)`,
      tickName: tick === "PULL_DOWN" ? "(Pull Down)" : "(Roll-in)",
      speed: `${Number.isFinite(popCasKt) ? Math.round(popCasKt) : "-"} KCAS`,
      actionRange: `${formatNm(result.geometry?.actionRangeNm)}Nm (Offset ${formatDeg(result.geometry?.offsetAngleDeg)}°)`,
    },
  };
}

// The legend rows in the owner's order, the (a) rows only with Advanced. Values from the POP-UP Flight result: the
// Offset turn as flown (its held G), the BDP profile, the POP-UP climb, this aircraft's IP → Impact on the POP-UP clock.
function legendRows(result, popup, { advanced, aircraftNumber }) {
  const g = result.geometry ?? {};
  const t = result.timing ?? {};
  const p = result.profile.public;
  const input = result.profile.canonicalInputs;
  const gText = (value) => `${formatG(value)}G`;
  // Own IP rule (0.1.6): the path starts at a VRP beyond the IP, so the time is named from it.
  const fromVrp = result.actionPointBeyondIp === true && Number.isFinite(t.ingressSec) && t.ingressSec < 0;
  const values = {
    attackHeading: Number.isFinite(g.attackHeadingDeg) ? formatHeadingDeg(g.attackHeadingDeg) : "-",
    angleOff: `${formatDeg(input.angleOffDeg)}°`,
    offsetTurnG: gText(g.offsetTurn?.loadFactorG ?? result.resolved?.offsetG),
    approachingHeading: Number.isFinite(g.offsetHeadingDeg) ? formatHeadingDeg(g.offsetHeadingDeg) : "-",
    popupG: gText(popup.popupG),
    popupToRollIn: `${formatNm(popup.groundDistanceNm)} NM`,
    map: `${formatNm(p.groundRangeNm)} NM`,
    rollInBank: `${formatDeg(p.rollInBankAngleDeg)}°`,
    rollInG: gText(input.rollInG),
    rollInLead: `${formatDeg(p.leadAngleDeg)}°`,
    trackingTime: `${formatSecTenths(p.trackingTimeSec)} s`,
    bombTof: `${formatSec(p.bombTofSec)} s`,
    ipToImpact: `${formatSec(t.offsetIpToReleaseSec + p.bombTofSec - (fromVrp ? t.ingressSec : 0))} s`,
  };
  return POPUP_Z_LEGEND.filter((row) => advanced || !row.advanced).map((row) => ({
    key: row.key,
    label: row.key === "ipToImpact" ? `#${aircraftNumber} ${fromVrp ? "VRP to Impact Time" : row.label}` : row.label,
    value: values[row.key],
  }));
}

// Down the left column first, then the right (owner): the left column takes the larger half.
function legendColumns(rows) {
  const half = Math.ceil(rows.length / 2);
  return { left: rows.slice(0, half), right: rows.slice(half) };
}

// The altitude line above the legend (owner 2026-11-03), Roll-in then Pull Down whatever the tick shows.
function altitudeLine(data) {
  const rollInAlt = data.tick === "PULL_DOWN" ? data.other : data.climbTick;
  const pullDownAlt = data.tick === "PULL_DOWN" ? data.climbTick : data.other;
  return `ROLL-IN ALT ${kft(rollInAlt.altitudeMslFt)} · PULL DOWN ALT ${kft(pullDownAlt.altitudeMslFt)}`;
}

export function popupZDiagramTitle({ aircraftNumber = 1 } = {}) {
  return `POP-UP #${aircraftNumber} Z-Diagram`;
}

// Draws the schematic as the owner sketch: a fixed triangle (the numbers carry the values, not the drawn angles);
// the ticks sit on the legs at their altitudes between the base line (Pop altitude) and the Apex.
export function renderPopupZDiagram(svg, result, popup, { tick = "ROLL_IN", aircraftNumber = 1, advanced = false, fontSize = POPUP_Z_DIAGRAM_V0_1.fontSize } = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  if (!POPUP_Z_DIAGRAM_V0_1.fontSizes.includes(fontSize)) throw new RangeError(`fontSize must be one of ${POPUP_Z_DIAGRAM_V0_1.fontSizes.join(", ")}`);
  const data = buildPopupZDiagramData(result, popup, { tick, advanced, aircraftNumber });
  const { width, height: diagramHeight } = POPUP_Z_DIAGRAM_V0_1.canvas;
  const rows = POPUP_Z_DIAGRAM_V0_1.offsetRows;
  const legend = data.supported ? data.legendColumns : null;
  const rowCount = legend ? Math.max(legend.left.length, legend.right.length) : 0;
  const height = rowCount ? rows.firstY + (rowCount - 1) * rows.rowHeight + rows.bottomGap : diagramHeight + POPUP_Z_DIAGRAM_V0_1.lowerShift;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.aspectRatio = `${width} / ${height}`;
  svg.setAttribute("aria-label", popupZDiagramTitle({ aircraftNumber }));
  const root = svg.querySelector("g") ?? svg;
  root.replaceChildren();
  root.append(svgNode("rect", { x: 0, y: 0, width, height, fill: "#ffffff" }));
  const FS = fontSize;
  const text = (x, y, value, { size = FS, anchor = "start", weight = POPUP_Z_DIAGRAM_V0_1.fontWeight } = {}) =>
    root.append(svgNode("text", { x, y, "font-size": size, "font-weight": weight, "text-anchor": anchor, fill: "#111111", "font-family": "Arial, Helvetica, sans-serif" }, value));
  if (!data.supported) {
    text(width / 2, height / 2, data.reason, { anchor: "middle" });
    return data;
  }
  const line = (x1, y1, x2, y2, w = 9) => root.append(svgNode("line", { x1, y1, x2, y2, stroke: "#111111", "stroke-width": w, "stroke-linecap": "square" }));
  // Fixed shape: base corner, Apex, MRA end (the sketch's proportions).
  const shape = POPUP_Z_DIAGRAM_V0_1.shape;
  const base = { x: shape.baseX, y: shape.baseY };
  const apex = { x: shape.apexX, y: shape.apexY };
  const popAlt = event(popup, "POP")?.altitudeMslFt ?? 0;
  const apexAlt = data.apexAltitudeMslFt ?? popAlt + 1;
  // Height fraction of an altitude between the Pop altitude (0) and the Apex (1), kept inside the legs.
  const frac = (alt) => Math.max(0.08, Math.min(0.92, (alt - popAlt) / Math.max(1, apexAlt - popAlt)));
  const onClimb = (alt) => ({ x: base.x + (apex.x - base.x) * frac(alt), y: base.y + (apex.y - base.y) * frac(alt) });
  // The dive leg runs at 45° on the drawing down to the MRA's height.
  const mraY = base.y + (apex.y - base.y) * frac(data.mraMslFt);
  const mra = { x: apex.x + (mraY - apex.y), y: mraY };
  const onDive = (alt) => {
    // The PRA tick stays at least 40 px above the MRA end so the two values never overlap.
    const y = Math.min(mra.y - 40, base.y + (apex.y - base.y) * frac(alt));
    return { x: apex.x + (y - apex.y), y };
  };
  line(base.x, base.y, apex.x, apex.y);
  line(base.x, base.y, base.x + 220, base.y);
  line(apex.x, apex.y, mra.x, mra.y);
  line(mra.x, mra.y, mra.x + 55, mra.y);
  const tickAt = onClimb(data.climbTick.altitudeMslFt);
  const tickX = tickAt.x;
  const tickY = tickAt.y;
  line(tickX - 40, tickY, tickX, tickY, 7);
  const praAt = onDive(data.praMslFt);
  const praX = praAt.x;
  const praY = praAt.y;
  line(praX, praY, praX + 48, praY, 7);
  const apexX = apex.x;
  const apexY = apex.y;
  const mraX = mra.x;
  const startX = base.x;
  const baseY = base.y;
  // Labels (the owner sketch's places).
  text(40, 50, data.title, { size: POPUP_Z_DIAGRAM_V0_1.titleFontSize + fontSize - POPUP_Z_DIAGRAM_V0_1.fontSize });
  text(apexX, apexY - 16, data.text.apex, { anchor: "middle" });
  // The tick value and its name on one centre axis, left of the tick, kept inside the canvas (owner 2026-11-03).
  const tickHalf = (Math.max(data.text.tick.length, data.text.tickName.length) * FS * 0.56) / 2;
  const tickCentre = Math.max(8 + tickHalf, tickX - 48 - tickHalf);
  text(tickCentre, tickY - 7, data.text.tick, { anchor: "middle" });
  text(tickCentre, tickY + 18, data.text.tickName, { anchor: "middle" });
  text(praX + 12, praY - 12, data.text.pra);
  text(mraX + 62, mraY + 5, data.text.mra);
  text(startX + 34, baseY - 14, data.text.climbAngle);
  text(startX, baseY + 30, data.text.speed, { anchor: "middle" });
  text(startX + 50, baseY + 30, data.text.actionRange);
  // The Roll-in group at the upper right (0.1.2).
  const group = POPUP_Z_DIAGRAM_V0_1.rollInGroup;
  data.rollInGroup.forEach((row, index) => text(group.x, group.firstY + index * group.rowHeight, `${row.label}: ${row.value}`, { anchor: "end", weight: 900 }));
  // The Roll-in / Pull Down altitude line and the rule under it, as before (owner 2026-11-03).
  data.altitudeLine = altitudeLine(data);
  const lowerY = diagramHeight + POPUP_Z_DIAGRAM_V0_1.lowerShift;
  text(40, lowerY - 22, data.altitudeLine);
  root.append(svgNode("line", { x1: 40, y1: lowerY - 2, x2: width - 40, y2: lowerY - 2, stroke: "#c9d1d9", "stroke-width": 1.5 }));
  // The Offset Z-Diagram's lower block (0.1.1): its two columns, as the Offset Z writes them ("Label: value").
  if (rowCount) {
    [[rows.leftX, legend.left], [rows.rightX, legend.right]].forEach(([x, list]) => list.forEach((row, index) => {
      if (row) text(x, rows.firstY + index * rows.rowHeight, `${String(row.label).replace(/:\s*$/, "")}: ${row.value}`, { weight: 900 });
    }));
  }
  return data;
}
