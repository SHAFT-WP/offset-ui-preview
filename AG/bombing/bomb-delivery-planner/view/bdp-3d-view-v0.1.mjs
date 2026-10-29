import { svgNode } from "../../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { BDP_VIEW_COLORS as C } from "./bdp-view-style-v0.1.mjs";
import { BDP_F16_MESH_V0_1 as aircraftMesh } from "./bdp-f16-mesh-v0.1.mjs?v=0.1.0";
import { aircraftAxes, bombAt, flightStateAt, fragmentAt } from "./bdp-flight-path-v0.1.mjs?v=0.1.4";

// BDP 3D Profile v0.1 (owner 2026-10-15, BDP update R6; plan §4.6; research viewer SPEC §5.2 in SVG). A perspective
// picture of a BDP flight path (bdp-flight-path-v0.1): ground grid, Target, Aim-off Point, the path coloured by
// phase (Roll-in, Tracking, SEM) with its ground shadow, the FPM line from the Track Point to the Aim-off Point,
// wing ticks every 1 s (bank), the aircraft at time t, the bomb trajectory and the fragment envelope (0.1.1: a dome on the impact point;
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
  // 0.1.3 (2026-10-18, owner): legend notes — the CSEM shows its Min Altitude (no Level-off Altitude N/A), and the
  // fragment envelope drawn (max) its Height and Diameter.
  // 0.1.4 (2026-10-19, owner): the Level SEM turn (flight path 0.1.2) is drawn with its bank ticks; the legend notes
  // give the turn flown (type, heading change and side, G, bank, speed; a slice's minimum altitude).
  // 0.1.5 (2026-10-19, owner): flight path 0.1.3 — the path and the aircraft from Roll-in −3 s to 1 s after the SEM's
  // end (the aircraft stays at the end after it).
  // 0.1.6 (2026-10-19): the legend's thousands separators without Intl (its first use cost ~50 ms on a page).
  // 0.1.7 (2026-10-20, owner): the bomb trajectory from Release to Impact (flight path 0.1.4) and, at t, the bomb on
  // it; legend `Bomb trajectory`.
  // 0.1.8 (2026-10-21, owner: a smoother Play): what changes with t sits in three layers, in the former drawing order —
  // the fragment dome at t under the paths (`time-under`), the bomb and the aircraft over them (`time`), the state row
  // last (`time-text`). A call for the same path and view options with another t redraws only those layers; the rest
  // of the scene stays as drawn.
  // 0.1.9: absorb clock-origin subtraction roundoff at the first approach frame.
  // 0.1.10 (2026-10-29, owner): approved F-16 polygon mesh, uniformly scaled; heading/FPA/bank from the path.
  // 0.1.11 (2026-10-29, owner): aircraft size Auto or a multiple of the real dimensions, independent of view zoom.
  version: "0.1.11",
  canvas: Object.freeze({ width: 900, height: 560 }),
  gesture: Object.freeze({ holdMs: 500, slopCssPx: 8, minPinchCssPx: 10 }),
  zoomLimits: Object.freeze([0.5, 4]),
  aircraftScaleOptions: Object.freeze([1, 5, 10, 20, 30, 50]),
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

// A multiple of the real aircraft dimensions. null/omitted = the established scene-relative marker size.
export function bdp3dAircraftScale(radiusFt, requestedScale = null) {
  const choices = BDP_3D_VIEW_V0_1.aircraftScaleOptions;
  return Number.isFinite(requestedScale)
    ? Math.min(choices.at(-1), Math.max(choices[0], requestedScale))
    : radiusFt * 0.064 * 0.3048 / aircraftMesh.lengthM;
}

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

// The drawn scene of an SVG (0.1.8): its path, view key and the time-layer redraw.
const drawnScenes = new WeakMap();

