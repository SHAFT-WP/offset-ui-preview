// Presentation layer of index.html (the default Offset entry). Calculations, inputs and persistence
// stay in the shared Offset controller; this module only places its live nodes (index UI handoff
// 2026-10-06): left = Edit aircraft (one) + input tabs, centre = Offset Top View / BDP / SEM & Rejoin,
// right = Result / Z-Diagram / DED, every output tab showing the one shared set of shown aircraft.
import { offsetIndexUi } from "./controller-v0.1.mjs?v=80c4bc4e0520";

const app = document.getElementById("offset-calculator");
const followers = document.getElementById("flight-followers");
const flightSize = document.getElementById("flight-size");
let editAircraft = 1;
let inputTab = "offset";
let centerTab = "topview";
let reviewTab = "result";
let focusMode = false;

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

// Header: reuse the live controls and their listeners; never clone editable input state.
const header = app.querySelector(".topbar");
const titleBlock = header.firstElementChild;
titleBlock.prepend(make("div", "wide-eyebrow", "FLIGHT SIM TOOLS  /  OFFSET"));
titleBlock.querySelector(".subline").textContent = "Wide workspace · BMS simulation";
const toolbar = header.querySelector(".toolbar");
const originalLink = make("a", "btn wide-standard-link", "Standard layout");
originalLink.href = "./index-standard.html";
toolbar.append(originalLink);
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
const topViewSection = document.getElementById("offset-top-view")?.closest("section");

// ---- three panes -------------------------------------------------------------------------------
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

// Left: Edit aircraft (single) + input tabs. Follower inputs stay inside #flight-followers.
const editNav = make("nav", "wide-edit-nav");
editNav.setAttribute("aria-label", "Edit aircraft");
editNav.append(make("span", "wide-control-label", "Edit aircraft"));
for (let n = 1; n <= 4; n += 1) {
  const edit = button("wide-aircraft-button", "#" + n, { "data-edit-aircraft": String(n), "aria-pressed": "false", "aria-label": "Edit aircraft #" + n });
  edit.addEventListener("click", () => selectEditAircraft(n));
  editNav.append(edit);
}
const inputNav = make("nav", "wide-input-nav");
inputNav.setAttribute("aria-label", "Input tabs");
const INPUT_TABS = [["offset", "Offset"], ["bdp", "BDP"], ["reference", "Reference"], ["save", "Save"]];
for (const [key, label] of INPUT_TABS) {
  const tab = button("wide-input-button", label, { "data-wide-input": key, "aria-pressed": "false" });
  tab.addEventListener("click", () => chooseInput(key));
  inputNav.append(tab);
}
const inputScroll = make("div", "wide-input-scroll");
const leadInputHost = make("div", "wide-lead-inputs");
leadInputHost.dataset.editAircraftHost = "1";
leadInputHost.append(...leadInputs);
inputScroll.append(leadInputHost, followers);
if (saveSection) inputScroll.append(saveSection);
inputs.append(editNav, inputNav, inputScroll);

