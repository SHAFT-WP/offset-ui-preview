// BMS DTC (callsign ini) — read the mission and write the DTE offsets (owner 2026-11-11 / 2026-11-12, plan
// apps/bombing-calculator-v2/offset/work/bms-mission-dte-2026-11-11/PLAN.md §2.1, §2.2). Pure text in, data or text
// out: no DOM, no file access. The FE reads and writes the file; this module never touches it.
//
// - parseBmsDtc(text): the [STPT] steerpoints (route, user targets, PPT) and the [NAV OFFSETS] lines.
// - resolveBmsMission(parsed, { targetStpt, ipStpt }): the TGT and IP steerpoints by the owner's rules, the IP → TGT
//   true bearing and range, the Target elevation, a route summary, messages and warnings.
// - patchBmsNavOffsets(text, { mode, targetStpt, reference, oa1 }): delete every VIP / VIPPUP / VRP / VRPPUP / OA1-* /
//   OA2-* line of [NAV OFFSETS], then write Modesel, the VRP or VIP page and OA1 of the TGT steerpoint. Other lines,
//   other sections and the line endings are kept.
// - clearBmsNavOffsets(text): delete those lines only (Modesel kept).
// - bmsIniTextFromBytes / bmsIniBytesFromText: byte-preserving (Latin-1) text for the FE's file read and write.
export const BMS_DTC_V0_1 = Object.freeze({ id: "bms-dtc-v0.1", version: "0.1.0", status: "work" });

const FT_PER_NM = 6076.11549;

// BMS waypoint action codes (UOAF bms-briefing-tools code table; plan §1.2). User targets and empty slots are −1.
export const BMS_WAYPOINT_ACTIONS = Object.freeze({
  0: "Nav", 1: "Takeoff", 2: "Push", 3: "Split", 4: "Refuel", 5: "Rearm", 6: "Pickup", 7: "Land", 8: "Timing",
  9: "CAS CP", 10: "Escort", 11: "Sweep", 12: "CAP", 13: "Intercept", 14: "GND Strike", 15: "NAV Strike", 16: "SAD",
  17: "Strike", 18: "Bomb", 19: "SEAD", 20: "ELINT", 21: "Recon", 22: "Rescue", 23: "ASW", 24: "Tanker", 25: "Airdrop",
  26: "Jam", 27: "Land2", 255: "Precision",
});
// Attack actions (owner 2026-11-12): the route's target waypoint is the first of these.
export const BMS_ATTACK_ACTIONS = Object.freeze([14, 15, 16, 17, 18, 19]);
// The [NAV OFFSETS] lines a DTE write or Clear deletes (owner 2026-11-11: an old point left behind breaks the DTE).
const OFFSET_KEY = /^(VIP|VIPPUP|VRP|VRPPUP|OA1-\d+|OA2-\d+)$/i;

const UNSET_NAME = "Not set";

function lineEndingOf(text) {
  return /\r\n/.test(text) ? "\r\n" : "\n";
}

function splitLines(text) {
  // Keeps the text's own line ending; a final line ending gives an empty last item.
  return String(text).split(/\r\n|\n/);
}

// Sections in order: { name, start (index of the [name] line), end (index after its last line) }.
function sectionsOf(lines) {
  const sections = [];
  lines.forEach((line, index) => {
    const match = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (!match) return;
    if (sections.length) sections[sections.length - 1].end = index;
    sections.push({ name: match[1].trim(), start: index, end: lines.length });
  });
  return sections;
}

function keyValue(line) {
  const at = line.indexOf("=");
  if (at < 0) return null;
  return { key: line.slice(0, at).trim(), value: line.slice(at + 1).trim() };
}

const numberOf = (text) => {
  const value = Number(String(text).trim());
  return Number.isFinite(value) ? value : NaN;
};

// target_n → STPT n + 1 (target_0..23 = STPT 1–24, target_80..98 = STPT 81–99).
function steerpointOf(index, value) {
  const parts = value.split(",");
  const [northFt, eastFt, zFt, action] = parts.slice(0, 4).map(numberOf);
  const rawName = parts.slice(4).join(",").trim();
  const set = [northFt, eastFt].every(Number.isFinite) && (northFt !== 0 || eastFt !== 0);
  const name = rawName && rawName !== UNSET_NAME ? rawName : null;
  return {
    stpt: index + 1,
    slot: `target_${index}`,
    northFt,
    eastFt,
    zFt,
    // Z is up-negative: the steerpoint's elevation is −Z ft MSL (plan §2.1-6).
    elevationFt: Number.isFinite(zFt) ? -zFt || 0 : NaN,
    action: Number.isFinite(action) ? action : null,
    actionName: Number.isFinite(action) && action >= 0 ? BMS_WAYPOINT_ACTIONS[action] ?? `Action ${action}` : null,
    name,
    set,
    // A user target: coordinates and action −1 (an empty slot has action −1 too, but no coordinates).
    user: set && action === -1,
    route: set && Number.isFinite(action) && action >= 0,
    attack: set && BMS_ATTACK_ACTIONS.includes(action),
  };
}

