import { installSmartLabelDrag } from "../svg-smart-label-v0.1.mjs?v=0.1.5";

const NS = "http://www.w3.org/2000/svg";
export const FT_PER_NM = 6076.11549;

// Common Z items for every host (common/diagram/z-diagram/README.md "Common Z items"):
// 0.1.7 (2026-09-29): white text halo; Initial Speed as its value only, inside the top line's span;
// compact Dive Angle / IAA as one "45°/4°" label at the upper vertex; every text but the title is a
// movable label (0.5 s long-press, Common smart-label drag installed once per svg).
// 0.1.8 (2026-10-01): one top row for every host — altitude value only at the left (accessible name
// "Roll-in Altitude"), speed right-aligned to the top line's end; `altitudeOnLeft` and
// `initialAltitudeText` removed. The BDP rows always draw; `footerRows` follow them. Clustered texts
// move as one label: z-group-roll-in (Roll-in Point Ground / Slant, MAP) and z-group-footer (the
// whole lower block).
// 0.1.9 (2026-10-01): Dive/IAA 27 units (3 characters) right and 16 up (one line, kept clear of
// the top line); the Roll-in group one row up;
// NLT Release sits as far from its line as Release Altitude does; the lower block starts one row
// higher and a host may give it as two columns (`lowerColumns: { left, right }`).
export const COMMON_Z_DIAGRAM_V0_1 = Object.freeze({
  id: "common-z-diagram-v0.1",
  version: "0.1.9",
  oracle: "Bomb Profile REV.1.9 embedded BE Common Rev0.8 display renderer",
  legacyDisplaySource: "Common Z-Diagram Rev0.6 / BE Common Rev0.8 display grammar",
});

function node(name, attrs = {}, content) {
  const element = document.createElementNS(NS, name);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") element.setAttribute(key, String(value));
  });
  if (content !== undefined) element.textContent = content;
  return element;
}

function format(value, digits = 0) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "-";
}

function lineText(label, value) {
  return `${label}: ${value}`;
}

export function formatCommonDegree(value, digits = 0) {
  return `${format(value, digits)}°`;
}

export function formatCommonSeconds(value, digits = 0) {
  return `${format(value, digits)} s`;
}

export function commonZDiagramTitle(profileTitle, beTitle = "") {
  return beTitle ? `${profileTitle} · ${beTitle}` : profileTitle;
}

