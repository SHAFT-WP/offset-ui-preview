import { svgNode } from "../../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { BDP_FLIGHT_PATH_V0_1, aircraftAxes, flightStateAt, hudAoaDeg } from "./bdp-flight-path-v0.1.mjs?v=0.1.4";
import { bdpCanvasLayer, renderBdp3dView } from "./bdp-3d-view-v0.1.mjs?v=0.1.22";

// BDP HUD view v0.1 (owner 2026-10-15, BDP update R6; plan §4.6; research viewer SPEC §5.3 in SVG). A first-person
// view from the aircraft of a BDP flight path at time t: an F-16-style HUD square of `hudSizeDeg` (default 14°,
// square), pitch ladder every 5° (climb solid, dive dashed, halves bent toward the horizon by half the pitch),
// FPM, gun cross (boresight, the FPM raised by the HUD angle of attack), planned IAA circle, Aim-off Point
// diamond, TGT box or edge arrow, optional FPM predicted path. The screen's vertical field of view is
// `fovDeg` (30 / 70 / 120). Padlock: `gazeProgressDeg` turns the view from the HUD centre toward the Target.
// Self-contained SVG (every stroke and fill an attribute); display only.

export const BDP_HUD_VIEW_V0_1 = Object.freeze({
  id: "bdp-hud-view-v0.1",
  // 0.1.1 (2026-10-18, owner handoff §3): any screen FOV 5–150° (the host's zoom: FOV = 2·atan(tan(F0/2)/zoom));
  // without a time the HUD shows Roll-in −3 s (the HUD start); the time readout is "Roll-in −3.0 s" / "Roll-in +n s".
  // 0.1.2 (2026-10-19): flight path 0.1.2 (the Level SEM turn: heading and bank after the level-off).
  // 0.1.3 (2026-10-19, owner): flight path 0.1.3 — the HUD flies Roll-in −3 s to 1 s after the SEM's end, held there.
  // 0.1.4 (2026-10-20): flight path 0.1.4 (its bomb trajectory is the 3D Profile's); the HUD draws as before.
  // 0.1.5 (2026-10-21, owner: a smoother Play): only the ladder rungs, tips and numbers that reach the HUD square are
  // created — the clip hid the others (about 200 elements a frame); a hidden HUD creates none. The picture is unchanged.
  // 0.1.6 (2026-10-29, owner): the 3D Profile scene in the cockpit camera, with HUD symbology on top.
  // 0.1.8 (2026-11-01, owner): white sky; the 3D scene draws its aircraft and grid in fewer elements (3D view 0.1.15).
  // 0.1.9 (2026-11-01): the cockpit world (grid, paths, envelope, wingman) on a canvas (3D view 0.1.16).
  // 0.1.10 (2026-11-01): the 3D scene 0.1.17 (bomb outline).
  // 0.1.11: the 3D scene 0.1.18.
  // 0.1.12: the 3D scene 0.1.19.
  // 0.1.13: the 3D scene 0.1.20.
  // 0.1.14 (owner 2026-11-03, "허드뷰 하늘 색과 땅색이 전부 하야니깐 잘 분간이 안되는 것 같아 / 다크모드 화이트 모드에
  // 따라 세련되게 네가 다시 설정해 주고 / 허드뷰에서도 3d 전투기와 폭탄이 보이더록 해줘"): `theme` ("dark" / "light",
  // BDP_HUD_THEMES) paints a graded sky and ground on either side of the horizon (lighter toward it, as haze) and sets
  // the HUD ink, the world grid and the marker colours for that theme; `fleet` (the Flight's other aircraft: number,
  // state, path) and their bombs are drawn in the cockpit scene (3D view 0.1.21), enlarged to stay visible.
  // 0.1.15 (owner 2026-11-03, "기체 사이즈 옵션을 위 컨트롤 박스에 추가"): `aircraftScale` (null: Auto, the enlargement that
  // keeps each aircraft visible; a number: that multiple of the real F-16) for the cockpit's aircraft (3D 0.1.22).
  version: "0.1.15",
  fovLimitsDeg: Object.freeze([5, 150]),
  canvas: Object.freeze({ width: 720, height: 540 }),
  ladderStepDeg: 5,
  defaults: Object.freeze({ hudSizeDeg: 14, fovDeg: 70, aoa: true, fpmPath: true }),
  // The HUD square sits this fraction of its size below the boresight (research viewer: 6.5° of 25°).
  hudCentreBelowBoresight: 0.26,
});

