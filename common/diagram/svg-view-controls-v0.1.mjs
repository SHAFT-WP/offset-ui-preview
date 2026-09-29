import { SVG_DIAGRAM_TEXT_SCALE_V0_1, normalizeDiagramTextUserScale } from "./svg-primitives-v0.1.mjs?v=0.1.6";
import { installSmartLabelDrag } from "./svg-smart-label-v0.1.mjs?v=0.1.5";
import { installSvgViewport } from "./svg-viewport-v0.1.mjs?v=0.1.5";

// Common Text / Size / Reset toolbar for a self-contained view that re-renders itself at a Text scale
// (common/diagram/SPEC.md "View toolbar controls"). Text re-renders the view through the caller's
// `render({ textScale })`; Size is the button-only viewport zoom of the view's own canvas; Reset returns
// the picture to 100% and keeps the Text scale and moved labels. The view's movable labels get the
// Common 0.5 s long-press. No model values are read.

export const SVG_VIEW_CONTROLS_V0_1 = Object.freeze({
  id: "svg-view-controls-v0.1",
  version: "0.1.0",
  sizeStep: 0.25,
  sizeMin: 0.5,
  sizeMax: 2,
});

const escapeText = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

// Toolbar markup: the FE places it (F1) and the app-common CSS styles its groups.
export function svgViewControlsMarkup({ title = "Diagram" } = {}) {
  const t = escapeText(title);
  const button = (name, text, label, extra = "") => `<button class="capture-button${extra}" type="button" data-view-control="${name}" aria-label="${label}">${text}</button>`;
  return `<div class="diagram-action-row" data-view-controls>`
    + `<div class="font-scale-control" role="group" aria-label="${t} text size"><span class="diagram-control-label">Text</span>`
    + button("text-down", "−", `${t} text smaller`)
    + button("text-reset", "100%", `Reset ${t} text size to 100%`, " diagram-scale-output")
    + button("text-up", "+", `${t} text larger`)
    + `</div><div class="view-scale-control" role="group" aria-label="${t} picture size"><span class="diagram-control-label">Size</span>`
    + button("zoom-out", "−", `${t} picture smaller`)
    + button("size-reset", "100%", `Reset ${t} size to 100%`, " diagram-scale-output")
    + button("zoom-in", "+", `${t} picture larger`)
    + `</div>${button("reset", "Reset", `Reset ${t} view`)}</div>`;
}

function viewBoxOf(svg) {
  const parts = svg.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
  return parts?.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0
    ? { x: parts[0], y: parts[1], w: parts[2], h: parts[3] }
    : { x: 0, y: 0, w: 900, h: 700 };
}

// render({ textScale }) draws the view and returns its result ({ canvas: { width, height } } when the
// view reports one) or null when there is nothing to draw.
export function installSvgViewControls(svg, { controls, render } = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  if (typeof render !== "function") throw new TypeError("render must be a function");
  const control = (name) => controls?.querySelector?.(`[data-view-control="${name}"]`) ?? null;
  const textDown = control("text-down");
  const textReset = control("text-reset");
  const textUp = control("text-up");
  const zoomOut = control("zoom-out");
  const sizeReset = control("size-reset");
  const zoomIn = control("zoom-in");
  const { sizeStep, sizeMin, sizeMax } = SVG_VIEW_CONTROLS_V0_1;
  let textScale = SVG_DIAGRAM_TEXT_SCALE_V0_1.userDefaultScale;
  let baseWidth = viewBoxOf(svg).w;

  const viewport = installSvgViewport(svg, {
    baseViewBox: viewBoxOf(svg),
    panOnlyWhenZoomed: true,
    buttonOnlyZoom: true,
    allowPageScrollWhenPanDisabled: true,
    maxZoom: sizeMax,
    maxZoomOut: 1 / sizeMin,
    onViewBoxChange: (box) => {
      const percent = Math.round((baseWidth / box.w) * 100);
      if (sizeReset) sizeReset.textContent = `${percent}%`;
      if (zoomIn) zoomIn.disabled = percent >= sizeMax * 100;
      if (zoomOut) zoomOut.disabled = percent <= sizeMin * 100;
    },
  });
  const drag = installSmartLabelDrag(svg);

  const syncText = () => {
    if (textReset) textReset.textContent = `${Math.round(textScale * 100)}%`;
    if (textDown) textDown.disabled = textScale <= SVG_DIAGRAM_TEXT_SCALE_V0_1.userMinScale;
    if (textUp) textUp.disabled = textScale >= SVG_DIAGRAM_TEXT_SCALE_V0_1.userMaxScale;
    svg.dataset.textUserScale = String(textScale);
  };

  // The view's canvas is the Size 100% base: an unadjusted picture follows it, a zoomed one keeps its
  // zoom; moved labels return to their offsets.
  function redraw() {
    const rendered = render({ textScale });
    if (!rendered) return rendered ?? null;
    const canvas = rendered.canvas;
    const base = canvas && canvas.width > 0 && canvas.height > 0
      ? { x: 0, y: 0, w: canvas.width, h: canvas.height }
      : viewBoxOf(svg);
    baseWidth = base.w;
    viewport.setBaseViewBox(base);
    if (viewport.isUserAdjusted()) viewport.refresh();
    else viewport.ensureBaseWhenUnadjusted();
    drag.applyStoredPositions();
    return rendered;
  }

  function setText(value) {
    textScale = Math.round(normalizeDiagramTextUserScale(value) * 10) / 10;
    syncText();
    return redraw();
  }

  const stepSize = (delta) => {
    const current = baseWidth / viewport.getViewBox().w;
    const next = Math.max(sizeMin, Math.min(sizeMax, Math.round((current + delta) * 100) / 100));
    if (next !== current) viewport.zoomCenter(current / next);
  };

  textDown?.addEventListener("click", () => setText(textScale - SVG_DIAGRAM_TEXT_SCALE_V0_1.userStepScale));
  textUp?.addEventListener("click", () => setText(textScale + SVG_DIAGRAM_TEXT_SCALE_V0_1.userStepScale));
  textReset?.addEventListener("click", () => setText(SVG_DIAGRAM_TEXT_SCALE_V0_1.userDefaultScale));
  zoomIn?.addEventListener("click", () => stepSize(sizeStep));
  zoomOut?.addEventListener("click", () => stepSize(-sizeStep));
  sizeReset?.addEventListener("click", () => viewport.reset());
  control("reset")?.addEventListener("click", () => viewport.reset());
  syncText();

  return {
    redraw,
    setText,
    getTextScale: () => textScale,
    // Application Default: Text 100%, picture 100%, labels back in place.
    resetAll() {
      textScale = SVG_DIAGRAM_TEXT_SCALE_V0_1.userDefaultScale;
      syncText();
      drag.reset();
      viewport.reset();
      return redraw();
    },
    viewport,
    drag,
  };
}
