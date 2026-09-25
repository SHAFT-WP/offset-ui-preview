import { SVG_DIAGRAM_STYLE_V0_1, svgNode } from "./svg-primitives-v0.1.mjs";

export const SVG_SMART_LABEL_V0_1 = Object.freeze({
  id: "svg-smart-label-v0.1",
  version: "0.1.2",
  purpose: "Generic collision-aware SVG labels with optional leaders and 0.5 s long-press drag behavior",
});

function boxOverlap(a, b, pad = 0) {
  return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x || a.y + a.h + pad < b.y || b.y + b.h + pad < a.y);
}

function pointInBox(point, box, pad = 0) {
  return point.x >= box.x - pad && point.x <= box.x + box.w + pad && point.y >= box.y - pad && point.y <= box.y + box.h + pad;
}

function segmentIntersectsBox(a, b, box, pad = 0) {
  const expanded = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
  if (pointInBox(a, expanded) || pointInBox(b, expanded)) return true;
  const edges = [
    [{ x: expanded.x, y: expanded.y }, { x: expanded.x + expanded.w, y: expanded.y }],
    [{ x: expanded.x + expanded.w, y: expanded.y }, { x: expanded.x + expanded.w, y: expanded.y + expanded.h }],
    [{ x: expanded.x + expanded.w, y: expanded.y + expanded.h }, { x: expanded.x, y: expanded.y + expanded.h }],
    [{ x: expanded.x, y: expanded.y + expanded.h }, { x: expanded.x, y: expanded.y }],
  ];
  const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const intersects = (p1, p2, q1, q2) => {
    const a1 = orient(p1, p2, q1);
    const a2 = orient(p1, p2, q2);
    const b1 = orient(q1, q2, p1);
    const b2 = orient(q1, q2, p2);
    return (a1 === 0 || a2 === 0 || Math.sign(a1) !== Math.sign(a2)) &&
      (b1 === 0 || b2 === 0 || Math.sign(b1) !== Math.sign(b2));
  };
  return edges.some(([e1, e2]) => intersects(a, b, e1, e2));
}

function movableGroups(svg, key = null) {
  return [...svg.querySelectorAll('[data-movable-label="true"]')].filter((element) => key === null || element.dataset?.labelKey === key);
}

function leaderLines(svg, key = null) {
  return [...svg.querySelectorAll("[data-label-leader-key]")].filter((element) => key === null || element.dataset?.labelLeaderKey === key);
}

function applyOffset(svg, key, offset) {
  movableGroups(svg, key).forEach((group) => {
    group.setAttribute("transform", `translate(${offset.x} ${offset.y})`);
    group.dataset.labelDx = String(offset.x);
    group.dataset.labelDy = String(offset.y);
  });
  leaderLines(svg, key).forEach((line) => {
    const baseX = Number(line.dataset.labelBaseX1);
    const baseY = Number(line.dataset.labelBaseY1);
    if (Number.isFinite(baseX)) line.setAttribute("x1", String(baseX + offset.x));
    if (Number.isFinite(baseY)) line.setAttribute("y1", String(baseY + offset.y));
  });
}

function clearRenderedOffsets(svg) {
  movableGroups(svg).forEach((group) => {
    group.removeAttribute("transform");
    delete group.dataset.labelDx;
    delete group.dataset.labelDy;
  });
  leaderLines(svg).forEach((line) => {
    const baseX = Number(line.dataset.labelBaseX1);
    const baseY = Number(line.dataset.labelBaseY1);
    if (Number.isFinite(baseX)) line.setAttribute("x1", String(baseX));
    if (Number.isFinite(baseY)) line.setAttribute("y1", String(baseY));
  });
}

