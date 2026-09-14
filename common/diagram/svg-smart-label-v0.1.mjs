import { svgNode } from "./svg-primitives-v0.1.mjs";

export const SVG_SMART_LABEL_V0_1 = Object.freeze({
  id: "svg-smart-label-v0.1",
  version: "0.1.0",
  purpose: "Generic collision-aware SVG label placement with optional leader lines",
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

export function createSmartLabelLayout(root, options = {}) {
  if (!root) throw new TypeError("root is required");
  const width = options.width ?? 1180;
  const height = options.height ?? 720;
  const edgePad = options.edgePad ?? 10;
  const labelPad = options.labelPad ?? 8;
  const pathPad = options.pathPad ?? 6;
  const labels = [];
  const obstacleRects = [];
  const obstacleSegments = [];

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
    const approxW = Math.max(34, String(text).length * fontSize * 0.58);
    const approxH = fontSize * 1.45;
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
    const fontSize = labelOptions.fontSize ?? 11;
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

    const moved = selected.index > 0;
    if (moved && labelOptions.leader !== false) {
      const targetX = selected.candidate.anchor === "end"
        ? selected.box.x + selected.box.w
        : selected.candidate.anchor === "middle"
          ? selected.box.x + selected.box.w / 2
          : selected.box.x;
      const targetY = selected.box.y + selected.box.h * 0.58;
      root.append(svgNode("line", {
        x1: targetX, y1: targetY, x2: point.x, y2: point.y,
        stroke: labelOptions.leaderColor ?? "#7a8793",
        "stroke-width": labelOptions.leaderWidth ?? 1,
        "marker-end": labelOptions.leaderMarkerId ? `url(#${labelOptions.leaderMarkerId})` : undefined,
        "pointer-events": "none",
      }));
    }

    if (labelOptions.background !== false) {
      root.append(svgNode("rect", {
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

    root.append(svgNode("text", {
      x: selected.box.textX,
      y: selected.box.textY,
      "text-anchor": selected.candidate.anchor,
      "font-size": fontSize,
      "font-weight": labelOptions.fontWeight ?? 850,
      fill: labelOptions.color ?? "#14202c",
      stroke: labelOptions.textHalo === false ? undefined : "#ffffff",
      "stroke-width": labelOptions.textHalo === false ? undefined : 3,
      "paint-order": labelOptions.textHalo === false ? undefined : "stroke",
      "stroke-linejoin": "round",
      "pointer-events": "none",
    }, text));
    return selected;
  }

  return { append, reserveRect, reservePoint, reserveSegment, labels, obstacleRects, obstacleSegments };
}
