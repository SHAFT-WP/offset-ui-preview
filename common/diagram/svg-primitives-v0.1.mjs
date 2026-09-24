export const SVG_DIAGRAM_PRIMITIVES_V0_1 = Object.freeze({
  id: "svg-diagram-primitives-v0.1",
  version: "0.1.3",
  purpose: "Policy-free SVG drawing primitives and normalized visual metrics shared by BE diagram renderers",
});

export const SVG_DIAGRAM_STYLE_V0_1 = Object.freeze({
  font: Object.freeze({
    primaryPx: 14,
    lineTitlePx: 13,
    dimensionTitlePx: 12.5,
    detailPx: 11.5,
    smartLabelPx: 11,
    compactPx: 10,
    majorValuePx: 19,
  }),
  arrow: Object.freeze({
    tactical: Object.freeze({ markerWidth: 14, markerHeight: 14, refX: 12, refY: 7, strokeWidth: 2.7, path: "M2,2 L12,7 L2,12" }),
    leader: Object.freeze({ markerWidth: 6, markerHeight: 6, refX: 5.5, refY: 3, strokeWidth: 1.3, path: "M1,1 L5.5,3 L1,5" }),
  }),
  line: Object.freeze({ directedPx: 1.7, dimensionPx: 1.6, leaderPx: 1 }),
  label: Object.freeze({ haloPx: 3, edgePadPx: 10, labelPadPx: 8, pathPadPx: 6, longPressMs: 500, dragCancelPx: 8 }),
});

export const SVG_DIAGRAM_TEXT_SCALE_V0_1 = Object.freeze({
  mobileMaxWidthPx: 620,
  desktopBaseScale: 1.5,
  mobileBaseScale: 2.0,
  userMinScale: 0.5,
  userMaxScale: 2.0,
  userStepScale: 0.1,
  userDefaultScale: 1.0,
});

export function normalizeDiagramTextUserScale(value) {
  const numeric = Number(value);
  const fallback = SVG_DIAGRAM_TEXT_SCALE_V0_1.userDefaultScale;
  const resolved = Number.isFinite(numeric) ? numeric : fallback;
  return clamp(
    resolved,
    SVG_DIAGRAM_TEXT_SCALE_V0_1.userMinScale,
    SVG_DIAGRAM_TEXT_SCALE_V0_1.userMaxScale,
  );
}

export function resolveDiagramTextBaseScale(viewportWidthPx) {
  const width = Number(viewportWidthPx);
  if (Number.isFinite(width) && width <= SVG_DIAGRAM_TEXT_SCALE_V0_1.mobileMaxWidthPx) {
    return SVG_DIAGRAM_TEXT_SCALE_V0_1.mobileBaseScale;
  }
  return SVG_DIAGRAM_TEXT_SCALE_V0_1.desktopBaseScale;
}

export function resolveDiagramTextPhysicalScale(userScale = 1, viewportWidthPx) {
  return resolveDiagramTextBaseScale(viewportWidthPx) * normalizeDiagramTextUserScale(userScale);
}

export const SVG_NS = "http://www.w3.org/2000/svg";

export function svgNode(name, attrs = {}, text) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null && value !== "") element.setAttribute(key, String(value));
  }
  if (text !== undefined) element.textContent = text;
  return element;
}

export function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

export function trimSegment(from, to, fromGap = 0, toGap = 0) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(0.001, Math.hypot(dx, dy));
  return {
    from: { x: from.x + (dx / length) * fromGap, y: from.y + (dy / length) * fromGap },
    to: { x: to.x - (dx / length) * toGap, y: to.y - (dy / length) * toGap },
  };
}


