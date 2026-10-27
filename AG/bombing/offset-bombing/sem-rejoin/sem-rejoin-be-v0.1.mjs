// Offset SEM & Rejoin — pure calculation (owning contract: ./SPEC.md).
//
// Every aircraft of the Offset Flight releases on the Offset IP clock (T = 0 when each aircraft
// crosses its own IP, the clock of the Offset Top View time dial), flies the CLIMB SEM of its own
// BDP release state, then the user's maneuver rows (Straight / Turn / Target Arc). Each row starts
// from the previous row's full end state: position, time, heading, speed, FPA and altitude are
// continuous, nothing is snapped. A row without its required condition is a DRAFT and the rows after
// it are not computed. Formation targets are evaluated on the same IP clock.
//
// Ownership: the SEM is the Common wings-level recovery pull to level (default, owner 2026-10-13) or
// the CSEM core's +30° CLIMB SEM (flight/maneuvers/safe-escape/work/v0.2), both as sampled paths;
// the Release state, the attack-run positions and the Offset clock are the Offset / BDP results
// (offset-time-path view helper, BDP release velocity); the G <-> Bank relation and the level-turn
// radius are Common turn-performance v0.2; this module owns the post-SEM motion, the Target Arc,
// the draw (Heading + mouse) correction and the formation evaluation. No DOM, no storage.

import { tasToCas } from "../../../../common/airspeed/airspeed-v0.1.mjs";
import { cachedCalculation, calculationCacheStats, createCalculationCache, snapshotCalculationCacheStats, withCalculationCache } from "../../../../common/calculation/calculation-cache-v0.1.mjs";
import {
  TURN_PERFORMANCE_MODEL_V0_2,
  bankAngleDegFromLoadFactorAndFpa,
  horizontalTurnRadiusNmFromTasFpaAndBank,
  loadFactorFromBankAndFpa,
} from "../../../../common/maneuvers/turn-performance/turn-performance-v0.2.mjs";
import { RECOVERY_PULL_MODEL } from "../../../../common/maneuvers/recovery-pull/recovery-pull-v0.1.mjs";
import { truncateBeOutput } from "../../../../common/ui/display-precision-v0.1.mjs";
import { CLIMB_SEM_MODEL_V0_2 } from "../../../../flight/maneuvers/safe-escape/work/v0.2/climb-sem-core-v0.2.mjs";
import { computeFormationOffsetVectorFull } from "../offset-formation-v0.1.mjs";
import { add, dot, len, mul, signedHeadingDelta, sub, vecHeading } from "../offset-geometry-v0.2.mjs";
import { OFFSET_TIME_PATH_V0_1, offsetTimeline } from "../view/offset-time-path-v0.1.mjs";

// Physical constants as in the CSEM core and Common turn performance.
const G_FTPS2 = 32.174;
const KT_TO_FPS = 1.687809857;
const FT_PER_NM = 6076.11549;
const DEG = Math.PI / 180;
const NM_PER_KT_SEC = 1 / 3600;

export const SEM_REJOIN_V0_1 = Object.freeze({
  id: "offset-sem-rejoin-v0.1",
  // 0.2.1 (2026-10-15): the Offset clock follows the onset Offset turn (offset-be-v0.2 0.2.11,
  // geometry.offsetTurnPath passed through).
  // 0.3.0 (2026-10-18, owner handoff §6.5): the SEM is the BDP's selected SEM (BDP v0.4.2: LEVEL or the CSEM to
  // its Target FPA, from Release + Overshoot, on the attack ground track) — S&R runs no SEM of its own and the
  // plan's per-aircraft semEnd is no longer read (the BDP tab owns the SEM End).
  // 0.3.1 (2026-10-19, owner): the BDP Level SEM turn (BDP v0.4.3) is part of the SEM step — its samples carry the
  // cross range, heading change and bank; S&R starts at the turn's end (no straight level carry after it).
  // 0.3.2 (2026-10-22, owner): the plan follows the Offset Run-In turn — its absolute headings (Turn / Arc HEADING,
  // Arc END_RADIAL, the draw heading, the Egress heading) turn by the Flight's runInTurnDeg change; the wind stays.
  // 0.3.3 (2026-10-27, owner, POP-UP SPEC §13.6): BDP v0.4.4 flies a SEM at every Dive above 0°, so below 10° is
  // supported; only Dive 0° (level delivery, no recovery) has no SEM and is UNSUPPORTED.
  version: "0.3.3",
  model: Object.freeze({ id: "sr-energy-neutral-point-mass-v0.1", version: "0.1.0", integrationStepSec: 0.01 }),
  components: Object.freeze({
    sem: `${CLIMB_SEM_MODEL_V0_2.id} ${CLIMB_SEM_MODEL_V0_2.version}`,
    levelSem: `${RECOVERY_PULL_MODEL.id} ${RECOVERY_PULL_MODEL.version}`,
    turn: `${TURN_PERFORMANCE_MODEL_V0_2.id} ${TURN_PERFORMANCE_MODEL_V0_2.version}`,
    clock: `${OFFSET_TIME_PATH_V0_1.id} ${OFFSET_TIME_PATH_V0_1.version}`,
  }),
  // SPEC "Model": the same energy assumption as the CSEM core it continues.
  assumptions: Object.freeze([
    "ENERGY_NEUTRAL_POINT_MASS: no thrust / drag / weight data; total energy is constant, so level flight holds TAS and a climb trades speed for height",
    "UNIFORM_WIND: the Flight's true wind, constant with height and time; ground velocity = air velocity + wind",
    "COORDINATED_TURNS: no sideslip; roll-in / roll-out time is not modelled (bank changes at the row boundary)",
    "WINGS_LEVEL_LEVEL_OFF: a row that asks for level flight while climbing first pushes over wings level at the Level-off G",
  ]),
  // Tolerances (SPEC "Tolerances").
  arcPositionToleranceNm: 0.005,
  arcTrackToleranceDeg: 0.5,
  semSampleSec: 0.1,
  // Drawing / interpolation samples: 0.1 s for integrated phases, 2° for turns and arcs.
  sampleSec: 0.1,
  sampleDeg: 2,
  maxRowSec: 3600,
  maxLevelOffSec: 120,
});

const ROW_KINDS = Object.freeze(["STRAIGHT", "TURN", "TARGET_ARC"]);
const STRAIGHT_ENDS = Object.freeze(["TIME", "DISTANCE", "ALTITUDE", "SPEED"]);
const TURN_ENDS = Object.freeze(["HEADING", "HEADING_CHANGE"]);
const ARC_ENDS = Object.freeze(["ARC_ANGLE", "END_RADIAL", "HEADING"]);
const DIRECTIONS = Object.freeze(["LEFT", "RIGHT"]);
const VERTICALS = Object.freeze(["LEVEL", "HOLD_FPA"]);
const DRIVER_KINDS = Object.freeze(["G", "BANK"]);
const PRESETS = Object.freeze(["COMBAT_SPREAD", "WEDGE", "CUSTOM"]);
// SEM end (owner 2026-10-13: "Dive에서 바로 수평 회복", "FPM이 0을 찍으면 1g"): LEVEL = pull from the
// dive at Recovery G until FPA 0°, then 1 G level flight (default); CLIMB = the +30° CLIMB SEM.
const SEM_ENDS = Object.freeze(["LEVEL", "CLIMB"]);
const AIRCRAFT = Object.freeze([1, 2, 3, 4]);

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const norm360 = (deg) => ((deg % 360) + 360) % 360;
const headingOf = (vector) => norm360(Math.atan2(vector.x, vector.y) / DEG);
const cross = (a, b) => a.x * b.y - a.y * b.x;
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const elementLeadOf = (number) => (number === 1 ? null : number === 4 ? 3 : 1);

// ---- plan ---------------------------------------------------------------------------------------

function defaultSettings() {
  return { semEnd: "LEVEL", levelOffG: null, turnDriverKind: "G", turnDriverValue: null, drawDirection: "AUTO", drawVertical: "LEVEL", drawHeadingDeg: null };
}
function defaultFormation() {
  return { preset: null, side: null, bearingDeg: null, rangeNm: null };
}

// The default S&R input state: no rows, nothing set (SPEC "Defaults"). Only Save stores it.
export function createDefaultSemRejoinPlan() {
  const aircraft = {};
  for (const number of AIRCRAFT) aircraft[number] = { rows: [], settings: defaultSettings() };
  return {
    schemaVersion: 1,
    nextRowId: 1,
    aircraft,
    egress: { headingDeg: null, speedKcas: null, altitudeMslFt: null },
    formation: { 2: defaultFormation(), 3: defaultFormation(), 4: defaultFormation() },
    tolerance: { positionNm: null, headingDeg: null, altitudeFt: null, relativeSpeedKt: null },
    // The Offset Run-In turn (Flight state.runInTurnDeg) the absolute headings are drawn for; null = not yet known.
    runInTurnDeg: null,
  };
}

const numberOrNull = (value) => (value === null || value === undefined || value === "" ? null : isFiniteNumber(value) ? value : Number.NaN);
const oneOf = (value, list, fallback = null) => (list.includes(value) ? value : fallback);

function normalizeEnd(end, kinds) {
  const kind = oneOf(end?.kind, kinds, kinds[0]);
  return { kind, value: numberOrNull(end?.value) };
}

function normalizeRow(row) {
  const kind = oneOf(row?.kind, ROW_KINDS, null);
  const base = { id: typeof row?.id === "string" ? row.id : null, kind, source: row?.source === "auto" ? "auto" : "user" };
  if (kind === "STRAIGHT") return { ...base, vertical: oneOf(row.vertical, VERTICALS, "LEVEL"), end: normalizeEnd(row.end, STRAIGHT_ENDS) };
  if (kind === "TURN") {
    return {
      ...base,
      direction: oneOf(row.direction, DIRECTIONS, null),
      driverKind: oneOf(row.driverKind, DRIVER_KINDS, "G"),
      driverValue: numberOrNull(row.driverValue),
      end: normalizeEnd(row.end, TURN_ENDS),
    };
  }
  if (kind === "TARGET_ARC") {
    return {
      ...base,
      radiusNm: numberOrNull(row.radiusNm),
      direction: oneOf(row.direction, DIRECTIONS, null),
      end: normalizeEnd(row.end, ARC_ENDS),
      entry: row.entry === "DIRECT" ? "DIRECT" : "AUTO",
      gLimit: numberOrNull(row.gLimit),
    };
  }
  return { ...base, kind: row?.kind ?? null };
}

function normalizeSettings(settings) {
  const fallback = defaultSettings();
  return {
    semEnd: oneOf(settings?.semEnd, SEM_ENDS, fallback.semEnd),
    levelOffG: numberOrNull(settings?.levelOffG ?? fallback.levelOffG),
    turnDriverKind: oneOf(settings?.turnDriverKind, DRIVER_KINDS, fallback.turnDriverKind),
    turnDriverValue: numberOrNull(settings?.turnDriverValue ?? fallback.turnDriverValue),
    drawDirection: oneOf(settings?.drawDirection, ["AUTO", ...DIRECTIONS], fallback.drawDirection),
    drawVertical: oneOf(settings?.drawVertical, VERTICALS, fallback.drawVertical),
    drawHeadingDeg: numberOrNull(settings?.drawHeadingDeg ?? fallback.drawHeadingDeg),
  };
}

// Any stored / older / partial plan becomes a complete plan; unknown keys are dropped, values kept.
export function normalizeSemRejoinPlan(raw) {
  const plan = createDefaultSemRejoinPlan();
  if (!raw || typeof raw !== "object") return plan;
  let maxId = 0;
  for (const number of AIRCRAFT) {
    const source = raw.aircraft?.[number];
    const rows = Array.isArray(source?.rows) ? source.rows.map(normalizeRow) : [];
    for (const row of rows) {
      const id = Number(/^r(\d+)$/.exec(row.id ?? "")?.[1]);
      if (Number.isInteger(id)) maxId = Math.max(maxId, id);
    }
    plan.aircraft[number] = { rows, settings: normalizeSettings(source?.settings) };
  }
  // Rows without a usable id get one; ids never change once given.
  let nextRowId = Math.max(Number.isInteger(raw.nextRowId) ? raw.nextRowId : 1, maxId + 1);
  for (const number of AIRCRAFT) {
    for (const row of plan.aircraft[number].rows) if (!row.id) row.id = `r${nextRowId++}`;
  }
  plan.nextRowId = nextRowId;
  plan.egress = {
    headingDeg: numberOrNull(raw.egress?.headingDeg ?? null),
    speedKcas: numberOrNull(raw.egress?.speedKcas ?? null),
    altitudeMslFt: numberOrNull(raw.egress?.altitudeMslFt ?? null),
  };
  for (const number of [2, 3, 4]) {
    const slot = raw.formation?.[number];
    plan.formation[number] = {
      preset: oneOf(slot?.preset, PRESETS, null),
      side: oneOf(slot?.side, DIRECTIONS, null),
      bearingDeg: numberOrNull(slot?.bearingDeg ?? null),
      rangeNm: numberOrNull(slot?.rangeNm ?? null),
    };
  }
  plan.tolerance = {
    positionNm: numberOrNull(raw.tolerance?.positionNm ?? null),
    headingDeg: numberOrNull(raw.tolerance?.headingDeg ?? null),
    altitudeFt: numberOrNull(raw.tolerance?.altitudeFt ?? null),
    relativeSpeedKt: numberOrNull(raw.tolerance?.relativeSpeedKt ?? null),
  };
  plan.runInTurnDeg = isFiniteNumber(raw.runInTurnDeg) ? raw.runInTurnDeg : null;
  return plan;
}

