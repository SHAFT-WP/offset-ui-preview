import { bdpZLowerColumns, buildBdpZDiagramData, profileName } from "../../bomb-delivery-planner/view/bdp-z-diagram-v0.1.mjs?v=0.1.8";
import { renderCommonZDiagram } from "../../../../common/diagram/z-diagram/z-diagram-v0.1.mjs?v=0.1.13";
import { svgNode } from "../../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { formatDeg, formatNm, formatSec } from "../../../../common/ui/display-precision-v0.1.mjs";
import { bearingDeg, formatHeadingDeg, offsetViewTitle } from "./offset-view-style-v0.1.mjs?v=0.1.5";

// Offset Z-Diagram — the BDP Z of the profile Offset solved, with Offset footer rows (Common Z
// grammar; formerly apps/bombing-calculator-v2/offset/offset-z-diagram-v0.1.mjs). Values use the
// Common display formatters; titles carry the aircraft number.

export const OFFSET_Z_DIAGRAM_V0_1 = Object.freeze({
  id: "offset-z-diagram-v0.1",
  // 0.1.1 (2026-09-29): Common Z 0.1.7 items (halo, speed value, 45°/4°, long-press labels).
  // 0.1.2 (2026-10-01): BDP title classification (e.g. "Offset HADB 45 #1"); Common 0.1.8 top row;
  // the BDP rows stay and the Offset rows follow them.
  // 0.1.3 (2026-10-01): two-column lower block (offsetZLowerColumns) with ΔTime; every aircraft.
  // 0.1.4 (2026-10-01, user): MAP replaces the lower Roll-in Range row (via bdpZLowerColumns).
  // 0.1.5 (2026-10-03, user): Essential / Advanced lower block. Essential = Action Range, Offset
  // Angle, Roll-in Lead Angle, Attack Heading | ΔTime; Advanced = every row. "IP to Impact Time" reads
  // "#k IP to Impact Time" for the ΔTime Impact aircraft k; "Action to Impact Time" is removed.
  // 0.1.6 (2026-10-06, user): Roll-in Altitude (top-left value) one character left (x 42 → 34).
  // 0.1.7 (2026-10-07): view style 0.1.4 token only (no drawing change).
  // 0.1.8 (2026-10-12, user): Tracking Time in 0.1 s (BDP Z 0.1.7 trackingTimeTenths).
  // 0.1.9 (2026-10-15, owner R7 / Q14): Roll-in Lead Angle moves under Roll-in Angle Off (Common Z 0.1.13
  // rollInLeadInGroup; no longer in the lower block). Essential lower block: Action Range, Offset Angle,
  // Attack Heading | Roll-in Bank Angle (BDP v0.4 result), Tracking Time, ΔTime.
  version: "0.1.9",
  subject: "Offset",
  view: "Z-Diagram",
});

export const offsetZDiagramTitle = (options) => offsetViewTitle("Z-Diagram", options);

// In-plot profile title with BDP's classification (user decision 2026-10-01), e.g. "Offset HADB 45 #1".
export function offsetProfileTitle(result, { aircraftNumber = 1 } = {}) {
  const input = result.profile.canonicalInputs;
  return `Offset ${profileName(input)} ${formatDeg(input.diveAngleDeg)} #${aircraftNumber}`;
}

// The Common Z renderer draws into [data-z-root]; a bare svg gets one.
function zRoot(svg) {
  return svg.querySelector("[data-z-root]") ?? svg.appendChild(svgNode("g", { "data-z-root": "" }));
}

