import { svgNode } from "../../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { BDP_VIEW_COLORS as C } from "./bdp-view-style-v0.1.mjs";
import { aircraftAxes, flightStateAt, fragmentAt } from "./bdp-flight-path-v0.1.mjs?v=0.1.1";

// BDP 3D Profile v0.1 (owner 2026-10-15, BDP update R6; plan §4.6; research viewer SPEC §5.2 in SVG). A perspective
// picture of a BDP flight path (bdp-flight-path-v0.1): ground grid, Target, Aim-off Point, the path coloured by
// phase (Roll-in, Tracking, SEM) with its ground shadow, the FPM line from the Track Point to the Aim-off Point,
// wing ticks every 1 s (bank), the aircraft at time t and the fragment envelope (0.1.1: a dome on the impact point;
// its largest size dashed, at t its size then, filled). The orbit (azimuth / elevation of the eye), zoom and pan are
// the host's options; bdp3dGestureStep turns pointer events into them. Heights are true (no stretch since 0.1.2).
// Self-contained SVG; display only.

export const BDP_3D_VIEW_V0_1 = Object.freeze({
  id: "bdp-3d-view-v0.1",
  // 0.1.1 (2026-10-18, owner handoff §4): the fragment envelope is an ellipsoidal dome on the BE's impact point
  // ((x² + y²)/R² + z²/H² = 1, its largest size dashed, its size at t filled); `zoom` / `pan` after the fit
  // (zoomAbout keeps a screen point fixed); the host's approach before the Roll-in Point (grey); the legend
  // carries the SEM conditions as notes. Display only: the fragment check stays the BE's cylinder check.
  // 0.1.2 (2026-10-18, owner addendum "BDP view touch / layout"): no altitude stretch (always true heights; the
  // Altitude ×2 option is gone); the fit comes from the default orbit, so a drag turns the picture about the fixed
  // scene centre and only a new path or Reset View refits; bdp3dGestureStep — drag turns, a 0.5 s hold within
  // 8 CSS px then drag pans (`panHint` draws "PAN"), two pointers only zoom about their starting midpoint.
  version: "0.1.2",
  canvas: Object.freeze({ width: 900, height: 560 }),
  gesture: Object.freeze({ holdMs: 500, slopCssPx: 8, minPinchCssPx: 10 }),
  zoomLimits: Object.freeze([0.5, 4]),
  // Default eye: 60° from the Attack Heading toward the Roll-in side, 15° up (the dive seen nearly side on).
  defaultOrbit: Object.freeze({ fromAttackHeadingDeg: 60, elevationDeg: 15 }),
  elevationLimitsDeg: Object.freeze([5, 85]),
  dragDegPerPx: Object.freeze({ azimuth: 0.4, elevation: 0.3 }),
  phaseColors: Object.freeze({ approach: "#8f9aa6", "roll-in": C.rollIn, tracking: C.flightPath, sem: C.verticalTracking }),
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

// Zoom by `factor` about screen point (px, py) of the canvas, keeping that point of the picture under it.
export function zoomAbout(view, factor, px, py) {
  const [low, high] = BDP_3D_VIEW_V0_1.zoomLimits;
  const { width: W, height: H } = BDP_3D_VIEW_V0_1.canvas;
  const zoom = view.zoom ?? 1;
  const pan = view.pan ?? { x: 0, y: 0 };
  const next = Math.min(high, Math.max(low, zoom * factor));
  const k = next / zoom;
  return { zoom: next, pan: { x: px - W / 2 - k * (px - W / 2 - pan.x), y: py - H / 2 - k * (py - H / 2 - pan.y) } };
}

// One-pointer / two-pointer gesture (0.1.2, owner addendum §4–§5) as a pure step: the host passes each pointer event
// (and the hold timer's firing) with the current view { orbit, zoom, pan }, and gets the next gesture state, the next
// view and whether to arm the hold timer. Positions: `x`, `y` in CSS px (client), `cx`, `cy` in canvas px.
//   down → pending (hold timer armed; Shift or the middle button: pan at once); a second pointer → pinch.
//   pending: moving more than 8 CSS px from the press → rotate (for the rest of the gesture); the timer firing
//   while still within 8 px → pan from the current point (no jump).
//   rotate: orbitByDrag; pan: the picture follows the pointer (canvas px, after the zoom).
//   pinch: zoom = z0 · d / d0 about the starting midpoint (fixed); the midpoint's movement does not pan.
//   One pointer left after a pinch: paused (nothing moves) until all are up or a second comes back (a new pinch).
//   Up / cancel / reset: idle; a late timer of an earlier press does nothing (`seq`).
export function bdp3dGestureInit() {
  return { mode: "idle", pointers: {}, seq: 0, start: null, last: null, pinch: null };
}

export function bdp3dGestureStep(gesture, event, view) {
  const { holdMs, slopCssPx, minPinchCssPx } = BDP_3D_VIEW_V0_1.gesture;
  const g = { ...gesture, pointers: { ...gesture.pointers } };
  let next = { orbit: view.orbit, zoom: view.zoom ?? 1, pan: view.pan ?? { x: 0, y: 0 } };
  let armTimer = false;
  const ids = () => Object.keys(g.pointers);
  const point = (e) => ({ x: e.x, y: e.y, cx: e.cx, cy: e.cy });
  const startPinch = () => {
    const [a, b] = ids().slice(0, 2).map((id) => g.pointers[id]);
    const d0 = Math.hypot(a.x - b.x, a.y - b.y);
    g.mode = "pinch";
    g.pinch = d0 >= minPinchCssPx ? { d0, z0: next.zoom, pan0: { ...next.pan }, anchor: { x: (a.cx + b.cx) / 2, y: (a.cy + b.cy) / 2 } } : null;
  };
  switch (event.type) {
    case "down": {
      if (ids().length >= 2) break;
      g.pointers[event.id] = point(event);
      if (ids().length === 2) { startPinch(); break; }
      if (event.button === 1 || event.shiftKey) {
        g.mode = "pan";
        g.last = point(event);
      } else if (!event.button) {
        g.mode = "pending";
        g.seq += 1;
        g.start = { x: event.x, y: event.y, t: event.t };
        g.last = point(event);
        armTimer = true;
      } else {
        g.mode = "idle";
      }
      break;
    }
    case "move": {
      if (!g.pointers[event.id]) break;
      g.pointers[event.id] = point(event);
      if (g.mode === "pinch") {
        if (ids().length < 2) break;
        const [a, b] = ids().slice(0, 2).map((id) => g.pointers[id]);
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (!g.pinch) {
          if (d >= minPinchCssPx) startPinch();
          break;
        }
        next = { ...next, ...zoomAbout({ zoom: g.pinch.z0, pan: g.pinch.pan0 }, d / g.pinch.d0, g.pinch.anchor.x, g.pinch.anchor.y) };
        break;
      }
      if (g.mode === "pending") {
        if (Math.hypot(event.x - g.start.x, event.y - g.start.y) <= slopCssPx) break;
        g.mode = "rotate";
      }
      if (g.mode === "rotate") {
        next.orbit = orbitByDrag(next.orbit, event.cx - g.last.cx, event.cy - g.last.cy);
        g.last = point(event);
      } else if (g.mode === "panReady" || g.mode === "pan") {
        g.mode = "pan";
        next.pan = { x: next.pan.x + event.cx - g.last.cx, y: next.pan.y + event.cy - g.last.cy };
        g.last = point(event);
      }
      break;
    }
    case "timer": {
      // Only this press's timer, still pending, one pointer, held long enough (re-checked here).
      if (g.mode !== "pending" || event.seq !== g.seq || ids().length !== 1 || event.t - g.start.t < holdMs - 1) break;
      const p = g.pointers[ids()[0]];
      if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > slopCssPx) break;
      g.mode = "panReady";
      g.last = { ...p };
      break;
    }
    case "up":
    case "cancel": {
      if (!g.pointers[event.id]) break;
      delete g.pointers[event.id];
      const left = ids().length;
      if (g.mode === "pinch" && left === 1) g.mode = "paused";
      else if (left === 0) { g.mode = "idle"; g.start = null; g.last = null; g.pinch = null; }
      break;
    }
    case "reset":
      return { gesture: { ...bdp3dGestureInit(), seq: g.seq + 1 }, view: next, armTimer: false, panHint: false };
    default:
      break;
  }
  return { gesture: g, view: next, armTimer, panHint: g.mode === "panReady" || g.mode === "pan" };
}

// Convex hull of screen points (monotone chain): the outline of a convex solid's projection.
function hull(points) {
  const p = points.filter(Boolean).slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const crossZ = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const q of p) { while (lower.length >= 2 && crossZ(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  const upper = [];
  for (const q of p.slice().reverse()) { while (upper.length >= 2 && crossZ(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function renderBdp3dView(svg, path, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  if (!Array.isArray(path?.samples) || path.samples.length < 2) throw new TypeError("a BDP flight path is required");
  const { width: W, height: H } = BDP_3D_VIEW_V0_1.canvas;
  const orbit = { ...bdp3dDefaultOrbit(path), ...(options.orbit ?? {}) };
  // t: seconds from the Roll-in Point (before it the aircraft is still on the approach and is not drawn).
  const t = Number.isFinite(options.timeSec) ? Math.min(options.timeSec, path.endT) : null;
  // The aircraft shows from the earliest known state (the host's approach, else the Roll-in Point).
  const firstT = path.approach?.[0]?.t ?? path.samples[0].t;
  const flying = t !== null && t >= firstT;
  const P = (p) => [p.x, p.y, p.z];

  // Ground square: the path, Target, Aim-off Point and the fragment radius, on a round grid step.
  const fragment = path.fragment;
  const approach = path.approach ?? [];
  const impact = fragment?.impact ?? path.target;
  const ground = [...approach, ...path.samples, path.target, ...(path.aim ? [path.aim] : [])];
  const pad = Math.max(0.3 * FT_PER_NM, fragment ? fragment.radiusFt * 1.1 : 0);
  let minX = Math.min(...ground.map((p) => p.x), impact.x - pad);
  let maxX = Math.max(...ground.map((p) => p.x), impact.x + pad);
  let minY = Math.min(...ground.map((p) => p.y), impact.y - pad);
  let maxY = Math.max(...ground.map((p) => p.y), impact.y + pad);
  const spanNm = Math.max(maxX - minX, maxY - minY) / FT_PER_NM;
  const stepNm = GRID_STEPS_NM.find((step) => spanNm / step <= 10) ?? GRID_STEPS_NM.at(-1);
  const stepFt = stepNm * FT_PER_NM;
  minX = Math.floor(minX / stepFt) * stepFt;
  maxX = Math.ceil(maxX / stepFt) * stepFt;
  minY = Math.floor(minY / stepFt) * stepFt;
  maxY = Math.ceil(maxY / stepFt) * stepFt;
  const maxZ = Math.max(...path.samples.map((p) => p.z), fragment ? fragment.heightAglFt : 0);

  // Perspective eye on the orbit around the scene centre, three scene radii away. The centre is fixed for the path
  // (0.1.2): it projects to the same screen point for every orbit, so a drag turns the picture about it.
  const centre = [(minX + maxX) / 2, (minY + maxY) / 2, maxZ / 3];
  const radius = Math.hypot(maxX - minX, maxY - minY, maxZ) / 2;
  const makeCamera = ({ azimuthDeg, elevationDeg }) => {
    const az = azimuthDeg * DEG;
    const el = elevationDeg * DEG;
    const eyeAt = [centre[0] + 3 * radius * Math.sin(az) * Math.cos(el), centre[1] + 3 * radius * Math.cos(az) * Math.cos(el), centre[2] + 3 * radius * Math.sin(el)];
    const forward = norm(sub(centre, eyeAt));
    const right = norm([forward[1], -forward[0], 0]);
    const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
    return {
      eye: eyeAt,
      project(q) {
        const d = sub(q, eyeAt);
        const depth = dot(d, forward);
        return depth > 1 ? { u: dot(d, right) / depth, v: dot(d, up) / depth } : null;
      },
    };
  };
  const cam = makeCamera(orbit);
  const eye = cam.eye;
  // Fit (0.1.2): from the default orbit, so the scale and the centre's screen point stay put while the orbit turns;
  // a new path or Reset View is the only refit. The ground square's corners, the path and the dome's top fill the
  // canvas below the title rows at the default orbit.
  const fitCam = makeCamera(bdp3dDefaultOrbit(path));
  const fitPoints = [[minX, minY, 0], [maxX, minY, 0], [maxX, maxY, 0], [minX, maxY, 0], ...approach.map(P), ...path.samples.map(P)];
  if (fragment) fitPoints.push([impact.x, impact.y, fragment.heightAglFt]);
  const fitted = fitPoints.map((q) => fitCam.project(q)).filter(Boolean);
  const uMin = Math.min(...fitted.map((p) => p.u));
  const uMax = Math.max(...fitted.map((p) => p.u));
  const vMin = Math.min(...fitted.map((p) => p.v));
  const vMax = Math.max(...fitted.map((p) => p.v));
  const box = { left: 40, right: W - 24, top: 76, bottom: H - 20 };
  const scale = Math.min((box.right - box.left) / Math.max(uMax - uMin, 1e-9), (box.bottom - box.top) / Math.max(vMax - vMin, 1e-9));
  // Then the host's zoom about the canvas centre and pan (canvas px).
  const zoom = Math.min(BDP_3D_VIEW_V0_1.zoomLimits[1], Math.max(BDP_3D_VIEW_V0_1.zoomLimits[0], Number(options.zoom) || 1));
  const pan = { x: Number(options.pan?.x) || 0, y: Number(options.pan?.y) || 0 };
  const ox = (box.left + box.right) / 2 - (scale * (uMin + uMax)) / 2;
  const oy = (box.top + box.bottom) / 2 + (scale * (vMin + vMax)) / 2;
  const at = (q) => {
    const c = cam.project(q);
    return c ? { x: W / 2 + zoom * (ox + scale * c.u - W / 2) + pan.x, y: H / 2 + zoom * (oy - scale * c.v - H / 2) + pan.y } : null;
  };
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
  add(polyline([...approach, ...path.samples].map((s) => [s.x, s.y, 0]), { stroke: "#8f9aa6", "stroke-width": 1.4, "stroke-opacity": 0.7, "data-3d-role": "shadow" }));
  const marks = [[path.samples[0], "Roll-in"], [path.trackPoint, "Track Point"], ...(path.releaseT > path.trackPointT ? [[path.release, "Release"]] : [])];
  for (const [p] of marks) add(polyline([[p.x, p.y, 0], P(p)], { stroke: "#8f9aa6", "stroke-width": 1, "stroke-dasharray": "3 3", "data-3d-role": "drop-line" }));

  // Fragment dome on the impact point: (x² + y²)/R² + z²/H² = 1 above the ground. Its outline is the convex hull of
  // surface points; two meridians and a mid ring give its shape. Largest size dashed, size at t filled.
  const dome = (radiusFt, heightFt, filled, role) => {
    if (!(radiusFt > 0 && heightFt > 0)) return;
    const g = add(svgNode("g", { "data-3d-role": role, "data-radius-ft": radiusFt.toFixed(1), "data-height-ft": heightFt.toFixed(1) }));
    const surface = (phiDeg, thetaDeg) => [impact.x + radiusFt * Math.cos(phiDeg * DEG) * Math.cos(thetaDeg * DEG), impact.y + radiusFt * Math.cos(phiDeg * DEG) * Math.sin(thetaDeg * DEG), heightFt * Math.sin(phiDeg * DEG)];
    const cloud = [];
    for (let phi = 0; phi <= 90; phi += 7.5) for (let theta = 0; theta < 360; theta += 10) cloud.push(at(surface(phi, theta)));
    const outline = hull(cloud);
    const line = { fill: "none", stroke: C.target, "stroke-width": 1.4, ...(filled ? {} : { "stroke-dasharray": "6 5" }) };
    if (outline.length >= 3) g.append(svgNode("polygon", { points: pts(outline), ...(filled ? { fill: C.target, "fill-opacity": 0.2 } : { fill: "none" }), stroke: C.target, "stroke-width": 1.4, ...(filled ? {} : { "stroke-dasharray": "6 5" }), "data-3d-role": `${role}-outline` }));
    const ring = (phi) => Array.from({ length: 37 }, (_, i) => at(surface(phi, i * 10)));
    g.append(svgNode("polyline", { points: pts(ring(0)), ...line, "data-3d-role": `${role}-base` }));
    g.append(svgNode("polyline", { points: pts(ring(45)), ...line, "stroke-opacity": 0.5 }));
    const view = Math.atan2(eye[1] - impact.y, eye[0] - impact.x) / DEG;
    for (const theta of [view + 90, view]) {
      g.append(svgNode("polyline", { points: pts(Array.from({ length: 25 }, (_, i) => at(surface(i * 7.5, theta)))), ...line, "stroke-opacity": 0.5 }));
    }
  };
  if (fragment) dome(fragment.radiusFt, fragment.heightAglFt, false, "fragment-max");
  const fragmentNow = t === null ? null : fragmentAt(path, t);
  if (fragmentNow) dome(fragmentNow.radiusFt, fragmentNow.heightFt, true, "fragment-now");

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
  if (approach.length >= 2) add(polyline(approach.map(P), { stroke: BDP_3D_VIEW_V0_1.phaseColors.approach, "stroke-width": 2, "stroke-linejoin": "round", "data-3d-role": "path-approach" }));
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
    const tick = polyline([[q[0] - r[0] * wingFt, q[1] - r[1] * wingFt, q[2] - r[2] * wingFt], [q[0] + r[0] * wingFt, q[1] + r[1] * wingFt, q[2] + r[2] * wingFt]], { stroke: "#4b5866", "stroke-width": 1.2 });
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
    const off = (a, b) => [q[0] + v[0] * a * size + r[0] * b * size, q[1] + v[1] * a * size + r[1] * b * size, q[2] + v[2] * a * size + r[2] * b * size];
    add(polyline([[state.x, state.y, 0], q], { stroke: "#203a63", "stroke-width": 1, "stroke-dasharray": "2 3" }));
    const shadow = at([state.x, state.y, 0]);
    if (shadow) add(svgNode("circle", { cx: shadow.x.toFixed(1), cy: shadow.y.toFixed(1), r: 3, fill: "#8f9aa6", "data-3d-role": "aircraft-shadow" }));
    const delta = [off(1, 0), off(-0.6, 0.75), off(-0.35, 0), off(-0.6, -0.75)].map(at);
    if (delta.every(Boolean)) add(svgNode("polygon", { points: pts(delta), fill: "#203a63", stroke: "#ffffff", "stroke-width": 1, "data-3d-role": "aircraft" }));
  }

  // Title rows: orbit, altitude stretch, grid step; at t the aircraft's state.
  add(text({ x: 16, y: 24 }, `Orbit ${Math.round(orbit.azimuthDeg)}° / ${Math.round(orbit.elevationDeg)}° · Zoom ${Math.round(zoom * 100)}% · Grid ${stepNm} NM`, { "data-3d-role": "status" }));
  // Pan hint (0.1.2): the host's one-pointer gesture is in its pan phase (held 0.5 s, then drag).
  if (options.panHint) {
    add(svgNode("rect", { x: W - 86, y: 10, width: 72, height: 24, rx: 6, fill: "#203a63", "data-3d-role": "pan-hint" }));
    add(svgNode("text", { x: W - 50, y: 27, "text-anchor": "middle", fill: "#ffffff", "font-size": 13, "font-family": "system-ui, sans-serif", "font-weight": 700 }, "PAN"));
  }
  if (t !== null && !flying) add(text({ x: 16, y: 46 }, `Roll-in in ${(path.samples[0].t - t).toFixed(1)} s`, { "data-3d-role": "state" }));
  if (state) add(text({ x: 16, y: 46 }, `Roll-in ${t < 0 ? "−" : "+"}${Math.abs(t).toFixed(1)} s · ${String(state.phase).toUpperCase()} · ${Math.round(state.z)} ft AGL · ${Math.round(state.kcas)} KCAS · Bank ${Math.round(Math.abs(state.bankDeg))}°`, { "data-3d-role": "state" }));
  const legend = [
    ...(approach.length >= 2 ? [{ label: "Approach", color: BDP_3D_VIEW_V0_1.phaseColors.approach }] : []),
    { label: "Roll-in", color: BDP_3D_VIEW_V0_1.phaseColors["roll-in"] },
    { label: "Tracking", color: BDP_3D_VIEW_V0_1.phaseColors.tracking },
    ...(path.samples.some((s) => s.phase === "sem") ? [{ label: "SEM", color: BDP_3D_VIEW_V0_1.phaseColors.sem }] : []),
    ...(path.aim ? [{ label: "FPM line", color: C.flightPath, dashed: true }] : []),
    ...(fragment ? [{ label: "Fragment envelope (max)", color: C.target, dashed: true }] : []),
  ];
  const legendNotes = bdpSemLegendNotes(path);
  return { title: options.title ?? "3D Profile", orbit, zoom, pan, gridStepNm: stepNm, timeSec: t, state, legend, legendNotes, legendColumns: 0, canvas: { width: W, height: H } };
}

// SEM conditions and results under the 3D legend (owner handoff §4.5): the SEM flown, its Recovery G, G Onset
// Time and Recovery Speed; for the CLIMB SEM its Target FPA, G release start and Terminal G; the Level-off
// Altitude only where the SEM levels off (N/A for a CLIMB SEM, which shows its End Altitude instead).
export function bdpSemLegendNotes(path) {
  const sem = path?.sem;
  if (!sem) return [];
  const climb = sem.end === "CLIMB";
  const f = (value, digits, unit) => (Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : "N/A");
  const ft = (value) => (Number.isFinite(value) ? `${Math.round(value).toLocaleString("en-US")} ft MSL` : "N/A");
  const rows = [
    `SEM: ${climb ? "CSEM (climb)" : "Level SEM"}`,
    `Recovery G: ${f(sem.recoveryG, 1, " G")} · G Onset Time: ${f(sem.gOnsetTimeSec, 1, " s")} · Recovery Speed: ${f(sem.recoverySpeedKcas, 0, " KCAS")}`,
  ];
  if (climb) rows.push(`CSEM Target FPA: +${f(sem.targetFpaDeg, 0, "°")} · G Release Start: +${f(sem.gReleaseStartFpaDeg, 0, "°")} FPA · Terminal G: ${f(sem.terminalG, 3, " G")}`);
  rows.push(climb ? `Level-off Altitude: N/A · CSEM End Altitude: ${ft(sem.endAltitudeMslFt)}` : `Level-off Altitude: ${ft(sem.levelOffAltitudeMslFt)}`);
  return rows;
}
