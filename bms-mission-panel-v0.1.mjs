// BMS Mission (DTC) and DTE in the Save/Load tab (Offset index, owner 2026-11-11 / 2026-11-12; plan
// apps/bombing-calculator-v2/offset/work/bms-mission-dte-2026-11-11/PLAN.md §2.1, §2.2, §2.7; Offset FE SPEC
// "BMS mission and DTE — owner 2026-11-12"). The BE (AG/bombing/bms-mission/bms-dtc-v0.1.mjs) reads the callsign ini and
// writes its [NAV OFFSETS]; this module only reads and writes the file, shows the mission and puts it on #1 through
// the page's own fields (the same edits a user makes), so nothing here calculates.
import {
  BMS_DTC_V0_1,
  parseBmsDtc,
  resolveBmsMission,
  patchBmsNavOffsets,
  clearBmsNavOffsets,
  bmsIniTextFromBytes,
  bmsIniBytesFromText,
} from "./AG/bombing/bms-mission/bms-dtc-v0.1.mjs?v=0.1.0";
import { createHandleStore, fileTimeText, fileSizeText } from "./shared/flight-file-browser-v0.1.mjs?v=0.1.2";
import { currentMagVarDeg, magVarText, trueFromMagneticDeg } from "./shared/mag-var-v0.1.mjs?v=0.1.0";

export const BMS_MISSION_PANEL_V0_1 = Object.freeze({ id: "offset-bms-mission-panel-v0.1", version: "0.1.0", be: `${BMS_DTC_V0_1.id} ${BMS_DTC_V0_1.version}` });

const HANDLE_KEY = "bms-dtc";
const BACKUP_KEY = "bms-dtc.backup";
const SAVE_EXTENSION = "bmsMission";
// After a DTE write (owner 2026-11-11, plan §2.2-9).
const DTE_DONE = "BMS에서 DTC LOAD를 누르세요. 그 전에 DTC SAVE를 누르면 덮어써집니다.";
const norm360 = (deg) => ((deg % 360) + 360) % 360;
const escapeHtml = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// The callsign ini window: read and write on a PC browser with file access (Chrome / Edge); elsewhere read only and the
// DTE is downloaded (plan §2.2-10).
export function dtcFileAccess(win = globalThis) {
  if (typeof win?.showOpenFilePicker !== "function") return false;
  try {
    if (win.top && win.top !== win) void win.top.location.href;
  } catch {
    return false;
  }
  return true;
}

async function filePermission(handle, mode, request) {
  if (!handle) return "denied";
  try {
    const state = typeof handle.queryPermission === "function" ? await handle.queryPermission({ mode }) : "granted";
    if (state === "granted" || !request) return state;
    return typeof handle.requestPermission === "function" ? await handle.requestPermission({ mode }) : state;
  } catch {
    return "denied";
  }
}

