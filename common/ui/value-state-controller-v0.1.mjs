export const VALUE_STATE_CONTROLLER_V0_1 = Object.freeze({
  id: "value-state-controller-v0.1",
  version: "0.1.0",
  purpose: "Generic FE mechanics for persistent dependent-input and transient dependent-result value states",
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
    markResultChange,
    clearResultChange,
    clearAll,
    inputElements,
    resultElements,
  };
}
