// Offset Design tab, #2 step (owner 2026-11-23: "2번기는 먼저 포메이션부터 … 시간차를 입력으로 받는다. 리더 폭탄의 임팩트 시간
// 기준 릴리즈 시간 … -는 임펙트 전 몇초 … 시간을 맞추기 위해 angle off와 roll in position을 조절한다"). S1: the follower's
// release time relative to its predecessor's bomb impact is a target, and one of the follower's own inputs is found
// for it by calling the existing Offset Flight a few times. No new formula; the Flight's own timing (flightTiming,
// every aircraft crossing its own IP together) is the measure.
//   release time  = n's IP → Release − (n−1)'s IP → Impact  (the owner's sign: −3 = 3 s before the impact).
//                   = −flightTiming[n].predecessorImpactToOwnReleaseSec.
//   knob "angleOff"  the follower's Angle Off (LOCKed), the other holds as the page has them (Angle #n keeps the
//                    Offset Angle, the Action Range moves). Not one way: a grid scan, then bisection to 0.1°.
//   Roll-in position (owner 2026-11-24, d: "오프셋 조건들을 바꿔서 roll in 포인트를 조절"): one Offset condition moves,
//   the follower's Angle Off LOCKed at its current value, Angle #n / Time #n released:
//   knob "offsetAngle"  the Offset Angle (LOCKed); the Action Range is solved.
//   knob "actionRange"  the Action Range (LOCKed); the Offset Angle is solved.
//   knob "approach"     the Approach Range (LOCKed) (0.1.0; kept, not offered on the page).
//   When #2 has no answer (owner 2026-11-23: "해가 없을 경우 #1 offset 조건 미세 튜닝. angle off, dive angle, 안되면 #2고도
//   변경 이때 타겟으로 가는 속도는 등속도이며 요구되는 피치를 말해준다"; e: the altitude is the Roll-in Altitude):
//   knob "leadAngleOff"   #1's Angle Off (LOCKed, #1's Offset Angle / Action / Approach solved), the whole Flight flown.
//   knob "leadDive"       #1's Dive Angle (LOCKed).
//   knob "rollInAltitude" #2's Roll-in Altitude (LOCKed, height mode); requiredPitchDeg tells the constant-speed climb /
//                         descent from the Approach start to 3 s before the Roll-in (followerPitch).
// The answer is the input value to type; the page then flies it as any other edit. Pure calculation: no DOM, no storage.
import { calculateOffsetFlightUnfittedFull } from "./offset-flight-v0.1.mjs?v=0.1.22";

export const OFFSET_FOLLOWER_TIME_V0_1 = Object.freeze({
  id: "offset-follower-time-v0.1",
  version: "0.1.3",
  pitchLeadSec: 3,
  toleranceSec: 0.1,
  maxRuns: 40,
  step: Object.freeze({ angleOffDeg: 0.1, approachRangeNm: 0.01, offsetAngleDeg: 0.1, actionRangeNm: 0.01, diveAngleDeg: 0.1, rollInAltitudeMslFt: 10 }),
  angleOffScanDeg: Object.freeze(Array.from({ length: 17 }, (_, i) => 10 + i * 10)),
  approachLimitsNm: Object.freeze([0, 15]),
  offsetAngleScanDeg: Object.freeze(Array.from({ length: 17 }, (_, i) => i * 5)),
  leadAngleOffScanDeg: Object.freeze(Array.from({ length: 15 }, (_, i) => 20 + i * 10)),
  leadDiveScanDeg: Object.freeze(Array.from({ length: 11 }, (_, i) => 10 + i * 5)),
  rollInAltitudeScanFt: Object.freeze(Array.from({ length: 15 }, (_, i) => 6000 + i * 2000)),
  actionRangeScanNm: Object.freeze(Array.from({ length: 16 }, (_, i) => 1 + i)),
});

const finite = (v) => Number.isFinite(v);
const clone = (v) => structuredClone(v);

// The follower's release time relative to its predecessor's impact (the owner's sign), or null.
export function releaseFromPredecessorImpactSec(output, number) {
  const t = output?.flightTiming?.[number];
  return t?.available && finite(t.predecessorImpactToOwnReleaseSec) ? -t.predecessorImpactToOwnReleaseSec : null;
}

// The baseline: the whole Flight as the page will send it next (the answer's nextInput).
export function followerTimeBaseline(answer, number = 2) {
  const input = answer?.output?.nextInput ?? answer?.input;
  if (!input?.aircraft?.[number]?.values) throw new Error(`No #${number} record`);
  if (Number(input.flightSize) < number) throw new Error(`The Flight has no #${number}`);
  return clone(input);
}

// The record for a trial value of the knob.
export const FOLLOWER_KNOB_KEYS = Object.freeze({ angleOff: "angleOffDeg", approach: "approachRangeNm", offsetAngle: "offsetAngleDeg", actionRange: "actionRangeNm", leadAngleOff: "angleOffDeg", leadDive: "diveAngleDeg", rollInAltitude: "rollInAltitudeMslFt" });
// The aircraft each knob moves (the follower's own, or #1).
export const knobAircraft = (knob, number) => (knob === "leadAngleOff" || knob === "leadDive" ? 1 : number);

