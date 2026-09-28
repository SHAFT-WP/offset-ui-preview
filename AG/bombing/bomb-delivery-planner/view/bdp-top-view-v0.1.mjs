import {
  appendDirectedLine,
  appendGrid,
  appendLineLabel,
  appendText,
  appendVerticalDimension,
  clamp,
  createOpenArrowMarker,
  svgNode,
} from "../../../../common/diagram/svg-primitives-v0.1.mjs";
import { formatDeg, formatFt, formatKt, formatMach, formatNm } from "../../../../common/ui/display-precision-v0.1.mjs";

export const BDP_TOP_VIEW_V0_1 = Object.freeze({
  id: "bdp-top-view-v0.1",
  version: "0.1.2",
  oracle: "Bomb Profile REV.1.9 · R_20260830 Top View",
  baseViewBox: Object.freeze({ width: 900, height: 700 }),
});

export function applyBdpTopViewZoom(svg, zoom = 1) {
  const normalized = clamp(zoom, 0.5, 2);
  const width = 900 / normalized;
  const height = 700 / normalized;
  svg.setAttribute("viewBox", `${450 - width / 2} ${350 - height / 2} ${width} ${height}`);
  return normalized;
}

export function renderBdpTopView(svg, result, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  const semantic = result?.visualization?.semanticState;
  if (!semantic?.stations || !semantic?.paths) throw new TypeError("BDP semantic visualization state is required");
  const root = svg.querySelector("#top-view-root") ?? svg;
  root.replaceChildren();

  const defs = svgNode("defs");
  [
    ["tv-blue", "#2f6fc2"], ["tv-red", "#d64b4b"], ["tv-amber", "#d59400"],
    ["tv-green", "#087b4c"], ["tv-magenta", "#c85ac8"],
  ].forEach(([id, color]) => defs.append(createOpenArrowMarker(id, color)));
  root.append(defs);
  appendGrid(root);

  const station = semantic.stations;
  const rollInStart = { x: station.rollInStart.forwardNm, y: station.rollInStart.turnSideNm };
  const trackPoint = { x: station.trackPoint.forwardNm, y: station.trackPoint.turnSideNm };
  const target = { x: station.target.forwardNm, y: station.target.turnSideNm };
  const aimOff = station.aimOffPoint
    ? { x: station.aimOffPoint.forwardNm, y: station.aimOffPoint.turnSideNm }
    : target;
  const groundRangeNm = result.public.groundRangeNm;
  const ingressStart = { x: rollInStart.x - Math.max(groundRangeNm * 1.5, 1), y: rollInStart.y };

  const focus = [ingressStart, rollInStart, trackPoint, target, aimOff].concat(
    semantic.paths.rollIn.map((p) => ({ x: p.forwardNm, y: p.turnSideNm })),
  );
  const minRawX = Math.min(...focus.map((p) => p.x));
  const maxRawX = Math.max(...focus.map((p) => p.x));
  const minRawY = Math.min(...focus.map((p) => p.y));
  const maxRawY = Math.max(...focus.map((p) => p.y));
  const pad = Math.max(groundRangeNm * 0.14, ((maxRawX - minRawX) + (maxRawY - minRawY)) * 0.045, 0.15);
  const minX = minRawX - pad;
  const maxX = maxRawX + pad;
  const minY = minRawY - pad;
  const maxY = maxRawY + pad;
  const plot = { left: 35, right: 745, top: 35, bottom: 660 };
  const scale = Math.min(
    (plot.right - plot.left) / Math.max(0.001, maxX - minX),
    (plot.bottom - plot.top) / Math.max(0.001, maxY - minY),
  );
  const usedWidth = (maxX - minX) * scale;
  const usedHeight = (maxY - minY) * scale;
  const screenLeft = plot.left + (plot.right - plot.left - usedWidth) / 2;
  const screenTop = plot.top + (plot.bottom - plot.top - usedHeight) / 2;
  const sx = (x) => screenLeft + (x - minX) * scale;
  const sy = (y) => screenTop + (maxY - y) * scale;
  const px = (p) => ({ x: sx(p.x), y: sy(p.y) });

  const startPx = px(rollInStart);
  const trackPx = px(trackPoint);
  const targetPx = px(target);
  const aimOffPx = px(aimOff);
  const ingressPx = px(ingressStart);
  const circleRadius = groundRangeNm * scale;

  const guide = (fromX, toX, y, name) => root.append(svgNode("line", {
    x1: Math.min(fromX, toX), y1: y, x2: Math.max(fromX, toX), y2: y,
    stroke: "#6f98d8", "stroke-width": 1.2, "stroke-dasharray": "5 4", opacity: 0.78,
    class: `top-view-guide top-view-guide-${name}`,
  }));

  // Rev1.9: Ground Range circle is Target-centered and passes Track Point.
  root.append(svgNode("circle", {
    cx: targetPx.x, cy: targetPx.y, r: circleRadius,
    fill: "#f5f8fd", "fill-opacity": 0.68, stroke: "#203a63", "stroke-width": 2.5,
  }));
  guide(startPx.x + 12, 880, startPx.y, "roll-in");
  guide(trackPx.x + 12, 880, trackPx.y, "track-point");
  guide(targetPx.x + 12, 880, targetPx.y, "target");

  appendDirectedLine(root, ingressPx, startPx, { color: "#2f6fc2", width: 3.5, markerEndId: "tv-blue", toGap: 15 });
  appendDirectedLine(root, targetPx, startPx, { color: "#d64b4b", width: 3.2, markerEndId: "tv-red", fromGap: 12, toGap: 15 });
  appendDirectedLine(root, trackPx, targetPx, { color: "#d59400", width: 3.6, markerEndId: "tv-amber", fromGap: 10, toGap: 12 });
  if (Math.hypot(aimOffPx.x - targetPx.x, aimOffPx.y - targetPx.y) > 12) {
    appendDirectedLine(root, targetPx, aimOffPx, { color: "#087b4c", width: 2.6, markerEndId: "tv-green", fromGap: 10, toGap: 12 });
  }

  const rollPath = semantic.paths.rollIn.map((p, index) => `${index ? "L" : "M"}${sx(p.forwardNm).toFixed(1)},${sy(p.turnSideNm).toFixed(1)}`).join(" ");
  root.append(svgNode("path", {
    d: rollPath, fill: "none", stroke: "#c85ac8", "stroke-width": 4.5,
    "stroke-linecap": "round", "stroke-linejoin": "round", "marker-end": "url(#tv-magenta)",
  }));
  root.append(svgNode("circle", { cx: startPx.x, cy: startPx.y, r: 7, fill: "#ffffff", stroke: "#c85ac8", "stroke-width": 3 }));
  root.append(svgNode("circle", { cx: aimOffPx.x, cy: aimOffPx.y, r: 5, fill: "#ffffff", stroke: "#087b4c", "stroke-width": 2 }));
  root.append(svgNode("circle", { cx: targetPx.x, cy: targetPx.y, r: 6, fill: "#d64b4b", stroke: "#ffffff", "stroke-width": 2 }));
  root.append(svgNode("line", { x1: targetPx.x - 10, y1: targetPx.y, x2: targetPx.x + 10, y2: targetPx.y, stroke: "#d64b4b", "stroke-width": 2 }));
  root.append(svgNode("line", { x1: targetPx.x, y1: targetPx.y - 10, x2: targetPx.x, y2: targetPx.y + 10, stroke: "#d64b4b", "stroke-width": 2 }));

  const initialSpeedText = result.canonicalInputs.initialSpeedMode === "MACH"
    ? `Mach ${formatMach(result.canonicalInputs.initialSpeedValue)}`
    : `${formatKt(result.public.resolvedInitialSpeedKcas)} KCAS`;
  appendText(root, 48, 52, "Initial", { anchor: "start", size: 16, color: "#2f6fc2" });
  appendText(root, 48, 76, `${formatFt(result.public.resolvedInitialAltitudeMslFt)} ft MSL · ${initialSpeedText}`, { anchor: "start", size: 13, color: "#203a63" });
  appendText(root, clamp(targetPx.x, 120, 740), clamp(targetPx.y - 30, 34, 660), `Angle-Off ${formatDeg(result.canonicalInputs.angleOffDeg)}°`, {
    anchor: "middle", size: 19, color: "#203a63",
  });
  appendLineLabel(root, targetPx, startPx, 37, "Roll-in Lead Angle", `${formatDeg(result.public.leadAngleDeg)}°`, {
    color: "#d64b4b", className: "lead-angle-halo",
  });
  appendLineLabel(root, trackPx, targetPx, 39, "MAP", `${formatNm(result.public.groundRangeNm)} NM`, {
    color: "#b77d00",
  });
  appendText(root, targetPx.x, targetPx.y + 22, "Target", { anchor: "middle", size: 12, color: "#203a63" });
  appendText(root, startPx.x - 12, startPx.y + 27, "Roll-in", { anchor: "end", size: 11.5, color: "#a443aa" });
  appendText(root, trackPx.x + 12, trackPx.y - 18, "Track Point", { anchor: "start", size: 11.5, color: "#a443aa" });

  const rollInDistanceNm = Math.abs(trackPoint.y - rollInStart.y);
  const rollInRangeNm = Math.abs(target.y - rollInStart.y);
  appendVerticalDimension(root, {
    x: 805,
    y1: trackPx.y,
    y2: startPx.y,
    color: "#2f6fc2",
    markerId: "tv-blue",
    title: "Roll-in Lat. D",
    detail: `${formatNm(rollInDistanceNm)} NM`,
    anchor: "end",
    labelOffsetX: -14,
    clampY: [58, 642],
  });
  appendVerticalDimension(root, {
    x: 865,
    y1: targetPx.y,
    y2: startPx.y,
    color: "#2f6fc2",
    markerId: "tv-blue",
    title: "Roll-in Range",
    detail: `${formatNm(rollInRangeNm)} NM`,
    anchor: "end",
    labelOffsetX: -14,
    clampY: [58, 642],
  });

  const zoom = applyBdpTopViewZoom(svg, options.zoom ?? 1);
  return {
    standardizedDirection: "LEFT_TO_RIGHT",
    groundRangeCircleCenter: "TARGET",
    rollInDistanceNm,
    rollInRangeNm,
    groundRangeNm,
    zoom,
  };
}
