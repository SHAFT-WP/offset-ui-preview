// Presentation layer of the Wheel page (index.html): the PC Wide workspace (bombing app shared FE) places the Wheel
// controller's live nodes. Left = Edit aircraft + input tabs, centre = Wheel Top View / BDP / Spacer Turn, right =
// Result / Z-Diagram / DED, every output tab showing the one shared set of shown aircraft (owner 2026-10-25: a page
// like BOX's).
import { wheelIndexUi } from "./controller-v0.1.mjs?v=dc368cfaafc0";
import { mountWideWorkspace } from "../shared/wide-workspace-v0.1.mjs?v=0.1.1";

const app = document.getElementById("wheel-calculator");

// Tabs (owner 2026-10-25, BOX's): BDP, Wheel, Spacer Turn (the Wheel S&R slot, blank for now; the input tab reads
// "Spacer.T"), Formation (#2–#4: each follower's position, hidden for #1 as on Offset), Save/Load.
const INPUT_TABS = [["bdp", "BDP"], ["wheel", "Wheel"], ["spacer", "Spacer.T"], ["formation", "Formation", { hidden: (editAircraft) => editAircraft === 1 }], ["save", "Save/Load"]];
const CENTER_OF_INPUT = Object.freeze({ wheel: "topview", bdp: "bdp", spacer: "spacer" });
const INPUT_OF_CENTER = Object.freeze({ topview: "wheel", bdp: "bdp", spacer: "spacer" });

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
    ["spacer", "Spacer Turn", { title: "Spacer Turn", host: true }],
  ],
  centerOfInput: CENTER_OF_INPUT,
  inputOfCenter: INPUT_OF_CENTER,
  reviewTabs: [["result", "Result"], ["z", "Z-Diagram"], ["ded", "DED"]],
  statePill: (number) => document.getElementById(number === 1 ? "state-pill" : "flight-state-pill-" + number),
  statusMessage: (number) => document.getElementById(number === 1 ? "constraint-message" : "flight-status-" + number),
  statusSelector: "#state-pill, [id^='flight-state-pill-'], #constraint-message, [id^='flight-status-']",
  ui: wheelIndexUi,
  // Shared BDP tab (owner 2026-10-25): Full BDP stays in the tab head, before Tab Default.
  fullBdpOnEditLine: false,
  onShown(visible, centerTab) {
    if (centerTab === "bdp") wheelIndexUi.showBdpViews(visible);
  },
  onCenterTab(key, previous, shown) {
    // BDP views are drawn only while the centre BDP tab shows them (latest result on re-entry).
    if (key === "bdp" || previous === "bdp") wheelIndexUi.showBdpViews(key === "bdp" ? shown : []);
  },
});

const spacerHost = workspace.centerHost("spacer");
if (spacerHost) {
  const note = document.createElement("p");
  note.className = "flight-draft-note";
  note.textContent = "Spacer Turn is the Wheel slot of S&R. Its content comes in a later step.";
  spacerHost.append(note);
}
wheelIndexUi.installSectionDisclosure();

// First entry: input Wheel, centre Wheel Top View, right Result, edit #1, shown #1.
workspace.start({ center: "topview", review: "result" });