const DEG = Math.PI / 180;
// Theme palettes (0.1.14). Sky: zenith → horizon; ground: horizon → near; `flat*` where no gradient is drawn (the SVG
// outlines when the world is not on a canvas). `ink` is the HUD symbology; `ink` on the light palette is a deeper green
// so it reads on a pale sky.
export const BDP_HUD_THEMES = Object.freeze({
  dark: Object.freeze({ skyTop: "#081426", skyHorizon: "#33577f", groundHorizon: "#4c5540", groundNear: "#171c12", flatSky: "#1d3554", flatGround: "#2f3626",
    grid: "#b5c49b", ink: "#3ee07f", inkSoft: "#7cf29a", target: "#ff6b6b", aim: "#ffffff", wingman: "#8ad9ff", padlock: "#ffd166",
    aircraftHalo: "rgba(225,238,255,0.85)", label: "#d6ecff", labelHalo: "#0b1626" }),
  light: Object.freeze({ skyTop: "#5d97cb", skyHorizon: "#dcebf6", groundHorizon: "#c3bb93", groundNear: "#78714e", flatSky: "#a9cbe8", flatGround: "#9f9871",
    grid: "#3f3a24", ink: "#067a3a", inkSoft: "#0c9a4b", target: "#c62828", aim: "#067a3a", wingman: "#1d5fa8", padlock: "#8a5a00",
    aircraftHalo: "rgba(255,255,255,0.9)", label: "#16314f", labelHalo: "#ffffff" }),
});
const themeOf = (name) => BDP_HUD_THEMES[name] ?? BDP_HUD_THEMES.dark;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dir = (headingDeg, elevationDeg) => [Math.sin(headingDeg * DEG) * Math.cos(elevationDeg * DEG), Math.cos(headingDeg * DEG) * Math.cos(elevationDeg * DEG), Math.sin(elevationDeg * DEG)];
const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) / DEG;
// Rotate forward and up together, including the antipodal/vertical cases; no projected-up singularity.
export function hudCameraAxes(axes, direction, progressDeg) {
  const angle = angleBetween(axes.centre, direction);
  let axis = cross(axes.centre, direction);
  if (Math.hypot(...axis) < 1e-8) axis = axes.centreUp;
  axis = norm(axis);
  const theta = Math.min(angle, Math.max(0, progressDeg)) * DEG;
  const rotate = v => add(add(mul(v, Math.cos(theta)), mul(cross(axis, v), Math.sin(theta))), mul(axis, dot(axis, v) * (1 - Math.cos(theta))));
  const forward = norm(rotate(axes.centre)), up = norm(rotate(axes.centreUp));
  return { forward, up, right: norm(cross(forward, up)) };
}

// The part of a convex screen polygon whose rays look below the horizon (rayZ < 0); rayZ is linear on screen.
function clipBelowHorizon(polygon, rayZ) {
  const out = [];
  polygon.forEach((a, index) => {
    const b = polygon[(index + 1) % polygon.length];
    const za = rayZ(a);
    const zb = rayZ(b);
    if (za < 0) out.push(a);
    if ((za < 0) !== (zb < 0)) {
      const k = za / (za - zb);
      out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
    }
  });
  return out;
}

