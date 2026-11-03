import { svgNode } from "../../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { buildBdpZDiagramData, profileName } from "../../bomb-delivery-planner/view/bdp-z-diagram-v0.1.mjs?v=0.1.8";
import { offsetZLowerColumns } from "../../offset-bombing/view/offset-z-diagram-v0.1.mjs?v=0.1.9";
import { formatDeg, formatNm } from "../../../../common/ui/display-precision-v0.1.mjs";

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
export const POPUP_Z_DIAGRAM_V0_1 = Object.freeze({
  id: "popup-z-diagram-v0.1",
  version: "0.1.2",
  ticks: Object.freeze(["ROLL_IN", "PULL_DOWN"]),
  canvas: Object.freeze({ width: 650, height: 580 }),
  offsetRows: Object.freeze({ firstY: 606, rowHeight: 30, bottomGap: 26, leftX: 40, rightX: 340 }),
  // Right-aligned at x; the Roll-in group from firstY down, Roll-in Lead on the Ground Speed / Action Range line.
  rollInGroup: Object.freeze({ x: 630, firstY: 32, rowHeight: 26 }),
  rollInLead: Object.freeze({ x: 630, y: 460 }),
  popupRange: Object.freeze({ y: 490 }),
});

const FT_PER_NM = 6076.11549;
const kft = (ft) => (Number.isFinite(ft) ? (ft / 1000).toFixed(1) : "-");
const event = (popup, name) => popup?.events?.find((e) => e.name === name) ?? null;

// The numbers on the diagram (pure; tested). `tick` is "ROLL_IN" (default, owner) or "PULL_DOWN". `deltaTime`,
// `advanced` and `aircraftNumber` are the Offset Z's options for its lower block (offsetZLowerColumns).
export function buildPopupZDiagramData(result, popup, { tick = "ROLL_IN", deltaTime = null, advanced = false, aircraftNumber = 1 } = {}) {
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
  // Ground speed on the Run-In at the Action Point: the Offset ingress leg (IP → Action Point), else the Offset TAS.
  const t = result.timing ?? {};
  const ingressGs = Math.abs(t.ingressDistanceNm) > 1e-6 && t.ingressSec > 0 ? (Math.abs(t.ingressDistanceNm) / t.ingressSec) * 3600 : null;
  const groundSpeedKt = ingressGs ?? result.resolved?.offsetTasKt ?? null;
  const climbTick = tick === "PULL_DOWN"
    ? { label: "PULL DOWN ALT", altitudeMslFt: pullDown?.altitudeMslFt ?? null }
    : { label: "ROLL-IN ALT", altitudeMslFt: rollIn?.altitudeMslFt ?? null };
  const other = tick === "PULL_DOWN"
    ? { label: "ROLL-IN ALT", altitudeMslFt: rollIn?.altitudeMslFt ?? null }
    : { label: "PULL DOWN ALT", altitudeMslFt: pullDown?.altitudeMslFt ?? null };
  return {
    supported: true,
    title: `${Math.round(input.diveAngleDeg)} ${profileName(input)}`,
    diveAngleDeg: input.diveAngleDeg,
    climbAngleDeg: popup.popupAngleDeg,
    tick,
    climbTick,
    other,
    apexAltitudeMslFt: apex?.altitudeMslFt ?? null,
    praMslFt: p.effectiveReleaseAltitudeMslFt,
    mraMslFt: p.nltReleaseMslFt,
    groundSpeedKt,
    actionRangeNm: result.geometry?.actionRangeNm ?? null,
    popupRangeNm: Number.isFinite(popup.popToTargetNm) ? popup.popToTargetNm : null,
    // Upper right (0.1.2): Roll-in Angle Off, Roll-in Range (Ground), Roll-in Range (Slant), IAA.
    rollInGroup: [
      { label: labels.rollInAngleOff, value: `${formatDeg(z.rollInAngleOff)}°` },
      { label: labels.rollInRange, value: `${formatNm(nmOf(z.rollInRangeFt))} NM (Ground)` },
      { label: labels.rollInRange, value: `${formatNm(nmOf(z.slantFt))} NM (Slant)` },
      { label: labels.aimOffAngle, value: `${formatDeg(z.aimOffAngle)}°` },
    ],
    // Lower right (0.1.2).
    rollInLead: { label: labels.rollInLead, value: `${formatDeg(z.rollInLead)}°` },
    // Under the Action Range (0.1.2): the Pop-up Point → Target distance (§13.8f).
    popupRange: { label: "Pop-up Range", value: `${formatNm(popup.popToTargetNm)} NM` },
    // The Offset Z-Diagram's lower block, drawn under the POP-UP lines (0.1.1).
    offsetColumns: offsetZLowerColumns(result, { deltaTime, advanced: advanced === true, aircraftNumber }),
    text: {
      apex: kft(apex?.altitudeMslFt),
      tick: kft(climbTick.altitudeMslFt),
      other: kft(other.altitudeMslFt),
      pra: kft(p.effectiveReleaseAltitudeMslFt),
      mra: kft(p.nltReleaseMslFt),
      climbAngle: `${Math.round(popup.popupAngleDeg)}°`,
      groundSpeed: Number.isFinite(groundSpeedKt) ? `${Math.round(groundSpeedKt)} Gs` : "- Gs",
      actionRange: Number.isFinite(result.geometry?.actionRangeNm) ? `${result.geometry.actionRangeNm.toFixed(1)}Nm` : "-Nm",
    },
  };
}