// The constant-speed climb / descent (owner 2026-11-24: "어프로치 시작에서 롤인 3초 전까지"): from the Approach start
// (Offset Turn End) to 3 s before the Roll-in Start, flown at the Offset TAS. fromAltitudeMslFt = #n's altitude before
// the change (its Initial Altitude). + = climb. null when the Approach is not longer than the 3 s.
export function followerPitch(output, number, fromAltitudeMslFt) {
  const r = output?.aircraftResults?.[number]?.result;
  const t = r?.timing;
  const tas = r?.resolved?.offsetTasKt;
  const to = r?.profile?.public?.resolvedInitialAltitudeMslFt ?? r?.resolved?.rollInAltitudeMslFt;
  if (!t || !finite(tas) || !finite(to) || !finite(fromAltitudeMslFt)) return null;
  if (!finite(t.approachSec)) return null;
  const sec = t.approachSec - OFFSET_FOLLOWER_TIME_V0_1.pitchLeadSec;
  if (!(sec > 0)) return null;
  const groundNm = (tas * sec) / 3600;
  const deltaFt = to - fromAltitudeMslFt;
  return { deltaFt, groundNm, sec, requiredPitchDeg: (Math.atan2(deltaFt, groundNm * 6076.115) * 180) / Math.PI, verticalFpm: (deltaFt / sec) * 60 };
}

export function withFollowerKnob(input, number, knob, value, currentAngleOffDeg) {
  const next = clone(input);
  if (knob === "leadAngleOff" || knob === "leadDive") {
    const lead = next.aircraft[1];
    lead.locks = { ...(lead.locks ?? {}) };
    // Sent as the page sends a typed #1 value (an edit), so the followers that take #1's value (their own LOCK off)
    // move with it as they do on the page.
    const editKey = knob === "leadDive" ? "diveAngleDeg" : "angleOffDeg";
    next.edits = [{ aircraft: 1, kind: "set", key: editKey, commit: true, previousValue: lead.values[editKey] }];
    if (knob === "leadDive") {
      lead.values.diveAngleDeg = value;
      lead.locks.diveAngleDeg = true;
    } else {
      lead.values.angleOffDeg = value;
      Object.assign(lead.locks, { angleOffDeg: true, attackHeadingDeg: false, offsetAngleDeg: false, actionRangeNm: false, approachRangeNm: false });
    }
    return next;
  }
  const rec = next.aircraft[number];
  rec.options = { ...(rec.options ?? {}) };
  if (knob === "rollInAltitude") {
    rec.values.rollInAltitudeMslFt = value;
    if (rec.state?.rollInAltitudeLinked) rec.values.initialAltitudeMslFt = value;
    rec.options.rollInAltitudeLocked = true;
    rec.state = { ...(rec.state ?? {}), solveMode: "height" };
    return next;
  }
  if (knob === "offsetAngle" || knob === "actionRange") {
    const angle = knob === "offsetAngle";
    rec.values[angle ? "offsetAngleDeg" : "actionRangeNm"] = value;
    Object.assign(rec.options, { sameAngleAsLead: false, sameTimeAsLead: false, approachRangeLocked: false, offsetAngleLocked: angle, actionRangeLocked: !angle, attackHeadingLocked: false, angleOffLocked: true });
    if (finite(currentAngleOffDeg)) rec.values.angleOffDeg = currentAngleOffDeg;
    return next;
  }
  if (knob === "approach") {
    rec.values.approachRangeNm = value;
    rec.options.approachRangeLocked = true;
    rec.options.sameAngleAsLead = false;
    rec.options.sameTimeAsLead = false;
    rec.options.offsetAngleLocked = false;
    if (finite(currentAngleOffDeg)) rec.values.angleOffDeg = currentAngleOffDeg;
    rec.options.angleOffLocked = true;
    rec.options.attackHeadingLocked = false;
  } else {
    rec.values.angleOffDeg = value;
    rec.options.angleOffLocked = true;
    rec.options.attackHeadingLocked = false;
  }
  return next;
}

