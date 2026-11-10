// Flight file browser (owner 2026-11-10): Save / Save As / Load of the Flight HTML file through a window inside the
// page. "Save As" shows the path, this page's files in the chosen folder, a name and 확인 / 취소; "Load" shows the
// same list, a file opens as 미리보기 (preview) with 확인 (load) / 취소 (back to the list). "Save" writes the browser
// record and the file that is open; with no open file it opens Save As.
//
// The folder is the user's own (File System Access: Chrome / Edge on PC, Chrome 132+ on Android, Samsung Internet).
// The browser gives the page the folder's name, never its full path, so the path shown starts at the chosen folder.
// The chosen folder and each tool's open file are kept as handles in IndexedDB (shared by every page of the site), so
// the next visit opens the same folder; the browser may ask once per visit to allow it again.
// Where the browser has no folder access (iPhone, Safari / Firefox on PC) Save As writes through the share menu or a
// download and Load opens the system file window first; Save then keeps the browser record only.
//
// File contents, names, the data block and the preview come from flight-html-file-v0.1.mjs.
import { cleanFileName, escapeHtml, openHtmlFile, readFlightHtml, saveHtmlFile, saveMethod, SAVE_METHOD_HINT } from "./flight-html-file-v0.1.mjs?v=0.1.3";

export const FLIGHT_FILE_BROWSER_V0_1 = Object.freeze({ id: "bombing-flight-file-browser-v0.1", version: "0.1.0" });

// ---- Folder access ---------------------------------------------------------------------------------------------
// Feature detection: the folder window exists and the page is not inside another site's frame (refused there).
export function folderAccess(win = globalThis) {
  if (typeof win?.showDirectoryPicker !== "function") return false;
  try {
    if (win.top && win.top !== win) void win.top.location.href;
  } catch {
    return false;
  }
  return true;
}

// "granted" | "prompt" | "denied". request: ask the user (only from a click; the browser shows its own question).
export async function folderPermission(handle, { request = false } = {}) {
  if (!handle) return "denied";
  const options = { mode: "readwrite" };
  try {
    const state = typeof handle.queryPermission === "function" ? await handle.queryPermission(options) : "granted";
    if (state === "granted" || !request) return state;
    return typeof handle.requestPermission === "function" ? await handle.requestPermission(options) : state;
  } catch {
    return "denied";
  }
}

// ---- Handle store (IndexedDB; the memory copy keeps the session working when IndexedDB is refused) -------------
const DB_NAME = "flight-sim-tools.files";
const DB_STORE = "handles";
export const FOLDER_KEY = "folder";
export const currentKey = (tool) => `current.${tool}`;

export function createHandleStore({ win = globalThis } = {}) {
  const memory = new Map();
  let dbPromise = null;
  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const request = win.indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return dbPromise;
  }
  async function run(mode, action) {
    const database = await db();
    if (!database) return undefined;
    return new Promise((resolve) => {
      try {
        const tx = database.transaction(DB_STORE, mode);
        const request = action(tx.objectStore(DB_STORE));
        tx.oncomplete = () => resolve(request?.result);
        tx.onerror = () => resolve(undefined);
        tx.onabort = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }
  return {
    async get(key) {
      if (memory.has(key)) return memory.get(key);
      const value = await run("readonly", (store) => store.get(key));
      if (value !== undefined) memory.set(key, value);
      return value ?? null;
    },
    async set(key, value) {
      memory.set(key, value);
      await run("readwrite", (store) => store.put(value, key));
    },
    async delete(key) {
      memory.delete(key);
      await run("readwrite", (store) => store.delete(key));
    },
  };
}

// ---- Reading a folder --------------------------------------------------------------------------------------------
// Which tool a file belongs to: its data block (the last part of the file; the whole file when the block starts
// earlier). Name changes do not matter. Cached by name, size and time for the session.
const TAIL_BYTES = 256 * 1024;
export async function flightFileInfo(fileHandle, cache = null) {
  const file = await fileHandle.getFile();
  const key = `${fileHandle.name}|${file.size}|${file.lastModified}`;
  if (cache?.has(key)) return cache.get(key);
  let read = readFlightHtml(await file.slice(Math.max(0, file.size - TAIL_BYTES)).text(), {});
  if (!read.ok && file.size > TAIL_BYTES) read = readFlightHtml(await file.text(), {});
  const record = read.ok ? read.envelope.record : null;
  const info = {
    name: fileHandle.name,
    size: file.size,
    lastModified: file.lastModified,
    tool: read.ok ? String(read.envelope.tool ?? "") || null : null,
    ships: Number.isInteger(record?.size) ? record.size : null,
  };
  cache?.set(key, info);
  return info;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const HTML_NAME = /\.html?$/i;
// { dirs: [handle], files: [{ handle, name, size, lastModified, ships }], hidden: { tools: { popup: 2 }, other: 1 } }
// files: this tool's Flight files only, newest first; hidden: the other tools' files and other .html files.
export async function listFolder(dir, { tool, cache = null } = {}) {
  const dirs = [];
  const htmlHandles = [];
  for await (const handle of dir.values()) {
    if (handle.kind === "directory") dirs.push(handle);
    else if (handle.kind === "file" && HTML_NAME.test(handle.name)) htmlHandles.push(handle);
  }
  const infos = await mapLimit(htmlHandles, 6, async (handle) => {
    try {
      return { handle, info: await flightFileInfo(handle, cache) };
    } catch {
      return { handle, info: { name: handle.name, tool: null } };
    }
  });
  const files = [];
  const hidden = { tools: {}, other: 0 };
  for (const { handle, info } of infos) {
    if (info.tool === tool) files.push({ handle, ...info });
    else if (info.tool) hidden.tools[info.tool] = (hidden.tools[info.tool] ?? 0) + 1;
    else hidden.other += 1;
  }
  const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
  dirs.sort((a, b) => collator.compare(a.name, b.name));
  files.sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0) || collator.compare(a.name, b.name));
  return { dirs, files, hidden };
}

export async function fileExists(dir, name) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (error) {
    return error?.name === "TypeMismatchError"; // a folder of that name: not free either
  }
}

