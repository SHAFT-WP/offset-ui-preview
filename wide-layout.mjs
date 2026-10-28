// Presentation layer of index.html (the default Offset entry). Calculations, inputs and persistence
// stay in the shared Offset controller; the PC Wide workspace (bombing app shared FE, 2026-10-22) only
// places its live nodes (index UI handoff 2026-10-06): left = Edit aircraft (one) + input tabs, centre =
// Offset Top View / BDP / SEM & Rejoin, right = Result / Z-Diagram / DED, every output tab showing the one
// shared set of shown aircraft. This module gives the Offset tabs and what each draws.
// SEM & Rejoin (2026-10-13): its own module, mounted once into the S&R input tab and the centre
// SEM & Rejoin panel; it reaches the Offset controller only through offsetIndexUi.
import { offsetIndexUi } from "./controller-v0.1.mjs?v=f7583d6c5d51";
import { mountSemRejoin } from "./sem-rejoin-controller-v0.1.mjs?v=f7583d6c5d51";
import { mountWideWorkspace } from "./shared/wide-workspace-v0.1.mjs?v=0.1.1";

const app = document.getElementById("offset-calculator");
const followers = document.getElementById("flight-followers");
let semRejoin = null;

// Tab order (owner 2026-10-07): BDP, Offset, Formation (#2-#4), Save/Load (renamed from Save 2026-10-11). Offset stays the tab shown on
// first entry. #1 has no Formation tab (owner 2026-10-07): its Reference Point (VRP / VIP, IP) sits on top
// of the Offset tab, as on the standard page. S&R (2026-10-13) follows Offset, for every aircraft.
const INPUT_TABS = [["bdp", "BDP"], ["offset", "Offset"], ["sr", "S&R"], ["reference", "Formation", { hidden: (editAircraft) => editAircraft === 1 }], ["save", "Save/Load"]];
// An input tab brings its centre view with it (handoff 2026-10-13 §3): S&R → SEM & Rejoin, BDP → BDP,
// Offset → Offset Top View. A centre tab changes the centre only (owner 2026-10-22). Formation, Save/Load
// and the right-hand tabs keep the other panes.
const INPUT_OF_CENTER = Object.freeze({ topview: "offset", bdp: "bdp", sem: "sr" });
const CENTER_OF_INPUT = Object.freeze({ offset: "topview", bdp: "bdp", sr: "sem" });

const workspace = mountWideWorkspace({
  app,
  followers,
  flightSize: document.getElementById("flight-size"),
  eyebrow: "FLIGHT SIM TOOLS  /  OFFSET",
  standardHref: "./index-standard.html",
  inputTabs: INPUT_TABS,
  // The S&R tab: one section showing the edited aircraft (filled by the S&R module).
  inputPanes: ["sr"],
  // The tab a section belongs to: Formation shares the Formation tab; #1's Reference Point is in Offset.
  sectionTab(section, aircraft) {
    if (section.dataset.tab === "formation") return "reference";
    return section.dataset.tab === "reference" && aircraft === 1 ? "offset" : section.dataset.tab;
  },
  shownInputKey: (tab, editAircraft) => (tab === "reference" && editAircraft === 1 ? "offset" : tab),
  // Centre: Offset Top View / BDP (Top View + Profile per shown aircraft) / SEM & Rejoin (2026-10-13 handoff: the
  // S&R module's view, table and evaluation).
  centerTabs: [
    ["topview", "Offset Top View", { section: document.getElementById("offset-top-view")?.closest("section") }],
    ["bdp", "BDP", { title: "BDP", blocks: true }],
    ["sem", "SEM & Rejoin", { title: "SEM & Rejoin", host: true }],
  ],
  centerOfInput: CENTER_OF_INPUT,
  inputOfCenter: INPUT_OF_CENTER,
  reviewTabs: [["result", "Result"], ["z", "Z-Diagram"], ["ded", "DED"]],
  statePill: (number) => document.getElementById(number === 1 ? "state-pill" : "flight-state-pill-" + number),
  statusMessage: (number) => document.getElementById(number === 1 ? "constraint-message" : "flight-status-" + number),
  statusSelector: "#state-pill, [id^='flight-state-pill-'], #constraint-message, [id^='flight-status-']",
  ui: offsetIndexUi,
  // Shared BDP tab (owner 2026-10-25): Full BDP stays in the tab head, before Tab Default (as on the BOX page).
  fullBdpOnEditLine: false,
  onShown(visible, centerTab) {
    if (centerTab === "bdp") offsetIndexUi.showBdpViews(visible);
    semRejoin.setShownAircraft(visible);
  },
  onCenterTab(key, previous, shown) {
    // BDP views are drawn only while the centre BDP tab shows them (latest result on re-entry).
    if (key === "bdp" || previous === "bdp") offsetIndexUi.showBdpViews(key === "bdp" ? shown : []);
    // S&R is mounted once; entering shows its latest result (one request if the Offset changed).
    if (key === "sem") semRejoin.activate();
    else semRejoin.deactivate();
  },
  onEditAircraft: (number) => semRejoin.setEditAircraft(number),
});

semRejoin = mountSemRejoin({
  offsetUi: offsetIndexUi,
  inputSection: workspace.inputPane("sr"),
  centerHost: workspace.centerHost("sem"),
  getEditAircraft: () => workspace.editAircraft(),
  requestEditAircraft: (number) => workspace.selectEditAircraft(number),
});
offsetIndexUi.installSectionDisclosure();

// First entry (§2): input Offset, centre Offset Top View, right Result, edit #1, shown #1. A work
// save brings back its edited aircraft and shown set (2026-10-12, user).
workspace.start({ center: "topview", review: "result" });