// One "Show aircraft" row: the controller's Top View buttons attribute, so every row edits the one
// shared set and the controller keeps them all in sync.
function showAircraftRow() {
  const row = make("div", "diagram-action-row top-view-aircraft wide-show-aircraft");
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "Shown aircraft");
  row.append(make("span", "diagram-control-label", "Show aircraft"));
  for (let n = 1; n <= 4; n += 1) {
    row.append(button("capture-button view-toggle", "#" + n, { "data-top-view-aircraft-button": String(n), "aria-pressed": "false" }));
  }
  return row;
}
const emptyNote = () => {
  const note = make("p", "wide-empty", "표시할 기체를 선택하세요");
  note.hidden = true;
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

// Centre: Offset Top View / BDP (Top View + Profile per shown aircraft) / SEM & Rejoin.
const centerNav = tabNav("Diagram tabs", [["topview", "Offset Top View"], ["bdp", "BDP"], ["sem", "SEM & Rejoin"]], "data-center-tab", chooseCenter);
const centerBody = make("div", "wide-center-body");
const centerPanels = {
  topview: make("div", "wide-center-panel"),
  bdp: make("div", "wide-center-panel wide-panel-card"),
  sem: make("div", "wide-center-panel wide-panel-card"),
};
for (const [key, panel] of Object.entries(centerPanels)) {
  panel.dataset.centerPanel = key;
  centerBody.append(panel);
}
if (topViewSection) {
  topViewSection.classList.add("wide-map-section");
  centerPanels.topview.append(topViewSection);
}
const bdpBlocks = make("div", "wide-blocks");
const bdpEmpty = emptyNote();
centerPanels.bdp.append(make("h2", "wide-panel-title", "BDP"), showAircraftRow(), bdpEmpty, bdpBlocks);
// SEM & Rejoin (§6.3): the tab and selection are ready; this Offset runtime draws no SEM view and has
// no Rejoin solver yet, so both say so instead of estimating a path.
const semEmpty = emptyNote();
const semNote = make("div", "wide-pending");
semNote.append(make("p", "wide-pending-line", "SEM view — 개발 예정"), make("p", "wide-pending-note", "SEM settings are in the BDP input tab; SEM / NLT values are in Result (Bomb Profile) and the BDP Profile."), make("p", "wide-pending-line", "Rejoin — 개발 예정"));
centerPanels.sem.append(make("h2", "wide-panel-title", "SEM & Rejoin"), showAircraftRow(), semEmpty, semNote);
center.append(centerNav, centerBody);

// Right: Result / Z-Diagram / DED, the shown aircraft as consecutive blocks in number order.
const reviewNav = tabNav("Review tabs", [["result", "Result"], ["z", "Z-Diagram"], ["ded", "DED"]], "data-review-tab", chooseReview);
const reviewHead = make("div", "wide-review-head");
const dedSelectedPng = button("btn ded-png-button", "PNG (shown)", { "data-ded-png": "visible", title: "Save the DED of every shown aircraft as one PNG" });
reviewHead.append(showAircraftRow(), dedSelectedPng);
const reviewScroll = make("div", "wide-review-scroll");
const reviewEmpty = emptyNote();
const reviewBlocks = { result: make("div", "wide-blocks"), z: make("div", "wide-blocks"), ded: make("div", "wide-blocks") };
for (const [key, host] of Object.entries(reviewBlocks)) host.dataset.reviewPanel = key;
reviewScroll.append(reviewEmpty, ...Object.values(reviewBlocks));
review.append(reviewNav, reviewHead, reviewScroll);
const blockHosts = { ...reviewBlocks, bdp: bdpBlocks };

const footer = make("footer", "wide-footer");
footer.append(make("span", "", "WIDE LAYOUT"), make("span", "", "Independent panel scrolling · Focus view: Esc to return"));
app.append(footer);

// ---- per-aircraft output blocks ------------------------------------------------------------------
const aircraftColors = { 1: "#4c5966", 2: "#8a3ab9", 3: "#2f9e6e", 4: "#b5651d" };
function statePill(number) {
  return document.getElementById(number === 1 ? "state-pill" : "flight-state-pill-" + number);
}
function blockFor(kind, number) {
  const host = blockHosts[kind];
  let block = host.querySelector(`:scope > [data-block-aircraft="${number}"]`);
  if (!block) {
    block = make("div", "wide-block");
    block.dataset.blockAircraft = String(number);
    block.style.setProperty("--aircraft-color", aircraftColors[number]);
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
  const message = document.getElementById(editAircraft === 1 ? "constraint-message" : "flight-status-" + editAircraft);
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
  bdpEmpty.hidden = semEmpty.hidden = reviewEmpty.hidden = visible.length > 0;
  if (centerTab === "bdp") offsetIndexUi.showBdpViews(visible);
}

// ---- tabs ------------------------------------------------------------------------------------------
function pressed(nav, attribute, key) {
  for (const node of nav.querySelectorAll(`[${attribute}]`)) node.setAttribute("aria-pressed", String(node.getAttribute(attribute) === key));
}
function sectionAircraft(section) {
  return section.closest(".flight-slot") ? Number(section.closest(".flight-slot").dataset.aircraft) : 1;
}
function chooseInput(key) {
  inputTab = key;
  pressed(inputNav, "data-wide-input", key);
  const sections = [...leadInputs, ...followers.querySelectorAll(".flight-slot > .section[data-tab]")];
  for (const section of sections) {
    const tab = section.dataset.tab === "formation" ? "reference" : section.dataset.tab;
    section.hidden = key === "save" || sectionAircraft(section) !== editAircraft || tab !== key;
  }
  if (saveSection) saveSection.hidden = key !== "save";
  inputScroll.scrollTop = 0;
}
function selectEditAircraft(number) {
  const size = Number(flightSize.value);
  editAircraft = number >= 1 && number <= size ? number : 1;
  for (const node of editNav.querySelectorAll("[data-edit-aircraft]")) {
    const n = Number(node.dataset.editAircraft);
    node.hidden = n > size;
    node.setAttribute("aria-pressed", String(n === editAircraft));
  }
  inputNav.querySelector('[data-wide-input="reference"]').textContent = editAircraft === 1 ? "Reference" : "Formation";
  chooseInput(inputTab);
  syncStatus();
}
function chooseCenter(key) {
  centerTab = key;
  pressed(centerNav, "data-center-tab", key);
  for (const [name, panel] of Object.entries(centerPanels)) panel.hidden = name !== key;
  // BDP views are drawn only while the centre BDP tab shows them (latest result on re-entry).
  offsetIndexUi.showBdpViews(key === "bdp" ? shown : []);
  center.dataset.activeTab = key;
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}
function chooseReview(key) {
  reviewTab = key;
  pressed(reviewNav, "data-review-tab", key);
  for (const [name, host] of Object.entries(reviewBlocks)) host.hidden = name !== key;
  dedSelectedPng.hidden = key !== "ded";
  review.dataset.activeTab = key;
  reviewScroll.scrollTop = 0;
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}

function syncFollowers() {
  syncOutputs();
  applyShown(offsetIndexUi.visibleAircraft());
  selectEditAircraft(editAircraft);
  offsetIndexUi.syncDedPngButtons();
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

// Slot replacement (Flight Size) only, not calculator/SVG value changes.
new MutationObserver(syncFollowers).observe(followers, { childList: true });
new MutationObserver((records) => {
  if (records.some((record) => (record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement)?.closest("#state-pill, [id^='flight-state-pill-'], #constraint-message, [id^='flight-status-']"))) syncStatus();
}).observe(app, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
const measureHeader = () => {
  const top = workspaceBar.getBoundingClientRect().bottom - app.getBoundingClientRect().top + 12;
  app.style.setProperty("--wide-top", Math.ceil(top) + "px");
};
new ResizeObserver(measureHeader).observe(header);
new ResizeObserver(measureHeader).observe(workspaceBar);
window.addEventListener("resize", measureHeader);

syncOutputs();
offsetIndexUi.onVisibleAircraftChange(applyShown);
offsetIndexUi.syncShowAircraftButtons();
// First entry (§2): input Offset, centre Offset Top View, right Result, edit #1, shown #1.
selectEditAircraft(1);
chooseInput("offset");
chooseCenter("topview");
chooseReview("result");
syncFollowers();
measureHeader();
document.body.dataset.wideReady = "true";
