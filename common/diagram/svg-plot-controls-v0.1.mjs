export const SVG_PLOT_CONTROLS_V0_1 = Object.freeze({
  id: "svg-plot-controls-v0.1",
  version: "0.1.0",
  purpose: "Common Text/Size/Reset control mechanics for modular SVG plots",
});

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function finitePercent(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function setDisabled(button, disabled) {
  if (button) button.disabled = !!disabled;
}

function setText(button, value) {
  if (button) button.textContent = String(value);
}

export function applySvgTextScale(svg, percent = 100) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  const scale = finitePercent(percent, 100) / 100;
  svg.querySelectorAll("text").forEach((node) => {
    let base = Number(node.dataset.plotBaseFontSize);
    if (!Number.isFinite(base)) {
      base = Number.parseFloat(node.getAttribute("font-size") ?? "");
      if (!Number.isFinite(base)) return;
      node.dataset.plotBaseFontSize = String(base);
    }
    node.setAttribute("font-size", String(base * scale));
  });
  return scale;
}

export function installSvgPlotControls(options = {}) {
  const svg = options.svg;
  const viewport = options.viewport;
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  if (!viewport || typeof viewport.fit !== "function" || typeof viewport.zoomCenter !== "function") {
    throw new TypeError("viewport with fit() and zoomCenter() is required");
  }

  const textMin = finitePercent(options.textMinPercent, 50);
  const textMax = finitePercent(options.textMaxPercent, 200);
  const textStep = finitePercent(options.textStepPercent, 10);
  const sizeMin = finitePercent(options.sizeMinPercent, 50);
  const sizeMax = finitePercent(options.sizeMaxPercent, 200);
  const sizeStep = finitePercent(options.sizeStepPercent, 25);
  const textDefault = clamp(finitePercent(options.textDefaultPercent, 100), textMin, textMax);
  const sizeDefault = clamp(finitePercent(options.sizeDefaultPercent, 100), sizeMin, sizeMax);

  let textPercent = textDefault;
  let sizePercent = sizeDefault;

  const controls = options.controls ?? {};

  function renderControlState() {
    setText(controls.textValueButton, `${Math.round(textPercent)}%`);
    setText(controls.sizeValueButton, `${Math.round(sizePercent)}%`);
    setDisabled(controls.textOutButton, textPercent <= textMin);
    setDisabled(controls.textInButton, textPercent >= textMax);
    setDisabled(controls.sizeOutButton, sizePercent <= sizeMin);
    setDisabled(controls.sizeInButton, sizePercent >= sizeMax);
  }

  function refreshTextScale() {
    applySvgTextScale(svg, textPercent);
    renderControlState();
  }

  function applySizePercent(nextPercent) {
    sizePercent = clamp(nextPercent, sizeMin, sizeMax);
    viewport.fit();
    if (Math.abs(sizePercent - 100) > 1e-9) viewport.zoomCenter(100 / sizePercent);
    renderControlState();
    return sizePercent;
  }

  function setTextPercent(nextPercent) {
    textPercent = clamp(nextPercent, textMin, textMax);
    refreshTextScale();
    return textPercent;
  }

  function reset() {
    textPercent = textDefault;
    sizePercent = sizeDefault;
    if (typeof options.resetAction === "function") options.resetAction();
    else viewport.reset?.(false);
    if (Math.abs(sizePercent - 100) > 1e-9) {
      viewport.fit();
      viewport.zoomCenter(100 / sizePercent);
    }
    refreshTextScale();
    renderControlState();
  }

  controls.textOutButton?.addEventListener("click", () => setTextPercent(textPercent - textStep));
  controls.textInButton?.addEventListener("click", () => setTextPercent(textPercent + textStep));
  controls.textValueButton?.addEventListener("click", () => setTextPercent(textDefault));
  controls.sizeOutButton?.addEventListener("click", () => applySizePercent(sizePercent - sizeStep));
  controls.sizeInButton?.addEventListener("click", () => applySizePercent(sizePercent + sizeStep));
  controls.sizeValueButton?.addEventListener("click", () => applySizePercent(sizeDefault));
  controls.resetButton?.addEventListener("click", reset);

  refreshTextScale();
  if (Math.abs(sizeDefault - 100) > 1e-9) applySizePercent(sizeDefault);
  else renderControlState();

  return {
    reset,
    refreshTextScale,
    setTextPercent,
    setSizePercent: applySizePercent,
    getTextPercent: () => textPercent,
    getSizePercent: () => sizePercent,
  };
}
