// Formation position input row — repository Common UI (see common/ui/SPEC.md).
//
// One line per wingman: the Bearing field carries its Left/Right side as a compact select in front
// of the number, and the Range field sits beside it. The side select shows the full words (Left /
// Right) only while it is being chosen and the short form (L / R) otherwise. Bearing is measured
// from the reference aircraft's tail: 0 = directly behind, 90 = abeam, 180 = directly ahead.
//
// Presentation only: the consumer owns the bound keys, persistence and the formation geometry
// (for Offset, AG/bombing/offset-bombing/offset-formation-v0.1.mjs computeFormationOffsetVector).
// Reusable by any Flight tab (Offset, BOX, Wheel, Wheel-BOX).

export const FORMATION_POSITION_V0_1 = Object.freeze({
  id: "formation-position-v0.1",
  version: "0.1.0",
  bearingReference: "tail",
});

export const FORMATION_SIDE_LABELS = Object.freeze({
  LEFT: Object.freeze({ short: "L", long: "Left" }),
  RIGHT: Object.freeze({ short: "R", long: "Right" }),
});

const DEFAULT_KEYS = Object.freeze({ side: "side", bearing: "bearingDeg", range: "rangeNm" });

function escapeAttribute(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

// `attribute` is the consumer's binding attribute (e.g. data-flight-field or data-key); `keys` maps
// the three roles to the consumer's field names; `referenceLabel` names the reference aircraft.
export function formationPositionMarkup({ attribute = "data-key", keys = {}, referenceLabel = "lead" } = {}) {
  const names = { ...DEFAULT_KEYS, ...keys };
  const bind = (key) => `${escapeAttribute(attribute)}="${escapeAttribute(key)}"`;
  const reference = escapeAttribute(referenceLabel);
  const options = Object.entries(FORMATION_SIDE_LABELS)
    .map(([value, label]) => `<option value="${value}" data-short="${label.short}" data-long="${label.long}">${label.short}</option>`)
    .join("");
  return `<div class="formation-position" data-formation-position>`
    + `<label class="field formation-bearing"><span>Bearing (°)</span><span class="formation-bearing-control">`
    + `<select ${bind(names.side)} data-formation-side aria-label="Side of ${reference}">${options}</select>`
    + `<input ${bind(names.bearing)} type="text" inputmode="decimal" aria-label="Bearing from ${reference} tail">`
    + `</span><span class="unit">From ${reference} tail · 0° behind · 90° abeam</span></label>`
    + `<label class="field formation-range"><span>Range (NM)</span><input ${bind(names.range)} type="text" inputmode="decimal"><span class="unit">From ${reference}</span></label>`
    + `</div>`;
}

function setSideLabels(select, form) {
  for (const option of select.options) {
    const text = option.dataset[form];
    if (text && option.textContent !== text) option.textContent = text;
  }
}

// Full words while the side is being chosen (focus / pointer down), short L / R once chosen.
export function installFormationSideSelects(root) {
  const selects = root?.querySelectorAll?.("select[data-formation-side]") ?? [];
  selects.forEach((select) => {
    if (select.dataset.formationSideInstalled === "true") return;
    select.dataset.formationSideInstalled = "true";
    const expand = () => setSideLabels(select, "long");
    const collapse = () => setSideLabels(select, "short");
    select.addEventListener("pointerdown", expand);
    select.addEventListener("focus", expand);
    select.addEventListener("change", collapse);
    select.addEventListener("blur", collapse);
    collapse();
  });
  return selects.length;
}
