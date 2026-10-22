// Flight UI of a bombing page (bombing app shared FE since 2026-10-22, from the Offset page): the aircraft numbers
// and their colours, the shown-aircraft set every output view of the page shares (handoff 2026-10-06 §5), and the
// Show aircraft row. Display only: the shown set is never a solve input. The page says which aircraft can be shown
// (its Flight size, which aircraft calculate) and what a change redraws. Styles: flight-ui-v0.1.css.

export const FLIGHT_UI_V0_1 = Object.freeze({ id: "bombing-flight-ui-v0.1", version: "0.1.0" });

export const AIRCRAFT_NUMBERS = Object.freeze([1, 2, 3, 4]);
// Each aircraft's colour in the page UI (output block rule, Show aircraft underline; flight-ui-v0.1.css).
export const AIRCRAFT_COLORS = Object.freeze({ 1: "#4c5966", 2: "#8a3ab9", 3: "#2f9e6e", 4: "#b5651d" });

// The shown aircraft (default #1 only; several can be on together). available() lists the numbers that can be shown
// now. sync() tells the listeners when the shown list changed (only then: every redraw syncs, 2026-10-19) and sets
// every `[data-top-view-aircraft-button]`: hidden when not available, pressed and "active" when shown.
export function createShownAircraft({ available, initial = [1], root = document }) {
  const shown = new Set(initial);
  const listeners = new Set();
  let notifiedKey = null;
  return {
    has: (number) => shown.has(number),
    // The shown aircraft that can be shown now, in number order of available().
    visible: () => available().filter((number) => shown.has(number)),
    // Every number on, as saved.
    saved: () => [...shown].sort(),
    replace(numbers) {
      shown.clear();
      numbers.forEach((number) => shown.add(number));
    },
    toggle(number) {
      if (shown.has(number)) shown.delete(number);
      else shown.add(number);
    },
    // Flight Size shrink: drop the numbers it removed; a selection cut to nothing returns to #1.
    prune(size) {
      const before = shown.size;
      [...shown].forEach((number) => { if (number > size) shown.delete(number); });
      if (before && !shown.size) shown.add(1);
    },
    onChange(listener) { listeners.add(listener); },
    sync() {
      const numbers = available();
      const visible = numbers.filter((number) => shown.has(number));
      const key = visible.join(",");
      if (key !== notifiedKey) {
        notifiedKey = key;
        listeners.forEach((listener) => listener(visible));
      }
      root.querySelectorAll("[data-top-view-aircraft-button]").forEach((button) => {
        const number = Number(button.dataset.topViewAircraftButton);
        const can = numbers.includes(number);
        const on = can && shown.has(number);
        button.hidden = !can;
        button.setAttribute("aria-pressed", String(on));
        button.classList.toggle("active", on);
      });
    },
  };
}

// A click on any `[data-top-view-aircraft-button]` (enabled) toggles that number through onToggle.
export function installShownAircraftClicks(onToggle, root = document) {
  root.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-top-view-aircraft-button]");
    if (button && !button.disabled) onToggle(Number(button.dataset.topViewAircraftButton));
  });
}

// One "Show aircraft" row (#1–#4, unpressed until the next sync): every row edits the one shown set.
export function showAircraftRow() {
  const row = document.createElement("div");
  row.className = "diagram-action-row top-view-aircraft wide-show-aircraft";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "Shown aircraft");
  const label = document.createElement("span");
  label.className = "diagram-control-label";
  label.textContent = "Show aircraft";
  row.append(label);
  for (const number of AIRCRAFT_NUMBERS) {
    const button = document.createElement("button");
    button.className = "capture-button view-toggle";
    button.textContent = "#" + number;
    button.type = "button";
    button.setAttribute("data-top-view-aircraft-button", String(number));
    button.setAttribute("aria-pressed", "false");
    row.append(button);
  }
  return row;
}