// Aircraft axes at a state: velocity v, body right / up (bank about v), boresight, HUD centre.
export function hudAxes(state, { aoa = true, hudSizeDeg = 14 } = {}) {
  const { v, right, up } = aircraftAxes(state);
  const alpha = (aoa ? hudAoaDeg(state.loadFactor, state.kcas) : 0) * DEG;
  const bore = add(mul(v, Math.cos(alpha)), mul(up, Math.sin(alpha)));
  const boreUp = add(mul(up, Math.cos(alpha)), mul(v, -Math.sin(alpha)));
  const c = BDP_HUD_VIEW_V0_1.hudCentreBelowBoresight * hudSizeDeg * DEG;
  const centre = add(mul(bore, Math.cos(c)), mul(boreUp, -Math.sin(c)));
  const centreUp = add(mul(boreUp, Math.cos(c)), mul(bore, Math.sin(c)));
  return { v, right, up, bore, centre, centreUp, alphaDeg: alpha / DEG };
}

// The angle from the HUD centre to the Target at time t (the padlock's full travel).
export function padlockTotalDeg(path, t, options = {}) {
  const state = options.state ?? flightStateAt(path, t);
  const axes = hudAxes(state, options);
  const target = options.lookAt ?? path.target;
  return angleBetween(axes.centre, sub([target.x, target.y, target.z], [state.x, state.y, state.z]));
}

