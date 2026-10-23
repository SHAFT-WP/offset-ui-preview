// Saving a bombing page's work in this browser (bombing app shared FE since 2026-10-22, from the Offset page). One
// record per page holding the whole work, written by one setItem and verified by reading it back; a developer
// Default preset under its own key; the Save button run (settle the page, write, status, button feedback). No
// calculation and no display rounding: the page owns its keys, the record shape and validation, any legacy
// migration and its status texts.

export const SAVE_STORE_V0_1 = Object.freeze({ id: "bombing-save-store-v0.1", version: "0.1.0" });

export const isRecordObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export const parseStoredJson = (text) => { try { return JSON.parse(text); } catch { return null; } };

// ---- The work record ----------------------------------------------------------------------------------------
// The record under `key`. currentFormat: it carries this schemaVersion or a newer one; record: the stored record
// when it is exactly this schemaVersion and valid(record), else null (a current-format record that is not valid
// is unreadable). raw / parsed: what is stored, for a page's legacy fallback.
export function readWorkRecord(storage, key, { schemaVersion, valid }) {
  const raw = storage.getItem(key);
  const parsed = parseStoredJson(raw);
  const currentFormat = isRecordObject(parsed) && parsed.schemaVersion >= schemaVersion;
  const record = currentFormat && parsed.schemaVersion === schemaVersion && valid(parsed) ? parsed : null;
  return { raw, parsed, currentFormat, record };
}

// Writes build(previous) under `key` with one setItem (Web Storage setItem is atomic: a quota / security error
// leaves the previous complete record intact; there is no second write and no cross-key rollback). Refuses to
// replace a record of a newer format, and throws when the read-back differs (a newer save from another tab is
// never overwritten by a rollback). previous: the stored record parsed (null when none or unreadable).
export function writeWorkRecord(storage, key, { schemaVersion, build }) {
  const previous = parseStoredJson(storage.getItem(key));
  if (isRecordObject(previous) && previous.schemaVersion > schemaVersion) {
    throw new Error("Saved conditions use a newer format; reload the latest app before saving");
  }
  const record = build(previous);
  const text = JSON.stringify(record);
  storage.setItem(key, text);
  if (storage.getItem(key) !== text) throw new Error("Could not verify the saved conditions; please save again");
  return record;
}

// ---- Developer Default preset -------------------------------------------------------------------------------
// A preset under its own key. read() gives the valid preset or null (parsed once per stored text); write(record)
// stores it and reads it back, restoring the previous preset on a failure; clear() removes it. storage() is called
// inside each try (reaching localStorage itself can throw).
export function createPresetStore({ storage, key, validate }) {
  let cache = { raw: undefined, value: null };
  return {
    read() {
      let raw = null;
      try { raw = storage().getItem(key); } catch { raw = null; }
      if (raw !== cache.raw) {
        let value = null;
        try { value = raw ? validate(JSON.parse(raw)) : null; } catch { value = null; }
        cache = { raw, value };
      }
      return cache.value;
    },
    // { ok: true } or { ok: false, message }.
    write(record) {
      let previous = null;
      try { previous = storage().getItem(key); } catch { previous = null; }
      const text = JSON.stringify(record);
      try {
        storage().setItem(key, text);
        if (storage().getItem(key) !== text) throw new Error("read-back mismatch");
      } catch (error) {
        try {
          if (previous === null) storage().removeItem(key);
          else storage().setItem(key, previous);
        } catch { /* the previous preset stays as storage left it */ }
        return { ok: false, message: `storage write failed (${error.message})` };
      }
      return { ok: true };
    },
    clear() {
      try { storage().removeItem(key); } catch { /* nothing stored */ }
    },
  };
}

// ---- Save buttons -------------------------------------------------------------------------------------------
// Every Save button of the page runs the same save: buttons() read "Saving…" and are disabled, settle() lets the
// page finish what is still calculating, save() writes (and returns what was saved, or throws), then status() shows
// savedText(saved) or failedText(error) ("invalid") and each button reads "Saved" (back to "Save" after feedbackMs)
// or "Save failed". A Save pressed while one runs gets the running one. run() resolves true / false.
export function createSaveRun({ buttons, settle, save, status, savedText, failedText, feedbackMs = 900 }) {
  const timers = new WeakMap();
  let pending = null;
  function showResult(button, ok) {
    const oldTimer = timers.get(button);
    if (oldTimer) clearTimeout(oldTimer);
    button.textContent = ok ? "Saved" : "Save failed";
    if (ok) timers.set(button, setTimeout(() => { button.textContent = "Save"; }, feedbackMs));
  }
  function run() {
    if (pending) return pending;
    const nodes = buttons();
    nodes.forEach((node) => {
      clearTimeout(timers.get(node));
      node.disabled = true;
      node.textContent = "Saving…";
    });
    status("Saving…", "warning");
    // settle starts now. A synchronous throw becomes this run's failure, taken after `pending` holds
    // the run, so the run that ends is never kept as the running one (C02, 2026-10-23).
    let settled;
    try {
      settled = settle();
    } catch (error) {
      settled = Promise.reject(error);
    }
    pending = (async () => {
      try {
        await settled;
        const saved = save();
        status(savedText(saved));
        nodes.forEach((node) => showResult(node, true));
        return true;
      } catch (error) {
        status(failedText(error), "invalid");
        nodes.forEach((node) => showResult(node, false));
        return false;
      } finally {
        nodes.forEach((node) => { node.disabled = false; });
        pending = null;
      }
    })();
    return pending;
  }
  return { run, showResult };
}

// "date time" of a save in the viewer's locale (time to the minute).
export function savedTimeText(date) {
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}