export async function writeTextFile(fileHandle, text) {
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(new Blob([text], { type: "text/html" }));
    await writable.close();
  } catch (error) {
    try { await writable.abort?.(); } catch { /* already closed */ }
    throw error;
  }
}

const TOOL_LABEL = Object.freeze({ offset: "Offset", popup: "POP-UP", box: "BOX", wheel: "WHEEL", "wheel-box": "WHEEL BOX" });
export const toolLabel = (tool) => TOOL_LABEL[tool] ?? String(tool ?? "").toUpperCase();

// "POP-UP 파일 2개, 다른 .html 1개" (empty when nothing is hidden).
export function hiddenText(hidden) {
  const parts = Object.entries(hidden?.tools ?? {}).map(([tool, count]) => `${toolLabel(tool)} 파일 ${count}개`);
  if (hidden?.other) parts.push(`다른 .html ${hidden.other}개`);
  return parts.join(", ");
}

export function fileTimeText(ms) {
  if (!Number.isFinite(ms)) return "";
  const t = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}
export function fileSizeText(bytes) {
  if (!Number.isFinite(bytes)) return "";
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
export const pathText = (names) => names.filter(Boolean).join(" › ");

// ---- The window ----------------------------------------------------------------------------------------------
const CSS = `
.flight-file-browser{width:min(760px,calc(100vw - 32px));height:min(86vh,860px);max-width:none;max-height:none;padding:0;border:1px solid var(--line,#314151);border-radius:14px;background:var(--panel,#18212b);color:var(--text,#edf3f8);overflow:hidden}
.flight-file-browser::backdrop{background:rgba(2,6,23,.6)}
@media (max-width:640px){.flight-file-browser{width:100vw;height:100dvh;border:0;border-radius:0;margin:0;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}
.flight-file-browser .ffb{display:flex;flex-direction:column;height:100%}
.flight-file-browser .ffb-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line,#314151)}
.flight-file-browser .ffb-title{font-weight:900;font-size:17px;margin-right:auto}
.flight-file-browser button{font:inherit;cursor:pointer}
.flight-file-browser button:disabled{opacity:.45;cursor:not-allowed}
.flight-file-browser .ffb-x{width:36px;height:36px;border-radius:10px;border:1px solid var(--line,#314151);background:var(--panel,#18212b);color:var(--text,#edf3f8);font-size:18px;line-height:1}
.flight-file-browser .ffb-path{display:flex;align-items:center;gap:6px;padding:9px 14px;border-bottom:1px solid var(--line,#314151);background:var(--field,#202b37);flex-wrap:wrap}
.flight-file-browser .ffb-crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:2px;min-width:0;margin-right:auto;font-size:13px}
.flight-file-browser .ffb-crumb{border:0;background:none;color:var(--blue,#79bdf0);font-weight:800;padding:3px 4px;border-radius:6px;text-align:left;word-break:break-all}
.flight-file-browser .ffb-crumb[aria-current="true"]{color:var(--text,#edf3f8);cursor:default}
.flight-file-browser .ffb-sep{color:var(--muted,#9aa8b6)}
.flight-file-browser .ffb-small{border:1px solid var(--line,#314151);background:var(--panel,#18212b);color:var(--text,#edf3f8);border-radius:8px;padding:5px 9px;font-size:12px;font-weight:800;white-space:nowrap}
.flight-file-browser .ffb-body{flex:1;min-height:0;overflow:auto}
.flight-file-browser .ffb-list{list-style:none;margin:0;padding:6px 0}
.flight-file-browser .ffb-row{width:100%;display:flex;align-items:center;gap:12px;padding:10px 14px;border:0;border-left:3px solid transparent;background:none;color:inherit;text-align:left}
.flight-file-browser .ffb-row:hover{background:var(--field,#202b37)}
.flight-file-browser .ffb-row[aria-pressed="true"]{background:var(--blue-soft,#15354e);border-left-color:var(--blue,#79bdf0)}
.flight-file-browser svg.ffb-ico{flex:none;display:block;width:22px;height:22px;background:none}
.flight-file-browser .ffb-dir .ffb-ico{color:var(--amber,#ffbd62)}
.flight-file-browser .ffb-file .ffb-ico{color:var(--blue,#79bdf0)}
.flight-file-browser .ffb-meta{min-width:0;flex:1}
.flight-file-browser .ffb-name{font-weight:800;font-size:14px;word-break:break-all}
.flight-file-browser .ffb-sub{font-size:11px;color:var(--muted,#9aa8b6);font-variant-numeric:tabular-nums}
.flight-file-browser .ffb-note{font-size:11px;color:var(--muted,#9aa8b6);padding:6px 14px 14px}
.flight-file-browser .ffb-empty{padding:26px 14px;color:var(--muted,#9aa8b6);font-size:13px;text-align:center}
.flight-file-browser .ffb-intro{padding:22px 16px;display:grid;gap:12px;justify-items:start;max-width:56ch}
.flight-file-browser .ffb-intro p{margin:0;font-size:14px}
.flight-file-browser .ffb-intro .ffb-hint{font-size:12px;color:var(--muted,#9aa8b6)}
.flight-file-browser .ffb-newfolder{display:flex;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line,#314151)}
.flight-file-browser .ffb-text{flex:1;min-width:0;border:1px solid var(--line,#314151);background:var(--field,#202b37);color:var(--text,#edf3f8);border-radius:8px;padding:8px 10px;font:inherit;font-size:15px}
.flight-file-browser .ffb-foot{border-top:1px solid var(--line,#314151);padding:10px 14px;display:grid;gap:8px}
.flight-file-browser .ffb-name-row{display:flex;align-items:center;gap:8px}
.flight-file-browser .ffb-name-row label{font-size:12px;font-weight:800;color:var(--muted,#9aa8b6)}
.flight-file-browser .ffb-name-wrap{flex:1;min-width:0;display:flex;align-items:center;border:1px solid var(--line,#314151);background:var(--field,#202b37);border-radius:8px;padding:0 10px}
.flight-file-browser .ffb-name-wrap:focus-within{outline:2px solid var(--blue,#79bdf0);outline-offset:1px}
.flight-file-browser .ffb-name-wrap input{flex:1;min-width:0;border:0;background:none;color:var(--text,#edf3f8);font:inherit;font-size:15px;padding:9px 0;outline:none}
.flight-file-browser .ffb-ext{color:var(--muted,#9aa8b6);font-size:14px}
.flight-file-browser .ffb-buttons{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
.flight-file-browser .ffb-btn{min-height:38px;min-width:88px;border:1px solid var(--line,#314151);border-radius:10px;padding:8px 14px;background:var(--panel,#18212b);color:var(--text,#edf3f8);font-weight:800}
.flight-file-browser .ffb-btn.primary{background:var(--blue,#79bdf0);border-color:var(--blue,#79bdf0);color:var(--bg,#0f141b)}
.flight-file-browser .ffb-msg{font-size:12px;border-radius:10px;padding:8px 10px;word-break:break-word}
.flight-file-browser .ffb-msg.invalid{background:var(--red-soft,#3e2225);color:var(--red,#ff8c8c)}
.flight-file-browser .ffb-msg.warning{background:var(--amber-soft,#3b2a14);color:var(--amber,#ffbd62)}
.flight-file-browser .ffb-msg.info{background:var(--field,#202b37);color:var(--muted,#9aa8b6)}
.flight-file-browser .ffb-preview{display:flex;flex-direction:column;height:100%;padding:10px 14px 12px;gap:6px}
.flight-file-browser .ffb-preview-label{font-weight:900;font-size:13px}
.flight-file-browser .ffb-preview iframe{flex:1;min-height:240px;width:100%;border:1px solid var(--line,#314151);border-radius:8px;background:#fff}
`;
const ICON_DIR = '<svg class="ffb-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5l2 2h8A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>';
const ICON_FILE = '<svg class="ffb-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20z"/><path fill="none" stroke="currentColor" stroke-width="1.8" d="M14 3.5V8h4"/></svg>';
const ICON_UP = '<svg class="ffb-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M12 19V6m-6 6 6-6 6 6"/></svg>';

// tool: the page's file tool ("offset"). build(): settles the page and returns { fileName, notice, render(title) }.
// read(text): readFlightHtml for this tool. apply(envelope, name): loads the file's conditions (the page reloads).
// keepInBrowser(): the page's browser Save; resolves true / false and shows its own status.
// status(text, kind): the Save/Load status line. currentLine: the element that names the open file.
export function installFlightFileBrowser({ tool, build, read, apply, keepInBrowser, status, currentLine = null, doc = globalThis.document, win = globalThis, store = null }) {
  if (!doc?.body) return null;
  if (!doc.getElementById("flight-file-browser-style")) {
    const style = doc.createElement("style");
    style.id = "flight-file-browser-style";
    style.textContent = CSS;
    doc.head.append(style);
  }
  const handles = store ?? createHandleStore({ win });
  const cache = new Map();
  const dialog = doc.createElement("dialog");
  dialog.className = "flight-file-browser";
  doc.body.append(dialog);

  let current = null; // { handle, path: [folder names from the chosen folder], name }
  const currentReady = handles.get(currentKey(tool)).then((value) => {
    if (value?.handle && typeof value.name === "string") current = { handle: value.handle, path: Array.isArray(value.path) ? value.path : [], name: value.name };
    renderCurrent();
    return current;
  }).catch(() => null);

  // Window state.
  let kind = null; // "save" | "load"
  let view = "loading"; // loading | intro | permission | browse | preview | basic-save | basic-preview
  let stack = []; // directory handles from the chosen folder down
  let listing = null;
  let selected = null;
  let name = "";
  let confirmName = null;
  let newFolder = false;
  let message = null; // { text, kind }
  let built = null; // { fileName, notice, render } for Save As
  let fromSave = false; // Save As opened by Save (the browser record is already written)
  let preview = null; // { name, text, read, handle, path }
  let busy = false;
  let generation = 0; // listing / preview requests: only the newest one draws
  let session = 0; // one opening of the window: a document made for an earlier opening is dropped
  let lastPath = []; // names under the chosen folder, for this visit

  function renderCurrent() {
    if (!currentLine) return;
    if (!folderAccess(win)) {
      currentLine.textContent = "이 브라우저는 폴더에 바로 저장할 수 없어 Save는 브라우저에만 보관합니다. 파일은 Save As로 저장합니다.";
      return;
    }
    currentLine.textContent = current
      ? `현재 파일: ${pathText([...current.path, current.name])}`
      : "현재 파일: 없음 · Save를 누르면 Save As가 열립니다";
  }
  async function setCurrent(next) {
    current = next;
    renderCurrent();
    if (next) await handles.set(currentKey(tool), { handle: next.handle, path: next.path, name: next.name });
    else await handles.delete(currentKey(tool));
  }

  const q = (selector) => dialog.querySelector(selector);
  function head(title) {
    return `<div class="ffb-head"><div class="ffb-title">${escapeHtml(title)}</div><button type="button" class="ffb-x" data-ffb="close" aria-label="닫기">×</button></div>`;
  }
  function msgHtml() {
    return message ? `<div class="ffb-msg ${message.kind}" role="status">${escapeHtml(message.text)}</div>` : "";
  }
  function pathBar() {
    const crumbs = stack.map((handle, index) => `${index ? '<span class="ffb-sep">›</span>' : ""}<button type="button" class="ffb-crumb" data-ffb="crumb" data-index="${index}"${index === stack.length - 1 ? ' aria-current="true"' : ""}>${escapeHtml(handle.name)}</button>`).join("");
    const extra = kind === "save" ? '<button type="button" class="ffb-small" data-ffb="newfolder">새 폴더</button>' : "";
    return `<div class="ffb-path"><nav class="ffb-crumbs" aria-label="경로">${crumbs}</nav>${extra}<button type="button" class="ffb-small" data-ffb="change">폴더 변경</button></div>`;
  }
  function listHtml() {
    if (!listing) return '<div class="ffb-empty">읽는 중…</div>';
    let html = '<ul class="ffb-list">';
    if (stack.length > 1) html += `<li><button type="button" class="ffb-row ffb-up" data-ffb="up">${ICON_UP}<span class="ffb-meta"><span class="ffb-name">상위 폴더</span></span></button></li>`;
    listing.dirs.forEach((dir, index) => {
      html += `<li><button type="button" class="ffb-row ffb-dir" data-ffb="dir" data-index="${index}">${ICON_DIR}<span class="ffb-meta"><span class="ffb-name">${escapeHtml(dir.name)}</span><br><span class="ffb-sub">폴더</span></span></button></li>`;
    });
    listing.files.forEach((file, index) => {
      const sub = [fileTimeText(file.lastModified), fileSizeText(file.size), file.ships ? `${file.ships} ship` : ""].filter(Boolean).join(" · ");
      html += `<li><button type="button" class="ffb-row ffb-file" data-ffb="file" data-index="${index}" aria-pressed="${kind === "save" && selected === file.name}">${ICON_FILE}<span class="ffb-meta"><span class="ffb-name">${escapeHtml(file.name)}</span><br><span class="ffb-sub">${escapeHtml(sub)}</span></span></button></li>`;
    });
    html += "</ul>";
    if (!listing.dirs.length && !listing.files.length) {
      html += `<div class="ffb-empty">이 폴더에는 ${escapeHtml(toolLabel(tool))} 파일이 없습니다.${kind === "save" ? " 이름을 정하고 확인을 누르면 여기에 저장합니다." : ""}</div>`;
    }
    const hidden = hiddenText(listing.hidden);
    if (hidden) html += `<div class="ffb-note">이 폴더의 ${escapeHtml(hidden)}는 숨겼습니다.</div>`;
    return html;
  }
  function nameRow() {
    return `<div class="ffb-name-row"><label for="ffb-name">이름</label><div class="ffb-name-wrap"><input id="ffb-name" data-ffb-name value="${escapeHtml(name)}" spellcheck="false" autocomplete="off" autocapitalize="off"><span class="ffb-ext">.html</span></div></div>`;
  }
  function buttons(...list) {
    return `<div class="ffb-buttons">${list.join("")}</div>`;
  }
  const btn = (action, label, { primary = false, disabled = false } = {}) => `<button type="button" class="ffb-btn${primary ? " primary" : ""}" data-ffb="${action}"${disabled ? " disabled" : ""}>${escapeHtml(label)}</button>`;

  function render() {
    const title = kind === "save" ? "Save As" : (view === "preview" || view === "basic-preview" ? "Load · 미리보기" : "Load");
    let path = "";
    let body = "";
    let foot = "";
    if (view === "loading") {
      body = '<div class="ffb-empty">준비 중…</div>';
      foot = buttons(btn("cancel", "취소"));
    } else if (view === "intro") {
      body = `<div class="ffb-intro"><p>저장 폴더를 아직 고르지 않았습니다.</p><p class="ffb-hint">폴더를 한 번 고르면 다음부터 Save As와 Load에서 그 폴더가 바로 열립니다. 이 사이트의 다른 도구(POP-UP 등)도 같은 폴더를 씁니다. 파일이 많은 Download보다 전용 폴더(예: FlightSim)를 권합니다.</p><button type="button" class="ffb-btn primary" data-ffb="pick">폴더 선택</button></div>`;
      foot = `${msgHtml()}${buttons(btn("cancel", "취소"))}`;
    } else if (view === "permission") {
      body = `<div class="ffb-intro"><p>"${escapeHtml(stack[0]?.name ?? "")}" 폴더를 다시 허용해 주세요.</p><p class="ffb-hint">브라우저가 방문할 때마다 한 번 묻습니다. 다른 폴더를 쓰려면 폴더 변경을 누르세요.</p><div class="ffb-buttons" style="justify-content:flex-start"><button type="button" class="ffb-btn primary" data-ffb="allow">허용</button><button type="button" class="ffb-btn" data-ffb="pick">폴더 변경</button></div></div>`;
      foot = `${msgHtml()}${buttons(btn("cancel", "취소"))}`;
    } else if (view === "browse") {
      path = pathBar();
      body = `${newFolder ? '<div class="ffb-newfolder"><input class="ffb-text" data-ffb-folder aria-label="새 폴더 이름" placeholder="새 폴더 이름"><button type="button" class="ffb-btn primary" data-ffb="folder-ok">만들기</button><button type="button" class="ffb-btn" data-ffb="folder-cancel">취소</button></div>' : ""}${listHtml()}`;
      if (kind === "save") {
        foot = confirmName
          ? `<div class="ffb-msg warning">${escapeHtml(confirmName)} 파일이 이미 있습니다. 덮어쓸까요?</div>${buttons(btn("confirm-no", "취소", { disabled: busy }), btn("confirm-yes", "덮어쓰기", { primary: true, disabled: busy }))}`
          : `${msgHtml()}${nameRow()}${buttons(btn("cancel", "취소"), btn("ok", busy ? "저장 중…" : "확인", { primary: true, disabled: busy || !built }))}`;
      } else {
        foot = `${msgHtml()}${buttons(btn("cancel", "취소"))}`;
      }
    } else if (view === "preview" || view === "basic-preview") {
      const shownPath = preview?.path ? pathText(preview.path) : preview?.name ?? "";
      path = `<div class="ffb-path"><div class="ffb-crumbs"><span class="ffb-name">${escapeHtml(shownPath)}</span></div></div>`;
      body = preview?.read?.ok
        ? '<div class="ffb-preview"><div class="ffb-preview-label">미리보기</div><iframe data-ffb-frame sandbox="" title="미리보기" referrerpolicy="no-referrer"></iframe></div>'
        : `<div class="ffb-intro"><div class="ffb-msg invalid">${escapeHtml(preview?.name ?? "")} · ${escapeHtml(preview?.read?.error ?? "읽을 수 없습니다")}</div><p class="ffb-hint">취소를 누르면 ${view === "preview" ? "파일 목록으로" : "파일 선택 창으로"} 돌아갑니다.</p></div>`;
      foot = `${msgHtml()}${buttons(btn("back", "취소", { disabled: busy }), btn("load", busy ? "불러오는 중…" : "확인", { primary: true, disabled: busy || !preview?.read?.ok }))}`;
    } else if (view === "basic-save") {
      body = `<div class="ffb-intro"><p>이 브라우저는 폴더를 직접 보여줄 수 없습니다.</p><p class="ffb-hint">${escapeHtml(SAVE_METHOD_HINT[saveMethod(win)])}</p></div>`;
      foot = `${msgHtml()}${nameRow()}${buttons(btn("cancel", "취소"), btn("basic-ok", busy ? "저장 중…" : "확인", { primary: true, disabled: busy || !built }))}`;
    }
    dialog.setAttribute("aria-label", title);
    dialog.innerHTML = `<div class="ffb">${head(title)}${path}<div class="ffb-body">${body}</div><div class="ffb-foot">${foot}</div></div>`;
    const frame = q("[data-ffb-frame]");
    if (frame) frame.srcdoc = preview.text;
    const input = q("[data-ffb-name]");
    if (input) {
      input.addEventListener("input", () => { name = input.value; selected = null; message = null; });
      input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); act(view === "basic-save" ? "basic-ok" : "ok"); } });
    }
    const folderInput = q("[data-ffb-folder]");
    if (folderInput) {
      folderInput.focus();
      folderInput.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); act("folder-ok"); } });
    }
  }

  function open() {
    if (!dialog.open) dialog.showModal();
  }
  function close(statusText = "", statusKind = "valid") {
    generation += 1;
    session += 1;
    if (dialog.open) dialog.close();
    dialog.innerHTML = "";
    kind = null;
    listing = null;
    preview = null;
    built = null;
    busy = false;
    confirmName = null;
    newFolder = false;
    message = null;
    if (statusText) status(statusText, statusKind);
  }

  async function browse(dirStack) {
    const mine = ++generation;
    stack = dirStack;
    lastPath = stack.slice(1).map((handle) => handle.name);
    listing = null;
    selected = null;
    confirmName = null;
    newFolder = false;
    view = "browse";
    render();
    try {
      const next = await listFolder(stack[stack.length - 1], { tool, cache });
      if (mine !== generation) return;
      listing = next;
    } catch (error) {
      if (mine !== generation) return;
      listing = { dirs: [], files: [], hidden: { tools: {}, other: 0 } };
      message = { text: `폴더를 읽을 수 없습니다 · ${error?.message || error}`, kind: "invalid" };
    }
    render();
  }
  // The chosen folder down to the open file's folder (or this visit's last folder), when they are still there.
  async function startStack(root) {
    let names = lastPath;
    if (current?.handle && typeof root.resolve === "function") {
      try {
        const inside = await root.resolve(current.handle);
        if (inside) names = inside.slice(0, -1);
      } catch { /* other folder */ }
    }
    const out = [root];
    for (const part of names) {
      try {
        out.push(await out[out.length - 1].getDirectoryHandle(part));
      } catch {
        break;
      }
    }
    return out;
  }
  async function enterFolder({ request }) {
    const root = await handles.get(FOLDER_KEY);
    if (!root) { view = "intro"; render(); return; }
    stack = [root];
    const permission = await folderPermission(root, { request });
    if (permission !== "granted") { view = "permission"; render(); return; }
    await browse(await startStack(root));
  }
  async function pickFolder() {
    let root;
    try {
      root = await win.showDirectoryPicker({ id: "flight-sim-tools-files", mode: "readwrite", startIn: "documents" });
    } catch (error) {
      if (error?.name === "AbortError") return;
      message = { text: `폴더를 열 수 없습니다 · ${error?.message || error}`, kind: "invalid" };
      render();
      return;
    }
    await handles.set(FOLDER_KEY, root);
    lastPath = [];
    message = null;
    await browse([root]);
  }

  // Save As: the document is made when the window opens (it is what 확인 writes, and the share menu has to open
  // straight from the click on a phone).
  async function saveAs({ request = true, afterSave = false } = {}) {
    if (busy && dialog.open) return;
    kind = "save";
    fromSave = afterSave;
    message = null;
    built = null;
    await currentReady;
    name = current ? current.name.replace(/\.html?$/i, "") : "";
    view = folderAccess(win) ? "loading" : "basic-save";
    open();
    render();
    const mine = ++session;
    const making = Promise.resolve().then(() => build()).then((doc) => {
      if (kind !== "save" || mine !== session) return;
      built = doc;
      if (!name) name = doc.fileName.replace(/\.html?$/i, "");
      if (doc.notice) message = { text: doc.notice, kind: "warning" };
      const input = q("[data-ffb-name]");
      if (input && !input.value) input.value = name;
      render();
    }, (error) => {
      if (kind !== "save" || mine !== session) return;
      message = { text: `파일을 만들 수 없습니다 · ${error?.message || error}`, kind: "invalid" };
      render();
    });
    if (folderAccess(win)) await enterFolder({ request });
    await making;
  }

  async function confirmSave(overwrite = false) {
    if (busy || !built) return;
    const fileName = cleanFileName(q("[data-ffb-name]")?.value ?? name);
    if (!fileName) { message = { text: "이름을 입력해 주세요", kind: "invalid" }; render(); q("[data-ffb-name]")?.focus(); return; }
    name = fileName.slice(0, -5);
    const dir = stack[stack.length - 1];
    if (!overwrite && await fileExists(dir, fileName)) { confirmName = fileName; render(); return; }
    busy = true;
    confirmName = null;
    render();
    const html = built.render(name);
    try {
      const handle = await dir.getFileHandle(fileName, { create: true });
      await writeTextFile(handle, html);
      await setCurrent({ handle, path: stack.map((item) => item.name), name: fileName });
    } catch (error) {
      busy = false;
      message = { text: `저장하지 못했습니다 · ${error?.message || error}`, kind: "invalid" };
      render();
      return;
    }
    const where = pathText([...current.path, fileName]);
    const notice = built.notice;
    const wasFromSave = fromSave;
    close();
    if (wasFromSave) { status(`Saved · ${where} · this browser too${notice ? ` · ${notice}` : ""}`, notice ? "warning" : "valid"); return; }
    const kept = await keepInBrowser();
    status(kept ? `Saved · ${where} · this browser too${notice ? ` · ${notice}` : ""}` : `Saved · ${where} · the browser record failed (see Save)`, kept && !notice ? "valid" : "warning");
  }

  // No folder access: the share menu / download, straight from the click.
  async function confirmBasicSave() {
    if (busy || !built) return;
    const fileName = cleanFileName(q("[data-ffb-name]")?.value ?? name);
    if (!fileName) { message = { text: "이름을 입력해 주세요", kind: "invalid" }; render(); return; }
    busy = true;
    const writing = saveHtmlFile(built.render(fileName.slice(0, -5)), fileName, { win });
    render();
    const outcome = await writing;
    busy = false;
    if (outcome.status === "cancelled") { message = { text: "저장을 취소했습니다 · 아무것도 쓰지 않았습니다", kind: "warning" }; render(); return; }
    if (outcome.status === "error") { message = { text: `저장하지 못했습니다 · ${outcome.error}`, kind: "invalid" }; render(); return; }
    const said = outcome.status === "shared" ? `Shared · ${outcome.name} · saved where you chose in the share menu`
      : outcome.status === "downloaded" ? `Download requested · ${outcome.name} · the browser chooses the folder`
        : `Saved · ${outcome.name}`;
    close();
    const kept = await keepInBrowser();
    status(kept ? `${said} · this browser too` : said, kept ? "valid" : "warning");
  }

  // Load: the list, then a file's preview.
  async function load() {
    if (busy && dialog.open) return;
    kind = "load";
    message = null;
    if (!folderAccess(win)) { await pickBasic(); return; }
    await currentReady;
    view = "loading";
    open();
    render();
    await enterFolder({ request: true });
  }
  async function showPreview(file) {
    const mine = ++generation;
    preview = { name: file.name, text: "", read: null, handle: file.handle, path: [...stack.map((item) => item.name), file.name] };
    view = "preview";
    message = { text: "읽는 중…", kind: "info" };
    render();
    try {
      const text = await (await file.handle.getFile()).text();
      if (mine !== generation) return;
      preview.text = text;
      preview.read = read(text);
    } catch (error) {
      if (mine !== generation) return;
      preview.read = { ok: false, error: error?.message || String(error) };
    }
    message = null;
    render();
  }
  async function pickBasic() {
    const picked = await openHtmlFile({ win });
    if (picked.status === "cancelled") { close(); return; }
    kind = "load";
    preview = picked.status === "opened"
      ? { name: picked.name, text: picked.text, read: read(picked.text), handle: null, path: null }
      : { name: "file", text: "", read: { ok: false, error: picked.error }, handle: null, path: null };
    message = null;
    view = "basic-preview";
    open();
    render();
  }
  async function confirmLoad() {
    if (busy || !preview?.read?.ok) return;
    busy = true;
    render();
    if (preview.handle) await setCurrent({ handle: preview.handle, path: preview.path.slice(0, -1), name: preview.name });
    let outcome;
    try {
      outcome = await apply(preview.read.envelope, preview.name);
    } catch (error) {
      outcome = { ok: false, message: error?.message || String(error) };
    }
    busy = false;
    if (outcome?.ok) { close(outcome.message, "valid"); return; }
    message = { text: `불러오지 못했습니다 · ${outcome?.message || "unknown error"} · 지금 조건은 그대로입니다`, kind: "invalid" };
    render();
  }

  // Save: the browser record, then the open file; with no open file, Save As.
  async function save() {
    if (!folderAccess(win)) return keepInBrowser();
    const open_ = await currentReady.then(() => current);
    if (!open_) {
      const kept = await keepInBrowser();
      if (kept) await saveAs({ request: false, afterSave: true });
      return kept;
    }
    const permission = await folderPermission(open_.handle, { request: true }); // asked while the click still counts
    const kept = await keepInBrowser();
    if (!kept) return false;
    const where = pathText([...open_.path, open_.name]);
    if (permission !== "granted") {
      status(`Saved in this browser · ${where} was not written: the browser did not allow it · press Save again`, "warning");
      return false;
    }
    try {
      await open_.handle.getFile();
    } catch {
      await setCurrent(null);
      status(`Saved in this browser · ${open_.name} is no longer in its folder · choose where to save`, "warning");
      await saveAs({ request: false, afterSave: true });
      return false;
    }
    try {
      const doc = await build();
      await writeTextFile(open_.handle, doc.render(open_.name.replace(/\.html?$/i, "")));
      status(`Saved · ${where} · this browser too${doc.notice ? ` · ${doc.notice}` : ""}`, doc.notice ? "warning" : "valid");
      return true;
    } catch (error) {
      status(`Saved in this browser · ${where} could not be written (${error?.message || error})`, "invalid");
      return false;
    }
  }

  async function act(action, target = null) {
    switch (action) {
      case "close":
      case "cancel": {
        const wasSave = kind === "save" && fromSave;
        close();
        if (wasSave) status("Saved in this browser · no file written (Save As cancelled)", "valid");
        return;
      }
      case "pick": message = null; await pickFolder(); return;
      case "change": await pickFolder(); return;
      case "allow": {
        const permission = await folderPermission(stack[0], { request: true });
        if (permission === "granted") await browse(await startStack(stack[0]));
        else { message = { text: "허용되지 않았습니다 · 허용을 다시 누르거나 폴더 변경을 누르세요", kind: "warning" }; render(); }
        return;
      }
      case "crumb": await browse(stack.slice(0, Number(target.dataset.index) + 1)); return;
      case "up": await browse(stack.slice(0, -1)); return;
      case "dir": {
        const dir = listing?.dirs[Number(target.dataset.index)];
        if (dir) await browse([...stack, dir]);
        return;
      }
      case "file": {
        const file = listing?.files[Number(target.dataset.index)];
        if (!file) return;
        if (kind === "save") {
          selected = file.name;
          name = file.name.replace(/\.html?$/i, "");
          message = null;
          render();
        } else {
          await showPreview(file);
        }
        return;
      }
      case "newfolder": newFolder = true; render(); return;
      case "folder-cancel": newFolder = false; render(); return;
      case "folder-ok": {
        const folderName = String(q("[data-ffb-folder]")?.value ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim();
        newFolder = false;
        if (!folderName) { render(); return; }
        try {
          const made = await stack[stack.length - 1].getDirectoryHandle(folderName, { create: true });
          await browse([...stack, made]);
        } catch (error) {
          message = { text: `폴더를 만들 수 없습니다 · ${error?.message || error}`, kind: "invalid" };
          render();
        }
        return;
      }
      case "ok": await confirmSave(false); return;
      case "confirm-no": confirmName = null; render(); return;
      case "confirm-yes": await confirmSave(true); return;
      case "basic-ok": await confirmBasicSave(); return;
      case "back":
        if (view === "basic-preview") { dialog.close(); await pickBasic(); return; } // 취소: the file window again (from this click)
        preview = null;
        message = null;
        await browse(stack);
        return;
      case "load": await confirmLoad(); return;
      default:
    }
  }
  dialog.addEventListener("click", (event) => {
    const target = event.target.closest("[data-ffb]");
    if (!target || target.disabled) return;
    act(target.dataset.ffb, target);
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!busy) act("close");
  });

  renderCurrent();
  return {
    dialog,
    save,
    saveAs: () => saveAs({ request: true }),
    load,
    current: () => current,
    ready: () => currentReady,
    clearCurrent: () => setCurrent(null),
    state: () => ({ kind, view, path: stack.map((item) => item.name), listing: listing && { dirs: listing.dirs.map((d) => d.name), files: listing.files.map((f) => f.name), hidden: listing.hidden }, name, confirmName, busy, open: dialog.open, preview: preview && { name: preview.name, ok: !!preview.read?.ok } }),
  };
}
