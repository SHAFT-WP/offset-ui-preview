// POP-UP Design steps (owner 2026-11-18, the planning procedure for the Design tab: "pop up planning의 가장 처음은 BDP
// 설정이다 … Min Popup Range … APEX Min 허용 속도 300노트 … APEX 스피드 300-350 범위 … 두개를 한번 씩 반복 … 센터에 있는지").
// From sweeps of #1 under the page's conditions (popup-dependency-sweep-v0.1, every point one direct Flight solve):
//   Step 1  BDP as entered (Dive, Release Altitude, Tracking Time → MAP, Roll-in Altitude).
//   Step 2  Popup Angle window: low = the shallowest angle with an Offset-Popup Time ≥ 2 s (a steeper climb is shorter),
//           high = the steepest with the slowest speed Pop → Apex ≥ 300 KCAS, and never past the pull-up arc limit.
//   Step 3  Min Exposure window: the angles with an Apex speed of 300–350 KCAS (exposure falls as the angle rises).
//           The recommended Popup Angle range is both windows together; its centre is the suggestion.
//   Step 4  Offset Angle range at that Popup Angle: up to the largest with an Offset-Popup Time ≥ 2 s. No lower limit
//           (owner 2026-11-18, "상한은 없어도 되"); the 30 s Offset-Popup Time is shown only as a reference.
//   Step 5  Once more: when the page's Offset Angle is past that limit, the Popup window again at the limit's angle.
//   Step 6  What to change when a window is empty or the page's value is outside it.
// Pure calculation: no DOM, no storage. Curves are read between grid points by straight-line interpolation.
export const POPUP_DESIGN_STEPS_V0_1 = Object.freeze({ id: "popup-design-steps-v0.1", version: "0.1.0" });

export const POPUP_DESIGN_LIMITS = Object.freeze({
  minOffsetPopupSec: 2,
  apexMinKcas: 300,
  apexMaxKcas: 350,
  // Reference only (owner: "꼭 필요하면 30"): an Offset-Popup Time this long is shown, never a limit.
  longOffsetPopupSec: 30,
});

const range = (from, to, step) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => +(from + i * step).toFixed(6));
// The sweep grids (1° each).
export const POPUP_ANGLE_GRID = Object.freeze(range(10, 55, 1));
export const OFFSET_ANGLE_GRID = Object.freeze(range(2, 40, 1));

const finite = (v) => Number.isFinite(v);
const yOf = (p, key) => (p && finite(p.y?.[key]) ? p.y[key] : null);

// Where `key` crosses `level` between two grid points, scanning from the low end: the first crossing in the given
// direction ("up": from below to at-or-above). null when none.
export function crossing(points, key, level, direction) {
  const pts = [...points].filter((p) => finite(p.x)).sort((a, b) => a.x - b.x);
  for (let i = 0; i < pts.length; i += 1) {
    const y = yOf(pts[i], key);
    if (y === null) continue;
    const met = direction === "up" ? y >= level : y < level;
    if (!met) continue;
    // The previous point with a value (null: the curve already meets it at its first point).
    let j = i - 1;
    while (j >= 0 && yOf(pts[j], key) === null) j -= 1;
    if (j < 0) return { x: pts[i].x, atStart: true };
    const y0 = yOf(pts[j], key);
    const t = y === y0 ? 0 : (level - y0) / (y - y0);
    return { x: pts[j].x + (pts[i].x - pts[j].x) * Math.min(1, Math.max(0, t)), atStart: false };
  }
  return null;
}

// The value of `key` at x (straight line between the two grid points around it).
export function valueAt(points, key, x) {
  const pts = [...points].filter((p) => yOf(p, key) !== null).sort((a, b) => a.x - b.x);
  if (!pts.length || !finite(x)) return null;
  if (x <= pts[0].x) return yOf(pts[0], key);
  for (let i = 1; i < pts.length; i += 1) {
    if (x <= pts[i].x) {
      const a = pts[i - 1], b = pts[i];
      return yOf(a, key) + (yOf(b, key) - yOf(a, key)) * ((x - a.x) / (b.x - a.x));
    }
  }
  return yOf(pts[pts.length - 1], key);
}

