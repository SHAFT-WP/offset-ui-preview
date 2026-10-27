import { svgNode } from "../../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { profileName } from "../../bomb-delivery-planner/view/bdp-z-diagram-v0.1.mjs?v=0.1.8";

// POP-UP Z-Diagram v0.1 (owner 2026-10-27, POP-UP SPEC §13.8, §13.8a; owner sketch reference/popup-z-diagram-
// owner-2026-10-27.jpg). POP-UP only. A triangle: the climb leg from the Action Point up at the Climb Angle to the
// Apex, the dive leg down to the MRA; ticks for the climb-leg altitude (Roll-in or Pull Down, the page's option) and
// the PRA. Altitudes in thousands of feet MSL, one decimal (§13.8). The altitude not on the tick is written under
// the diagram, so both are always on it (§13.8a). The view reads the POP-UP Flight result; nothing is solved here.
export const POPUP_Z_DIAGRAM_V0_1 = Object.freeze({
  id: "popup-z-diagram-v0.1",
  version: "0.1.0",
  ticks: Object.freeze(["ROLL_IN", "PULL_DOWN"]),
  canvas: Object.freeze({ width: 650, height: 580 }),
});

const kft = (ft) => (Number.isFinite(ft) ? (ft / 1000).toFixed(1) : "-");
const event = (popup, name) => popup?.events?.find((e) => e.name === name) ?? null;

// The numbers on the diagram (pure; tested). `tick` is "ROLL_IN" (default, owner) or "PULL_DOWN".
export function buildPopupZDiagramData(result, popup, { tick = "ROLL_IN" } = {}) {
  if (!result?.profile || !popup) return { supported: false, reason: "No POP-UP result" };
  if (!POPUP_Z_DIAGRAM_V0_1.ticks.includes(tick)) throw new RangeError(`tick must be one of ${POPUP_Z_DIAGRAM_V0_1.ticks.join(", ")}`);
  const input = result.profile.canonicalInputs;
  const p = result.profile.public;
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
export function renderPopupZDiagram(svg, result, popup, { tick = "ROLL_IN", aircraftNumber = 1 } = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  const data = buildPopupZDiagramData(result, popup, { tick });
  const { width, height } = POPUP_Z_DIAGRAM_V0_1.canvas;
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
  // Both climb-leg altitudes are on the diagram: the tick's label and the other one's value (§13.8a).
  text(40, height - 50, `${data.other.label} ${data.text.other} · ${data.climbTick.label} ${data.text.tick} (tick)`, { size: 18, weight: 700 });
  text(40, height - 22, `PRA ${data.text.pra} · MRA = NLT Release ${data.text.mra} · Apex ${data.text.apex} · kft MSL`, { size: 15, weight: 600 });
  return data;
}
