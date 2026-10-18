import { svgNode } from "../../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { BDP_VIEW_COLORS as C } from "./bdp-view-style-v0.1.mjs";
import { aircraftAxes, flightStateAt, fragmentAt } from "./bdp-flight-path-v0.1.mjs?v=0.1.0";

// BDP 3D Profile v0.1 (owner 2026-10-15, BDP update R6; plan §4.6; research viewer SPEC §5.2 in SVG). A perspective
// picture of a BDP flight path (bdp-flight-path-v0.1): ground grid, Target, Aim-off Point, the path coloured by
// phase (Roll-in, Tracking, SEM) with its ground shadow, the FPM line from the Track Point to the Aim-off Point,
// wing ticks every 1 s (bank), the aircraft at time t and the fragment cylinder on the Target (its largest size
// dashed; at t its size then, filled). The orbit (azimuth / elevation of the eye) and an altitude ×2 stretch are
// the host's options; orbitByDrag turns a pointer drag into a new orbit. Self-contained SVG; display only.

export const BDP_3D_VIEW_V0_1 = Object.freeze({
  id: "bdp-3d-view-v0.1",
  version: "0.1.0",
  canvas: Object.freeze({ width: 900, height: 560 }),
  // Default eye: 60° from the Attack Heading toward the Roll-in side, 15° up (the dive seen nearly side on).
  defaultOrbit: Object.freeze({ fromAttackHeadingDeg: 60, elevationDeg: 15 }),
  elevationLimitsDeg: Object.freeze([5, 85]),
  dragDegPerPx: Object.freeze({ azimuth: 0.4, elevation: 0.3 }),
  phaseColors: Object.freeze({ "roll-in": C.rollIn, tracking: C.flightPath, sem: C.verticalTracking }),
});

const FT_PER_NM = 6076.11549;
const DEG = Math.PI / 180;
const GRID_STEPS_NM = [0.25, 0.5, 1, 2, 5, 10];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function bdp3dDefaultOrbit(path) {
  const side = path?.rollDirection === "LEFT" ? -1 : 1;
  const attackDeg = path?.release?.headingDeg ?? 0;
  const azimuthDeg = (((attackDeg + side * BDP_3D_VIEW_V0_1.defaultOrbit.fromAttackHeadingDeg) % 360) + 360) % 360;
  return { azimuthDeg, elevationDeg: BDP_3D_VIEW_V0_1.defaultOrbit.elevationDeg };
}

// A pointer drag of (dx, dy) screen px: right turns the eye around the scene, down raises it.
export function orbitByDrag(orbit, dxPx, dyPx) {
  const { azimuth, elevation } = BDP_3D_VIEW_V0_1.dragDegPerPx;
  const [low, high] = BDP_3D_VIEW_V0_1.elevationLimitsDeg;
  const azimuthDeg = (((orbit.azimuthDeg - dxPx * azimuth) % 360) + 360) % 360;
  return { azimuthDeg, elevationDeg: Math.min(high, Math.max(low, orbit.elevationDeg + dyPx * elevation)) };
}