// The Offset Run-In turn (owner 2026-10-22, AG Offset SPEC "Run-In turn"): a Run-In edit turns the whole
// attack about the Target, so the plan's absolute directions turn with it by the change of the Flight's
// state.runInTurnDeg since the plan was last aligned: a Turn's HEADING end, a Target Arc's END_RADIAL and
// HEADING ends, every aircraft's draw heading and the Egress Heading. Relative values (Heading Change,
// Arc Angle, the egress formation bearings) and the true wind do not turn. A plan without an alignment
// (new or older) takes the current one as it is.
const TURNED_ENDS = Object.freeze({ TURN: ["HEADING"], TARGET_ARC: ["END_RADIAL", "HEADING"] });
function alignPlanToRunInTurn(plan, runInTurnDeg) {
  if (!isFiniteNumber(runInTurnDeg)) return 0;
  const deltaDeg = isFiniteNumber(plan.runInTurnDeg) ? runInTurnDeg - plan.runInTurnDeg : 0;
  plan.runInTurnDeg = runInTurnDeg;
  if (deltaDeg === 0) return 0;
  const turn = (value) => (isFiniteNumber(value) ? ((value + deltaDeg) % 360 + 360) % 360 : value);
  for (const number of AIRCRAFT) {
    for (const row of plan.aircraft[number].rows) {
      if (TURNED_ENDS[row.kind]?.includes(row.end?.kind)) row.end.value = turn(row.end.value);
    }
    plan.aircraft[number].settings.drawHeadingDeg = turn(plan.aircraft[number].settings.drawHeadingDeg);
  }
  plan.egress.headingDeg = turn(plan.egress.headingDeg);
  return deltaDeg;
}

// ---- upstream (Offset Flight result) ------------------------------------------------------------

function pickPoint(point) {
  return point && isFiniteNumber(point.x) && isFiniteNumber(point.y) ? { x: point.x, y: point.y } : null;
}

// Selects, from one Full Offset result, exactly what the S&R calculation reads (the Offset clock legs
// for offsetTimeline, the Release state, the SEM settings and the Offset turn condition). Plain data.
function offsetResultView(result) {
  const points = result?.geometry?.points ?? {};
  const profile = result?.profile ?? {};
  return {
    state: result?.state ?? null,
    resolved: {
      attackHeadingDeg: result?.resolved?.attackHeadingDeg ?? null,
      runInHeadingDeg: result?.resolved?.runInHeadingDeg ?? null,
      offsetG: result?.resolved?.offsetG ?? null,
      offsetBankDeg: result?.resolved?.offsetBankDeg ?? null,
    },
    timing: {
      ingressSec: result?.timing?.ingressSec ?? null,
      offsetTurnSec: result?.timing?.offsetTurnSec ?? null,
      approachSec: result?.timing?.approachSec ?? null,
      offsetIpToReleaseSec: result?.timing?.offsetIpToReleaseSec ?? null,
    },
    geometry: {
      points: {
        ip: pickPoint(points.ip), realActionPoint: pickPoint(points.realActionPoint), turnEnd: pickPoint(points.turnEnd),
        offsetCenter: pickPoint(points.offsetCenter), rollStart: pickPoint(points.rollStart), trackPoint: pickPoint(points.trackPoint),
        target: pickPoint(points.target),
      },
      direction: { offsetDirection: result?.geometry?.direction?.offsetDirection ?? null },
      rollInTrajectorySamples: (result?.geometry?.rollInTrajectorySamples ?? []).map(pickPoint).filter(Boolean),
      // Onset Offset turn (offset-be-v0.2 0.2.11): the flown samples with their times, for the Offset clock.
      offsetTurnPath: (result?.geometry?.offsetTurnPath ?? []).map((sample) => (pickPoint(sample) && isFiniteNumber(sample.tSec) ? { ...pickPoint(sample), tSec: sample.tSec } : null)).filter(Boolean),
    },
    profile: {
      public: {
        rollInTimeSec: profile.public?.rollInTimeSec ?? null,
        trackingTimeSec: profile.public?.trackingTimeSec ?? null,
        downRangeTravelNm: profile.public?.downRangeTravelNm ?? null,
        bombTofSec: profile.public?.bombTofSec ?? null,
        effectiveReleaseAltitudeMslFt: profile.public?.effectiveReleaseAltitudeMslFt ?? null,
        // The BDP's selected SEM (BDP v0.4.2, owner handoff §6.5): the record and its flown samples to the
        // level-off (LEVEL) or the CSEM End (CLIMB). S&R starts from this state.
        semMinimumAltitudeMslFt: profile.public?.semMinimumAltitudeMslFt ?? null,
        sem: profile.public?.sem ? JSON.parse(JSON.stringify(profile.public.sem)) : null,
      },
      visualization: {
        // The flown SEM to the level-off / CSEM End, and the Level SEM turn after it (BDP v0.4.3); not the level carry.
        semPathSamples: (profile.visualization?.semPathSamples ?? []).filter((sample) => sample.phase === "pull" || sample.phase === "relax" || sample.phase.startsWith("turn-"))
          .map(({ timeSec, downRangeNm, crossRangeNm = 0, headingChangeDeg = 0, bankDeg = 0, altitudeMslFt, fpaDeg, tasKt, loadFactorG, phase }) => ({ timeSec, downRangeNm, crossRangeNm, headingChangeDeg, bankDeg, altitudeMslFt, fpaDeg, tasKt, loadFactorG, phase })),
      },
      canonicalInputs: {
        semEnd: profile.canonicalInputs?.semEnd ?? "LEVEL",
        csemTargetFpaDeg: profile.canonicalInputs?.csemTargetFpaDeg ?? null,
        speedOvershootKcas: profile.canonicalInputs?.speedOvershootKcas ?? null,
        releaseSpeedKcas: profile.canonicalInputs?.releaseSpeedKcas ?? null,
        diveAngleDeg: profile.canonicalInputs?.diveAngleDeg ?? null,
        recoveryG: profile.canonicalInputs?.recoveryG ?? null,
        gOnsetTimeSec: profile.canonicalInputs?.gOnsetTimeSec ?? null,
      },
      diagnostics: {
        releaseTasKt: profile.diagnostics?.releaseTasKt ?? null,
        releaseGroundVelocityFps: profile.diagnostics?.releaseGroundVelocityFps
          ? { along: profile.diagnostics.releaseGroundVelocityFps.along, down: profile.diagnostics.releaseGroundVelocityFps.down }
          : null,
        nltSupported: profile.diagnostics?.nltSupported ?? null,
      },
    },
  };
}

// The S&R upstream: the Offset Flight answer (Full) and the input it answered. The wind is #1's
// (Flight-shared, AG Offset SPEC "Flight entrypoint"). Called on each adopted Offset answer; it
// selects data and calculates nothing.
export function semRejoinUpstreamView({ flightInput, flightOutput }) {
  const lead = flightInput?.aircraft?.[1]?.values ?? {};
  const flightSize = Math.min(4, Math.max(1, Number(flightOutput?.nextInput?.flightSize ?? flightInput?.flightSize ?? 1) || 1));
  const aircraft = {};
  for (let number = 1; number <= flightSize; number += 1) {
    const entry = flightOutput?.aircraftResults?.[number];
    aircraft[number] = {
      status: entry?.status ?? "FAILED",
      error: entry?.error ?? (entry ? null : `Aircraft #${number} has no current result`),
      elementLead: elementLeadOf(number),
      result: entry?.result ? offsetResultView(entry.result) : null,
    };
  }
  // The Flight's added-up Run-In turn (Offset Flight 0.1.7) after the answered edits.
  const runInTurnDeg = flightOutput?.nextInput?.aircraft?.[1]?.state?.runInTurnDeg ?? flightInput?.aircraft?.[1]?.state?.runInTurnDeg;
  return {
    schemaVersion: 1,
    flightSize,
    wind: { fromTrueDeg: isFiniteNumber(lead.windDirectionDeg) ? lead.windDirectionDeg : 0, speedKt: isFiniteNumber(lead.windSpeedKt) ? lead.windSpeedKt : 0 },
    runInTurnDeg: isFiniteNumber(runInTurnDeg) ? runInTurnDeg : null,
    aircraft,
  };
}

// Air-mass velocity of the wind (kt, x east / y north): the air moves toward FROM + 180.
function windVector(wind) {
  const speed = isFiniteNumber(wind?.speedKt) ? wind.speedKt : 0;
  return mul(vecHeading((isFiniteNumber(wind?.fromTrueDeg) ? wind.fromTrueDeg : 0) + 180), speed);
}

// ---- states ------------------------------------------------------------------------------------

function makeState({ timeSec, x, y, altitudeMslFt, tasKt, headingDeg, fpaDeg }) {
  return { timeSec, x, y, altitudeMslFt, tasKt, headingDeg: norm360(headingDeg), fpaDeg };
}

// Display / evaluation quantities of a state (ground velocity in kt, KCAS from Common airspeed).
function describeState(state, windKt) {
  if (!state) return null;
  const air = mul(vecHeading(state.headingDeg), state.tasKt * Math.cos(state.fpaDeg * DEG));
  const ground = add(air, windKt);
  return {
    ...state,
    kcas: tasToCas(Math.max(state.tasKt, 1e-6), state.altitudeMslFt),
    groundVelocityKt: ground,
    groundSpeedKt: len(ground),
    trackDeg: len(ground) > 1e-9 ? headingOf(ground) : state.headingDeg,
  };
}

function samplePoint(state) {
  return { t: state.timeSec, x: state.x, y: state.y, altitudeMslFt: state.altitudeMslFt, tasKt: state.tasKt, headingDeg: state.headingDeg, fpaDeg: state.fpaDeg };
}

// ---- Release and SEM ---------------------------------------------------------------------------

function releaseOf(view) {
  const timeline = offsetTimeline(view);
  const attackHeadingDeg = view.resolved.attackHeadingDeg;
  const samples = [];
  for (const leg of timeline.legs) {
    if (leg.phase === "bomb") break;
    leg.points.forEach((point, index) => {
      const t = leg.startSec + leg.times[index];
      if (!samples.length || t > samples[samples.length - 1].t + 1e-9 || Math.hypot(point.x - samples[samples.length - 1].x, point.y - samples[samples.length - 1].y) > 1e-9) samples.push({ t, x: point.x, y: point.y });
    });
  }
  return { timeline, timeSec: timeline.releaseSec, point: { ...timeline.release }, attackHeadingDeg, attackSamples: samples };
}

// Release → SEM End on the IP clock (owner handoff 2026-10-18 §6.5): the BDP's selected SEM (BDP v0.4.2 public.sem
// and its samples) — LEVEL: the recovery pull to FPA 0° (1 G level flight follows); CLIMB: the CSEM to its Target
// FPA — from Release + Overshoot, on the attack ground track as the BDP flies it. S&R calculates no SEM of its own;
// its rows start from the BDP's SEM End. The air heading (for the rows after it) is the Release state's,
// reconstructed from BDP's ground-referenced release velocity (BDP SPEC §8).
const BDP_SEM_ASSUMPTIONS = Object.freeze([
  "BDP_SEM: the SEM is the BDP's selected SEM (sem-fragment 0.1.1) from Release + Overshoot on the attack ground track",
  "WINGS_LEVEL_POINT_MASS: no thrust / drag; speed changes only with height",
]);

