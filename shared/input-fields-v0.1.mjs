// Input fields of a bombing page (bombing app shared FE since 2026-10-22, from the Offset page). Mechanics only: the
// Full value behind a rounded solved text, heading / bearing entry in TO / FROM notation, the LOCK / LINK button
// states, the fields the LOCKs settle, the Enter commit, the section collapse controls and the section tool buttons
// (Full BDP / Advanced toggles, Save, Default). The page owns its keys, the BE input it builds and what a Default
// returns to; the BE decides every value.

export const INPUT_FIELDS_V0_1 = Object.freeze({ id: "bombing-input-fields-v0.1", version: "0.1.0" });

// ---- The Full value behind a solved text ---------------------------------------------------------------------
// A solve writes a rounded text into a field and keeps the Full value behind it ({ text, value }); while the field
// still shows that text the Full value goes to the BE.

// Same number (within 1e-9) or same text.
export function valuesEquivalent(current, next) {
  const a = Number.parseFloat(current);
  const b = Number.parseFloat(next);
  if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) <= 1e-9;
  return String(current) === String(next);
}

// A field's value for the BE: the Full value when the text still shows the solved value, else the parsed text;
// blank = null; an unparsable entry goes as its text and the BE reports it (never replaced here).
export function parsedFieldValue(text, solved) {
  const raw = String(text ?? "");
  if (raw.trim() === "") return null;
  if (solved && valuesEquivalent(raw, solved.text)) return solved.value;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : raw;
}

// A genuine edit (text no longer showing the solved value) drops the Full value behind the field; an event that
// leaves the shown value keeps it. store: a Map or a plain object of { text, value } by key.
export function dropSolvedIfEdited(store, key, text) {
  const solved = store instanceof Map ? store.get(key) : store?.[key];
  if (!solved || valuesEquivalent(text, solved.text)) return;
  if (store instanceof Map) store.delete(key);
  else delete store[key];
}

// ---- Headings and bearings -----------------------------------------------------------------------------------
export const normHeading = (number) => ((number % 360) + 360) % 360;
export const reciprocalHeading = (number) => normHeading(number + 180);

// A heading as shown in results: three digits and the degree sign ("030°"); "-" when not a number.
export function headingText(number) {
  if (!Number.isFinite(number)) return "-";
  const heading = ((Math.round(number) % 360) + 360) % 360;
  return String(heading).padStart(3, "0") + "°";
}

