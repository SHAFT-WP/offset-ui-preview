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
// 0.1.1 (owner 2026-11-20, DESIGN-STEPS.md S2): popupAngleRange (the step-2 Popup Angle range = AUTO angle and the
// Apex 300–350 KCAS area together, min..max, with the Min Pop-up Distance at its two ends) and popupProfileLine (the
// flown pop-up as one side-view line: Pop → Roll-in Start → Release, ground distance along the path).
// 0.1.2 (owner 2026-11-22): popupAngleRange = Approach-Pop 2 s angle .. Apex 300 KCAS (or the arc limit) angle.
export const POPUP_DESIGN_STEPS_V0_1 = Object.freeze({ id: "popup-design-steps-v0.1", version: "0.1.2" });

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

// Step 2 (DESIGN-STEPS.md §2; owner 2026-11-22, "apex에서의 속도는 min speed 300 … approach pop distance로 min angle",
// option "Approach-Pop 2 s"): the Popup Angle range (the green area) runs from the angle where the Approach-Pop reaches
// 2 s (it grows with the angle) to the angle where the Apex speed falls to 300 KCAS, or the last angle that flies (the
// pull-up arc) when that comes first. possibleFromDeg: where the Approach-Pop reaches 0 (the 0–2 s part is drawn light).
// The Apex 300–350 KCAS area and the AUTO angle are kept for reference only. Min Pop-up Distance (Pop → Roll-in Start,
// horizontal) and the Approach-Pop Distance / Time are read at both ends.
export function popupAngleRange(points, autoDeg, limits = POPUP_DESIGN_LIMITS) {
  const w = popupAngleWindow(points, limits);
  const apexArea = w.minExposure && finite(w.minExposure.fromDeg) && finite(w.minExposure.toDeg) && w.minExposure.fromDeg <= w.minExposure.toDeg
    ? { fromDeg: w.minExposure.fromDeg, toDeg: w.minExposure.toDeg } : null;
  const flown = [...points].filter((p) => yOf(p, "apexKcas") !== null).sort((a, b) => a.x - b.x);
  const zero = crossing(flown, "offsetPopupTimeSec", 0, "up");
  const base = { apexArea, autoDeg: finite(autoDeg) ? autoDeg : null, arcLimitDeg: w.arcLimitDeg, highBy: w.highBy, possibleFromDeg: zero ? zero.x : null };
  // Empty: no angle reaches 2 s, none keeps 300 KCAS, or the 2 s angle is past the upper end.
  const why = w.lowDeg === null ? "short" : w.highDeg === null ? "slow" : w.lowDeg > w.highDeg ? "short" : null;
  if (why) return { ...base, fromDeg: null, toDeg: null, ends: null, empty: why };
  const fromDeg = w.lowDeg;
  const toDeg = w.highDeg;
  const at = (x) => ({
    angleDeg: x,
    minPopupNm: valueAt(points, "popToRollInNm", x),
    approachPopNm: valueAt(points, "offsetPopupRangeNm", x),
    approachPopSec: valueAt(points, "offsetPopupTimeSec", x),
    apexKcas: valueAt(points, "apexKcas", x),
    exposureSec: valueAt(points, "exposureTimeSec", x),
  });
  return { ...base, fromDeg, toDeg, ends: { from: at(fromDeg), to: at(toDeg) }, empty: null };
}

// The flown pop-up as one side view (#1's Flight entry): x = ground distance along the path from the Pop Point (NM),
// y = altitude (ft MSL). The climb (Pop → Roll-in Start), the Roll-in, the tracking to Release; the bomb's fall
// after it separately. Marks: Pop, Roll-in Start, Apex (highest point), Release.
export function popupProfileLine(entry) {
  const climb = entry?.popup?.climb?.samples;
  const paths = entry?.result?.profile?.visualization?.semanticState?.paths;
  if (!Array.isArray(climb) || !climb.length) return null;
  const line = climb.map((s) => ({ distNm: s.groundNm, altFt: s.altitudeMslFt }));
  let dist = line[line.length - 1].distNm;
  const follow = (path) => {
    const out = [];
    let prev = null;
    for (const p of path ?? []) {
      if (prev) dist += Math.hypot(p.forwardNm - prev.forwardNm, p.turnSideNm - prev.turnSideNm);
      out.push({ distNm: dist, altFt: p.altitudeMslFt });
      prev = p;
    }
    return out;
  };
  const rollInStart = { ...line[line.length - 1] };
  line.push(...follow(paths?.rollIn).slice(1));
  const tracking = follow(paths?.tracking);
  line.push(...tracking.slice(1));
  const release = line[line.length - 1];
  const bomb = follow(paths?.bomb);
  const apex = line.reduce((a, b) => (b.altFt > a.altFt ? b : a), line[0]);
  return { line, bomb, marks: { pop: line[0], rollInStart, apex, release } };
}