function computeSem(view, windKt) {
  const release = releaseOf(view);
  const profile = view.profile;
  const semEnd = profile.canonicalInputs.semEnd ?? "LEVEL";
  const input = {
    releaseAltitudeMslFt: profile.public.effectiveReleaseAltitudeMslFt,
    releaseSpeedKcas: profile.canonicalInputs.releaseSpeedKcas,
    speedOvershootKcas: profile.canonicalInputs.speedOvershootKcas,
    recoveryG: profile.canonicalInputs.recoveryG,
    gOnsetTimeSec: profile.canonicalInputs.gOnsetTimeSec,
    semEnd,
    csemTargetFpaDeg: semEnd === "CLIMB" ? profile.canonicalInputs.csemTargetFpaDeg : null,
  };
  const base = { release: { timeSec: release.timeSec, point: release.point, attackHeadingDeg: release.attackHeadingDeg }, inputs: input };
  if (profile.diagnostics.nltSupported !== true) {
    return { ...base, status: "UNSUPPORTED", errors: ["SEM is not available below Dive Angle 10° (BDP MINALT-only delivery, BDP SPEC §6.2)"], warnings: [] };
  }
  if (!(profile.canonicalInputs.diveAngleDeg > 0)) {
    return { ...base, status: "UNSUPPORTED", errors: ["SEM is not available at Dive Angle 0° (level delivery: no recovery)"], warnings: [] };
  }
  if (isFiniteNumber(profile.public.trackingTimeSec) && profile.public.trackingTimeSec < 0) {
    return { ...base, status: "UNSUPPORTED", errors: ["Negative Tracking Time: the BDP Release state is an altitude shortfall, not a flown state"], warnings: [] };
  }
  const groundVelocity = profile.diagnostics.releaseGroundVelocityFps;
  if (!groundVelocity || !isFiniteNumber(groundVelocity.along) || !isFiniteNumber(groundVelocity.down) || !isFiniteNumber(release.attackHeadingDeg)) {
    return { ...base, status: "INVALID", errors: ["BDP release velocity is not available"], warnings: [] };
  }
  // Air velocity = ground velocity − wind (BDP builds |ground − wind| = release TAS).
  const groundHorizontalKt = mul(vecHeading(release.attackHeadingDeg), groundVelocity.along / KT_TO_FPS);
  const airHorizontalKt = sub(groundHorizontalKt, windKt);
  const verticalKt = -groundVelocity.down / KT_TO_FPS;
  const airHeadingDeg = headingOf(airHorizontalKt);
  const releaseFpaDeg = Math.atan2(verticalKt, len(airHorizontalKt)) / DEG;
  const bdpSem = profile.public.sem;
  if (!bdpSem || bdpSem.status !== "VALID") {
    return { ...base, status: "INVALID", errors: (bdpSem?.errors?.length ? bdpSem.errors : ["the BDP SEM is not available"]).map((code) => `SEM: ${code}`), warnings: [], airHeadingDeg, releaseFpaDeg };
  }
  const flown = profile.visualization?.semPathSamples ?? [];
  if (flown.length < 2) return { ...base, status: "INVALID", errors: ["SEM: the BDP SEM path is empty"], warnings: [], airHeadingDeg, releaseFpaDeg };
  const attack = vecHeading(release.attackHeadingDeg);
  // Cross range: + = right of the Attack Heading (BDP SPEC §6.6 / §6.8).
  const right = vecHeading(release.attackHeadingDeg + 90);
  const samples = flown.map((sample) => ({
    t: release.timeSec + sample.timeSec,
    x: release.point.x + attack.x * sample.downRangeNm + right.x * (sample.crossRangeNm ?? 0),
    y: release.point.y + attack.y * sample.downRangeNm + right.y * (sample.crossRangeNm ?? 0),
    altitudeMslFt: sample.altitudeMslFt,
    tasKt: sample.tasKt,
    headingDeg: norm360(airHeadingDeg + (sample.headingChangeDeg ?? 0)),
    fpaDeg: sample.fpaDeg,
    loadFactorG: sample.loadFactorG,
  }));
  const last = samples[samples.length - 1];
  return {
    ...base,
    status: "VALID",
    errors: [],
    warnings: [...(bdpSem.warnings ?? [])],
    end: semEnd,
    model: { ...bdpSem.model, semEnd },
    assumptions: [...BDP_SEM_ASSUMPTIONS, ...(bdpSem.assumptions ?? [])],
    bdpSem,
    airHeadingDeg,
    releaseFpaDeg,
    durationSec: last.t - release.timeSec,
    minAltitudeMslFt: profile.public.semMinimumAltitudeMslFt,
    terminationSpeedKcas: tasToCas(last.tasKt, last.altitudeMslFt),
    samples,
    startState: makeState({ timeSec: samples[0].t, x: samples[0].x, y: samples[0].y, altitudeMslFt: samples[0].altitudeMslFt, tasKt: samples[0].tasKt, headingDeg: airHeadingDeg, fpaDeg: samples[0].fpaDeg }),
    endState: makeState({ timeSec: last.t, x: last.x, y: last.y, altitudeMslFt: last.altitudeMslFt, tasKt: last.tasKt, headingDeg: last.headingDeg, fpaDeg: last.fpaDeg }),
  };
}

// ---- wings-level vertical-plane integration (level-off and constant-FPA climbs) -----------------

// Energy-neutral point mass, wings level, constant air heading. y = { v (fps), gamma (rad),
// h (ft), s (air horizontal ft), l (ground path ft) }; load factor from `loadOf(gamma)`.
function verticalDerivative(y, loadFactor, headingUnit, windFps) {
  const horizontal = y.v * Math.cos(y.gamma);
  const ground = { x: headingUnit.x * horizontal + windFps.x, y: headingUnit.y * horizontal + windFps.y };
  return {
    v: -G_FTPS2 * Math.sin(y.gamma),
    gamma: (G_FTPS2 / y.v) * (loadFactor(y.gamma) - Math.cos(y.gamma)),
    h: y.v * Math.sin(y.gamma),
    s: horizontal,
    l: Math.hypot(ground.x, ground.y),
  };
}
function rk4(y, dt, loadFactor, headingUnit, windFps) {
  const step = (base, k, f) => ({ v: base.v + k.v * f, gamma: base.gamma + k.gamma * f, h: base.h + k.h * f, s: base.s + k.s * f, l: base.l + k.l * f });
  const k1 = verticalDerivative(y, loadFactor, headingUnit, windFps);
  const k2 = verticalDerivative(step(y, k1, dt / 2), loadFactor, headingUnit, windFps);
  const k3 = verticalDerivative(step(y, k2, dt / 2), loadFactor, headingUnit, windFps);
  const k4 = verticalDerivative(step(y, k3, dt), loadFactor, headingUnit, windFps);
  const combine = (key) => y[key] + (dt / 6) * (k1[key] + 2 * k2[key] + 2 * k3[key] + k4[key]);
  return { v: combine("v"), gamma: combine("gamma"), h: combine("h"), s: combine("s"), l: combine("l") };
}

// Integrates from `start` until `stopValue(y, tSec)` <= 0 (located in the step by bisection), or the
// time limit. Returns { end (state), y, elapsedSec, groundDistanceNm, reason, samples }.
function integrateVertical(start, { loadFactor, windKt, stops, maxSec }) {
  const dt = SEM_REJOIN_V0_1.model.integrationStepSec;
  const headingUnit = vecHeading(start.headingDeg);
  const windFps = mul(windKt, KT_TO_FPS);
  let y = { v: start.tasKt * KT_TO_FPS, gamma: start.fpaDeg * DEG, h: start.altitudeMslFt, s: 0, l: 0 };
  let elapsed = 0;
  const toState = (yy, tt) => {
    const air = mul(headingUnit, yy.s / FT_PER_NM);
    const drift = mul(windKt, tt * NM_PER_KT_SEC);
    return makeState({ timeSec: start.timeSec + tt, x: start.x + air.x + drift.x, y: start.y + air.y + drift.y, altitudeMslFt: yy.h, tasKt: yy.v / KT_TO_FPS, headingDeg: start.headingDeg, fpaDeg: yy.gamma / DEG });
  };
  const samples = [samplePoint(toState(y, 0))];
  const firstStop = (yy, tt) => {
    for (const stop of stops) if (stop.value(yy, tt) <= 0) return stop;
    return null;
  };
  const immediate = firstStop(y, 0);
  if (immediate) return { end: toState(y, 0), y, elapsedSec: 0, groundDistanceNm: 0, reason: immediate.reason, samples };
  let stepIndex = 0;
  while (elapsed < maxSec - 1e-12) {
    const h = Math.min(dt, maxSec - elapsed);
    const next = rk4(y, h, loadFactor, headingUnit, windFps);
    const nextT = elapsed + h;
    if (!(next.v > 0) || !Object.values(next).every(Number.isFinite)) {
      // Energy runs out inside this step: locate v = 0 and report it.
      let low = 0, high = h;
      for (let i = 0; i < 60; i += 1) {
        const mid = (low + high) / 2;
        const trial = rk4(y, mid, loadFactor, headingUnit, windFps);
        if (trial.v > 0 && Object.values(trial).every(Number.isFinite)) low = mid;
        else high = mid;
      }
      const atLimit = low > 0 ? rk4(y, low, loadFactor, headingUnit, windFps) : y;
      const end = toState(atLimit, elapsed + low);
      samples.push(samplePoint(end));
      return { end, y: atLimit, elapsedSec: elapsed + low, groundDistanceNm: atLimit.l / FT_PER_NM, reason: "ENERGY_EXHAUSTED", samples };
    }
    const stop = firstStop(next, nextT);
    if (stop) {
      // Bisection on the fraction of this step where the stop value reaches zero.
      let low = 0, high = h;
      for (let i = 0; i < 60; i += 1) {
        const mid = (low + high) / 2;
        const trial = rk4(y, mid, loadFactor, headingUnit, windFps);
        if (stop.value(trial, elapsed + mid) <= 0) high = mid;
        else low = mid;
      }
      const at = rk4(y, high, loadFactor, headingUnit, windFps);
      const end = toState(at, elapsed + high);
      samples.push(samplePoint(end));
      return { end, y: at, elapsedSec: elapsed + high, groundDistanceNm: at.l / FT_PER_NM, reason: stop.reason, samples };
    }
    y = next;
    elapsed = nextT;
    stepIndex += 1;
    if (stepIndex % 10 === 0) samples.push(samplePoint(toState(y, elapsed)));
  }
  const end = toState(y, elapsed);
  if (samples[samples.length - 1].t < end.timeSec - 1e-12) samples.push(samplePoint(end));
  return { end, y, elapsedSec: elapsed, groundDistanceNm: y.l / FT_PER_NM, reason: "TIME_LIMIT", samples };
}

// ---- level primitives (exact) ------------------------------------------------------------------

function groundVelocityLevel(state, windKt) {
  return add(mul(vecHeading(state.headingDeg), state.tasKt), windKt);
}

function levelStraight(start, durationSec, windKt) {
  const ground = groundVelocityLevel(start, windKt);
  const end = makeState({ ...start, timeSec: start.timeSec + durationSec, x: start.x + ground.x * durationSec * NM_PER_KT_SEC, y: start.y + ground.y * durationSec * NM_PER_KT_SEC, fpaDeg: 0 });
  return { end, samples: [samplePoint(start), samplePoint(end)], groundDistanceNm: len(ground) * durationSec * NM_PER_KT_SEC };
}

// Coordinated level turn: heading rate g·tan(bank)/V (Common radius V²/(g·tan bank) at FPA 0).
function levelTurnPosition(start, sign, omegaRadSec, tau, windKt) {
  const v = start.tasKt * NM_PER_KT_SEC;
  const psi0 = start.headingDeg * DEG;
  const psi = psi0 + sign * omegaRadSec * tau;
  const k = v / (sign * omegaRadSec);
  return {
    x: start.x + k * (Math.cos(psi0) - Math.cos(psi)) + windKt.x * tau * NM_PER_KT_SEC,
    y: start.y + k * (Math.sin(psi) - Math.sin(psi0)) + windKt.y * tau * NM_PER_KT_SEC,
    headingDeg: norm360(psi / DEG),
  };
}

function turnRateRadSec(state, bankDeg) {
  return (G_FTPS2 * Math.tan(bankDeg * DEG)) / (state.tasKt * KT_TO_FPS);
}

// End state only (the Arc entry solver evaluates many candidate turns).
function levelTurnEnd(start, { direction, bankDeg, headingChangeDeg }, windKt) {
  const sign = direction === "RIGHT" ? 1 : -1;
  const omega = turnRateRadSec(start, bankDeg);
  const durationSec = (headingChangeDeg * DEG) / omega;
  const point = levelTurnPosition(start, sign, omega, durationSec, windKt);
  return { end: makeState({ ...start, timeSec: start.timeSec + durationSec, x: point.x, y: point.y, headingDeg: norm360(start.headingDeg + sign * headingChangeDeg), fpaDeg: 0 }), durationSec };
}

