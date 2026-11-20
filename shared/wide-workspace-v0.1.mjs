// PC Wide workspace of a bombing page (bombing app shared FE since 2026-10-22, from the Offset index layout, handoff
// 2026-10-06): left = Edit aircraft (one) + input tabs, centre = diagram tabs, right = review tabs (Result /
// Z-Diagram / DED), every output tab showing the one shared set of shown aircraft as per-aircraft blocks. It only
// places the page's live nodes and switches what is shown: calculations, inputs and persistence stay with the page
// controller, reached through `ui` (shown aircraft, edited aircraft, DED PNG state, section collapse). The page gives
// its tabs and the hooks for what a tab change draws. Styles: wide-workspace-v0.1.css (body.bombing-wide).
import { AIRCRAFT_COLORS, AIRCRAFT_NUMBERS, showAircraftRow } from "./flight-ui-v0.1.mjs?v=0.1.0";

// 0.1.1 (2026-10-25, BOX page): fullBdpOnEditLine false keeps the Full BDP toggle in the BDP tab head (shared BDP tab).
// 0.1.2 (2026-11-02, Offset Flight Formation): a page section marked data-flight-wide is the Flight's, not one
// aircraft's: it shows in its tab whichever aircraft is edited; data-flight-wide="after" places it after the followers'
// sections (the Formation top view under the edited aircraft's own Formation fields).
// 0.1.3 (owner 2026-11-20, Offset / POP-UP): `resizable` puts a drag bar between the panes (PC ≥1100px). A side pane's
// content shrinks with it down to 80 % of its default width, then keeps that size and is cut, with a horizontal scroll
// bar (DED, Z-Diagram, Result and inputs never squeeze their text). Widths are kept per page in this browser only
// (never in a save); double-click a bar or "Reset panels" returns to the default widths.
export const WIDE_WORKSPACE_V0_1 = Object.freeze({ id: "bombing-wide-workspace-v0.1", version: "0.1.3" });

// Pane resize limits (px): a side pane's narrowest width and the centre's narrowest width.
const RESIZE_SIDE_MIN_PX = 200;
const RESIZE_CENTER_MIN_PX = 420;
const RESIZE_KEY_STEP_PX = 16;

const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (className, text, attributes = {}) => {
  const node = make("button", className, text);
  node.type = "button";
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
};

