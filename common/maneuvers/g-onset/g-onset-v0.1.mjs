export const G_ONSET_MODEL = Object.freeze({
  id: "fst-linear-g-onset-v0.1",
  version: "0.1.0",
});

function requireFinite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

export function linearGOnset({ baselineG, targetG, gOnsetTimeSec, elapsedTimeSec }) {
  requireFinite("baselineG", baselineG);
  requireFinite("targetG", targetG);
  requireFinite("gOnsetTimeSec", gOnsetTimeSec);
  requireFinite("elapsedTimeSec", elapsedTimeSec);

  if (!(gOnsetTimeSec > 0)) throw new RangeError("gOnsetTimeSec must be > 0");
  if (elapsedTimeSec < 0) throw new RangeError("elapsedTimeSec must be >= 0");

  const fraction = Math.max(0, Math.min(1, elapsedTimeSec / gOnsetTimeSec));
  const loadFactorG = baselineG + (targetG - baselineG) * fraction;

  return {
    model: { ...G_ONSET_MODEL },
    baselineG,
    targetG,
    gOnsetTimeSec,
    elapsedTimeSec,
    fraction,
    loadFactorG,
    complete: fraction >= 1,
  };
}