function levelTurn(start, { direction, bankDeg, headingChangeDeg }, windKt) {
  const sign = direction === "RIGHT" ? 1 : -1;
  const omega = turnRateRadSec(start, bankDeg);
  const durationSec = (headingChangeDeg * DEG) / omega;
  const steps = Math.max(1, Math.ceil(headingChangeDeg / SEM_REJOIN_V0_1.sampleDeg));
  const samples = [];
  let groundDistanceNm = 0;
  let previous = null;
  for (let index = 0; index <= steps; index += 1) {
    const tau = (durationSec * index) / steps;
    const point = levelTurnPosition(start, sign, omega, tau, windKt);
    const state = makeState({ ...start, timeSec: start.timeSec + tau, x: point.x, y: point.y, headingDeg: point.headingDeg, fpaDeg: 0 });
    if (previous) groundDistanceNm += Math.hypot(state.x - previous.x, state.y - previous.y);
    samples.push(samplePoint(state));
    previous = state;
  }
  const endPoint = levelTurnPosition(start, sign, omega, durationSec, windKt);
  const end = makeState({ ...start, timeSec: start.timeSec + durationSec, x: endPoint.x, y: endPoint.y, headingDeg: norm360(start.headingDeg + sign * headingChangeDeg), fpaDeg: 0 });
  return { end, samples, durationSec, groundDistanceNm, omegaDegSec: omega / DEG };
}

// ---- rows --------------------------------------------------------------------------------------

function rowSummaryDefaults() {
  return { groundDistanceNm: null, headingChangeDeg: null, bankDeg: null, loadFactorG: null, radiusNm: null, levelOffSec: null, levelOffAltitudeGainFt: null };
}

function rowFailure(row, status, errors, start = null, extra = {}) {
  return { id: row.id, kind: row.kind, source: row.source, definition: definitionOf(row), status, errors, warnings: [], start, end: null, samples: start ? [samplePoint(start)] : [], summary: rowSummaryDefaults(), ...extra };
}

// The row's own conditions as computed (plan rows and derived Arc entry rows alike).
function definitionOf(row) {
  const { id, source, ...definition } = row;
  return clone(definition);
}

function resolveTurnBank(driverKind, driverValue) {
  if (!isFiniteNumber(driverValue)) return { error: `${driverKind === "BANK" ? "Bank" : "G"} required` };
  if (driverKind === "BANK") {
    if (!(driverValue > 0 && driverValue < 90)) return { error: "Bank must be between 0° and 90°" };
    return { bankDeg: driverValue, loadFactorG: loadFactorFromBankAndFpa(driverValue, 0) };
  }
  if (!(driverValue > 1)) return { error: "G must be above 1.0 for a level turn" };
  return { bankDeg: bankAngleDegFromLoadFactorAndFpa(driverValue, 0), loadFactorG: driverValue };
}

// Level-off at the start of a LEVEL row: wings-level push at the Level-off G until FPA 0.
function levelOffStops(extraStops) {
  return [{ reason: "LEVEL", value: (y) => y.gamma }, ...extraStops];
}
function levelOffLoad(levelOffG) {
  return () => levelOffG;
}
function checkLevelOffG(levelOffG, start) {
  if (!isFiniteNumber(levelOffG)) return "Level-off G required to level off from the climb (no approved default)";
  const limit = Math.cos(start.fpaDeg * DEG);
  if (!(levelOffG >= 0 && levelOffG < limit)) return `Level-off G must be at least 0 and below ${limit.toFixed(2)} G (level flight at the current FPA)`;
  return null;
}

function computeStraight(row, start, ctx) {
  const end = row.end;
  if (!isFiniteNumber(end.value)) return rowFailure(row, "DRAFT", [`${endLabel(end.kind)} required`], start);
  if (end.kind === "TIME" && !(end.value > 0)) return rowFailure(row, "INVALID", ["Time must be above 0 s"], start);
  if (end.kind === "DISTANCE" && !(end.value > 0)) return rowFailure(row, "INVALID", ["Distance must be above 0 NM"], start);
  if (end.kind === "SPEED" && !(end.value > 0)) return rowFailure(row, "INVALID", ["Target Speed must be above 0 KCAS"], start);
  const windKt = ctx.windKt;
  const samples = [samplePoint(start)];
  const summary = rowSummaryDefaults();
  let state = start;
  let groundNm = 0;
  let elapsed = 0;
  const climbing = start.fpaDeg > 1e-9;
  if (start.fpaDeg < -1e-9) return rowFailure(row, "UNSUPPORTED", ["A descending start is not modelled in v0.1"], start);
  const reached = (reason) => reason === end.kind;
  // Stop values in this row's terms (t, distance from the row start).
  const stopFor = (offsetSec, offsetNm) => {
    if (end.kind === "TIME") return { reason: "TIME", value: (y, t) => end.value - (offsetSec + t) };
    if (end.kind === "DISTANCE") return { reason: "DISTANCE", value: (y) => end.value - (offsetNm + y.l / FT_PER_NM) };
    if (end.kind === "ALTITUDE") return { reason: "ALTITUDE", value: (y) => end.value - y.h };
    return { reason: "SPEED", value: (y) => tasToCas(Math.max(y.v / KT_TO_FPS, 1e-6), y.h) - end.value };
  };
  if (row.vertical === "LEVEL" && climbing) {
    const problem = checkLevelOffG(ctx.levelOffG, start);
    if (problem) return rowFailure(row, "DRAFT", [problem], start);
    const push = integrateVertical(start, { loadFactor: levelOffLoad(ctx.levelOffG), windKt, stops: levelOffStops(end.kind === "TIME" || end.kind === "DISTANCE" ? [stopFor(0, 0)] : []), maxSec: SEM_REJOIN_V0_1.maxLevelOffSec });
    samples.push(...push.samples.slice(1));
    summary.levelOffSec = push.elapsedSec;
    summary.levelOffAltitudeGainFt = push.end.altitudeMslFt - start.altitudeMslFt;
    state = push.end;
    groundNm = push.groundDistanceNm;
    elapsed = push.elapsedSec;
    if (push.reason === "ENERGY_EXHAUSTED" || push.reason === "TIME_LIMIT") {
      return { ...rowFailure(row, "INVALID", [push.reason === "ENERGY_EXHAUSTED" ? "Speed reaches zero during the level-off" : "Level-off does not reach level flight"], start), samples };
    }
    if (reached(push.reason)) return finishRow(row, start, state, samples, { ...summary, groundDistanceNm: groundNm });
    state = makeState({ ...state, fpaDeg: 0 });
  }
  if (state.fpaDeg <= 1e-9) {
    // Level straight: TAS constant in this model, so Time / Distance are exact; Altitude and Speed
    // cannot be reached in level flight without a Power provider.
    if (end.kind === "ALTITUDE" || end.kind === "SPEED") {
      return { ...rowFailure(row, "UNSUPPORTED", [end.kind === "ALTITUDE" ? "Target Altitude needs a climb: set Vertical to Hold FPA while climbing" : "Target Speed in level flight needs a thrust / drag (Power) provider, which is not connected"], start), samples };
    }
    const groundSpeedKt = len(groundVelocityLevel(state, windKt));
    const remainingSec = end.kind === "TIME" ? end.value - elapsed : (end.value - groundNm) / (groundSpeedKt * NM_PER_KT_SEC);
    if (!(remainingSec >= 0) || !Number.isFinite(remainingSec)) return { ...rowFailure(row, "INVALID", ["Straight cannot reach its end condition"], start), samples };
    if (remainingSec > SEM_REJOIN_V0_1.maxRowSec) return { ...rowFailure(row, "INVALID", [`Straight longer than ${SEM_REJOIN_V0_1.maxRowSec} s`], start), samples };
    const flown = levelStraight(makeState({ ...state, fpaDeg: 0 }), remainingSec, windKt);
    samples.push(...flown.samples.slice(1));
    return finishRow(row, start, flown.end, samples, { ...summary, groundDistanceNm: groundNm + flown.groundDistanceNm });
  }
  // HOLD_FPA climb: constant FPA (load factor cos FPA), speed falls with height.
  if (end.kind === "ALTITUDE" && !(end.value > state.altitudeMslFt)) return rowFailure(row, "UNSUPPORTED", ["Target Altitude must be above the current altitude while climbing"], start);
  if (end.kind === "SPEED" && !(end.value < describeState(state, windKt).kcas)) return rowFailure(row, "UNSUPPORTED", ["Target Speed above the current speed needs a thrust / drag (Power) provider"], start);
  const climb = integrateVertical(state, { loadFactor: (gamma) => Math.cos(gamma), windKt, stops: [stopFor(elapsed, groundNm)], maxSec: SEM_REJOIN_V0_1.maxRowSec });
  samples.push(...climb.samples.slice(1));
  if (climb.reason === "ENERGY_EXHAUSTED") return { ...rowFailure(row, "INVALID", ["Speed reaches zero before the end condition (climb at constant FPA)"], start), samples };
  if (climb.reason === "TIME_LIMIT") return { ...rowFailure(row, "INVALID", [`Straight longer than ${SEM_REJOIN_V0_1.maxRowSec} s`], start), samples };
  return finishRow(row, start, climb.end, samples, { ...summary, groundDistanceNm: groundNm + climb.groundDistanceNm });
}

function finishRow(row, start, end, samples, summary, extra = {}) {
  return { id: row.id, kind: row.kind, source: row.source, definition: definitionOf(row), status: "VALID", errors: [], warnings: [], start, end, samples, summary, ...extra };
}

function endLabel(kind) {
  return {
    TIME: "Time", DISTANCE: "Distance", ALTITUDE: "Target Altitude", SPEED: "Target Speed",
    HEADING: "Heading", HEADING_CHANGE: "Heading Change", ARC_ANGLE: "Arc Angle", END_RADIAL: "End Radial",
  }[kind] ?? kind;
}

// Heading change from `fromDeg` to `toDeg` turning `direction`, in (0, 360]; 0 when equal.
export function headingChangeDeg(fromDeg, toDeg, direction) {
  const raw = direction === "RIGHT" ? norm360(toDeg - fromDeg) : norm360(fromDeg - toDeg);
  return raw < 1e-9 || raw > 360 - 1e-9 ? 0 : raw;
}

// Level-off (when climbing) then the level turn.
function computeTurn(row, start, ctx, driver) {
  if (!row.direction) return rowFailure(row, "DRAFT", ["Direction (Left / Right) required"], start);
  if (!isFiniteNumber(row.end.value)) return rowFailure(row, "DRAFT", [`${endLabel(row.end.kind)} required`], start);
  const bank = resolveTurnBank(driver.kind, driver.value);
  if (bank.error) return rowFailure(row, isFiniteNumber(driver.value) ? "INVALID" : "DRAFT", [bank.error], start);
  if (start.fpaDeg < -1e-9) return rowFailure(row, "UNSUPPORTED", ["A descending start is not modelled in v0.1"], start);
  const windKt = ctx.windKt;
  const samples = [samplePoint(start)];
  const summary = { ...rowSummaryDefaults(), bankDeg: bank.bankDeg, loadFactorG: bank.loadFactorG };
  let state = start;
  let groundNm = 0;
  if (start.fpaDeg > 1e-9) {
    const problem = checkLevelOffG(ctx.levelOffG, start);
    if (problem) return rowFailure(row, "DRAFT", [problem], start);
    const push = integrateVertical(start, { loadFactor: levelOffLoad(ctx.levelOffG), windKt, stops: levelOffStops([]), maxSec: SEM_REJOIN_V0_1.maxLevelOffSec });
    if (push.reason !== "LEVEL") return { ...rowFailure(row, "INVALID", [push.reason === "ENERGY_EXHAUSTED" ? "Speed reaches zero during the level-off" : "Level-off does not reach level flight"], start), samples: [samplePoint(start), ...push.samples.slice(1)] };
    samples.push(...push.samples.slice(1));
    summary.levelOffSec = push.elapsedSec;
    summary.levelOffAltitudeGainFt = push.end.altitudeMslFt - start.altitudeMslFt;
    state = makeState({ ...push.end, fpaDeg: 0 });
    groundNm = push.groundDistanceNm;
  }
  let change;
  if (row.end.kind === "HEADING") {
    change = headingChangeDeg(state.headingDeg, row.end.value, row.direction);
    if (change === 0) return rowFailure(row, "INVALID", ["The Heading equals the current heading: use a Straight, or Heading Change 360° for a full circle"], start);
  } else {
    change = row.end.value;
    if (!(change > 0 && change <= 720)) return rowFailure(row, "INVALID", ["Heading Change must be above 0° and at most 720°"], start);
  }
  const turn = levelTurn(state, { direction: row.direction, bankDeg: bank.bankDeg, headingChangeDeg: change }, windKt);
  samples.push(...turn.samples.slice(1));
  summary.headingChangeDeg = change;
  summary.radiusNm = horizontalTurnRadiusNmFromTasFpaAndBank(state.tasKt, 0, bank.bankDeg);
  summary.groundDistanceNm = groundNm + turn.groundDistanceNm;
  summary.turnRateDegSec = turn.omegaDegSec;
  return finishRow(row, start, turn.end, samples, summary);
}

// ---- Target Arc --------------------------------------------------------------------------------