export function installSmartLabelDrag(svg, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  const longPressMs = Number.isFinite(options.longPressMs) ? Math.max(0, options.longPressMs) : SVG_DIAGRAM_STYLE_V0_1.label.longPressMs;
  const cancelDistancePx = Number.isFinite(options.cancelDistancePx) ? Math.max(0, options.cancelDistancePx) : SVG_DIAGRAM_STYLE_V0_1.label.dragCancelPx;
  const positions = new Map();
  let gesture = null;

  const toSvgPoint = (event) => {
    const ctm = svg.getScreenCTM?.();
    if (ctm && typeof ctm.inverse === "function" && typeof svg.createSVGPoint === "function") {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      return point.matrixTransform(ctm.inverse());
    }
    return { x: event.clientX, y: event.clientY };
  };

  const clearGesture = () => {
    if (!gesture) return;
    if (gesture.timer !== null) globalThis.clearTimeout?.(gesture.timer);
    gesture.group?.classList?.remove("label-drag-active");
    try { gesture.group?.releasePointerCapture?.(gesture.pointerId); } catch (_) {}
    gesture = null;
  };

  const onPointerDown = (event) => {
    const group = event.target?.closest?.('[data-movable-label="true"]');
    if (!group || !svg.contains(group)) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const key = group.dataset?.labelKey;
    if (!key) return;
    event.stopPropagation();
    const start = toSvgPoint(event);
    const base = positions.get(key) ?? { x: 0, y: 0 };
    gesture = {
      pointerId: event.pointerId,
      key,
      group,
      start,
      startClient: { x: event.clientX, y: event.clientY },
      base,
      active: false,
      timer: globalThis.setTimeout?.(() => {
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        gesture.active = true;
        gesture.group.classList.add("label-drag-active");
        try { gesture.group.setPointerCapture?.(gesture.pointerId); } catch (_) {}
      }, longPressMs) ?? null,
    };
  };

  const onPointerMove = (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.active) {
      const travel = Math.hypot(event.clientX - gesture.startClient.x, event.clientY - gesture.startClient.y);
      if (travel > cancelDistancePx) clearGesture();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const current = toSvgPoint(event);
    const offset = {
      x: gesture.base.x + current.x - gesture.start.x,
      y: gesture.base.y + current.y - gesture.start.y,
    };
    positions.set(gesture.key, offset);
    applyOffset(svg, gesture.key, offset);
  };

  const onPointerEnd = (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.active) {
      event.preventDefault();
      event.stopPropagation();
    }
    clearGesture();
  };

  svg.addEventListener("pointerdown", onPointerDown, true);
  svg.addEventListener("pointermove", onPointerMove, true);
  svg.addEventListener("pointerup", onPointerEnd, true);
  svg.addEventListener("pointercancel", onPointerEnd, true);

  return {
    applyStoredPositions() {
      positions.forEach((offset, key) => applyOffset(svg, key, offset));
    },
    reset() {
      positions.clear();
      clearRenderedOffsets(svg);
    },
    destroy() {
      clearGesture();
      svg.removeEventListener("pointerdown", onPointerDown, true);
      svg.removeEventListener("pointermove", onPointerMove, true);
      svg.removeEventListener("pointerup", onPointerEnd, true);
      svg.removeEventListener("pointercancel", onPointerEnd, true);
    },
    positions,
  };
}

