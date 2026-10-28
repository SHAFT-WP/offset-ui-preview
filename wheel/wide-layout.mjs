// Presentation layer of the Wheel page (index.html): the PC Wide workspace (bombing app shared FE) places the Wheel
// controller's live nodes. Left = Edit aircraft + input tabs, centre = Wheel Top View / BDP, right = Result / Z-Diagram /
// DED, every output tab showing the one shared set of shown aircraft (owner 2026-10-27: the Wheel as BOX's page).
import { wheelIndexUi } from "./controller-v0.1.mjs?v=f7583d6c5d51";
import { mountWideWorkspace } from "../shared/wide-workspace-v0.1.mjs?v=0.1.1";

const app = document.getElementById("wheel-calculator");

// Tabs: BDP, Wheel, Wheel Slot (#2–#4: each follower's place in the attack order, hidden for #1 as Formation is on
// Offset), Save/Load. The Wheel has no Spacer Turn: its spacing is the attack interval.
const INPUT_TABS = [["bdp", "BDP"], ["wheel", "Wheel"], ["slot", "Wheel Slot", { hidden: (editAircraft) => editAircraft === 1 }], ["save", "Save/Load"]];
const CENTER_OF_INPUT = Object.freeze({ wheel: "topview", bdp: "bdp", slot: "topview" });
const INPUT_OF_CENTER = Object.freeze({ topview: "wheel", bdp: "bdp" });

const workspace = mountWideWorkspace({
  app,
  followers: document.getElementById("flight-followers"),
  flightSize: document.getElementById("flight-size"),
  eyebrow: "FLIGHT SIM TOOLS  /  WHEEL",
  standardHref: "../index.html",
  inputTabs: INPUT_TABS,
  centerTabs: [
    ["topview", "Wheel Top View", { section: document.getElementById("wheel-top-view")?.closest("section") }],
    ["bdp", "BDP", { title: "BDP", blocks: true }],
  ],
  centerOfInput: CENTER_OF_INPUT,
  inputOfCenter: INPUT_OF_CENTER,
  reviewTabs: [["result", "Result"], ["z", "Z-Diagram"], ["ded", "DED"]],
  statePill: (number) => document.getElementById(number === 1 ? "state-pill" : "flight-state-pill-" + number),
  statusMessage: (number) => document.getElementById(number === 1 ? "constraint-message" : "flight-status-" + number),
  statusSelector: "#state-pill, [id^='flight-state-pill-'], #constraint-message, [id^='flight-status-']",
  ui: wheelIndexUi,
  // Shared BDP tab: Full BDP stays in the tab head, before Tab Default (as BOX and Wheel-BOX).
  fullBdpOnEditLine: false,
  onShown(visible, centerTab) {
    if (centerTab === "bdp") wheelIndexUi.showBdpViews(visible);
  },
  onCenterTab(key, previous, shown) {
    // BDP views are drawn only while the centre BDP tab shows them (latest result on re-entry).
    if (key === "bdp" || previous === "bdp") wheelIndexUi.showBdpViews(key === "bdp" ? shown : []);
  },
});
wheelIndexUi.installSectionDisclosure();

// First entry: input Wheel, centre Wheel Top View, right Result, edit #1, shown #1.
workspace.start({ center: "topview", review: "result" });
