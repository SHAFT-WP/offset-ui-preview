import { evaluatePw229Performance } from "./work/pw229-performance-v0.1.mjs";
import { PW229_MODEL_V0_1 } from "./data/pw229-model-v0.1.mjs";

// The adopted aircraft performance model (owner 2026-10-27, POP-UP SPEC §13.4; SPEC §16): the one entry every BE
// that needs thrust / drag imports (BOX OUT v0.2, Wheel-BOX Return v0.1, later the BDP POP-UP option), so a model
// update changes them together. Today it is the PW-229 MIL research model (§14, one configuration), unchanged:
// importing it here instead of the model files changes no result.
export const ADOPTED_PERFORMANCE_MODEL_V0_1 = Object.freeze({
  id: "adopted-aircraft-performance-v0.1",
  version: "0.1.0",
  model: PW229_MODEL_V0_1,
});

// The model record (modelId, engineModel, powerSetting, configurationId, domain, ...).
export const ADOPTED_PERFORMANCE_MODEL = PW229_MODEL_V0_1;

// Thrust, drag and specific excess power at one state; the PW-229 evaluator's contract and options.
export function evaluateAdoptedPerformance(state, options) {
  return evaluatePw229Performance(PW229_MODEL_V0_1, state, options);
}
