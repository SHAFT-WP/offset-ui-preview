// DED pages (bombing app shared FE since 2026-10-22, from the Offset page; DED grammar 2026-10-02, PNG handoff
// 2026-10-06 §8.3). The display of a BE-owned DED record: per aircraft a reference page box (VRP / VIP …) and an OA1
// box, their text formats, and the PNG drawn from the strings on screen (same formatter, no export rounding). The
// pattern owns the record (reference point, bearings, ranges, elevations) and where the boxes sit; this module only
// shows it. The box styles are still the Offset page's (offset.css, wide-layout.css).
import { formatDeg, formatNm } from "../common/ui/display-precision-v0.1.mjs?v=0.1.1";
import { svgNode } from "../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { saveSvgAsPng } from "../common/diagram/svg-png-export-v0.1.mjs";

export const DED_V0_1 = Object.freeze({ id: "bombing-ded-v0.1", version: "0.1.0" });
// The value outputs of the two boxes; the reference box's title is "reference-title".
export const DED_VALUE_KEYS = Object.freeze(["reference-bearing", "reference-range", "reference-elevation", "oa1-bearing", "oa1-range", "oa1-elevation"]);

export function dedRangeText(page) {
  return `${Math.round(page.rangeFt)} ft (${formatNm(page.rangeNm)} NM)`;
}

export function dedElevationText(elevationFt) {
  return `${Math.round(elevationFt)} ft`;
}

export function dedBearingText(bearingDeg) {
  return `${formatDeg(bearingDeg)}°`;
}

// The two boxes, outputs named by `attribute` ("reference-title", "reference-bearing", …). OA1 reads RNG, TBRG, ELEV
// (user 2026-10-02); the VRP / VIP page keeps TBRG, RNG, ELEV.
export function dedBoxesMarkup(attribute = "data-flight-ded") {
  const rows = (page) => (page === "oa1" ? ["range:RNG", "bearing:TBRG", "elevation:ELEV"] : ["bearing:TBRG", "range:RNG", "elevation:ELEV"]).map((item) => {
    const [key, label] = item.split(":");
    return `<div class="ded-row"><span>${label}</span><output ${attribute}="${page}-${key}">-</output></div>`;
  }).join("");
  return `<div class="ded-boxes"><div class="ded-screen" aria-live="polite"><div class="ded-page-title" ${attribute}="reference-title">VRP</div>${rows("reference")}</div><div class="ded-screen" aria-live="polite"><div class="ded-page-title">OA1</div>${rows("oa1")}</div></div>`;
}

// out(key) gives the output of a key in DED_VALUE_KEYS (a missing one is skipped).
export function writeDedValues(out, ded) {
  const texts = {
    "reference-bearing": dedBearingText(ded.reference.bearingDeg),
    "reference-range": dedRangeText(ded.reference),
    "reference-elevation": dedElevationText(ded.reference.elevationFt),
    "oa1-bearing": dedBearingText(ded.oa1.bearingDeg),
    "oa1-range": dedRangeText(ded.oa1),
    "oa1-elevation": dedElevationText(ded.oa1.elevationFt),
  };
  for (const key of DED_VALUE_KEYS) {
    const node = out(key);
    if (node) node.textContent = texts[key];
  }
}

export function clearDedValues(out) {
  for (const key of DED_VALUE_KEYS) {
    const node = out(key);
    if (node) node.textContent = "-";
  }
}

// One aircraft's DED as shown in its section: { number, mode, boxes: [{ title, rows: [[label, text]] }] }, or null
// when the section is missing or a value is not shown.
export function readDedCard(section, number) {
  if (!section) return null;
  const boxes = [...section.querySelectorAll(".ded-screen")].map((screen) => ({
    title: screen.querySelector(".ded-page-title")?.textContent.trim() ?? "",
    rows: [...screen.querySelectorAll(".ded-row")].map((row) => [row.querySelector("span")?.textContent.trim() ?? "", row.querySelector("output")?.textContent.trim() ?? ""]),
  }));
  if (boxes.length !== 2 || boxes.some((box) => box.rows.some(([, text]) => !text || text === "-"))) return null;
  return { number, mode: boxes[0].title, boxes };
}

