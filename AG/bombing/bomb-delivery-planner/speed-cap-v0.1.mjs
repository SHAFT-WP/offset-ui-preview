import { casToTas } from "../../../common/airspeed/airspeed-v0.1.mjs";

const KT_TO_FPS = 1.687809857;

// Speed cap table v0.1 (2026-11-19, the POP-UP MIL dive cap; Roll-in v0.2.3 and dive-track-mil v0.1).
// TAS (ft/s) of a fixed KCAS against altitude, linear between 25 ft nodes built on demand and kept per KCAS (the
// interpolation error is far below 1e-6 kt): [TAS, dTAS/dh]. Shared by the Track and the Roll-in cap.
const CAP_STEP_FT = 25;
const capTables = new Map();
export function capTasTable(capKcas) {
  let table = capTables.get(capKcas);
  if (table) return table;
  const nodes = new Map();
  const node = (i) => {
    let v = nodes.get(i);
    if (v === undefined) {
      v = casToTas(capKcas, i * CAP_STEP_FT) * KT_TO_FPS;
      nodes.set(i, v);
    }
    return v;
  };
  table = (altitudeMslFt) => {
    const x = altitudeMslFt / CAP_STEP_FT;
    const i = Math.floor(x);
    const a = node(i);
    const b = node(i + 1);
    return [a + (b - a) * (x - i), (b - a) / CAP_STEP_FT];
  };
  if (capTables.size > 64) capTables.clear();
  capTables.set(capKcas, table);
  return table;
}