export function createSmartLabelLayout(root, options = {}) {
  if (!root) throw new TypeError("root is required");
  const width = options.width ?? 1180;
  const height = options.height ?? 720;
  const edgePad = options.edgePad ?? SVG_DIAGRAM_STYLE_V0_1.label.edgePadPx;
  const labelPad = options.labelPad ?? SVG_DIAGRAM_STYLE_V0_1.label.labelPadPx;
  const pathPad = options.pathPad ?? SVG_DIAGRAM_STYLE_V0_1.label.pathPadPx;
  const labels = [];
  const obstacleRects = [];
  const obstacleSegments = [];
  let serial = 0;

  function reserveRect(rect, pad = 0) {
    obstacleRects.push({ x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 });
  }

  function reservePoint(point, radius = 8) {
    reserveRect({ x: point.x - radius, y: point.y - radius, w: radius * 2, h: radius * 2 });
  }

  function reserveSegment(from, to, pad = pathPad) {
    obstacleSegments.push({ from: { ...from }, to: { ...to }, pad });
  }

  function candidateBox(anchorPoint, text, candidate, fontSize) {
    const lines = String(text).split("\n");
    const approxW = Math.max(34, ...lines.map((line) => line.length * fontSize * 0.58));
    const approxH = fontSize * (1.45 + (lines.length - 1) * 1.2);
    const x = anchorPoint.x + candidate.dx;
    const y = anchorPoint.y + candidate.dy;
    const left = candidate.anchor === "end" ? x - approxW : candidate.anchor === "middle" ? x - approxW / 2 : x;
    return { x: left, y: y - approxH, w: approxW, h: approxH, textX: x, textY: y };
  }

  function collides(box) {
    if (box.x < edgePad || box.y < edgePad || box.x + box.w > width - edgePad || box.y + box.h > height - edgePad) return true;
    if (labels.some((other) => boxOverlap(box, other, labelPad))) return true;
    if (obstacleRects.some((other) => boxOverlap(box, other, 2))) return true;
    if (obstacleSegments.some((segment) => segmentIntersectsBox(segment.from, segment.to, box, segment.pad))) return true;
    return false;
  }

  function append(point, text, labelOptions = {}) {
    const fontSize = labelOptions.fontSize ?? SVG_DIAGRAM_STYLE_V0_1.font.smartLabelPx;
    const candidates = labelOptions.candidates ?? [
      { dx: 18, dy: -18, anchor: "start" },
      { dx: 18, dy: 32, anchor: "start" },
      { dx: -18, dy: -18, anchor: "end" },
      { dx: -18, dy: 32, anchor: "end" },
      { dx: 0, dy: -38, anchor: "middle" },
      { dx: 0, dy: 48, anchor: "middle" },
      { dx: 38, dy: 7, anchor: "start" },
      { dx: -38, dy: 7, anchor: "end" },
      { dx: 42, dy: -30, anchor: "start" },
      { dx: -42, dy: -30, anchor: "end" },
    ];
    let selected = null;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const box = candidateBox(point, text, candidate, fontSize);
      if (!collides(box)) {
        selected = { candidate, box, index };
        break;
      }
    }
    if (!selected) {
      const candidate = candidates[candidates.length - 1];
      selected = { candidate, box: candidateBox(point, text, candidate, fontSize), index: candidates.length - 1 };
    }
    labels.push(selected.box);

    const textAttributes = labelOptions.textAttributes && typeof labelOptions.textAttributes === "object"
      ? labelOptions.textAttributes
      : {};
    const labelKey = String(labelOptions.labelKey ?? textAttributes["data-result-key"] ?? `smart-label-${++serial}`);
    const movable = labelOptions.movable ?? options.movable ?? true;
    const moved = selected.index > 0;
    let leader = null;
    if (moved && labelOptions.leader !== false) {
      const targetX = selected.candidate.anchor === "end"
        ? selected.box.x + selected.box.w
        : selected.candidate.anchor === "middle"
          ? selected.box.x + selected.box.w / 2
          : selected.box.x;
      const targetY = selected.box.y + selected.box.h * 0.58;
      leader = svgNode("line", {
        x1: targetX, y1: targetY, x2: point.x, y2: point.y,
        stroke: labelOptions.leaderColor ?? "#7a8793",
        "stroke-width": labelOptions.leaderWidth ?? SVG_DIAGRAM_STYLE_V0_1.line.leaderPx,
        "marker-end": labelOptions.leaderMarkerId ? `url(#${labelOptions.leaderMarkerId})` : undefined,
        "pointer-events": "none",
        "data-label-leader-key": labelKey,
        "data-label-base-x1": targetX,
        "data-label-base-y1": targetY,
      });
      root.append(leader);
    }

    const group = svgNode("g", {
      "data-movable-label": movable ? "true" : undefined,
      "data-label-key": movable ? labelKey : undefined,
      style: movable ? "cursor:grab;touch-action:none" : undefined,
    });
    if (movable) {
      group.append(svgNode("rect", {
        x: selected.box.x - 7,
        y: selected.box.y - 5,
        width: selected.box.w + 14,
        height: selected.box.h + 10,
        fill: "transparent",
        "pointer-events": "all",
      }));
    }
    if (labelOptions.background !== false) {
      group.append(svgNode("rect", {
        x: selected.box.x - 4,
        y: selected.box.y - 2,
        width: selected.box.w + 8,
        height: selected.box.h + 4,
        rx: 6,
        ry: 6,
        fill: labelOptions.backgroundColor ?? "rgba(255,255,255,0.94)",
        "pointer-events": "none",
      }));
    }

    const lines = String(text).split("\n");
    const textNode = svgNode("text", {
      ...textAttributes,
      x: selected.box.textX,
      y: selected.box.textY,
      "text-anchor": selected.candidate.anchor,
      "font-size": fontSize,
      "font-weight": labelOptions.fontWeight ?? 850,
      fill: labelOptions.color ?? "#14202c",
      stroke: labelOptions.textHalo === false ? undefined : "#ffffff",
      "stroke-width": labelOptions.textHalo === false ? undefined : SVG_DIAGRAM_STYLE_V0_1.label.haloPx,
      "paint-order": labelOptions.textHalo === false ? undefined : "stroke",
      "stroke-linejoin": "round",
      "pointer-events": "none",
    }, lines.length === 1 ? text : undefined);
    if (lines.length > 1) lines.forEach((line, index) => {
      textNode.append(svgNode("tspan", {
        x: selected.box.textX,
        dy: index === 0 ? -(lines.length - 1) * fontSize * 1.2 : fontSize * 1.2,
      }, line));
    });
    group.append(textNode);
    root.append(group);
    return { ...selected, group, textNode, leader, labelKey };
  }

  return { append, reserveRect, reservePoint, reserveSegment, labels, obstacleRects, obstacleSegments };
}