export function popupZDiagramTitle({ aircraftNumber = 1 } = {}) {
  return `POP-UP #${aircraftNumber} Z-Diagram`;
}

// Draws the schematic as the owner sketch: a fixed triangle (the numbers carry the values, not the drawn angles);
// the ticks sit on the legs at their altitudes between the base line (Pop altitude) and the Apex.
export function renderPopupZDiagram(svg, result, popup, { tick = "ROLL_IN", aircraftNumber = 1, deltaTime = null, advanced = false } = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  const data = buildPopupZDiagramData(result, popup, { tick, deltaTime, advanced, aircraftNumber });
  const { width, height: diagramHeight } = POPUP_Z_DIAGRAM_V0_1.canvas;
  const rows = POPUP_Z_DIAGRAM_V0_1.offsetRows;
  const rowCount = data.supported ? Math.max(data.offsetColumns.left.length, data.offsetColumns.right.length) : 0;
  const height = rowCount ? rows.firstY + (rowCount - 1) * rows.rowHeight + rows.bottomGap : diagramHeight;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.aspectRatio = `${width} / ${height}`;
  svg.setAttribute("aria-label", popupZDiagramTitle({ aircraftNumber }));
  const root = svg.querySelector("g") ?? svg;
  root.replaceChildren();
  root.append(svgNode("rect", { x: 0, y: 0, width, height, fill: "#ffffff" }));
  const text = (x, y, value, { size = 22, anchor = "start", weight = 700 } = {}) =>
    root.append(svgNode("text", { x, y, "font-size": size, "font-weight": weight, "text-anchor": anchor, fill: "#111111", "font-family": "Arial, Helvetica, sans-serif" }, value));
  if (!data.supported) {
    text(width / 2, height / 2, data.reason, { anchor: "middle" });
    return data;
  }
  const line = (x1, y1, x2, y2, w = 9) => root.append(svgNode("line", { x1, y1, x2, y2, stroke: "#111111", "stroke-width": w, "stroke-linecap": "square" }));
  // Fixed shape: base corner, Apex, MRA end (the sketch's proportions).
  const base = { x: 150, y: 420 };
  const apex = { x: 330, y: 120 };
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
  text(40, 50, data.title, { size: 28 });
  text(apexX, apexY - 22, data.text.apex, { anchor: "middle", size: 28 });
  text(tickX - 42, tickY - 10, data.text.tick, { anchor: "end", size: 26 });
  text(praX + 12, praY - 14, data.text.pra, { size: 26 });
  text(mraX + 64, mraY + 9, data.text.mra, { size: 26 });
  text(startX + 34, baseY - 18, data.text.climbAngle, { size: 26 });
  text(startX - 6, baseY + 40, data.text.groundSpeed, { anchor: "middle", size: 24 });
  text(startX + 120, baseY + 40, data.text.actionRange, { anchor: "middle", size: 24 });
  // 0.1.2: Pop-up Range under the Action Range; the Roll-in group at the upper right; Roll-in Lead at the lower right.
  const rowText = (row) => `${row.label}: ${row.value}`;
  const group = POPUP_Z_DIAGRAM_V0_1.rollInGroup;
  text(startX + 120, POPUP_Z_DIAGRAM_V0_1.popupRange.y, rowText(data.popupRange), { anchor: "middle", size: 15, weight: 900 });
  data.rollInGroup.forEach((row, index) => text(group.x, group.firstY + index * group.rowHeight, rowText(row), { anchor: "end", size: 15, weight: 900 }));
  text(POPUP_Z_DIAGRAM_V0_1.rollInLead.x, POPUP_Z_DIAGRAM_V0_1.rollInLead.y, rowText(data.rollInLead), { anchor: "end", size: 15, weight: 900 });
  // Both climb-leg altitudes are on the diagram: the tick's label and the other one's value (§13.8a).
  text(40, diagramHeight - 50, `${data.other.label} ${data.text.other} · ${data.climbTick.label} ${data.text.tick} (tick)`, { size: 18, weight: 700 });
  text(40, diagramHeight - 22, `PRA ${data.text.pra} · MRA = NLT Release ${data.text.mra} · Apex ${data.text.apex} · kft MSL`, { size: 15, weight: 600 });
  // The Offset Z-Diagram's lower block (0.1.1): its two columns, as the Offset Z writes them ("Label: value").
  if (rowCount) {
    root.append(svgNode("line", { x1: 40, y1: diagramHeight - 2, x2: width - 40, y2: diagramHeight - 2, stroke: "#c9d1d9", "stroke-width": 1.5 }));
    [[rows.leftX, data.offsetColumns.left], [rows.rightX, data.offsetColumns.right]].forEach(([x, list]) => list.forEach((row, index) => {
      text(x, rows.firstY + index * rows.rowHeight, `${String(row.label).replace(/:\s*$/, "")}: ${row.value}`, { size: 15, weight: 900 });
    }));
  }
  return data;
}
