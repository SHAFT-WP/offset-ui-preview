// Run-In Heading of the pattern pages (BOX, Wheel, Wheel-BOX; owner 2026-11-12: "dtc 로드해서 run-in heading 정하는
// 것은 box, wheel에도" — answer: a Run-In field and its line on the Top View; the pattern is unchanged, so the Run-In
// need not be square to the Attack Heading). Two optional fields of the pattern tab: Run-In Heading (MAG, IP → Target)
// and IP Range (NM). They are page state only: the BE does not read them; the Top View draws them (attack-frame
// overlay). Blank Run-In = no line. Saved with the page's Save, cleared by its Tab Default and Load Default.
export const PATTERN_RUN_IN_V0_1 = Object.freeze({ id: "pattern-run-in-v0.1", version: "0.1.0" });

export function patternRunInFieldsMarkup() {
  return `<label class="field"><span>Run-In Heading (deg)</span><input data-run-in="headingDeg" type="text" inputmode="decimal" placeholder="none" aria-label="Run-In Heading, IP to Target"><span class="unit">MAG · IP → Target · Top View only</span></label>
<label class="field"><span>IP Range (NM)</span><input data-run-in="ipRangeNm" type="text" inputmode="decimal" placeholder="edge" aria-label="IP Range from the Target"><span class="unit">IP → Target · blank: to the edge</span></label>`;
}

const parseNumber = (text) => {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : NaN;
};
const headingText = (value) => (Number.isFinite(value) ? String(((Math.round(value) % 360) + 360) % 360).padStart(3, "0") : "");
const rangeText = (value) => (Number.isFinite(value) ? value.toFixed(2) : "");

// root: the page element holding the [data-run-in] fields (a container with patternRunInFieldsMarkup());
// onChange(value): after an accepted change. A wrong entry keeps the last value and marks the field.
export function createPatternRunIn({ root, onChange = () => {} }) {
  let state = { headingDeg: null, ipRangeNm: null };
  const field = (key) => root?.querySelector(`[data-run-in="${key}"]`);
  const show = () => {
    const heading = field("headingDeg");
    const range = field("ipRangeNm");
    if (heading && heading !== globalThis.document?.activeElement) heading.value = headingText(state.headingDeg);
    if (range && range !== globalThis.document?.activeElement) range.value = rangeText(state.ipRangeNm);
  };
  const value = () => (Number.isFinite(state.headingDeg) ? { headingDeg: state.headingDeg, ipRangeNm: Number.isFinite(state.ipRangeNm) ? state.ipRangeNm : null } : null);
  const set = (next = {}, { notify = true } = {}) => {
    const heading = Number(next.headingDeg);
    const range = Number(next.ipRangeNm);
    state = {
      headingDeg: next.headingDeg === null || next.headingDeg === undefined || next.headingDeg === "" || !Number.isFinite(heading) ? null : ((heading % 360) + 360) % 360,
      ipRangeNm: next.ipRangeNm === null || next.ipRangeNm === undefined || next.ipRangeNm === "" || !Number.isFinite(range) || range <= 0 ? null : range,
    };
    show();
    if (notify) onChange(value());
  };
  root?.addEventListener("change", (event) => {
    const key = event.target?.dataset?.runIn;
    if (!key) return;
    const parsed = parseNumber(event.target.value);
    const bad = Number.isNaN(parsed) || (key === "ipRangeNm" && parsed !== null && parsed <= 0) || (key === "headingDeg" && parsed !== null && (parsed < 0 || parsed > 360));
    event.target.classList.toggle("invalid-input", bad);
    if (bad) return;
    set({ ...state, [key]: parsed });
  });
  root?.addEventListener("focusout", (event) => { if (event.target?.dataset?.runIn) show(); });
  return Object.freeze({
    value,
    set,
    clear: ({ notify = true } = {}) => set({ headingDeg: null, ipRangeNm: null }, { notify }),
    capture: () => ({ ...state }),
    restore: (record) => set(record && typeof record === "object" ? record : {}, { notify: false }),
  });
}