// Ground-track circle of `radiusNm` around the Target (centre = Target point). Travel direction LEFT =
// counter-clockwise (Target on the left), RIGHT = clockwise. Level, TAS constant; ground speed along
// the tangent from |Vg·t − w| = TAS; the required bank follows from the ground acceleration.
function arcKinematics(center, radiusNm, sign, alpha, theta0, tasKt, windKt) {
  const theta = theta0 + sign * alpha;
  const radial = { x: Math.cos(theta), y: Math.sin(theta) };
  const tangent = mul({ x: -Math.sin(theta), y: Math.cos(theta) }, sign);
  const p = dot(tangent, windKt);
  const q2 = tasKt * tasKt - dot(windKt, windKt) + p * p;
  if (!(q2 > 0)) return null;
  const q = Math.sqrt(q2);
  const vg = p + q;
  if (!(vg > 0)) return null;
  // d/dα of the tangent is −radial (both directions).
  const dp = -dot(radial, windKt);
  const dVgdAlpha = dp * (1 + p / q);
  const dVgdt = (dVgdAlpha * vg) / (radiusNm * 3600); // kt per s
  const centripetal = (vg * vg) / (radiusNm * 3600); // kt per s, toward the centre
  const accel = add(mul(tangent, dVgdt), mul(radial, -centripetal));
  const air = sub(mul(tangent, vg), windKt);
  const accelFps2 = len(accel) * KT_TO_FPS;
  const bankDeg = Math.atan(accelFps2 / G_FTPS2) / DEG;
  return {
    point: add(center, mul(radial, radiusNm)),
    tangent,
    groundSpeedKt: vg,
    headingDeg: headingOf(air),
    bankDeg,
    loadFactorG: Math.sqrt(1 + (accelFps2 / G_FTPS2) ** 2),
    turnSide: cross(air, accel) > 0 ? "LEFT" : "RIGHT",
  };
}

const ARC_STEP_RAD = 0.1 * DEG;

function arcEndAlpha(row, theta0, sign, center, radiusNm, tasKt, windKt) {
  if (row.end.kind === "ARC_ANGLE") {
    if (!(row.end.value > 0 && row.end.value <= 720)) return { error: "Arc Angle must be above 0° and at most 720°" };
    return { alpha: row.end.value * DEG };
  }
  if (row.end.kind === "END_RADIAL") {
    // Target → aircraft true bearing; math angle = 90° − bearing.
    const thetaEnd = (90 - row.end.value) * DEG;
    let alpha = norm360(((thetaEnd - theta0) * sign) / DEG) * DEG;
    if (alpha < 1e-9) alpha = 2 * Math.PI;
    return { alpha };
  }
  // HEADING: the first point along the arc where the aircraft heading reaches the value.
  const target = row.end.value;
  const at = (alpha) => arcKinematics(center, radiusNm, sign, alpha, theta0, tasKt, windKt);
  const start = at(0);
  if (!start) return { error: "Wind is stronger than the airspeed on this arc" };
  let previousDelta = signedHeadingDelta(target, start.headingDeg);
  if (Math.abs(previousDelta) < 1e-9) return { error: "The Heading equals the heading at the arc start: use Arc Angle or End Radial" };
  for (let alpha = ARC_STEP_RAD * 5; alpha <= 2 * Math.PI + 1e-9; alpha += ARC_STEP_RAD * 5) {
    const state = at(alpha);
    if (!state) return { error: "Wind is stronger than the airspeed on this arc" };
    const delta = signedHeadingDelta(target, state.headingDeg);
    if (Math.sign(delta) !== Math.sign(previousDelta) && Math.abs(delta - previousDelta) < 180) {
      let low = alpha - ARC_STEP_RAD * 5, high = alpha;
      for (let i = 0; i < 60; i += 1) {
        const mid = (low + high) / 2;
        const midDelta = signedHeadingDelta(target, at(mid).headingDeg);
        if (Math.sign(midDelta) === Math.sign(previousDelta)) low = mid;
        else high = mid;
      }
      return { alpha: high };
    }
    previousDelta = delta;
  }
  return { error: "The aircraft heading does not reach the Heading on this arc" };
}

function computeArcFromEntry(row, start, ctx, center) {
  const windKt = ctx.windKt;
  const sign = row.direction === "LEFT" ? 1 : -1;
  const offset = sub(start, center);
  const startRadius = len(offset);
  const theta0 = Math.atan2(offset.y, offset.x);
  const startKin = arcKinematics(center, startRadius, sign, 0, theta0, start.tasKt, windKt);
  if (!startKin) return rowFailure(row, "INVALID", ["Wind is stronger than the airspeed on this arc"], start);
  const endAlpha = arcEndAlpha(row, theta0, sign, center, startRadius, start.tasKt, windKt);
  if (endAlpha.error) return rowFailure(row, "INVALID", [endAlpha.error], start);
  const samples = [samplePoint(start)];
  let timeSec = 0;
  let maxBank = startKin.bankDeg;
  let maxG = startKin.loadFactorG;
  let previous = startKin;
  const steps = Math.max(1, Math.ceil(endAlpha.alpha / ARC_STEP_RAD));
  const h = endAlpha.alpha / steps;
  let reversal = false;
  let end = null;
  let headingTurned = 0;
  for (let index = 1; index <= steps; index += 1) {
    const alpha = index * h;
    const mid = arcKinematics(center, startRadius, sign, alpha - h / 2, theta0, start.tasKt, windKt);
    const kin = arcKinematics(center, startRadius, sign, alpha, theta0, start.tasKt, windKt);
    if (!mid || !kin) return { ...rowFailure(row, "INVALID", ["Wind is stronger than the airspeed on this arc"], start), samples };
    // Simpson on dt/dα = R / Vg.
    const dtSec = ((startRadius * 3600) / 6) * h * (1 / previous.groundSpeedKt + 4 / mid.groundSpeedKt + 1 / kin.groundSpeedKt);
    timeSec += dtSec;
    maxBank = Math.max(maxBank, mid.bankDeg, kin.bankDeg);
    maxG = Math.max(maxG, mid.loadFactorG, kin.loadFactorG);
    if (kin.turnSide !== startKin.turnSide) reversal = true;
    headingTurned += signedHeadingDelta(previous.headingDeg, kin.headingDeg);
    const state = makeState({ timeSec: start.timeSec + timeSec, x: kin.point.x, y: kin.point.y, altitudeMslFt: start.altitudeMslFt, tasKt: start.tasKt, headingDeg: kin.headingDeg, fpaDeg: 0 });
    if (index % Math.round(SEM_REJOIN_V0_1.sampleDeg * 10) === 0 || index === steps) samples.push(samplePoint(state));
    previous = kin;
    end = state;
  }
  const summary = {
    ...rowSummaryDefaults(),
    groundDistanceNm: startRadius * endAlpha.alpha,
    arcAngleDeg: endAlpha.alpha / DEG,
    radiusNm: startRadius,
    maxBankDeg: maxBank,
    maxLoadFactorG: maxG,
    headingChangeDeg: Math.abs(headingTurned),
    endRadialDeg: headingOf(sub(end, center)),
  };
  const result = finishRow(row, start, end, samples, summary);
  if (reversal) result.warnings.push("The wind reverses the bank direction on this arc");
  if (isFiniteNumber(row.gLimit) && maxG > row.gLimit + 1e-9) {
    result.status = "INVALID";
    result.errors.push(`Holding the arc needs ${maxG.toFixed(1)} G, above the ${row.gLimit.toFixed(1)} G limit`);
  }
  return result;
}

// Continuity of a DIRECT entry: on the circle and flying its tangent, level. Nothing is snapped.
function arcEntryCheck(row, start, center, windKt) {
  const offset = sub(start, center);
  const distance = len(offset);
  const problems = [];
  if (Math.abs(distance - row.radiusNm) > SEM_REJOIN_V0_1.arcPositionToleranceNm) problems.push(`Start is ${Math.abs(distance - row.radiusNm).toFixed(3)} NM ${distance > row.radiusNm ? "outside" : "inside"} the arc circle`);
  if (Math.abs(start.fpaDeg) > 1e-6) problems.push("Target Arc starts in level flight (level off first)");
  if (distance > 1e-9) {
    const sign = row.direction === "LEFT" ? 1 : -1;
    const tangent = mul({ x: -offset.y / distance, y: offset.x / distance }, sign);
    const track = headingOf(groundVelocityLevel(start, windKt));
    const error = signedHeadingDelta(headingOf(tangent), track);
    if (Math.abs(error) > SEM_REJOIN_V0_1.arcTrackToleranceDeg) problems.push(`Track ${norm360(track).toFixed(0)}° is ${Math.abs(error).toFixed(1)}° off the arc tangent ${headingOf(tangent).toFixed(0)}°`);
  }
  return problems;
}

// AUTO entry: a Turn (the aircraft's S&R turn setting, level-off first when climbing) and a Straight
// whose ground track is tangent to the circle in the arc's direction. Both turn directions are tried;
// the shortest total time wins (tie: RIGHT). Unsupported when no tangent exists (e.g. inside the circle).
function solveArcConnection(row, start, ctx, center, driver) {
  const windKt = ctx.windKt;
  const bank = resolveTurnBank(driver.kind, driver.value);
  if (bank.error) return { status: isFiniteNumber(driver.value) ? "INVALID" : "DRAFT", errors: [`Arc entry turn: ${bank.error}`] };
  let levelStart = start;
  let levelOff = null;
  if (start.fpaDeg > 1e-9) {
    const problem = checkLevelOffG(ctx.levelOffG, start);
    if (problem) return { status: "DRAFT", errors: [`Arc entry: ${problem}`] };
    const push = integrateVertical(start, { loadFactor: levelOffLoad(ctx.levelOffG), windKt, stops: levelOffStops([]), maxSec: SEM_REJOIN_V0_1.maxLevelOffSec });
    if (push.reason !== "LEVEL") return { status: "INVALID", errors: ["Arc entry: the level-off does not reach level flight"] };
    levelOff = push;
    levelStart = makeState({ ...push.end, fpaDeg: 0 });
  }
  const targetSign = row.direction === "LEFT" ? 1 : -1;
  const evaluate = (direction, change) => {
    const turned = change < 1e-12
      ? { end: levelStart, durationSec: 0 }
      : levelTurnEnd(levelStart, { direction, bankDeg: bank.bankDeg, headingChangeDeg: change }, windKt);
    const ground = groundVelocityLevel(turned.end, windKt);
    const speed = len(ground);
    const unit = mul(ground, 1 / speed);
    const toCenter = sub(center, turned.end);
    return { residual: cross(unit, toCenter) - targetSign * row.radiusNm, along: dot(toCenter, unit), turned, speed };
  };
  const candidates = [];
  for (const direction of ["RIGHT", "LEFT"]) {
    let previous = evaluate(direction, 0);
    if (Math.abs(previous.residual) < 1e-10 && previous.along >= 0) candidates.push({ direction, change: 0, ...previous });
    for (let change = 1; change <= 360; change += 1) {
      const current = evaluate(direction, change);
      if (Math.sign(current.residual) !== Math.sign(previous.residual)) {
        let low = change - 1, high = change;
        let lowValue = previous.residual;
        for (let i = 0; i < 60; i += 1) {
          const mid = (low + high) / 2;
          const midValue = evaluate(direction, mid).residual;
          if (Math.sign(midValue) === Math.sign(lowValue)) { low = mid; lowValue = midValue; } else high = mid;
        }
        const root = evaluate(direction, (low + high) / 2);
        if (root.along >= -1e-9 && Math.abs(root.residual) < 1e-6) candidates.push({ direction, change: (low + high) / 2, ...root });
      }
      previous = current;
    }
  }
  if (!candidates.length) {
    return { status: "UNSUPPORTED", errors: [len(sub(start, center)) < row.radiusNm ? "Arc entry: the start is inside the arc circle, no tangent connection (add your own rows)" : "Arc entry: no Turn + Straight tangent connection with the current turn setting"] };
  }
  const total = (candidate) => (candidate.turned.durationSec ?? 0) + Math.max(0, candidate.along) / (candidate.speed * NM_PER_KT_SEC);
  candidates.sort((a, b) => total(a) - total(b) || (a.direction === "RIGHT" ? -1 : 1));
  const best = candidates[0];
  return { status: "VALID", levelOff, levelStart, bank, direction: best.direction, changeDeg: best.change, straightNm: Math.max(0, best.along) };
}

