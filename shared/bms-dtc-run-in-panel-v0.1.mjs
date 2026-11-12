// BMS DTC → Run-In of the pattern pages (BOX, Wheel, Wheel-BOX; owner 2026-11-12). The Save/Load tab reads the
// callsign ini (DTC) with the BMS Mission BE (AG/bombing/bms-mission), shows the TGT / IP steerpoints it chose, and
// Apply puts the IP → TGT Run-In (M = T − Magnetic Var) and IP Range in the page's Run-In fields and the TGT elevation in
// its Target Elevation (the page's own field edit). The Attack Heading stays the user's. No DTE is written here (the
// pattern pages have no VRP / VIP page); the Offset page has the DTE.
import { parseBmsDtc, resolveBmsMission, bmsIniTextFromBytes, bmsIniBytesFromText } from "../AG/bombing/bms-mission/bms-dtc-v0.1.mjs?v=0.1.0";
import { createHandleStore, fileTimeText, fileSizeText } from "./flight-file-browser-v0.1.mjs?v=0.1.2";
import { currentMagVarDeg, magVarText } from "./mag-var-v0.1.mjs?v=0.1.0";

export const BMS_DTC_RUN_IN_PANEL_V0_1 = Object.freeze({ id: "bms-dtc-run-in-panel-v0.1", version: "0.1.0" });

const HANDLE_KEY = "bms-dtc";
const norm360 = (deg) => ((deg % 360) + 360) % 360;
const escapeHtml = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function bmsDtcRunInPanelMarkup() {
  return `<div class="bms-mission-head"><h3>BMS Mission (DTC) → Run-In</h3><span class="mode" data-dtc-state>DTC 없음</span></div>
<p class="flight-draft-note">BMS에서 DTC SAVE를 누른 뒤 <code>User\\Config\\&lt;콜사인&gt;.ini</code>(DTC)를 고르세요. 경로와 표적에서 TGT · IP STPT를 정하고, <b>Apply Run-In</b>은 Run-In Heading(IP → TGT, MAG)과 IP Range를 패턴 탭에, TGT 고도를 Target Elevation에 넣습니다. Attack Heading은 그대로이고 패턴 계산도 바뀌지 않습니다. Run-In은 Top View에 진입선으로만 그립니다.</p>
<div class="save-actions">
  <button class="btn" type="button" data-dtc="open">Open DTC</button>
  <button class="btn" type="button" data-dtc="reload" disabled>Read Again</button>
</div>
<p class="flight-draft-note" data-dtc-file>DTC 파일: 없음</p>
<p class="flight-draft-note" data-dtc-route hidden></p>
<ul class="bms-mission-messages" data-dtc-messages></ul>
<div class="input-grid bms-mission-stpts">
  <label class="field"><span>TGT STPT</span><input data-dtc-stpt="targetStpt" type="text" inputmode="numeric" disabled><span class="unit" data-dtc-note="targetStpt">-</span></label>
  <label class="field"><span>IP STPT</span><input data-dtc-stpt="ipStpt" type="text" inputmode="numeric" disabled><span class="unit" data-dtc-note="ipStpt">-</span></label>
</div>
<p class="flight-draft-note" data-dtc-geometry>-</p>
<div class="save-actions"><button class="btn" type="button" data-dtc="apply" disabled>Apply Run-In</button></div>
<output class="status-message valid" role="status" data-dtc-status>-</output>`;
}