export function renderBdp3dView(svg, path, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  if (!Array.isArray(path?.samples) || path.samples.length < 2) throw new TypeError("a BDP flight path is required");
  const { width: W, height: H } = BDP_3D_VIEW_V0_1.canvas;
  const orbit = { ...bdp3dDefaultOrbit(path), ...(options.orbit ?? {}) };
  const zk = Number(options.altitudeScale) === 2 ? 2 : 1;
  // t: seconds from the Roll-in Point (before it the aircraft is still on the approach and is not drawn).
  const t = Number.isFinite(options.timeSec) ? Math.min(options.timeSec, path.endT) : null;
  const flying = t !== null && t >= path.samples[0].t;
  const P = (p) => [p.x, p.y, p.z * zk];

  // Ground square: the path, Target, Aim-off Point and the fragment radius, on a round grid step.
  const fragment = path.fragment;
  const ground = [...path.samples, path.target, ...(path.aim ? [path.aim] : [])];
  const pad = Math.max(0.3 * FT_PER_NM, fragment ? fragment.radiusFt * 1.1 : 0);
  let minX = Math.min(...ground.map((p) => p.x), path.target.x - pad);
  let maxX = Math.max(...ground.map((p) => p.x), path.target.x + pad);
  let minY = Math.min(...ground.map((p) => p.y), path.target.y - pad);
  let maxY = Math.max(...ground.map((p) => p.y), path.target.y + pad);
  const spanNm = Math.max(maxX - minX, maxY - minY) / FT_PER_NM;
  const stepNm = GRID_STEPS_NM.find((step) => spanNm / step <= 10) ?? GRID_STEPS_NM.at(-1);
  const stepFt = stepNm * FT_PER_NM;
  minX = Math.floor(minX / stepFt) * stepFt;
  maxX = Math.ceil(maxX / stepFt) * stepFt;
  minY = Math.floor(minY / stepFt) * stepFt;
  maxY = Math.ceil(maxY / stepFt) * stepFt;
  const maxZ = Math.max(...path.samples.map((p) => p.z), fragment ? fragment.heightAglFt : 0) * zk;

  // Perspective eye on the orbit around the scene centre, three scene radii away.
  const centre = [(minX + maxX) / 2, (minY + maxY) / 2, maxZ / 3];
  const radius = Math.hypot(maxX - minX, maxY - minY, maxZ) / 2;
  const az = orbit.azimuthDeg * DEG;
  const el = orbit.elevationDeg * DEG;
  const eye = [centre[0] + 3 * radius * Math.sin(az) * Math.cos(el), centre[1] + 3 * radius * Math.cos(az) * Math.cos(el), centre[2] + 3 * radius * Math.sin(el)];
  const forward = norm(sub(centre, eye));
  const right = norm([forward[1], -forward[0], 0]);
  const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
  const camera = (q) => {
    const d = sub(q, eye);
    const depth = dot(d, forward);
    return depth > 1 ? { u: dot(d, right) / depth, v: dot(d, up) / depth } : null;
  };
  // Fit: the ground square's corners, the path and the cylinder's top fill the canvas below the title rows.
  const fitPoints = [[minX, minY, 0], [maxX, minY, 0], [maxX, maxY, 0], [minX, maxY, 0], ...path.samples.map(P)];
  if (fragment) for (let a = 0; a < 360; a += 30) fitPoints.push([path.target.x + fragment.radiusFt * Math.cos(a * DEG), path.target.y + fragment.radiusFt * Math.sin(a * DEG), fragment.heightAglFt * zk]);
  const fitted = fitPoints.map(camera).filter(Boolean);
  const uMin = Math.min(...fitted.map((p) => p.u));
  const uMax = Math.max(...fitted.map((p) => p.u));
  const vMin = Math.min(...fitted.map((p) => p.v));
  const vMax = Math.max(...fitted.map((p) => p.v));
  const box = { left: 40, right: W - 24, top: 76, bottom: H - 20 };
  const scale = Math.min((box.right - box.left) / Math.max(uMax - uMin, 1e-9), (box.bottom - box.top) / Math.max(vMax - vMin, 1e-9));
  const ox = (box.left + box.right) / 2 - (scale * (uMin + uMax)) / 2;
  const oy = (box.top + box.bottom) / 2 + (scale * (vMin + vMax)) / 2;
  const at = (q) => { const c = camera(q); return c ? { x: ox + scale * c.u, y: oy - scale * c.v } : null; };
  const pts = (list) => list.filter(Boolean).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const polyline = (list, attrs) => { const q = list.map(at).filter(Boolean); return q.length >= 2 ? svgNode("polyline", { points: pts(q), fill: "none", ...attrs }) : null; };
  const text = (p, value, attrs = {}) => (p ? svgNode("text", { x: p.x.toFixed(1), y: p.y.toFixed(1), fill: "#203a63", "font-size": 13, "font-family": "system-ui, sans-serif", "font-weight": 600, stroke: "#ffffff", "stroke-width": 3, "paint-order": "stroke", ...attrs }, value) : null);

  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.style.aspectRatio = `${W} / ${H}`;
  svg.setAttribute("aria-label", options.title ?? "3D Profile");
  const root = svgNode("g", { "data-view": BDP_3D_VIEW_V0_1.id });
  svg.append(root);
  const add = (node) => { if (node) root.append(node); return node; };
  add(svgNode("rect", { x: 0, y: 0, width: W, height: H, fill: "#ffffff" }));

  // Ground and grid.
  add(svgNode("polygon", { points: pts([[minX, minY, 0], [maxX, minY, 0], [maxX, maxY, 0], [minX, maxY, 0]].map(at)), fill: "#f1f4ee", stroke: "#b8c2cc", "stroke-width": 1, "data-3d-role": "ground" }));
  for (let x = minX + stepFt; x < maxX - 1; x += stepFt) add(polyline([[x, minY, 0], [x, maxY, 0]], { stroke: "#d3dae2", "stroke-width": 1, "data-3d-role": "grid" }));
  for (let y = minY + stepFt; y < maxY - 1; y += stepFt) add(polyline([[minX, y, 0], [maxX, y, 0]], { stroke: "#d3dae2", "stroke-width": 1, "data-3d-role": "grid" }));

  // Ground shadow of the path and drop lines at the Roll-in Point, Track Point and Release.
  add(polyline(path.samples.map((s) => [s.x, s.y, 0]), { stroke: "#8f9aa6", "stroke-width": 1.4, "stroke-opacity": 0.7, "data-3d-role": "shadow" }));
  const marks = [[path.samples[0], "Roll-in"], [path.trackPoint, "Track Point"], ...(path.releaseT > path.trackPointT ? [[path.release, "Release"]] : [])];
  for (const [p] of marks) add(polyline([[p.x, p.y, 0], P(p)], { stroke: "#8f9aa6", "stroke-width": 1, "stroke-dasharray": "3 3", "data-3d-role": "drop-line" }));

  // Fragment cylinder on the Target: the largest size dashed, its size at t filled.
  const ring = (radiusFt, z) => Array.from({ length: 49 }, (_, i) => [path.target.x + radiusFt * Math.cos(i * 7.5 * DEG), path.target.y + radiusFt * Math.sin(i * 7.5 * DEG), z * zk]);
  const cylinder = (radiusFt, heightFt, attrs, role) => {
    const g = add(svgNode("g", { "data-3d-role": role }));
    const bottom = ring(radiusFt, 0).map(at).filter(Boolean);
    const top = ring(radiusFt, heightFt).map(at).filter(Boolean);
    if (bottom.length < 3 || top.length < 3) return;
    // Silhouette: the screen-leftmost and rightmost bottom points and the top points above them.
    const iLeft = bottom.reduce((best, p, i) => (p.x < bottom[best].x ? i : best), 0);
    const iRight = bottom.reduce((best, p, i) => (p.x > bottom[best].x ? i : best), 0);
    if (attrs.fill && attrs.fill !== "none") g.append(svgNode("polygon", { points: pts([...bottom, ...top.slice().reverse()]), fill: attrs.fill, "fill-opacity": attrs["fill-opacity"], stroke: "none" }));
    const line = { fill: "none", stroke: attrs.stroke, "stroke-width": attrs["stroke-width"], "stroke-dasharray": attrs["stroke-dasharray"] };
    g.append(svgNode("polygon", { points: pts(bottom), ...line }));
    g.append(svgNode("polygon", { points: pts(top), ...line }));
    for (const i of [iLeft, iRight]) if (top[i]) g.append(svgNode("polyline", { points: pts([bottom[i], top[i]]), ...line }));
  };
  if (fragment) cylinder(fragment.radiusFt, fragment.heightAglFt, { fill: "none", stroke: C.target, "stroke-width": 1.4, "stroke-dasharray": "6 5" }, "fragment-max");
  const fragmentNow = t === null ? null : fragmentAt(path, t);
  if (fragmentNow) cylinder(fragmentNow.radiusFt, fragmentNow.heightFt, { fill: C.target, "fill-opacity": 0.2, stroke: C.target, "stroke-width": 1.4 }, "fragment-now");

  // Target and Aim-off Point.
  const tgt = at(P(path.target));
  if (tgt) {
    add(svgNode("circle", { cx: tgt.x.toFixed(1), cy: tgt.y.toFixed(1), r: 6, fill: "none", stroke: C.target, "stroke-width": 2, "data-3d-role": "target" }));
    add(svgNode("path", { d: `M${(tgt.x - 9).toFixed(1)},${tgt.y.toFixed(1)}h18M${tgt.x.toFixed(1)},${(tgt.y - 9).toFixed(1)}v18`, stroke: C.target, "stroke-width": 1.6 }));
    add(text({ x: tgt.x + 10, y: tgt.y + 18 }, "Target", { fill: C.target }));
  }
  if (path.aim) {
    const aim = at(P(path.aim));
    if (aim) {
      add(svgNode("polygon", { points: `${aim.x},${aim.y - 6} ${aim.x + 6},${aim.y} ${aim.x},${aim.y + 6} ${aim.x - 6},${aim.y}`, fill: C.aimOff, "data-3d-role": "aim-point" }));
      add(text({ x: aim.x + 9, y: aim.y - 8 }, "Aim-off", { fill: C.aimOff }));
    }
    add(polyline([P(path.trackPoint), P(path.aim)], { stroke: C.flightPath, "stroke-width": 1.4, "stroke-dasharray": "7 5", "data-3d-role": "fpm-line" }));
  }

  // Path by phase, each run joined to the previous one's last point.
  const runs = [];
  path.samples.forEach((s, i) => {
    if (!runs.length || runs.at(-1).phase !== s.phase) runs.push({ phase: s.phase, points: i > 0 ? [path.samples[i - 1]] : [] });
    runs.at(-1).points.push(s);
  });
  for (const run of runs) add(polyline(run.points.map(P), { stroke: BDP_3D_VIEW_V0_1.phaseColors[run.phase] ?? C.flightPath, "stroke-width": 3, "stroke-linejoin": "round", "stroke-linecap": "round", "data-3d-role": `path-${run.phase}` }));

  // Wing ticks every 1 s: the wing line at that time (its tilt is the bank).
  const wingFt = radius * 0.035;
  const ticks = add(svgNode("g", { "data-3d-role": "bank-ticks" }));
  for (let s = Math.ceil(path.samples[0].t); s <= path.endT && s <= path.samples[0].t + 240; s += 1) {
    const state = flightStateAt(path, s);
    const { right: r } = aircraftAxes(state);
    const q = P(state);
    const tick = polyline([[q[0] - r[0] * wingFt, q[1] - r[1] * wingFt, q[2] - r[2] * wingFt * zk], [q[0] + r[0] * wingFt, q[1] + r[1] * wingFt, q[2] + r[2] * wingFt * zk]], { stroke: "#4b5866", "stroke-width": 1.2 });
    if (tick) ticks.append(tick);
  }
  for (const [p, label] of marks) {
    const q = at(P(p));
    if (q) {
      add(svgNode("circle", { cx: q.x.toFixed(1), cy: q.y.toFixed(1), r: 4, fill: "#ffffff", stroke: "#203a63", "stroke-width": 1.6, "data-3d-role": "mark" }));
      add(text({ x: q.x + 8, y: q.y - 8 }, label));
    }
  }

  // The aircraft at t: a delta of its wings and nose, with its drop line and shadow.
  let state = null;
  if (flying) {
    state = flightStateAt(path, t);
    const { v, right: r } = aircraftAxes(state);
    const size = radius * 0.04;
    const q = P(state);
    const off = (a, b) => [q[0] + v[0] * a * size + r[0] * b * size, q[1] + v[1] * a * size + r[1] * b * size, q[2] + (v[2] * a * size + r[2] * b * size) * zk];
    add(polyline([[state.x, state.y, 0], q], { stroke: "#203a63", "stroke-width": 1, "stroke-dasharray": "2 3" }));
    const shadow = at([state.x, state.y, 0]);
    if (shadow) add(svgNode("circle", { cx: shadow.x.toFixed(1), cy: shadow.y.toFixed(1), r: 3, fill: "#8f9aa6", "data-3d-role": "aircraft-shadow" }));
    const delta = [off(1, 0), off(-0.6, 0.75), off(-0.35, 0), off(-0.6, -0.75)].map(at);
    if (delta.every(Boolean)) add(svgNode("polygon", { points: pts(delta), fill: "#203a63", stroke: "#ffffff", "stroke-width": 1, "data-3d-role": "aircraft" }));
  }

  // Title rows: orbit, altitude stretch, grid step; at t the aircraft's state.
  add(text({ x: 16, y: 24 }, `Orbit ${Math.round(orbit.azimuthDeg)}° / ${Math.round(orbit.elevationDeg)}° · Altitude ×${zk} · Grid ${stepNm} NM`, { "data-3d-role": "status" }));
  if (t !== null && !flying) add(text({ x: 16, y: 46 }, `Roll-in in ${(path.samples[0].t - t).toFixed(1)} s`, { "data-3d-role": "state" }));
  if (state) add(text({ x: 16, y: 46 }, `T ${t.toFixed(1)} s from Roll-in · ${String(state.phase).toUpperCase()} · ${Math.round(state.z)} ft AGL · ${Math.round(state.kcas)} KCAS · Bank ${Math.round(Math.abs(state.bankDeg))}°`, { "data-3d-role": "state" }));
  const legend = [
    { label: "Roll-in", color: BDP_3D_VIEW_V0_1.phaseColors["roll-in"] },
    { label: "Tracking", color: BDP_3D_VIEW_V0_1.phaseColors.tracking },
    ...(path.samples.some((s) => s.phase === "sem") ? [{ label: "SEM", color: BDP_3D_VIEW_V0_1.phaseColors.sem }] : []),
    ...(path.aim ? [{ label: "FPM line", color: C.flightPath, dashed: true }] : []),
    ...(fragment ? [{ label: "Fragment cylinder", color: C.target, dashed: true }] : []),
  ];
  return { title: options.title ?? "3D Profile", orbit, altitudeScale: zk, gridStepNm: stepNm, timeSec: t, state, legend, legendColumns: 0, canvas: { width: W, height: H } };
}