// Step 2 + 3 from a Popup Angle sweep (x = Popup Angle, y = sweep outputs).
export function popupAngleWindow(points, limits = POPUP_DESIGN_LIMITS) {
  const pts = [...points].filter((p) => finite(p.x)).sort((a, b) => a.x - b.x);
  const flown = pts.filter((p) => yOf(p, "apexKcas") !== null);
  const arcDeg = flown.length ? flown[flown.length - 1].x : null;
  const firstDeg = flown.length ? flown[0].x : null;
  const lowCross = crossing(flown, "offsetPopupTimeSec", limits.minOffsetPopupSec, "up");
  const low = lowCross ? lowCross.x : null;
  // The Apex speed falls as the angle rises: the steepest angle at or above 300 KCAS, the shallowest at or below 350.
  const apex300 = crossing(flown, "apexKcas", limits.apexMinKcas, "down");
  const high300 = apex300 ? (apex300.atStart ? null : apex300.x) : arcDeg;
  const apex350 = crossing(flown, "apexKcas", limits.apexMaxKcas + 1e-9, "down");
  const from350 = apex350 ? apex350.x : null;
  const high = high300 === null ? null : arcDeg === null ? high300 : Math.min(high300, arcDeg);
  const fromDeg = [low, from350 ?? firstDeg].filter(finite);
  const recFrom = fromDeg.length ? Math.max(...fromDeg) : null;
  const recommended = low !== null && high !== null && recFrom !== null && recFrom <= high
    ? { fromDeg: recFrom, toDeg: high, centreDeg: (recFrom + high) / 2 } : null;
  // What sets the upper end: the Apex 300 KCAS line or the pull-up arc (the climb no longer fits under the Roll-in).
  const highBy = high === null ? null : apex300 && !apex300.atStart && (arcDeg === null || apex300.x <= arcDeg) ? "apex" : "arc";
  return {
    lowDeg: low, highDeg: high, highBy, arcLimitDeg: arcDeg, apex300Deg: apex300 && !apex300.atStart ? apex300.x : null, apex350Deg: from350,
    minExposure: high === null ? null : { fromDeg: from350 ?? firstDeg, toDeg: high },
    recommended,
    // Why the window is empty, when it is (for Step 6).
    short: low === null || (high !== null && low > high),
    slow: high === null,
  };
}

// Step 4 from an Offset Angle sweep (x = Offset Angle) at a fixed Popup Angle.
export function offsetAngleRange(points, limits = POPUP_DESIGN_LIMITS) {
  const pts = [...points].filter((p) => finite(p.x)).sort((a, b) => a.x - b.x);
  const shortCross = crossing(pts, "offsetPopupTimeSec", limits.minOffsetPopupSec, "down");
  const lastValue = [...pts].reverse().find((p) => yOf(p, "offsetPopupTimeSec") !== null);
  const highDeg = shortCross ? (shortCross.atStart ? null : shortCross.x) : lastValue?.x ?? null;
  const longCross = crossing(pts, "offsetPopupTimeSec", limits.longOffsetPopupSec, "down");
  return {
    highDeg,
    // Reference: below this angle the Offset-Popup Time is longer than 30 s.
    longBelowDeg: longCross && !longCross.atStart ? longCross.x : null,
    noneFits: shortCross?.atStart === true,
  };
}

