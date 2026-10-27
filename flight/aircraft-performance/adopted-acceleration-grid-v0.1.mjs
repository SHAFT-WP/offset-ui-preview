import { tasToCas } from "../../common/airspeed/airspeed-v0.1.mjs";
import { ADOPTED_PERFORMANCE_MODEL_V0_1, evaluateAdoptedPerformance } from "./adopted-performance-model-v0.1.mjs";

// Fast (T − D)/m of the adopted performance model for trajectory solvers that call it tens of thousands of times
// (the BDP POP-UP Roll-in inside the Offset solve; owner 2026-10-27, POP-UP step 3b). Exact in the load factor:
// the model's force is T(h, M) − q·CdA(h, M) − k·(n·W)²/q, so (T − D)/m = A(h, V) − B(h, V)·n², with A and B from two
// evaluations (1 G, 2 G) at each node of a (altitude, TAS) grid, bilinear between nodes. The gravity term
// (− g·sin(gamma)) is the caller's. Nodes are built on demand and kept per premises (fuel, AoA).
// The envelope report is not made here: callers check their flown states with the exact model.
export const ADOPTED_ACCELERATION_GRID_V0_1 = Object.freeze({
  id: "adopted-acceleration-grid-v0.1",
  version: "0.1.0",
  performanceEntry: `${ADOPTED_PERFORMANCE_MODEL_V0_1.id} ${ADOPTED_PERFORMANCE_MODEL_V0_1.version}`,
  altitudeStepFt: 50,
  tasStepKt: 1,
});

const KT_TO_FPS = 1.687809857;
const MPS_TO_FPS = 1 / 0.3048;
const grids = new Map();

export class AccelerationUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "AccelerationUnavailableError";
  }
}

// premises: { fuelKg, aoaDeg }. Returns accelFps2(altitudeMslFt, tasFps, loadFactorG) = (T − D)/m in ft/s².
export function adoptedAccelerationGrid({ fuelKg, aoaDeg }) {
  const key = `${fuelKg}|${aoaDeg}`;
  let grid = grids.get(key);
  if (grid) return grid;
  const nodes = new Map();
  const { altitudeStepFt: dh, tasStepKt: dv } = ADOPTED_ACCELERATION_GRID_V0_1;
  const node = (i, j) => {
    const k = i * 100000 + j;
    let value = nodes.get(k);
    if (value) return value;
    const altitudeMslFt = i * dh;
    const tasKt = j * dv;
    const at = (loadFactorG) => {
      let perf;
      try {
        perf = evaluateAdoptedPerformance({ altitudeMslFt, casKt: tasToCas(tasKt, altitudeMslFt), fuelKg, loadFactorG, aoaDeg, verticalSpeedMps: 0 }, { allowResearchExtrapolation: true });
      } catch (error) {
        value = { error: `MIL performance unavailable at ${Math.round(altitudeMslFt)} ft MSL (${error.message})` };
        return null;
      }
      return (perf.netForceN / perf.massKg) * MPS_TO_FPS;
    };
    const a1 = at(1);
    const a2 = a1 === null ? null : at(2);
    if (a1 !== null && a2 !== null) {
      const b = (a1 - a2) / 3;
      value = { a: a1 + b, b };
    }
    nodes.set(k, value);
    return value;
  };
  grid = (altitudeMslFt, tasFps, loadFactorG) => {
    const x = altitudeMslFt / dh;
    const y = tasFps / KT_TO_FPS / dv;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const n00 = node(i, j);
    const n10 = node(i + 1, j);
    const n01 = node(i, j + 1);
    const n11 = node(i + 1, j + 1);
    const failed = [n00, n10, n01, n11].find((n) => n.error);
    if (failed) throw new AccelerationUnavailableError(failed.error);
    const lerp = (field) => (n00[field] * (1 - fx) + n10[field] * fx) * (1 - fy) + (n01[field] * (1 - fx) + n11[field] * fx) * fy;
    return lerp("a") - lerp("b") * loadFactorG * loadFactorG;
  };
  grids.set(key, grid);
  return grid;
}
