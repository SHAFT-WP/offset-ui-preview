// Flight HTML file (owner 2026-11-05, over the 2026-10-27 Flight HTML Save/Load handoff §6–§9): one self-contained
// .html the user keeps in their own folders. It shows the briefing (vertical: Formation, Top Views, one set per aircraft
// of Z-Diagram · DED · Result with one Advanced switch) and carries the page's own save record as a JSON block that is
// never executed. No library, list or registration in the app (handoff §1).
//
// This module is page-neutral FE machinery: the HTML envelope and its CSS, reading the data block back, file names,
// the save / open calls and the in-app preview dialog. The page owns what goes in (its sections, its save record,
// its validation and how a record is applied). Nothing here calculates.

export const FLIGHT_HTML_FILE_V0_1 = Object.freeze({ id: "bombing-flight-html-file-v0.1", version: "0.1.2" });

export const FLIGHT_FILE_FORMAT = "flight-sim-tools-snapshot";
export const FLIGHT_FILE_SCHEMA_VERSION = 1;
const DATA_BLOCK_ID = "flight-sim-tools-snapshot";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// JSON inside <script type="application/json">: "<" is written as the escape \\u003c, so no text in it can close the block.
function dataBlockJson(envelope) {
  return JSON.stringify(envelope).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

// ---- File names (handoff §5) ---------------------------------------------------------------------------------
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]+/g;
// The final name: illegal characters out, one ".html" at the end; "" when nothing is left.
export function cleanFileName(name) {
  let base = String(name ?? "").replace(ILLEGAL, "_").trim().replace(/(\.html?)+$/i, "").trim().replace(/^\.+/, "");
  if (!base) return "";
  if (base.length > 150) base = base.slice(0, 150);
  return `${base}.html`;
}
// The first free name among `existing` (lower-case names): foo.html, then foo_2.html, foo_3.html, … (§5.3).
export function nextFreeFileName(name, existing) {
  const clean = cleanFileName(name);
  if (!clean) return "";
  const taken = new Set([...(existing ?? [])].map((item) => String(item).toLowerCase()));
  if (!taken.has(clean.toLowerCase())) return clean;
  const base = clean.slice(0, -5).replace(/_(\d+)$/, "");
  for (let n = 2; n < 10000; n += 1) {
    const candidate = `${base}_${n}.html`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return clean;
}

// ---- The HTML envelope ---------------------------------------------------------------------------------------
// Vertical only (owner 2026-11-05: "세로가 기본", "가로모드는 안쓸것"). The Advanced switch of a set is a CSS-only
// checkbox, so the file runs no script (and shows the same in the app's sandboxed preview).
const FILE_CSS = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:#eef1f4;color:#111;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.35}
.page{max-width:760px;margin:0 auto;padding:16px}
.head{background:#111827;color:#fff;border-radius:10px;padding:14px 16px}
.head h1{margin:0 0 6px;font-size:18px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all}
.head .facts{margin:0;display:flex;flex-wrap:wrap;gap:4px 16px;font-size:14px;color:#cbd5e1}
.head .facts b{color:#fff}
h2{margin:24px 0 10px;padding-bottom:6px;border-bottom:2px solid #111827;font-size:17px}
.card{background:#fff;border-radius:10px;padding:12px;margin-top:12px;box-shadow:0 1px 3px rgba(0,0,0,.15);break-inside:avoid}
.card h3{margin:0 0 8px;font-size:16px}
.card svg{display:block;width:100%;height:auto}
.frame{border:1px solid #d6dbe1;border-radius:6px;overflow:hidden;background:#fff}
.kv{display:flex;flex-wrap:wrap;gap:6px 24px;margin-top:10px;font-size:13px;color:#555}
.kv b{display:block;font-size:18px;color:#111}
.note{font-size:13px;color:#555;margin:6px 0 0}
.set{border-left:6px solid var(--c,#111827)}
.set-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}
.set-head h3{margin:0;color:var(--c,#111827)}
.state{margin-left:8px;padding:2px 8px;border-radius:5px;font-size:12px;vertical-align:middle;color:#fff;background:#15803d}
.state.bad{background:#b91c1c}.state.warn{background:#b45309}
.set>input{position:absolute;opacity:0;pointer-events:none}
.set .adv-label{padding:5px 12px;border:1px solid #9aa4b1;border-radius:6px;font-size:13px;cursor:pointer;user-select:none;background:#fff}
.set .adv-on,.set .adv-only{display:none}
.set>input:checked~.set-head .adv-label{background:#111827;color:#fff;border-color:#111827}
.set>input:checked~.set-head .adv-on{display:inline}
.set>input:checked~.set-head .adv-off{display:none}
.set>input:checked~.part .adv-only{display:block}
.set>input:checked~.part tr.adv-only{display:table-row}
.set>input:checked~.part .basic-only{display:none}
.set>input:focus-visible~.set-head .adv-label{outline:2px solid #2563eb;outline-offset:2px}
.part-title{font-size:12px;color:#555;margin:12px 0 4px}
.ded{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px}
.ded-box{background:#07120c;border:1px solid #2f6b45;border-radius:8px;padding:8px 10px;color:#9ef0af;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:15px}
.ded-box .t{font-weight:900;font-size:16px;padding-bottom:4px;margin-bottom:4px;border-bottom:1px solid rgba(158,240,175,.3)}
.ded-box .r{display:flex;gap:10px}.ded-box .r span:first-child{min-width:3.6em;opacity:.85}
.result{background:#000;color:#fff;border-radius:8px;padding:8px 12px;font-size:14px}
.result h4{margin:8px 0 4px;font-size:14px;border-bottom:1px solid #444;padding-bottom:3px}
.result table{border-collapse:collapse;width:100%}
.result td{padding:2px 4px;vertical-align:top}
.result td:last-child{font-weight:700}
.empty{color:#b45309;font-size:14px}
.foot{margin:18px 0 6px;font-size:12px;color:#666;text-align:center}
@media print{body{background:#fff}.page{max-width:none}.set .adv-label{display:none}.card{box-shadow:none;border:1px solid #ccc}}
`;

// sections: [{ heading, cards: [html] }] (the page builds each card's markup and escapes its text); facts: [[label,
// value]]; envelope: the data block (format, schemaVersion, tool, scope, …, record). Returns the whole document.
export function buildFlightHtml({ title, facts = [], sections = [], envelope, footer = "" }) {
  const factHtml = facts.filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([label, value]) => `<span>${escapeHtml(label)} <b>${escapeHtml(value)}</b></span>`).join("");
  const body = sections.map((section) => `<h2>${escapeHtml(section.heading)}</h2>${section.cards.join("")}`).join("\n");
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="flight-sim-tools ${escapeHtml(FLIGHT_HTML_FILE_V0_1.id)} ${escapeHtml(FLIGHT_HTML_FILE_V0_1.version)}">
<title>${escapeHtml(title)}</title>
<style>${FILE_CSS}</style>
</head>
<body>
<main class="page">
<header class="head"><h1>${escapeHtml(title)}</h1><p class="facts">${factHtml}</p></header>
${body}
<p class="foot">${escapeHtml(footer)}</p>
</main>
<script type="application/json" id="${DATA_BLOCK_ID}">${dataBlockJson(envelope)}</script>
</body>
</html>
`;
}

// A card around page markup.
export const cardHtml = (inner, { heading = "", className = "" } = {}) => `<section class="card${className ? ` ${className}` : ""}">${heading ? `<h3>${escapeHtml(heading)}</h3>` : ""}${inner}</section>`;

// One aircraft's set: Z (basic + advanced), DED boxes, Result rows (rows marked adv-only show with Advanced).
export function aircraftSetHtml({ number, color, zBasic, zAdvanced, ded, result, missing = "", state = "" }) {
  const id = `adv-${number}`;
  const tone = /INVALID/i.test(state) ? "bad" : /WARN/i.test(state) ? "warn" : "ok";
  const chip = state ? ` <span class="state ${tone}">${escapeHtml(state)}</span>` : "";
  const head = `<input type="checkbox" id="${id}" aria-label="Advanced #${number}"><div class="set-head"><h3>#${number}${chip}</h3><label class="adv-label" for="${id}"><span class="adv-off">Advanced: Off</span><span class="adv-on">Advanced: On</span></label></div>`;
  if (missing) return `<section class="card set" style="--c:${escapeHtml(color)}">${head}<p class="empty">${escapeHtml(missing)}</p></section>`;
  const z = `<div class="part"><div class="part-title">Z-Diagram</div><div class="frame basic-only">${zBasic}</div><div class="frame adv-only">${zAdvanced}</div></div>`;
  const dedPart = ded ? `<div class="part"><div class="part-title">DED</div>${ded}</div>` : "";
  const resultPart = result ? `<div class="part"><div class="part-title">Result</div><div class="result">${result}</div></div>` : "";
  return `<section class="card set" style="--c:${escapeHtml(color)}">${head}${z}${dedPart}${resultPart}</section>`;
}

// DED boxes from shared ded-v0.1.mjs readDedCard: { boxes: [{ title, rows: [[label, text]] }] } (up to four pages).
export function dedBoxesHtml(card) {
  if (!card?.boxes?.length) return "";
  return `<div class="ded">${card.boxes.map((box) => `<div class="ded-box"><div class="t">${escapeHtml(box.title)}</div>${box.rows.map(([label, text]) => `<div class="r"><span>${escapeHtml(label)}</span><span>${escapeHtml(text)}</span></div>`).join("")}</div>`).join("")}</div>`;
}

// Result groups from the page's Result rows ({ title, rows: [{ label, value, summary }] }); a row that the page's
// summary would hide is shown with Advanced only.
export function resultGroupsHtml(groups) {
  return groups.filter((group) => group.rows.length).map((group) => {
    const shown = group.rows.some((row) => row.summary);
    const rows = group.rows.map((row) => `<tr${row.summary ? "" : ' class="adv-only"'}><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.value)}</td></tr>`).join("");
    return `<div class="${shown ? "" : "adv-only"}"><h4>${escapeHtml(group.title)}</h4><table><tbody>${rows}</tbody></table></div>`;
  }).join("");
}

// ---- Reading a file back (handoff §9) ------------------------------------------------------------------------
// Only the data block is read (text search, no HTML parsing, nothing executed). Result: { ok: true, envelope } or
// { ok: false, error } with a reason the page shows. `tool` must match (a POP-UP file is not loaded into Offset).
export function readFlightHtml(text, { tool, scopes = ["flight", "lead-only"] } = {}) {
  if (typeof text !== "string" || !text.length) return { ok: false, error: "The file is empty" };
  const match = text.match(new RegExp(`<script[^>]*\\bid=["']${DATA_BLOCK_ID}["'][^>]*>([\\s\\S]*?)</script>`, "i"));
  if (!match) return { ok: false, error: "Not a Flight file saved by this app (no data block)" };
  let envelope;
  try {
    envelope = JSON.parse(match[1]);
  } catch {
    return { ok: false, error: "The file's data block is damaged" };
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || envelope.format !== FLIGHT_FILE_FORMAT) return { ok: false, error: "Not a Flight file saved by this app" };
  if (!Number.isInteger(envelope.schemaVersion)) return { ok: false, error: "The file has no format version" };
  if (envelope.schemaVersion > FLIGHT_FILE_SCHEMA_VERSION) return { ok: false, error: "The file uses a newer format; reload the latest app" };
  if (envelope.schemaVersion < 1) return { ok: false, error: "Unknown file format version" };
  if (tool && envelope.tool !== tool) return { ok: false, error: `This file is for ${String(envelope.tool ?? "another tool").toUpperCase()}, not ${String(tool).toUpperCase()}` };
  if (!scopes.includes(envelope.scope)) return { ok: false, error: "The file's scope is not supported here" };
  if (!envelope.record || typeof envelope.record !== "object" || Array.isArray(envelope.record)) return { ok: false, error: "The file holds no saved conditions" };
  return { ok: true, envelope };
}

// ---- Writing and opening files (handoff §7) ------------------------------------------------------------------
// Feature detection, not browser names. With the save picker (Chrome / Edge on PC) the system dialog shows the path,
// takes a pasted path, remembers the last folder (id) and asks before replacing a file. Elsewhere the file is
// downloaded: the browser / OS decides the folder and a duplicate name, so the status says "download requested".
// How Save writes on this browser (owner 2026-11-05, "저장 경로도 선택할 수 있게"): "picker" = the system save
// window (folder and name; Chrome / Edge on PC), "share" = the share menu with the file (phones and tablets: iPhone
// "파일에 저장" / Android "Files" pick the folder), "download" = the browser's download folder (Safari / Firefox on PC;
// the browser's own "ask where to save" setting turns it into a save window).
export function saveMethod(win = globalThis) {
  if (typeof win.showSaveFilePicker === "function") return "picker";
  try {
    const touch = typeof win.matchMedia === "function" && win.matchMedia("(pointer: coarse)").matches;
    const probe = typeof win.File === "function" ? new win.File(["x"], "probe.html", { type: "text/html" }) : null;
    if (touch && probe && typeof win.navigator?.share === "function" && win.navigator.canShare?.({ files: [probe] })) return "share";
  } catch { /* no share */ }
  return "download";
}
export const SAVE_METHOD_HINT = Object.freeze({
  picker: "Save → 저장 창에서 폴더와 이름을 고릅니다.",
  share: "Save → 공유 메뉴에서 '파일에 저장'(iPhone) / '파일' 또는 '내 파일'(Android)을 고르면 저장할 폴더를 선택할 수 있습니다.",
  download: "이 브라우저는 다운로드 폴더에 저장합니다. 매번 폴더를 고르려면 브라우저 설정 → 다운로드 → '다운로드 전에 저장 위치 확인'을 켜 주세요. (Chrome / Edge PC에서는 저장 창이 바로 열립니다)",
});

export async function saveHtmlFile(text, fileName, { win = globalThis } = {}) {
  const name = cleanFileName(fileName);
  if (!name) return { status: "error", error: "Enter a file name" };
  if (saveMethod(win) === "share") {
    try {
      await win.navigator.share({ files: [new win.File([text], name, { type: "text/html" })], title: name.slice(0, -5) });
      return { status: "shared", name };
    } catch (error) {
      if (error?.name === "AbortError") return { status: "cancelled" };
      // Not allowed here (no user gesture, policy): the download below still saves the file.
    }
  }
  if (typeof win.showSaveFilePicker === "function") {
    let handle;
    try {
      handle = await win.showSaveFilePicker({ id: "flight-sim-tools-flight", suggestedName: name, startIn: "documents", types: [{ description: "Flight HTML", accept: { "text/html": [".html"] } }] });
    } catch (error) {
      if (error?.name === "AbortError") return { status: "cancelled" };
      if (error?.name !== "SecurityError" && error?.name !== "NotAllowedError") return { status: "error", error: error?.message || "The save dialog failed" };
      handle = null;
    }
    if (handle) {
      try {
        const writable = await handle.createWritable();
        await writable.write(new Blob([text], { type: "text/html" }));
        await writable.close();
        return { status: "saved", name: handle.name ?? name };
      } catch (error) {
        return { status: "error", error: error?.message || "The file could not be written" };
      }
    }
  }
  const doc = win.document;
  const url = win.URL.createObjectURL(new Blob([text], { type: "text/html" }));
  const link = doc.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  doc.body.append(link);
  link.click();
  link.remove();
  win.setTimeout(() => win.URL.revokeObjectURL(url), 30000);
  return { status: "downloaded", name };
}

// Opens one .html with the system file dialog: { status: "opened", name, text } | { status: "cancelled" } | error.
export function openHtmlFile({ win = globalThis } = {}) {
  const doc = win.document;
  return new Promise((resolve) => {
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = ".html,.htm,text/html";
    input.style.display = "none";
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return done({ status: "cancelled" });
      if (file.size > 32 * 1024 * 1024) return done({ status: "error", error: "The file is too large for a Flight file" });
      try {
        done({ status: "opened", name: file.name, text: await file.text() });
      } catch (error) {
        done({ status: "error", error: error?.message || "The file could not be read" });
      }
    });
    input.addEventListener("cancel", () => done({ status: "cancelled" }));
    doc.body.append(input);
    input.click();
  });
}

// ---- In-app preview (handoff §6) -----------------------------------------------------------------------------
// A dialog inside the page (no pop-up window): a wide modal on PC, full screen on a phone. It shows either the
// current conditions as they would be saved (file name + Save) or a file the user opened (Load). The document is shown
// in a sandboxed iframe without scripts, so a file's own markup can never run anything in the app.
const DIALOG_CSS = `
.flight-file-dialog{width:min(980px,96vw);height:min(92vh,1200px);max-width:none;max-height:none;padding:0;border:1px solid #334155;border-radius:12px;background:#0f172a;color:#e2e8f0}
.flight-file-dialog::backdrop{background:rgba(2,6,23,.65)}
.flight-file-dialog .ffd{display:flex;flex-direction:column;height:100%}
.flight-file-dialog .ffd-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #334155}
.flight-file-dialog .ffd-mode{font-weight:700;font-size:14px;margin-right:auto}
.flight-file-dialog .ffd-name{display:flex;align-items:center;gap:6px;flex:1 1 320px;min-width:0}
.flight-file-dialog .ffd-name input{flex:1;min-width:0;font:inherit;font-size:14px;padding:7px 9px;border-radius:6px;border:1px solid #475569;background:#020617;color:#e2e8f0}
.flight-file-dialog .ffd-actions{display:flex;flex-wrap:wrap;gap:6px}
.flight-file-dialog button{font:inherit;font-size:14px;padding:7px 14px;border-radius:6px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;cursor:pointer}
.flight-file-dialog button.primary{background:#2563eb;border-color:#2563eb;color:#fff}
.flight-file-dialog button:disabled{opacity:.45;cursor:not-allowed}
.flight-file-dialog .ffd-status{padding:6px 12px;font-size:13px;min-height:1.6em;border-bottom:1px solid #334155}
.flight-file-dialog .ffd-status.invalid{color:#fca5a5}.flight-file-dialog .ffd-status.warning{color:#fcd34d}.flight-file-dialog .ffd-status.valid{color:#86efac}
.flight-file-dialog .ffd-hint{padding:6px 12px;font-size:12px;color:#cbd5e1;border-bottom:1px solid #334155}.flight-file-dialog .ffd-hint[hidden]{display:none}
.flight-file-dialog .ffd-preview{flex:1;display:flex;flex-direction:column;min-height:0}.flight-file-dialog .ffd-preview[hidden]{display:none}
.flight-file-dialog .ffd-preview-label{padding:5px 12px;font-size:13px;font-weight:700;color:#e2e8f0;background:#1e293b;border-bottom:1px solid #334155}
.flight-file-dialog iframe{flex:1;width:100%;border:0;background:#eef1f4}
.flight-file-dialog:not(.has-preview){height:fit-content}
@media (max-width:700px){.flight-file-dialog{width:100vw;max-width:100vw;border-radius:0;margin:0}.flight-file-dialog.has-preview{height:100dvh;max-height:100dvh}.flight-file-dialog:not(.has-preview){margin:auto 0 0}}
`;

// build(): { fileName, render(title) → html, notice? } for the current conditions (may throw / reject: the reason is
// shown); the document is made again with the final file name as its title when Save is pressed.
// apply(envelope, fileName): applies an opened file's record; resolves { ok, message }.
// read(text): readFlightHtml bound to the page's tool.
export function installFlightFileDialog({ trigger, build, apply, read, doc = globalThis.document, win = globalThis }) {
  if (!trigger) return null;
  if (!doc.getElementById("flight-file-dialog-style")) {
    const style = doc.createElement("style");
    style.id = "flight-file-dialog-style";
    style.textContent = DIALOG_CSS;
    doc.head.append(style);
  }
  const dialog = doc.createElement("dialog");
  dialog.className = "flight-file-dialog";
  dialog.setAttribute("aria-label", "Flight file");
  dialog.innerHTML = `<div class="ffd">
  <div class="ffd-bar">
    <span class="ffd-mode" data-ffd-mode>Current conditions</span>
    <label class="ffd-name" data-ffd-name-row><span>File</span><input type="text" data-ffd-name spellcheck="false" autocomplete="off" aria-label="File name"></label>
    <div class="ffd-actions">
      <button type="button" class="primary" data-ffd-save>Save</button>
      <button type="button" data-ffd-open>Open File</button>
      <button type="button" class="primary" data-ffd-load disabled>Load</button>
      <button type="button" data-ffd-current hidden>Current</button>
      <button type="button" data-ffd-close>Close</button>
    </div>
  </div>
  <div class="ffd-status" data-ffd-status role="status"></div>
  <div class="ffd-hint" data-ffd-hint></div>
  <div class="ffd-preview" data-ffd-preview hidden><div class="ffd-preview-label">미리보기</div><iframe data-ffd-frame sandbox="" title="미리보기" referrerpolicy="no-referrer"></iframe></div>
</div>`;
  doc.body.append(dialog);
  const q = (selector) => dialog.querySelector(selector);
  const nameInput = q("[data-ffd-name]");
  const frame = q("[data-ffd-frame]");
  let opened = null; // { envelope, name, text } while a file is shown
  let current = null; // the built current conditions
  let busy = false;
  let generation = 0;
  const status = (text, kind = "valid") => {
    const node = q("[data-ffd-status]");
    node.textContent = text;
    node.className = `ffd-status ${kind}`;
  };
  const sync = () => {
    q("[data-ffd-mode]").textContent = opened ? `File · ${opened.name}` : "Current conditions";
    q("[data-ffd-name-row]").hidden = !!opened;
    // Owner 2026-11-05: the preview shows only for a file being loaded, titled "미리보기".
    q("[data-ffd-preview]").hidden = !opened;
    dialog.classList.toggle("has-preview", !!opened);
    q("[data-ffd-hint]").hidden = !!opened;
    q("[data-ffd-hint]").textContent = SAVE_METHOD_HINT[saveMethod(win)];
    q("[data-ffd-save]").hidden = !!opened;
    q("[data-ffd-current]").hidden = !opened;
    q("[data-ffd-load]").disabled = busy || !opened;
    q("[data-ffd-save]").disabled = busy;
    q("[data-ffd-open]").disabled = busy;
  };
  const show = (html) => { frame.srcdoc = html; };
  async function showCurrent() {
    const mine = ++generation;
    opened = null;
    busy = true;
    sync();
    status("Preparing the current conditions…", "warning");
    show("<!doctype html><title>-</title>");
    try {
      const built = await build();
      if (mine !== generation) return;
      current = built;
      nameInput.value = built.fileName;
      status(built.notice || "Current conditions · Save writes this file", built.notice ? "warning" : "valid");
    } catch (error) {
      if (mine !== generation) return;
      show("<!doctype html><title>-</title>");
      status(`Cannot make the file · ${error?.message || error}`, "invalid");
    } finally {
      if (mine === generation) { busy = false; sync(); }
    }
  }
  async function save() {
    if (busy || opened) return;
    const name = cleanFileName(nameInput.value);
    if (!name) { status("Enter a file name", "invalid"); nameInput.focus(); return; }
    // The picker opens straight from this click (the document is already made), so the browser lets it open.
    if (!current) return;
    const html = current.render(name.slice(0, -5));
    busy = true;
    sync();
    status("Saving…", "warning");
    const outcome = await saveHtmlFile(html, name, { win });
    busy = false;
    sync();
    if (outcome.status === "saved") { status(`Saved · ${outcome.name}`); close(); return; }
    if (outcome.status === "shared") { status(`Shared · ${outcome.name}`); close(`Shared · ${outcome.name} · saved where you chose in the share menu`); return; }
    if (outcome.status === "downloaded") { status(`Download requested · ${outcome.name}`); close(`Download requested · ${outcome.name} · the browser chooses the folder`); return; }
    if (outcome.status === "cancelled") { status("Save cancelled · nothing written", "warning"); return; }
    status(`Save failed · ${outcome.error}`, "invalid");
  }
  async function openFile() {
    if (busy) return;
    const picked = await openHtmlFile({ win });
    if (picked.status === "cancelled") return;
    if (picked.status !== "opened") { status(`Open failed · ${picked.error}`, "invalid"); return; }
    const read_ = read(picked.text);
    if (!read_.ok) { status(`${picked.name} · ${read_.error} · nothing changed`, "invalid"); return; }
    generation += 1;
    opened = { envelope: read_.envelope, name: picked.name, text: picked.text };
    show(picked.text);
    status(`File · ${picked.name} · press Load to use these conditions (the current inputs stay until then)`, "warning");
    sync();
  }
  async function load() {
    if (busy || !opened) return;
    busy = true;
    sync();
    status("Loading…", "warning");
    let outcome;
    try {
      outcome = await apply(opened.envelope, opened.name);
    } catch (error) {
      outcome = { ok: false, message: error?.message || String(error) };
    }
    busy = false;
    sync();
    if (outcome?.ok) { close(outcome.message); return; }
    status(`Load failed · ${outcome?.message || "unknown error"} · nothing changed`, "invalid");
  }
  let onClose = null;
  function close(message = "") {
    generation += 1;
    opened = null;
    current = null;
    busy = false;
    if (dialog.open) dialog.close();
    frame.srcdoc = "";
    onClose?.(message);
  }
  q("[data-ffd-save]").addEventListener("click", save);
  q("[data-ffd-open]").addEventListener("click", openFile);
  q("[data-ffd-load]").addEventListener("click", load);
  q("[data-ffd-current]").addEventListener("click", showCurrent);
  q("[data-ffd-close]").addEventListener("click", () => close());
  nameInput.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); save(); } });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  trigger.addEventListener("click", () => {
    if (!dialog.open) dialog.showModal();
    showCurrent();
  });
  return {
    dialog,
    onClose(listener) { onClose = listener; },
    openCurrent: () => trigger.click(),
    // Test hooks: show a file's text as if it had been opened.
    showFileText(text, name = "test.html") {
      const read_ = read(text);
      if (!dialog.open) dialog.showModal();
      if (!read_.ok) { status(`${name} · ${read_.error} · nothing changed`, "invalid"); return read_; }
      generation += 1;
      opened = { envelope: read_.envelope, name, text };
      show(text);
      status(`File · ${name} · press Load to use these conditions (the current inputs stay until then)`, "warning");
      sync();
      return read_;
    },
    close,
  };
}