function pptOf(index, value) {
  const parts = value.split(",");
  const [northFt, eastFt, zFt, radiusFt] = parts.slice(0, 4).map(numberOf);
  const label = parts.slice(4).join(",").trim();
  const set = [northFt, eastFt].every(Number.isFinite) && (northFt !== 0 || eastFt !== 0);
  return { index, northFt, eastFt, zFt, radiusFt, label: label || null, set };
}

export function parseBmsDtc(text) {
  if (typeof text !== "string") throw new TypeError("the callsign ini text is required");
  const lines = splitLines(text);
  const sections = sectionsOf(lines);
  const stptSection = sections.find((section) => section.name.toUpperCase() === "STPT");
  const navSection = sections.find((section) => section.name.toUpperCase() === "NAV OFFSETS");
  const steerpoints = [];
  const ppts = [];
  if (stptSection) {
    for (let index = stptSection.start + 1; index < stptSection.end; index += 1) {
      const entry = keyValue(lines[index]);
      if (!entry) continue;
      const target = /^target_(\d+)$/i.exec(entry.key);
      const ppt = /^ppt_(\d+)$/i.exec(entry.key);
      if (target) steerpoints.push(steerpointOf(Number(target[1]), entry.value));
      else if (ppt) ppts.push(pptOf(Number(ppt[1]), entry.value));
    }
  }
  steerpoints.sort((a, b) => a.stpt - b.stpt);
  const navOffsets = [];
  if (navSection) {
    for (let index = navSection.start + 1; index < navSection.end; index += 1) {
      const entry = keyValue(lines[index]);
      if (entry) navOffsets.push(entry);
    }
  }
  const modesel = navOffsets.find((entry) => entry.key.toLowerCase() === "modesel")?.value ?? null;
  return {
    model: { ...BMS_DTC_V0_1 },
    lineEnding: lineEndingOf(text),
    sections: sections.map((section) => section.name),
    hasStpt: Boolean(stptSection),
    hasNavOffsets: Boolean(navSection),
    steerpoints,
    ppts: ppts.filter((ppt) => ppt.set),
    navOffsets,
    modesel,
  };
}

function bearingRange(from, to) {
  const dNorth = to.northFt - from.northFt;
  const dEast = to.eastFt - from.eastFt;
  const rangeFt = Math.hypot(dNorth, dEast);
  // Grid north = true (plan §1.2); 0..360.
  const trueBearingDeg = rangeFt > 0 ? (((Math.atan2(dEast, dNorth) * 180) / Math.PI) % 360 + 360) % 360 : null;
  return { rangeFt, rangeNm: rangeFt / FT_PER_NM, trueBearingDeg };
}

const pointOf = (stpt) => (stpt ? { stpt: stpt.stpt, name: stpt.name, action: stpt.action, actionName: stpt.actionName, northFt: stpt.northFt, eastFt: stpt.eastFt, elevationFt: stpt.elevationFt } : null);
const labelOf = (stpt) => `STPT ${stpt.stpt}${stpt.name ? ` ${stpt.name}` : stpt.actionName ? ` ${stpt.actionName}` : ""}`;

