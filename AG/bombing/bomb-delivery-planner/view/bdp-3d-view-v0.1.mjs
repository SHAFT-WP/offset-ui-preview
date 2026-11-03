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
  // 0.1.12 (2026-10-29, owner): the HUD overlays this scene through its own first-person camera.
  // 0.1.17 (2026-11-01, owner): options.bankLineScale sets the 1 s bank (wing) line length (0: off; default 1); the bomb
  // at t is a 2D bomb outline (Mk-82 LD size) along its flight direction, at the F-16's scale, at least 28 view units long; olive with a white edge, so
  // it shows on its green trajectory.
  // 0.1.18 (2026-11-01, owner "폭탄의 배율은 f16 모형이랑 같게"): the bomb outline has no minimum size; it is drawn
  // at the F-16 mesh's scale in every Aircraft size mode.
  // 0.1.19 (2026-11-01, owner screenshot: the wings turned white in the POP-UP climb): every face goes into the merged
  // fill paths with the same screen winding. Two faces of one fill wound opposite ways (a wing's upper and lower
  // skins, lit alike when seen wings-level) cancelled under the nonzero rule and left the wing unpainted.
  // 0.1.20 (2026-11-01, owner): the bomb at t is black (white edge kept); zoom in has no upper limit (zoomLimits
  // [0.5, ∞]), so a 1× (real-size) aircraft can be enlarged on screen.
  // 0.1.21 (owner 2026-11-03, "허드뷰에서도 3d 전투기와 폭탄이 보이더록 해줘"): the cockpit camera (HUD) draws the
  // Flight's other aircraft it is given (`fleet`: number, state, path) and every bomb in the air (its own and theirs);
  // each is enlarged only as far as it needs to stay visible (an F-16 at least cockpitMinUnits.aircraft view units long,
  // a bomb cockpitMinUnits.bomb), never smaller than real; a bomb seen end-on also gets a dot. The cockpit's aircraft get a
  // light rim (`cockpitStyle.halo`) and their numbers in `cockpitStyle.label` / `labelHalo`, and `gridColor` tints the
  // cockpit grid (all from the HUD's theme).
  // 0.1.22 (owner 2026-11-03): the outside view's bomb is twice the F-16 mesh scale and has a white halo under its
  // black body, so it stands out on the sky, the ground and its trajectory; `cockpitAircraftScale` (a number) draws the
  // cockpit's aircraft at that multiple of their real size instead of the Auto enlargement.
  version: "0.1.22",
  bombScaleFactor: 2,
  cockpitMinUnits: Object.freeze({ aircraft: 56, bomb: 18 }),
  canvas: Object.freeze({ width: 900, height: 560 }),
  gesture: Object.freeze({ holdMs: 500, slopCssPx: 8, minPinchCssPx: 10 }),
  zoomLimits: Object.freeze([0.5, Infinity]),
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

// First-person projection in world feet. Clip geometry before the perspective divide: simply dropping
// points behind the eye joins unrelated visible runs and makes long grid lines jump across the HUD.
// The five half-spaces are the near plane (1 ft) and the viewport sides; there is no far distance cutoff.
export function bdp3dCameraProjection({ eye, forward, right, up, fovDeg, width, height }) {
  const focal = height / 2 / Math.tan(fovDeg * DEG / 2);
  const tx = width / (2 * focal), ty = height / (2 * focal);
  const planes = [(p) => p[2] - 1, (p) => p[0] + tx * p[2], (p) => tx * p[2] - p[0],
    (p) => p[1] + ty * p[2], (p) => ty * p[2] - p[1]];
  const cameraPoint = (q) => { const d = sub(q, eye); return [dot(d, right), dot(d, up), dot(d, forward)]; };
  const screen = (p) => ({ x: width / 2 + focal * p[0] / p[2], y: height / 2 - focal * p[1] / p[2] });
  const mix = (a, b, k) => a.map((n, i) => n + k * (b[i] - n));
  const point = (q) => { const p = cameraPoint(q); return p[2] >= 1 ? screen(p) : null; };
  const segment = (a, b) => {
    let p = cameraPoint(a), q = cameraPoint(b);
    for (const plane of planes) {
      const dp = plane(p), dq = plane(q);
      if (dp < 0 && dq < 0) return null;
      if ((dp < 0) !== (dq < 0)) {
        const hit = mix(p, q, dp / (dp - dq));
        if (dp < 0) p = hit; else q = hit;
      }
    }
    return [screen(p), screen(q)];
  };
  const polygon = (points) => {
    let clipped = points.map(cameraPoint);
    for (const plane of planes) {
      const out = [];
      clipped.forEach((a, i) => {
        const b = clipped[(i + 1) % clipped.length], da = plane(a), db = plane(b);
        if (da >= 0) out.push(a);
        if ((da < 0) !== (db < 0)) out.push(mix(a, b, da / (da - db)));
      });
      clipped = out;
    }
    return clipped.map(screen);
  };
  return { point, segment, polygon };
}

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

// 0.1.16 (Play speed): the F-16 mesh as flat arrays, built once: vertex xyz, each face's first vertex, its colour.
const MESH = (() => {
  const faces = aircraftMesh.faces;
  const start = new Int32Array(faces.length + 1);
  let n = 0;
  faces.forEach((face, i) => { start[i] = n; n += face.vertices.length; });
  start[faces.length] = n;
  const xyz = new Float64Array(n * 3);
  faces.forEach((face, i) => face.vertices.forEach((p, k) => xyz.set(p, (start[i] + k) * 3)));
  return { start, xyz, colors: faces.map((face) => face.color), count: faces.length, vertexCount: n };
})();

