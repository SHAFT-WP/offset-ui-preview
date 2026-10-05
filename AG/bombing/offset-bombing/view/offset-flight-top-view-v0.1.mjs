import {
  createOffsetTopViewFrame,
  drawOffsetTopViewLayer,
  finishOffsetTopViewFrame,
  offsetTopViewTitle,
  offsetTopViewWorldPoints,
} from "./offset-top-view-v0.1.mjs?v=0.1.5";
export { offsetFlightTopViewLegend } from "./offset-view-style-v0.1.mjs";

// Offset Flight Top View — aircraft #n drawn in one frame with its element lead (#1, or #3 for #4).
// Formerly composed in the Offset FE controller (renderFollowerTopView); now BE-owned view logic
// (common/diagram/SPEC.md V1). Both layers share one fit over both aircraft and one rotation (the
// lead's Run-In in IP Bottom: followers fly parallel Run-In lines), so their Target markers coincide.
// The lead layer is drawn as in its own Top View; the follower layer uses the follower palette and
// "#n"-prefixed labels. Every path of both layers is reserved before any label is placed, and the
// follower's labels avoid the lead's, so neither layer's labels cover the other's paths.

export const OFFSET_FLIGHT_TOP_VIEW_V0_1 = Object.freeze({
  id: "offset-flight-top-view-v0.1",
  // 0.1.1 (2026-10-02): options.timeSec passes the Time dial to both layers (one clock: seconds after IP).
  // 0.1.2 (2026-10-03): imports Top View 0.1.2 with the controller's cache token (one module instance).
  // 0.1.3 (2026-10-05): Top View 0.1.4 token (same instance as the controller's); re-exports
  // offsetFlightTopViewLegend for the #n Top View legend.
  // 0.1.4 (2026-10-05, user): options.companions — other aircraft drawn between the lead and this
  // aircraft as paths and stations only, no labels or values (Offset #3 Top View draws #2).
  version: "0.1.4",
  layers: Object.freeze(["offset-plot-lead-<n>", "offset-plot-companion-<k>", "offset-plot-<n>"]),
});

// leaderResult: the element lead's solved Offset result; result: this aircraft's (null when its own
// solve failed — the lead's profile then stays visible instead of a blank frame).
export function renderOffsetFlightTopView(svg, leaderResult, result, options = {}) {
  const number = Number(options.aircraftNumber);
  const title = offsetTopViewTitle({ aircraftNumber: number });
  const companions = (Array.isArray(options.companions) ? options.companions : []).filter((companion) => companion?.result);
  const worldPoints = [
    ...offsetTopViewWorldPoints(leaderResult),
    ...companions.flatMap((companion) => offsetTopViewWorldPoints(companion.result)),
    ...(result ? offsetTopViewWorldPoints(result) : []),
  ];
  const frame = createOffsetTopViewFrame(svg, worldPoints, { ...options, title });
  const common = { advanced: options.advanced, upHeadingDeg: options.upHeadingDeg, timeSec: options.timeSec };
  const lead = drawOffsetTopViewLayer(frame, leaderResult, { ...common, groupId: `offset-plot-lead-${number}`, crowded: Boolean(result) });
  // Companions: paths and stations only (placeLabels is not called); their paths stay label obstacles.
  companions.forEach((companion) => {
    const layer = drawOffsetTopViewLayer(frame, companion.result, {
      ...common, groupId: `offset-plot-companion-${companion.number}`, palette: "companion", aircraftTag: `#${companion.number}`,
    });
    layer.group.setAttribute("data-companion-aircraft", String(companion.number));
  });
  const own = result
    ? drawOffsetTopViewLayer(frame, result, {
        ...common,
        groupId: `offset-plot-${number}`,
        palette: "follower",
        aircraftTag: `#${number}`,
        leadAttackHeadingDeg: leaderResult.geometry.attackHeadingDeg,
        ipLimit: result.ipLimit?.violated ? result.ipLimit : null,
      })
    : null;
  lead.placeLabels();
  own?.placeLabels();
  finishOffsetTopViewFrame(frame, { scope: `flight-${number}` });
  if (Number.isFinite(Number(options.leadNumber))) svg.dataset.leadAircraft = String(options.leadNumber);
  return { title, canvas: { width: frame.width, height: frame.height }, fontScale: frame.fontScale, ownLayer: Boolean(own) };
}
