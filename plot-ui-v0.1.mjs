import { SVG_DIAGRAM_STYLE_V0_1, SVG_NS } from "./common/diagram/svg-primitives-v0.1.mjs";
import { installSvgPlotControls } from "./common/diagram/svg-plot-controls-v0.1.mjs";
import { installOffsetTopViewControls } from "./renderer-v0.1.mjs";

export const OFFSET_PLOT_UI_V0_1 = Object.freeze({
  id: "offset-plot-ui-v0.1",
  version: "0.1.1",
  purpose: "Offset Top View bridge to Common Text/Size/Reset controls and BDP Lead Angle presentation",
});

const $ = (selector) => document.querySelector(selector);
const svg = $("#offset-top-view");
const plotRoot = $("#offset-plot");

function syncRollInLead() {
  const group = svg?.querySelector('[data-label-key="roll-in"]');
  const primary = group?.querySelector("text");
  const source = document.querySelector('[data-result-key="leadAngleDeg"]');
  if (!group || !primary || !source) return;

  const sourceText = String(source.textContent ?? "").trim();
  if (!sourceText || sourceText === "-") return;

  let detail = group.querySelector('text[data-roll-in-lead="true"]');
  if (!detail) {
    detail = document.createElementNS(SVG_NS, "text");
    detail.setAttribute("data-roll-in-lead", "true");
    detail.setAttribute("data-result-key", "leadAngleDeg");
    detail.setAttribute("text-anchor", primary.getAttribute("text-anchor") ?? "start");
    detail.setAttribute("font-size", String(SVG_DIAGRAM_STYLE_V0_1.font.compactPx));
    detail.setAttribute("font-weight", "850");
    detail.setAttribute("fill", primary.getAttribute("fill") ?? "#176dac");
    detail.setAttribute("stroke", "#ffffff");
    detail.setAttribute("stroke-width", String(SVG_DIAGRAM_STYLE_V0_1.label.haloPx));
    detail.setAttribute("paint-order", "stroke");
    detail.setAttribute("stroke-linejoin", "round");
    detail.setAttribute("pointer-events", "none");
    group.append(detail);
  }

  const x = Number(primary.getAttribute("x"));
  const y = Number(primary.getAttribute("y"));
  const baseFont = Number.parseFloat(primary.dataset.plotBaseFontSize || primary.getAttribute("font-size") || String(SVG_DIAGRAM_STYLE_V0_1.font.smartLabelPx));
  if (Number.isFinite(x)) detail.setAttribute("x", String(x));
  if (Number.isFinite(y)) detail.setAttribute("y", String(y + Math.max(14, baseFont * 1.35)));
  const next = `LEAD ANGLE · ${sourceText}`;
  if (detail.textContent !== next) detail.textContent = next;
}

function installAfterInitialRender() {
  if (!svg || !plotRoot || plotRoot.childElementCount === 0) return false;

  // The Offset controller owns initial renderer/viewport installation.  This
  // bridge attaches only after that first render so it cannot win a module
  // execution race and leave the renderer with a partially installed viewport.
  const viewport = installOffsetTopViewControls(svg, {});
  const controls = installSvgPlotControls({
    svg,
    viewport,
    textDefaultPercent: 100,
    textMinPercent: 50,
    textMaxPercent: 200,
    textStepPercent: 10,
    sizeDefaultPercent: 100,
    sizeMinPercent: 50,
    sizeMaxPercent: 200,
    sizeStepPercent: 25,
    resetAction: () => $("#zoom-reset")?.click(),
    controls: {
      textOutButton: $("#plot-text-out"),
      textValueButton: $("#plot-text-value"),
      textInButton: $("#plot-text-in"),
      sizeOutButton: $("#plot-size-out"),
      sizeValueButton: $("#plot-size-value"),
      sizeInButton: $("#plot-size-in"),
      resetButton: $("#plot-reset"),
    },
  });

  const observer = new MutationObserver(() => {
    syncRollInLead();
    controls.refreshTextScale();
  });
  observer.observe(plotRoot, { childList: true, subtree: true });

  syncRollInLead();
  controls.refreshTextScale();
  return true;
}

if (svg && plotRoot) {
  let attempts = 0;
  const waitForRenderer = () => {
    if (installAfterInitialRender()) return;
    attempts += 1;
    // Failsafe: never interfere with the base Offset controller if its first
    // render did not complete.  The calculation/status surface can then expose
    // the originating error instead of this optional presentation bridge
    // becoming the failure source.
    if (attempts < 180) requestAnimationFrame(waitForRenderer);
  };
  requestAnimationFrame(waitForRenderer);
}