// options:
// - app: the page root (#…-calculator) with its .topbar, the #1 sections ([data-tab]; "save" = the Save/Load tab)
//   and followers (#flight-followers, whose .flight-slot sections the controller builds); flightSize: the select.
// - eyebrow, standardHref: the header line above the title and the Standard layout link.
// - inputTabs: [[key, label, { hidden(editAircraft) }]] in order; inputPanes: keys whose tab shows one section of
//   its own (made here, e.g. "sr") instead of the edited aircraft's sections.
// - sectionTab(section, aircraft): the input tab a section belongs to (default its data-tab); shownInputKey(tab,
//   editAircraft): the tab shown for a chosen one (default the same).
// - centerTabs: [[key, label, panel]] with panel { section } (a page section moved in), { title, blocks: true }
//   (per-aircraft blocks of that output kind) or { title, host: true } (an element the page fills).
// - centerOfInput / inputOfCenter: an input tab brings its centre tab and back (handoff 2026-10-13 §3).
// - reviewTabs: [[key, label]], each a per-aircraft block kind; "ded" brings the "PNG (shown)" button.
// - statePill(number), statusMessage(number), statusSelector: each aircraft's state chip and message.
// - ui: the page controller hooks (visibleAircraft, onVisibleAircraftChange, syncShowAircraftButtons,
//   registerEditAircraft, savedEditAircraft, syncDedPngButtons, installSectionDisclosure).
// - onShown(visible, centerTab), onCenterTab(key, previous), onEditAircraft(number): what the page draws.
// - fullBdpOnEditLine (default true, Offset): the BDP tab's Full BDP toggle on the Edit aircraft line; false (BOX,
//   shared BDP tab, owner 2026-10-25) leaves it in the tab head, immediately before Tab Default.
// - resizable (default false; Offset and POP-UP): drag bars between the panes (0.1.3).
export function mountWideWorkspace(options) {
  const {
    app, followers, flightSize, eyebrow, standardHref, inputTabs, inputPanes = [], centerTabs, reviewTabs,
    centerOfInput = {}, inputOfCenter = {}, sectionTab = (section) => section.dataset.tab, shownInputKey = (tab) => tab,
    statePill, statusMessage, statusSelector, ui, onShown = () => {}, onCenterTab = () => {}, onEditAircraft = () => {},
    fullBdpOnEditLine = true, resizable = false,
  } = options;
  if (!fullBdpOnEditLine) app.dataset.fullBdpPlacement = "head";
  let editAircraft = 1;
  // Both start unset so the first entry applies them.
  let inputTab = null;
  let centerTab = null;
  let focusMode = false;

  // Header: reuse the live controls and their listeners; never clone editable input state.
  const header = app.querySelector(".topbar");
  const titleBlock = header.firstElementChild;
  titleBlock.prepend(make("div", "wide-eyebrow", eyebrow));
  titleBlock.querySelector(".subline").textContent = "Wide workspace · BMS simulation";
  const toolbar = header.querySelector(".toolbar");
  const standardLink = make("a", "btn wide-standard-link", "Standard layout");
  standardLink.href = standardHref;
  toolbar.append(standardLink);
  const focusButton = button("btn wide-focus-button", "Focus view", { "aria-pressed": "false", title: "Expand the diagrams; Escape restores the panels" });
  toolbar.append(focusButton);

  const workspaceBar = make("div", "wide-workspace-bar");
  const selectedLabel = make("span", "wide-selected-label", "EDIT #1");
  const status = make("span", "wide-status status ok", "VALID");
  status.setAttribute("role", "status");
  const hint = make("span", "wide-workspace-hint", "Inputs · Diagrams · Review");
  const validation = make("p", "wide-validation");
  validation.hidden = true;
  validation.setAttribute("role", "alert");
  workspaceBar.append(selectedLabel, status, hint, validation);
  header.after(workspaceBar);

  // Source sections of #1 (followers bring theirs when the controller builds their slots).
  const leadChildren = [...app.children].filter((node) => node !== header && node !== workspaceBar && node !== followers);
  const leadInputs = leadChildren.filter((node) => node.dataset.tab && node.dataset.tab !== "save");
  const saveSection = leadChildren.find((node) => node.dataset.tab === "save");

  // ---- three panes ---------------------------------------------------------------------------------------------
  const workspace = make("div", "wide-workspace");
  workspace.id = "wide-workspace";
  const inputs = make("div", "wide-pane wide-inputs");
  const center = make("div", "wide-pane wide-center");
  const review = make("div", "wide-pane wide-review");
  inputs.setAttribute("aria-label", "Inputs");
  center.setAttribute("aria-label", "Diagrams");
  review.setAttribute("aria-label", "Review");
  workspace.append(inputs, center, review);
  app.insertBefore(workspace, followers);

  // Left: Edit aircraft (single) + input tabs. Follower inputs stay inside the followers host.
  const editNav = make("nav", "wide-edit-nav");
  editNav.setAttribute("aria-label", "Edit aircraft");
  editNav.append(make("span", "wide-control-label", "Edit aircraft"));
  // Full BDP (owner 2026-10-19): the BDP tab's Full BDP toggle sits on this line beside the title, while the BDP tab
  // is shown. It acts on the edited aircraft's BDP tab (each aircraft keeps its own state); the tab head's own toggle
  // stays in the DOM, hidden here.
  const fullBdpButton = button("wide-full-bdp-button", "Full BDP: Off", { "data-wide-full-bdp": "", "aria-pressed": "false" });
  fullBdpButton.hidden = true;
  fullBdpButton.addEventListener("click", () => {
    editedFullBdpToggle()?.click();
    syncFullBdpButton();
  });
  editNav.append(fullBdpButton);
  for (const n of AIRCRAFT_NUMBERS) {
    const edit = button("wide-aircraft-button", "#" + n, { "data-edit-aircraft": String(n), "aria-pressed": "false", "aria-label": "Edit aircraft #" + n });
    edit.addEventListener("click", () => selectEditAircraft(n));
    editNav.append(edit);
  }
  const inputNav = make("nav", "wide-input-nav");
  inputNav.setAttribute("aria-label", "Input tabs");
  for (const [key, label] of inputTabs) {
    const tab = button("wide-input-button", label, { "data-wide-input": key, "aria-pressed": "false" });
    tab.addEventListener("click", () => chooseInput(key));
    inputNav.append(tab);
  }
  const inputScroll = make("div", "wide-input-scroll");
  const leadInputHost = make("div", "wide-lead-inputs");
  leadInputHost.dataset.editAircraftHost = "1";
  const afterFollowers = leadInputs.filter((node) => node.dataset.flightWide === "after");
  leadInputHost.append(...leadInputs.filter((node) => !afterFollowers.includes(node)));
  const trailingInputHost = make("div", "wide-lead-inputs wide-flight-after");
  trailingInputHost.append(...afterFollowers);
  // An input pane tab (S&R): one section showing the edited aircraft, filled by the page.
  const paneSections = new Map(inputPanes.map((key) => [key, make("section")]));
  inputScroll.append(leadInputHost, followers, ...(afterFollowers.length ? [trailingInputHost] : []), ...paneSections.values());
  if (saveSection) {
    inputScroll.append(saveSection);
    paneSections.set("save", saveSection);
  }
  inputs.append(editNav, inputNav, inputScroll);

  const emptyNotes = [];
  const emptyNote = () => {
    const note = make("p", "wide-empty", "표시할 기체를 선택하세요");
    note.hidden = true;
    emptyNotes.push(note);
    return note;
  };

  function tabNav(label, tabs, attribute, onChoose) {
    const nav = make("nav", "wide-input-nav wide-tab-nav");
    nav.setAttribute("aria-label", label);
    for (const [key, text] of tabs) {
      const tab = button("wide-input-button", text, { [attribute]: key, "aria-pressed": "false" });
      tab.addEventListener("click", () => onChoose(key));
      nav.append(tab);
    }
    return nav;
  }

  // Centre: the page's diagram tabs.
  const centerNav = tabNav("Diagram tabs", centerTabs, "data-center-tab", chooseCenter);
  const centerBody = make("div", "wide-center-body");
  const centerPanels = {};
  const centerHosts = {};
  const centerBlocks = {};
  const isSectionPanel = (panel) => Object.hasOwn(panel, "section");
  for (const [key, , panel] of centerTabs) {
    const node = make("div", isSectionPanel(panel) ? "wide-center-panel" : "wide-center-panel wide-panel-card");
    node.dataset.centerPanel = key;
    centerBody.append(node);
    centerPanels[key] = node;
  }
  for (const [key, , panel] of centerTabs) {
    const node = centerPanels[key];
    if (isSectionPanel(panel)) {
      if (panel.section) {
        panel.section.classList.add("wide-map-section");
        node.append(panel.section);
      }
      continue;
    }
    const content = make("div", panel.blocks ? "wide-blocks" : undefined);
    node.append(make("h2", "wide-panel-title", panel.title), showAircraftRow(), emptyNote(), content);
    if (panel.blocks) centerBlocks[key] = content;
    else centerHosts[key] = content;
  }
  center.append(centerNav, centerBody);

  // Right: the review tabs, the shown aircraft as consecutive blocks in number order.
  const reviewNav = tabNav("Review tabs", reviewTabs, "data-review-tab", chooseReview);
  const reviewHead = make("div", "wide-review-head");
  const reviewKeys = reviewTabs.map(([key]) => key);
  const dedSelectedPng = reviewKeys.includes("ded") ? button("btn ded-png-button", "PNG (shown)", { "data-ded-png": "visible", title: "Save the DED of every shown aircraft as one PNG" }) : null;
  reviewHead.append(showAircraftRow(), ...(dedSelectedPng ? [dedSelectedPng] : []));
  const reviewScroll = make("div", "wide-review-scroll");
  const reviewEmpty = emptyNote();
  const reviewBlocks = Object.fromEntries(reviewKeys.map((key) => [key, make("div", "wide-blocks")]));
  for (const [key, host] of Object.entries(reviewBlocks)) host.dataset.reviewPanel = key;
  reviewScroll.append(reviewEmpty, ...Object.values(reviewBlocks));
  review.append(reviewNav, reviewHead, reviewScroll);
  // Every per-aircraft block host by output kind: the review's, then the centre's.
  const blockHosts = { ...reviewBlocks, ...centerBlocks };

  const footer = make("footer", "wide-footer");
  footer.append(make("span", "", "WIDE LAYOUT"), make("span", "", "Independent panel scrolling · Focus view: Esc to return"));
  app.append(footer);

  // ---- per-aircraft output blocks -------------------------------------------------------------------------------
  function blockFor(kind, number) {
    const host = blockHosts[kind];
    let block = host.querySelector(`:scope > [data-block-aircraft="${number}"]`);
    if (!block) {
      block = make("div", "wide-block");
      block.dataset.blockAircraft = String(number);
      block.style.setProperty("--aircraft-color", AIRCRAFT_COLORS[number]);
      const head = make("div", "wide-block-head");
      head.append(make("span", "wide-block-number", "#" + number), make("span", "wide-block-state status ok", "VALID"));
      block.append(head);
      const next = [...host.children].find((child) => Number(child.dataset.blockAircraft) > number);
      host.insertBefore(block, next ?? null);
    }
    return block;
  }
  // Collects every aircraft's output sections (data-aircraft-output) into their blocks, ascending.
  function syncOutputs() {
    for (const node of document.querySelectorAll("[data-aircraft-output]")) {
      const kind = node.dataset.aircraftOutput;
      const number = Number(node.dataset.outputAircraft);
      if (!blockHosts[kind] || !number) continue;
      const block = blockFor(kind, number);
      if (node.parentElement !== block) block.append(node);
    }
    // Blocks whose aircraft left (Flight Size) or whose output the controller rebuilt.
    for (const host of Object.values(blockHosts)) {
      for (const block of [...host.children]) {
        if (!block.querySelector("[data-aircraft-output]")) block.remove();
      }
    }
  }

  function syncStatus() {
    for (const block of workspace.querySelectorAll("[data-block-aircraft]")) {
      const pill = statePill(Number(block.dataset.blockAircraft));
      const chip = block.querySelector(".wide-block-state");
      chip.textContent = pill?.textContent || "N/A";
      chip.className = "wide-block-state " + (pill?.className || "status");
    }
    const source = statePill(editAircraft);
    const message = statusMessage(editAircraft);
    const text = source?.textContent || "N/A";
    status.textContent = text;
    status.className = "wide-status " + (source?.className || "status");
    status.title = message?.textContent || "";
    validation.hidden = !/invalid|bad|warn|caution|error/i.test(status.className + " " + text);
    validation.textContent = validation.hidden ? "" : "#" + editAircraft + " · " + (message?.textContent || text);
    selectedLabel.textContent = "EDIT #" + editAircraft;
  }

  let shown = [1];
  function applyShown(visible) {
    shown = visible;
    for (const host of Object.values(blockHosts)) {
      for (const block of host.children) block.hidden = !visible.includes(Number(block.dataset.blockAircraft));
    }
    emptyNotes.forEach((note) => { note.hidden = visible.length > 0; });
    onShown(visible, centerTab);
  }

  // ---- tabs ---------------------------------------------------------------------------------------------------
  function pressed(nav, attribute, key) {
    for (const node of nav.querySelectorAll(`[${attribute}]`)) node.setAttribute("aria-pressed", String(node.getAttribute(attribute) === key));
  }
  function sectionAircraft(section) {
    return section.closest(".flight-slot") ? Number(section.closest(".flight-slot").dataset.aircraft) : 1;
  }
  const aircraftSections = () => [...leadInputs, ...followers.querySelectorAll(".flight-slot > .section[data-tab]")];
  function editedFullBdpToggle() {
    return aircraftSections().find((section) => section.dataset.tab === "bdp" && sectionAircraft(section) === editAircraft)?.querySelector('[data-tab-tool="fullBdp"]') ?? null;
  }
  function syncFullBdpButton() {
    const toggle = editedFullBdpToggle();
    const on = toggle?.getAttribute("aria-pressed") === "true";
    fullBdpButton.hidden = !fullBdpOnEditLine || !toggle || inputTab !== "bdp";
    fullBdpButton.setAttribute("aria-pressed", String(on));
    fullBdpButton.textContent = `Full BDP: ${on ? "On" : "Off"}`;
  }
  // The tab head's toggle may still be pressed (an older handler, a test): follow it.
  document.addEventListener("click", (event) => {
    if (event.target?.closest?.('[data-tab-tool="fullBdp"]')) syncFullBdpButton();
  });
  // Shows the sections of the current input tab for the edited aircraft (inputTab keeps the choice, so a
  // follower's own tab comes back after visiting #1).
  function syncInputSections() {
    syncFullBdpButton();
    const shownKey = shownInputKey(inputTab, editAircraft);
    pressed(inputNav, "data-wide-input", shownKey);
    for (const section of aircraftSections()) {
      const ownAircraft = section.hasAttribute("data-flight-wide") || sectionAircraft(section) === editAircraft;
      section.hidden = paneSections.has(shownKey) || !ownAircraft || sectionTab(section, sectionAircraft(section)) !== shownKey;
    }
    for (const [key, node] of paneSections) node.hidden = shownKey !== key;
  }
  function applyInputTab(key) {
    if (key === inputTab) return false;
    inputTab = key;
    syncInputSections();
    inputScroll.scrollTop = 0;
    return true;
  }
  // An input tab brings its centre view with it; a centre tab changes the centre only (owner 2026-10-22): the input
  // tab, the edited aircraft and the inputs stay as they are. The tab already shown is a no-op (no calculation, no
  // redraw).
  function activateWorkspace(centerKey) {
    const inputChanged = applyInputTab(inputOfCenter[centerKey]);
    const centerChanged = applyCenterTab(centerKey);
    return inputChanged || centerChanged;
  }
  function chooseInput(key) {
    if (centerOfInput[key]) return activateWorkspace(centerOfInput[key]);
    return applyInputTab(key);
  }
  function chooseCenter(key) {
    return applyCenterTab(key);
  }
  function selectEditAircraft(number) {
    const size = Number(flightSize.value);
    editAircraft = number >= 1 && number <= size ? number : 1;
    for (const node of editNav.querySelectorAll("[data-edit-aircraft]")) {
      const n = Number(node.dataset.editAircraft);
      node.hidden = n > size;
      node.setAttribute("aria-pressed", String(n === editAircraft));
    }
    for (const [key, , tabOptions] of inputTabs) {
      if (tabOptions?.hidden) inputNav.querySelector(`[data-wide-input="${key}"]`).hidden = tabOptions.hidden(editAircraft);
    }
    if (inputTab) syncInputSections();
    onEditAircraft(editAircraft);
    syncStatus();
  }
  function applyCenterTab(key) {
    if (key === centerTab) return false;
    const previous = centerTab;
    centerTab = key;
    pressed(centerNav, "data-center-tab", key);
    for (const [name, panel] of Object.entries(centerPanels)) panel.hidden = name !== key;
    onCenterTab(key, previous, shown);
    center.dataset.activeTab = key;
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    return true;
  }
  function chooseReview(key) {
    pressed(reviewNav, "data-review-tab", key);
    for (const [name, host] of Object.entries(reviewBlocks)) host.hidden = name !== key;
    if (dedSelectedPng) dedSelectedPng.hidden = key !== "ded";
    review.dataset.activeTab = key;
    reviewScroll.scrollTop = 0;
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }

  function syncFollowers() {
    syncOutputs();
    applyShown(ui.visibleAircraft());
    selectEditAircraft(editAircraft);
    ui.syncDedPngButtons();
  }

  function setFocus(on) {
    focusMode = on;
    document.body.classList.toggle("wide-focus", on);
    focusButton.setAttribute("aria-pressed", String(on));
    focusButton.textContent = on ? "Restore panels" : "Focus view";
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }
  focusButton.addEventListener("click", () => setFocus(!focusMode));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && focusMode) {
      setFocus(false);
      focusButton.focus();
    }
  });

  // ---- resizable panes (0.1.3) ---------------------------------------------------------------------------------
  // The bars sit over the grid gaps (absolute, so the grid and every breakpoint stay as they were). A width is a
  // custom property on the workspace (--wide-input-user / --wide-review-user) that only the ≥1100px grid reads; the
  // body's --wide-input-width / --wide-review-width stay the defaults the content's 80 % floor is measured from.
  if (resizable) installPaneResize();
  function installPaneResize() {
    workspace.classList.add("wide-resizable");
    const storeKey = "bombing-wide-panes-v1:" + location.pathname.replace(/[^/]*$/, "");
    const readStore = () => {
      try { return JSON.parse(localStorage.getItem(storeKey) || "{}") || {}; } catch { return {}; }
    };
    const writeStore = (value) => {
      try {
        if (value.input || value.review) localStorage.setItem(storeKey, JSON.stringify(value));
        else localStorage.removeItem(storeKey);
      } catch { /* private window: widths last until the page closes */ }
    };
    const saved = readStore();
    const widths = { input: Number(saved.input) > 0 ? Number(saved.input) : null, review: Number(saved.review) > 0 ? Number(saved.review) : null };
    const panes = { input: inputs, review };
    const property = { input: "--wide-input-user", review: "--wide-review-user" };
    const label = { input: "Resize inputs and diagrams", review: "Resize diagrams and review" };
    const bars = {};
    for (const side of ["input", "review"]) {
      const bar = make("div", "wide-splitter");
      bar.dataset.wideSplitter = side;
      bar.tabIndex = 0;
      bar.setAttribute("role", "separator");
      bar.setAttribute("aria-orientation", "vertical");
      bar.setAttribute("aria-label", label[side]);
      bar.title = "Drag to resize · double-click to reset";
      workspace.append(bar);
      bars[side] = bar;
    }
    const resetButton = button("btn wide-reset-panels", "Reset panels", { "data-wide-reset-panels": "", title: "Return the panels to their default widths" });
    focusButton.before(resetButton);

    const active = () => getComputedStyle(bars.input).display !== "none";
    const gapPx = () => parseFloat(getComputedStyle(workspace).columnGap) || 0;
    // The widest a side pane may be now: the centre keeps RESIZE_CENTER_MIN_PX.
    const maxWidth = (side) => {
      const other = side === "input" ? "review" : "input";
      const otherWidth = panes[other].getBoundingClientRect().width;
      return Math.max(RESIZE_SIDE_MIN_PX, workspace.clientWidth - otherWidth - 2 * gapPx() - RESIZE_CENTER_MIN_PX);
    };
    const clampWidth = (side, value) => Math.round(Math.min(Math.max(value, RESIZE_SIDE_MIN_PX), maxWidth(side)));
    let notifyFrame = 0;
    const notifyResize = () => {
      cancelAnimationFrame(notifyFrame);
      notifyFrame = requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    };
    // Each bar centred on its gap.
    function place() {
      if (!active()) return;
      const box = workspace.getBoundingClientRect();
      const left = inputs.getBoundingClientRect();
      const mid = center.getBoundingClientRect();
      const right = review.getBoundingClientRect();
      bars.input.style.left = ((left.right + mid.left) / 2 - box.left) + "px";
      bars.review.style.left = ((mid.right + right.left) / 2 - box.left) + "px";
    }
    function apply() {
      for (const side of ["input", "review"]) {
        if (widths[side]) workspace.style.setProperty(property[side], widths[side] + "px");
        else workspace.style.removeProperty(property[side]);
      }
      resetButton.hidden = !(widths.input || widths.review);
      place();
    }
    function reset(side) {
      for (const key of side ? [side] : ["input", "review"]) widths[key] = null;
      writeStore(widths);
      apply();
      notifyResize();
    }
    function setWidth(side, value) {
      widths[side] = clampWidth(side, value);
      apply();
    }
    for (const side of ["input", "review"]) {
      const bar = bars[side];
      // The input bar grows the left pane to the right; the review bar grows the right pane to the left.
      const sign = side === "input" ? 1 : -1;
      let drag = null;
      let frame = 0;
      bar.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || !active()) return;
        event.preventDefault();
        drag = { x: event.clientX, width: panes[side].getBoundingClientRect().width, next: null };
        bar.setPointerCapture?.(event.pointerId);
        bar.classList.add("dragging");
        document.body.classList.add("wide-resizing");
      });
      bar.addEventListener("pointermove", (event) => {
        if (!drag) return;
        drag.next = drag.width + sign * (event.clientX - drag.x);
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (drag?.next != null) setWidth(side, drag.next);
        });
      });
      const end = (event) => {
        if (!drag) return;
        if (drag.next != null) setWidth(side, drag.next);
        drag = null;
        bar.releasePointerCapture?.(event.pointerId);
        bar.classList.remove("dragging");
        document.body.classList.remove("wide-resizing");
        writeStore(widths);
        notifyResize();
      };
      bar.addEventListener("pointerup", end);
      bar.addEventListener("pointercancel", end);
      bar.addEventListener("dblclick", () => reset(side));
      bar.addEventListener("keydown", (event) => {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        setWidth(side, panes[side].getBoundingClientRect().width + sign * step * RESIZE_KEY_STEP_PX);
        writeStore(widths);
        notifyResize();
      });
    }
    resetButton.addEventListener("click", () => reset());
    // A narrower window: the centre keeps its minimum (only what is applied changes, not the kept widths).
    const fit = () => {
      if (!active()) return;
      for (const side of ["input", "review"]) {
        if (widths[side]) workspace.style.setProperty(property[side], clampWidth(side, widths[side]) + "px");
      }
      place();
    };
    window.addEventListener("resize", fit);
    for (const node of [workspace, inputs, center, review]) new ResizeObserver(place).observe(node);
    apply();
  }

  // Slot replacement (Flight Size) only, not calculator/SVG value changes.
  new MutationObserver(syncFollowers).observe(followers, { childList: true });
  new MutationObserver((records) => {
    if (records.some((record) => (record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement)?.closest(statusSelector))) syncStatus();
  }).observe(app, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  const measureHeader = () => {
    const top = workspaceBar.getBoundingClientRect().bottom - app.getBoundingClientRect().top + 12;
    app.style.setProperty("--wide-top", Math.ceil(top) + "px");
  };
  new ResizeObserver(measureHeader).observe(header);
  new ResizeObserver(measureHeader).observe(workspaceBar);
  window.addEventListener("resize", measureHeader);

  return {
    editAircraft: () => editAircraft,
    selectEditAircraft,
    inputPane: (key) => paneSections.get(key),
    centerHost: (key) => centerHosts[key],
    // First entry: the input tab of `center`, that centre tab, the `review` tab, the saved edited aircraft (else #1),
    // the shown aircraft. Call after the page mounted what fills the panes.
    start({ center: firstCenter, review: firstReview }) {
      syncOutputs();
      ui.onVisibleAircraftChange(applyShown);
      ui.syncShowAircraftButtons();
      ui.registerEditAircraft(() => editAircraft);
      selectEditAircraft(ui.savedEditAircraft() ?? 1);
      activateWorkspace(firstCenter);
      chooseReview(firstReview);
      syncFollowers();
      measureHeader();
      document.body.dataset.wideReady = "true";
    },
  };
}
