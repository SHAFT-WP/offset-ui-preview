// Presentation-only companion to index-wide.html. All calculations, inputs and
// persistence remain in the unchanged Offset controller and owning view modules.
import "./controller-v0.1.mjs?v=e8e2baf64b7e";

const app = document.getElementById("offset-calculator");
const followers = document.getElementById("flight-followers");
const flightSize = document.getElementById("flight-size");
const workspaces = new Map();
let selectedAircraft = 1;
let focusMode = false;

const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// Reuse the live controls and their listeners; never clone editable input state.
const header = app.querySelector(".topbar");
const titleBlock = header.firstElementChild;
titleBlock.prepend(make("div", "wide-eyebrow", "FLIGHT SIM TOOLS  /  OFFSET"));
titleBlock.querySelector(".subline").textContent = "Wide workspace · BMS simulation";
const toolbar = header.querySelector(".toolbar");
const temp = toolbar.querySelector(".temp-def");
const utilities = make("details", "wide-utilities");
utilities.append(make("summary", "", "Temp Def"), temp);
toolbar.append(utilities);
const originalLink = make("a", "btn wide-standard-link", "Standard layout");
originalLink.href = "./index.html";
toolbar.append(originalLink);
const focusButton = make("button", "btn wide-focus-button", "Focus view");
focusButton.type = "button";
focusButton.setAttribute("aria-pressed", "false");
focusButton.title = "Expand Top View; Escape restores the panels";
toolbar.append(focusButton);

const workspaceBar = make("div", "wide-workspace-bar");
const aircraftNav = make("nav", "wide-aircraft-nav");
aircraftNav.setAttribute("aria-label", "Aircraft workspace");
for (let n = 1; n <= 4; n++) {
  const button = make("button", "wide-aircraft-button", "#" + n);
  button.type = "button";
  button.dataset.wideAircraft = String(n);
  button.setAttribute("aria-label", "Show aircraft #" + n + " workspace");
  button.addEventListener("click", () => selectAircraft(n));
  aircraftNav.append(button);
}
const selectedLabel = make("span", "wide-selected-label", "AIRCRAFT #1");
const status = make("span", "wide-status status ok", "VALID");
status.setAttribute("role", "status");
const hint = make("span", "wide-workspace-hint", "Inputs · Top View · Review");
const validation = make("p", "wide-validation");
validation.hidden = true;
validation.setAttribute("role", "alert");
const bdpViewsButton = make("button", "btn wide-bdp-button", "BDP Views");
bdpViewsButton.type = "button";
bdpViewsButton.dataset.fullViews = "1";
bdpViewsButton.setAttribute("aria-pressed", "false");
bdpViewsButton.title = "Show Roll-in Top View and Dive Profile for the selected aircraft";
bdpViewsButton.addEventListener("click", () => {
  // The existing controller owns the toggle/render. Scroll only after it runs.
  requestAnimationFrame(() => {
    const views = workspaces.get(selectedAircraft)?.querySelector(".bdp-views.show-full-views");
    if (views) {
      const pane = views.closest(".wide-center");
      pane.scrollTop = views.offsetTop - pane.offsetTop;
      if (window.innerWidth <= 760) views.scrollIntoView({ block: "start" });
    }
  });
});
workspaceBar.append(aircraftNav, selectedLabel, status, bdpViewsButton, hint, validation);
header.after(workspaceBar);

const lead = make("div", "wide-workspace");
lead.dataset.wideWorkspace = "1";
lead.id = "wide-aircraft-1";
const leadSections = [...app.children].filter(node =>
  node.classList.contains("section") || node.classList.contains("bdp-views"));
for (const section of leadSections) lead.append(section);
app.insertBefore(lead, followers);

const footer = make("footer", "wide-footer");
footer.append(
  make("span", "", "WIDE LAYOUT · PREVIEW"),
  make("span", "", "Independent panel scrolling · Focus view: Esc to return")
);
app.append(footer);

