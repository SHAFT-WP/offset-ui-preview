// Attack-frame overlay of the pattern Top Views (BOX, Wheel, Wheel-BOX; owner 2026-11-12). Those views draw the
// pattern with the Attack Heading up and +x to its right (a true map turned by the Attack Heading). Two things are
// drawn on top, never added to the fit (they do not resize the pattern):
// - the Run-In (owner: "dtc 로드해서 run-in heading 정하는 것은 box, wheel에도" — answer: a Run-In field and its line,
//   the pattern unchanged): the IP → Target line at the Run-In heading, dashed with an arrow into the Target, from the
//   IP (a hollow square) when it is on the canvas, else from the canvas edge; its label gives the Run-In, the IP range
//   and how far it is off the Attack Heading;
// - the BMS TGP north mark (Common svg-north-mark), top right, turned to north (−Attack Heading).
// Headings are the page's (MAG, as the Attack Heading is). Pure geometry in attackFrameRunIn; the rest only draws.
import { svgNode } from "../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { appendNorthMark } from "../../../common/diagram/svg-north-mark-v0.1.mjs?v=0.1.0";
import { formatNm } from "../../../common/ui/display-precision-v0.1.mjs";

export const ATTACK_FRAME_OVERLAY_V0_1 = Object.freeze({ id: "attack-frame-overlay-v0.1", version: "0.1.0" });

const RUN_IN_COLOR = "#067a3a";
const norm360 = (deg) => ((deg % 360) + 360) % 360;
const signed180 = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;
const headingText = (deg) => String(Math.round(norm360(deg)) % 360).padStart(3, "0");

// The Run-In in the drawing frame (x right of the Attack Heading, y along it, NM; Target at 0,0). Null without a
// finite Run-In. unit: the direction flown (IP → Target); ip: the IP point when ipRangeNm > 0, else null.
// offAttackDeg: Run-In − Attack Heading, −180…180 (+ = the Run-In is clockwise of the Attack Heading).
export function attackFrameRunIn({ attackHeadingDeg, runInHeadingDeg, ipRangeNm = null }) {
  if (!Number.isFinite(attackHeadingDeg) || !Number.isFinite(runInHeadingDeg)) return null;
  const offAttackDeg = signed180(runInHeadingDeg - attackHeadingDeg);
  const rad = (offAttackDeg * Math.PI) / 180;
  const unit = { x: Math.sin(rad), y: Math.cos(rad) };
  const range = Number.isFinite(ipRangeNm) && ipRangeNm > 0 ? ipRangeNm : null;
  return {
    headingDeg: norm360(runInHeadingDeg),
    offAttackDeg,
    unit,
    ipRangeNm: range,
    ip: range ? { x: -unit.x * range, y: -unit.y * range } : null,
  };
}

// Where the ray from `from` along `dir` (screen) leaves the canvas inset by `pad`.
function canvasExit(from, dir, width, height, pad) {
  let t = Infinity;
  if (dir.x > 1e-9) t = Math.min(t, (width - pad - from.x) / dir.x);
  if (dir.x < -1e-9) t = Math.min(t, (pad - from.x) / dir.x);
  if (dir.y > 1e-9) t = Math.min(t, (height - pad - from.y) / dir.y);
  if (dir.y < -1e-9) t = Math.min(t, (pad - from.y) / dir.y);
  return Number.isFinite(t) && t > 0 ? { x: from.x + dir.x * t, y: from.y + dir.y * t } : from;
}

