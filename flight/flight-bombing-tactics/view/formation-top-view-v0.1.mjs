// Flight Formation top view (Flight Bombing Tactics SPEC "Formation top view — owner 2026-11-02").
//
// One picture of the Flight's places, heading up: #1 at the top centre, every follower where the Flight Formation
// module puts it (formationName(...).places, #1's frame: rightNm to #1's right, behindNm behind #1), each drawn as the
// approved F-16 top view (bdp-f16-mesh-v0.1, the owner's display preview v3; vertices and colours unchanged, lit as
// the BDP 3D view lights it). Owner 2026-11-02: "포메이션은 탑뷰로 하면 되", "탑뷰 비행기 크기는 모바일에서 잘보이게
// 확대": the places are to scale (NM grid), the aircraft are not — they are enlarged so they read on a phone.
//
// 0.2.0 (owner 2026-11-03, "포메이션은 기체 센터에 참조선을 구하고 거리와 각도를 표시해줘 각도0도는 적을 필요 없어 …
// 박스는 각도 그릴 필요 없다 / 기체는 제일 위쪽에 위치 선은 아래에 / 기체 크기는 1/3으로 줄여줘"), drawn as the
// owner's formation slides: each reference aircraft gets its abeam (0°) reference line through its centre, each
// follower a solid line from its reference aircraft's centre to its own with the range on it, and the angle from that
// abeam line as an arc with its value — only between 0° and 90° (abeam / in trail need none, as in a Box). The
// aircraft are a third of 0.1.0's size and drawn above every line and label.
//
// Presentation only: no place is computed here. The input is the Flight Formation module's formationName output
// (links and places); this module only scales and draws it. Pure: returns SVG markup, no DOM.
import { BDP_F16_MESH_V0_1 } from "../../../AG/bombing/bomb-delivery-planner/view/bdp-f16-mesh-v0.1.mjs";

export const FORMATION_TOP_VIEW_V0_1 = Object.freeze({
  id: "flight-formation-top-view-v0.1",
  version: "0.2.0",
  status: "work",
  mesh: `${BDP_F16_MESH_V0_1.id} ${BDP_F16_MESH_V0_1.version}`,
  widthUnits: 360,
  // The view keeps at least this much room (NM) around the places, and no more than this height : width.
  minWidthNm: 1.6,
  minHeightNm: 1.2,
  // Drawing height : width kept within these (a long Trail is shown narrower, a long LAB taller, never a strip).
  minAspect: 0.62,
  maxAspect: 1.6,
  // Bands outside the NM drawing (view units): the name / heading above, the scale and the link list below.
  headerUnits: 30,
  footerUnits: 26,
  legendLineUnits: 16,
  gridNm: 0.5,
  // Drawn aircraft length (view units, = CSS px at 360 px wide): 20 % of the closest spacing, within these bounds
  // (0.2.0, owner: a third of 0.1.0's 60 % / 44–84).
  aircraftSpacingShare: 0.2,
  aircraftMinUnits: 15,
  aircraftMaxUnits: 28,
  // The angle arc's radius (view units), and the angles that get no arc (abeam and in trail, owner 0.2.0).
  angleArcUnits: 26,
  angleLabelMinDeg: 0.05,
  angleLabelMaxDeg: 89.95,
});

const DEFAULT_COLORS = Object.freeze({ 1: "#4c5966", 2: "#8a3ab9", 3: "#2f9e6e", 4: "#b5651d" });
const FONT = "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif";
// The bombing pages draw every diagram on white in both themes (common-ui svg rule); so does the PNG.
const INK = "#1f2933";
const MUTED = "#66788a";
const LINE = "#d5dde5";
const PAPER = "#ffffff";
const fmt = (value, digits) => String(Number(value.toFixed(digits)));
// A range as written on the drawing: up to two decimals, at least one ("1.0", "0.5", "1.58").
const rangeText = (nm) => { const v = Number(Number(nm).toFixed(2)); return Number.isInteger(v) ? v.toFixed(1) : String(v); };
const escapeText = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