function computeArc(row, start, ctx, driver, upstreamTarget) {
  if (!isFiniteNumber(row.radiusNm)) return { rows: [rowFailure(row, "DRAFT", ["Arc Radius required"], start)] };
  if (!(row.radiusNm > 0)) return { rows: [rowFailure(row, "INVALID", ["Arc Radius must be above 0 NM"], start)] };
  if (!row.direction) return { rows: [rowFailure(row, "DRAFT", ["Direction (Left / Right) required"], start)] };
  if (!isFiniteNumber(row.end.value)) return { rows: [rowFailure(row, "DRAFT", [`${endLabel(row.end.kind)} required`], start)] };
  if (!upstreamTarget) return { rows: [rowFailure(row, "INVALID", ["Target position is not available"], start)] };
  const center = upstreamTarget;
  if (row.entry === "DIRECT") {
    const problems = arcEntryCheck(row, start, center, ctx.windKt);
    if (problems.length) return { rows: [rowFailure(row, "INVALID", problems, start)] };
    return { rows: [computeArcFromEntry(row, start, ctx, center)] };
  }
  // AUTO: already on the circle and its tangent → no connection rows.
  if (!arcEntryCheck(row, start, center, ctx.windKt).length) return { rows: [computeArcFromEntry(row, start, ctx, center)] };
  const connection = solveArcConnection(row, start, ctx, center, driver);
  if (connection.status !== "VALID") return { rows: [rowFailure(row, connection.status, connection.errors, start)] };
  const derived = [];
  let state = start;
  if (connection.changeDeg > 1e-6 || connection.levelOff) {
    const turnRow = { id: `${row.id}:turn`, kind: "TURN", source: "auto", direction: connection.direction, driverKind: driver.kind, driverValue: driver.value, end: { kind: "HEADING_CHANGE", value: connection.changeDeg } };
    // Level-off only (already on a tangent line after it): a level Straight of the level-off time.
    const turnResult = connection.changeDeg > 1e-6
      ? { ...computeTurn(turnRow, state, ctx, driver), driver }
      : computeStraight({ id: `${row.id}:leveloff`, kind: "STRAIGHT", source: "auto", vertical: "LEVEL", end: { kind: "TIME", value: connection.levelOff.elapsedSec } }, state, ctx);
    turnResult.autoFor = row.id;
    derived.push(turnResult);
    if (turnResult.status !== "VALID") return { rows: [...derived, rowFailure(row, "BLOCKED", ["Arc entry turn failed"], null)] };
    state = turnResult.end;
  }
  if (connection.straightNm > 1e-9) {
    const straightRow = { id: `${row.id}:straight`, kind: "STRAIGHT", source: "auto", vertical: "LEVEL", end: { kind: "DISTANCE", value: connection.straightNm } };
    const straightResult = computeStraight(straightRow, state, ctx);
    straightResult.autoFor = row.id;
    derived.push(straightResult);
    if (straightResult.status !== "VALID") return { rows: [...derived, rowFailure(row, "BLOCKED", ["Arc entry straight failed"], null)] };
    state = straightResult.end;
  }
  const arc = computeArcFromEntry(row, state, ctx, center);
  return { rows: [...derived, arc] };
}

// ---- per aircraft ------------------------------------------------------------------------------

function resolveSettings(number, plan, upstream) {
  const own = plan.aircraft[number].settings;
  let levelOff = { value: own.levelOffG, source: isFiniteNumber(own.levelOffG) ? "explicit" : "none", fromAircraft: null };
  if (!isFiniteNumber(own.levelOffG)) {
    let lead = elementLeadOf(number);
    while (lead) {
      const value = plan.aircraft[lead].settings.levelOffG;
      if (isFiniteNumber(value)) {
        levelOff = { value, source: "inherited", fromAircraft: lead };
        break;
      }
      lead = elementLeadOf(lead);
    }
  }
  const resolved = upstream.aircraft[number]?.result?.resolved ?? {};
  const inherited = own.turnDriverKind === "BANK" ? resolved.offsetBankDeg : resolved.offsetG;
  const turnDriver = isFiniteNumber(own.turnDriverValue)
    ? { kind: own.turnDriverKind, value: own.turnDriverValue, source: "explicit" }
    : { kind: own.turnDriverKind, value: isFiniteNumber(inherited) ? inherited : null, source: isFiniteNumber(inherited) ? "offsetTurn" : "none" };
  // The SEM is the BDP's selection for this aircraft (owner handoff §6.5); the plan's legacy semEnd is not used.
  const semEnd = upstream.aircraft[number]?.result?.profile?.canonicalInputs?.semEnd ?? "LEVEL";
  return { semEnd, levelOffG: levelOff, turnDriver };
}

function rowDriver(row, settings) {
  if (row.kind !== "TURN") return settings.turnDriver;
  if (isFiniteNumber(row.driverValue)) return { kind: row.driverKind, value: row.driverValue, source: "explicit" };
  // A Turn left blank takes the aircraft's S&R turn setting of the same kind (shown as inherited).
  if (row.driverKind === settings.turnDriver.kind) return { ...settings.turnDriver, source: settings.turnDriver.source === "explicit" ? "settings" : settings.turnDriver.source };
  return { kind: row.driverKind, value: null, source: "none" };
}

function computeRow(row, start, ctx, settings, target) {
  const keyRow = clone(row);
  const driver = rowDriver(row, settings);
  const key = { model: SEM_REJOIN_V0_1.model, version: SEM_REJOIN_V0_1.version, row: keyRow, start, wind: ctx.windKt, levelOffG: ctx.levelOffG, driver, target };
  return cachedCalculation("sr-row", key, () => {
    if (row.kind === "STRAIGHT") return { rows: [computeStraight(row, start, ctx)] };
    if (row.kind === "TURN") return { rows: [{ ...computeTurn(row, start, ctx, driver), driver }] };
    if (row.kind === "TARGET_ARC") return computeArc(row, start, ctx, driver, target);
    return { rows: [rowFailure(row, "INVALID", [`Unknown maneuver ${row.kind}`], start)] };
  });
}

function computeAircraft(number, upstream, plan, windKt) {
  const entry = upstream.aircraft[number];
  const settings = resolveSettings(number, plan, upstream);
  const base = { number, elementLead: elementLeadOf(number), resolvedSettings: settings, rows: [], sem: null, attackSamples: [], endState: null, complete: false };
  if (!entry || !entry.result) return { ...base, status: "NO_UPSTREAM", message: entry?.error ?? `Aircraft #${number} has no current Offset result` };
  if (entry.status === "INVALID" || entry.result.state === "INVALID") return { ...base, status: "UPSTREAM_INVALID", message: `Offset #${number} is INVALID: no Release state` };
  let sem;
  try {
    sem = computeSem(entry.result, windKt);
    base.attackSamples = releaseOf(entry.result).attackSamples;
  } catch (error) {
    return { ...base, status: "INVALID", message: `SEM: ${error.message}` };
  }
  base.sem = sem;
  base.release = sem.release;
  if (sem.status !== "VALID") return { ...base, status: sem.status, message: sem.errors[0] };
  const ctx = { windKt, levelOffG: settings.levelOffG.value };
  const target = entry.result.geometry.points.target ?? { x: 0, y: 0 };
  let state = sem.endState;
  let blockedBy = null;
  const rows = [];
  for (const row of plan.aircraft[number].rows) {
    if (blockedBy) {
      rows.push({ ...rowFailure(row, "BLOCKED", [`Not computed: step ${blockedBy.step} is ${blockedBy.status}`]), blockedBy: blockedBy.id });
      continue;
    }
    const computed = computeRow(row, state, ctx, settings, target);
    for (const result of computed.rows) {
      rows.push(result);
      if (result.status === "VALID" || result.status === "WARNING") state = result.end;
    }
    const last = computed.rows[computed.rows.length - 1];
    const failed = computed.rows.find((result) => result.status !== "VALID" && result.status !== "WARNING");
    if (failed || !last.end) blockedBy = { id: (failed ?? last).id, status: (failed ?? last).status, step: null };
  }
  // Display steps: SEM is step 1, then every row (derived Arc entry rows included) in order.
  rows.forEach((result, index) => {
    result.step = index + 2;
    if (result.start) result.startSec = result.start.timeSec;
    if (result.end) {
      result.endSec = result.end.timeSec;
      result.durationSec = result.end.timeSec - result.start.timeSec;
    }
  });
  if (blockedBy) {
    const failedRow = rows.find((result) => result.id === blockedBy.id);
    blockedBy.step = failedRow?.step ?? null;
    for (const result of rows) if (result.status === "BLOCKED" && result.errors[0]?.startsWith("Not computed")) result.errors = [`Not computed: step ${blockedBy.step} is ${blockedBy.status}`];
  }
  const anyWarning = rows.some((result) => result.warnings?.length) || sem.warnings.some((warning) => !/^MODEL_ASSUMPTION/.test(warning));
  const status = blockedBy ? (blockedBy.status === "DRAFT" ? "DRAFT" : blockedBy.status) : anyWarning ? "WARNING" : "VALID";
  const firstProblem = rows.find((result) => result.status !== "VALID" && result.status !== "WARNING" && result.status !== "BLOCKED");
  return {
    ...base,
    status,
    message: firstProblem ? `Step ${firstProblem.step} ${firstProblem.status}: ${firstProblem.errors[0]}` : status === "WARNING" ? (rows.flatMap((result) => result.warnings ?? [])[0] ?? sem.warnings[0]) : "-",
    rows,
    endState: state,
    complete: !blockedBy,
    blockedAtSec: blockedBy ? state.timeSec : null,
  };
}

// ---- state at a time (IP clock) ----------------------------------------------------------------

function interpolate(a, b, f) {
  return makeState({
    timeSec: a.t + (b.t - a.t) * f,
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    altitudeMslFt: a.altitudeMslFt + (b.altitudeMslFt - a.altitudeMslFt) * f,
    tasKt: a.tasKt + (b.tasKt - a.tasKt) * f,
    headingDeg: a.headingDeg + signedHeadingDelta(a.headingDeg, b.headingDeg) * f,
    fpaDeg: a.fpaDeg + (b.fpaDeg - a.fpaDeg) * f,
  });
}
function stateFromSamples(samples, timeSec) {
  if (!samples.length || timeSec < samples[0].t - 1e-9 || timeSec > samples[samples.length - 1].t + 1e-9) return null;
  let low = 0, high = samples.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (samples[mid].t <= timeSec) low = mid;
    else high = mid;
  }
  const a = samples[low], b = samples[Math.min(high, samples.length - 1)];
  const span = b.t - a.t;
  return interpolate(a, b, span > 0 ? Math.min(1, Math.max(0, (timeSec - a.t) / span)) : 1);
}

// Continuation after the last row (SPEC "Continuation"): wings level, heading and FPA held,
// energy-neutral. Level: exact straight line. Climbing: integrated until the speed runs out.
function extendState(end, timeSec, windKt) {
  const extraSec = timeSec - end.timeSec;
  if (end.fpaDeg <= 1e-9) return { state: levelStraight(makeState({ ...end, fpaDeg: 0 }), extraSec, windKt).end, extendedSec: extraSec };
  const climb = integrateVertical(end, { loadFactor: (gamma) => Math.cos(gamma), windKt, stops: [{ reason: "TIME", value: (y, t) => extraSec - t }], maxSec: extraSec + 1 });
  if (climb.reason !== "TIME") return { state: null, extendedSec: climb.elapsedSec, reason: `Continuation stops after ${climb.elapsedSec.toFixed(1)} s (speed runs out holding the climb)` };
  return { state: climb.end, extendedSec: extraSec };
}

function aircraftStateAt(aircraft, upstreamEntry, timeSec, windKt) {
  if (!aircraft.sem) return { available: false, phase: "unavailable", reason: aircraft.message };
  if (timeSec < 0) return { available: false, phase: "before-ip", reason: "Before IP" };
  const release = aircraft.sem.release;
  if (timeSec < release.timeSec - 1e-9) {
    const at = offsetTimeline(upstreamEntry.result).at(timeSec);
    const track = at.heading ? headingOf(at.heading) : null;
    return { available: true, phase: "attack", state: { timeSec, x: at.aircraft.x, y: at.aircraft.y, trackDeg: track, headingDeg: null, altitudeMslFt: null, tasKt: null, fpaDeg: null }, partial: true };
  }
  if (aircraft.sem.status !== "VALID") return { available: false, phase: "unavailable", reason: aircraft.message };
  const semSamples = aircraft.sem.samples;
  if (timeSec <= semSamples[semSamples.length - 1].t + 1e-9) {
    return { available: true, phase: "sem", rowId: "sem", state: describeState(stateFromSamples(semSamples, timeSec), windKt) };
  }
  for (const row of aircraft.rows) {
    if (!row.end) break;
    if (Math.abs(timeSec - row.end.timeSec) <= 1e-9) return { available: true, phase: "row", rowId: row.id, step: row.step, state: describeState(row.end, windKt) };
    if (timeSec < row.end.timeSec) return { available: true, phase: "row", rowId: row.id, step: row.step, state: describeState(stateFromSamples(row.samples, timeSec), windKt) };
  }
  if (!aircraft.complete) return { available: false, phase: "unavailable", reason: `Path incomplete after ${aircraft.blockedAtSec?.toFixed(1)} s: ${aircraft.message}` };
  const extended = extendState(aircraft.endState, timeSec, windKt);
  if (!extended.state) return { available: false, phase: "unavailable", reason: extended.reason };
  return { available: true, phase: "continuation", extendedSec: extended.extendedSec, state: describeState(extended.state, windKt) };
}

