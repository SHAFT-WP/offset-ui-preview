import { casToTas, machToTas, tasToCas } from "../../../common/airspeed/airspeed-v0.1.mjs";
import { truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";
import { OFFSET_FLIGHT_PROFILE_LINK, OFFSET_FLIGHT_V0_1, calculateOffsetFlightUnfittedFull as calculateOffsetFlightFull, createOffsetFlightSession, profileLinkStates } from "../offset-bombing/offset-flight-v0.1.mjs?v=0.1.22";
import { calculateWithIaaEdit } from "../offset-bombing/offset-iaa-edit-v0.1.mjs";
import { calculateWithClearFit, clearFitFieldLocked, clearFitRange } from "../offset-bombing/offset-clear-fit-v0.1.mjs";
import { POPUP_BE_V0_2, assemblePopupAttack, calculatePopupMinimumExposureFull, defaultPopupAngleDeg, normalizePopupInput, resolvePopupAngle } from "./popup-be-v0.2.mjs?v=0.2.6";
import { calculatePopupClimbFull } from "./popup-climb-v0.2.mjs";
import { computeDropOrderDeltaFull } from "../offset-bombing/offset-formation-v0.1.mjs";
import { dropOrderTiming } from "../../../flight/flight-bombing-tactics/flight-composition-v0.1.mjs";
import { leadImpactToWingmanReleaseSec } from "../../../flight/flight-bombing-tactics/formation-v0.1.mjs";

// POP-UP Flight v0.1 (owner 2026-10-27, POP-UP SPEC §13.1, step 3b): the Offset Flight (as is) with each aircraft's
// Roll-in flown from its Popup angle at MIL (BDP v0.4.5 POP-UP option), and the POP-UP climb in front of it.
//   Pop Point: on the Approach leg (Offset Turn End → Roll-in Start, the Offset heading), the Popup ground distance
//   before Roll-in Start; Offset-Popup Range (was Hold-Down, 0.1.18) = Approach Range − ground distance, which must be ≥ 0 (an error, never clipped).
//   The Pop Point state is the Offset leg's: Offset Altitude and Offset Speed (§13.5); 0.1.12: the Pop-up Speed when typed.
// Per aircraft (values / state of the Offset record; blank follows #1, then the defaults):
//   state.popupDriver "DEFAULT" (automatic rule) | "ANGLE" | "GROUND_DISTANCE" | "EXPOSURE_TIME" (the last typed);
//   state.popupLocks { rollInSpeed, angle }: a LOCKed angle holds the ANGLE driver; a LOCKed Roll-in Speed solves the Pop-up Speed;
//   values.popupAngleDeg / popupGroundDistanceNm / popupExposureTimeSec (the driver's value); values.popupG (4 G; 3 G before 0.1.16).
// The angle for a distance or a time is solved on the aircraft's BDP input from an Offset Flight at the previous
// angle, repeated until the angle settles (the Offset solve moves the Roll-in a little with the angle).
export const POPUP_FLIGHT_V0_1 = Object.freeze({
  id: "popup-flight-v0.1",
  // 0.1.2 (owner 2026-11-01): the POP-UP clock — each result's timing has its Approach as the Hold-Down (level, Offset
  // speed) then the climb, IP → Release and the drop-order timing follow it, and geometry.points.popPoint is set; the
  // Pop Point's range and angle-off to the Target and its time after IP; the follower driver "LEAD_POP_TIME" (pop at
  // #1's Pop time, the angle solved for it).
  // 0.1.3 (owner 2026-11-02): flightName (Offset Flight 0.1.11's formation name, attack type) with #1 Impact − #2
  // Release on the POP-UP clock. Metadata only.
  // 0.1.4 (owner 2026-11-02): Offset Flight 0.1.12 — #3's linked Longitudinal / Lateral Range edits, the Flight's Form
  // template edit and flightName.formation.places reach the POP-UP page through it. No POP-UP rule changes.
  // 0.1.5 (owner 2026-11-02, "Pop-up ded는 pop-up 포인트가 추가되고, oa2는 oa1과 같으나 타겟 고도이다"): each aircraft's
  // DED adds OA2 = its Pop Point, read like OA1 (RNG / TBRG from the same reference: the Target, or the Flight's VIP in
  // VIP mode) with ELEV = its Target Elevation.
  // 0.1.6 (owner 2026-11-03, confirming the reading offered): OA2 is OA1's point (the Roll-in Start, same RNG / TBRG)
  // with ELEV = the Target Elevation; the Pop Point is its own DED page `popUp` (TBRG / RNG from the same reference,
  // ELEV = Target Elevation), no longer OA2.
  // 0.1.7 (owner 2026-11-03, SPEC §13.8i): the Roll-in Speed is AUTO — each aircraft's BDP starts its Roll-in at
  // its MIL arrival speed at Roll-in Start (iterated with the Roll-in Altitude) — unless LOCKed; three POP-UP LOCKs
  // per aircraft (state.popupLocks { rollInSpeed, angle, distance }): a LOCKed Roll-in Speed solves the Popup angle
  // for it ("ROLL_IN_SPEED"); a LOCKed angle or distance holds that driver; two LOCKs together are a conflict.
  // Typing a Roll-in Speed (initialSpeedValue) LOCKs it. "Pop with #1" (LEAD_POP_TIME) is removed (owner): a stored
  // one reads as DEFAULT.
  // 0.1.8 (owner 2026-11-03, SPEC §13.8j): Offset Flight 0.1.14's profile LINK — a linked #3 / #4 flies #1's / #2's POP-UP
  // too (its settings, angle and Roll-in Speed are its source's). A POP-UP edit of a linked aircraft (a value, a LOCK, AUTO,
  // Apply) turns its LINK off, as any other edit of it does.
  status: "work",
  offsetFlight: `${OFFSET_FLIGHT_V0_1.id} ${OFFSET_FLIGHT_V0_1.version}`,
  popupBe: `${POPUP_BE_V0_2.id} ${POPUP_BE_V0_2.version}`,
  // 0.1.9 (owner 2026-11-10, POP-UP SPEC §13.8o): when the climb does not fit, the planner fits it instead of INVALID —
  // a Hold-Down < 0 raises the entered Roll-in Altitude (not LOCKed, height mode) to the lowest one that fits; an
  // AUTO Popup angle whose pull-up arc passes the Roll-in Altitude is lowered to the steepest one that fits. Each is a
  // warning naming the change; the raised Roll-in Altitude is written back. A typed / LOCKed angle or a LOCKed Roll-in
  // Altitude stays INVALID with the value that would fit.
  // 0.1.10 (owner 2026-11-10, SPEC §13.8p): an emptied field is filled by the planner (popupFlightWithClearFit).
  // 0.1.11 (owner 2026-11-10): the fit search moved to offset-clear-fit-v0.1, shared with the Offset Flight 0.1.16.
  // 0.1.13 (owner 2026-11-15, SPEC §13.8s): a LOCKed (typed) Roll-in Speed back-solves the Pop-up Speed at the flown
  // angle (no longer the angle); the solved Pop-up Speed is the aircraft's own. A typed Pop-up Speed releases it.
  // 0.1.12 (owner 2026-11-10, SPEC §13.8s): Pop-up Speed (values.popupSpeedKcas, state.popupSpeedOwn) — the Pop Point
  // speed follows the Initial Speed until typed, then is the aircraft's own; emptied, it follows again. No Pop to
  // Roll-in Distance LOCK any more (typing it still drives).
  // 0.1.14 (owner 2026-11-16, SPEC §13.8u): when the climb is longer than the Approach (Hold-Down < 0) the AUTO Popup
  // angle is RAISED to the lowest one that fits (a steeper climb is shorter), up to 55° or the steepest angle whose
  // pull-up arc stays below the Roll-in Altitude. The Roll-in Altitude is no longer raised (0.1.9's raise gave
  // Tracking Times of 30 s and more): it is the entered one, or the one solved from the Tracking Time.
  // 0.1.15 (owner 2026-11-16, POP-UP code review; SPEC §13.8v): the AUTO raise keeps a Hold-Down of minHoldDownSec (2 s)
  // and a shorter Hold-Down is a SHORT HOLD-DOWN warning; a follower flies its own POP-UP inputs (the "#1's when blank"
  // path is removed — #3 / #4 follow #1 / #2 through the profile LINK only); the Distance LOCK, LOCK conflict and
  // "ROLL_IN_SPEED" / "LEAD_POP_TIME" driver remnants are removed (a stored one reads as AUTO); the minimum-exposure
  // request cannot fail the Flight answer and flies each trial angle as the Apply would (B2); each climb of a call is flown once (memo).
  // 0.1.16 (owner 2026-11-17, "전반적으로 매우 느려졌어. 특히 락버튼"; SPEC §13.8w): the AUTO Roll-in Speed returned is the
  // one the result was flown with. Before, the last round's MIL arrival (within speedSettleKt of it, never flown) was
  // returned, so a returned state sent back gave another speed in the last digits every time and nothing was reused:
  // every request and every idle preparation solved the whole Flight again. Now a returned state is its own answer.
  // 0.1.17 (owner 2026-11-17, "기본값은 4G"; SPEC §13.8x): the default Popup G is 4 G (was 3 G), for a blank field and the
  // emptied-field fill. POP-UP BE 0.2.5 / climb default the same.
  // 0.1.18 (owner 2026-11-18, "더 직관적으로"; SPEC §13.8y): Hold-Down is called Offset-Popup Range (NM) / Offset-Popup
  // Time (s) in the messages: "Offset-Popup Range … NM: …" (error), "SHORT OFFSET-POPUP TIME" (warning). The result keys
  // (holdDownNm, holdDownSec, timing.popupHoldDownSec, minHoldDownSec) keep their names.
  // 0.1.19 (owner 2026-11-18; SPEC §13.8aa): the AUTO Popup angle keeps the slowest speed Pop → Apex at or above the
  // LOW SPEED line (300 KCAS) when an angle with an Offset-Popup Range ≥ 0 does ("최대한 수정하고 안되면 경고"): the
  // raise's angle, or the rule's, is held at the steepest such angle (popup.autoAngleApexGuard); none: LOW SPEED as
  // before. The emptied-field fill of Offset G is 3 G (was 2 G; owner "Offset 기본값 3G").
  // 0.1.20 (owner 2026-11-19, "popup에서는 다이브할 때 military power를 쓸 것이다 … 지정된 속도에 도달하면 그 속도를
  // 유지한다 … 지정하지 않았다면 계산된 속도를 보여준다"): every aircraft dives at MIL (BDP v0.4.10 diveSpeedModel); the
  // Release Speed is a cap (blank: none; no longer filled when emptied) and popup.releaseSpeedKcas the speed flown. The
  // SEM after Release (Level or CSEM) is flown at MIL too (semSpeedModel; owner "release이후에는 mil power로 …").
  // 0.1.21 (owner 2026-11-20, "initial 고도와 옵셋 고도는 같아야 해" / "둘이 링크되게 하고 오프셋 고도를 유저가 바꾸면
  // 바뀐값이 들어가게 하자"; DESIGN-STEPS.md, SPEC §13.8ae): the Initial Altitude is the Offset (Pop) Altitude, both
  // ways. An Initial Altitude edit (any aircraft) is an edit of #1's Offset Altitude (the Flight's Offset leg is #1's);
  // every aircraft's Initial Altitude goes back as the Offset Altitude flown. A record whose two differ (an older file)
  // takes the Offset Altitude. The Roll-in Altitude LINK is off on this page (rollInAltitudeLinked false).
  // 0.1.22 (owner 2026-11-22, "popup/oa2가 타겟고도와 같이 셋팅되어 있는데 initial 고도로 설정, vip/vrp 동일"): the DED
  // POP-UP page (VRPPUP / VIPPUP) and OA2 ELEV are the aircraft's Initial Altitude (= its VRP / VIP page ELEV), no
  // longer the Target Elevation. RNG / TBRG unchanged. Offset Flight 0.1.20's IAA edit (offset-iaa-edit-v0.1) on this
  // page too: calculatePopupFlightFull and the page session turn a typed IAA into the Release Altitude that flies it.
  // 0.1.24 (review 2026-11-23, "충돌나거나 해가 안나오는 경우 … 로직 업그레이드 … 최적화"; SPEC §13.8ag): (1) the AUTO angle lowered
  // for the pull-up arc no longer flips between the rule's angle and the lowered one when the Roll-in Altitude is
  // solved from the Tracking Time (it moves with the angle): bisection between the steepest angle that fitted and the
  // shallowest that did not (Pop at 3,000 ft: INVALID → 28.4°); (2) the Apex guard treats a trial whose Offset solve
  // failed as a gap, not as an Offset-Popup Range < 0, and searches below it (Dive 40°: 50° LOW SPEED 245 KCAS →
  // 31° at 301 KCAS); (3) speed: the AUTO Roll-in Speed fixed point takes a secant step, the angle searches' trials
  // start from the nearest settled speed, and the raise's answer reuses its trial (about a third fewer whole Flight
  // solves; values move within speedSettleKt). POP-UP BE 0.2.6.
  // 0.1.25 (owner 2026-11-24, Offset BE 0.2.21): an Offset answer that is INVALID only for its Tracking Time (below 0 s,
  // result.trackingIssue) still flies its climb, so the POP-UP checks (Offset-Popup Range, …) are said beside the
  // Tracking Time fix instead of after it.
  version: "0.1.25",
  defaultPopupG: 4,
  angleIterations: 12,
  autoAngleMinDeg: 1,
  autoAngleToleranceDeg: 0.05,
  autoAngleMaxDeg: 55,
  autoAngleRaiseStepDeg: 5,
  autoAngleRaiseGridDeg: 0.5,
  autoAngleRaiseTargetNm: 0.01,
  autoAngleRaiseTrials: 8,
  // 0.1.15 (owner 2026-11-16, "hold down time이 0인 것은 피할 수 있으면 피하는게 좋다"): the AUTO raise aims at this
  // Hold-Down time (wings level after the Offset Turn) instead of 0; shorter than it is a warning.
  minHoldDownSec: 2,
  // 0.1.19: the Apex guard's search (secant on the slowest speed, 0.5° grid; whole Flight solves).
  apexGuardTrials: 4,
  speedSettleKt: 0.05,
  angleSettleDeg: 0.01,
});

const DEG = Math.PI / 180;
const FT_PER_NM = 6076.11549;
const norm360 = (deg) => ((deg % 360) + 360) % 360;

// The Pop-up Point page (0.1.6; OA2 in 0.1.5): true bearing and range from OA1's reference (the Target; the Flight's VIP
// when #1 is in VIP mode), as the Offset Flight reads OA1, with ELEV = the aircraft's Initial Altitude (0.1.22).
function popPointDedPage(base, popPoint, elevationFt) {
  const rangeNm = Math.hypot(popPoint.x - base.x, popPoint.y - base.y);
  return { point: "POP", bearingDeg: norm360(Math.atan2(popPoint.x - base.x, popPoint.y - base.y) / DEG), rangeNm, rangeFt: rangeNm * FT_PER_NM, elevationFt };
}
// The DED ELEV of the POP-UP page and OA2 (0.1.22): the aircraft's Initial Altitude, as its VRP / VIP page shows it.
function dedInitialAltitudeFt(ded) {
  const elevationFt = ded?.reference?.elevationFt;
  return Number.isFinite(elevationFt) ? elevationFt : null;
}
const blank = (value) => value === null || value === undefined || value === "";

// The page's POP-UP edits (FE edit events, as Offset's, for any aircraft): a typed angle / distance / time becomes
// that aircraft's driver; { key: "popupDriver", value: "DEFAULT" } goes back to the automatic rule. A field emptied
// and committed ({ kind: "clear" }) keeps the driver and takes back its value from the start of the edit (else the
// edit's fallback), which is written back to the field. They are the POP-UP's, so they are not passed to the
// Offset Flight.
const POPUP_DRIVER_OF_KEY = Object.freeze({ popupAngleDeg: "ANGLE", popupGroundDistanceNm: "GROUND_DISTANCE", popupExposureTimeSec: "EXPOSURE_TIME" });
const isPopupEdit = (edit) => typeof edit?.key === "string" && edit.key.startsWith("popup");
const editsOf = (input) => [...(input.edit ? [input.edit] : []), ...(input.edits ?? [])];
function editedDrivers(input) {
  const drivers = {};
  for (const edit of editsOf(input)) {
    if (!isPopupEdit(edit) || edit.kind === "clear") continue;
    const number = String(edit.aircraft ?? 1);
    if (edit.key === "popupDriver") drivers[number] = edit.value ?? "DEFAULT";
    else if (POPUP_DRIVER_OF_KEY[edit.key]) drivers[number] = POPUP_DRIVER_OF_KEY[edit.key];
  }
  return drivers;
}
// The POP-UP LOCK edits (0.1.7): { key: "popupLockRollInSpeed" | "popupLockAngle", value }.
// A typed Roll-in Speed (initialSpeedValue, not a clear) LOCKs it. The minimum-exposure Apply (popupAngleDeg with
// source "minimumExposure") releases the Roll-in Speed LOCK.
const POPUP_LOCK_OF_KEY = Object.freeze({ popupLockRollInSpeed: "rollInSpeed", popupLockAngle: "angle" });
function editedLocks(input) {
  const locks = {};
  for (const edit of editsOf(input)) {
    const number = String(edit?.aircraft ?? 1);
    if (POPUP_LOCK_OF_KEY[edit?.key]) (locks[number] ||= {})[POPUP_LOCK_OF_KEY[edit.key]] = edit.value === true;
    else if (edit?.key === "initialSpeedValue" && edit.kind !== "clear" && edit.kind !== "lock") (locks[number] ||= {}).rollInSpeed = true;
    else if (edit?.key === "popupAngleDeg" && edit.source === "minimumExposure") (locks[number] ||= {}).rollInSpeed = false;
    // 0.1.13: a typed or emptied Pop-up Speed drives again (the Roll-in Speed back to AUTO).
    else if (edit?.key === "popupSpeedKcas" || edit?.key === "popupSpeedFollow") (locks[number] ||= {}).rollInSpeed = false;
  }
  return locks;
}

// Pop-up Speed (0.1.12, owner 2026-11-10): a typed popupSpeedKcas makes it the aircraft's own; an emptied one (clear)
// or { key: "popupSpeedFollow", value: true } follows the Initial Speed again.
function editedSpeedOwn(input) {
  const own = {};
  for (const edit of editsOf(input)) {
    const number = String(edit?.aircraft ?? 1);
    if (edit?.key === "popupSpeedKcas") own[number] = edit.kind !== "clear";
    else if (edit?.key === "popupSpeedFollow") own[number] = edit.value !== true;
  }
  return own;
}

function clearedValues(input) {
  const cleared = {};
  for (const edit of editsOf(input)) {
    if (!isPopupEdit(edit) || edit.kind !== "clear") continue;
    const value = [edit.before?.value, edit.fallbackValue].find((v) => typeof v === "number" && Number.isFinite(v));
    if (value === undefined) continue;
    (cleared[String(edit.aircraft ?? 1)] ||= {})[edit.key] = value;
  }
  return cleared;
}

// The Pop-up Speed (0.1.12): the aircraft's own when it typed one; else null (the Initial Speed).
function popupSpeedOf(own, number, speedOwn, cleared) {
  const on = speedOwn[number] ?? own.state?.popupSpeedOwn === true;
  const value = cleared[number]?.popupSpeedKcas ?? own.values?.popupSpeedKcas;
  return on && !blank(value) && Number(value) > 0 ? Number(value) : null;
}

// The Pop-up Speed (KCAS) whose climb arrives at Roll-in Start at `targetKcas` (0.1.13): bisection on the MIL climb's
// arrival, which rises with the Pop-up Speed. Out of range: an error naming the reachable Roll-in Speeds.
export const POPUP_SPEED_SEARCH_KCAS = Object.freeze([200, 650]);
function solvePopSpeed(arrivalOf, targetKcas) {
  const [lo0, hi0] = POPUP_SPEED_SEARCH_KCAS;
  const safe = (v) => { try { const a = arrivalOf(v); return Number.isFinite(a) ? a : null; } catch { return null; } };
  let lo = lo0;
  let flo = safe(lo);
  while (flo === null && lo < hi0) { lo += 25; flo = safe(lo); }
  const fhi = safe(hi0);
  if (flo === null || fhi === null) return { error: `Roll-in Speed ${Math.round(targetKcas)} KCAS: no Pop-up Speed in ${lo0}–${hi0} KCAS climbs to the Roll-in Altitude` };
  if (targetKcas < flo - 0.05 || targetKcas > fhi + 0.05) {
    return { error: `Roll-in Speed ${Math.round(targetKcas)} KCAS cannot be reached at this Popup angle: Pop-up Speed ${lo}–${hi0} KCAS gives Roll-in ${Math.round(flo)}–${Math.round(fhi)} KCAS` };
  }
  let a = lo;
  let b = hi0;
  for (let i = 0; i < 40 && b - a > 0.01; i += 1) {
    const m = (a + b) / 2;
    const fm = safe(m);
    if (fm === null || fm < targetKcas) a = m; else b = m;
  }
  return { kcas: (a + b) / 2 };
}

// Per aircraft: its own POP-UP inputs (0.1.15: a follower no longer flies #1's when its own are blank — the page always
// sends each aircraft's own, and #3 / #4 follow #1 / #2 through the profile LINK only). A blank Popup G or Roll-in Speed
// shows #1's (as the BDP extras do), then the default.
const POPUP_DRIVERS = Object.freeze(["DEFAULT", "ANGLE", "GROUND_DISTANCE", "EXPOSURE_TIME"]);
function popupSettings(input, number, edited, cleared, lockEdits, speedOwn = {}) {
  const own = input.aircraft[number] ?? {};
  const lead = input.aircraft[1] ?? {};
  const valueOf = (record, n, key) => cleared[n]?.[key] ?? record.values?.[key];
  const ownValue = (key) => valueOf(own, number, key);
  const pick = (key) => (blank(ownValue(key)) ? valueOf(lead, "1", key) : ownValue(key));
  // A stored driver this version does not know (an older file's "Pop with #1" or Roll-in Speed driver) is the automatic rule.
  const askedRaw = edited[number] ?? own.state?.popupDriver ?? "DEFAULT";
  const asked = POPUP_DRIVERS.includes(askedRaw) ? askedRaw : "DEFAULT";
  const stored = own.state?.popupLocks ?? {};
  const locks = { rollInSpeed: stored.rollInSpeed === true, angle: stored.angle === true, ...(lockEdits[number] ?? {}) };
  // A LOCKed Popup Angle holds that driver. A LOCKed Roll-in Speed solves the Pop-up Speed (0.1.13), so it goes with
  // any angle driver.
  const driver = locks.angle ? "ANGLE" : asked;
  const overridden = locks.angle && edited[number] && edited[number] !== "DEFAULT" && edited[number] !== "ANGLE"
    ? "Popup Angle is LOCKed: the typed value is solved again (release the LOCK to drive it)" : null;
  return {
    driver,
    locks,
    overridden,
    rollInSpeedKcas: Number(pick("initialSpeedValue")),
    // Pop-up Speed (0.1.12): the aircraft's own once typed (state.popupSpeedOwn), else null = the Initial Speed.
    popupSpeedKcas: popupSpeedOf(own, number, speedOwn, cleared),
    popupG: blank(pick("popupG")) ? POPUP_FLIGHT_V0_1.defaultPopupG : Number(pick("popupG")),
    popupAngleDeg: ownValue("popupAngleDeg"),
    groundDistanceNm: ownValue("popupGroundDistanceNm"),
    exposureTimeSec: ownValue("popupExposureTimeSec"),
  };
}

// The Offset input with every aircraft's Roll-in from its angle at MIL (the POP-UP edits and request left out).
function withAngles(input, angles, speeds = {}) {
  const aircraft = {};
  for (const [key, record] of Object.entries(input.aircraft)) {
    const angle = angles[key];
    const speed = speeds[key];
    aircraft[key] = angle === undefined
      ? record
      : { ...record, values: { ...record.values, rollInStartFpaDeg: angle, rollInSpeedModel: "MIL", ...(Number.isFinite(speed) ? { initialSpeedValue: speed, initialSpeedMode: "CAS" } : {}) } };
  }
  const { popupRequest, edit, ...rest } = input;
  const edits = (input.edits ?? []).filter((e) => !isPopupEdit(e));
  return { ...rest, aircraft, ...(input.edits ? { edits } : {}), ...(edit && !isPopupEdit(edit) ? { edit } : {}) };
}

// 0.1.20: the Release speed of the MIL dive (BDP v0.4.10) for the page: the speed flown, the cap entered (null: none)
// and whether the dive reached it.
function releaseSpeedOf(offset) {
  const pub = offset?.result?.profile?.public;
  if (!pub?.diveTrack) return {};
  return { releaseSpeedKcas: pub.releaseSpeedKcas, releaseSpeedCapKcas: pub.diveTrack.capKcas, releaseSpeedCapReached: pub.diveTrack.capReached };
}

// The BDP input of the Roll-in onward without the POP-UP option (the POP-UP BE adds it per trial angle).
function bdpInputOf(profile) {
  const { rollInStartFpaDeg, rollInSpeedModel, ...rest } = profile.canonicalInputs;
  return rest;
}

// The Pop Point state: Offset Altitude, and the Pop-up Speed (0.1.12) when the aircraft has its own, else the Offset
// (Initial) Speed.
function popState(resolved, popupSpeedKcas = null) {
  const altitudeMslFt = resolved.offsetAltitudeMslFt;
  if (Number.isFinite(popupSpeedKcas) && popupSpeedKcas > 0) return { popAltitudeMslFt: altitudeMslFt, popSpeedKcas: popupSpeedKcas };
  const tasKt = resolved.offsetSpeedMode === "MACH" ? machToTas(resolved.offsetSpeedValue, altitudeMslFt) : casToTas(resolved.offsetSpeedValue, altitudeMslFt);
  return { popAltitudeMslFt: altitudeMslFt, popSpeedKcas: tasToCas(tasKt, altitudeMslFt) };
}

const approachSpeedNmSec = (r) => r.resolved.offsetTasKt / 3600;

function flownAircraft(output) {
  return Object.entries(output.aircraftResults).filter(([, r]) => r.result?.profile?.canonicalInputs && (r.status === "VALID" || r.status === "WARNING"));
}

// One Flight calculation flies the same climb several times (the AUTO Roll-in Speed, the Hold-Down check, the final
// result): 0.1.15 keeps each climb of the call by its exact input (a failure too) and reuses it. Results are shared,
// never changed.
function createClimbMemo() {
  const memo = new Map();
  return (input) => {
    const key = JSON.stringify([input.popAltitudeMslFt, input.popSpeedKcas, input.rollInAltitudeMslFt, input.popupAngleDeg, input.popupG, input.gOnsetRateGSec]);
    let entry = memo.get(key);
    if (!entry) {
      try { entry = { value: calculatePopupClimbFull(input) }; } catch (error) { entry = { error }; }
      memo.set(key, entry);
    }
    if (entry.error) throw entry.error;
    return entry.value;
  };
}

// The pull-up arc (0.1.9): whether an angle can be flown to the Roll-in Altitude, and the steepest one that can
// (bisection below the given angle; null when even a shallow one cannot).
function climbFits(climbFull, climbInput, angleDeg) {
  try { climbFull({ ...climbInput, popupAngleDeg: angleDeg }); return true; } catch { return false; }
}
function steepestFittingAngle(climbFull, climbInput, upperDeg) {
  let lo = POPUP_FLIGHT_V0_1.autoAngleMinDeg;
  if (!(upperDeg > lo) || !climbFits(climbFull, climbInput, lo)) return null;
  let hi = upperDeg;
  while (hi - lo > POPUP_FLIGHT_V0_1.autoAngleToleranceDeg) {
    const mid = (lo + hi) / 2;
    if (climbFits(climbFull, climbInput, mid)) lo = mid; else hi = mid;
  }
  return lo;
}

// Hold-Down of aircraft n in a solve (0.1.9): Approach Range − the climb's ground distance; `short` when negative or
// when the Offset already has its Turn End past the Roll-in Start; `failed` for any other error (no value).
function holdDownState(climbFull, sol, n, settings) {
  const entry = sol.output.aircraftResults[n];
  const r = entry?.result;
  if (!r?.profile?.canonicalInputs || !(entry.status === "VALID" || entry.status === "WARNING")) {
    const turnPassed = (entry?.errors ?? []).some((e) => /Offset Turn End has passed Roll-in Start/.test(e));
    return { short: turnPassed, holdDownNm: null, failed: !turnPassed };
  }
  try {
    const climb = climbFull({ ...popState(r.resolved, settings.popupSpeedKcas), rollInAltitudeMslFt: r.profile.public.resolvedInitialAltitudeMslFt, popupAngleDeg: sol.angles[n], popupG: settings.popupG, gOnsetRateGSec: r.profile.canonicalInputs.gOnsetRateGSec });
    const holdDownNm = r.resolved.approachRangeNm - climb.groundDistanceNm;
    // 0.1.19: the slowest speed Pop → Apex (the climb and the Apex), as the POP-UP BE's LOW SPEED check measures it.
    const apex = r.profile.public?.rollInPopUp?.apex;
    const speeds = [...climb.samples.map((x) => x.casKt), ...(apex ? [tasToCas(apex.tasKt, apex.altitudeMslFt)] : [])].filter(Number.isFinite);
    const slowKcas = speeds.length ? Math.min(...speeds) : null;
    return { short: holdDownNm < 0, holdDownNm, failed: false, needNm: POPUP_FLIGHT_V0_1.minHoldDownSec * approachSpeedNmSec(r), slowKcas };
  } catch {
    return { short: false, holdDownNm: null, failed: true };
  }
}

// The next AUTO Popup angle to try for a Hold-Down ≥ 0 (0.1.14). `tried` = [{ deg (asked), flown, hd, failed }] from
// the rule's angle up. While none fits: +5° first, then the secant of the last two Hold-Downs (it is nearly linear in
// the angle), at most +10° a step; once one fits, bisection down to the 0.5° grid. null = nothing left to try: 55°
// reached, the pull-up arc already limits the angle below the one asked, the Hold-Down does not grow with the angle,
// or its trend needs more than 55° (each try is a whole Flight solve, so a hopeless search stops early).
function nextAutoAngle(tried) {
  const cfg = POPUP_FLIGHT_V0_1;
  const fits = (x) => Number.isFinite(x.hd) && x.hd >= 0;
  const fitting = tried.filter(fits);
  const shortOnes = tried.filter((x) => !fits(x));
  const hi = fitting.reduce((m, x) => (!m || x.deg < m.deg ? x : m), null);
  const lo = shortOnes.filter((x) => !hi || x.deg < hi.deg).reduce((m, x) => (!m || x.deg > m.deg ? x : m), null);
  const grid = (deg) => Math.round(deg / cfg.autoAngleRaiseGridDeg) * cfg.autoAngleRaiseGridDeg;
  const gridUp = (deg) => Math.ceil(deg / cfg.autoAngleRaiseGridDeg - 1e-9) * cfg.autoAngleRaiseGridDeg;
  if (hi) {
    if (!lo || hi.deg - lo.deg <= cfg.autoAngleRaiseGridDeg + 1e-9) return null;
    // False position between the two when both Hold-Downs are known, else the middle.
    const at = Number.isFinite(lo.hd) ? lo.deg + (hi.deg - lo.deg) * (-lo.hd) / (hi.hd - lo.hd) : (lo.deg + hi.deg) / 2;
    const next = Math.min(Math.max(gridUp(at), lo.deg + cfg.autoAngleRaiseGridDeg), hi.deg - cfg.autoAngleRaiseGridDeg);
    return next > lo.deg && next < hi.deg ? grid(next) : null;
  }
  const last = tried[tried.length - 1];
  if (last.failed || last.deg >= cfg.autoAngleMaxDeg || (Number.isFinite(last.flown) && last.flown < last.deg - cfg.autoAngleToleranceDeg * 2)) return null;
  if (tried.length === 1) return Math.min(cfg.autoAngleMaxDeg, grid(last.deg + cfg.autoAngleRaiseStepDeg));
  const prev = tried[tried.length - 2];
  // Two tries without a Hold-Down value (the Offset Turn End stays past the Roll-in Start): a steeper angle does not help.
  if (!Number.isFinite(last.hd) && !Number.isFinite(prev.hd)) return null;
  let next = last.deg + cfg.autoAngleRaiseStepDeg;
  if (Number.isFinite(last.hd) && Number.isFinite(prev.hd)) {
    const slope = (last.hd - prev.hd) / (last.deg - prev.deg);
    if (!(slope > 0)) return null;
    const needed = last.deg + (cfg.autoAngleRaiseTargetNm - last.hd) / slope;
    if (needed > cfg.autoAngleMaxDeg + cfg.autoAngleRaiseStepDeg) return null;
    next = Math.min(Math.max(needed, last.deg + cfg.autoAngleRaiseGridDeg), last.deg + 2 * cfg.autoAngleRaiseStepDeg);
  }
  return Math.min(cfg.autoAngleMaxDeg, gridUp(next));
}

export function calculatePopupFlightFull(input) {
  return calculateWithIaaEdit(input, (i) => popupFlightWithClearFit(i, calculateOffsetFlightFull));
}

// Cleared-field fit (0.1.10; the search itself is shared with the Offset Flight since 0.1.11, offset-clear-fit-v0.1).
// POP-UP adds its fields: a Popup Angle / Pop to Roll-in Distance / Exposure Time goes back to AUTO, a Roll-in Speed to
// AUTO (MIL arrival), and step 2 also tries the Popup Angle; a first pass avoids LOW SPEED fits.
const range = clearFitRange;
export const POPUP_CLEAR_FIT = Object.freeze({
  // key: [label, page default, candidates]
  offsetSpeedValue: ["Initial Speed", 480, range(360, 550, 10)],
  offsetAltitudeMslFt: ["Offset Altitude", 500, range(100, 3000, 100)],
  diveAngleDeg: ["Dive Angle", 20, range(5, 45, 5)],
  releaseAltitudeMslFt: ["Release Altitude", 3300, range(2000, 8000, 250)],
  angleOffDeg: ["Angle Off", 45, range(20, 120, 5)],
  attackHeadingDeg: ["Attack Heading", 30, range(0, 90, 5)],
  offsetAngleDeg: ["Offset Angle", 20, range(2, 60, 1)],
  actionRangeNm: ["Action Range", 7, range(3, 15, 0.5)],
  approachRangeNm: ["Approach Range", 3, range(0.5, 8, 0.5)],
  vrpRangeNm: ["VRP Range", 8, range(4, 15, 0.5)],
  ipRangeNm: ["IP Range", 10, range(5, 20, 1)],
  offsetG: ["Offset G", 3, range(1.5, 6, 0.5)],
  offsetBankDeg: ["Offset Bank", 60, range(30, 85, 5)],
  offsetRadiusNm: ["Offset Radius", 2, range(0.5, 4, 0.25)],
  rollInAltitudeMslFt: ["Roll-in Altitude", 4000, range(2000, 12000, 250)],
  rollInG: ["Roll-in G", 3, range(2, 6, 0.5)],
  popupG: ["Popup G", 4, range(2, 6, 0.5)],
  popupAngleDeg: ["Popup Angle", 30, range(5, 55, 2.5)],
});
// Step 2's order (owner agreed 2026-11-10): the fields that change the fit most first.
export const CLEAR_FIT_ORDER = Object.freeze(["offsetAngleDeg", "rollInAltitudeMslFt", "popupAngleDeg", "actionRangeNm", "approachRangeNm", "offsetG"]);
const POPUP_CLEAR_FIT_SPEC = Object.freeze({
  table: POPUP_CLEAR_FIT,
  order: CLEAR_FIT_ORDER,
  autoOnClear: {
    popupAngleDeg: [{ key: "popupDriver", value: "DEFAULT" }, { key: "popupLockAngle", value: false }],
    popupGroundDistanceNm: [{ key: "popupDriver", value: "DEFAULT" }],
    popupExposureTimeSec: [{ key: "popupDriver", value: "DEFAULT" }],
    initialSpeedValue: [{ key: "popupLockRollInSpeed", value: false }],
    popupSpeedKcas: [{ key: "popupSpeedFollow", value: true }],
  },
  autoText: { popupSpeedKcas: "follows Initial Speed" },
  autoLabel: { popupSpeedKcas: "Pop-up Speed", popupGroundDistanceNm: "Pop to Roll-in Distance", popupExposureTimeSec: "Exposure Time", initialSpeedValue: "Roll-in Speed" },
  // A fit flies (VALID / WARNING) and, in the first pass, keeps above the LOW SPEED line (the second pass allows it).
  strict: true,
  flies: (out, n, strict) => ["VALID", "WARNING"].includes(out?.aircraftResults?.[n]?.status) && !(strict && out.aircraftResults[n].popup?.lowSpeed),
  locked: (input, n, key) => (key === "popupAngleDeg" ? input.aircraft[n]?.state?.popupLocks?.angle === true : clearFitFieldLocked(input, n, key)),
  currentValue: (out, n, key) => out.aircraftResults[n]?.popup?.[key],
});

function popupFlightWithClearFit(rawInput, offsetFlight) {
  const result = calculateWithClearFit(linkInitialAltitude(rawInput), (input) => popupFlight(input, offsetFlight), POPUP_CLEAR_FIT_SPEC);
  return withLinkedInitialAltitude(result);
}

// Initial Altitude = Offset Altitude (0.1.21). In: an Initial Altitude edit becomes #1's Offset Altitude edit (its
// value moved to #1's record); every record's Initial Altitude is then #1's Offset Altitude; the Roll-in LINK is off.
export function linkInitialAltitude(rawInput) {
  if (!rawInput?.aircraft?.[1]?.values) return rawInput;
  const input = { ...rawInput, aircraft: { ...rawInput.aircraft } };
  const copyRecord = (n) => { input.aircraft[n] = { ...input.aircraft[n], values: { ...input.aircraft[n].values }, state: { ...(input.aircraft[n].state ?? {}) } }; return input.aircraft[n]; };
  const lead = copyRecord("1");
  const asOffset = (edit) => {
    if (edit?.key === "rollInAltitudeLinked") return null;
    if (edit?.key !== "initialAltitudeMslFt") return edit;
    const from = input.aircraft[String(edit.aircraft ?? 1)]?.values;
    if (from && Object.hasOwn(from, "initialAltitudeMslFt")) lead.values.offsetAltitudeMslFt = from.initialAltitudeMslFt;
    return { ...edit, aircraft: 1, key: "offsetAltitudeMslFt" };
  };
  if (input.edit) { const e = asOffset(input.edit); if (e) input.edit = e; else delete input.edit; }
  if (input.edits) input.edits = input.edits.map(asOffset).filter(Boolean);
  for (const n of Object.keys(input.aircraft)) {
    const record = n === "1" ? lead : input.aircraft[n]?.values ? copyRecord(n) : null;
    if (!record) continue;
    record.values.initialAltitudeMslFt = lead.values.offsetAltitudeMslFt;
    record.state.rollInAltitudeLinked = false;
  }
  return input;
}
// Out: every aircraft's Initial Altitude is the Offset Altitude flown (#1's resolved one, else #1's record).
function withLinkedInitialAltitude(result) {
  const aircraft = result?.nextInput?.aircraft;
  if (!aircraft?.[1]?.values) return result;
  const flown = result.aircraftResults?.[1]?.result?.resolved?.offsetAltitudeMslFt;
  const altitude = Number.isFinite(flown) ? flown : aircraft[1].values.offsetAltitudeMslFt;
  for (const record of Object.values(aircraft)) if (record?.values) record.values.initialAltitudeMslFt = altitude;
  return result;
}

// The output has the Offset Flight's shape (the page reuses the Offset controller): each aircraftResults[n] is the
// Offset's with the POP-UP status, errors and warnings merged in and `popup` added (angle, climb, events, checks,
// Pop Point, Hold-Down).
function popupFlight(rawInput, offsetFlight) {
  if (!rawInput?.aircraft?.[1]) throw new TypeError("POP-UP Flight input needs aircraft #1");
  const climbFull = createClimbMemo();
  // Profile LINK (0.1.8): the LINK after every edit of this request, the POP-UP edits included (the Offset Flight does
  // not see those), goes down with the records; a linked aircraft takes its source's POP-UP below.
  const linkStates = profileLinkStates(rawInput);
  const input = { ...rawInput, aircraft: { ...rawInput.aircraft } };
  // 0.1.20 (owner 2026-11-19, "다이브할 때 military power"): every aircraft dives at MIL (BDP v0.4.10); its Release
  // Speed is a cap (blank: none) and the Release speed flown is a result. Its SEM is flown at MIL as well.
  for (const [n, record] of Object.entries(input.aircraft)) {
    if (record?.values && (record.values.diveSpeedModel !== "MIL" || record.values.semSpeedModel !== "MIL")) input.aircraft[n] = { ...record, values: { ...record.values, diveSpeedModel: "MIL", semSpeedModel: "MIL" } };
  }
  // An emptied Release Speed stays empty (no cap: the dive's own Release speed), not refilled as other fields are.
  const releaseCleared = (e) => e?.kind === "clear" && e.key === "releaseSpeedKcas";
  for (const e of editsOf(input).filter(releaseCleared)) {
    const n = String(e.aircraft ?? 1);
    if (input.aircraft[n]?.values) input.aircraft[n] = { ...input.aircraft[n], values: { ...input.aircraft[n].values, releaseSpeedKcas: null } };
  }
  const asSet = (e) => (releaseCleared(e) ? { ...e, kind: "set" } : e);
  if (input.edit) input.edit = asSet(input.edit);
  if (input.edits) input.edits = input.edits.map(asSet);
  for (const [n, on] of Object.entries(linkStates)) {
    const record = input.aircraft[n];
    if (record && (record.options?.profileLinked === true) !== on) input.aircraft[n] = { ...record, options: { ...record.options, profileLinked: on } };
  }
  const numbers = Object.keys(input.aircraft);
  const linkedTo = Object.fromEntries(numbers.filter((n) => linkStates[n] && input.aircraft[OFFSET_FLIGHT_PROFILE_LINK[n]]).map((n) => [n, String(OFFSET_FLIGHT_PROFILE_LINK[n])]));
  const edited = editedDrivers(input);
  const cleared = clearedValues(input);
  const speedOwn = editedSpeedOwn(input);
  const lockEdits = editedLocks(input);
  const settings = Object.fromEntries(numbers.map((n) => [n, popupSettings(input, n, edited, cleared, lockEdits, speedOwn)]));
  for (const [n, source] of Object.entries(linkedTo)) settings[n] = { ...settings[source], locks: { ...settings[source].locks } };
  // One solve of every aircraft's angle and AUTO Roll-in Speed. `autoAngles` (0.1.14): the AUTO angle to fly instead
  // of the automatic rule's, for the aircraft whose climb did not fit ({} = the rule).
  // 0.1.24 `warm`: a trial of the AUTO angle searches (raise, Apex guard) starts each AUTO Roll-in Speed from the
  // settled speed of the solve already flown nearest its angle, instead of the field's (a trial 15° away started
  // 70 kt off and took six whole Flight solves to settle). The first solve and the answer's start from the field.
  const settledSpeeds = [];
  const solve = (autoAngles = {}, { warm = false } = {}) => {
    // First angles: the driver's own value or the automatic rule on the aircraft's Dive.
    const angles = {};
    const ruleAngles = {};
    const lowered = {};
    for (const n of numbers) {
      const s = settings[n];
      const dive = Number(input.aircraft[n].values?.diveAngleDeg ?? input.aircraft[1].values?.diveAngleDeg);
      ruleAngles[n] = defaultPopupAngleDeg(dive);
      angles[n] = s.driver === "ANGLE" && Number.isFinite(Number(s.popupAngleDeg)) ? Number(s.popupAngleDeg) : s.driver === "DEFAULT" && Number.isFinite(autoAngles[n]) ? autoAngles[n] : ruleAngles[n];
    }
    const angleErrors = {};
    const solved = {};
    // Roll-in Speeds (0.1.7): a LOCKed one as entered; AUTO starts from the field and follows the MIL arrival.
    const speeds = {};
    for (const n of numbers) {
      if (Number.isFinite(settings[n].rollInSpeedKcas)) speeds[n] = settings[n].rollInSpeedKcas;
      if (warm && !linkedTo[n] && !settings[n].locks.rollInSpeed) {
        const near = settledSpeeds.filter((x) => Number.isFinite(x.angles[n]) && Number.isFinite(x.speeds[n])).sort((a, b) => Math.abs(a.angles[n] - angles[n]) - Math.abs(b.angles[n] - angles[n]))[0];
        if (near) speeds[n] = near.speeds[n];
      }
    }
    // A linked aircraft flies its source's angle and Roll-in Speed (and its errors); it is not solved on its own.
    const followSources = () => {
      for (const [n, source] of Object.entries(linkedTo)) {
        angles[n] = angles[source];
        if (Number.isFinite(speeds[source])) speeds[n] = speeds[source];
        settings[n].popupSpeedKcas = settings[source].popupSpeedKcas;
        if (solved[source]) solved[n] = solved[source]; else delete solved[n];
        if (angleErrors[source]) angleErrors[n] = angleErrors[source]; else delete angleErrors[n];
        if (lowered[source]) lowered[n] = lowered[source]; else delete lowered[n];
      }
    };
    followSources();
    const autoSpeed = numbers.filter((n) => !linkedTo[n] && !settings[n].locks.rollInSpeed);
    const backSolve = numbers.filter((n) => !linkedTo[n] && settings[n].locks.rollInSpeed && Number.isFinite(speeds[n]));
    const speedErrors = {};
    const speedHistory = {};
    // 0.1.16: the Roll-in Speeds of the last Offset Flight flown (the ones `output` was calculated with).
    let flownSpeeds = {};
    const fly = () => { flownSpeeds = { ...speeds }; return offsetFlight(withAngles(input, angles, speeds)); };
    let output = fly();
    // AUTO Popup angle (0.1.9): the automatic rule's angle, lowered to the steepest one whose pull-up arc stays below
    // the Roll-in Altitude when the rule's angle cannot be flown.
    const autoAngle = numbers.filter((n) => !linkedTo[n] && settings[n].driver === "DEFAULT");
    // 0.1.24: what the arc check learned of each AUTO angle in this solve — `ceiling` the shallowest angle flown
    // (or asked) whose pull-up arc passed its own Roll-in Altitude, `floor` the steepest flown whose arc fitted.
    // With the Roll-in Altitude solved from the Tracking Time it changes with the angle (a shallower angle gives a
    // higher one), so the angle asked can fit at the lowered angle's Roll-in Altitude and fail again at its own;
    // before, each round asked it again and the solve flipped between the two until it stopped on either.
    const arcBounds = Object.fromEntries(autoAngle.map((n) => [n, { floor: null, ceiling: Infinity }]));
    const needsSolve = numbers.filter((n) => !linkedTo[n] && ["GROUND_DISTANCE", "EXPOSURE_TIME"].includes(settings[n].driver));
    for (let iteration = 0; (needsSolve.length || autoSpeed.length || autoAngle.length || backSolve.length) && iteration < POPUP_FLIGHT_V0_1.angleIterations; iteration += 1) {
      let moved = false;
      for (const n of needsSolve) {
        const r = output.aircraftResults[n];
        if (!r?.result?.profile?.canonicalInputs) continue;
        const s = settings[n];
        try {
          const p = normalizePopupInput({ bdp: bdpInputOf(r.result.profile), popup: { ...popState(r.result.resolved, s.popupSpeedKcas), popupG: s.popupG, driver: s.driver, groundDistanceNm: Number(s.groundDistanceNm), exposureTimeSec: Number(s.exposureTimeSec) } });
          const resolved = resolvePopupAngle(p);
          solved[n] = resolved;
          delete angleErrors[n];
          if (Math.abs(resolved.angleDeg - angles[n]) > POPUP_FLIGHT_V0_1.angleSettleDeg) moved = true;
          angles[n] = resolved.angleDeg;
        } catch (error) {
          angleErrors[n] = error.message;
        }
      }
      for (const n of autoAngle) {
        const r = output.aircraftResults[n]?.result;
        if (!r?.profile?.canonicalInputs) continue;
        const climbInput = { ...popState(r.resolved, settings[n].popupSpeedKcas), rollInAltitudeMslFt: r.profile.public.resolvedInitialAltitudeMslFt, popupG: settings[n].popupG, gOnsetRateGSec: r.profile.canonicalInputs.gOnsetRateGSec };
        const ruleDeg = ruleAngles[n];
        const askedDeg = Number.isFinite(autoAngles[n]) ? autoAngles[n] : ruleDeg;
        const bounds = arcBounds[n];
        const tol = POPUP_FLIGHT_V0_1.autoAngleToleranceDeg;
        // The angle this output was flown with, checked at its own Roll-in Altitude.
        const flownDeg = angles[n];
        const flownFits = climbFits(climbFull, climbInput, flownDeg);
        if (flownFits) bounds.floor = Math.max(bounds.floor ?? -Infinity, flownDeg);
        else bounds.ceiling = Math.min(bounds.ceiling, flownDeg);
        let target = askedDeg;
        if (!(flownFits && flownDeg >= askedDeg - 1e-9)) {
          // The arc limits the angle: the steepest that fits at this Roll-in Altitude (0.1.9) …
          const fit = steepestFittingAngle(climbFull, climbInput, Math.min(askedDeg, bounds.ceiling));
          if (fit === null) continue;
          if (bounds.floor === null) target = fit;
          // … settled when the angle flown is already it (always so when the Roll-in Altitude is entered) …
          else if (flownFits && fit - flownDeg <= tol) target = flownDeg;
          // … else (0.1.24) bisection between the steepest angle that fitted and the shallowest that did not.
          else target = bounds.ceiling - bounds.floor <= tol ? bounds.floor : (bounds.floor + bounds.ceiling) / 2;
        }
        // Below the rule's angle: the pull-up arc limits it (0.1.9's warning).
        // 0.1.19: only what the arc lowered (an Apex-guard angle asked below the rule is not "lowered").
        const floorDeg = Math.min(askedDeg, ruleDeg);
        if (target < floorDeg - POPUP_FLIGHT_V0_1.autoAngleToleranceDeg * 2) lowered[n] = { ruleDeg: floorDeg, angleDeg: target }; else delete lowered[n];
        if (Math.abs(target - angles[n]) > POPUP_FLIGHT_V0_1.angleSettleDeg) moved = true;
        angles[n] = target;
      }
      // LOCKed Roll-in Speed (0.1.13, owner 2026-11-15: "roll in speed를 입력하면 pop up speed를 역산"): the Pop-up Speed
      // whose MIL arrival at this angle and Roll-in Altitude is the entered Roll-in Speed; it becomes the aircraft's own.
      for (const n of backSolve) {
        const r = output.aircraftResults[n]?.result;
        if (!r?.profile?.canonicalInputs || (angleErrors[n] && !speedErrors[n])) continue;
        const climbOf = (popKcas) => climbFull({ ...popState(r.resolved, popKcas), rollInAltitudeMslFt: r.profile.public.resolvedInitialAltitudeMslFt, popupAngleDeg: angles[n], popupG: settings[n].popupG, gOnsetRateGSec: r.profile.canonicalInputs.gOnsetRateGSec }).rollInStart.casKt;
        // 0.1.23 (owner 2026-11-22, slow Roll-in Speed LOCK): the Pop-up Speed flown now is kept when its MIL arrival
        // is already the LOCKed Roll-in Speed (within speedSettleKt), e.g. a LOCK at the AUTO speed shown: nothing moves,
        // so the Offset Flight already flown is the answer (before, a bisection gave a speed 0.00x KCAS off and every
        // aircraft was flown again).
        const flownKcas = popState(r.resolved, settings[n].popupSpeedKcas).popSpeedKcas;
        let keep = false;
        try { keep = Math.abs(climbOf(flownKcas) - speeds[n]) <= POPUP_FLIGHT_V0_1.speedSettleKt; } catch { keep = false; }
        const pop = keep ? { kcas: flownKcas } : solvePopSpeed(climbOf, speeds[n]);
        if (pop.error) { angleErrors[n] = speedErrors[n] = pop.error; continue; }
        if (speedErrors[n]) { delete angleErrors[n]; delete speedErrors[n]; }
        if (!(Math.abs(pop.kcas - flownKcas) <= POPUP_FLIGHT_V0_1.speedSettleKt)) moved = true;
        settings[n].popupSpeedKcas = pop.kcas;
      }
      // AUTO Roll-in Speed: the MIL arrival at this angle and Roll-in Altitude becomes the BDP's Roll-in Speed.
      for (const n of autoSpeed) {
        const r = output.aircraftResults[n]?.result;
        if (!r?.profile?.canonicalInputs || angleErrors[n]) continue;
        try {
          const arrival = climbFull({ ...popState(r.resolved, settings[n].popupSpeedKcas), rollInAltitudeMslFt: r.profile.public.resolvedInitialAltitudeMslFt, popupAngleDeg: angles[n], popupG: settings[n].popupG, gOnsetRateGSec: r.profile.canonicalInputs.gOnsetRateGSec }).rollInStart.casKt;
          const flown = flownSpeeds[n];
          if (!(Math.abs(arrival - speeds[n]) <= POPUP_FLIGHT_V0_1.speedSettleKt)) moved = true;
          // 0.1.24: the speed is the fixed point of speed flown → MIL arrival (the arrival moves with the Roll-in
          // Altitude the speed gives). Two rounds at the same angle and Pop-up Speed give its secant, which lands
          // near the fixed point at once; before, the plain iteration overshot and took four to six rounds.
          const history = (speedHistory[n] ||= []);
          const same = history.length && history.at(-1).angle === angles[n] && history.at(-1).pop === settings[n].popupSpeedKcas;
          if (!same) history.length = 0;
          let next = arrival;
          if (Number.isFinite(flown)) {
            history.push({ angle: angles[n], pop: settings[n].popupSpeedKcas, x: flown, g: arrival });
            if (history.length >= 2) {
              const [a, b] = history.slice(-2);
              const ha = a.g - a.x;
              const hb = b.g - b.x;
              const secant = hb !== ha ? b.x - (hb * (b.x - a.x)) / (hb - ha) : NaN;
              // Kept only between the last speed and its arrival widened by their gap (a safe step).
              const lo = Math.min(b.x, b.g) - Math.abs(hb);
              const hi = Math.max(b.x, b.g) + Math.abs(hb);
              if (Number.isFinite(secant) && secant >= lo && secant <= hi) next = secant;
            }
          }
          speeds[n] = next;
        } catch { /* the climb error is reported below */ }
      }
      if (!moved) {
        // Settled (0.1.16): the AUTO Roll-in Speed returned is the one flown, not the arrival of this last round
        // (within speedSettleKt of it, never flown). The returned state is then its own answer when it comes back.
        for (const n of autoSpeed) if (Number.isFinite(flownSpeeds[n])) speeds[n] = flownSpeeds[n];
        followSources();
        break;
      }
      followSources();
      output = fly();
    }
    settledSpeeds.push({ angles: { ...angles }, speeds: { ...speeds } });
    return { output, angles, speeds, solved, angleErrors, lowered };
  };
  // Hold-Down (0.1.14, owner 2026-11-16): an aircraft whose climb is longer than its Approach (Hold-Down < 0) and
  // whose Popup angle is AUTO flies a steeper angle, the lowest that fits — a steeper climb is shorter. The Roll-in
  // Altitude is not changed (0.1.9 raised it; removed).
  let sol = solve();
  const raisedAngle = {};
  // The raise's trials (0.1.19: the Apex guard reuses them).
  const raiseTried = {};
  const autoRaiseable = (n) => !linkedTo[n] && settings[n].driver === "DEFAULT";
  // 0.1.15: the raise aims at the minimum Hold-Down time, so an AUTO angle whose Hold-Down is 0 … 2 s is raised too.
  // `hd` in the trials is the Hold-Down beyond that minimum (the search's zero); `real` the Hold-Down itself.
  const firstStates = Object.fromEntries(numbers.filter(autoRaiseable).map((n) => [n, holdDownState(climbFull, sol, n, settings[n])]));
  const short = Object.keys(firstStates).filter((n) => firstStates[n].short || (Number.isFinite(firstStates[n].holdDownNm) && firstStates[n].holdDownNm < firstStates[n].needNm));
  if (short.length) {
    const entry = (deg, flown, state, needNm) => ({ deg, flown, real: state.holdDownNm, hd: Number.isFinite(state.holdDownNm) ? state.holdDownNm - needNm : state.holdDownNm, failed: state.failed, slow: state.slowKcas });
    const need = Object.fromEntries(short.map((n) => [n, firstStates[n].needNm ?? 0]));
    const tried = Object.fromEntries(short.map((n) => [n, [entry(sol.angles[n], sol.angles[n], firstStates[n], need[n])]]));
    Object.assign(raiseTried, tried);
    // The angle to fly of the ones tried: the lowest with the minimum Hold-Down; else the one with the longest
    // Hold-Down ≥ 0 (the minimum is out of reach); else none (the rule's angle and its Hold-Down error stand).
    const pick = (n) => {
      const full = tried[n].filter((x) => Number.isFinite(x.hd) && x.hd >= 0).sort((a, b) => a.deg - b.deg)[0];
      if (full) return full;
      return tried[n].filter((x) => Number.isFinite(x.real) && x.real >= 0).sort((a, b) => b.real - a.real || a.deg - b.deg)[0] ?? null;
    };
    const overrides = {};
    const done = {};
    // 0.1.24: the trials flown, so the answer reuses the one flown with its angles.
    const raiseSols = [];
    for (let iteration = 0; iteration < POPUP_FLIGHT_V0_1.autoAngleRaiseTrials; iteration += 1) {
      const active = short.filter((n) => !done[n]);
      for (const n of active) {
        const next = nextAutoAngle(tried[n]);
        if (next === null) {
          done[n] = true;
          // Leave the best one found in place for the other aircraft's trials.
          const ok = pick(n);
          if (ok) overrides[n] = ok.deg; else delete overrides[n];
        } else overrides[n] = next;
      }
      if (short.every((n) => done[n])) break;
      const trial = solve({ ...overrides }, { warm: true });
      raiseSols.push(trial);
      for (const n of active) {
        if (done[n]) continue;
        tried[n].push(entry(overrides[n], trial.angles[n], holdDownState(climbFull, trial, n, settings[n]), need[n]));
      }
    }
    for (const n of short) {
      const ok = pick(n);
      if (ok && ok.deg > tried[n][0].deg) raisedAngle[n] = { ruleDeg: tried[n][0].deg, angleDeg: ok.deg };
    }
    if (Object.keys(raisedAngle).length) {
      const final = Object.fromEntries(Object.entries(raisedAngle).map(([n, r]) => [n, r.angleDeg]));
      const reuse = raiseSols.find((trial) => numbers.filter(autoRaiseable).every((k) => Math.abs(trial.angles[k] - (final[k] ?? sol.angles[k])) < 1e-9));
      sol = reuse ?? solve(final);
    }
    for (const n of Object.keys(raisedAngle)) {
      raisedAngle[n].angleDeg = sol.angles[n];
      if (!(sol.angles[n] > raisedAngle[n].ruleDeg)) delete raisedAngle[n];
    }
  }
  // Apex guard (0.1.19, owner 2026-11-18, "최대한 수정하고 안되면 경고"; SPEC §13.8aa): an AUTO angle whose slowest speed
  // Pop → Apex is below the LOW SPEED line (300 KCAS) is lowered to the steepest angle that keeps it at or above the
  // line with an Offset-Popup Range ≥ 0 (a shallower climb is faster but longer). None such: the angle stays, warned.
  const apexGuard = {};
  const lowLine = POPUP_BE_V0_2.lowSpeedWarningKcas;
  const grid = POPUP_FLIGHT_V0_1.autoAngleRaiseGridDeg;
  const guardAngles = () => Object.fromEntries(numbers.filter(autoRaiseable).map((k) => [k, apexGuard[k]?.angleDeg ?? raisedAngle[k]?.angleDeg ?? sol.angles[k]]));
  for (const n of numbers.filter(autoRaiseable)) {
    const state = holdDownState(climbFull, sol, n, settings[n]);
    const fromDeg = sol.angles[n];
    if (state.failed || !Number.isFinite(state.slowKcas) || state.slowKcas >= lowLine || !Number.isFinite(fromDeg)) continue;
    // Points known so far: { deg (flown), slow, real }; good = at or above the line with a Range ≥ 0.
    const isGood = (x) => Number.isFinite(x.slow) && x.slow >= lowLine && Number.isFinite(x.real) && x.real >= 0;
    const known = [{ deg: fromDeg, slow: state.slowKcas, real: state.holdDownNm }, ...(raiseTried[n] ?? []).filter((x) => !x.failed && Number.isFinite(x.flown)).map((x) => ({ deg: x.flown, slow: x.slow, real: x.real }))];
    const tryAngle = (deg) => {
      const trial = solve({ ...guardAngles(), [n]: deg }, { warm: true });
      const st = holdDownState(climbFull, trial, n, settings[n]);
      const point = { deg: trial.angles[n], slow: st.failed ? null : st.slowKcas, real: st.failed ? null : st.holdDownNm, sol: trial };
      known.push(point);
      return point;
    };
    // Steepest good below the current angle, and the shallowest slow one above it.
    for (let round = 0; round < POPUP_FLIGHT_V0_1.apexGuardTrials; round += 1) {
      const lo = known.filter((x) => x.deg < fromDeg + 1e-9 && isGood(x)).sort((a, b) => b.deg - a.deg)[0] ?? null;
      const hi = known.filter((x) => x.deg <= fromDeg + 1e-9 && Number.isFinite(x.slow) && x.slow < lowLine && (!lo || x.deg > lo.deg)).sort((a, b) => a.deg - b.deg)[0];
      if (!hi || (lo && hi.deg - lo.deg <= grid + 1e-9)) break;
      // A shallower angle only shortens the Offset-Popup Range: below a Range < 0 nothing good is left.
      // 0.1.24: only a Range known to be < 0 says so. A trial whose Offset solve failed (no value: e.g. a gap of the
      // Roll-in solve near Angle Off ≈ Dive) is a gap, not a short Range: the search goes on below it.
      if (!lo && known.some((x) => x.deg < hi.deg && Number.isFinite(x.real) && x.real < 0)) break;
      // Where the slowest speed reaches the line: the secant of the two nearest, else about 4 KCAS per degree.
      const below = lo ?? known.filter((x) => x.deg < hi.deg && Number.isFinite(x.slow)).sort((a, b) => b.deg - a.deg)[0];
      let at = below && below.slow !== hi.slow ? below.deg + (hi.deg - below.deg) * (lowLine - below.slow) / (hi.slow - below.slow) : hi.deg - (lowLine - hi.slow) / 4;
      if (!lo) at = Math.min(at, hi.deg - grid);
      let deg = Math.floor(at / grid + 1e-9) * grid;
      if (lo) deg = Math.min(Math.max(deg, lo.deg + grid), hi.deg - grid);
      // 0.1.24: an angle at or past a failed trial (between it and the lowest good one, or below it with none good)
      // is not asked again: the next one is halfway from that failure toward the good side, at least 2° past it.
      const gap = known.filter((x) => !Number.isFinite(x.slow) && x.deg < hi.deg && (!lo || x.deg > lo.deg) && deg >= x.deg - 1e-9).sort((a, b) => a.deg - b.deg)[0];
      if (gap) deg = Math.floor((lo ? (lo.deg + gap.deg) / 2 : gap.deg - Math.max(2, (hi.deg - gap.deg) / 2)) / grid + 1e-9) * grid;
      if (lo && !(deg > lo.deg)) break;
      if (!(deg >= POPUP_FLIGHT_V0_1.autoAngleMinDeg) || known.some((x) => Math.abs(x.deg - deg) < 1e-6)) break;
      tryAngle(deg);
    }
    const best = known.filter((x) => x.deg < fromDeg + 1e-9 && isGood(x)).sort((a, b) => b.deg - a.deg)[0];
    if (best) apexGuard[n] = { fromDeg, angleDeg: best.deg, slowKcas: state.slowKcas, sol: best.sol ?? null, lowered: sol.lowered[n] ?? null };
  }
  if (Object.keys(apexGuard).length) {
    // A trial already flown with every final angle is the answer (one aircraft guarded: its best trial).
    const final = guardAngles();
    const same = (trial) => trial && Object.entries(final).every(([k, deg]) => Math.abs(trial.angles[k] - deg) < 1e-9);
    const reuse = Object.values(apexGuard).map((g) => g.sol).find(same);
    sol = reuse ?? solve(final);
    for (const n of Object.keys(apexGuard)) {
      delete apexGuard[n].sol;
      // What the arc lowered before the guard stays reported.
      if (apexGuard[n].lowered) sol.lowered[n] = apexGuard[n].lowered;
      delete apexGuard[n].lowered;
      apexGuard[n].angleDeg = sol.angles[n];
      if (raisedAngle[n]) {
        if (sol.angles[n] > raisedAngle[n].ruleDeg) raisedAngle[n].angleDeg = sol.angles[n]; else delete raisedAngle[n];
      }
    }
  }
  const { output, angles, speeds, solved, angleErrors, lowered } = sol;
  // 0.1.14: how a remaining Hold-Down < 0 could be fitted.
  const holdDownHint = (n) => (short.includes(n)
    ? "; no steeper AUTO Popup angle fits it: lower the Offset Angle"
    : "; raise the Popup Angle (AUTO raises it by itself) or lower the Offset Angle");
  const aircraftResults = {};
  for (const n of numbers) {
    const offset = output.aircraftResults[n];
    const s = settings[n];
    const base = { driver: s.driver, popupG: s.popupG, popupSpeedKcas: s.popupSpeedKcas, popupAngleDeg: angles[n], ...(raisedAngle[n] ? { autoAngleRaised: raisedAngle[n] } : {}), ...(lowered[n] ? { autoAngleLowered: lowered[n] } : {}), ...(apexGuard[n] ? { autoAngleApexGuard: apexGuard[n] } : {}), locks: s.locks, rollInSpeedSource: s.locks.rollInSpeed ? "LOCK" : "AUTO", rollInSpeedKcas: speeds[n], ...releaseSpeedOf(offset) };
    const merge = (popup, errors, warnings) => {
      const status = errors.length ? "INVALID" : offset.status === "WARNING" || warnings.length ? "WARNING" : offset.status;
      return { ...offset, status, errors: [...(offset.errors ?? []), ...errors], warnings: [...(offset.warnings ?? []), ...warnings], popup: { ...base, ...popup } };
    };
    if (!offset) { aircraftResults[n] = { status: "FAILED", errors: ["No Offset result"], warnings: [], popup: base }; continue; }
    if (angleErrors[n]) { aircraftResults[n] = merge({}, [angleErrors[n]], []); continue; }
    // 0.1.25: INVALID only for the Tracking Time (Offset BE 0.2.21) still flies the climb; its error stays.
    const issue = offset.result?.trackingIssue;
    const onlyTracking = offset.status === "INVALID" && issue?.level === "error" && (offset.errors ?? []).length > 0 && offset.errors.every((e) => e === issue.text);
    if (!offset.result?.profile?.canonicalInputs || !(offset.status === "VALID" || offset.status === "WARNING" || onlyTracking)) {
      // 0.1.9: the Turn End past the Roll-in Start is the same shortage as a Hold-Down < 0; say how it could fit.
      const errors = (offset.errors ?? []).map((e) => (/Offset Turn End has passed Roll-in Start/.test(e) ? `${e}; a steeper Popup angle does not fit it: lower the Offset Angle or change this aircraft's position` : e));
      aircraftResults[n] = { ...offset, errors, popup: base };
      continue;
    }
    const r = offset.result;
    const bdp = r.profile;
    const pop = popState(r.resolved, s.popupSpeedKcas);
    const p = normalizePopupInput({ bdp: bdpInputOf(bdp), popup: { ...pop, popupG: s.popupG, driver: "ANGLE", popupAngleDeg: angles[n] } });
    let climb;
    try {
      climb = climbFull({ ...pop, rollInAltitudeMslFt: bdp.public.resolvedInitialAltitudeMslFt, popupAngleDeg: angles[n], popupG: s.popupG, gOnsetRateGSec: bdp.canonicalInputs.gOnsetRateGSec });
    } catch (error) {
      // 0.1.9: the angle that would fit, for a typed / LOCKed angle (an AUTO one was lowered already).
      const fit = error.code === "ARC_PASSES_ROLL_IN"
        ? steepestFittingAngle(climbFull, { ...pop, rollInAltitudeMslFt: bdp.public.resolvedInitialAltitudeMslFt, popupG: s.popupG, gOnsetRateGSec: bdp.canonicalInputs.gOnsetRateGSec }, angles[n]) : null;
      aircraftResults[n] = merge({}, [fit === null ? error.message : `${error.message}; at most ${fit.toFixed(1)}° fits at this Roll-in Altitude`], []);
      continue;
    }
    const errors = [];
    const warnings = s.overridden ? [s.overridden] : [];
    // 0.1.9: what the planner changed so the climb fits.
    if (raisedAngle[n]) warnings.push(`Popup angle (AUTO) raised ${raisedAngle[n].ruleDeg.toFixed(1)}° → ${raisedAngle[n].angleDeg.toFixed(1)}° so the climb fits the Approach (Offset-Popup Time aimed at ${POPUP_FLIGHT_V0_1.minHoldDownSec} s or more)`);
    if (apexGuard[n]) warnings.push(`Popup angle (AUTO) held at ${apexGuard[n].angleDeg.toFixed(1)}° (not ${apexGuard[n].fromDeg.toFixed(1)}°) so the speed Pop → Apex stays at or above ${lowLine} KCAS`);
    if (lowered[n]) warnings.push(`Popup angle (AUTO) lowered ${lowered[n].ruleDeg.toFixed(1)}° → ${lowered[n].angleDeg.toFixed(1)}°: at ${lowered[n].ruleDeg.toFixed(1)}° the pull-up arc passes the Roll-in Altitude`);
    const attack = assemblePopupAttack({ p: { ...p, driver: s.driver }, rollInSpeedSource: s.locks.rollInSpeed ? "LOCK" : "AUTO", angleDeg: angles[n], otherSolutionsDeg: solved[n]?.otherSolutionsDeg ?? [], bdp, climb, errors, warnings });
    // Pop Point on the Approach leg, ground distance before Roll-in Start.
    const approachRangeNm = r.resolved.approachRangeNm;
    const holdDownNm = approachRangeNm - climb.groundDistanceNm;
    if (!(holdDownNm >= 0)) {
      errors.push(`Offset-Popup Range ${holdDownNm.toFixed(2)} NM: the Popup ground distance ${climb.groundDistanceNm.toFixed(2)} NM is longer than the Approach Range ${approachRangeNm.toFixed(2)} NM${holdDownHint(n)}`);
    }
    const heading = r.geometry.offsetHeadingDeg * DEG;
    const rollStart = r.geometry.points.rollStart;
    const popPoint = { x: rollStart.x - climb.groundDistanceNm * Math.sin(heading), y: rollStart.y - climb.groundDistanceNm * Math.cos(heading) };
    // Timing: the Offset clock with its Approach replaced by the Hold-Down (Offset ground speed) and the climb.
    const holdDownSec = Math.max(0, holdDownNm) / approachSpeedNmSec(r);
    // 0.1.15: a Hold-Down shorter than the minimum (the Pop right after the Offset Turn) is a warning, whatever the driver.
    if (holdDownNm >= 0 && holdDownSec < POPUP_FLIGHT_V0_1.minHoldDownSec - 1e-9) {
      warnings.push(`SHORT OFFSET-POPUP TIME: ${holdDownSec.toFixed(1)} s (${holdDownNm.toFixed(2)} NM) after the Offset Turn, under ${POPUP_FLIGHT_V0_1.minHoldDownSec} s${s.driver === "DEFAULT" ? "; no AUTO Popup angle gives more: lower the Offset Angle" : "; raise the Popup Angle or lower the Offset Angle"}`);
    }
    const popTimeSec = r.timing.ingressSec + r.timing.offsetTurnSec + holdDownSec;
    // At the Pop Point (heading = the Approaching Heading): range to the Target and the angle-off, the Target's
    // bearing from the Pop Point relative to the heading (right +).
    const target = r.geometry.points.target;
    const popToTargetNm = Math.hypot(target.x - popPoint.x, target.y - popPoint.y);
    let popAngleOffDeg = (Math.atan2(target.x - popPoint.x, target.y - popPoint.y) / DEG) - r.geometry.offsetHeadingDeg;
    popAngleOffDeg -= 360 * Math.round(popAngleOffDeg / 360);
    // The POP-UP clock (0.1.2): the Approach is the Hold-Down then the climb; IP → Release follows it.
    const climbSec = climb.climbTimeSec;
    const approachSec = holdDownSec + climbSec;
    const timing = { ...r.timing, offsetApproachLevelSec: r.timing.approachSec, popupHoldDownSec: holdDownSec, popupClimbSec: climbSec, popupPopSec: popTimeSec,
      approachSec, offsetIpToReleaseSec: r.timing.offsetIpToReleaseSec - r.timing.approachSec + approachSec };
    const popupResult = { ...r, timing, geometry: { ...r.geometry, points: { ...r.geometry.points, popPoint } } };
    const { status, errors: attackErrors, warnings: attackWarnings, bdp: _bdp, ...popup } = attack;
    // DED (0.1.6): the Pop-up Point page from OA1's reference (the Flight's VIP, #1's, in VIP mode, else the Target);
    // OA2 = OA1's point; both at the Initial Altitude (0.1.22).
    const flightLead = output.aircraftResults[1]?.result;
    const dedBase = flightLead?.referenceMode === "VIP" ? flightLead.geometry.points.vip : target;
    const ded = offset.ded ? { ...offset.ded, popUp: popPointDedPage(dedBase, popPoint, dedInitialAltitudeFt(offset.ded)) } : offset.ded;
    aircraftResults[n] = { ...merge({ ...popup, popPoint, approachRangeNm, holdDownNm, holdDownSec, popTimeSec, popToTargetNm, popAngleOffDeg }, errors, warnings), result: popupResult, ded };
  }
  // DED OA2 (0.1.6, owner): OA1's point (same RNG / TBRG), wherever the aircraft has an OA1 (with or without a Pop
  // Point); ELEV = the aircraft's Initial Altitude (0.1.22; it was the Target Elevation).
  for (const n of numbers) {
    const entry = aircraftResults[n];
    const elevationFt = dedInitialAltitudeFt(entry?.ded);
    if (!entry?.ded?.oa1 || elevationFt === null) continue;
    entry.ded = { ...entry.ded, oa2: { ...entry.ded.oa1, elevationFt } };
  }
  // Written back for the page: each aircraft's flown angle and the two results of its driver.
  const nextInput = structuredClone(output.nextInput ?? input);
  for (const n of numbers) {
    const a = aircraftResults[n].popup ?? {};
    const values = nextInput.aircraft?.[n]?.values;
    if (!values || !Number.isFinite(a.popupAngleDeg)) continue;
    delete values.rollInStartFpaDeg;
    delete values.rollInSpeedModel;
    delete values.diveSpeedModel;
    delete values.semSpeedModel;
    values.popupAngleDeg = a.popupAngleDeg;
    if (Number.isFinite(a.groundDistanceNm)) values.popupGroundDistanceNm = a.groundDistanceNm;
    if (Number.isFinite(a.exposureTimeSec)) values.popupExposureTimeSec = a.exposureTimeSec;
    nextInput.aircraft[n].state = { ...nextInput.aircraft[n].state, popupDriver: settings[n].driver, popupLocks: { ...settings[n].locks }, popupSpeedOwn: settings[n].popupSpeedKcas !== null };
    // The Pop-up Speed flown (its own, else the Initial Speed in KCAS) is written back to the field.
    const resolved = aircraftResults[n].result?.resolved;
    if (resolved) values.popupSpeedKcas = popState(resolved, settings[n].popupSpeedKcas).popSpeedKcas;
    // The AUTO Roll-in Speed is written back to the field (the Full value behind it).
    if (!settings[n].locks.rollInSpeed && Number.isFinite(speeds[n])) { values.initialSpeedValue = speeds[n]; values.initialSpeedMode = "CAS"; }
  }
  // Drop-order timing on the POP-UP clock.
  const flightTiming = dropOrderTiming(output.flightSize, aircraftResults, computeDropOrderDeltaFull);
  // The file-name metadata: the Offset Flight's formation name and attack type, #1 Impact − #2 Release on this clock.
  const flightName = output.flightName ? { ...output.flightName, leadImpactToWingmanReleaseSec: leadImpactToWingmanReleaseSec(flightTiming) } : null;
  const result = { ...output, model: { ...POPUP_FLIGHT_V0_1, offsetModel: output.model }, aircraftResults, flightTiming, flightName, nextInput };
  // The page's on-demand request: the minimum-exposure angle of one aircraft (an Apply result, §13.5).
  const requested = input.popupRequest?.minimumExposure;
  if (requested !== undefined && requested !== null) {
    // The request never fails the Flight answer: an unexpected error is this request's UNAVAILABLE.
    let minimum;
    try { minimum = calculatePopupFlightMinimumExposureFull(result, String(requested), offsetFlight); } catch (error) { minimum = { status: "UNAVAILABLE", reason: error.message }; }
    result.popupMinimumExposure = { aircraft: Number(requested), ...minimum };
  }
  return result;
}

// Editing session for the page's Worker (the Flight worker host contract): an Offset Flight session inside, so the
// repeated calls reuse its sub-solves.
export function createPopupFlightSession(options) {
  const offset = createOffsetFlightSession({ ...options, clearFit: false });
  return {
    calculate: (input) => calculateWithIaaEdit(input, (j) => popupFlightWithClearFit(j, (i) => offset.calculate(i))),
    lastStats: () => offset.lastStats(),
    prepare(nextInput) {
      popupFlight(nextInput, (i) => offset.calculate(i));
      return offset.lastStats();
    },
  };
}

// The minimum-exposure angle of aircraft n (an Apply result). 0.1.15 (owner 2026-11-16, B2 "속도까지 맞춰 정확히 계산"):
// each trial angle is flown as the Apply would fly it (the angle typed with source "minimumExposure": the Roll-in
// Speed back on AUTO and fitted to that angle, the Offset geometry solved again, the Hold-Down checked), so the
// angle and time shown are the ones flown after the Apply. Before, the angles were compared at the Roll-in Speed of
// the angle flown now, which gave an angle a few degrees off. An angle that ends INVALID is skipped.
// A whole-Flight trial costs as much as one calculation, so the search is short: it starts at the BE's quick answer
// (the old one), flies that angle and 5° on each side, walks toward the shorter side until the shortest is between
// two longer ones, then flies the vertex of the parabola through the three (twice). Angles are on the page's 0.1°.
export function calculatePopupFlightMinimumExposureFull(flightResult, number, offsetFlight = calculateOffsetFlightFull) {
  const n = String(number);
  const now = flightResult?.aircraftResults?.[n];
  const r = now?.result;
  if (!r?.profile?.canonicalInputs) return { status: "UNAVAILABLE", reason: "No Offset result" };
  const { edit, edits, popupRequest, ...base } = flightResult.nextInput;
  const [lowDeg, highDeg] = [POPUP_BE_V0_2.angleScanDeg[0], POPUP_BE_V0_2.angleScanDeg.at(-1)];
  const grid = (angleDeg) => Math.round(Math.min(highDeg, Math.max(lowDeg, angleDeg)) * 10) / 10;
  const flown = new Map();
  let firstError = null;
  const fly = (angleDeg) => {
    const key = grid(angleDeg);
    if (!flown.has(key)) {
      let value = Infinity;
      try {
        const input = { ...base, aircraft: { ...base.aircraft, [n]: { ...base.aircraft[n], values: { ...base.aircraft[n].values, popupAngleDeg: key } } }, edits: [{ aircraft: Number(n), kind: "set", key: "popupAngleDeg", source: "minimumExposure", commit: true }] };
        const a = popupFlight(input, offsetFlight).aircraftResults[n];
        if (a.status !== "INVALID" && Number.isFinite(a.popup?.exposureTimeSec)) value = a.popup.exposureTimeSec;
        else firstError ??= a.errors?.[0] ?? "no Apex";
      } catch (error) { firstError ??= error.message; }
      flown.set(key, value);
    }
    return flown.get(key);
  };
  let quick = null;
  try { quick = calculatePopupMinimumExposureFull({ bdp: bdpInputOf(r.profile), popup: { ...popState(r.resolved, now.popup?.popupSpeedKcas ?? null), popupG: now.popup?.popupG ?? POPUP_FLIGHT_V0_1.defaultPopupG } }); } catch { /* start from the flown angle */ }
  const step = 5;
  let mid = grid(quick?.status === "VALID" ? quick.angleDeg : now.popup?.popupAngleDeg ?? 30);
  let lo = grid(mid - step);
  let hi = grid(mid + step);
  for (let walk = 0; walk < 12; walk += 1) {
    const [fl, fm, fh] = [fly(lo), fly(mid), fly(hi)];
    if (fl < fm && fl <= fh && lo > lowDeg) { hi = mid; mid = lo; lo = grid(mid - step); } else if (fh < fm && hi < highDeg) { lo = mid; mid = hi; hi = grid(mid + step); } else break;
  }
  for (let pass = 0; pass < 2; pass += 1) {
    const [fl, fm, fh] = [fly(lo), fly(mid), fly(hi)];
    if (![fl, fm, fh].every(Number.isFinite) || !(lo < mid && mid < hi)) break;
    const denominator = (mid - lo) * (fm - fh) - (mid - hi) * (fm - fl);
    if (!(Math.abs(denominator) > 1e-12)) break;
    const vertex = grid(mid - 0.5 * ((mid - lo) ** 2 * (fm - fh) - (mid - hi) ** 2 * (fm - fl)) / denominator);
    if (!(vertex > lo && vertex < hi) || vertex === mid) break;
    const fv = fly(vertex);
    // Keep the three points around the shortest.
    if (fv < fm) { if (vertex < mid) hi = mid; else lo = mid; mid = vertex; } else if (vertex < mid) lo = vertex; else hi = vertex;
  }
  const points = [...flown].filter(([, value]) => Number.isFinite(value)).sort((a, b) => a[0] - b[0]);
  if (!points.length) return { status: "UNAVAILABLE", reason: firstError ?? "No Popup angle near the quick answer can be flown" };
  const [angleDeg, exposureTimeSec] = points.reduce((best, x) => (x[1] < best[1] ? x : best));
  return { status: "VALID", angleDeg, exposureTimeSec, scan: points.map(([x, value]) => ({ angleDeg: x, exposureTimeSec: value })) };
}

export function calculatePopupFlight(input) {
  return truncateBeOutput(calculatePopupFlightFull(input));
}