// Opt-in presentation clipping. Node centers and model geometry are never moved.
// Radii include the node outline and a clearance for the arrow-tip half-stroke.
export function trimPolylineAtNodes(points, startRadius = 0, endRadius = 0) {
  if (!Array.isArray(points) || points.length < 2 ||
      points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return [];
  let output = points.map(p => ({ x: p.x, y: p.y }));
  const startCenter = output[0];
  const endCenter = output[output.length - 1];
  function clipFromStart(list, center, radius) {
    if (!(radius > 0)) return list;
    const outside = list.findIndex(p => Math.hypot(p.x - center.x, p.y - center.y) > radius);
    if (outside < 0) return [];
    if (outside === 0) return list;
    const a = list[outside - 1], b = list[outside];
    const dx = b.x - a.x, dy = b.y - a.y;
    const ax = a.x - center.x, ay = a.y - center.y;
    const qa = dx * dx + dy * dy;
    const qb = 2 * (ax * dx + ay * dy);
    const qc = ax * ax + ay * ay - radius * radius;
    const t = clamp((-qb + Math.sqrt(Math.max(0, qb * qb - 4 * qa * qc))) / (2 * qa), 0, 1);
    return [{ x: a.x + t * dx, y: a.y + t * dy }, ...list.slice(outside)];
  }
  output = clipFromStart(output, startCenter, Math.max(0, startRadius));
  output = clipFromStart(output.slice().reverse(), endCenter, Math.max(0, endRadius)).reverse();
  return output.length > 1 ? output : [];
}

export function createOpenArrowMarker(id, color, options = {}) {
  const standard = SVG_DIAGRAM_STYLE_V0_1.arrow.tactical;
  const marker = svgNode("marker", {
    id,
    markerWidth: options.markerWidth ?? standard.markerWidth,
    markerHeight: options.markerHeight ?? standard.markerHeight,
    refX: options.refX ?? standard.refX,
    refY: options.refY ?? standard.refY,
    orient: "auto-start-reverse",
    markerUnits: "userSpaceOnUse",
  });
  marker.append(svgNode("path", {
    d: options.path ?? standard.path,
    fill: "none",
    stroke: color,
    "stroke-width": options.strokeWidth ?? standard.strokeWidth,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }));
  return marker;
}

export function appendGrid(root, options = {}) {
  const group = svgNode("g", { class: options.className ?? "diagram-grid" });
  const minX = options.minX ?? 20;
  const maxX = options.maxX ?? 880;
  const minY = options.minY ?? 15;
  const maxY = options.maxY ?? 685;
  const stepX = options.stepX ?? 80;
  const stepY = options.stepY ?? 70;
  for (let x = minX; x <= maxX; x += stepX) group.append(svgNode("line", { x1: x, y1: minY, x2: x, y2: maxY }));
  for (let y = minY; y <= maxY; y += stepY) group.append(svgNode("line", { x1: minX, y1: y, x2: maxX, y2: y }));
  root.append(group);
  return group;
}

export function appendDirectedLine(root, from, to, options = {}) {
  const trimmed = trimSegment(from, to, options.fromGap ?? 0, options.toGap ?? 0);
  const line = svgNode("line", {
    x1: trimmed.from.x,
    y1: trimmed.from.y,
    x2: trimmed.to.x,
    y2: trimmed.to.y,
    stroke: options.color ?? "#14202c",
    "stroke-width": options.width ?? SVG_DIAGRAM_STYLE_V0_1.line.directedPx,
    "stroke-linecap": options.linecap ?? "round",
    "stroke-dasharray": options.dasharray,
    "marker-start": options.markerStartId ? `url(#${options.markerStartId})` : undefined,
    "marker-end": options.markerEndId ? `url(#${options.markerEndId})` : undefined,
    class: options.className,
  });
  root.append(line);
  return line;
}

export function appendText(root, x, y, value, options = {}) {
  const className = [
    options.detail ? "diagram-label-detail" : "diagram-label",
    options.className ?? "",
  ].filter(Boolean).join(" ");
  const text = svgNode("text", {
    x,
    y,
    fill: options.color ?? "#14202c",
    "font-size": options.size ?? SVG_DIAGRAM_STYLE_V0_1.font.primaryPx,
    "font-weight": options.weight ?? (options.detail ? 650 : 850),
    "text-anchor": options.anchor ?? "start",
    class: className || undefined,
  }, value);
  root.append(text);
  return text;
}

export function appendLineLabel(root, from, to, offset, title, detail, options = {}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const midX = (from.x + to.x) / 2 - (dy / length) * offset;
  const midY = (from.y + to.y) / 2 + (dx / length) * offset;
  appendText(root, midX, midY - 4, title, {
    anchor: "middle",
    size: options.titleSize ?? SVG_DIAGRAM_STYLE_V0_1.font.lineTitlePx,
    color: options.color,
    className: options.className,
    weight: options.titleWeight ?? 850,
  });
  if (detail !== undefined && detail !== null && detail !== "") {
    appendText(root, midX, midY + 14, detail, {
      anchor: "middle",
      size: options.detailSize ?? SVG_DIAGRAM_STYLE_V0_1.font.detailPx,
      color: options.color,
      className: options.className,
      detail: true,
      weight: options.detailWeight ?? 650,
    });
  }
  return { x: midX, y: midY };
}

export function appendHorizontalDimension(root, options) {
  const y = options.y;
  appendDirectedLine(root, { x: options.x1, y }, { x: options.x2, y }, {
    color: options.color,
    width: options.width ?? SVG_DIAGRAM_STYLE_V0_1.line.dimensionPx,
    markerStartId: options.markerId,
    markerEndId: options.markerId,
  });
  const tickHalf = options.tickHalf ?? 7;
  [options.x1, options.x2].forEach((x) => root.append(svgNode("line", {
    x1: x, y1: y - tickHalf, x2: x, y2: y + tickHalf,
    stroke: options.color, "stroke-width": options.tickWidth ?? 1.25,
  })));
  const labelX = (options.x1 + options.x2) / 2;
  if (options.title) appendText(root, labelX, y + (options.titleOffsetY ?? -9), options.title, {
    anchor: "middle", size: options.titleSize ?? SVG_DIAGRAM_STYLE_V0_1.font.dimensionTitlePx, color: options.color, weight: options.titleWeight ?? 850,
  });
  if (options.detail) appendText(root, labelX, y + (options.detailOffsetY ?? 14), options.detail, {
    anchor: "middle", size: options.detailSize ?? SVG_DIAGRAM_STYLE_V0_1.font.detailPx, color: options.color, detail: true,
  });
}

export function appendVerticalDimension(root, options) {
  const x = options.x;
  appendDirectedLine(root, { x, y: options.y1 }, { x, y: options.y2 }, {
    color: options.color,
    width: options.width ?? SVG_DIAGRAM_STYLE_V0_1.line.dimensionPx,
    markerStartId: options.markerId,
    markerEndId: options.markerId,
  });
  const tickHalf = options.tickHalf ?? 8;
  [options.y1, options.y2].forEach((y) => root.append(svgNode("line", {
    x1: x - tickHalf, y1: y, x2: x + tickHalf, y2: y,
    stroke: options.color, "stroke-width": options.tickWidth ?? 1.25,
  })));
  const span = Math.abs(options.y2 - options.y1);
  const naturalY = span < 70 ? Math.min(options.y1, options.y2) - 24 : (options.y1 + options.y2) / 2;
  const labelY = options.clampY ? clamp(naturalY, options.clampY[0], options.clampY[1]) : naturalY;
  const labelX = x + (options.labelOffsetX ?? -14);
  const anchor = options.anchor ?? "end";
  if (options.title) appendText(root, labelX, labelY - 5, options.title, {
    anchor, size: options.titleSize ?? SVG_DIAGRAM_STYLE_V0_1.font.dimensionTitlePx, color: options.color, weight: options.titleWeight ?? 850,
  });
  if (options.detail) appendText(root, labelX, labelY + 14, options.detail, {
    anchor, size: options.detailSize ?? SVG_DIAGRAM_STYLE_V0_1.font.detailPx, color: options.color, detail: true,
  });
}

function polar(center, radius, angleRad) {
  return { x: center.x + radius * Math.cos(angleRad), y: center.y + radius * Math.sin(angleRad) };
}

export function appendAngleArc(root, center, radius, startAngleRad, endAngleRad, options = {}) {
  const start = polar(center, radius, startAngleRad);
  const end = polar(center, radius, endAngleRad);
  const delta = endAngleRad - startAngleRad;
  const largeArc = Math.abs(delta) > Math.PI ? 1 : 0;
  const sweep = delta >= 0 ? 1 : 0;
  const path = svgNode("path", {
    d: `M${start.x.toFixed(2)},${start.y.toFixed(2)} A${radius},${radius} 0 ${largeArc} ${sweep} ${end.x.toFixed(2)},${end.y.toFixed(2)}`,
    fill: "none",
    stroke: options.color ?? "#14202c",
    "stroke-width": options.width ?? SVG_DIAGRAM_STYLE_V0_1.line.directedPx,
    "stroke-linecap": "round",
  });
  root.append(path);
  const middleAngle = startAngleRad + delta / 2;
  const labelRadius = radius + (options.labelRadiusOffset ?? 20);
  const labelPoint = polar(center, labelRadius, middleAngle);
  if (options.label) appendText(root, labelPoint.x, labelPoint.y, options.label, {
    anchor: "middle",
    size: options.labelSize ?? SVG_DIAGRAM_STYLE_V0_1.font.detailPx,
    color: options.color,
    weight: options.labelWeight ?? 850,
  });
  return { start, end, labelPoint };
}