export function renderBdpHudView(svg, path, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  const { width: W, height: H } = BDP_HUD_VIEW_V0_1.canvas;
  const o = { ...BDP_HUD_VIEW_V0_1.defaults, ...options };
  const hudSizeDeg = Math.min(40, Math.max(4, Number(o.hudSizeDeg) || 14));
  const [fovLow, fovHigh] = BDP_HUD_VIEW_V0_1.fovLimitsDeg;
  const fovDeg = Number.isFinite(Number(o.fovDeg)) && Number(o.fovDeg) > 0 ? Math.min(fovHigh, Math.max(fovLow, Number(o.fovDeg))) : 70;
  const t = Number.isFinite(o.timeSec) ? o.timeSec : BDP_FLIGHT_PATH_V0_1.hudStartSec;
  const state = options.state ?? flightStateAt(path, t);
  // The time shown is the state's, inside the window (0.1.3).
  const shownT = Number.isFinite(state.t) ? state.t : t;
  const axes = hudAxes(state, { aoa: o.aoa, hudSizeDeg });
  const pos = [state.x, state.y, state.z];
  const toTarget = norm(sub([path.target.x, path.target.y, path.target.z], pos));
  const gazeTarget = o.lookAt ?? path.target;
  const toGaze = norm(sub([gazeTarget.x, gazeTarget.y, gazeTarget.z], pos));
  const totalDeg = angleBetween(axes.centre, toGaze);
  const progress = Math.min(totalDeg, Math.max(0, Number(o.gazeProgressDeg) || 0));
  // Camera: the HUD centre, turned toward the Target by the padlock progress; roll stays the aircraft's.
  const camera = hudCameraAxes(axes, toGaze, progress);
  const { forward, up: camUp, right: camRight } = camera;
  const focal = (H / 2) / Math.tan((fovDeg / 2) * DEG);
  const project = (d) => {
    const cz = dot(d, forward);
    if (cz <= 0.02) return null;
    return { x: W / 2 + (focal * dot(d, camRight)) / cz, y: H / 2 - (focal * dot(d, camUp)) / cz };
  };
  const at = (point) => project(norm(sub(point, pos)));

  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.style.aspectRatio = `${W} / ${H}`;
  svg.setAttribute("aria-label", options.title ?? "HUD View");
  const root = svgNode("g", { "data-view": BDP_HUD_VIEW_V0_1.id });
  svg.append(root);
  // Sky / ground: the screen rectangle cut by the horizon. A screen point's ray is
  // focal·forward + (x − W/2)·camRight − (y − H/2)·camUp; it looks below the horizon where its z < 0.
  // 0.1.9: sky, ground and the world are painted on a canvas beneath this SVG (kept across frames); the SVG keeps
  // transparent sky / ground outlines and draws the HUD symbols on top.
  const worldLayer = bdpCanvasLayer(svg, W, H, { "data-hud-role": "world-canvas" }, { keep: true, under: !!svg.parentElement });
  const ink = worldLayer.begin();
  const theme = themeOf(o.theme);
  const themeName = BDP_HUD_THEMES[o.theme] ? o.theme : "dark";
  svg.dataset.hudTheme = themeName;
  // Under the canvas the host shows the theme's sky, never a white page, if the canvas cannot be painted.
  if (!worldLayer.foreign && svg.parentElement && svg.parentElement.style.background !== theme.flatSky) svg.parentElement.style.background = theme.flatSky;
  const rayZ = (p) => focal * forward[2] + (p.x - W / 2) * camRight[2] - (p.y - H / 2) * camUp[2];
  // 0.1.14: a graded sky and ground. rayZ grows toward the zenith at the screen rate (camRight.z, −camUp.z); the
  // gradients run from the horizon point nearest the centre along it (sky) and against it (ground).
  const grad = { x: camRight[2], y: -camUp[2] };
  const gradLength = Math.hypot(grad.x, grad.y);
  const reach = Math.hypot(W, H);
  const paint = (fallback, horizonColor, farColor, sign) => {
    if (!(gradLength > 1e-6) || typeof ink.createLinearGradient !== "function") return fallback;
    const e = { x: grad.x / gradLength, y: grad.y / gradLength };
    const c = { x: W / 2, y: H / 2 };
    const k = rayZ(c) / (gradLength * gradLength);
    const h = { x: c.x - grad.x * k, y: c.y - grad.y * k };
    const g = ink.createLinearGradient(h.x, h.y, h.x + sign * e.x * reach * 0.75, h.y + sign * e.y * reach * 0.75);
    g.addColorStop(0, horizonColor);
    g.addColorStop(1, farColor);
    return g;
  };
  ink.fillStyle = paint(theme.flatSky, theme.skyHorizon, theme.skyTop, 1);
  ink.fillRect(0, 0, W, H);
  root.append(svgNode("rect", { x: 0, y: 0, width: W, height: H, fill: worldLayer.foreign ? theme.flatSky : "none", "data-hud-role": "sky" }));
  const ground = clipBelowHorizon([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], rayZ);
  if (ground.length >= 3) {
    ink.fillStyle = paint(theme.flatGround, theme.groundHorizon, theme.groundNear, -1);
    ink.beginPath();
    ground.forEach((p, i) => (i ? ink.lineTo(p.x, p.y) : ink.moveTo(p.x, p.y)));
    ink.closePath();
    ink.fill();
    root.append(svgNode("polygon", { points: ground.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "), fill: worldLayer.foreign ? theme.flatGround : "none", "data-hud-role": "ground" }));
  }

  // One world renderer for the external profile and this cockpit view. Position, bank, AOA, FOV and
  // padlock use the very same axes as the overlay below; the external marker scale is never passed in.
  if (worldLayer.foreign) root.append(worldLayer.foreign);
  const world = svgNode("svg");
  renderBdp3dView(world, path, { timeSec: shownT, aircraft: o.otherAircraft, fleet: o.fleet, cockpitAircraftScale: o.aircraftScale ?? null, gridStepFt: o.gridStepFt, gridColor: theme.grid, cockpitStyle: { halo: theme.aircraftHalo, label: theme.label, labelHalo: theme.labelHalo }, ctx: ink, camera: { eye: pos, forward, right: camRight, up: camUp, fovDeg, width: W, height: H } });
  const scene = world.firstElementChild;
  scene.setAttribute("data-hud-role", "scene");
  root.append(scene);
  if (o.otherAircraft?.state) {
    const other = o.otherAircraft.state, q = at([other.x, other.y, other.z]);
    if (q && q.x >= 0 && q.x <= W && q.y >= 0 && q.y <= H) {
      root.append(svgNode("circle", { cx: q.x, cy: q.y, r: 5, fill: "none", stroke: theme.wingman, "data-hud-role": "wingman" }));
      // With the Flight drawn (0.1.14) the scene labels every aircraft; the ring alone marks the wingman.
      if (!o.fleet?.length) root.append(svgNode("text", { x: q.x + 8, y: q.y - 8, fill: theme.wingman, "font-size": 13, "font-family": "system-ui", "data-hud-role": "wingman-label" }, `#${o.otherAircraft.number}`));
    }
  }

  // HUD square: the glass fixed to the aircraft, projected (a quadrilateral while the padlock turns the view).
  const half = Math.tan((hudSizeDeg / 2) * DEG);
  const cornerDirs = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => norm(add(axes.centre, add(mul(axes.right, sx * half), mul(axes.centreUp, sy * half)))));
  const corners = cornerDirs.map(project);
  const hudVisible = corners.every(Boolean);
  const clipId = `${options.scope ?? "bdp-hud"}-clip`;
  if (hudVisible) {
    const defs = svgNode("defs");
    const clip = svgNode("clipPath", { id: clipId });
    clip.append(svgNode("polygon", { points: corners.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") }));
    defs.append(clip);
    svg.insertBefore(defs, root);
    root.append(svgNode("polygon", { points: corners.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "), fill: "none", stroke: theme.ink, "stroke-width": 1.2, "stroke-opacity": 0.55, "data-hud-role": "hud-frame" }));
  }
  const hud = svgNode("g", hudVisible ? { "clip-path": `url(#${clipId})`, "data-hud-role": "hud" } : { "data-hud-role": "hud", display: "none" });
  root.append(hud);
  const line = (points, attrs = {}) => {
    const p = points.filter(Boolean);
    if (p.length < 2) return null;
    return svgNode("polyline", { points: p.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" "), fill: "none", stroke: theme.ink, "stroke-width": 1.8, ...attrs });
  };
  const text = (x, y, value, attrs = {}) => svgNode("text", { x, y, fill: theme.ink, "font-size": 14, "font-family": "ui-monospace, monospace", "font-weight": 700, ...attrs }, value);

  // Ladder culling (0.1.5): an element is created only when one of its points lies within 30 px of the HUD square
  // (the clip). Consecutive points are a few px apart, so no line crosses the square between two outside points.
  const margin = 30;
  const box = hudVisible ? {
    x0: Math.min(...corners.map((q) => q.x)) - margin, x1: Math.max(...corners.map((q) => q.x)) + margin,
    y0: Math.min(...corners.map((q) => q.y)) - margin, y1: Math.max(...corners.map((q) => q.y)) + margin,
  } : null;
  const reaches = (points) => !!box && points.some((q) => q && q.x >= box.x0 && q.x <= box.x1 && q.y >= box.y0 && q.y <= box.y1);

  // Pitch ladder (every 5°) on the FPM heading: each rung is built about its own pitch direction c, with the
  // horizontal right of the heading (lat) and the pitch-up direction (elUp), so it stays defined near ±90°.
  const step = BDP_HUD_VIEW_V0_1.ladderStepDeg;
  const h = state.headingDeg;
  const lat = [Math.cos(h * DEG), -Math.sin(h * DEG), 0];
  const rungDir = (pitchDeg, sideDeg, downDeg) => {
    const c = dir(h, pitchDeg);
    const elUp = dir(h, pitchDeg + 90);
    return norm(add(c, add(mul(lat, Math.tan(sideDeg * DEG)), mul(elUp, -Math.tan(downDeg * DEG)))));
  };
  hud.append(line([-40, -24, -16, -8, -2.5].map((d) => project(rungDir(0, d, 0))), { "stroke-width": 2, "data-hud-role": "horizon" }));
  hud.append(line([2.5, 8, 16, 24, 40].map((d) => project(rungDir(0, d, 0))), { "stroke-width": 2, "data-hud-role": "horizon" }));
  for (let p = -85; p <= 85; p += step) {
    if (p === 0) continue;
    // Halves bend toward the horizon by half the pitch angle; the tips point at it.
    const bend = Math.tan((Math.abs(p) / 2) * DEG) * Math.sign(p);
    for (const s of [-1, 1]) {
      // Each half runs 1.2°–3.8° from the FPM heading; its number sits just outside it, inside a 14° HUD.
      const rungPoints = [1.2, 2.1, 3, 3.8].map((d) => project(rungDir(p, s * d, bend * (d - 1.2))));
      if (rungPoints.filter(Boolean).length < 2) continue;
      if (reaches(rungPoints)) hud.append(line(rungPoints, { "stroke-dasharray": p < 0 ? "5 4" : undefined, "data-hud-role": "ladder" }));
      const tipPoints = [project(rungDir(p, s * 3.8, bend * 2.6)), project(rungDir(p, s * 3.8, bend * 2.6 + Math.sign(p) * 0.6))];
      const tip = reaches(tipPoints) ? line(tipPoints) : null;
      if (tip) hud.append(tip);
      const label = project(rungDir(p, s * 4.3, bend * 3.1));
      if (label && reaches([label])) hud.append(text(label.x, label.y + 4, String(Math.abs(p)), { "font-size": 11, "text-anchor": s > 0 ? "start" : "end", "data-hud-role": "ladder-label" }));
    }
  }
  // FPM, gun cross, planned IAA circle, Aim-off Point.
  const fpm = project(axes.v);
  if (fpm) {
    hud.append(svgNode("circle", { cx: fpm.x, cy: fpm.y, r: 7, fill: "none", stroke: theme.ink, "stroke-width": 2, "data-hud-role": "fpm" }));
    hud.append(line([{ x: fpm.x - 18, y: fpm.y }, { x: fpm.x - 7, y: fpm.y }]));
    hud.append(line([{ x: fpm.x + 7, y: fpm.y }, { x: fpm.x + 18, y: fpm.y }]));
    hud.append(line([{ x: fpm.x, y: fpm.y - 7 }, { x: fpm.x, y: fpm.y - 14 }]));
  }
  const bore = project(axes.bore);
  if (bore) {
    hud.append(line([{ x: bore.x - 9, y: bore.y }, { x: bore.x + 9, y: bore.y }], { "data-hud-role": "gun-cross" }));
    hud.append(line([{ x: bore.x, y: bore.y - 9 }, { x: bore.x, y: bore.y + 9 }]));
  }
  if (Number.isFinite(path.plannedIaaDeg)) {
    const i = path.plannedIaaDeg * DEG;
    const iaa = project(add(mul(axes.v, Math.cos(i)), mul(axes.up, -Math.sin(i))));
    if (iaa) hud.append(svgNode("circle", { cx: iaa.x, cy: iaa.y, r: 5, fill: "none", stroke: theme.ink, "stroke-width": 1.5, "stroke-dasharray": "3 2", "data-hud-role": "planned-iaa" }));
  }
  if (path.aim) {
    const aim = at([path.aim.x, path.aim.y, path.aim.z]);
    if (aim) hud.append(svgNode("polygon", { points: `${aim.x},${aim.y - 6} ${aim.x + 6},${aim.y} ${aim.x},${aim.y + 6} ${aim.x - 6},${aim.y}`, fill: theme.aim, "data-hud-role": "aim-point" }));
  }
  // FPM predicted path: where each later velocity line meets the Target plane, seen from here, to the Track Point.
  if (o.fpmPath) {
    const pts = [];
    for (const s of path.samples) {
      if (s.t <= t || s.t > path.trackPointT + 1e-9) continue;
      const v = dir(s.headingDeg, s.fpaDeg);
      const p = [s.x, s.y, s.z];
      const ground = v[2] < -1e-3 ? add(p, mul(v, (s.z - path.target.z) / -v[2])) : add(p, mul(v, 30000));
      pts.push(at(ground));
    }
    const predicted = line(pts, { stroke: theme.inkSoft, "stroke-width": 1.4, "stroke-dasharray": "2 4", "data-hud-role": "fpm-path" });
    if (predicted) hud.append(predicted);
  }
  // Target: TGT box on screen, else an arrow at the edge toward it.
  const tgt = at([path.target.x, path.target.y, path.target.z]);
  if (tgt && tgt.x > 0 && tgt.x < W && tgt.y > 0 && tgt.y < H) {
    root.append(svgNode("rect", { x: tgt.x - 8, y: tgt.y - 8, width: 16, height: 16, fill: "none", stroke: theme.target, "stroke-width": 2, "data-hud-role": "target" }));
    root.append(text(tgt.x + 11, tgt.y - 10, "TGT", { fill: theme.target, "font-size": 12 }));
  } else {
    const cx = dot(toTarget, camRight);
    const cy = dot(toTarget, camUp);
    const a = Math.atan2(-cy, cx);
    const r = Math.min(W, H) / 2 - 22;
    const ax = W / 2 + r * Math.cos(a);
    const ay = H / 2 + r * Math.sin(a);
    root.append(svgNode("polygon", {
      points: [[14, 0], [-8, -8], [-8, 8]].map(([px, py]) => `${(ax + px * Math.cos(a) - py * Math.sin(a)).toFixed(1)},${(ay + px * Math.sin(a) + py * Math.cos(a)).toFixed(1)}`).join(" "),
      fill: theme.target, "data-hud-role": "target-arrow",
    }));
  }

  // Readouts (screen-fixed).
  const altFt = state.z - path.target.z;
  const tgtRangeNm = Math.hypot(path.target.x - state.x, path.target.y - state.y) / 6076.11549;
  const lookDownDeg = Math.atan2(state.z - path.target.z, Math.hypot(path.target.x - state.x, path.target.y - state.y)) / DEG;
  const rows = [
    [`ALT ${Math.round(altFt)} AGL`, `KCAS ${Math.round(state.kcas)}`],
    [`DIVE ${Math.round(-state.fpaDeg)}°`, `G ${state.loadFactor.toFixed(1)}`],
    [`AOA ${axes.alphaDeg.toFixed(1)}°`, `BANK ${Math.round(Math.abs(state.bankDeg))}°${state.bankDeg > 0.5 ? "R" : state.bankDeg < -0.5 ? "L" : ""}`],
    [`HDG ${state.headingDeg >= 0 ? "+" : ""}${Math.round(state.headingDeg)}°`, `TGT ${tgtRangeNm.toFixed(1)} NM`],
    [`IAA ${(lookDownDeg + state.fpaDeg).toFixed(1)}°`, `${String(state.phase).toUpperCase()} · ${path.timeOriginLabel ?? "Roll-in"} ${shownT < 0 ? "−" : "+"}${Math.abs(shownT).toFixed(1)} s`],
  ];
  rows.forEach(([left, right], index) => {
    root.append(text(12, 22 + index * 19, left, { "data-hud-readout": index }));
    root.append(text(W - 12, 22 + index * 19, right, { "text-anchor": "end" }));
  });
  if (progress > 0) root.append(text(W / 2, H - 12, progress >= totalDeg - 1e-6 ? `PAD LOCK · ${o.padlockTarget ?? "TGT"} · LOCKED` : `PAD LOCK · ${o.padlockTarget ?? "TGT"} · ${Math.round(progress)}° / ${Math.round(totalDeg)}°`, { "text-anchor": "middle", fill: theme.padlock, "data-hud-role": "padlock" }));
  return { title: options.title ?? "HUD View", fovDeg, timeSec: t, totalDeg, progressDeg: progress, locked: progress > 0 && progress >= totalDeg - 1e-6, state, canvas: { width: W, height: H } };
}