function buildWorkspace(root, number) {
  if (root.dataset.wideReady) return;
  root.dataset.wideReady = "true";
  root.classList.add("wide-workspace");
  root.dataset.wideWorkspace = String(number);
  root.id = "wide-aircraft-" + number;
  const sections = [...root.children];
  const inputs = make("div", "wide-pane wide-inputs");
  const center = make("div", "wide-pane wide-center");
  const review = make("div", "wide-pane wide-review");
  inputs.setAttribute("aria-label", "Aircraft #" + number + " inputs");
  center.setAttribute("aria-label", "Aircraft #" + number + " diagrams");
  review.setAttribute("aria-label", "Aircraft #" + number + " review");
  const inputNav = make("nav", "wide-input-nav");
  inputNav.setAttribute("aria-label", "Aircraft #" + number + " input sections");
  const inputScroll = make("div", "wide-input-scroll");
  const reviewHead = make("div", "wide-pane-heading", "PROFILE & READOUTS");
  const reviewScroll = make("div", "wide-review-scroll");
  inputs.append(inputNav, inputScroll);
  review.append(reviewHead, reviewScroll);
  const inputSections = [];
  const reviewSections = [];
  for (const section of sections) {
    if (section.dataset.tab) {
      inputSections.push(section);
      inputScroll.append(section);
    } else if (section.classList.contains("bdp-views")) {
      center.append(section);
    } else if (section.querySelector("#offset-top-view, [data-flight-topview]")) {
      section.classList.add("wide-map-section");
      center.append(section);
    } else {
      reviewSections.push(section);
    }
  }
  const rank = section => section.querySelector("#offset-z-svg, [data-flight-z]") ? 0
    : section.querySelector(".ded-boxes") ? 1 : 2;
  reviewSections.sort((a, b) => rank(a) - rank(b));
  reviewScroll.append(...reviewSections);
  root.append(inputs, center, review);

  for (const section of inputSections) {
    const key = section.dataset.tab;
    const label = { bdp: "BDP", reference: "Reference", offset: "Offset", formation: "Formation" }[key] ?? key;
    const button = make("button", "wide-input-button", label);
    button.type = "button";
    button.dataset.wideInput = key;
    section.id ||= "wide-input-" + number + "-" + key;
    button.setAttribute("aria-controls", section.id);
    button.addEventListener("click", () => chooseInput(key));
    inputNav.append(button);
  }
  function chooseInput(key) {
    for (const section of inputSections) section.hidden = section.dataset.tab !== key;
    for (const button of inputNav.children) {
      button.setAttribute("aria-pressed", String(button.dataset.wideInput === key));
    }
    inputScroll.scrollTop = 0;
  }
  chooseInput("bdp");
  workspaces.set(number, root);
}

buildWorkspace(lead, 1);

function syncFollowers() {
  // Flight-size changes rebuild these slots in the existing controller. Keep the
  // slots inside #flight-followers so its delegated input handlers still work.
  for (const [n, root] of workspaces) if (n > 1 && !root.isConnected) workspaces.delete(n);
  for (const slot of followers.querySelectorAll(":scope > .flight-slot")) {
    buildWorkspace(slot, Number(slot.dataset.aircraft));
  }
  const size = Number(flightSize.value);
  if (selectedAircraft > size) selectedAircraft = 1;
  selectAircraft(selectedAircraft);
}

function syncStatus() {
  const source = selectedAircraft === 1 ? document.getElementById("state-pill")
    : document.getElementById("flight-state-pill-" + selectedAircraft);
  const message = selectedAircraft === 1 ? document.getElementById("constraint-message")
    : document.getElementById("flight-status-" + selectedAircraft);
  const text = source?.textContent || "N/A";
  status.textContent = text;
  status.className = "wide-status " + (source?.className || "status");
  status.title = message?.textContent || "";
  validation.hidden = !/invalid|bad|warn|caution|error/i.test(status.className + " " + text);
  validation.textContent = validation.hidden ? "" : (message?.textContent || text);
  selectedLabel.textContent = "AIRCRAFT #" + selectedAircraft;
}

function syncBdpViewsButton() {
  bdpViewsButton.dataset.fullViews = String(selectedAircraft);
  const views = workspaces.get(selectedAircraft)?.querySelector(".bdp-views");
  bdpViewsButton.setAttribute("aria-pressed", String(views?.classList.contains("show-full-views") ?? false));
  bdpViewsButton.setAttribute("aria-label", "Show BDP Top View and Profile for aircraft #" + selectedAircraft);
}

function selectAircraft(number) {
  selectedAircraft = workspaces.has(number) ? number : 1;
  for (const [n, root] of workspaces) root.hidden = n !== selectedAircraft;
  followers.hidden = selectedAircraft === 1;
  for (const button of aircraftNav.children) {
    const n = Number(button.dataset.wideAircraft);
    button.hidden = n > Number(flightSize.value);
    button.setAttribute("aria-pressed", String(n === selectedAircraft));
    button.setAttribute("aria-controls", "wide-aircraft-" + n);
  }
  syncStatus();
  syncBdpViewsButton();
  // Existing SVG legends and result grids observe their rendered box size.
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}

function setFocus(on) {
  focusMode = on;
  document.body.classList.toggle("wide-focus", on);
  focusButton.setAttribute("aria-pressed", String(on));
  focusButton.textContent = on ? "Restore panels" : "Focus view";
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}
focusButton.addEventListener("click", () => setFocus(!focusMode));
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && focusMode) {
    setFocus(false);
    focusButton.focus();
  }
});

// Watch only replacement of aircraft slots, not calculator/SVG value changes.
new MutationObserver(syncFollowers).observe(followers, { childList: true });
for (const root of [lead, followers]) {
  new MutationObserver(records => {
    if (records.some(record => record.target.nodeType === Node.ELEMENT_NODE && record.target.matches(".bdp-views"))) syncBdpViewsButton();
    if (records.some(record => (record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement)?.closest("#state-pill, [id^='flight-state-pill-'], #constraint-message, [id^='flight-status-']"))) syncStatus();
  }).observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
}
const measureHeader = () => {
  const top = workspaceBar.offsetTop + workspaceBar.offsetHeight + 12;
  app.style.setProperty("--wide-top", Math.ceil(top) + "px");
};
new ResizeObserver(measureHeader).observe(header);
new ResizeObserver(measureHeader).observe(workspaceBar);
window.addEventListener("resize", measureHeader);
syncFollowers();
measureHeader();
document.body.dataset.wideReady = "true";