export function renderBdp3dView(svg, path, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  if (!Array.isArray(path?.samples) || path.samples.length < 2) throw new TypeError("a BDP flight path is required");
  // t: seconds from the Roll-in Point (before it the aircraft is still on the approach and is not drawn).
  const t = Number.isFinite(options.timeSec) ? Math.min(options.timeSec, path.endT) : null;
  const viewKey = JSON.stringify({ ...options, timeSec: null });
  const scene = drawnScenes.get(svg);
  if (scene && scene.path === path && scene.viewKey === viewKey && svg.contains(scene.layers.time)) return scene.drawTime(t);
  const { width: W, height: H } = BDP_3D_VIEW_V0_1.canvas;
  const orbit = { ...bdp3dDefaultOrbit(path), ...(options.orbit ?? {}) };
  // The aircraft shows from the earliest known state (the host's approach, else the Roll-in Point).
  const firstT = path.approach?.[0]?.t ?? path.samples[0].t;
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
  const aircraftScale = bdp3dAircraftScale(radius, options.aircraftScale);
  const meshScale = aircraftScale / 0.3048; // Local mesh metres -> world feet, then the chosen size multiplier.
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
  const cameraForward = norm(sub(centre, eye));
  const aircraftLight = norm([-0.25, 0.35, 0.91]);
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
  const dome = (radiusFt, heightFt, filled, role, parent = root) => {
    if (!(radiusFt > 0 && heightFt > 0)) return;
    const g = parent.appendChild(svgNode("g", { "data-3d-role": role, "data-radius-ft": radiusFt.toFixed(1), "data-height-ft": heightFt.toFixed(1) }));
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
  // Under the paths: the fragment dome at t (0.1.8 time layer).
  const timeUnder = add(svgNode("g", { "data-3d-layer": "time-under" }));

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

  // Bomb trajectory (0.1.7): Release to Impact, the Dive Profile's colour; at t between them the bomb on it (time layer).
  const bomb = path.bomb ?? [];
  if (bomb.length >= 2) add(polyline(bomb.map(P), { stroke: C.bomb, "stroke-width": 2.4, "stroke-linejoin": "round", "stroke-linecap": "round", "data-3d-role": "path-bomb" }));
  // Over the paths: the bomb and the aircraft at t (0.1.8 time layer).
  const timeTop = add(svgNode("g", { "data-3d-layer": "time" }));

  // Title rows: orbit, altitude stretch, grid step; at t the aircraft's state (time layer).
  add(text({ x: 16, y: 24 }, `Orbit ${Math.round(orbit.azimuthDeg)}° / ${Math.round(orbit.elevationDeg)}° · Zoom ${Math.round(zoom * 100)}% · Grid ${stepNm} NM`, { "data-3d-role": "status" }));
  // Pan hint (0.1.2): the host's one-pointer gesture is in its pan phase (held 0.5 s, then drag).
  if (options.panHint) {
    add(svgNode("rect", { x: W - 86, y: 10, width: 72, height: 24, rx: 6, fill: "#203a63", "data-3d-role": "pan-hint" }));
    add(svgNode("text", { x: W - 50, y: 27, "text-anchor": "middle", fill: "#ffffff", "font-size": 13, "font-family": "system-ui, sans-serif", "font-weight": 700 }, "PAN"));
  }
  // Last: the state row at t (0.1.8 time layer).
  const timeText = add(svgNode("g", { "data-3d-layer": "time-text" }));
  const legend = [
    ...(approach.length >= 2 ? [{ label: "Approach", color: BDP_3D_VIEW_V0_1.phaseColors.approach }] : []),
    { label: "Roll-in", color: BDP_3D_VIEW_V0_1.phaseColors["roll-in"] },
    { label: "Tracking", color: BDP_3D_VIEW_V0_1.phaseColors.tracking },
    ...(path.samples.some((s) => s.phase === "sem") ? [{ label: "SEM", color: BDP_3D_VIEW_V0_1.phaseColors.sem }] : []),
    ...(bomb.length >= 2 ? [{ label: "Bomb trajectory", color: C.bomb }] : []),
    ...(path.aim ? [{ label: "FPM line", color: C.flightPath, dashed: true }] : []),
    ...(fragment ? [{ label: "Fragment envelope (max)", color: C.target, dashed: true }] : []),
  ];
  const legendNotes = bdpSemLegendNotes(path);
  const base = { title: options.title ?? "3D Profile", orbit, zoom, pan, aircraftScale, gridStepNm: stepNm, legend, legendNotes, legendColumns: 0, canvas: { width: W, height: H } };

  // The time layers at t: the fragment dome under the paths; the bomb, the aircraft (the approved F-16 mesh,
  // with its drop line and shadow) and the state row on top.
  const drawTime = (tNow) => {
    timeUnder.replaceChildren();
    timeTop.replaceChildren();
    timeText.replaceChildren();
    const put = (node) => { if (node) timeTop.append(node); return node; };
    const fragmentNow = tNow === null ? null : fragmentAt(path, tNow);
    if (fragmentNow) dome(fragmentNow.radiusFt, fragmentNow.heightFt, true, "fragment-now", timeUnder);
    const bombNow = tNow === null ? null : bombAt(path, tNow);
    const bombPoint = bombNow ? at(P(bombNow)) : null;
    if (bombPoint) put(svgNode("circle", { cx: bombPoint.x.toFixed(1), cy: bombPoint.y.toFixed(1), r: 4.5, fill: C.bomb, stroke: "#ffffff", "stroke-width": 1.2, "data-3d-role": "bomb" }));
    const flying = tNow !== null && tNow >= firstT - 1e-9;
    let state = null;
    if (flying) {
      state = flightStateAt(path, tNow);
      const { v, right: r, up: u } = aircraftAxes(state);
      // One scale for every axis; Auto keeps the original marker length, manual 1× gives the real dimensions.
      const q = P(state);
      const world = ([x, y, z]) => q.map((c, i) => c + meshScale * (r[i] * x + v[i] * y + u[i] * z));
      put(polyline([[state.x, state.y, 0], q], { stroke: "#203a63", "stroke-width": 1, "stroke-dasharray": "2 3" }));
      const shadow = at([state.x, state.y, 0]);
      if (shadow) put(svgNode("circle", { cx: shadow.x.toFixed(1), cy: shadow.y.toFixed(1), r: 3, fill: "#8f9aa6", "data-3d-role": "aircraft-shadow" }));
      const aircraft = svgNode("g", { "data-3d-role": "aircraft", "data-aircraft-mesh": aircraftMesh.id, "data-aircraft-scale": aircraftScale });
      const faces = aircraftMesh.faces.map(({ vertices, color }) => {
        const points = vertices.map(world);
        const midpoint = points[0].map((_, i) => points.reduce((sum, p) => sum + p[i], 0) / points.length);
        const a = sub(points[1], points[0]), b = sub(points[2], points[0]);
        let normal = norm([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]);
        // Wings/fins are two-sided surfaces. Light the side facing the camera; do not cull it after a bank.
        if (dot(normal, sub(eye, midpoint)) < 0) normal = normal.map((n) => -n);
        const shade = 0.72 + 0.35 * Math.max(0, dot(normal, aircraftLight));
        const fill = `rgb(${color.map((c) => Math.min(255, Math.round(c * shade))).join(",")})`;
        return { points: points.map(at), depth: dot(sub(midpoint, eye), cameraForward), fill };
      }).sort((a, b) => b.depth - a.depth); // Painter order: far faces before near faces, for this camera and pose.
      for (const face of faces) {
        if (face.points.every(Boolean)) aircraft.append(svgNode("polygon", { points: pts(face.points), fill: face.fill }));
      }
      if (aircraft.childNodes.length) put(aircraft);
    }
    const putText = (node) => { if (node) timeText.append(node); };
    if (tNow !== null && !flying) putText(text({ x: 16, y: 46 }, `Roll-in in ${(path.samples[0].t - tNow).toFixed(1)} s`, { "data-3d-role": "state" }));
    if (state) putText(text({ x: 16, y: 46 }, `Roll-in ${tNow < 0 ? "−" : "+"}${Math.abs(tNow).toFixed(1)} s · ${String(state.phase).toUpperCase()} · ${Math.round(state.z)} ft AGL · ${Math.round(state.kcas)} KCAS · Bank ${Math.round(Math.abs(state.bankDeg))}°`, { "data-3d-role": "state" }));
    return { ...base, timeSec: tNow, state };
  };
  drawnScenes.set(svg, { path, viewKey, layers: { under: timeUnder, time: timeTop, text: timeText }, drawTime });
  return drawTime(t);
}

// SEM conditions and results under the 3D legend (owner handoff §4.5): the SEM flown, its Recovery G, G Onset
// Time and Recovery Speed; for the CLIMB SEM its Target FPA, G release start and Terminal G; the Level-off
// Altitude where the SEM levels off, the CSEM's Min Altitude and End Altitude for a CLIMB SEM (0.1.3: no Level-off
// N/A); then the fragment envelope drawn (max, Fragment Height Margin applied): its Height and Diameter (2R).
export function bdpSemLegendNotes(path) {
  const sem = path?.sem;
  if (!sem) return [];
  const climb = sem.end === "CLIMB";
  const f = (value, digits, unit) => (Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : "N/A");
  const grouped = (value) => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const ft = (value, ref = "MSL") => (Number.isFinite(value) ? `${grouped(value)} ft${ref ? ` ${ref}` : ""}` : "N/A");
  const minMslFt = Number.isFinite(path.semMinAglFt) && Number.isFinite(path.targetElevationMslFt) ? path.semMinAglFt + path.targetElevationMslFt : null;
  const rows = [
    `SEM: ${climb ? "CSEM (climb)" : "Level SEM"}`,
    `Recovery G: ${f(sem.recoveryG, 1, " G")} · G Onset Time: ${f(sem.gOnsetTimeSec, 1, " s")} · Recovery Speed: ${f(sem.recoverySpeedKcas, 0, " KCAS")}`,
  ];
  if (climb) rows.push(`CSEM Target FPA: +${f(sem.targetFpaDeg, 0, "°")} · G Release Start: +${f(sem.gReleaseStartFpaDeg, 0, "°")} FPA · Terminal G: ${f(sem.terminalG, 3, " G")}`);
  rows.push(climb ? `CSEM Min Altitude: ${ft(minMslFt)} · CSEM End Altitude: ${ft(sem.endAltitudeMslFt)}` : `Level-off Altitude: ${ft(sem.levelOffAltitudeMslFt)}`);
  // 0.1.4: the Level SEM turn from the level-off (BDP v0.4.3).
  const turn = climb ? null : sem.turn;
  if (turn) {
    const slice = turn.flownType === "SLICE";
    const g = turn.mode === "FULL" ? f(turn.loadFactorG, 1, " G") : `${f(turn.peakLoadFactorG, 1, " G")} (reduced)`;
    const bank = turn.bankAuto ? `Bank AUTO ${f(turn.bankDeg, 0, "°")}` : `Bank ${f(turn.bankDeg, 0, "°")}`;
    rows.push(`SEM Turn: ${slice ? "Slice" : "Level"} ${f(turn.headingChangeDeg, 0, "°")} ${turn.direction === "LEFT" ? "Left" : "Right"} · ${g} · ${bank} · ${f(turn.speedKcas, 0, " KCAS")}${slice ? ` · Min Altitude: ${ft(minMslFt)}` : ""}`);
  }
  const frag = path.fragment;
  if (frag) rows.push(`Fragment Height: ${ft(frag.heightAglFt, "AGL")} · Fragment Diameter: ${ft(2 * frag.radiusFt, "")} (max${Number.isFinite(frag.marginPercent) ? `, ${frag.marginPercent}% margin${frag.marginAppliesTo === "HEIGHT" ? " on height" : ""}` : ""})`);
  return rows;
}