// The owner's rules (2026-11-12):
// - TGT: the lowest-numbered user target (coordinates + action −1); none → the first route attack waypoint (14–19);
//   neither → the user is asked (target null, needs.target true).
// - IP: the steerpoint just before the route's attack waypoint (not TGT − 1); the attack waypoint at STPT 1 or none →
//   the user is asked (needs.ip true). No IP-distance warning: a VRP beyond the IP is handled by the Offset own-IP rule.
// options.targetStpt / ipStpt: the user's own choice, used when that steerpoint has coordinates.
export function resolveBmsMission(parsed, { targetStpt = null, ipStpt = null } = {}) {
  if (!parsed?.steerpoints) throw new TypeError("a parsed callsign ini is required");
  const set = parsed.steerpoints.filter((stpt) => stpt.set);
  const byNumber = (number) => set.find((stpt) => stpt.stpt === Number(number)) ?? null;
  const route = set.filter((stpt) => stpt.route);
  const userTargets = set.filter((stpt) => stpt.user);
  const routeAttack = route.find((stpt) => stpt.attack) ?? null;
  const messages = [];
  const warnings = [];
  const errors = [];

  if (!parsed.hasStpt) errors.push("No [STPT] section: choose the callsign ini (User\\Config\\<callsign>.ini) after a DTC SAVE");
  else if (!set.length) errors.push("The [STPT] section has no steerpoints: press DTC SAVE in BMS, then load the file again");
  if (parsed.hasStpt && set.length && !routeAttack) warnings.push("The route has no attack waypoint (GND Strike … SEAD): check that this DTC is your mission's");

  let target = null;
  let targetSource = null;
  if (targetStpt !== null && targetStpt !== undefined && targetStpt !== "") {
    target = byNumber(targetStpt);
    targetSource = "user";
    if (!target) errors.push(`STPT ${targetStpt} has no coordinates`);
  } else if (userTargets.length) {
    target = userTargets[0];
    targetSource = "user-target";
  } else if (routeAttack) {
    target = routeAttack;
    targetSource = "route-attack";
  }
  if (target && targetSource !== "user") messages.push(`${labelOf(target)} is set as the target point`);

  let ip = null;
  let ipSource = null;
  if (ipStpt !== null && ipStpt !== undefined && ipStpt !== "") {
    ip = byNumber(ipStpt);
    ipSource = "user";
    if (!ip) errors.push(`STPT ${ipStpt} has no coordinates`);
  } else if (routeAttack) {
    const before = route.filter((stpt) => stpt.stpt < routeAttack.stpt);
    ip = before.length ? before[before.length - 1] : null;
    ipSource = ip ? "before-route-attack" : null;
  }
  if (ip && ipSource !== "user") messages.push(`${labelOf(ip)} is set as the IP (the steerpoint before ${labelOf(routeAttack)})`);
  if (ip && target && ip.stpt === target.stpt) errors.push("IP and TGT are the same steerpoint");

  const ipToTarget = ip && target && ip.stpt !== target.stpt ? bearingRange(ip, target) : null;
  if (ipToTarget && !(ipToTarget.rangeFt > 0)) errors.push("IP and TGT are at the same place");
  const ready = Boolean(target && ip && ipToTarget && ipToTarget.rangeFt > 0 && !errors.length);
  return {
    model: { ...BMS_DTC_V0_1 },
    state: errors.length ? "INVALID" : !ready ? "INCOMPLETE" : warnings.length ? "WARNING" : "VALID",
    ready,
    needs: { target: !target, ip: !ip },
    target: pointOf(target),
    targetSource,
    ip: pointOf(ip),
    ipSource,
    routeAttack: pointOf(routeAttack),
    // IP → TGT: the Run-In (true; the FE converts M = T − Magnetic Var) and the IP Range.
    ipToTarget: ipToTarget ? { rangeFt: ipToTarget.rangeFt, rangeNm: ipToTarget.rangeNm, trueBearingDeg: ipToTarget.trueBearingDeg } : null,
    // Target Elevation = TGT −Z ft MSL (plan §2.1-6).
    targetElevationMslFt: target ? target.elevationFt : null,
    route: route.map(pointOf),
    userTargets: userTargets.map(pointOf),
    ppts: parsed.ppts.map((ppt) => ({ ...ppt })),
    routeSummary: route.map((stpt) => `${stpt.stpt} ${stpt.actionName}`).join(" → "),
    messages,
    warnings,
    errors,
  };
}

// ---- DTE write ----------------------------------------------------------------------------------------------------