// ---- the F-16 seen from above (built once) ----------------------------------------------------------------------
// Faces from the lowest to the highest (painter's order), each lit from above with the BDP 3D view's light and shade
// steps (two-sided: a face is lit on its upper side).
const LIGHT = (() => { const v = [-0.25, 0.35, 0.91]; const n = Math.hypot(...v); return v.map((c) => c / n); })();
const F16_TOP_FACES = (() => {
  const faces = BDP_F16_MESH_V0_1.faces.map((face) => {
    const [a, b, c] = face.vertices;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let normal = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const length = Math.hypot(...normal) || 1;
    normal = normal.map((n) => n / length);
    if (normal[2] < 0) normal = normal.map((n) => -n);
    const shade = Math.round((0.72 + 0.35 * Math.max(0, normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2])) * 20) / 20;
    const fill = `rgb(${face.color.map((c) => Math.min(255, Math.round(c * shade))).join(",")})`;
    const meanZ = face.vertices.reduce((sum, v) => sum + v[2], 0) / face.vertices.length;
    // Screen: x right, y down; the nose (mesh +y) points up.
    const points = face.vertices.map(([x, y]) => `${fmt(x, 4)},${fmt(-y, 4)}`).join(" ");
    return { meanZ, fill, points };
  });
  faces.sort((p, q) => p.meanZ - q.meanZ);
  return Object.freeze(faces);
})();

// The F-16 and its outline (the same faces filled and stroked in the ink colour, drawn under it): a thin rim that keeps
// the dark airframe distinct from its coloured disc.
function f16Definition(id) {
  const polygons = F16_TOP_FACES.map((face) => `<polygon points="${face.points}" fill="${face.fill}" stroke="${face.fill}" stroke-width="0.03" stroke-linejoin="round"/>`).join("");
  const outline = F16_TOP_FACES.map((face) => `<polygon points="${face.points}"/>`).join("");
  return `<g id="${id}-outline" style="fill:${INK};stroke:${INK}" stroke-width="0.7" stroke-linejoin="round" opacity="0.5">${outline}</g><g id="${id}">${polygons}</g>`;
}

// ---- layout -----------------------------------------------------------------------------------------------------
function placedAircraft(formation) {
  const places = formation?.places ?? {};
  return Object.entries(places)
    .filter(([, place]) => place && Number.isFinite(place.rightNm) && Number.isFinite(place.behindNm))
    .map(([number, place]) => ({ number: Number(number), x: place.rightNm, y: place.behindNm }))
    .sort((a, b) => a.number - b.number);
}

function closestSpacingNm(aircraft) {
  let closest = Infinity;
  for (let i = 0; i < aircraft.length; i += 1) {
    for (let j = i + 1; j < aircraft.length; j += 1) {
      const d = Math.hypot(aircraft[i].x - aircraft[j].x, aircraft[i].y - aircraft[j].y);
      if (d > 1e-9 && d < closest) closest = d;
    }
  }
  return closest;
}