// One aircraft's faces on the screen for the external camera: the same shading and painter depth as the SVG faces
// (two-sided, lit from aircraftLight, shade in 0.05 steps), faces under 0.2 px² or behind the eye left out.
const MESH_LIGHT = norm([-0.25, 0.35, 0.91]);
function projectMesh(q, r, v, u, meshScale, eye, cameraForward, toScreen) {
  const { start, xyz, colors, count, vertexCount } = MESH;
  const wx = new Float64Array(vertexCount * 3), sx = new Float64Array(vertexCount), sy = new Float64Array(vertexCount), ok = new Uint8Array(vertexCount);
  for (let k = 0; k < vertexCount; k++) {
    const x = xyz[3 * k] * meshScale, y = xyz[3 * k + 1] * meshScale, z = xyz[3 * k + 2] * meshScale;
    const X = q[0] + r[0] * x + v[0] * y + u[0] * z, Y = q[1] + r[1] * x + v[1] * y + u[1] * z, Z = q[2] + r[2] * x + v[2] * y + u[2] * z;
    wx[3 * k] = X; wx[3 * k + 1] = Y; wx[3 * k + 2] = Z;
    const screen = toScreen.length === 3 ? toScreen(X, Y, Z) : toScreen([X, Y, Z]);
    if (screen) { sx[k] = screen.x; sy[k] = screen.y; ok[k] = 1; }
  }
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = start[i], b = start[i + 1];
    let visible = true, area = 0, mx = 0, my = 0, mz = 0;
    for (let k = a; k < b; k++) {
      if (!ok[k]) { visible = false; break; }
      const k2 = k + 1 < b ? k + 1 : a;
      area += sx[k] * sy[k2] - sx[k2] * sy[k];
      mx += wx[3 * k]; my += wx[3 * k + 1]; mz += wx[3 * k + 2];
    }
    if (!visible || Math.abs(area) / 2 < 0.2) continue;
    const m = b - a; mx /= m; my /= m; mz /= m;
    const e1 = [wx[3 * (a + 1)] - wx[3 * a], wx[3 * (a + 1) + 1] - wx[3 * a + 1], wx[3 * (a + 1) + 2] - wx[3 * a + 2]];
    const e2 = [wx[3 * (a + 2)] - wx[3 * a], wx[3 * (a + 2) + 1] - wx[3 * a + 1], wx[3 * (a + 2) + 2] - wx[3 * a + 2]];
    let normal = norm([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]);
    if (dot(normal, [eye[0] - mx, eye[1] - my, eye[2] - mz]) < 0) normal = normal.map((n) => -n);
    const shade = Math.round((0.72 + 0.35 * Math.max(0, dot(normal, MESH_LIGHT))) * 20) / 20;
    const fill = `rgb(${colors[i].map((c) => Math.min(255, Math.round(c * shade))).join(",")})`;
    // One screen winding for every face (0.1.19): faces merged into one fill path never cancel under nonzero.
    const points = [];
    if (area > 0) for (let k = a; k < b; k++) points.push(sx[k], sy[k]);
    else for (let k = b - 1; k >= a; k--) points.push(sx[k], sy[k]);
    out.push({ points, fill, depth: (mx - eye[0]) * cameraForward[0] + (my - eye[1]) * cameraForward[1] + (mz - eye[2]) * cameraForward[2] });
  }
  return out;
}