// ---- formation evaluation ----------------------------------------------------------------------

function evaluationTime(evaluation, aircraftResults, editAircraft) {
  const mode = evaluation?.mode ?? "AUTO";
  if (mode === "FREE" && isFiniteNumber(evaluation.timeSec)) return { mode, timeSec: Math.max(0, evaluation.timeSec), source: null };
  if (mode === "ROW_END") {
    const aircraft = aircraftResults[evaluation.aircraft];
    if (evaluation.rowId === "sem" && aircraft?.sem?.status === "VALID") return { mode, timeSec: aircraft.sem.endState.timeSec, source: { aircraft: evaluation.aircraft, rowId: "sem", step: 1 } };
    const row = aircraft?.rows.find((candidate) => candidate.id === evaluation.rowId);
    if (row?.end) return { mode, timeSec: row.end.timeSec, source: { aircraft: evaluation.aircraft, rowId: row.id, step: row.step } };
  }
  // AUTO: the end of the edit aircraft's last computed row (its SEM End without rows).
  const number = aircraftResults[editAircraft] ? editAircraft : Number(Object.keys(aircraftResults)[0]);
  const aircraft = aircraftResults[number];
  const lastRow = [...(aircraft?.rows ?? [])].reverse().find((row) => row.end);
  if (lastRow) return { mode: "AUTO", timeSec: lastRow.end.timeSec, source: { aircraft: number, rowId: lastRow.id, step: lastRow.step } };
  if (aircraft?.sem?.status === "VALID") return { mode: "AUTO", timeSec: aircraft.sem.endState.timeSec, source: { aircraft: number, rowId: "sem", step: 1 } };
  return { mode: "AUTO", timeSec: null, source: null };
}

function formationSlot(plan, number) {
  const slot = plan.formation[number];
  if (!slot) return null;
  const bearing = slot.preset === "COMBAT_SPREAD" ? 90 : slot.bearingDeg;
  return { ...slot, bearingDeg: bearing };
}

function evaluateFormation(plan, states, upstream, timeSec) {
  const egress = plan.egress;
  const tolerance = plan.tolerance;
  const toleranceSet = ["positionNm", "headingDeg", "altitudeFt", "relativeSpeedKt"].every((key) => isFiniteNumber(tolerance[key]));
  const common = {};
  const formation = {};
  for (const number of Object.keys(states).map(Number)) {
    const at = states[number];
    const s = at.available && !at.partial ? at.state : null;
    common[number] = {
      available: !!s,
      headingErrorDeg: s && isFiniteNumber(egress.headingDeg) ? signedHeadingDelta(egress.headingDeg, s.headingDeg) : null,
      speedErrorKcas: s && isFiniteNumber(egress.speedKcas) ? s.kcas - egress.speedKcas : null,
      altitudeErrorFt: s && isFiniteNumber(egress.altitudeMslFt) ? s.altitudeMslFt - egress.altitudeMslFt : null,
    };
    if (number === 1) continue;
    const reference = elementLeadOf(number);
    const slot = formationSlot(plan, number);
    const refAt = states[reference];
    const out = { reference, slot, available: false, judgement: "NOT_SET", missing: [], errors: null, slotPoint: null };
    if (!isFiniteNumber(egress.headingDeg)) out.missing.push("Egress Heading");
    if (!slot?.preset) out.missing.push("Formation preset");
    if (!slot?.side) out.missing.push("Side");
    if (!isFiniteNumber(slot?.bearingDeg)) out.missing.push("Formation Bearing");
    if (!isFiniteNumber(slot?.rangeNm)) out.missing.push("Formation Range");
    if (out.missing.length) { formation[number] = out; continue; }
    if (!(slot.bearingDeg >= 0 && slot.bearingDeg <= 180) || !(slot.rangeNm >= 0)) {
      formation[number] = { ...out, judgement: "INVALID", missing: [], reason: "Formation Bearing must be 0–180° and Range at least 0 NM" };
      continue;
    }
    if (!refAt?.available || refAt.partial || !s) {
      formation[number] = { ...out, judgement: "UNAVAILABLE", reason: !s ? `#${number}: ${at.reason ?? (at.partial ? "still on its attack run" : "no state")}` : `#${reference}: ${refAt?.reason ?? (refAt?.partial ? "still on its attack run" : "no state")}` };
      continue;
    }
    const ref = refAt.state;
    const vector = computeFormationOffsetVectorFull({ runInHeadingDeg: egress.headingDeg, relativeBearingDeg: slot.bearingDeg, side: slot.side, distanceNm: slot.rangeNm }).vector;
    const slotPoint = add(ref, vector);
    const forward = vecHeading(egress.headingDeg);
    const rightUnit = { x: forward.y, y: -forward.x };
    const error = sub(s, slotPoint);
    const relative = sub(s.groundVelocityKt, ref.groundVelocityKt);
    const errors = {
      longitudinalNm: dot(error, forward),
      lateralNm: dot(error, rightUnit),
      distanceNm: len(error),
      altitudeFt: isFiniteNumber(egress.altitudeMslFt) ? s.altitudeMslFt - egress.altitudeMslFt : null,
      altitudeVsReferenceFt: s.altitudeMslFt - ref.altitudeMslFt,
      headingDeg: signedHeadingDelta(egress.headingDeg, s.headingDeg),
      speedKcas: isFiniteNumber(egress.speedKcas) ? s.kcas - egress.speedKcas : null,
      relativeSpeedKt: len(relative),
      closureKt: -dot(relative, forward),
      lateralRateKt: dot(relative, rightUnit),
    };
    let judgement = "NOT_JUDGED";
    const failing = [];
    if (toleranceSet) {
      if (errors.distanceNm > tolerance.positionNm) failing.push("position");
      if (Math.abs(errors.headingDeg) > tolerance.headingDeg) failing.push("heading");
      if (errors.altitudeFt === null || Math.abs(errors.altitudeFt) > tolerance.altitudeFt) failing.push("altitude");
      if (errors.relativeSpeedKt > tolerance.relativeSpeedKt) failing.push("relative speed");
      judgement = failing.length ? "OUT_OF_TOLERANCE" : "WITHIN_TOLERANCE";
    }
    formation[number] = { reference, slot, available: true, judgement, failing, missing: [], errors, slotPoint, referencePoint: { x: ref.x, y: ref.y } };
  }
  return { common, formation, toleranceSet };
}

// ---- draw (Heading + mouse) --------------------------------------------------------------------

// The lead-in Straight of a drawn maneuver: current heading kept, the row's vertical policy (level-off
// first when climbing and LEVEL). The mouse point is projected onto this forward path: the turn starts
// at the path point closest to it (never behind the aircraft, never back in time).
function drawLeadIn(start, settings, windKt, maxNm) {
  const ctx = { windKt, levelOffG: settings.levelOffG };
  const row = { id: "draw:straight", kind: "STRAIGHT", source: "auto", vertical: settings.vertical, end: { kind: "DISTANCE", value: maxNm } };
  return computeStraight(row, start, ctx);
}

function closestOnPath(samples, point) {
  let best = { distance: Infinity, t: samples[0].t, index: 0, fraction: 0 };
  for (let index = 1; index < samples.length; index += 1) {
    const a = samples[index - 1], b = samples[index];
    const segment = sub(b, a);
    const length2 = dot(segment, segment);
    const fraction = length2 > 0 ? Math.min(1, Math.max(0, dot(sub(point, a), segment) / length2)) : 0;
    const projected = add(a, mul(segment, fraction));
    const distance = len(sub(point, projected));
    if (distance < best.distance - 1e-12) best = { distance, t: a.t + (b.t - a.t) * fraction, index, fraction, projected };
  }
  return best;
}