// Offset lower block, two columns (user layout 2026-10-01; Essential / Advanced 2026-10-03). Times
// are from the full-precision results and only rounded for display. ΔTime is the drop-order delta the
// caller passes (computeDropOrderDelta: #(n-1) Impact − #n Release; #1 shows #2's, so #1 and #2
// match) with `impactIpToImpactSec`, the IP → Impact time of its Impact aircraft (#n-1). Without a
// ΔTime (single aircraft) "#k IP to Impact Time" is this aircraft's own.
export const OFFSET_Z_ESSENTIAL_ROWS = Object.freeze(["Action Range", "Offset Angle", "Attack Heading"]);
export const OFFSET_Z_ESSENTIAL_RIGHT_ROWS = Object.freeze(["Roll-in Bank Angle", "Tracking Time"]);
export function offsetZLowerColumns(result, { deltaTime = null, advanced = false, aircraftNumber = 1 } = {}) {
  const g = result.geometry;
  const t = result.timing;
  const p = result.profile.public;
  const bdp = bdpZLowerColumns(result.profile, { attackHeadingText: formatHeadingDeg(g.attackHeadingDeg), trackingTimeTenths: true });
  const hasDelta = Boolean(deltaTime && Number.isFinite(deltaTime.seconds));
  const deltaRow = hasDelta
    ? [{ label: `ΔTime #${deltaTime.impactNumber} Impact − #${deltaTime.releaseNumber} Release`, value: `${formatSec(deltaTime.seconds)} s` }]
    : [];
  // Roll-in Lead Angle is drawn under Roll-in Angle Off (0.1.9), so it leaves the lower block.
  const left = [
    { label: "Action Range", value: `${formatNm(g.actionRangeNm)} NM` },
    { label: "Offset Angle", value: `${formatDeg(g.offsetAngleDeg)}°` },
    { label: "Approaching Range", value: `${formatNm(result.resolved.approachRangeNm)} NM` },
    ...bdp.left.filter((row) => row.label !== "Roll-in Lead Angle"),
  ];
  const bankRow = Number.isFinite(p.rollInBankAngleDeg) ? [{ label: "Roll-in Bank Angle", value: `${formatDeg(p.rollInBankAngleDeg)}°` }] : [];
  const trackingRow = bdp.right.filter((row) => row.label === "Tracking Time");
  if (!advanced) {
    return { left: OFFSET_Z_ESSENTIAL_ROWS.map((label) => left.find((row) => row.label === label)).filter(Boolean), right: [...bankRow, ...trackingRow, ...deltaRow] };
  }
  const ipImpact = hasDelta && Number.isFinite(deltaTime.impactIpToImpactSec)
    ? { number: deltaTime.impactNumber, seconds: deltaTime.impactIpToImpactSec }
    : { number: aircraftNumber, seconds: t.offsetIpToReleaseSec + p.bombTofSec };
  const right = [
    { label: "IP-Target Heading", value: formatHeadingDeg(bearingDeg(g.points.ip, g.points.target)) },
    { label: "Approaching Heading", value: formatHeadingDeg(g.offsetHeadingDeg) },
    ...bankRow,
    ...bdp.right,
    { label: `#${ipImpact.number} IP to Impact Time`, value: `${formatSec(ipImpact.seconds)} s` },
    ...deltaRow,
  ];
  return { left, right };
}

export function renderOffsetZDiagram(svg, result, options = {}) {
  const aircraftNumber = options.aircraftNumber ?? 1;
  svg.setAttribute("aria-label", offsetZDiagramTitle({ aircraftNumber }));
  const root = zRoot(svg);
  const data = buildBdpZDiagramData(result.profile);
  const title = offsetProfileTitle(result, { aircraftNumber });
  if (!data.supported) {
    svg.setAttribute("viewBox", "0 0 650 220");
    svg.style.aspectRatio = "650 / 220";
    root.replaceChildren();
    for (const [y, message] of [[80, title], [135, "Dive angle below 10° · Z-Diagram unavailable"]]) {
      root.append(svgNode("text", { x: 325, y, "text-anchor": "middle", "font-size": 20, fill: "#14202c" }, message));
    }
    return false;
  }
  renderCommonZDiagram(svg, {
    ...data,
    uniformBodyText: true,
    compactAngleLabels: true,
    rollInAltitudeX: 34,
    rollInLeadInGroup: true,
    profileTitle: title,
    lowerColumns: offsetZLowerColumns(result, { deltaTime: options.deltaTime, advanced: options.advanced === true, aircraftNumber }),
  });
  return true;
}