// The PNG picture: aircraft after aircraft, "DED #n · mode" in the aircraft's colour (colorOf), then the two boxes.
export function dedExportSvg(cards, { colorOf }) {
  const pad = 20, boxWidth = 330, gap = 16, headerHeight = 38, boxHeight = 150, cardGap = 18;
  const width = pad * 2 + boxWidth * 2 + gap;
  const cardHeight = headerHeight + boxHeight;
  const height = pad * 2 + cards.length * cardHeight + (cards.length - 1) * cardGap;
  const svg = svgNode("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: `0 0 ${width} ${height}`, "data-ded-export": cards.map((card) => card.number).join(",") });
  svg.append(svgNode("rect", { x: 0, y: 0, width, height, fill: "#ffffff" }));
  const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  cards.forEach((card, index) => {
    const top = pad + index * (cardHeight + cardGap);
    svg.append(svgNode("text", { x: pad, y: top + 24, "font-size": 20, "font-weight": 800, "font-family": "system-ui, sans-serif", fill: colorOf(card.number) }, `DED #${card.number} · ${card.mode}`));
    card.boxes.forEach((box, boxIndex) => {
      const x = pad + boxIndex * (boxWidth + gap);
      const y = top + headerHeight;
      svg.append(svgNode("rect", { x, y, width: boxWidth, height: boxHeight, rx: 12, fill: "#07120c", stroke: "#2f6b45", "stroke-width": 1.5 }));
      svg.append(svgNode("text", { x: x + 16, y: y + 30, "font-size": 17, "font-weight": 900, "font-family": mono, fill: "#9ef0af" }, box.title));
      svg.append(svgNode("line", { x1: x + 16, x2: x + boxWidth - 16, y1: y + 42, y2: y + 42, stroke: "#9ef0af", "stroke-opacity": 0.3 }));
      box.rows.forEach(([label, text], rowIndex) => {
        const rowY = y + 72 + rowIndex * 28;
        svg.append(svgNode("text", { x: x + 16, y: rowY, "font-size": 15, "font-family": mono, fill: "#9ef0af" }, label));
        svg.append(svgNode("text", { x: x + 86, y: rowY, "font-size": 15, "font-family": mono, fill: "#9ef0af" }, text));
      });
    });
  });
  return svg;
}

// Saves the cards as one PNG. Returns { filename, svg (markup), done (the save promise) }.
export function saveDedPng(cards, { filename, colorOf }) {
  const svg = dedExportSvg(cards, { colorOf });
  const markup = svg.outerHTML;
  // Attached while exporting so the computed text styles are read (svg-png-export clones them).
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:800px";
  host.append(svg);
  document.body.append(host);
  const done = saveSvgAsPng(svg, filename, { scale: 2, background: "#ffffff" });
  host.remove();
  return { filename, svg: markup, done };
}

// `[data-ded-png]` buttons: "visible" = the shown aircraft, else one aircraft number.
const dedPngAircraft = (key, visibleAircraft) => (key === "visible" ? visibleAircraft() : [Number(key)]);

export function syncDedPngButtons({ visibleAircraft, available, root = document }) {
  root.querySelectorAll("[data-ded-png]").forEach((button) => {
    const numbers = dedPngAircraft(button.dataset.dedPng, visibleAircraft);
    const missing = numbers.filter((number) => !available(number));
    button.disabled = !numbers.length || missing.length > 0;
    button.title = !numbers.length ? "No aircraft shown" : missing.length ? `No current DED for #${missing.join(", #")}` : `Save DED #${numbers.join(", #")} as PNG`;
  });
}

export function installDedPngClicks({ visibleAircraft, exportPng, root = document }) {
  root.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-ded-png]");
    if (!button || button.disabled) return;
    exportPng(dedPngAircraft(button.dataset.dedPng, visibleAircraft));
  });
}