// Preview / commit geometry for "next Heading + mouse" (SPEC "Draw"). Returns the rows the click
// would add (explicit parameters only; the mouse point is not stored) and the drawn preview.
export function previewSemRejoinManeuver({ start, windKt, heading, direction = "AUTO", driver, vertical = "LEVEL", levelOffG = null, point }) {
  const diagnostics = [];
  if (!start || !isFiniteNumber(start.timeSec)) return { status: "INVALID", errors: ["No start state"], rows: [] };
  if (!point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return { status: "INVALID", errors: ["No mouse point"], rows: [] };
  const wind = windKt ?? { x: 0, y: 0 };
  const settings = { vertical: oneOf(vertical, VERTICALS, "LEVEL"), levelOffG };
  const reach = Math.max(1, len(sub(point, start)) * 1.5 + 1);
  const lead = drawLeadIn(start, settings, wind, reach);
  // A climb that runs out of speed limits the forward path; a missing Level-off G stops the draw.
  if (lead.status === "DRAFT" || lead.samples.length < 2) return { status: lead.status, errors: lead.errors, rows: [], leadIn: lead.samples };
  if (lead.status !== "VALID") diagnostics.push(lead.errors[0]);
  const closest = closestOnPath(lead.samples, point);
  const straightSec = Math.max(0, closest.t - start.timeSec);
  // The lead-in Straight up to the projected point (recomputed exactly as the row the click stores).
  let straightRow = null;
  let turnStart = start;
  let straightResult = null;
  const ctx = { windKt: wind, levelOffG: settings.levelOffG };
  if (straightSec > 1e-3) {
    const distanceNm = (() => {
      const probe = computeStraight({ id: "draw:probe", kind: "STRAIGHT", source: "auto", vertical: settings.vertical, end: { kind: "TIME", value: straightSec } }, start, ctx);
      return probe.summary.groundDistanceNm;
    })();
    if (distanceNm > 0.01) {
      straightRow = { kind: "STRAIGHT", source: "auto", vertical: settings.vertical, end: { kind: "DISTANCE", value: distanceNm } };
      straightResult = computeStraight({ ...straightRow, id: "draw:straight" }, start, ctx);
      if (straightResult.status !== "VALID") return { status: straightResult.status, errors: straightResult.errors, rows: [] };
      turnStart = straightResult.end;
    }
  } else {
    diagnostics.push("The point is behind the aircraft: the turn starts now");
  }
  const rows = straightRow ? [straightRow] : [];
  let turnResult = null;
  if (isFiniteNumber(heading)) {
    let resolvedDirection = direction;
    if (resolvedDirection !== "LEFT" && resolvedDirection !== "RIGHT") {
      const delta = signedHeadingDelta(turnStart.headingDeg, heading);
      resolvedDirection = Math.abs(delta) < 1e-9 ? null : delta < 0 ? "LEFT" : "RIGHT";
    }
    if (resolvedDirection && headingChangeDeg(turnStart.headingDeg, heading, resolvedDirection) > 0) {
      // The committed Turn keeps the G / Bank it was drawn with (the plan holds explicit values).
      const turnRow = { kind: "TURN", source: "user", direction: resolvedDirection, driverKind: driver?.kind ?? "G", driverValue: isFiniteNumber(driver?.value) ? driver.value : null, end: { kind: "HEADING", value: norm360(heading) } };
      turnResult = computeTurn({ ...turnRow, id: "draw:turn" }, turnStart, ctx, { kind: driver?.kind ?? "G", value: driver?.value ?? null });
      rows.push(turnRow);
      if (turnResult.status !== "VALID") return { status: turnResult.status, errors: turnResult.errors, rows: [], straight: straightResult, mousePoint: point, turnStart };
    } else {
      diagnostics.push("No heading change: Straight only");
    }
  } else {
    diagnostics.push("Heading not set: Straight only");
  }
  if (!rows.length) return { status: "EMPTY", errors: ["Nothing to add: move the pointer ahead of the aircraft or set a Heading"], rows: [], mousePoint: point, turnStart, diagnostics };
  return {
    status: "VALID",
    errors: [],
    diagnostics,
    rows,
    mousePoint: point,
    projectedPoint: closest.projected ?? { x: start.x, y: start.y },
    turnStart,
    turnEnd: turnResult?.end ?? straightResult?.end ?? turnStart,
    straight: straightResult,
    turn: turnResult,
  };
}

// ---- edits -------------------------------------------------------------------------------------

function anchorState(output, number, afterRowId) {
  const aircraft = output.aircraft[number];
  if (!aircraft?.sem || aircraft.sem.status !== "VALID") return null;
  if (afterRowId === null || afterRowId === undefined || afterRowId === "sem") return aircraft.sem.endState;
  const stored = aircraft.rows.filter((row) => !row.autoFor && row.id === afterRowId);
  if (stored.length) return stored[0].end;
  const arcRows = aircraft.rows.filter((row) => row.id === afterRowId || row.autoFor === afterRowId);
  return arcRows.length ? arcRows[arcRows.length - 1].end : null;
}

function insertRows(plan, number, afterRowId, rows) {
  const list = plan.aircraft[number].rows;
  const index = afterRowId === null || afterRowId === undefined || afterRowId === "sem" ? 0 : list.findIndex((row) => row.id === afterRowId) + 1;
  const ids = [];
  const created = rows.map((row) => {
    const id = `r${plan.nextRowId++}`;
    ids.push(id);
    return normalizeRow({ ...row, id });
  });
  list.splice(index < 0 ? list.length : index, 0, ...created);
  return ids;
}

function defaultRow(kind, settings) {
  if (kind === "STRAIGHT") return { kind, vertical: settings.drawVertical, end: { kind: "TIME", value: null } };
  if (kind === "TURN") return { kind, direction: null, driverKind: settings.turnDriverKind, driverValue: null, end: { kind: "HEADING", value: null } };
  if (kind === "TARGET_ARC") return { kind, radiusNm: null, direction: null, end: { kind: "ARC_ANGLE", value: null }, entry: "AUTO", gLimit: null };
  throw new TypeError(`unsupported maneuver ${kind}`);
}

function patchRow(row, patch) {
  const next = { ...row };
  for (const key of ["vertical", "direction", "driverKind", "driverValue", "radiusNm", "entry", "gLimit"]) if (Object.hasOwn(patch, key)) next[key] = patch[key];
  if (patch.end) next.end = { ...row.end, ...patch.end };
  if (Object.hasOwn(patch, "kind") && patch.kind !== row.kind) {
    // A kind change keeps the id and starts from that kind's empty conditions.
    return normalizeRow({ ...defaultRow(patch.kind, defaultSettings()), id: row.id, source: "user" });
  }
  return normalizeRow({ ...next, source: "user" });
}

// Applies the FE's raw edit events in order (the FE never edits the plan itself). Returns the next
// plan and, per edit, what it did (ids of rows added).
function applyEdits(plan, edits, context) {
  const results = [];
  for (const edit of edits) {
    const number = Number(edit?.aircraft);
    const aircraftPlan = plan.aircraft[number];
    try {
      switch (edit?.kind) {
        case "addRow": {
          if (!aircraftPlan) throw new Error("unknown aircraft");
          const ids = insertRows(plan, number, edit.afterRowId ?? null, [defaultRow(edit.rowKind, aircraftPlan.settings)]);
          results.push({ kind: edit.kind, aircraft: number, added: ids });
          break;
        }
        case "deleteRow": {
          if (!aircraftPlan) throw new Error("unknown aircraft");
          const before = aircraftPlan.rows.length;
          aircraftPlan.rows = aircraftPlan.rows.filter((row) => row.id !== edit.rowId);
          results.push({ kind: edit.kind, aircraft: number, deleted: before !== aircraftPlan.rows.length ? [edit.rowId] : [] });
          break;
        }
        case "updateRow": {
          if (!aircraftPlan) throw new Error("unknown aircraft");
          aircraftPlan.rows = aircraftPlan.rows.map((row) => (row.id === edit.rowId ? patchRow(row, edit.patch ?? {}) : row));
          results.push({ kind: edit.kind, aircraft: number, updated: [edit.rowId] });
          break;
        }
        case "commitDraw": {
          if (!aircraftPlan) throw new Error("unknown aircraft");
          const current = context.currentOutput();
          const start = anchorState(current, number, edit.afterRowId ?? null);
          const resolved = current.aircraft[number]?.resolvedSettings;
          const preview = previewSemRejoinManeuver({
            start, windKt: context.windKt, heading: edit.headingDeg, direction: edit.direction, vertical: edit.vertical,
            driver: edit.driverValue !== null && edit.driverValue !== undefined ? { kind: edit.driverKind, value: edit.driverValue, source: "explicit" } : resolved?.turnDriver,
            levelOffG: resolved?.levelOffG?.value ?? null, point: edit.point,
          });
          if (preview.status !== "VALID") {
            results.push({ kind: edit.kind, aircraft: number, added: [], error: preview.errors[0] });
            break;
          }
          const ids = insertRows(plan, number, edit.afterRowId ?? null, preview.rows);
          results.push({ kind: edit.kind, aircraft: number, added: ids });
          break;
        }
        case "detachArcEntry": {
          if (!aircraftPlan) throw new Error("unknown aircraft");
          const output = context.currentOutput();
          const derived = output.aircraft[number]?.rows.filter((row) => row.autoFor === edit.rowId && row.end) ?? [];
          const arcIndex = aircraftPlan.rows.findIndex((row) => row.id === edit.rowId);
          if (arcIndex < 0) throw new Error("unknown Target Arc row");
          // The connection as explicit rows: same conditions, the solved values written in.
          const explicit = derived.map((row) => (row.kind === "TURN"
            ? { kind: "TURN", direction: row.definition.direction, driverKind: row.driver?.kind ?? row.definition.driverKind, driverValue: row.driver?.value ?? row.definition.driverValue, end: { ...row.definition.end } }
            : { kind: "STRAIGHT", vertical: "LEVEL", end: { ...row.definition.end } }));
          const afterId = arcIndex > 0 ? aircraftPlan.rows[arcIndex - 1].id : "sem";
          const ids = insertRows(plan, number, afterId, explicit);
          aircraftPlan.rows = aircraftPlan.rows.map((row) => (row.id === edit.rowId ? { ...row, entry: "DIRECT" } : row));
          results.push({ kind: edit.kind, aircraft: number, added: ids });
          break;
        }
        case "setSettings": {
          if (!aircraftPlan) throw new Error("unknown aircraft");
          aircraftPlan.settings = normalizeSettings({ ...aircraftPlan.settings, ...(edit.patch ?? {}) });
          results.push({ kind: edit.kind, aircraft: number });
          break;
        }
        case "setEgress":
          plan.egress = normalizeSemRejoinPlan({ ...plan, egress: { ...plan.egress, ...(edit.patch ?? {}) } }).egress;
          results.push({ kind: edit.kind });
          break;
        case "setFormation":
          if (![2, 3, 4].includes(number)) throw new Error("Formation targets exist for #2–#4");
          plan.formation[number] = normalizeSemRejoinPlan({ ...plan, formation: { ...plan.formation, [number]: { ...plan.formation[number], ...(edit.patch ?? {}) } } }).formation[number];
          results.push({ kind: edit.kind, aircraft: number });
          break;
        case "setTolerance":
          plan.tolerance = normalizeSemRejoinPlan({ ...plan, tolerance: { ...plan.tolerance, ...(edit.patch ?? {}) } }).tolerance;
          results.push({ kind: edit.kind });
          break;
        case "resetAircraft": {
          if (!aircraftPlan) throw new Error("unknown aircraft");
          plan.aircraft[number] = { rows: [], settings: defaultSettings() };
          if ([2, 3, 4].includes(number)) plan.formation[number] = defaultFormation();
          results.push({ kind: edit.kind, aircraft: number });
          break;
        }
        default:
          throw new Error(`unsupported edit ${edit?.kind}`);
      }
    } catch (error) {
      results.push({ kind: edit?.kind ?? null, aircraft: Number.isFinite(number) ? number : null, error: error.message });
    }
  }
  return results;
}

// ---- entrypoint --------------------------------------------------------------------------------

function computeAll(upstream, plan, windKt) {
  const aircraft = {};
  const stats = {};
  for (let number = 1; number <= upstream.flightSize; number += 1) {
    const key = { model: SEM_REJOIN_V0_1.model, version: SEM_REJOIN_V0_1.version, number, upstream: upstream.aircraft[number], leadSettings: plan.aircraft[elementLeadOf(number)]?.settings ?? null, leadLeadSettings: plan.aircraft[elementLeadOf(elementLeadOf(number) ?? 0)]?.settings ?? null, plan: plan.aircraft[number], wind: windKt };
    let reused = true;
    aircraft[number] = cachedCalculation("sr-aircraft", key, () => {
      reused = false;
      return computeAircraft(number, upstream, plan, windKt);
    });
    stats[number] = reused && activeSession ? "reused" : "solved";
  }
  return { aircraft, stats };
}

let activeSession = null;

function evaluateAircraftResults({ aircraft, upstream, plan, windKt, evaluation, editAircraft }) {
  const time = evaluationTime(evaluation, aircraft, Number(editAircraft) || 1);
  const states = {};
  if (isFiniteNumber(time.timeSec)) {
    for (const number of Object.keys(aircraft).map(Number)) states[number] = aircraftStateAt(aircraft[number], upstream.aircraft[number], time.timeSec, windKt);
  }
  return { ...time, aircraft: states, ...(isFiniteNumber(time.timeSec) ? evaluateFormation(plan, states, upstream, time.timeSec) : { common: {}, formation: {}, toleranceSet: false }) };
}

// Evaluation at another IP-clock time (selected row end, free time) from a Full output already
// computed: states on the IP clock and the formation errors. No path is recomputed (the FE calls it
// on row selection or the time slider; SPEC "Evaluation time").
export function evaluateSemRejoin({ output, upstream, evaluation, editAircraft = 1 }) {
  if (!output?.aircraft || !upstream) throw new TypeError("output and upstream are required");
  return evaluateAircraftResults({ aircraft: output.aircraft, upstream, plan: normalizeSemRejoinPlan(output.nextPlan), windKt: output.wind.vectorKt, evaluation, editAircraft });
}

function validateInput(input) {
  if (!input || typeof input !== "object") throw new TypeError("input must be an object");
  if (input.edit && input.edits) throw new TypeError("edit and edits are exclusive");
  if (!input.upstream || typeof input.upstream !== "object") throw new TypeError("upstream is required");
}

// Full-precision entrypoint (the FE's only S&R calculation call, through the Worker host). Input:
// { schemaVersion: 1, upstream (semRejoinUpstreamView), plan, evaluation?, editAircraft?, edits? }.
// Output: per-aircraft results, evaluation at the selected IP-clock time, timeline bounds, the next
// plan (edits applied, normalized) and per-edit results. Pure: the input is never mutated.
export function calculateSemRejoinFull(rawInput) {
  validateInput(rawInput);
  const input = clone(rawInput);
  const upstream = input.upstream;
  const windKt = windVector(upstream.wind);
  const plan = normalizeSemRejoinPlan(input.plan);
  // The plan turns with the Offset Run-In first: the edits below are made on the current picture.
  const runInTurnDeltaDeg = alignPlanToRunInTurn(plan, upstream.runInTurnDeg);
  const edits = input.edits ?? (input.edit ? [input.edit] : []);
  // A draw commit or an Arc entry detach reads the computed state of the plan as it stands when that
  // edit is applied (earlier edits of the same request included).
  const editResults = edits.length ? applyEdits(plan, edits, { currentOutput: () => ({ aircraft: computeAll(upstream, plan, windKt).aircraft }), windKt }) : [];
  const { aircraft, stats } = computeAll(upstream, plan, windKt);
  const evaluation = evaluateAircraftResults({ aircraft, upstream, plan, windKt, evaluation: input.evaluation, editAircraft: input.editAircraft });
  const times = Object.values(aircraft).flatMap((entry) => [entry.release?.timeSec, entry.sem?.endState?.timeSec, ...entry.rows.map((row) => row.end?.timeSec)]).filter(isFiniteNumber);
  return {
    model: { id: SEM_REJOIN_V0_1.id, version: SEM_REJOIN_V0_1.version, physics: SEM_REJOIN_V0_1.model, components: SEM_REJOIN_V0_1.components, assumptions: SEM_REJOIN_V0_1.assumptions },
    flightSize: upstream.flightSize,
    wind: { ...upstream.wind, vectorKt: windKt },
    aircraft,
    evaluation,
    timeline: { minSec: 0, maxSec: times.length ? Math.max(...times) : 0, releaseSec: Object.fromEntries(Object.entries(aircraft).map(([number, entry]) => [number, entry.release?.timeSec ?? null])) },
    nextPlan: plan,
    runInTurnDeltaDeg,
    editResults,
    solveLog: stats,
  };
}

// Public 5-decimal variant (docs/FE-BE-RULES.md); no next plan, so truncated numbers never return.
export function calculateSemRejoin(rawInput) {
  const { nextPlan, ...rest } = calculateSemRejoinFull(rawInput);
  return truncateBeOutput(rest);
}

// One editing session: SEM, row and aircraft results are reused across calls while their exact
// inputs are unchanged (Common calculation cache; keys name the model versions).
export function createSemRejoinSession({ limits = { "sr-sem": 32, "sr-row": 512, "sr-aircraft": 32 } } = {}) {
  const cache = createCalculationCache({ limits });
  let lastStats = null;
  return {
    calculate(input) {
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      const before = snapshotCalculationCacheStats(cache);
      const previousSession = activeSession;
      activeSession = cache;
      try {
        const output = withCalculationCache(cache, () => calculateSemRejoinFull(input));
        lastStats = { solveLog: output.solveLog, subSolves: calculationCacheStats(cache, before), beMs: (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt };
        return output;
      } finally {
        activeSession = previousSession;
      }
    },
    lastStats: () => lastStats,
    clear() {
      cache.entries.clear();
      cache.stats = {};
    },
  };
}