// Steps 1–6 for the page: `current` = { popupAngleDeg, offsetAngleDeg, approachRangeNm, offsetPopupTimeSec, apexKcas,
// mapNm, rollInAltitudeMslFt, trackingTimeSec, releaseAltitudeMslFt, diveAngleDeg }; `popup` / `offset` / `popup2` the
// sweeps (popup2 only when Step 5 ran). Returns the windows, the centring and the hints.
export function designSteps({ current, popup, offset, popup2 = null, limits = POPUP_DESIGN_LIMITS }) {
  const w1 = popupAngleWindow(popup, limits);
  const o = offset ? offsetAngleRange(offset, limits) : null;
  const w2 = popup2 ? popupAngleWindow(popup2, limits) : null;
  const w = w2 ?? w1;
  const centring = (value, from, to) => (finite(value) && finite(from) && finite(to) && to > from
    ? { value, from, to, centre: (from + to) / 2, offFromCentre: value - (from + to) / 2, inside: value >= from - 1e-9 && value <= to + 1e-9, share: (value - from) / (to - from) }
    : null);
  const hints = [];
  if (w.short && !w.slow) {
    hints.push({ step: 6, kind: "short", text: `Offset-Popup Time ${limits.minOffsetPopupSec} s를 Apex ${limits.apexMinKcas} KCAS 안에서 못 맞춥니다: Offset Angle 줄이기${o?.highDeg ? ` (${o.highDeg.toFixed(1)}° 이하)` : ""}, VRP Range 늘리기, Tracking Time 줄이기, Offset Speed 낮추기` });
  }
  if (w.slow) hints.push({ step: 6, kind: "slow", text: `Apex ${limits.apexMinKcas} KCAS를 지키는 Popup Angle이 없습니다: Pop-up Speed 올리기, Popup G 올리기, Roll-in Altitude 낮추기` });
  if (w.recommended && finite(current.popupAngleDeg) && (current.popupAngleDeg < w.recommended.fromDeg - 0.05 || current.popupAngleDeg > w.recommended.toDeg + 0.05)) {
    hints.push({ step: 6, kind: "popupAngle", text: `Popup Angle ${current.popupAngleDeg.toFixed(1)}°는 추천 범위 밖입니다: ${w.recommended.centreDeg.toFixed(1)}° (범위 ${w.recommended.fromDeg.toFixed(1)}–${w.recommended.toDeg.toFixed(1)}°)` });
  }
  if (o?.highDeg !== null && o?.highDeg !== undefined && finite(current.offsetAngleDeg) && current.offsetAngleDeg > o.highDeg + 0.05) {
    hints.push({ step: 6, kind: "offsetAngle", text: `Offset Angle ${current.offsetAngleDeg.toFixed(1)}°는 Offset-Popup ${limits.minOffsetPopupSec} s 한계 ${o.highDeg.toFixed(1)}°보다 큽니다: 줄이거나 VRP Range를 늘리기` });
  }
  if (o?.noneFits) hints.push({ step: 6, kind: "offsetNone", text: `이 Popup Angle에서는 어떤 Offset Angle도 Offset-Popup ${limits.minOffsetPopupSec} s를 못 만듭니다: Popup Angle을 올리거나 MAP을 늘리기 (Tracking Time 줄이기 등)` });
  return {
    limits,
    step1: { diveAngleDeg: current.diveAngleDeg, releaseAltitudeMslFt: current.releaseAltitudeMslFt, trackingTimeSec: current.trackingTimeSec, mapNm: current.mapNm, rollInAltitudeMslFt: current.rollInAltitudeMslFt, approachRangeNm: current.approachRangeNm },
    popupWindow: w1,
    offsetRange: o,
    popupWindow2: w2,
    centring: {
      popupAngle: w.recommended ? centring(current.popupAngleDeg, w.recommended.fromDeg, w.recommended.toDeg) : null,
      // No lower limit: the margin to the upper one only.
      offsetAngle: o && finite(o.highDeg) && finite(current.offsetAngleDeg) ? { value: current.offsetAngleDeg, to: o.highDeg, marginDeg: o.highDeg - current.offsetAngleDeg } : null,
    },
    suggestion: { popupAngleDeg: w.recommended?.centreDeg ?? null },
    hints,
  };
}
