export const VALUE_STATE_CONTROLLER_V0_1 = Object.freeze({
  id: "value-state-controller-v0.1",
  version: "0.1.1",
  purpose: "Generic FE mechanics for active-edit-safe input writes plus persistent dependent-input and transient dependent-result states",
});

function elementsByDataKey(root, attribute, datasetKey, key) {
  return [...root.querySelectorAll(`[${attribute}]`)].filter((element) => {
    const datasetValue = element?.dataset?.[datasetKey];
    if (datasetValue !== undefined) return datasetValue === key;
    return element?.getAttribute?.(attribute) === key;
  });
}

export function createValueStateController(options = {}) {
  const root = options.root ?? globalThis.document;
  if (!root || typeof root.querySelectorAll !== "function") throw new TypeError("root with querySelectorAll is required");

  const transientMs = Number.isFinite(options.transientMs) ? Math.max(0, options.transientMs) : 1200;
  const schedule = options.setTimeoutFn ?? globalThis.setTimeout;
  const cancel = options.clearTimeoutFn ?? globalThis.clearTimeout;
  const getActiveElement = options.activeElementFn ?? (() => root.activeElement ?? root.ownerDocument?.activeElement ?? globalThis.document?.activeElement ?? null);
  const resultTimers = new Map();

  const inputElements = (key) => elementsByDataKey(root, "data-key", "key", key);
  const resultElements = (key) => elementsByDataKey(root, "data-result-key", "resultKey", key);

  function markDependentInput(key) {
    const elements = inputElements(key);
    elements.forEach((element) => element.classList.add("value-dependent-input"));
    return elements.length;
  }

  function confirmDependentInput(key) {
    const elements = inputElements(key);
    elements.forEach((element) => element.classList.remove("value-dependent-input"));
    return elements.length;
  }

  function setInputValue(key, next, optionsForWrite = {}) {
    const includeActive = optionsForWrite.includeActive === true;
    const pending = optionsForWrite.pending === true;
    const active = getActiveElement?.() ?? null;
    const nextText = String(next);
    let changed = 0;
    inputElements(key).forEach((element) => {
      if (!includeActive && element === active) return;
      if (String(element.value ?? "") === nextText) return;
      element.value = nextText;
      changed += 1;
      if (pending) element.classList.add("value-dependent-input");
    });
    return changed;
  }

  function syncInputMirrors(key, source) {
    if (!source) return 0;
    const sourceText = String(source.value ?? "");
    let changed = 0;
    inputElements(key).forEach((element) => {
      if (element === source || String(element.value ?? "") === sourceText) return;
      element.value = sourceText;
      changed += 1;
    });
    return changed;
  }

  function markResultChange(key) {
    const elements = resultElements(key);
    const prior = resultTimers.get(key);
    if (prior !== undefined && typeof cancel === "function") cancel(prior);
    elements.forEach((element) => element.classList.add("value-dependent-change"));
    if (!elements.length || typeof schedule !== "function") return elements.length;

    const timer = schedule(() => {
      resultElements(key).forEach((element) => element.classList.remove("value-dependent-change"));
      resultTimers.delete(key);
    }, transientMs);
    resultTimers.set(key, timer);
    return elements.length;
  }

  function clearResultChange(key) {
    const prior = resultTimers.get(key);
    if (prior !== undefined && typeof cancel === "function") cancel(prior);
    resultTimers.delete(key);
    const elements = resultElements(key);
    elements.forEach((element) => element.classList.remove("value-dependent-change"));
    return elements.length;
  }

  function clearAll() {
    [...resultTimers.values()].forEach((timer) => { if (typeof cancel === "function") cancel(timer); });
    resultTimers.clear();
    [...root.querySelectorAll(".value-dependent-input")].forEach((element) => element.classList.remove("value-dependent-input"));
    [...root.querySelectorAll(".value-dependent-change")].forEach((element) => element.classList.remove("value-dependent-change"));
  }

  return {
    markDependentInput,
    confirmDependentInput,
    setInputValue,
    syncInputMirrors,
    markResultChange,
    clearResultChange,
    clearAll,
    inputElements,
    resultElements,
  };
}