// TBRG one decimal, 0.0 ≤ TBRG < 360.0 (BMS writes "23.6", "350.0"); RNG and ELEV whole feet (plan §1.3).
export function bmsTbrgText(trueBearingDeg) {
  if (!Number.isFinite(trueBearingDeg)) throw new RangeError("TBRG must be a finite bearing");
  const text = ((((trueBearingDeg % 360) + 360) % 360)).toFixed(1);
  return text === "360.0" ? "0.0" : text;
}
function feetText(name, value) {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be a finite number of feet`);
  const text = String(Math.round(value));
  return text === "-0" ? "0" : text;
}
function pageValue(name, page) {
  if (!page || typeof page !== "object") throw new TypeError(`${name} is required`);
  if (!(page.rangeFt >= 0)) throw new RangeError(`${name} RNG must be ≥ 0 ft`);
  return `${bmsTbrgText(page.tbrgDeg)},${feetText(`${name} RNG`, page.rangeFt)},${feetText(`${name} ELEV`, page.elevationFt)}`;
}

// The lines a DTE write puts in [NAV OFFSETS] (owner 2026-11-11, plan §2.2-3/4): Modesel, the page of the mode with the
// TGT steerpoint number, and OA1-<TGT>. Offset's OA2 is N/A and is not written (no 0 ft point).
// reference / oa1: { tbrgDeg (true), rangeFt, elevationFt } — the DED values.
export function bmsNavOffsetLines({ mode, targetStpt, reference, oa1 }) {
  const page = String(mode ?? "").toUpperCase();
  if (page !== "VRP" && page !== "VIP") throw new RangeError("mode must be VRP or VIP");
  const stpt = Number(targetStpt);
  if (!Number.isInteger(stpt) || stpt < 1 || stpt > 99) throw new RangeError("the TGT steerpoint must be 1–99");
  return [
    `Modesel=${page.toLowerCase()}`,
    `${page}=${stpt},${pageValue(page, reference)}`,
    `OA1-${stpt}=${pageValue("OA1", oa1)}`,
  ];
}

// Rewrites [NAV OFFSETS]: the offset lines go, Modesel is replaced (or added) and `write` lines take the place of the
// first line removed (or follow the header). No [NAV OFFSETS] section: one is added at the end. Returns { text,
// removed: [line], written: [line] }.
function rewriteNavOffsets(text, write) {
  if (typeof text !== "string") throw new TypeError("the callsign ini text is required");
  const eol = lineEndingOf(text);
  const lines = splitLines(text);
  const section = sectionsOf(lines).find((item) => item.name.toUpperCase() === "NAV OFFSETS");
  const removed = [];
  if (!section) {
    if (!write.length) return { text, removed, written: [] };
    const trailing = lines.length && lines[lines.length - 1] === "";
    const body = trailing ? lines.slice(0, -1) : lines;
    const out = [...body, "[NAV OFFSETS]", ...write];
    return { text: out.join(eol) + (trailing ? eol : ""), removed, written: [...write] };
  }
  const replacesModesel = write.some((line) => /^modesel=/i.test(line));
  const kept = [];
  let insertAt = null;
  for (let index = section.start + 1; index < section.end; index += 1) {
    const line = lines[index];
    const entry = keyValue(line);
    const drop = entry && (OFFSET_KEY.test(entry.key) || (replacesModesel && entry.key.toLowerCase() === "modesel"));
    if (drop) {
      removed.push(line);
      if (insertAt === null) insertAt = kept.length;
    } else kept.push(line);
  }
  // Blank lines at the section's end stay after the written lines.
  let tail = kept.length;
  while (tail > 0 && kept[tail - 1].trim() === "") tail -= 1;
  const at = insertAt === null ? tail : Math.min(insertAt, tail);
  const sectionLines = [...kept.slice(0, at), ...write, ...kept.slice(at)];
  const out = [...lines.slice(0, section.start + 1), ...sectionLines, ...lines.slice(section.end)];
  return { text: out.join(eol), removed, written: [...write] };
}

export function patchBmsNavOffsets(text, values) {
  const write = bmsNavOffsetLines(values);
  return rewriteNavOffsets(text, write);
}

// DTE reference-point Clear (owner 2026-11-11): only the VIP / VIPPUP / VRP / VRPPUP / OA1-* / OA2-* lines go.
export function clearBmsNavOffsets(text) {
  return rewriteNavOffsets(text, []);
}

// ---- bytes ↔ text -------------------------------------------------------------------------------------------------
// Latin-1 maps every byte to one character and back, so the lines the DTE does not touch keep their bytes whatever the
// file's code page (BMS writes ANSI). Names outside ASCII may display wrongly; they are written back unchanged.
export function bmsIniTextFromBytes(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = "";
  for (let index = 0; index < view.length; index += 0x8000) text += String.fromCharCode(...view.subarray(index, index + 0x8000));
  return text;
}
export function bmsIniBytesFromText(text) {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 0xff) throw new RangeError("the ini text has a character outside one byte");
    bytes[index] = code;
  }
  return bytes;
}
