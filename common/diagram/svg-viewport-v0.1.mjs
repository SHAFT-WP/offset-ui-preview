export const SVG_VIEWPORT_V0_1 = Object.freeze({
  id: "svg-viewport-v0.1",
  version: "0.1.0",
  purpose: "Generic SVG viewBox zoom, mouse/touch pan, and pinch interaction",
});

function parseViewBox(svg, fallback) {
  const base = svg.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
  if (base?.length === 4 && base.every(Number.isFinite)) return { x: base[0], y: base[1], w: base[2], h: base[3] };
  return { ...fallback };
}

export function installSvgViewport(svg, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  const base = options.baseViewBox ?? parseViewBox(svg, { x: 0, y: 0, w: 1180, h: 720 });
  const aspect = base.h / base.w;
  const minW = base.w / (options.maxZoom ?? 12);
  const maxW = base.w * (options.maxZoomOut ?? 3);
  let box = { ...base };
  let userAdjusted = false;
  let mouse = null;
  const touches = new Map();
  let lastTouchCenter = null;
  let lastTouchDistance = null;

  const apply = (next) => {
    const w = Math.max(minW, Math.min(maxW, next.w));
    const h = w * aspect;
    box = { x: next.x, y: next.y, w, h };
    svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.w} ${box.h}`);
  };
  const reset = (markUser = false) => { box = { ...base }; apply(box); userAdjusted = markUser; };
  const clientToView = (clientX, clientY) => {
    const rect = svg.getBoundingClientRect();
    return { x: box.x + ((clientX - rect.left) / rect.width) * box.w, y: box.y + ((clientY - rect.top) / rect.height) * box.h };
  };
  const zoomAt = (clientX, clientY, factor) => {
    const point = clientToView(clientX, clientY);
    const rx = (point.x - box.x) / box.w;
    const ry = (point.y - box.y) / box.h;
    const nw = box.w * factor;
    const nh = box.h * factor;
    apply({ x: point.x - rx * nw, y: point.y - ry * nh, w: nw, h: nh });
    userAdjusted = true;
  };
  const zoomCenter = (factor) => {
    const rect = svg.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };
  const panBy = (dx, dy) => {
    const rect = svg.getBoundingClientRect();
    apply({ x: box.x - (dx / rect.width) * box.w, y: box.y - (dy / rect.height) * box.h, w: box.w, h: box.h });
    userAdjusted = true;
  };

  const onWheel = (event) => { event.preventDefault(); zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 0.86 : 1.16); };
  const onDoubleClick = (event) => { event.preventDefault(); reset(true); };
  const onPointerDown = (event) => {
    svg.setPointerCapture(event.pointerId);
    if (event.pointerType === "touch") {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const values = [...touches.values()];
      if (values.length === 1) { lastTouchCenter = { ...values[0] }; lastTouchDistance = null; }
      else {
        lastTouchCenter = { x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2 };
        lastTouchDistance = Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y);
      }
      return;
    }
    if (event.button === 0) mouse = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const onPointerMove = (event) => {
    if (event.pointerType === "touch" && touches.has(event.pointerId)) {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const values = [...touches.values()];
      if (values.length === 1) {
        const center = { ...values[0] };
        if (lastTouchCenter) panBy(center.x - lastTouchCenter.x, center.y - lastTouchCenter.y);
        lastTouchCenter = center; lastTouchDistance = null;
      } else {
        const center = { x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2 };
        const distance = Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y);
        if (lastTouchCenter) panBy(center.x - lastTouchCenter.x, center.y - lastTouchCenter.y);
        if (lastTouchDistance && distance > 0) zoomAt(center.x, center.y, lastTouchDistance / distance);
        lastTouchCenter = center; lastTouchDistance = distance;
      }
      return;
    }
    if (mouse?.id === event.pointerId) {
      panBy(event.clientX - mouse.x, event.clientY - mouse.y);
      mouse = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }
  };
  const onPointerEnd = (event) => {
    if (event.pointerType === "touch") {
      touches.delete(event.pointerId);
      const values = [...touches.values()];
      if (!values.length) { lastTouchCenter = null; lastTouchDistance = null; }
      else if (values.length === 1) { lastTouchCenter = { ...values[0] }; lastTouchDistance = null; }
      return;
    }
    if (mouse?.id === event.pointerId) mouse = null;
  };

  svg.style.touchAction = "none";
  svg.addEventListener("wheel", onWheel, { passive: false });
  svg.addEventListener("dblclick", onDoubleClick);
  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", onPointerEnd);
  svg.addEventListener("pointercancel", onPointerEnd);

  options.zoomInButton?.addEventListener("click", () => zoomCenter(0.8));
  options.zoomOutButton?.addEventListener("click", () => zoomCenter(1.25));
  options.fitButton?.addEventListener("click", () => reset(true));
  options.resetButton?.addEventListener("click", () => reset(false));
  reset(false);

  return { reset, fit: () => reset(true), zoomCenter, getViewBox: () => ({ ...box }), isUserAdjusted: () => userAdjusted, ensureBaseWhenUnadjusted: () => { if (!userAdjusted) reset(false); } };
}