// The drawing in NM: the places with room for the enlarged aircraft, at least minWidth × minHeight, its height between
// minAspect and maxAspect × its width.
function viewFrame(aircraft) {
  const C = FORMATION_TOP_VIEW_V0_1;
  const xs = aircraft.map((a) => a.x);
  const ys = aircraft.map((a) => a.y);
  let minX = Math.min(0, ...xs), maxX = Math.max(0, ...xs), minY = Math.min(0, ...ys), maxY = Math.max(0, ...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const pad = Math.max(0.45, 0.2 * span);
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  const grow = (lo, hi, size) => { const extra = Math.max(0, size - (hi - lo)) / 2; return [lo - extra, hi + extra]; };
  [minX, maxX] = grow(minX, maxX, C.minWidthNm);
  [minY, maxY] = grow(minY, maxY, C.minHeightNm);
  [minX, maxX] = grow(minX, maxX, (maxY - minY) / C.maxAspect);
  [minY, maxY] = grow(minY, maxY, (maxX - minX) * C.minAspect);
  return { minX, maxX, minY, maxY };
}

// ---- drawing ----------------------------------------------------------------------------------------------------
function gridMarkup(frame, k, toX, toY) {
  const step = FORMATION_TOP_VIEW_V0_1.gridNm;
  const lines = [];
  for (let x = Math.ceil(frame.minX / step) * step; x <= frame.maxX + 1e-9; x += step) {
    const major = Math.abs(x / 1 - Math.round(x)) < 1e-9;
    lines.push(`<line x1="${fmt(toX(x), 2)}" y1="0" x2="${fmt(toX(x), 2)}" y2="${fmt((frame.maxY - frame.minY) * k, 2)}" style="stroke:${LINE}" stroke-width="${major ? 1 : 0.6}" opacity="${major ? 0.9 : 0.55}"/>`);
  }
  for (let y = Math.ceil(frame.minY / step) * step; y <= frame.maxY + 1e-9; y += step) {
    const major = Math.abs(y - Math.round(y)) < 1e-9;
    lines.push(`<line x1="0" y1="${fmt(toY(y), 2)}" x2="${fmt((frame.maxX - frame.minX) * k, 2)}" y2="${fmt(toY(y), 2)}" style="stroke:${LINE}" stroke-width="${major ? 1 : 0.6}" opacity="${major ? 0.9 : 0.55}"/>`);
  }
  return `<g data-formation-role="grid">${lines.join("")}</g>`;
}

function textMarkup(x, y, content, { size = 12, anchor = "middle", weight = 700, color = INK, role = "", halo = true } = {}) {
  const roleAttr = role ? ` data-formation-role="${role}"` : "";
  const haloStyle = halo ? `;paint-order:stroke;stroke:${PAPER};stroke-width:3px;stroke-linejoin:round` : "";
  return `<text x="${fmt(x, 2)}" y="${fmt(y, 2)}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}" style="fill:${color};${FONT}${haloStyle}"${roleAttr}>${escapeText(content)}</text>`;
}

// One line per follower under the drawing: its link to its reference aircraft as the Flight Formation module reads it.
function legendLine(link) {
  const head = `#${link.number} → #${link.reference}`;
  if (link.code === null || link.code === undefined) return `${head}  NA · not placed`;
  return `${head}  ${link.code}  ${fmt(link.bearingDeg, 1)}°  ${fmt(link.distanceNm, 2)} NM · Long ${link.longitudinalNm.toFixed(2)} · Lat ${link.lateralNm.toFixed(2)}`;
}

// options: formation = formationName output (links, places, text); colors = { n: css colour } (default palette);
// idPrefix = a unique prefix for the SVG's ids (one view per page by default); title = the accessible title.
export function formationTopViewSvg({ formation, colors = DEFAULT_COLORS, idPrefix = "formation-top-view", title = "Flight Formation top view" } = {}) {
  const C = FORMATION_TOP_VIEW_V0_1;
  const aircraft = placedAircraft(formation);
  if (!aircraft.length) aircraft.push({ number: 1, x: 0, y: 0 });
  const frame = viewFrame(aircraft);
  const width = C.widthUnits;
  const k = width / (frame.maxX - frame.minX);
  const drawingHeight = (frame.maxY - frame.minY) * k;
  const top = C.headerUnits;
  const toX = (x) => (x - frame.minX) * k;
  const toY = (y) => (y - frame.minY) * k;
  const spacing = closestSpacingNm(aircraft);
  const lengthUnits = Math.min(C.aircraftMaxUnits, Math.max(C.aircraftMinUnits, Number.isFinite(spacing) ? C.aircraftSpacingShare * spacing * k : C.aircraftMaxUnits));
  const meshScale = lengthUnits / BDP_F16_MESH_V0_1.lengthM;
  const f16Id = `${idPrefix}-f16`;
  const colorOf = (number) => colors?.[number] ?? DEFAULT_COLORS[number] ?? INK;
  const links = Object.values(formation?.links ?? {}).filter((link) => Number.isInteger(link?.number)).sort((a, b) => a.number - b.number);
  const byNumber = new Map(aircraft.map((a) => [a.number, a]));
  const height = top + drawingHeight + C.footerUnits + Math.max(1, links.length + 1) * C.legendLineUnits + 6;
  const drawing = [];

  drawing.push(gridMarkup(frame, k, toX, toY));
  const drawn = links.filter((link) => byNumber.has(link.number) && byNumber.has(link.reference));
  // Reference lines (0.2.0): the abeam (0°) line through the centre of every reference aircraft (#1 always).
  const references = [...new Set([1, ...drawn.map((link) => link.reference)])].filter((number) => byNumber.has(number));
  for (const number of references) {
    const y = toY(byNumber.get(number).y);
    drawing.push(`<line x1="0" y1="${fmt(y, 2)}" x2="${fmt(width, 2)}" y2="${fmt(y, 2)}" style="stroke:${MUTED}" stroke-width="1" stroke-dasharray="6 5" opacity="0.8" data-formation-role="${number === 1 ? "abeam" : "reference-abeam"}" data-aircraft-number="${number}"/>`);
  }
  // Each follower: the line from its reference aircraft's centre to its own, its range, and its angle from the
  // reference's abeam line where it is neither abeam nor in trail.
  const labels = [];
  for (const link of drawn) {
    const own = byNumber.get(link.number);
    const reference = byNumber.get(link.reference);
    const color = colorOf(link.number);
    const x1 = toX(reference.x), y1 = toY(reference.y), x2 = toX(own.x), y2 = toY(own.y);
    drawing.push(`<line x1="${fmt(x1, 2)}" y1="${fmt(y1, 2)}" x2="${fmt(x2, 2)}" y2="${fmt(y2, 2)}" style="stroke:${color}" stroke-width="1.8" opacity="0.9" data-formation-role="link" data-aircraft-number="${link.number}"/>`);
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (!(length > 1e-6)) continue;
    // The range at the middle of the line: above a level line, right of a trail line. A slanted line's angle sits
    // between the abeam line and the link, near the reference aircraft: a long line takes its range on that (outer)
    // side, clear of the angle and of a mirrored line (Arrow Head); a short one on the inner side, clear of the angle.
    const ux = (x2 - x1) / length, uy = (y2 - y1) / length;
    const level = Math.abs(uy) < 0.02, trail = Math.abs(ux) < 0.02;
    // A follower is never ahead (uy ≥ 0): the upward normal is the outer side, the downward one the inner side.
    const outer = ux > 0 ? [uy, -ux] : [-uy, ux];
    const longLine = length / 2 > Math.min(C.angleArcUnits, 0.45 * length) + 48;
    const [nx, ny] = level ? [0, -1] : trail ? [1, 0] : longLine ? outer : [-outer[0], -outer[1]];
    const mx = (x1 + x2) / 2 + nx * 12, my = (y1 + y2) / 2 + ny * 12 + 4;
    const anchor = trail ? "start" : level ? "middle" : nx > 0 ? "start" : "end";
    labels.push(textMarkup(mx, my, `${rangeText(link.distanceNm)} NM`, { size: 12, anchor, weight: 900, color, role: "range-label" }));
    const bearing = Number(link.bearingDeg);
    if (Number.isFinite(bearing) && bearing > C.angleLabelMinDeg && bearing < C.angleLabelMaxDeg) {
      const sx = x2 >= x1 ? 1 : -1;
      const r = Math.min(C.angleArcUnits, 0.45 * length);
      const b = bearing * Math.PI / 180;
      const ax = x1 + sx * r, ay = y1;
      const bx = x1 + sx * r * Math.cos(b), by = y1 + r * Math.sin(b);
      drawing.push(`<path d="M ${fmt(ax, 2)} ${fmt(ay, 2)} A ${fmt(r, 2)} ${fmt(r, 2)} 0 0 ${sx > 0 ? 1 : 0} ${fmt(bx, 2)} ${fmt(by, 2)}" style="fill:none;stroke:${color}" stroke-width="1.4" data-formation-role="angle-arc" data-aircraft-number="${link.number}"/>`);
      const lx = x1 + sx * (r + 13) * Math.cos(b / 2), ly = y1 + (r + 13) * Math.sin(b / 2) + 4;
      labels.push(textMarkup(lx, ly, `${Math.round(bearing)}°`, { size: 12, anchor: sx > 0 ? "start" : "end", weight: 900, color, role: "angle-label" }));
    }
  }
  drawing.push(...labels);
  // The aircraft: a soft disc in the aircraft's colour under the F-16, its number beside it.
  for (const a of aircraft) {
    const color = colorOf(a.number);
    const cx = toX(a.x), cy = toY(a.y);
    const r = lengthUnits * 0.6;
    drawing.push(`<g data-formation-role="aircraft" data-aircraft-number="${a.number}">`
      + `<circle cx="${fmt(cx, 2)}" cy="${fmt(cy, 2)}" r="${fmt(r, 2)}" style="fill:${color}" opacity="0.16"/>`
      + `<circle cx="${fmt(cx, 2)}" cy="${fmt(cy, 2)}" r="${fmt(r, 2)}" style="fill:none;stroke:${color}" stroke-width="1.4" opacity="0.65"/>`
      + `<use href="#${f16Id}-outline" transform="translate(${fmt(cx, 2)} ${fmt(cy, 2)}) scale(${fmt(meshScale, 4)})"/>`
      + `<use href="#${f16Id}" transform="translate(${fmt(cx, 2)} ${fmt(cy, 2)}) scale(${fmt(meshScale, 4)})"/>`
      + textMarkup(cx + r * 0.78, cy - r * 0.72, `#${a.number}`, { size: 15, anchor: "start", weight: 900, color: a.number === 1 ? INK : color, role: "aircraft-label" })
      + `</g>`);
  }

  const parts = [];
  // Header: the name, the heading.
  parts.push(textMarkup(8, 20, formation?.text ?? "", { size: 15, anchor: "start", weight: 900, role: "name", halo: false }));
  const arrowX = width - 12;
  parts.push(`<g data-formation-role="heading"><line x1="${arrowX}" y1="26" x2="${arrowX}" y2="9" style="stroke:${INK}" stroke-width="2"/><path d="M ${arrowX - 5} 14 L ${arrowX} 5 L ${arrowX + 5} 14 Z" style="fill:${INK}"/>`
    + textMarkup(arrowX - 9, 22, "HDG", { size: 10, anchor: "end", weight: 800, color: MUTED, halo: false }) + `</g>`);
  parts.push(`<g transform="translate(0 ${fmt(top, 2)})" data-formation-role="drawing">${drawing.join("")}</g>`);
  // Footer: the scale, the not-to-scale note, then the link list.
  const scaleY = top + drawingHeight + 16;
  const barUnits = C.gridNm * k;
  parts.push(`<g data-formation-role="scale"><line x1="8" y1="${fmt(scaleY, 2)}" x2="${fmt(8 + barUnits, 2)}" y2="${fmt(scaleY, 2)}" style="stroke:${INK}" stroke-width="2"/>`
    + `<line x1="8" y1="${fmt(scaleY - 4, 2)}" x2="8" y2="${fmt(scaleY + 4, 2)}" style="stroke:${INK}" stroke-width="2"/><line x1="${fmt(8 + barUnits, 2)}" y1="${fmt(scaleY - 4, 2)}" x2="${fmt(8 + barUnits, 2)}" y2="${fmt(scaleY + 4, 2)}" style="stroke:${INK}" stroke-width="2"/>`
    + textMarkup(8 + barUnits + 6, scaleY + 4, `${C.gridNm} NM grid`, { size: 10, anchor: "start", weight: 700, color: MUTED, halo: false }) + `</g>`);
  parts.push(textMarkup(width - 8, scaleY + 4, "Aircraft enlarged · not to scale", { size: 10, anchor: "end", weight: 600, color: MUTED, role: "scale-note", halo: false }));
  let lineY = top + drawingHeight + C.footerUnits + 12;
  for (const link of links) {
    parts.push(textMarkup(8, lineY, legendLine(link), { size: 11, anchor: "start", weight: 800, color: colorOf(link.number), role: "link-label", halo: false }));
    lineY += C.legendLineUnits;
  }
  parts.push(textMarkup(8, lineY, "- - #1 abeam = 0°, behind = 90° · Long behind / Lat across (NM)", { size: 10, anchor: "start", weight: 600, color: MUTED, role: "abeam-label", halo: false }));

  return `<svg viewBox="0 0 ${fmt(width, 2)} ${fmt(height, 2)}" style="background:${PAPER}" role="img" aria-label="${escapeText(title)}" data-formation-top-view="${escapeText(formation?.text ?? "")}" xmlns="http://www.w3.org/2000/svg">`
    + `<title>${escapeText(title)}</title><defs>${f16Definition(f16Id)}</defs>${parts.join("")}</svg>`;
}