export function bmsMissionPanelMarkup() {
  return `<div class="bms-mission-head"><h3 id="bms-mission-title">BMS Mission (DTC)</h3><span class="mode" id="bms-mission-state">DTC 없음</span></div>
<p class="flight-draft-note">BMS에서 DTC SAVE를 누른 뒤, <code>User\\Config\\&lt;콜사인&gt;.ini</code>(DTC)를 고르세요. 경로·표적을 읽어 TGT와 IP STPT를 정하고, <b>Apply to #1</b>은 #1의 IP(Run-In · Range, IP LOCK)와 Target Elevation을 바꿉니다. Attack Heading은 미션이 정하지 않습니다(Run-In이 바뀌면 지금처럼 형상 전체가 같이 돌아가니, 적용 뒤 Attack Heading을 확인하세요).</p>
<div class="save-actions">
  <button class="btn" id="bms-dtc-open" type="button" title="Choose the callsign ini (DTC)">Open DTC</button>
  <button class="btn" id="bms-dtc-reload" type="button" title="Read the same file again (after a DTC SAVE in BMS)" disabled>Read Again</button>
</div>
<p class="flight-draft-note" id="bms-dtc-file">DTC 파일: 없음</p>
<p class="flight-draft-note" id="bms-dtc-route" hidden></p>
<ul class="bms-mission-messages" id="bms-dtc-messages"></ul>
<div class="input-grid bms-mission-stpts">
  <label class="field"><span>TGT STPT</span><input id="bms-tgt-stpt" type="text" inputmode="numeric" value="" disabled><span class="unit" id="bms-tgt-note">-</span></label>
  <label class="field"><span>IP STPT</span><input id="bms-ip-stpt" type="text" inputmode="numeric" value="" disabled><span class="unit" id="bms-ip-note">-</span></label>
</div>
<p class="flight-draft-note" id="bms-mission-geometry">-</p>
<div class="save-actions">
  <button class="btn" id="bms-mission-apply" type="button" title="#1: Run-In Heading and IP Range from IP STPT → TGT STPT, IP LOCK, Target Elevation" disabled>Apply to #1</button>
  <button class="btn" id="bms-mission-release" type="button" title="Forget the mission (the inputs stay as they are)" disabled>Release Mission</button>
</div>
<p class="flight-draft-note" id="bms-mission-applied">미션: 적용 안 됨</p>
<div class="bms-mission-head"><h3 id="bms-dte-title">DTE (NAV OFFSETS)</h3></div>
<p class="flight-draft-note">DTE 적용은 고른 기체의 DED(VRP 또는 VIP, OA1)를 DTC의 <code>[NAV OFFSETS]</code>에 씁니다. 그 전에 이전 VIP · VIPPUP · VRP · VRPPUP · OA1 · OA2 줄을 모두 지웁니다(OA2는 Offset에서 N/A라 쓰지 않음). 다른 줄은 그대로 둡니다. 쓰기 전 파일을 한 번 보관해 두고 Undo로 되돌립니다.</p>
<div class="save-actions">
  <label class="field bms-dte-ship"><span>Ship</span><select id="bms-dte-ship" aria-label="Ship number for the DTE"><option value="1">#1</option></select></label>
  <button class="btn" id="bms-dte-write" type="button" disabled>Write DTE</button>
  <button class="btn" id="bms-dte-clear" type="button" title="Delete the VIP / VIPPUP / VRP / VRPPUP / OA1 / OA2 lines only" disabled>Clear DTE</button>
  <button class="btn" id="bms-dte-undo" type="button" title="Write back the file as it was before the last DTE write or Clear" disabled>Undo DTE</button>
</div>
<output id="bms-dte-status" class="status-message valid" role="status">-</output>
<table class="bms-file-table" aria-label="Files each Save/Load item reads and writes">
  <thead><tr><th>Item</th><th>Reads</th><th>Writes</th></tr></thead>
  <tbody>
    <tr><td>Save / Save As</td><td>-</td><td>Offset save (.html) + this browser</td></tr>
    <tr><td>Load</td><td>Offset save (.html)</td><td>this browser</td></tr>
    <tr><td>Load Default</td><td>-</td><td>- (this browser after Save)</td></tr>
    <tr><td>Open DTC / Apply to #1</td><td>callsign ini (DTC)</td><td>-</td></tr>
    <tr><td>Write / Clear / Undo DTE</td><td>callsign ini (DTC)</td><td>callsign ini <code>[NAV OFFSETS]</code> only</td></tr>
  </tbody>
</table>`;
}

