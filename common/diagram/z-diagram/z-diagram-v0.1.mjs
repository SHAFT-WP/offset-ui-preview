import { installSmartLabelDrag } from "../svg-smart-label-v0.1.mjs?v=0.1.5";

const NS = "http://www.w3.org/2000/svg";
export const FT_PER_NM = 6076.11549;

// Common Z items for every host (common/diagram/z-diagram/README.md "Common Z items"):
// 0.1.7 (2026-09-29): white text halo; Initial Speed as its value only, inside the top line's span;
// compact Dive Angle / IAA as one "45°/4°" label at the upper vertex; every text but the title is a
// movable label (0.5 s long-press, Common smart-label drag installed once per svg).
export const COMMON_Z_DIAGRAM_V0_1 = Object.freeze({
  id: "common-z-diagram-v0.1",
  version: "0.1.7",
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

// Movable label: a transparent grab area fitted to the text (estimate until the svg is laid out).
function movableLabel(root, key, textNode, { x, y, anchor, size, content }) {
  const group = node("g", { "data-movable-label": "true", "data-label-key": key, style: "cursor:grab;touch-action:none" });
  const width = Math.max(24, String(content).length * size * 0.62);
  const left = anchor === "end" ? x - width : anchor === "middle" ? x - width / 2 : x;
  const hit = node("rect", { x: left - 4, y: y - size - 2, width: width + 8, height: size * 1.35 + 4, fill: "transparent", "pointer-events": "all", "data-label-hit": "true" });
  textNode.setAttribute("pointer-events", "none");
  group.append(hit, textNode);
  root.appendChild(group);
  try {
    const box = textNode.getBBox();
    if (box.width > 0 && box.height > 0) {
      hit.setAttribute("x", String(box.x - 4));
      hit.setAttribute("y", String(box.y - 4));
      hit.setAttribute("width", String(box.width + 8));
      hit.setAttribute("height", String(box.height + 8));
    }
  } catch (_) {
    // Not laid out (detached or hidden); keep the estimate.
  }
  return textNode;
}

export function renderCommonZDiagram(svg, data) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  const extraRows = Array.isArray(data.extraRows) ? data.extraRows.filter((row) => row?.label && row.value !== undefined) : [];
  const footerRows = Array.isArray(data.footerRows) ? data.footerRows : null;
  const viewHeight = 620 + (footerRows ? Math.max(0, footerRows.length - 4) : extraRows.length) * 30;
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
  // before ":") so a moved label stays moved when its value changes. `value` may be a list of strings
  // and tspans.
  const text = (x, y, value, anchor = "start", size = BODY_FS, weight = FONT_WEIGHT, key = labelKey(String(value).split(":")[0])) => {
    const fontSize = data.uniformBodyText && size !== TITLE_FS ? 15 : size;
    const textNode = node("text", { x, y, fill: ink, "font-size": fontSize, "font-weight": weight, "text-anchor": anchor, ...HALO }, Array.isArray(value) ? undefined : value);
    if (Array.isArray(value)) textNode.append(...value);
    if (!key) { root.appendChild(textNode); return textNode; }
    return movableLabel(root, key, textNode, { x, y, anchor, size: fontSize, content: textNode.textContent });
  };
  const diagX = (y) => left + ((baseY - y) / (baseY - topY)) * (topX - left);

  const diagramTitle = commonZDiagramTitle(data.profileTitle || "", data.beTitle || "");
  text(325, data.uniformBodyText ? 36 : 28, diagramTitle, "middle", TITLE_FS, FONT_WEIGHT, null);
  // Initial Speed: the value only, above the top line and never past its right end (topX). With the
  // altitude on the left it is right-aligned to that end.
  const speed = text(data.altitudeOnLeft ? topX : 42, 82, `${format(data.initialKcas, 0)} KCAS`, data.altitudeOnLeft ? "end" : "start", 15, FONT_WEIGHT, "z-initial-speed");
  speed.setAttribute("aria-label", lineText("Initial Speed", `${format(data.initialKcas, 0)} KCAS`));
  text(data.altitudeOnLeft ? 42 : 608, 82, data.initialAltitudeText ?? lineText("Initial Altitude", `${format(data.initialMsl, 0)} ft`), data.altitudeOnLeft ? "start" : "end", 15, FONT_WEIGHT, "z-initial-altitude");
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
    const angles = text(240, topY + 38, [
      node("tspan", { "aria-label": diveLabel }, formatCommonDegree(data.diveAngle, 0)),
      "/",
      node("tspan", { "aria-label": iaaLabel }, formatCommonDegree(data.aimOffAngle, 0)),
    ], "start", 15, FONT_WEIGHT, "z-dive-iaa");
    angles.setAttribute("aria-label", `${diveLabel} / ${iaaLabel}`);
  } else {
    text(200, topY + 38, lineText("Dive Angle", formatCommonDegree(data.diveAngle, 0)), "start", 15);
  }
  text(360, 132, lineText(labels.rollInPoint, `${format(rollInNm, 1)} NM (Ground)`), "start", 15, FONT_WEIGHT, "z-roll-in-ground");
  text(360, 158, lineText(labels.rollInPoint, `${format(slantNm, 1)} NM (Slant)`), "start", 15, FONT_WEIGHT, "z-roll-in-slant");
  text(360, 184, lineText(labels.groundRange, `${format(groundNm, 1)} NM`), "start", 15);
  line(plannedX - 100, plannedY, 330, plannedY, 3);
  text(350, plannedY + 6, lineText(labels.releaseAltitude, `${format(data.releaseMsl, 0)} ft`), "start", 15);
  text(74, plannedY + 72, lineText("Release Speed", `${format(data.releaseKcas, 0)} KCAS`));
  line(nltX - 76, nltY, nltX + 130, nltY, 3);
  text(320, nltY + 6, lineText("NLT Release", `${format(data.nltMsl, 0)} ft`), "start", 15);
  text(260, baseY - 16, lineText("MINALT", `${format(data.minAltMsl, 0)} ft`), "end");

  let y = 518;
  const done = () => {
    if (!labelDrags.has(svg)) labelDrags.set(svg, installSmartLabelDrag(svg));
    labelDrags.get(svg).applyStoredPositions();
    return diagramTitle;
  };
  if (footerRows) {
    footerRows.forEach((row) => {
      const label = String(row.label).replace(/:\s*$/, "");
      text(42, y, lineText(label, String(row.value)));
      y += 30;
    });
    return done();
  }
  if (!data.compactAngleLabels) {
    text(42, y, lineText(labels.aimOffAngle, formatCommonDegree(data.aimOffAngle, 0)));
    y += 30;
  }
  text(42, y, lineText(labels.rollInLead, formatCommonDegree(data.rollInLead, 0)));
  y += 30;
  extraRows.forEach((row) => {
    text(42, y, lineText(String(row.label).replace(/:\s*$/, ""), String(row.value)));
    y += 30;
  });
  text(42, y, lineText("Tracking Time", formatCommonSeconds(data.trackingTime, 0)));
  y += 30;
  text(42, y, lineText("Roll-in to Impact Time", formatCommonSeconds(data.rollInToImpactTime, 0)));
  return done();
}
