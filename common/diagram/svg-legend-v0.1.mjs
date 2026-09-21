import { SVG_NS, svgNode } from './svg-primitives-v0.1.mjs';

// A separate SVG footer stays fixed while its associated plot is zoomed/panned.
// Labels and colours come from the owning renderer, never from Common policy.
export function installSvgLegend(svg, items, notes = []) {
  function render() {
    const width = Math.max(160, Math.round(svg.getBoundingClientRect().width || 600));
    const padding = 12, gap = 18, rowHeight = 23;
    svg.replaceChildren();
    const background = svgNode('rect', { width, fill: '#000' });
    svg.append(background);
    let x = padding, y = padding + 13;
    for (const item of items) {
      const text = svgNode('text', { x: 0, y: 0, fill: '#fff', 'font-size': 13, 'font-family': 'sans-serif' });
      text.textContent = item.label;
      svg.append(text);
      const itemWidth = 28 + text.getComputedTextLength();
      if (x > padding && x + itemWidth > width - padding) { x = padding; y += rowHeight; }
      svg.append(svgNode('line', { x1: x, x2: x + 18, y1: y - 4, y2: y - 4, stroke: item.color, 'stroke-width': 3, ...(item.dashed ? { 'stroke-dasharray': '4 3' } : {}) }));
      text.setAttribute('x', x + 25); text.setAttribute('y', y);
      x += itemWidth + gap;
    }
    // Plain-text notes wrap by measured glyph width, including narrow screens.
    for (const note of notes) {
      y += rowHeight;
      let line = '';
      let text = svgNode('text', { x: padding, y, fill: '#fff', 'font-size': 12, 'font-family': 'sans-serif' });
      svg.append(text);
      for (const word of note.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        text.textContent = candidate;
        if (line && text.getComputedTextLength() > width - padding * 2) {
          text.textContent = line;
          y += 19;
          text = svgNode('text', { x: padding, y, fill: '#fff', 'font-size': 12, 'font-family': 'sans-serif' });
          svg.append(text);
          line = word;
        } else line = candidate;
        text.textContent = line;
      }
    }
    const height = y + padding;
    background.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('xmlns', SVG_NS);
  }
  render();
  let lastWidth = Math.round(svg.getBoundingClientRect().width);
  const observer = new ResizeObserver(() => {
    const width = Math.round(svg.getBoundingClientRect().width);
    if (width !== lastWidth) { lastWidth = width; render(); }
  });
  observer.observe(svg);
  return { render, destroy: () => observer.disconnect() };
}