// request = { value (s, the owner's sign), knob: "angleOff" | "approach" }. Returns { status: "OK" | "CLOSEST" |
// "FAILED", key, value (to type), want, achieved, runs, message }.
export function solveFollowerReleaseTime(input, number, request, calculate = calculateOffsetFlightUnfittedFull) {
  const cfg = OFFSET_FOLLOWER_TIME_V0_1;
  const knob = FOLLOWER_KNOB_KEYS[request?.knob] ? request.knob : "angleOff";
  const key = FOLLOWER_KNOB_KEYS[knob];
  const want = Number(request?.value);
  if (!finite(want)) return { status: "FAILED", key, runs: 0, message: "목표 시간을 넣어 주세요" };
  let runs = 0;
  const fly = (rec) => { runs += 1; try { return calculate(rec); } catch { return null; } };
  const now = fly(input);
  const nowAr = now?.aircraftResults?.[number];
  const knobAr = now?.aircraftResults?.[knobAircraft(knob, number)];
  const currentAo = nowAr?.result?.resolved?.angleOffDeg ?? Number(input.aircraft[number].values.angleOffDeg);
  const knobRec = input.aircraft[knobAircraft(knob, number)];
  // #2's altitude at its IP before the change (the pitch is from there to the new Roll-in Altitude).
  const fromAltitude = nowAr?.result?.profile?.public?.resolvedInitialAltitudeMslFt ?? Number(input.aircraft[number].values.initialAltitudeMslFt);
  const start = knob === "angleOff" ? currentAo
    : knob === "rollInAltitude" ? (nowAr?.result?.profile?.public?.resolvedInitialAltitudeMslFt ?? Number(knobRec.values[key]))
    : (knobAr?.result?.resolved?.[key] ?? Number(knobRec.values[key]));
  const step = cfg.step[key];
  const snap = (v) => +(Math.round(v / step) * step).toFixed(6);
  const tried = new Map();
  const f = (v) => {
    const x = snap(v);
    if (tried.has(x)) return tried.get(x);
    const out = fly(withFollowerKnob(input, number, knob, x, currentAo));
    const ar = out?.aircraftResults?.[number];
    const t = releaseFromPredecessorImpactSec(out, number);
    const lead = knobAircraft(knob, number) === 1 ? out?.aircraftResults?.[1] : ar;
    const ok = ar && (ar.status === "VALID" || ar.status === "WARNING") && lead && lead.status !== "INVALID" && finite(t);
    const r = { x, y: ok ? t - want : null, achieved: ok ? t : null, status: ar?.status ?? "FAILED", output: ok ? out : null };
    tried.set(x, r);
    return r;
  };
  const best = () => [...tried.values()].filter((r) => r.y !== null).sort((a, b) => Math.abs(a.y) - Math.abs(b.y) || Math.abs(a.x - start) - Math.abs(b.x - start))[0] ?? null;
  const done = (status) => {
    const r = best();
    if (!r) return { status: "FAILED", key, runs, message: "이 범위에서 날 수 있는 값이 없습니다" };
    const ok = Math.abs(r.y) <= cfg.toleranceSec; // within tolerance is OK however the search ended
    const pitch = knob === "rollInAltitude" ? followerPitch(r.output, number, fromAltitude) : null;
    return { status: ok ? "OK" : "CLOSEST", knob, aircraft: knobAircraft(knob, number), key, value: r.x, want, achieved: r.achieved, runs, pitch, message: ok ? "" : `정확히 맞는 값이 없어 가장 가까운 값입니다 (차이 ${r.y.toFixed(2)} s)` };
  };
  if (finite(start)) {
    const a = f(start);
    if (a.y !== null && Math.abs(a.y) <= cfg.toleranceSec) return done("OK");
  }
  // Scan, then refine the bracket nearest the page's value.
  const grid = {
    approach: Array.from({ length: 16 }, (_, i) => cfg.approachLimitsNm[0] + i * ((cfg.approachLimitsNm[1] - cfg.approachLimitsNm[0]) / 15)),
    offsetAngle: cfg.offsetAngleScanDeg,
    actionRange: cfg.actionRangeScanNm,
    leadAngleOff: cfg.leadAngleOffScanDeg,
    leadDive: cfg.leadDiveScanDeg,
    rollInAltitude: cfg.rollInAltitudeScanFt,
  }[knob] ?? cfg.angleOffScanDeg;
  for (const x of grid) f(x);
  const pts = [...tried.values()].filter((r) => r.y !== null).sort((p, q) => p.x - q.x);
  const pairs = [];
  for (let i = 1; i < pts.length; i += 1) if (Math.sign(pts[i - 1].y) !== Math.sign(pts[i].y)) pairs.push([pts[i - 1], pts[i]]);
  if (!pairs.length) return done("CLOSEST");
  const mid = finite(start) ? start : (pts[0].x + pts.at(-1).x) / 2;
  pairs.sort((p, q) => Math.abs((p[0].x + p[1].x) / 2 - mid) - Math.abs((q[0].x + q[1].x) / 2 - mid));
  let [p, q] = pairs[0];
  while (runs < cfg.maxRuns && Math.abs(q.x - p.x) > step * 1.5) {
    // Regula falsi kept inside the bracket; bisection when it does not move.
    let x = p.x - (p.y * (q.x - p.x)) / (q.y - p.y);
    if (!(x > Math.min(p.x, q.x) + step / 2 && x < Math.max(p.x, q.x) - step / 2)) x = (p.x + q.x) / 2;
    const m = f(x);
    if (m.y === null) { const b = f((p.x + q.x) / 2); if (b.y === null) break; if (Math.sign(b.y) === Math.sign(p.y)) p = b; else q = b; continue; }
    if (Math.abs(m.y) <= cfg.toleranceSec) break;
    if (Math.sign(m.y) === Math.sign(p.y)) p = m; else q = m;
  }
  return done("OK");
}
