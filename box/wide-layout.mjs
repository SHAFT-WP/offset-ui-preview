// Presentation layer of the BOX page (index.html): the PC Wide workspace (bombing app shared FE) places the BOX
// controller's live nodes. Left = Edit aircraft + input tabs, centre = BOX Top View / BDP / Spacer Turn, right =
// Result / Z-Diagram / DED, every output tab showing the one shared set of shown aircraft (owner 2026-10-23 / 25: the
// Offset FE layout).
import { boxIndexUi } from "./controller-v0.1.mjs?v=d3f48cf799ac";
import { mountWideWorkspace } from "../shared/wide-workspace-v0.1.mjs?v=0.1.1";

const app = document.getElementById("box-calculator");

// Tabs (owner 2026-10-23 / 25): BDP, BOX, Spacer Turn (the BOX S&R slot, blank for now), Formation (#2–#4: each
// follower's position, hidden for #1 as on Offset), Save/Load.
const INPUT_TABS = [["bdp", "BDP"], ["box", "BOX"], ["spacer", "Spacer Turn"], ["formation", "Formation", { hidden: (editAircraft) => editAircraft === 1 }], ["save", "Save/Load"]];
const CENTER_OF_INPUT = Object.freeze({ box: "topview", bdp: "bdp", spacer: "spacer" });
const INPUT_OF_CENTER = Object.freeze({ topview: "box", bdp: "bdp", spacer: "spacer" });

const workspace = mountWideWorkspace({
  app,
  followers: document.getElementById("flight-followers"),
  flightSize: document.getElementById("flight-size"),
  eyebrow: "FLIGHT SIM TOOLS  /  BOX",
  standardHref: "../index.html",
  inputTabs: INPUT_TABS,
  centerTabs: [
    ["topview", "BOX Top View", { section: document.getElementById("box-top-view")?.closest("section") }],
    ["bdp", "BDP", { title: "BDP", blocks: true }],
    ["spacer", "Spacer Turn", { title: "Spacer Turn", host: true }],
  ],
  centerOfInput: CENTER_OF_INPUT,
  inputOfCenter: INPUT_OF_CENTER,
  reviewTabs: [["result", "Result"], ["z", "Z-Diagram"], ["ded", "DED"]],
  statePill: (number) => document.getElementById(number === 1 ? "state-pill" : "flight-state-pill-" + number),
  statusMessage: (number) => document.getElementById(number === 1 ? "constraint-message" : "flight-status-" + number),
  statusSelector: "#state-pill, [id^='flight-state-pill-'], #constraint-message, [id^='flight-status-']",
  ui: boxIndexUi,
  // Shared BDP tab (owner 2026-10-25): Full BDP stays in the tab head, before Tab Default.
  fullBdpOnEditLine: false,
  onShown(visible, centerTab) {
    if (centerTab === "bdp") boxIndexUi.showBdpViews(visible);
  },
  onCenterTab(key, previous, shown) {
    // BDP views are drawn only while the centre BDP tab shows them (latest result on re-entry).
    if (key === "bdp" || previous === "bdp") boxIndexUi.showBdpViews(key === "bdp" ? shown : []);
  },
});

const spacerHost = workspace.centerHost("spacer");
if (spacerHost) {
  const note = document.createElement("p");
  note.className = "flight-draft-note";
  note.textContent = "Spacer Turn is the BOX slot of S&R. Its content comes in a later step.";
  spacerHost.append(note);
}
boxIndexUi.installSectionDisclosure();

// First entry: input BOX, centre BOX Top View, right Result, edit #1, shown #1.
workspace.start({ center: "topview", review: "result" });