const HALO = Object.freeze({ stroke: "#ffffff", "stroke-width": 4, "paint-order": "stroke", "stroke-linejoin": "round" });
const labelDrags = new WeakMap();
const labelKey = (value) => `z-${String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

// Text box estimate used until the svg is laid out.
function estimateBox({ x, y, anchor, size, content }) {
  const width = Math.max(24, String(content).length * size * 0.62);
  const left = anchor === "end" ? x - width : anchor === "middle" ? x - width / 2 : x;
  return { x: left, y: y - size - 2, width, height: size * 1.35 + 4 };
}

// Movable label group: one transparent grab area over all its texts, so a cluster moves as a set
// (smart-label drag translates the whole group). Fitted to the laid-out bbox when available.
function movableGroup(root, key) {
  const group = node("g", { "data-movable-label": "true", "data-label-key": key, style: "cursor:grab;touch-action:none" });
  const hit = node("rect", { fill: "transparent", "pointer-events": "all", "data-label-hit": "true" });
  group.append(hit);
  root.appendChild(group);
  const estimates = [];
  const add = (textNode, estimate) => {
    textNode.setAttribute("pointer-events", "none");
    group.append(textNode);
    estimates.push(estimate);
    let box = null;
    try {
      const measured = [...group.querySelectorAll("text")].map((item) => item.getBBox()).filter((item) => item.width > 0 && item.height > 0);
      if (measured.length === estimates.length) box = measured.reduce(unionBox);
    } catch (_) {
      // Not laid out (detached or hidden); keep the estimate.
    }
    const fitted = box ? { x: box.x - 4, y: box.y - 4, width: box.width + 8, height: box.height + 8 } : estimates.map((item) => ({ x: item.x - 4, y: item.y, width: item.width + 8, height: item.height })).reduce(unionBox);
    Object.entries(fitted).forEach(([name, value]) => hit.setAttribute(name, String(value)));
    return textNode;
  };
  return { add };
}

function unionBox(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

export function renderCommonZDiagram(svg, data) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  const extraRows = Array.isArray(data.extraRows) ? data.extraRows.filter((row) => row?.label && row.value !== undefined) : [];
  // Host rows drawn after the BDP rows (Offset since 0.1.8; they no longer replace them).
  const footerRows = Array.isArray(data.footerRows) ? data.footerRows.filter((row) => row?.label && row.value !== undefined) : [];
  // Two-column lower block (0.1.9): the host owns both lists; without it the single BDP column draws.
  const validRows = (rows) => (Array.isArray(rows) ? rows.filter((row) => row?.label && row.value !== undefined) : []);
  const columns = data.lowerColumns ? { left: validRows(data.lowerColumns.left), right: validRows(data.lowerColumns.right) } : null;
  const singleRowCount = (data.compactAngleLabels ? 0 : 1) + 3 + extraRows.length + footerRows.length;
  const lowerRowCount = columns ? Math.max(columns.left.length, columns.right.length, 1) : singleRowCount;
  // Lower block from y 488 (one row above 0.1.8's 518), 30 per row, 42 below the last baseline.
  const viewHeight = Math.max(590, 500 + lowerRowCount * 30);
  svg.setAttribute("viewBox", `0 0 650 ${viewHeight}`);
  svg.style.aspectRatio = `650 / ${viewHeight}`;
  const root = svg.querySelector("[data-z-root]") || svg.querySelector("g") || svg;
  if (root !== svg) root.replaceChildren();
  else while (svg.firstChild) svg.removeChild(svg.firstChild);

  const labels = data.labels;
  if (!labels) throw new TypeError("Z diagram labels must be supplied by the domain adapter");
  const ink = "#111111";
  const left = 50, topX = 340, topY = 98, baseY = 442;
  const TITLE_FS = 27, BODY_FS = 18, FONT_WEIGHT = 900;
  const add = (name, attrs, content) => { const n = node(name, attrs, content); root.appendChild(n); return n; };
  const line = (x1, y1, x2, y2, width = 3) => add("line", { x1, y1, x2, y2, stroke: ink, "stroke-width": width, "stroke-linecap": "square" });
  // Every text carries the white halo; a keyed text is a movable label, keyed by its name (the part
  // before ":") so a moved label stays moved when its value changes. A text passed a `group` joins
  // that cluster's single movable label instead. `value` may be a list of strings and tspans.
  const groups = new Map();
  const text = (x, y, value, anchor = "start", size = BODY_FS, weight = FONT_WEIGHT, key = labelKey(String(value).split(":")[0]), group = null) => {
    const fontSize = data.uniformBodyText && size !== TITLE_FS ? 15 : size;
    const textNode = node("text", { x, y, fill: ink, "font-size": fontSize, "font-weight": weight, "text-anchor": anchor, ...HALO }, Array.isArray(value) ? undefined : value);
    if (Array.isArray(value)) textNode.append(...value);
    if (!key && !group) { root.appendChild(textNode); return textNode; }
    const groupKey = group ?? key;
    if (!groups.has(groupKey)) groups.set(groupKey, movableGroup(root, groupKey));
    return groups.get(groupKey).add(textNode, estimateBox({ x, y, anchor, size: fontSize, content: textNode.textContent }));
  };
  const diagX = (y) => left + ((baseY - y) / (baseY - topY)) * (topX - left);

  const diagramTitle = commonZDiagramTitle(data.profileTitle || "", data.beTitle || "");
  text(325, data.uniformBodyText ? 36 : 28, diagramTitle, "middle", TITLE_FS, FONT_WEIGHT, null);
  // Top row (0.1.8, every host): the Roll-in Altitude value only at the left margin and the Initial
  // Speed value right-aligned to the top line's end (topX); names live in the aria-labels.
  const altitude = text(42, 82, `${format(data.initialMsl, 0)} ft`, "start", 15, FONT_WEIGHT, "z-roll-in-altitude");
  altitude.setAttribute("aria-label", lineText("Roll-in Altitude", `${format(data.initialMsl, 0)} ft`));
  const speed = text(topX, 82, `${format(data.initialKcas, 0)} KCAS`, "end", 15, FONT_WEIGHT, "z-initial-speed");
  speed.setAttribute("aria-label", lineText("Initial Speed", `${format(data.initialKcas, 0)} KCAS`));
  const rollInNm = (Number(data.rollInRangeFt) || 0) / FT_PER_NM;
  const slantNm = (Number(data.slantFt) || 0) / FT_PER_NM;
  const groundNm = (Number(data.groundFt) || 0) / FT_PER_NM;

  const plannedY = 224, nltY = 332;
  const plannedX = diagX(plannedY), nltX = diagX(nltY);
  line(50, 98, topX, 98, 3.5);
  line(left, baseY, topX, topY, 3.5);
  line(left, baseY, topX, baseY, 3.5);
  if (data.compactAngleLabels) {
    // Dive Angle / IAA at the upper vertex, e.g. "45°/4°"; each part keeps its own aria-label.
    const diveLabel = lineText("Dive Angle", formatCommonDegree(data.diveAngle, 0));
    const iaaLabel = lineText(labels.aimOffAngle, formatCommonDegree(data.aimOffAngle, 0));
    const angles = text(267, topY + 22, [
      node("tspan", { "aria-label": diveLabel }, formatCommonDegree(data.diveAngle, 0)),
      "/",
      node("tspan", { "aria-label": iaaLabel }, formatCommonDegree(data.aimOffAngle, 0)),
    ], "start", 15, FONT_WEIGHT, "z-dive-iaa");
    angles.setAttribute("aria-label", `${diveLabel} / ${iaaLabel}`);
  } else {
    text(227, topY + 22, lineText("Dive Angle", formatCommonDegree(data.diveAngle, 0)), "start", 15);
  }
  // Roll-in Point Ground / Slant and MAP move together (z-group-roll-in).
  text(360, 106, lineText(labels.rollInPoint, `${format(rollInNm, 1)} NM (Ground)`), "start", 15, FONT_WEIGHT, null, "z-group-roll-in");
  text(360, 132, lineText(labels.rollInPoint, `${format(slantNm, 1)} NM (Slant)`), "start", 15, FONT_WEIGHT, null, "z-group-roll-in");
  text(360, 158, lineText(labels.groundRange, `${format(groundNm, 1)} NM`), "start", 15, FONT_WEIGHT, null, "z-group-roll-in");
  // Release Altitude and NLT Release both start LABEL_GAP after their line's right end.
  const LABEL_GAP = 20;
  const plannedEnd = 330, nltEnd = nltX + 130;
  line(plannedX - 100, plannedY, plannedEnd, plannedY, 3);
  text(plannedEnd + LABEL_GAP, plannedY + 6, lineText(labels.releaseAltitude, `${format(data.releaseMsl, 0)} ft`), "start", 15);
  text(74, plannedY + 72, lineText("Release Speed", `${format(data.releaseKcas, 0)} KCAS`));
  line(nltX - 76, nltY, nltEnd, nltY, 3);
  text(nltEnd + LABEL_GAP, nltY + 6, lineText("NLT Release", `${format(data.nltMsl, 0)} ft`), "start", 15);
  text(260, baseY - 16, lineText("MINALT", `${format(data.minAltMsl, 0)} ft`), "end");

  // Lower block: the host's two columns (left at the left margin, right from the top line's end),
  // or the single BDP column (the BE's extraRows among its rows, then the host's footerRows); the
  // whole block moves as one label (z-group-footer).
  const LOWER_Y = 488;
  const rowText = (item) => lineText(String(item.label).replace(/:\s*$/, ""), String(item.value));
  if (columns) {
    [[42, columns.left], [topX, columns.right]].forEach(([x, rows]) => rows.forEach((item, index) => {
      text(x, LOWER_Y + index * 30, rowText(item), "start", BODY_FS, FONT_WEIGHT, null, "z-group-footer");
    }));
    if (!labelDrags.has(svg)) labelDrags.set(svg, installSmartLabelDrag(svg));
    labelDrags.get(svg).applyStoredPositions();
    return diagramTitle;
  }
  let y = LOWER_Y;
  const row = (content) => {
    text(42, y, content, "start", BODY_FS, FONT_WEIGHT, null, "z-group-footer");
    y += 30;
  };
  if (!data.compactAngleLabels) row(lineText(labels.aimOffAngle, formatCommonDegree(data.aimOffAngle, 0)));
  row(lineText(labels.rollInLead, formatCommonDegree(data.rollInLead, 0)));
  extraRows.forEach((item) => row(lineText(String(item.label).replace(/:\s*$/, ""), String(item.value))));
  row(lineText("Tracking Time", formatCommonSeconds(data.trackingTime, 0)));
  row(lineText("Roll-in to Impact Time", formatCommonSeconds(data.rollInToImpactTime, 0)));
  footerRows.forEach((item) => row(lineText(String(item.label).replace(/:\s*$/, ""), String(item.value))));

  if (!labelDrags.has(svg)) labelDrags.set(svg, installSmartLabelDrag(svg));
  labelDrags.get(svg).applyStoredPositions();
  return diagramTitle;
}