// 0.1.16: a canvas inside a foreignObject covering the view box, so it scales and is removed with the SVG. Its
// pixels follow the SVG's on-screen width (ResizeObserver) times the device pixel ratio.
const svgCssWidth = new WeakMap();
let svgResize = null;
function canvasScale(svg, W) {
  if (typeof ResizeObserver === "function" && svg?.isConnected && !svgCssWidth.has(svg)) {
    svgResize ??= new ResizeObserver((entries) => entries.forEach((entry) => { if (entry.contentRect.width > 0) svgCssWidth.set(entry.target, entry.contentRect.width); }));
    svgCssWidth.set(svg, svg.getBoundingClientRect().width); // first draw: measure once, then the observer keeps it
    svgResize.observe(svg);
  }
  const cssWidth = svgCssWidth.get(svg) || W;
  return Math.min(4, Math.max(1, (globalThis.devicePixelRatio || 1) * cssWidth / W));
}
// keep: one layer per SVG, re-attached on each full redraw (a new canvas and context every frame is slow).
const keptLayers = new WeakMap();
// under: the canvas is an HTML sibling just before the SVG, filling the SVG's box beneath it (the SVG is drawn on top
// with a transparent background); it stays in the page while the SVG is rebuilt. Else it sits in a foreignObject.
export function bdpCanvasLayer(sizeSvg, W, H, attrs = {}, { keep = false, under = false } = {}) {
  const kept = keep ? keptLayers.get(sizeSvg) : null;
  if (kept && kept.W === W && kept.H === H && (!under || kept.canvas.isConnected)) return kept;
  const host = under ? sizeSvg.parentElement : null;
  const foreign = host ? null : svgNode("foreignObject", { x: 0, y: 0, width: W, height: H, "pointer-events": "none", ...attrs });
  const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  if (host) {
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    // SVG elements have no offset* metrics: the canvas fills the host, which holds only this SVG.
    sizeSvg.style.position = "relative";
    sizeSvg.style.background = "transparent";
    canvas.setAttribute("style", "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none");
    Object.entries(attrs).forEach(([key, value]) => canvas.setAttribute(key, value));
    host.insertBefore(canvas, sizeSvg);
  } else foreign.append(canvas);
  if (!host) canvas.setAttribute("style", "display:block;width:100%;height:100%;pointer-events:none");
  const layer = { foreign, canvas, ctx: canvas.getContext("2d"), k: 0,
    // Clear and size the canvas for the SVG's current on-screen width; drawing is in view-box units.
    begin() {
      const k = canvasScale(sizeSvg, W);
      const width = Math.round(W * k), height = Math.round(H * k);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      layer.k = k;
      layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
      layer.ctx.clearRect(0, 0, width, height);
      layer.ctx.setTransform(k, 0, 0, k, 0, 0);
      return layer.ctx;
    }, W, H };
  if (keep) keptLayers.set(sizeSvg, layer);
  return layer;
}
// Painter order (far first); consecutive faces of one fill are filled as one path.
function paintFaces(ctx, faces) {
  faces.sort((a, b) => b.depth - a.depth);
  let fill = null;
  for (const face of faces) {
    if (face.fill !== fill) { if (fill) ctx.fill(); fill = face.fill; ctx.fillStyle = fill; ctx.beginPath(); }
    const p = face.points;
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.closePath();
  }
  if (fill) ctx.fill();
}
// An SVG stroke's attributes on a canvas path already built.
function strokeLike(ctx, attrs) {
  ctx.strokeStyle = attrs.stroke ?? "#000";
  ctx.lineWidth = Number(attrs["stroke-width"] ?? 1);
  ctx.globalAlpha = Number(attrs["stroke-opacity"] ?? 1);
  ctx.setLineDash(attrs["stroke-dasharray"] ? String(attrs["stroke-dasharray"]).split(/[ ,]+/).map(Number) : []);
  ctx.lineCap = attrs["stroke-linecap"] ?? "butt";
  ctx.lineJoin = attrs["stroke-linejoin"] ?? "miter";
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// 0.1.17: a Mk-82 LD side outline in metres (along the body, across it): 2.22 m long, 0.274 m body, tail fins.
// Lengths for the cockpit enlargement (0.1.21): the F-16 display mesh and the Mk-82 LD outline, in feet.
const F16_LENGTH_FT = aircraftMesh.lengthM / 0.3048;
const BOMB_LENGTH_FT = 2.22 / 0.3048;
const BOMB_OUTLINE_M = (() => {
  const upper = [[1.11, 0], [0.98, 0.06], [0.75, 0.115], [0.45, 0.137], [-0.55, 0.137], [-0.78, 0.1], [-0.82, 0.1], [-1.06, 0.2], [-1.11, 0.2], [-1.11, 0.04]];
  return [...upper, ...upper.slice(1, -1).reverse().map(([a, b]) => [a, -b])];
})();
// The bomb at t drawn as its outline facing the camera along its flight direction, at the aircraft mesh's scale.
// Null (draw a dot) only when its direction is unknown.
function bombOutline(path, t, bomb, eye, meshScale, at, P) {
  const bombs = path.bomb ?? [];
  const lastT = bombs.at(-1)?.t;
  const step = 0.05;
  const ahead = Number.isFinite(lastT) && t + step <= lastT ? bombAt(path, t + step) : null;
  const behind = ahead ? null : bombAt(path, t - step);
  const q = P(bomb);
  const dir = ahead ? norm(sub(P(ahead), q)) : behind ? norm(sub(q, P(behind))) : null;
  if (!dir || !(Math.hypot(...dir) > 0.5)) return null;
  const view = sub(q, eye);
  let side = [dir[1] * view[2] - dir[2] * view[1], dir[2] * view[0] - dir[0] * view[2], dir[0] * view[1] - dir[1] * view[0]];
  if (Math.hypot(...side) < 1e-6) side = Math.abs(dir[2]) < 0.9 ? [dir[1], -dir[0], 0] : [1, 0, 0];
  side = norm(side);
  const points = BOMB_OUTLINE_M.map(([a, b]) => at([0, 1, 2].map((i) => q[i] + meshScale * (dir[i] * a + side[i] * b))));
  if (!points.every(Boolean)) return null;
  // 0.1.18 (owner): exactly the F-16 mesh's scale (Auto or N×), no minimum size: the bomb keeps its real
  // proportion to the aircraft drawn (a Mk-82 is about 1/7 of the F-16's length).
  return `M${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("L")}Z`;
}

const groundExtents = new WeakMap();
function groundExtent(path, extraAircraft, ground) {
  const key = extraAircraft.map((a) => scenePathId(a.path)).join();
  const kept = groundExtents.get(path);
  if (kept?.key === key) return kept.extent;
  const extent = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (const p of ground()) {
    if (p.x < extent.minX) extent.minX = p.x;
    if (p.x > extent.maxX) extent.maxX = p.x;
    if (p.y < extent.minY) extent.minY = p.y;
    if (p.y > extent.maxY) extent.maxY = p.y;
    if (p.z > extent.maxZ) extent.maxZ = p.z;
  }
  groundExtents.set(path, { key, extent });
  return extent;
}
const drawnScenes = new WeakMap();
const scenePathIds = new WeakMap();
let nextScenePathId = 0;
const scenePathId = path => { if (!scenePathIds.has(path)) scenePathIds.set(path, ++nextScenePathId); return scenePathIds.get(path); };
const fleetColor = number => ({ 1: '#4c5966', 2: '#8a3ab9', 3: '#2f9e6e', 4: '#b5651d' })[number] ?? '#203a63';

export function renderBdp3dView(svg, path, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  if (!Array.isArray(path?.samples) || path.samples.length < 2) throw new TypeError("a BDP flight path is required");
  // t: seconds from the Roll-in Point (before it the aircraft is still on the approach and is not drawn).
  const fleet = options.camera ? [] : options.fleet ?? [];
  // 0.1.21: the cockpit's other aircraft (the HUD's Flight), each { number, state, path }.
  const cockpitFleet = options.camera && Array.isArray(options.fleet) ? options.fleet.filter((a) => a && Number.isFinite(a.number)) : [];
  const t = Number.isFinite(options.timeSec) ? (fleet.length ? options.timeSec : Math.min(options.timeSec, path.endT)) : null;
  const cockpit = !!options.camera;
  // The cockpit (HUD) redraws its whole picture every frame and never reuses a scene: no key.
  const viewKey = cockpit ? null : JSON.stringify({ ...options, fleet: fleet.map(a => [a.number, scenePathId(a.path)]), timeSec: null });
  const scene = drawnScenes.get(svg);
  if (!cockpit && scene && scene.path === path && scene.viewKey === viewKey && svg.contains(scene.layers.time)) return scene.drawTime(t);
  const { width: W, height: H } = cockpit ? options.camera : BDP_3D_VIEW_V0_1.canvas;
  const orbit = { ...bdp3dDefaultOrbit(path), ...(options.orbit ?? {}) };
  // The aircraft shows from the earliest known state (the host's approach, else the Roll-in Point).
  const firstT = path.approach?.[0]?.t ?? path.samples[0].t;
  const P = (p) => [p.x, p.y, p.z];

  // Ground square: the path, Target, Aim-off Point and the fragment radius, on a round grid step.
  const fragment = path.fragment;
  const approach = path.approach ?? [];
  const impact = fragment?.impact ?? path.target;
  const extraAircraft = fleet.filter(a => a.path !== path);
  let groundList = null;
  const ground = () => (groundList ??= [...approach, ...path.samples, path.target, ...(path.aim ? [path.aim] : []), ...extraAircraft.flatMap(a => [...(a.path.approach ?? []), ...a.path.samples, a.path.target])]);
  const pad = Math.max(0.3 * FT_PER_NM, fragment ? fragment.radiusFt * 1.1 : 0);
  // 0.1.16: the extents in one pass, kept per path (the HUD asks every frame for the same path).
  const extent = groundExtent(path, extraAircraft, ground);
  let minX = Math.min(extent.minX, impact.x - pad);
  let maxX = Math.max(extent.maxX, impact.x + pad);
  let minY = Math.min(extent.minY, impact.y - pad);
  let maxY = Math.max(extent.maxY, impact.y + pad);
  const spanNm = Math.max(maxX - minX, maxY - minY) / FT_PER_NM;
  const stepNm = GRID_STEPS_NM.find((step) => spanNm / step <= 10) ?? GRID_STEPS_NM.at(-1);
  const stepFt = stepNm * FT_PER_NM;
  minX = Math.floor(minX / stepFt) * stepFt;
  maxX = Math.ceil(maxX / stepFt) * stepFt;
  minY = Math.floor(minY / stepFt) * stepFt;
  maxY = Math.ceil(maxY / stepFt) * stepFt;
  const maxZ = Math.max(extent.maxZ, fragment ? fragment.heightAglFt : 0);

  // Perspective eye on the orbit around the scene centre, three scene radii away. The centre is fixed for the path
  // (0.1.2): it projects to the same screen point for every orbit, so a drag turns the picture about it.
  const centre = [(minX + maxX) / 2, (minY + maxY) / 2, maxZ / 3];
  const radius = Math.hypot(maxX - minX, maxY - minY, maxZ) / 2;
  const aircraftScale = cockpit ? 1 : bdp3dAircraftScale(radius, options.aircraftScale);
  const meshScale = aircraftScale / 0.3048; // Local mesh metres -> world feet, then the chosen size multiplier.
  const makeCamera = ({ azimuthDeg, elevationDeg }) => {
    const az = azimuthDeg * DEG;
    const el = elevationDeg * DEG;
    const eyeAt = [centre[0] + 3 * radius * Math.sin(az) * Math.cos(el), centre[1] + 3 * radius * Math.cos(az) * Math.cos(el), centre[2] + 3 * radius * Math.sin(el)];
    const forward = norm(sub(centre, eyeAt));
    const right = norm([forward[1], -forward[0], 0]);
    const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
    return {
      eye: eyeAt, forward, right, up,
      project(q) {
        const d = sub(q, eyeAt);
        const depth = dot(d, forward);
        return depth > 1 ? { u: dot(d, right) / depth, v: dot(d, up) / depth } : null;
      },
    };
  };
  const cam = makeCamera(orbit);
  const eye = cockpit ? options.camera.eye : cam.eye;
  const cameraForward = cockpit ? options.camera.forward : norm(sub(centre, eye));
  const projection = cockpit ? bdp3dCameraProjection(options.camera) : null;
  // 0.1.21: how much a thing of `lengthFt` at point q must be enlarged in the cockpit to be at least `minUnits` long
  // on screen (1 = real size; never smaller).
  const cockpitFocal = cockpit ? options.camera.height / 2 / Math.tan((options.camera.fovDeg * DEG) / 2) : 0;
  const cockpitEnlarge = (q, lengthFt, minUnits) => {
    const depth = dot(sub(q, eye), cameraForward);
    if (lengthFt === F16_LENGTH_FT && Number.isFinite(options.cockpitAircraftScale) && options.cockpitAircraftScale > 0) return options.cockpitAircraftScale;
    if (!(depth > 1) || !(cockpitFocal > 0)) return 1;
    return Math.max(1, minUnits / (cockpitFocal * lengthFt / depth));
  };
  const aircraftLight = norm([-0.25, 0.35, 0.91]);
  // Fit (0.1.2): from the default orbit, so the scale and the centre's screen point stay put while the orbit turns;
  // a new path or Reset View is the only refit. The ground square's corners, the path and the dome's top fill the
  // canvas below the title rows at the default orbit.
  let scale = 1, ox = 0, oy = 0;
  if (!cockpit) {
    const fitCam = makeCamera(bdp3dDefaultOrbit(path));
    const fitPoints = [[minX, minY, 0], [maxX, minY, 0], [maxX, maxY, 0], [minX, maxY, 0], ...ground().map(P)];
    if (fragment) fitPoints.push([impact.x, impact.y, fragment.heightAglFt]);
    const fitted = fitPoints.map((q) => fitCam.project(q)).filter(Boolean);
    const uMin = Math.min(...fitted.map((p) => p.u));
    const uMax = Math.max(...fitted.map((p) => p.u));
    const vMin = Math.min(...fitted.map((p) => p.v));
    const vMax = Math.max(...fitted.map((p) => p.v));
    const box = { left: 40, right: W - 24, top: 76, bottom: H - 20 };
    scale = Math.min((box.right - box.left) / Math.max(uMax - uMin, 1e-9), (box.bottom - box.top) / Math.max(vMax - vMin, 1e-9));
    ox = (box.left + box.right) / 2 - (scale * (uMin + uMax)) / 2;
    oy = (box.top + box.bottom) / 2 + (scale * (vMin + vMax)) / 2;
  }
  // Then the host's zoom about the canvas centre and pan (canvas px).
  const zoom = Math.min(BDP_3D_VIEW_V0_1.zoomLimits[1], Math.max(BDP_3D_VIEW_V0_1.zoomLimits[0], Number(options.zoom) || 1));
  const pan = { x: Number(options.pan?.x) || 0, y: Number(options.pan?.y) || 0 };
  const at = (q) => {
    if (projection) return projection.point(q);
    const c = cam.project(q);
    return c ? { x: W / 2 + zoom * (ox + scale * c.u - W / 2) + pan.x, y: H / 2 + zoom * (oy - scale * c.v - H / 2) + pan.y } : null;
  };
  // 0.1.16: the cockpit camera can draw its world on the host's canvas (options.ctx, view-box units): lines and the
  // aircraft mesh are painted there instead of becoming SVG elements (the HUD redraws its world every frame).
  const ink = cockpit ? options.ctx ?? null : null;
  // at() for the external camera without allocations (one reused result), for the aircraft mesh's vertices.
  const fastScreen = { x: 0, y: 0 };
  const fastAt = projection ? null : (X, Y, Z) => {
    const dx = X - cam.eye[0], dy = Y - cam.eye[1], dz = Z - cam.eye[2];
    const depth = dx * cam.forward[0] + dy * cam.forward[1] + dz * cam.forward[2];
    if (!(depth > 1)) return null;
    const u = (dx * cam.right[0] + dy * cam.right[1] + dz * cam.right[2]) / depth, v = (dx * cam.up[0] + dy * cam.up[1] + dz * cam.up[2]) / depth;
    fastScreen.x = W / 2 + zoom * (ox + scale * u - W / 2) + pan.x;
    fastScreen.y = H / 2 + zoom * (oy - scale * v - H / 2) + pan.y;
    return fastScreen;
  };
  const pts = (list) => list.filter(Boolean).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const polyline = (list, attrs) => {
    if (projection) {
      const segments = list.slice(1).map((q, i) => projection.segment(list[i], q)).filter(Boolean);
      if (ink) {
        if (!segments.length) return null;
        ink.beginPath();
        for (const [a, b] of segments) { ink.moveTo(a.x, a.y); ink.lineTo(b.x, b.y); }
        strokeLike(ink, attrs);
        return null;
      }
      return segments.length ? svgNode("path", { d: segments.map(([a, b]) => `M${a.x.toFixed(1)},${a.y.toFixed(1)}L${b.x.toFixed(1)},${b.y.toFixed(1)}`).join(""), fill: "none", ...attrs }) : null;
    }
    const q = list.map(at).filter(Boolean);
    return q.length >= 2 ? svgNode("polyline", { points: pts(q), fill: "none", ...attrs }) : null;
  };
  const text = (p, value, attrs = {}) => (p ? svgNode("text", { x: p.x.toFixed(1), y: p.y.toFixed(1), fill: "#203a63", "font-size": 13, "font-family": "system-ui, sans-serif", "font-weight": 600, stroke: "#ffffff", "stroke-width": 3, "paint-order": "stroke", ...attrs }, value) : null);

  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.style.aspectRatio = `${W} / ${H}`;
  svg.setAttribute("aria-label", options.title ?? "3D Profile");
  const root = svgNode("g", { "data-view": BDP_3D_VIEW_V0_1.id, ...(cockpit ? { "data-camera": "cockpit" } : {}) });
  svg.append(root);
  const add = (node) => { if (node) root.append(node); return node; };
  if (!cockpit) add(svgNode("rect", { x: 0, y: 0, width: W, height: H, fill: "#ffffff" }));

  // Ground and grid.
  if (cockpit) {
    // A world-anchored grid extends beyond the path bounds. Only its distant ends fade;
    // the HUD's horizon fill supplies one continuous ground colour underneath.
    const gridStep = options.gridStepFt ?? stepFt;
    const reach = Math.max(gridStep * 40, Math.abs(eye[2]) * 30);
    const cx = Math.round(eye[0] / gridStep) * gridStep;
    const cy = Math.round(eye[1] / gridStep) * gridStep;
    const count = Math.min(100, Math.ceil(reach / gridStep));
    const extent = count * gridStep;
    // 0.1.15 (Play speed): the grid's segments go into one <path> per opacity step (0.05) instead of one element each.
    const gridRuns = new Map();
    for (let k = -count; k <= count; k++) {
      for (const vertical of [true, false]) {
        const offset = k * gridStep;
        const alpha = Math.max(0, 1 - (Math.abs(offset) / extent) ** 2) * 0.65;
        for (let j = -4; j < 4; j++) {
          const a = j * extent / 4, b = (j + 1) * extent / 4;
          const fade = 1 - (Math.max(Math.abs(a), Math.abs(b)) / extent) ** 2;
          const points = vertical ? [[cx + offset, cy + a, 0], [cx + offset, cy + b, 0]] : [[cx + a, cy + offset, 0], [cx + b, cy + offset, 0]];
          if (alpha * fade <= 0.01) continue;
          const seg = projection.segment(points[0], points[1]);
          if (!seg) continue;
          const level = Math.max(1, Math.round(alpha * fade * 20));
          if (ink) { (gridRuns.get(level) ?? gridRuns.set(level, []).get(level)).push(seg); continue; }
          if (!gridRuns.has(level)) gridRuns.set(level, []);
          gridRuns.get(level).push(`M${seg[0].x.toFixed(1)},${seg[0].y.toFixed(1)}L${seg[1].x.toFixed(1)},${seg[1].y.toFixed(1)}`);
        }
      }
    }
    if (ink) for (const [level, segs] of [...gridRuns].sort((a, b) => a[0] - b[0])) {
      ink.beginPath();
      for (const [a, b] of segs) { ink.moveTo(a.x, a.y); ink.lineTo(b.x, b.y); }
      strokeLike(ink, { stroke: options.gridColor ?? "#72816b", "stroke-width": 1, "stroke-opacity": level / 20 });
    }
    else for (const [level, d] of [...gridRuns].sort((a, b) => a[0] - b[0])) add(svgNode("path", { d: d.join(""), fill: "none", stroke: options.gridColor ?? "#72816b", "stroke-width": 1, "stroke-opacity": level / 20, "data-3d-role": "grid" }));
  } else {
    const corners = [[minX, minY, 0], [maxX, minY, 0], [maxX, maxY, 0], [minX, maxY, 0]];
    add(svgNode("polygon", { points: pts(corners.map(at)), fill: "#f1f4ee", stroke: "#b8c2cc", "stroke-width": 1, "data-3d-role": "ground" }));
    for (let x = minX + stepFt; x < maxX - 1; x += stepFt) add(polyline([[x, minY, 0], [x, maxY, 0]], { stroke: "#d3dae2", "stroke-width": 1, "data-3d-role": "grid" }));
    for (let y = minY + stepFt; y < maxY - 1; y += stepFt) add(polyline([[minX, y, 0], [maxX, y, 0]], { stroke: "#d3dae2", "stroke-width": 1, "data-3d-role": "grid" }));
  }

  // Ground shadow of the path and drop lines at the Roll-in Point, Track Point and Release.
  add(polyline([...approach, ...path.samples].map((s) => [s.x, s.y, 0]), { stroke: "#8f9aa6", "stroke-width": 1.4, "stroke-opacity": 0.7, "data-3d-role": "shadow" }));
  const marks = [[path.samples[0], "Roll-in"], [path.trackPoint, "Track Point"], ...(path.releaseT > path.trackPointT ? [[path.release, "Release"]] : [])];
  for (const [p] of marks) add(polyline([[p.x, p.y, 0], P(p)], { stroke: "#8f9aa6", "stroke-width": 1, "stroke-dasharray": "3 3", "data-3d-role": "drop-line" }));

  // Fragment dome on the impact point: (x² + y²)/R² + z²/H² = 1 above the ground. Its outline is the convex hull of
  // surface points; two meridians and a mid ring give its shape. Largest size dashed, size at t filled.
  const dome = (radiusFt, heightFt, filled, role, parent = root) => {
    if (!(radiusFt > 0 && heightFt > 0)) return;
    const g = parent.appendChild(svgNode("g", { "data-3d-role": role, "data-radius-ft": radiusFt.toFixed(1), "data-height-ft": heightFt.toFixed(1) }));
    const surface = (phiDeg, thetaDeg) => [impact.x + radiusFt * Math.cos(phiDeg * DEG) * Math.cos(thetaDeg * DEG), impact.y + radiusFt * Math.cos(phiDeg * DEG) * Math.sin(thetaDeg * DEG), (impact.z ?? 0) + heightFt * Math.sin(phiDeg * DEG)];
    if (cockpit) {
      // In the cockpit use clipped wire rings: a convex hull of only visible points is not a valid
      // silhouette when the dome crosses the eye plane. The same world R/H and timing still apply.
      const style = { stroke: C.target, "stroke-width": filled ? 2 : 1.4, ...(filled ? {} : { "stroke-dasharray": "6 5" }) };
      const put = (points, attrs = {}) => { const node = polyline(points, { ...style, ...attrs }); if (node) g.append(node); };
      for (const phi of [0, 45]) put(Array.from({ length: 37 }, (_, i) => surface(phi, i * 10)), { "data-3d-role": `${role}-${phi === 0 ? "base" : "mid"}` });
      const view = Math.atan2(eye[1] - impact.y, eye[0] - impact.x) / DEG;
      for (const theta of [view, view + 90]) put(Array.from({ length: 25 }, (_, i) => surface(i * 7.5, theta)));
      return;
    }
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
  if (tgt && !cockpit) {
    add(svgNode("circle", { cx: tgt.x.toFixed(1), cy: tgt.y.toFixed(1), r: 6, fill: "none", stroke: C.target, "stroke-width": 2, "data-3d-role": "target" }));
    add(svgNode("path", { d: `M${(tgt.x - 9).toFixed(1)},${tgt.y.toFixed(1)}h18M${tgt.x.toFixed(1)},${(tgt.y - 9).toFixed(1)}v18`, stroke: C.target, "stroke-width": 1.6 }));
    add(text({ x: tgt.x + 10, y: tgt.y + 18 }, "Target", { fill: C.target }));
  }
  if (path.aim) {
    const aim = at(P(path.aim));
    if (aim && !cockpit) {
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

  // Companion paths and targets share the same world frame, camera and clock as the reference path.
  for (const item of extraAircraft) {
    const color = fleetColor(item.number), other = item.path;
    if (other.approach?.length >= 2) add(polyline(other.approach.map(P), { stroke: color, 'stroke-width': 1.8, 'stroke-dasharray': '5 3', 'data-3d-role': 'fleet-approach', 'data-aircraft-number': item.number }));
    add(polyline(other.samples.map(P), { stroke: color, 'stroke-width': 2.3, 'data-3d-role': 'fleet-path', 'data-aircraft-number': item.number }));
    const target = at(P(other.target));
    if (target) { add(svgNode('circle', { cx: target.x, cy: target.y, r: 4, fill: color, 'data-3d-role': 'fleet-target' })); add(text({x: target.x + 7, y: target.y - 7}, `TGT #${item.number}`, {fill: color})); }
  }

  // Wing ticks every 1 s: the wing line at that time (its tilt is the bank). 0.1.17: length × bankLineScale, 0 = off.
  const bankLineScale = Number.isFinite(options.bankLineScale) ? Math.max(0, options.bankLineScale) : 1;
  const wingFt = radius * 0.035 * bankLineScale;
  const ticks = cockpit || !(wingFt > 0) ? null : add(svgNode("g", { "data-3d-role": "bank-ticks", "data-bank-line-scale": bankLineScale }));
  for (let s = Math.ceil(path.samples[0].t); ticks && s <= path.endT && s <= path.samples[0].t + 240; s += 1) {
    const state = flightStateAt(path, s);
    const { right: r } = aircraftAxes(state);
    const q = P(state);
    const tick = polyline([[q[0] - r[0] * wingFt, q[1] - r[1] * wingFt, q[2] - r[2] * wingFt], [q[0] + r[0] * wingFt, q[1] + r[1] * wingFt, q[2] + r[2] * wingFt]], { stroke: cockpit ? "#9ca9ad" : "#4b5866", "stroke-width": 1.2 });
    if (tick) ticks.append(tick);
  }
  for (const [p, label] of marks) {
    const q = at(P(p));
    if (q && !cockpit) {
      add(svgNode("circle", { cx: q.x.toFixed(1), cy: q.y.toFixed(1), r: 4, fill: "#ffffff", stroke: "#203a63", "stroke-width": 1.6, "data-3d-role": "mark" }));
      add(text({ x: q.x + 8, y: q.y - 8 }, label));
    }
  }

  // Bomb trajectory (0.1.7): Release to Impact, the Dive Profile's colour; at t between them the bomb on it (time layer).
  const bomb = path.bomb ?? [];
  if (bomb.length >= 2) add(polyline(bomb.map(P), { stroke: C.bomb, "stroke-width": 2.4, "stroke-linejoin": "round", "stroke-linecap": "round", "data-3d-role": "path-bomb" }));
  // Over the paths: the bomb and the aircraft at t (0.1.8 time layer).
  const timeTop = add(svgNode("g", { "data-3d-layer": "time" }));
  // 0.1.16 (Play speed): the external view paints the aircraft meshes on one canvas (in a foreignObject, so it scales
  // and is cleared with the SVG); each aircraft keeps an empty <g data-3d-role="aircraft"> carrying its data.
  const meshLayer = cockpit ? null : bdpCanvasLayer(svg, W, H, { "data-3d-layer": "aircraft-mesh" });
  if (meshLayer) add(meshLayer.foreign);

  // Title rows: orbit, altitude stretch, grid step; at t the aircraft's state (time layer).
  if (!cockpit) add(text({ x: 16, y: 24 }, `Orbit ${Math.round(orbit.azimuthDeg)}° / ${Math.round(orbit.elevationDeg)}° · Zoom ${Math.round(zoom * 100)}% · Grid ${stepNm} NM`, { "data-3d-role": "status" }));
  // Pan hint (0.1.2): the host's one-pointer gesture is in its pan phase (held 0.5 s, then drag).
  if (options.panHint) {
    add(svgNode("rect", { x: W - 86, y: 10, width: 72, height: 24, rx: 6, fill: "#203a63", "data-3d-role": "pan-hint" }));
    add(svgNode("text", { x: W - 50, y: 27, "text-anchor": "middle", fill: "#ffffff", "font-size": 13, "font-family": "system-ui, sans-serif", "font-weight": 700 }, "PAN"));
  }
  // Last: the state row at t (0.1.8 time layer).
  const timeText = add(svgNode("g", { "data-3d-layer": "time-text" }));
  const legend = [
    ...fleet.map(a => ({ label: `Aircraft #${a.number}`, color: fleetColor(a.number) })),
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
    // The bombs in the air: this path's, and in the cockpit the Flight's (0.1.21, enlarged to stay visible there).
    const bombPaths = [{ number: options.aircraft?.number ?? null, path, own: true }, ...cockpitFleet.filter((a) => a.path && a.path !== path).map((a) => ({ number: a.number, path: a.path, own: false }))];
    for (const item of bombPaths) {
      const bombNow = tNow === null ? null : bombAt(item.path, tNow);
      const bombPoint = bombNow ? at(P(bombNow)) : null;
      if (!bombPoint) continue;
      const scaleNow = cockpit ? meshScale * cockpitEnlarge(P(bombNow), BOMB_LENGTH_FT, BDP_3D_VIEW_V0_1.cockpitMinUnits.bomb) : meshScale * BDP_3D_VIEW_V0_1.bombScaleFactor;
      const outline = bombOutline(item.path, tNow, bombNow, eye, scaleNow, at, P);
      const extra = item.own ? {} : { "data-aircraft-number": item.number };
      if (outline && !cockpit) put(svgNode("path", { d: outline, fill: "none", stroke: "#ffffff", "stroke-width": 3, "stroke-linejoin": "round", "data-3d-role": "bomb-halo" }));
      put(outline
        ? svgNode("path", { d: outline, fill: "#000000", stroke: "#ffffff", "stroke-width": cockpit ? 1 : 0.6, "stroke-linejoin": "round", "data-3d-role": "bomb", "data-bomb-shape": "outline", ...extra })
        : svgNode("circle", { cx: bombPoint.x.toFixed(1), cy: bombPoint.y.toFixed(1), r: 4.5, fill: "#000000", stroke: "#ffffff", "stroke-width": 1.2, "data-3d-role": "bomb", ...extra }));
      // In the cockpit a bomb seen nose- or tail-on is a sliver: under 8 units across it also gets a dot (0.1.21).
      if (cockpit && outline) {
        const n = outline.match(/-?\d+(?:\.\d+)?/g).map(Number);
        const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
        if (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < 8) put(svgNode("circle", { cx: bombPoint.x.toFixed(1), cy: bombPoint.y.toFixed(1), r: 3.5, fill: "#000000", stroke: "#ffffff", "stroke-width": 1.2, "data-3d-role": "bomb-dot", ...extra }));
      }
    }
    const flying = cockpit ? !!options.aircraft?.state : tNow !== null && tNow >= firstT - 1e-9;
    const state = fleet.length ? fleet.find(a => a.path === path)?.at(tNow) ?? null : flying ? (cockpit ? options.aircraft.state : flightStateAt(path, tNow)) : null;
    // 0.1.21: in the cockpit, the Flight given replaces the single other aircraft.
    const visible = fleet.length ? fleet.map(a => ({ number: a.number, state: a.at(tNow) })).filter(a => a.state)
      : cockpitFleet.length ? cockpitFleet.filter(a => a.state).map(a => ({ number: a.number, state: a.state }))
      : state ? [{ number: options.aircraft?.number, state }] : [];
    visible.sort((a,b) => dot(sub(P(b.state), eye), cameraForward) - dot(sub(P(a.state), eye), cameraForward));
    const meshFaces = [];
    for (const item of visible) {
      const state = item.state;
      const { v, right: r, up: u } = aircraftAxes(state);
      // One scale for every axis; Auto keeps the original marker length, manual 1× gives the real dimensions.
      const q = P(state);
      const world = ([x, y, z]) => q.map((c, i) => c + meshScale * (r[i] * x + v[i] * y + u[i] * z));
      if (!cockpit) put(polyline([[state.x, state.y, 0], q], { stroke: "#203a63", "stroke-width": 1, "stroke-dasharray": "2 3" }));
      const shadow = at([state.x, state.y, 0]);
      if (shadow && !cockpit) put(svgNode("circle", { cx: shadow.x.toFixed(1), cy: shadow.y.toFixed(1), r: 3, fill: "#8f9aa6", "data-3d-role": "aircraft-shadow" }));
      const aircraft = svgNode("g", { "data-3d-role": "aircraft", "data-aircraft-mesh": aircraftMesh.id, "data-aircraft-scale": aircraftScale, ...(item.number ? { "data-aircraft-number": item.number, "data-world-position": [state.x, state.y, state.z].join(",") } : {}) });
      if (meshLayer || ink) {
        aircraft.setAttribute("data-render", "canvas");
        put(aircraft);
        const itemScale = cockpit ? meshScale * cockpitEnlarge(q, F16_LENGTH_FT, BDP_3D_VIEW_V0_1.cockpitMinUnits.aircraft) : meshScale;
        if (cockpit) aircraft.setAttribute("data-cockpit-scale", (itemScale / meshScale).toFixed(2));
        meshFaces.push(...projectMesh(q, r, v, u, itemScale, eye, cameraForward, projection ? at : fastAt));
        const labelStyle = cockpit && options.cockpitStyle ? { fill: options.cockpitStyle.label, stroke: options.cockpitStyle.labelHalo } : { fill: fleetColor(item.number) };
        if (fleet.length || (cockpit && cockpitFleet.length)) { const label = at(q); if (label) put(text({ x: label.x + 14, y: label.y - 14 }, `#${item.number}`, { ...labelStyle, 'data-3d-role': 'aircraft-label' })); }
        continue;
      }
      const faces = aircraftMesh.faces.map(({ vertices, color }) => {
        const points = vertices.map(world);
        const midpoint = points[0].map((_, i) => points.reduce((sum, p) => sum + p[i], 0) / points.length);
        const a = sub(points[1], points[0]), b = sub(points[2], points[0]);
        let normal = norm([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]);
        // Wings/fins are two-sided surfaces. Light the side facing the camera; do not cull it after a bank.
        if (dot(normal, sub(eye, midpoint)) < 0) normal = normal.map((n) => -n);
        // 0.1.15: the shade in steps of 0.05, so neighbouring faces share a fill and merge into one path below.
        const shade = Math.round((0.72 + 0.35 * Math.max(0, dot(normal, aircraftLight))) * 20) / 20;
        const fill = `rgb(${color.map((c) => Math.min(255, Math.round(c * shade))).join(",")})`;
        return { points: projection ? projection.polygon(points) : points.map(at), depth: dot(sub(midpoint, eye), cameraForward), fill };
      }).sort((a, b) => b.depth - a.depth); // Painter order: far faces before near faces, for this camera and pose.
      // 0.1.15 (Play speed): consecutive faces of one fill are one <path> (painter order kept), about 30 elements
      // per aircraft instead of 241.
      let run = null;
      const flush = () => { if (run) aircraft.append(svgNode("path", { d: run.d.join(""), fill: run.fill })); run = null; };
      for (const face of faces) {
        if (!(face.points.length >= 3 && face.points.every(Boolean))) continue;
        // Faces under 0.2 px² on screen (a small, far aircraft) cannot be seen; they are skipped.
        let area = 0;
        face.points.forEach((p, i) => { const q = face.points[(i + 1) % face.points.length]; area += p.x * q.y - q.x * p.y; });
        if (Math.abs(area) / 2 < 0.2) continue;
        if (run?.fill !== face.fill) { flush(); run = { fill: face.fill, d: [] }; }
        // One screen winding for every face (0.1.19), as on the canvas.
        const ordered = area > 0 ? face.points : [...face.points].reverse();
        run.d.push(`M${ordered.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("L")}Z`);
      }
      flush();
      if (aircraft.childNodes.length) put(aircraft);
      if (fleet.length) { const label = at(q); if (label) put(text({ x: label.x + 10, y: label.y - 10 }, `#${item.number}`, { fill: fleetColor(item.number), 'data-3d-role': 'aircraft-label' })); }
    }
    if (meshLayer) paintFaces(meshLayer.begin(), meshFaces);
    else if (ink) {
      // 0.1.21: a light rim under the cockpit's aircraft, so a dark airframe reads on a dark sky.
      const halo = cockpit ? options.cockpitStyle?.halo : null;
      if (halo && meshFaces.length) {
        ink.save();
        ink.strokeStyle = halo; ink.lineWidth = 2.6; ink.lineJoin = "round";
        ink.beginPath();
        for (const face of meshFaces) { const p = face.points; ink.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) ink.lineTo(p[i], p[i + 1]); ink.closePath(); }
        ink.stroke();
        ink.restore();
      }
      paintFaces(ink, meshFaces);
    }
    const putText = (node) => { if (node) timeText.append(node); };
    if (!cockpit && !fleet.length && tNow !== null && !flying) putText(text({ x: 16, y: 46 }, `Roll-in in ${(path.samples[0].t - tNow).toFixed(1)} s`, { "data-3d-role": "state" }));
    if (state && !cockpit) putText(text({ x: 16, y: 46 }, `${path.timeOriginLabel ?? "Roll-in"} ${tNow < 0 ? "−" : "+"}${Math.abs(tNow).toFixed(1)} s · ${String(state.phase).toUpperCase()} · ${Math.round(state.z - path.target.z)} ft AGL · ${Math.round(state.kcas)} KCAS · Bank ${Math.round(Math.abs(state.bankDeg))}°`, { "data-3d-role": "state" }));
    return { ...base, timeSec: tNow, state };
  };
  if (!cockpit) drawnScenes.set(svg, { path, viewKey, layers: { under: timeUnder, time: timeTop, text: timeText }, drawTime });
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