// root: the panel's container in the Save/Load tab. offsetUi: the controller's index hooks (offsetIndexUi).
export function mountBmsMissionPanel({ root, offsetUi, doc = globalThis.document, win = globalThis, store = createHandleStore({ win }) }) {
  if (!root || root.dataset.mounted) return null;
  root.dataset.mounted = "true";
  root.innerHTML = bmsMissionPanelMarkup();
  const $ = (selector) => root.querySelector(selector);
  const page = (selector) => doc.querySelector(selector);
  const access = dtcFileAccess(win);

  // The loaded DTC: { name, lastModified, size, text, handle | null }, its parse and the mission resolved from it.
  let dtc = null;
  let parsed = null;
  let mission = null;
  // The user's own TGT / IP STPT (typed); kept when the same file is read again, cleared by Open DTC.
  let overrides = {};
  // The mission put on #1 (kept by Save, released by a Default): { fileName, targetStpt, ipStpt, ... }.
  let applied = offsetUi.savedExtension(SAVE_EXTENSION) ?? null;
  let backup = null;
  let busy = false;

  const setStatus = (text, kind = "valid") => {
    const out = $("#bms-dte-status");
    out.textContent = text;
    out.className = `status-message ${kind}`;
  };

  function shipOptions() {
    const select = $("#bms-dte-ship");
    const size = Math.max(1, Math.min(4, Number(offsetUi.flightSize?.() ?? 1)));
    const current = Number(select.value) || 1;
    if (select.options.length !== size) {
      select.innerHTML = Array.from({ length: size }, (_, index) => `<option value="${index + 1}">#${index + 1}</option>`).join("");
      select.value = String(Math.min(current, size));
    }
  }

  function entryOf(number) {
    return offsetUi.flightAnswer()?.output?.aircraftResults?.[number] ?? null;
  }

  function render() {
    shipOptions();
    const magVar = currentMagVarDeg();
    $("#bms-dtc-file").textContent = !dtc
      ? "DTC 파일: 없음"
      : !parsed
        ? `DTC 파일: ${dtc.name} (지난번 파일 · Read Again으로 읽기)`
        : `DTC 파일: ${dtc.name} · ${fileTimeText(dtc.lastModified)} · ${fileSizeText(dtc.size)}${dtc.handle ? "" : " · 읽기 전용(DTE는 내려받기)"}`;
    $("#bms-dtc-reload").disabled = !dtc || busy;
    $("#bms-dtc-open").disabled = busy;
    const route = $("#bms-dtc-route");
    route.hidden = !mission?.routeSummary;
    route.textContent = mission?.routeSummary ? `경로: ${mission.routeSummary}${mission.userTargets.length ? ` · 사용자 표적 STPT ${mission.userTargets.map((p) => p.stpt).join(", ")}` : ""}` : "";
    const list = $("#bms-dtc-messages");
    const items = mission ? [
      ...mission.messages.map((text) => ["info", text]),
      ...mission.warnings.map((text) => ["warning", `WARNING · ${text}`]),
      ...mission.errors.map((text) => ["invalid", `INVALID · ${text}`]),
      ...(mission.needs.target ? [["warning", "TGT STPT를 입력하세요"]] : []),
      ...(mission.needs.ip ? [["warning", "IP STPT를 입력하세요"]] : []),
    ] : [];
    list.innerHTML = items.map(([kind, text]) => `<li class="${kind}">${escapeHtml(text)}</li>`).join("");
    for (const [key, point] of [["tgt", mission?.target], ["ip", mission?.ip]]) {
      const input = $(`#bms-${key}-stpt`);
      input.disabled = !parsed || busy;
      if (doc.activeElement !== input) input.value = point ? String(point.stpt) : "";
      $(`#bms-${key}-note`).textContent = point ? `${point.name ?? point.actionName ?? "Not set"} · ${Math.round(point.elevationFt)} ft` : "-";
    }
    const g = mission?.ipToTarget;
    $("#bms-mission-geometry").textContent = g
      ? `IP STPT ${mission.ip.stpt} → TGT STPT ${mission.target.stpt}: ${g.rangeNm.toFixed(2)} NM · Run-In ${norm360(g.trueBearingDeg - magVar).toFixed(1)}° M (${g.trueBearingDeg.toFixed(1)}° T, Magnetic Var ${magVarText(magVar)}) · Target Elevation ${Math.round(mission.targetElevationMslFt)} ft`
      : "-";
    $("#bms-mission-apply").disabled = !mission?.ready || busy;
    $("#bms-mission-release").disabled = !applied || busy;
    $("#bms-mission-applied").textContent = applied
      ? `미션: TGT STPT ${applied.targetStpt} · IP STPT ${applied.ipStpt} (${applied.fileName}) · #1 IP LOCK${applied.loaded ? " · 세이브에서" : ""}`
      : "미션: 적용 안 됨";
    const state = $("#bms-mission-state");
    state.textContent = applied ? "MISSION" : mission ? mission.state : "DTC 없음";
    const ready = !!dtc && !!mission?.target && !busy;
    $("#bms-dte-write").disabled = !ready;
    $("#bms-dte-clear").disabled = !parsed || busy;
    $("#bms-dte-undo").disabled = !backup || !parsed || busy;
  }

  function resolve() {
    mission = parsed ? resolveBmsMission(parsed, overrides) : null;
  }
  // A typed number different from the rule's is the user's choice; an empty field goes back to the rule.
  function takeOverride(key, field) {
    const text = field.value.trim();
    const name = key === "tgt" ? "targetStpt" : "ipStpt";
    if (!text) delete overrides[name];
    else overrides[name] = Number(text);
    resolve();
  }

  async function readFile(file, handle) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = bmsIniTextFromBytes(bytes);
    dtc = { name: file.name, lastModified: file.lastModified, size: file.size, text, handle: handle ?? null };
    parsed = parseBmsDtc(text);
    mission = null;
    resolve();
    return dtc;
  }

  async function freshText() {
    // The file now (the user may have pressed DTC SAVE since it was read).
    if (dtc?.handle) {
      if (await filePermission(dtc.handle, "readwrite", true) !== "granted") throw new Error("파일 권한이 없습니다");
      const file = await dtc.handle.getFile();
      await readFile(file, dtc.handle);
    }
    return dtc.text;
  }

  async function openDtc() {
    try {
      overrides = {};
      if (access) {
        const [handle] = await win.showOpenFilePicker({ types: [{ description: "BMS callsign ini (DTC)", accept: { "text/plain": [".ini"] } }], multiple: false });
        if (!handle) return;
        await readFile(await handle.getFile(), handle);
        await store.set(HANDLE_KEY, handle);
      } else {
        const input = doc.createElement("input");
        input.type = "file";
        input.accept = ".ini";
        const file = await new Promise((resolveFile) => {
          input.addEventListener("change", () => resolveFile(input.files?.[0] ?? null), { once: true });
          input.click();
        });
        if (!file) return;
        await readFile(file, null);
      }
      setStatus(`DTC 읽음 · ${dtc.name}`, mission?.state === "INVALID" ? "invalid" : "valid");
    } catch (error) {
      if (error?.name !== "AbortError") setStatus(`DTC를 읽지 못했습니다 · ${error?.message ?? error}`, "invalid");
    }
  }

  async function readAgain() {
    if (!dtc) return;
    try {
      if (dtc.handle) {
        if (await filePermission(dtc.handle, "read", true) !== "granted") { setStatus("파일 읽기 권한이 없습니다", "invalid"); return; }
        await readFile(await dtc.handle.getFile(), dtc.handle);
        setStatus(`DTC 다시 읽음 · ${dtc.name} · ${fileTimeText(dtc.lastModified)}`);
      } else await openDtc();
    } catch (error) {
      setStatus(`DTC를 읽지 못했습니다 · ${error?.message ?? error}`, "invalid");
    }
  }

  // The page's own field edit (the same events a user's typing makes), answered before the next.
  async function editField(selector, value) {
    const field = page(selector);
    if (!field) throw new Error(`${selector} is not on this page`);
    field.focus();
    field.value = String(value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.blur();
    await offsetUi.whenIdle();
  }
  const ipLocked = () => page("#ip-lock-btn")?.getAttribute("aria-pressed") === "true";
  async function lockIp() {
    if (ipLocked()) return;
    page("#ip-lock-btn").click();
    await offsetUi.whenIdle();
  }

  // Plan §2.1-4/5/6: IP LOCK, Run-In Heading = IP STPT → TGT STPT (M = T − Magnetic Var), IP Range, Target Elevation.
  // The IP is locked first so the IP Range is kept as entered (an unlocked IP inside VRP would be re-linked).
  async function applyToLead() {
    if (!mission?.ready) return;
    busy = true;
    render();
    try {
      const magVar = currentMagVarDeg();
      const g = mission.ipToTarget;
      const runInMagneticDeg = norm360(g.trueBearingDeg - (Number.isFinite(magVar) ? magVar : 0));
      await offsetUi.whenIdle();
      page("#ip-to-target-btn")?.click();
      await lockIp();
      await editField("#ip-bearing-input", runInMagneticDeg.toFixed(1));
      await editField('[data-key="ipRangeNm"]', g.rangeNm.toFixed(2));
      await editField('[data-key="targetElevationMslFt"]', String(Math.round(mission.targetElevationMslFt)));
      await lockIp();
      applied = {
        fileName: dtc.name,
        targetStpt: mission.target.stpt,
        targetName: mission.target.name,
        ipStpt: mission.ip.stpt,
        targetNorthFt: mission.target.northFt,
        targetEastFt: mission.target.eastFt,
        targetElevationMslFt: mission.targetElevationMslFt,
        ipRangeNm: g.rangeNm,
        runInTrueDeg: g.trueBearingDeg,
        runInMagneticDeg,
        magVarDeg: magVar,
        appliedAt: new Date().toISOString(),
      };
      setStatus(`#1에 적용 · TGT STPT ${applied.targetStpt} · IP STPT ${applied.ipStpt} · Run-In ${runInMagneticDeg.toFixed(1)}° M · IP ${g.rangeNm.toFixed(2)} NM (IP LOCK) · Target Elevation ${Math.round(mission.targetElevationMslFt)} ft`);
    } catch (error) {
      setStatus(`#1에 적용하지 못했습니다 · ${error?.message ?? error}`, "invalid");
    } finally {
      busy = false;
      render();
    }
  }

  function release(reason = null) {
    if (!applied) return;
    applied = null;
    if (reason) setStatus(`미션 해제 · ${reason}`);
    render();
  }

  // The DED record of ship n as BMS's DTE takes it: TBRG true (M + Magnetic Var), RNG / ELEV ft (plan §2.2-3).
  function dteValues(number) {
    const entry = entryOf(number);
    if (!entry?.result) return { error: `#${number} has no current result` };
    if (entry.status === "INVALID" || entry.status === "FAILED") return { error: `#${number} is INVALID: the DTE is not written` };
    const ded = entry.ded;
    if (!ded?.reference || !ded?.oa1) return { error: `#${number} has no DED` };
    const magVar = currentMagVarDeg();
    const dtePage = (record) => ({ tbrgDeg: trueFromMagneticDeg(record.bearingDeg, magVar), rangeFt: record.rangeFt, elevationFt: record.elevationFt });
    return { mode: ded.page === "VIP" ? "VIP" : "VRP", reference: dtePage(ded.reference), oa1: dtePage(ded.oa1) };
  }

  async function writeText(text, label) {
    const bytes = bmsIniBytesFromText(text);
    if (dtc.handle) {
      if (await filePermission(dtc.handle, "readwrite", true) !== "granted") throw new Error("파일 쓰기 권한이 없습니다");
      const writable = await dtc.handle.createWritable();
      try {
        await writable.write(new Blob([bytes], { type: "text/plain" }));
        await writable.close();
      } catch (error) {
        try { await writable.abort?.(); } catch { /* closed */ }
        throw error;
      }
      const file = await dtc.handle.getFile();
      await readFile(file, dtc.handle);
      return `${label} · ${dtc.name}에 썼습니다. ${DTE_DONE}`;
    }
    // Phone, Safari, Firefox (plan §2.2-10): the changed callsign ini is downloaded; it replaces the one in User\Config.
    const url = URL.createObjectURL(new Blob([bytes], { type: "text/plain" }));
    const link = doc.createElement("a");
    link.href = url;
    link.download = dtc.name;
    doc.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    dtc = { ...dtc, text, size: bytes.length, lastModified: Date.now() };
    parsed = parseBmsDtc(text);
    return `${label} · 고친 ${dtc.name}을 내려받았습니다. User\\Config의 파일을 이것으로 바꾼 뒤 ${DTE_DONE}`;
  }

  async function keepBackup(text) {
    backup = { name: dtc.name, text, savedAt: new Date().toISOString() };
    try { await store.set(BACKUP_KEY, backup); } catch { /* memory copy only */ }
  }

  async function writeDte() {
    if (!dtc || !mission?.target) return;
    const number = Number($("#bms-dte-ship").value) || 1;
    const values = dteValues(number);
    if (values.error) { setStatus(values.error, "invalid"); return; }
    busy = true;
    render();
    try {
      await offsetUi.whenIdle();
      const current = dteValues(number);
      if (current.error) throw new Error(current.error);
      const before = await freshText();
      const targetStpt = mission.target.stpt;
      const { text, removed, written } = patchBmsNavOffsets(before, { ...current, targetStpt });
      await keepBackup(before);
      const message = await writeText(text, `DTE #${number} · ${written.join(" · ")} (지운 줄 ${removed.length})`);
      const unapplied = !applied || applied.targetStpt !== targetStpt ? " · 주의: 이 미션이 #1에 적용되지 않았습니다(Run-In이 미션 IP와 다를 수 있음)" : "";
      setStatus(`${message}${unapplied}`, unapplied ? "warning" : "valid");
    } catch (error) {
      setStatus(`DTE를 쓰지 못했습니다 · ${error?.message ?? error}`, "invalid");
    } finally {
      busy = false;
      render();
    }
  }

  async function clearDte() {
    if (!dtc) return;
    busy = true;
    render();
    try {
      const before = await freshText();
      const { text, removed } = clearBmsNavOffsets(before);
      if (!removed.length) { setStatus("지울 DTE 참조점이 없습니다"); return; }
      await keepBackup(before);
      setStatus(await writeText(text, `DTE Clear · 지운 줄 ${removed.length}`));
    } catch (error) {
      setStatus(`DTE를 지우지 못했습니다 · ${error?.message ?? error}`, "invalid");
    } finally {
      busy = false;
      render();
    }
  }

  async function undoDte() {
    if (!dtc || !backup) return;
    if (backup.name !== dtc.name) { setStatus(`보관본은 ${backup.name}의 것입니다`, "invalid"); return; }
    busy = true;
    render();
    try {
      const message = await writeText(backup.text, `DTE Undo · ${fileTimeText(Date.parse(backup.savedAt))} 이전으로`);
      backup = null;
      try { await store.delete(BACKUP_KEY); } catch { /* memory copy only */ }
      setStatus(message);
    } catch (error) {
      setStatus(`되돌리지 못했습니다 · ${error?.message ?? error}`, "invalid");
    } finally {
      busy = false;
      render();
    }
  }

  $("#bms-dtc-open").addEventListener("click", async () => { await openDtc(); render(); });
  $("#bms-dtc-reload").addEventListener("click", async () => { await readAgain(); render(); });
  for (const key of ["tgt", "ip"]) $(`#bms-${key}-stpt`).addEventListener("change", (event) => { takeOverride(key, event.currentTarget); render(); });
  $("#bms-mission-apply").addEventListener("click", applyToLead);
  $("#bms-mission-release").addEventListener("click", () => release("입력값은 그대로입니다"));
  $("#bms-dte-write").addEventListener("click", writeDte);
  $("#bms-dte-clear").addEventListener("click", clearDte);
  $("#bms-dte-undo").addEventListener("click", undoDte);

  // Save keeps the applied mission; a save loaded with one locks the IP again (owner 2026-11-11, plan §2.7-3).
  offsetUi.registerSaveExtension(SAVE_EXTENSION, { capture: () => (applied ? { ...applied, loaded: undefined } : null) });
  offsetUi.registerFileNameSuffix?.(() => (applied ? "DED" : null));
  // A Default puts back the IP and the headings, so the mission is released (plan §2.7-1): Load Default, #1's Offset
  // (Reference) Tab Default.
  offsetUi.onFlightDefaults(() => release("Load Default"));
  offsetUi.onLeadTabDefault?.((tab) => { if (tab === "offset" || tab === "reference") release("#1 Tab Default"); });
  offsetUi.onFlightAnswer(() => render());
  if (applied) {
    applied = { ...applied, loaded: true };
    offsetUi.whenIdle().then(lockIp).catch(() => {}).finally(render);
  }
  // The DTC window remembers the last file; its contents are read again on Read Again (the browser asks first).
  store.get(HANDLE_KEY).then((handle) => {
    if (!handle || dtc) return;
    dtc = { name: handle.name, lastModified: NaN, size: NaN, text: "", handle };
    render();
  }).catch(() => {});
  store.get(BACKUP_KEY).then((saved) => { if (saved?.text && !backup) { backup = saved; render(); } }).catch(() => {});
  render();
  return Object.freeze({
    state: () => ({ dtc: dtc ? { name: dtc.name, writable: !!dtc.handle } : null, mission, applied, backup: backup ? { name: backup.name, savedAt: backup.savedAt } : null }),
    readText: async (text, name = "TEST.ini") => { overrides = {}; return readFile({ name, lastModified: Date.now(), size: text.length, arrayBuffer: async () => bmsIniBytesFromText(text).buffer }, null).then(render); },
    applyToLead,
    writeDte,
    clearDte,
    undoDte,
  });
}
