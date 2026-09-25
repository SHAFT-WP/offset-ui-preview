const NS = "http://www.w3.org/2000/svg";
export const FT_PER_NM = 6076.11549;

export const COMMON_Z_DIAGRAM_V0_1 = Object.freeze({
  id: "common-z-diagram-v0.1",
  version: "0.1.6",
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
  const text = (x, y, value, anchor = "start", size = BODY_FS, weight = FONT_WEIGHT) => add("text", { x, y, fill: ink, "font-size": data.uniformBodyText && size !== TITLE_FS ? 15 : size, "font-weight": weight, "text-anchor": anchor }, value);
  const diagX = (y) => left + ((baseY - y) / (baseY - topY)) * (topX - left);

  const diagramTitle = commonZDiagramTitle(data.profileTitle || "", data.beTitle || "");
  text(325, data.uniformBodyText ? 36 : 28, diagramTitle, "middle", TITLE_FS);
  text(data.altitudeOnLeft ? 608 : 42, 82, lineText("Initial Speed", `${format(data.initialKcas, 0)} KCAS`), data.altitudeOnLeft ? "end" : "start", 15);
  text(data.altitudeOnLeft ? 42 : 608, 82, data.initialAltitudeText ?? lineText("Initial Altitude", `${format(data.initialMsl, 0)} ft`), data.altitudeOnLeft ? "start" : "end", 15);
  const rollInNm = (Number(data.rollInRangeFt) || 0) / FT_PER_NM;
  const slantNm = (Number(data.slantFt) || 0) / FT_PER_NM;
  const groundNm = (Number(data.groundFt) || 0) / FT_PER_NM;

  const plannedY = 224, nltY = 332;
  const plannedX = diagX(plannedY), nltX = diagX(nltY);
  line(50, 98, topX, 98, 3.5);
  line(left, baseY, topX, topY, 3.5);
  line(left, baseY, topX, baseY, 3.5);
  const diveText = text(data.compactAngleLabels ? 240 : 200, topY + 38, data.compactAngleLabels ? formatCommonDegree(data.diveAngle, 0) : lineText("Dive Angle", formatCommonDegree(data.diveAngle, 0)), "start", 15);
  if (data.compactAngleLabels) {
    diveText.setAttribute("aria-label", lineText("Dive Angle", formatCommonDegree(data.diveAngle, 0)));
    const iaaText = text(125, 400, formatCommonDegree(data.aimOffAngle, 0));
    iaaText.setAttribute("aria-label", lineText(labels.aimOffAngle, formatCommonDegree(data.aimOffAngle, 0)));
  }
  text(360, 132, lineText(labels.rollInPoint, `${format(rollInNm, 1)} NM (Ground)`), "start", 15);
  text(360, 158, lineText(labels.rollInPoint, `${format(slantNm, 1)} NM (Slant)`), "start", 15);
  text(360, 184, lineText(labels.groundRange, `${format(groundNm, 1)} NM`), "start", 15);
  line(plannedX - 100, plannedY, 330, plannedY, 3);
  text(350, plannedY + 6, lineText(labels.releaseAltitude, `${format(data.releaseMsl, 0)} ft`), "start", 15);
  text(74, plannedY + 72, lineText("Release Speed", `${format(data.releaseKcas, 0)} KCAS`));
  line(nltX - 76, nltY, nltX + 130, nltY, 3);
  text(320, nltY + 6, lineText("NLT Release", `${format(data.nltMsl, 0)} ft`), "start", 15);
  text(260, baseY - 16, lineText("MINALT", `${format(data.minAltMsl, 0)} ft`), "end");

  let y = 518;
  if (footerRows) {
    footerRows.forEach((row) => {
      text(42, y, lineText(String(row.label).replace(/:\s*$/, ""), String(row.value)));
      y += 30;
    });
    return diagramTitle;
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
  return diagramTitle;
}