// A heading / bearing in an input: at most two decimals, trailing zeros dropped, three digits ("005", "123.5").
export function formatBearingInput(number) {
  const rounded = Math.round(normHeading(number) * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return text.padStart(3, "0");
}

// TO / FROM notation: the BE holds the bearing to the Target; FROM shows its reciprocal.
export const displayedBearing = (canonicalToTargetDeg, direction) => direction === "FROM_TARGET"
  ? reciprocalHeading(canonicalToTargetDeg)
  : normHeading(canonicalToTargetDeg);
export const canonicalToTargetBearing = (displayedDeg, direction) => direction === "FROM_TARGET"
  ? reciprocalHeading(displayedDeg)
  : normHeading(displayedDeg);

// The TO / FROM pair of a bearing: #<prefix>-to-target-btn and #<prefix>-from-target-btn.
export function setDirectionButtons(prefix, direction, root = document) {
  const toTarget = root.querySelector(`#${prefix}-to-target-btn`);
  const fromTarget = root.querySelector(`#${prefix}-from-target-btn`);
  if (!toTarget || !fromTarget) return;
  const toActive = direction === "TO_TARGET";
  toTarget.classList.toggle("active", toActive);
  fromTarget.classList.toggle("active", !toActive);
  toTarget.setAttribute("aria-pressed", String(toActive));
  fromTarget.setAttribute("aria-pressed", String(!toActive));
}

// ---- LOCK / LINK buttons -------------------------------------------------------------------------------------
export const LOCK_TEXTS = Object.freeze({ on: "LOCKED", off: "LOCK" });
export const LINK_TEXTS = Object.freeze({ on: "LINKED", off: "LINK" });

// Pressed state via aria-pressed; texts (LOCK_TEXTS, LINK_TEXTS) name the state; activeClass also toggles "active".
export function syncToggleButton(button, on, { texts = null, activeClass = false } = {}) {
  button.setAttribute("aria-pressed", String(on));
  if (activeClass) button.classList.toggle("active", on);
  if (texts) button.textContent = on ? texts.on : texts.off;
}

// The `[data-lock-key]` buttons from the LOCK states by key.
export function syncLockButtons(locks, root = document) {
  root.querySelectorAll("[data-lock-key]").forEach((button) => syncToggleButton(button, locks[button.dataset.lockKey] === true, { texts: LOCK_TEXTS }));
}

// A value the LOCKs settle shows the solved value and cannot be typed (data-lock-solved; no edit comes from it).
export const LOCK_SOLVED_TITLE = "Solved from the LOCKed values (unlock one to enter it)";
export function markLockSolved(field, solved, title = LOCK_SOLVED_TITLE) {
  field.readOnly = solved;
  field.toggleAttribute("data-lock-solved", solved);
  if (solved) field.title = title;
  else if (field.title === title) field.removeAttribute("title");
}

// ---- Enter commit --------------------------------------------------------------------------------------------
// Enter in a numeric field commits at once; the browser's change that follows for the same field and text adds
// nothing (the commit already went).
export function createEnterCommit() {
  let last = null;
  return {
    mark(field) { last = { field, text: field.value }; },
    clear() { last = null; },
    // true once for the change that follows an Enter on the same field and text.
    consumed(field) {
      const same = last?.field === field && last.text === field.value;
      last = null;
      return same;
    },
  };
}

// ---- Section collapse ----------------------------------------------------------------------------------------
// Every section's head title becomes a toggle, and a "−" / "＋" control sits at the right of the head (same grammar
// as the inner input panels); the rest of the section goes into a body that hides. Idempotent: a section already
// installed is skipped, so a section added later is installed by calling again. Body ids are `${idPrefix}-${index}`
// (never reused). onOpen(section) after a body is shown; startsCollapsed(section) closes it at install.
export function installSectionDisclosure(sections, { idPrefix = "section-body", startsCollapsed = () => false, onOpen = () => {} } = {}) {
  [...sections].forEach((section, index) => {
    const header = section.firstElementChild;
    const heading = header?.querySelector("h2");
    if (!heading || heading.querySelector(".section-disclosure-toggle")) return;
    const body = document.createElement("div");
    let bodyId = `${idPrefix}-${index}`;
    while (document.getElementById(bodyId)) bodyId += "-b";
    body.id = bodyId;
    body.className = "section-disclosure-body";
    [...section.children].filter((child) => child !== header).forEach((child) => body.append(child));
    section.append(body);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "section-disclosure-toggle";
    button.textContent = heading.textContent;
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-controls", body.id);
    heading.replaceChildren(button);
    const icon = document.createElement("button");
    icon.type = "button";
    icon.className = "section-collapse-icon";
    icon.setAttribute("aria-controls", body.id);
    icon.setAttribute("aria-label", `Collapse ${heading.textContent}`);
    icon.textContent = "−";
    if (getComputedStyle(header).display === "block") heading.append(icon);
    else header.append(icon);
    const toggle = () => {
      body.hidden = !body.hidden;
      button.setAttribute("aria-expanded", String(!body.hidden));
      icon.setAttribute("aria-expanded", String(!body.hidden));
      icon.textContent = body.hidden ? "＋" : "−";
      icon.setAttribute("aria-label", `${body.hidden ? "Expand" : "Collapse"} ${button.textContent}`);
      if (!body.hidden) onOpen(section);
    };
    icon.setAttribute("aria-expanded", "true");
    button.addEventListener("click", toggle);
    icon.addEventListener("click", toggle);
    if (startsCollapsed(section)) toggle();
  });
}

// ---- Section tools -------------------------------------------------------------------------------------------
// The tool buttons in a section's head, before its collapse control: "fullBdp" / "advanced" toggle the section's
// show-full-bdp / show-advanced class (only when it holds .bdp-extra / .advanced-only), "save" and "default" call
// the page. toolsOf(section) lists the section's tools (none: no group). Idempotent like the collapse controls.
export function installSectionTools(sections, { toolsOf, defaultLabel = "Default", onSave = () => {}, onDefault = () => {} }) {
  [...sections].forEach((section) => {
    const header = section.firstElementChild;
    if (!header || header.querySelector(".section-tools")) return;
    const tools = toolsOf(section);
    if (!tools.length) return;
    const title = header.querySelector("h2")?.textContent.trim() ?? section.dataset.tab;
    const group = document.createElement("span");
    group.className = "section-tools";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", `${title} controls`);
    const make = (tool, text) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn tab-tool";
      button.dataset.tabTool = tool;
      button.textContent = text;
      group.append(button);
      return button;
    };
    tools.forEach((tool) => {
      if (tool === "fullBdp" && !section.querySelector(".bdp-extra")) return;
      if (tool === "advanced" && !section.querySelector(".advanced-only")) return;
      if (tool === "fullBdp" || tool === "advanced") {
        const className = tool === "fullBdp" ? "show-full-bdp" : "show-advanced";
        const label = tool === "fullBdp" ? "Full BDP" : "Advanced";
        const button = make(tool, `${label}: Off`);
        button.setAttribute("aria-pressed", "false");
        button.addEventListener("click", () => {
          const on = section.classList.toggle(className);
          button.classList.toggle("active", on);
          button.setAttribute("aria-pressed", String(on));
          button.textContent = `${label}: ${on ? "On" : "Off"}`;
        });
      } else if (tool === "save") {
        make(tool, "Save").addEventListener("click", (event) => { onSave(event.currentTarget, section); });
      } else if (tool === "default") {
        make(tool, defaultLabel).addEventListener("click", () => { onDefault(section); });
      }
    });
    const icon = header.querySelector(".section-collapse-icon");
    if (icon && icon.parentElement === header) header.insertBefore(group, icon);
    else header.append(group);
  });
}
