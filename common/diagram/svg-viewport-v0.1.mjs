export const SVG_VIEWPORT_V0_1 = Object.freeze({
  id: "svg-viewport-v0.1",
  version: "0.1.2",
  purpose: "Generic SVG auto-fit projection plus viewBox zoom/pan interaction with optional page-scroll pass-through",
});

function finitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function normalizeMargins(value = 0) {
  if (Number.isFinite(value)) {
    const margin = Math.max(0, Number(value));
    return { left: margin, right: margin, top: margin, bottom: margin };
  }
  const source = value && typeof value === "object" ? value : {};
  return {
    left: Math.max(0, Number(source.left) || 0),
    right: Math.max(0, Number(source.right) || 0),
    top: Math.max(0, Number(source.top) || 0),
    bottom: Math.max(0, Number(source.bottom) || 0),
  };
}

export function createSvgAutoFitProjection(points, options = {}) {
  const width = Number.isFinite(options.width) && options.width > 0 ? Number(options.width) : 1180;
  const height = Number.isFinite(options.height) && options.height > 0 ? Number(options.height) : 720;
  const margins = normalizeMargins(options.margins ?? 0);
  const minSpan = Number.isFinite(options.minSpan) && options.minSpan > 0 ? Number(options.minSpan) : 0.5;
  const flipY = options.flipY === true;
  const valid = Array.isArray(points) ? points.filter(finitePoint) : [];

  if (!valid.length) {
    const center = { x: width / 2, y: height / 2 };
    const project = (point) => ({
      x: center.x + (Number(point?.x) || 0),
      y: center.y + (flipY ? -(Number(point?.y) || 0) : (Number(point?.y) || 0)),
    });
    return {
      project,
      scale: 1,
      bounds: null,
      margins,
      usableWidth: Math.max(0, width - margins.left - margins.right),
      usableHeight: Math.max(0, height - margins.top - margins.bottom),
      usedWidth: 0,
      usedHeight: 0,
      offsetX: center.x,
      offsetY: center.y,
      flipY,
    };
  }

  const minX = Math.min(...valid.map((point) => point.x));
  const maxX = Math.max(...valid.map((point) => point.x));
  const minY = Math.min(...valid.map((point) => point.y));
  const maxY = Math.max(...valid.map((point) => point.y));
  const usableWidth = Math.max(1e-9, width - margins.left - margins.right);
  const usableHeight = Math.max(1e-9, height - margins.top - margins.bottom);
  const spanX = Math.max(minSpan, maxX - minX);
  const spanY = Math.max(minSpan, maxY - minY);
  const scale = Math.min(usableWidth / spanX, usableHeight / spanY);
  const usedWidth = spanX * scale;
  const usedHeight = spanY * scale;
  const offsetX = margins.left + (usableWidth - usedWidth) / 2;
  const offsetY = margins.top + (usableHeight - usedHeight) / 2;

  const project = (point) => ({
    x: offsetX + (point.x - minX) * scale,
    y: flipY
      ? offsetY + (maxY - point.y) * scale
      : offsetY + (point.y - minY) * scale,
  });

  return {
    project,
    scale,
    bounds: { minX, maxX, minY, maxY, spanX, spanY },
    margins,
    usableWidth,
    usableHeight,
    usedWidth,
    usedHeight,
    offsetX,
    offsetY,
    flipY,
  };
}

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
  const panOnlyWhenZoomed = options.panOnlyWhenZoomed === true;
  const buttonOnlyZoom = options.buttonOnlyZoom === true;
  const wheelZoom = !buttonOnlyZoom && options.wheelZoom !== false;
  const pinchZoom = !buttonOnlyZoom && options.pinchZoom !== false;
  const doubleClickReset = !buttonOnlyZoom && options.doubleClickReset !== false;
  const allowPageScrollWhenPanDisabled = options.allowPageScrollWhenPanDisabled === true;
  let box = { ...base };
  let userAdjusted = false;
  let mouse = null;
  const touches = new Map();
  let lastTouchCenter = null;
  let lastTouchDistance = null;

  const isZoomedIn = () => box.w < base.w - 1e-6;
  const canPan = () => !panOnlyWhenZoomed || isZoomedIn();
  const pageScrollEnabled = () => allowPageScrollWhenPanDisabled && !canPan() && !pinchZoom;
  const updateInteractionState = () => {
    const pannable = canPan();
    const pageScrollable = pageScrollEnabled();
    svg.dataset.panEnabled = pannable ? "true" : "false";
    svg.dataset.pageScrollEnabled = pageScrollable ? "true" : "false";
    svg.dataset.zoomInputMode = buttonOnlyZoom ? "buttons" : "interactive";
    svg.style.cursor = pannable ? "grab" : "default";
    svg.style.touchAction = pageScrollable ? "pan-y" : "none";
  };
  const apply = (next) => {
    const w = Math.max(minW, Math.min(maxW, next.w));
    const h = w * aspect;
    box = { x: next.x, y: next.y, w, h };
    svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.w} ${box.h}`);
    updateInteractionState();
  };
  const reset = (markUser = false) => { box = { ...base }; apply(box); userAdjusted = markUser; };
  const autoFit = () => reset(false);
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
    if (!canPan()) return false;
    const rect = svg.getBoundingClientRect();
    apply({ x: box.x - (dx / rect.width) * box.w, y: box.y - (dy / rect.height) * box.h, w: box.w, h: box.h });
    userAdjusted = true;
    return true;
  };

  const onWheel = (event) => {
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 0.86 : 1.16);
  };
  const onDoubleClick = (event) => {
    event.preventDefault();
    reset(true);
  };
  const onPointerDown = (event) => {
    if (event.pointerType === "touch") {
      if (!canPan() && !pinchZoom) return;
      if (!pinchZoom && touches.size >= 1) return;
      try { svg.setPointerCapture(event.pointerId); } catch (_) {}
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const values = [...touches.values()];
      if (values.length === 1) {
        lastTouchCenter = { ...values[0] };
        lastTouchDistance = null;
      } else {
        lastTouchCenter = { x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2 };
        lastTouchDistance = Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y);
      }
      return;
    }
    if (event.button === 0 && canPan()) {
      try { svg.setPointerCapture(event.pointerId); } catch (_) {}
      mouse = { id: event.pointerId, x: event.clientX, y: event.clientY };
      svg.style.cursor = "grabbing";
    }
  };
  const onPointerMove = (event) => {
    if (event.pointerType === "touch" && touches.has(event.pointerId)) {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const values = [...touches.values()];
      if (values.length === 1) {
        const center = { ...values[0] };
        if (lastTouchCenter) panBy(center.x - lastTouchCenter.x, center.y - lastTouchCenter.y);
        lastTouchCenter = center;
        lastTouchDistance = null;
      } else if (pinchZoom) {
        const center = { x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2 };
        const distance = Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y);
        if (lastTouchDistance && distance > 0) zoomAt(center.x, center.y, lastTouchDistance / distance);
        if (lastTouchCenter) panBy(center.x - lastTouchCenter.x, center.y - lastTouchCenter.y);
        lastTouchCenter = center;
        lastTouchDistance = distance;
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
      if (!values.length) {
        lastTouchCenter = null;
        lastTouchDistance = null;
      } else if (values.length === 1) {
        lastTouchCenter = { ...values[0] };
        lastTouchDistance = null;
      }
      updateInteractionState();
      return;
    }
    if (mouse?.id === event.pointerId) mouse = null;
    updateInteractionState();
  };

  if (wheelZoom) svg.addEventListener("wheel", onWheel, { passive: false });
  if (doubleClickReset) svg.addEventListener("dblclick", onDoubleClick);
  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", onPointerEnd);
  svg.addEventListener("pointercancel", onPointerEnd);

  options.zoomInButton?.addEventListener("click", () => zoomCenter(0.8));
  options.zoomOutButton?.addEventListener("click", () => zoomCenter(1.25));
  options.fitButton?.addEventListener("click", () => reset(true));
  options.resetButton?.addEventListener("click", () => reset(false));
  reset(false);

  return {
    reset,
    autoFit,
    fit: () => reset(true),
    zoomCenter,
    getViewBox: () => ({ ...box }),
    isZoomedIn,
    canPan,
    isPageScrollEnabled: pageScrollEnabled,
    isUserAdjusted: () => userAdjusted,
    ensureBaseWhenUnadjusted: () => { if (!userAdjusted) reset(false); },
  };
}