// root: the view's group; project: drawing frame (NM) → screen; width / height: the canvas; labels: the view's smart
// label layout (reserve); label: the view's label function (point, text, options); runIn: { headingDeg, ipRangeNm }
// (or null); markerId: an arrow marker in the view's defs for the line end. Returns { runIn, northRect, placeLabel }:
// the view calls placeLabel() after its own labels, so the Run-In label takes a free place.
export function appendAttackFrameOverlay(root, { project, width, height, attackHeadingDeg, runIn = null, textScale = 1, labels = null, label = null, markerId = null }) {
  // North mark: top right, turned to north (the drawing's up is the Attack Heading).
  const size = 15 * textScale * 1.6;
  const reach = size * 1.05 + Math.max(1.6, size * 0.075) * 2;
  const north = appendNorthMark(root, {
    cx: width - 18 - reach, cy: 14 + reach, size, rotationDeg: -(Number(attackHeadingDeg) || 0),
    attributes: { "data-top-view-role": "north-arrow" },
  });
  labels?.reserveRect(north.rect);

  const line = runIn ? attackFrameRunIn({ attackHeadingDeg, runInHeadingDeg: runIn.headingDeg, ipRangeNm: runIn.ipRangeNm }) : null;
  if (!line) return { runIn: null, northRect: north.rect, placeLabel: () => {} };
  const target = project({ x: 0, y: 0 });
  const ahead = project(line.unit);
  const length = Math.hypot(ahead.x - target.x, ahead.y - target.y) || 1;
  const back = { x: (target.x - ahead.x) / length, y: (target.y - ahead.y) / length };
  const pad = 14;
  const ipScreen = line.ip ? project(line.ip) : null;
  const ipShown = ipScreen && ipScreen.x >= pad && ipScreen.x <= width - pad && ipScreen.y >= pad && ipScreen.y <= height - pad;
  const start = ipShown ? ipScreen : canvasExit(target, back, width, height, pad);
  const gap = 12;
  const end = { x: target.x + back.x * gap, y: target.y + back.y * gap };
  root.append(svgNode("line", {
    x1: start.x, y1: start.y, x2: end.x, y2: end.y, stroke: RUN_IN_COLOR, "stroke-width": 2.2, "stroke-dasharray": "10 6",
    "stroke-linecap": "round", ...(markerId ? { "marker-end": `url(#${markerId})` } : {}), "data-top-view-role": "run-in",
  }));
  if (ipShown) {
    const half = 7;
    root.append(svgNode("rect", {
      x: ipScreen.x - half, y: ipScreen.y - half, width: half * 2, height: half * 2, fill: "none", stroke: RUN_IN_COLOR,
      "stroke-width": 2.4, "data-top-view-role": "run-in-ip",
    }));
    root.append(svgNode("rect", {
      x: ipScreen.x - half - 1.6, y: ipScreen.y - half - 1.6, width: half * 2 + 3.2, height: half * 2 + 3.2, fill: "none", stroke: "#ffffff",
      "stroke-width": 1, "data-top-view-role": "run-in-ip-outline",
    }));
  }
  labels?.reserveSegment?.(start, end, 4);
  const off = Math.round(Math.abs(line.offAttackDeg));
  const side = off === 0 || off === 180 ? "" : line.offAttackDeg > 0 ? " R" : " L";
  const text = `Run-In ${headingText(line.headingDeg)}°`;
  const detail = `${line.ipRangeNm ? `IP ${formatNm(line.ipRangeNm)} NM · ` : ""}${off}°${side} of Attack`;
  // The label sits at the line's outer end (the IP, or where the line enters the canvas), pulled in toward the Target.
  const anchor = { x: start.x - back.x * 26, y: start.y - back.y * 26 };
  const placeLabel = () => {
    if (typeof label === "function") {
      label(anchor, text, { labelKey: "run-in", color: RUN_IN_COLOR, fontSize: 12 * textScale, detail, detailFontSize: 11 * textScale });
    } else {
      root.append(svgNode("text", { x: anchor.x, y: anchor.y, fill: RUN_IN_COLOR, "font-size": 12 * textScale, "font-weight": 800, "data-top-view-role": "run-in-label" }, `${text} · ${detail}`));
    }
  };
  return { runIn: line, northRect: north.rect, placeLabel };
}