// root: the panel container; runIn: the page's createPatternRunIn(); whenIdle(): the page's answer wait (optional).
export function mountBmsDtcRunInPanel({ root, runIn, whenIdle = async () => {}, doc = globalThis.document, win = globalThis, store = createHandleStore({ win }) }) {
  if (!root || root.dataset.mounted) return null;
  root.dataset.mounted = "true";
  root.innerHTML = bmsDtcRunInPanelMarkup();
  const $ = (selector) => root.querySelector(selector);
  const access = typeof win?.showOpenFilePicker === "function";
  let dtc = null;
  let parsed = null;
  let mission = null;
  let overrides = {};
  let busy = false;

  const setStatus = (text, kind = "valid") => {
    const out = $("[data-dtc-status]");
    out.textContent = text;
    out.className = `status-message ${kind}`;
  };
  const resolve = () => { mission = parsed ? resolveBmsMission(parsed, overrides) : null; };

  function render() {
    const magVar = currentMagVarDeg();
    $("[data-dtc-file]").textContent = !dtc ? "DTC 파일: 없음" : !parsed ? `DTC 파일: ${dtc.name} (지난번 파일 · Read Again으로 읽기)` : `DTC 파일: ${dtc.name} · ${fileTimeText(dtc.lastModified)} · ${fileSizeText(dtc.size)}`;
    $('[data-dtc="reload"]').disabled = !dtc || busy;
    $('[data-dtc="open"]').disabled = busy;
    const route = $("[data-dtc-route]");
    route.hidden = !mission?.routeSummary;
    route.textContent = mission?.routeSummary ? `경로: ${mission.routeSummary}${mission.userTargets.length ? ` · 사용자 표적 STPT ${mission.userTargets.map((p) => p.stpt).join(", ")}` : ""}` : "";
    const items = mission ? [
      ...mission.messages.map((text) => ["info", text]),
      ...mission.warnings.map((text) => ["warning", `WARNING · ${text}`]),
      ...mission.errors.map((text) => ["invalid", `INVALID · ${text}`]),
      ...(mission.needs.target ? [["warning", "TGT STPT를 입력하세요"]] : []),
      ...(mission.needs.ip ? [["warning", "IP STPT를 입력하세요"]] : []),
    ] : [];
    $("[data-dtc-messages]").innerHTML = items.map(([kind, text]) => `<li class="${kind}">${escapeHtml(text)}</li>`).join("");
    for (const [key, point] of [["targetStpt", mission?.target], ["ipStpt", mission?.ip]]) {
      const input = $(`[data-dtc-stpt="${key}"]`);
      input.disabled = !parsed || busy;
      if (doc.activeElement !== input) input.value = point ? String(point.stpt) : "";
      $(`[data-dtc-note="${key}"]`).textContent = point ? `${point.name ?? point.actionName ?? "Not set"} · ${Math.round(point.elevationFt)} ft` : "-";
    }
    const g = mission?.ipToTarget;
    $("[data-dtc-geometry]").textContent = g
      ? `IP STPT ${mission.ip.stpt} → TGT STPT ${mission.target.stpt}: ${g.rangeNm.toFixed(2)} NM · Run-In ${norm360(g.trueBearingDeg - magVar).toFixed(1)}° M (${g.trueBearingDeg.toFixed(1)}° T, Magnetic Var ${magVarText(magVar)}) · Target Elevation ${Math.round(mission.targetElevationMslFt)} ft`
      : "-";
    $('[data-dtc="apply"]').disabled = !mission?.ready || busy;
    $("[data-dtc-state]").textContent = mission ? mission.state : "DTC 없음";
  }

  async function readFile(file, handle) {
    const text = bmsIniTextFromBytes(new Uint8Array(await file.arrayBuffer()));
    dtc = { name: file.name, lastModified: file.lastModified, size: file.size, text, handle: handle ?? null };
    parsed = parseBmsDtc(text);
    resolve();
  }

  async function open() {
    try {
      overrides = {};
      if (access) {
        const [handle] = await win.showOpenFilePicker({ types: [{ description: "BMS callsign ini (DTC)", accept: { "text/plain": [".ini"] } }], multiple: false });
        if (!handle) return;
        await readFile(await handle.getFile(), handle);
        try { await store.set(HANDLE_KEY, handle); } catch { /* not kept */ }
      } else {
        const input = doc.createElement("input");
        input.type = "file";
        input.accept = ".ini";
        const file = await new Promise((done) => { input.addEventListener("change", () => done(input.files?.[0] ?? null), { once: true }); input.click(); });
        if (!file) return;
        await readFile(file, null);
      }
      setStatus(`DTC 읽음 · ${dtc.name}`, mission?.state === "INVALID" ? "invalid" : "valid");
    } catch (error) {
      if (error?.name !== "AbortError") setStatus(`DTC를 읽지 못했습니다 · ${error?.message ?? error}`, "invalid");
    }
  }

  async function readAgain() {
    if (!dtc?.handle) { await open(); return; }
    try {
      const state = typeof dtc.handle.requestPermission === "function" ? await dtc.handle.requestPermission({ mode: "read" }) : "granted";
      if (state !== "granted") { setStatus("파일 읽기 권한이 없습니다", "invalid"); return; }
      await readFile(await dtc.handle.getFile(), dtc.handle);
      setStatus(`DTC 다시 읽음 · ${dtc.name}`);
    } catch (error) {
      setStatus(`DTC를 읽지 못했습니다 · ${error?.message ?? error}`, "invalid");
    }
  }

  // Run-In = IP → TGT, M = T − Magnetic Var; Target Elevation through the page's own field (as a user's edit).
  async function apply() {
    if (!mission?.ready) return;
    busy = true;
    render();
    try {
      const magVar = currentMagVarDeg();
      const g = mission.ipToTarget;
      const runInMagneticDeg = norm360(g.trueBearingDeg - (Number.isFinite(magVar) ? magVar : 0));
      runIn.set({ headingDeg: Number(runInMagneticDeg.toFixed(1)), ipRangeNm: Number(g.rangeNm.toFixed(2)) });
      const elevation = doc.querySelector('[data-key="targetElevationMslFt"]');
      if (elevation) {
        elevation.focus();
        elevation.value = String(Math.round(mission.targetElevationMslFt));
        elevation.dispatchEvent(new Event("input", { bubbles: true }));
        elevation.dispatchEvent(new Event("change", { bubbles: true }));
        elevation.blur();
        await whenIdle();
      }
      setStatus(`Run-In ${runInMagneticDeg.toFixed(1)}° M · IP ${g.rangeNm.toFixed(2)} NM (STPT ${mission.ip.stpt} → STPT ${mission.target.stpt})${elevation ? ` · Target Elevation ${Math.round(mission.targetElevationMslFt)} ft` : ""}. Attack Heading은 그대로입니다.`);
    } catch (error) {
      setStatus(`적용하지 못했습니다 · ${error?.message ?? error}`, "invalid");
    } finally {
      busy = false;
      render();
    }
  }

  root.addEventListener("click", async (event) => {
    const action = event.target.closest?.("[data-dtc]")?.dataset.dtc;
    if (action === "open") await open();
    else if (action === "reload") await readAgain();
    else if (action === "apply") { await apply(); return; }
    else return;
    render();
  });
  root.addEventListener("change", (event) => {
    const key = event.target?.dataset?.dtcStpt;
    if (!key) return;
    const text = event.target.value.trim();
    if (!text) delete overrides[key];
    else overrides[key] = Number(text);
    resolve();
    render();
  });
  store.get(HANDLE_KEY).then((handle) => { if (handle && !dtc) { dtc = { name: handle.name, handle }; render(); } }).catch(() => {});
  render();
  return Object.freeze({
    state: () => ({ dtc: dtc ? { name: dtc.name } : null, mission, overrides: { ...overrides } }),
    readText: async (text, name = "TEST.ini") => {
      overrides = {};
      await readFile({ name, lastModified: Date.now(), size: text.length, arrayBuffer: async () => bmsIniBytesFromText(text).buffer }, null);
      render();
    },
    apply,
  });
}
