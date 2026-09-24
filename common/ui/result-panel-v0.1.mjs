// Presentation only: consumers own row content, units and summary selection.
export function isUnavailableResult(text) {
  return /^(?:\s*|[-—–]|N\/A|NaN|Infinity)$/i.test(String(text).trim()) || /^(?:[-—–])(?:\s|$)/.test(String(text).trim()) || /\b(?:N\/A|NaN|Infinity)\b/i.test(String(text));
}

const balancedLayouts = new WeakMap();

export function chooseBalancedColumnCount(widthPx, fontPx, itemCount, {
  minColumnEm = 32, gapPx = 22, maxColumns = 4
} = {}) {
  const count = Math.max(0, Math.trunc(itemCount));
  if (!count || !Number.isFinite(widthPx) || widthPx <= 0) return 1;
  const minWidth = Math.max(160, fontPx * minColumnEm);
  const fit = Math.floor((widthPx + gapPx) / (minWidth + gapPx));
  return Math.max(1, Math.min(count, maxColumns, fit));
}

export function planBalancedColumns(itemCount, columnCount) {
  const count = Math.max(0, Math.trunc(itemCount));
  const columns = Math.max(1, Math.min(count || 1, Math.trunc(columnCount)));
  const base = Math.floor(count / columns);
  const extra = count % columns;
  const positions = [];
  for (let column = 1; column <= columns; column++) {
    for (let row = 1; row <= base + (column <= extra ? 1 : 0); row++) {
      positions.push({ column, row });
    }
  }
  return positions;
}

export function installBalancedColumns(container, itemSelector, options = {}) {
  if (!container) return { refresh() {} };
  if (balancedLayouts.has(container)) return balancedLayouts.get(container);
  const view = container.ownerDocument.defaultView;
  let lastWidth = -1;
  function refresh() {
    const items = [...container.querySelectorAll(itemSelector)];
    const visible = items.filter(item => !item.hidden);
    const fontPx = parseFloat(view.getComputedStyle(container).fontSize) || 13;
    const widthPx = container.clientWidth;
    const columns = chooseBalancedColumnCount(widthPx, fontPx, visible.length, options);
    container.style.gridTemplateColumns = `repeat(${columns},minmax(0,1fr))`;
    container.dataset.balancedColumns = String(columns);
    for (const item of items) {
      item.style.gridColumn = '';
      item.style.gridRow = '';
    }
    planBalancedColumns(visible.length, columns).forEach((position, index) => {
      visible[index].style.gridColumn = String(position.column);
      visible[index].style.gridRow = String(position.row);
    });
    lastWidth = widthPx;
  }
  const api = { refresh };
  balancedLayouts.set(container, api);
  refresh();
  if (typeof view.ResizeObserver === 'function') {
    const observer = new view.ResizeObserver(() => {
      if (Math.abs(container.clientWidth - lastWidth) > 0.5) refresh();
    });
    observer.observe(container);
  } else {
    view.addEventListener('resize', refresh);
  }
  return api;
}

export function installResultPanel(section) {
  const body = section.querySelector('.result-panel-body');
  const toolbar = section.querySelector('[data-result-controls]');
  toolbar.innerHTML = '<span>Text</span><button type="button" data-result-text="out" aria-label="Decrease result text">-</button><button type="button" data-result-text="reset" aria-label="Reset result text to 100%">100%</button><button type="button" data-result-text="in" aria-label="Increase result text">+</button><button type="button" data-result-advanced aria-pressed="false">Advanced: Off</button>';
  const button = action => toolbar.querySelector(`[data-result-text="${action}"]`);
  const advancedButton = toolbar.querySelector('[data-result-advanced]');
  let scale = 1;
  let advanced = false;
  const resultLayouts = [...body.querySelectorAll('.result-rows')]
    .map(rows => installBalancedColumns(rows, '[data-result-row]'));
  for (const remark of section.ownerDocument.querySelectorAll('.remark')) {
    installBalancedColumns(remark, '.remark-item', {
      minColumnEm: 28, gapPx: 10, maxColumns: 4
    });
  }
  function refresh() {
    const rows = [...body.querySelectorAll('[data-result-row]')];
    for (const row of rows) {
      const value = row.querySelector('[data-result-value]');
      row.hidden = !advanced && (row.dataset.summary !== 'true' || isUnavailableResult(value?.textContent ?? ''));
    }
    for (const group of body.querySelectorAll('[data-result-group]')) {
      group.hidden = ![...group.querySelectorAll('[data-result-row]')].some(row => !row.hidden);
    }
    section.querySelector('[data-result-empty]').hidden = rows.some(row => !row.hidden);
    section.dataset.resultMode = advanced ? 'advanced' : 'summary';
    advancedButton.textContent = `Advanced: ${advanced ? 'On' : 'Off'}`;
    advancedButton.setAttribute('aria-pressed', String(advanced));
    for (const layout of resultLayouts) layout.refresh();
  }
  function setScale(value) {
    scale = Math.max(0.5, Math.min(2, Math.round(value * 10) / 10));
    body.style.fontSize = `${13 * scale}px`;
    button('reset').textContent = `${Math.round(scale * 100)}%`;
    button('out').disabled = scale <= 0.5;
    button('in').disabled = scale >= 2;
    for (const layout of resultLayouts) layout.refresh();
  }
  button('out').addEventListener('click', () => setScale(scale - 0.1));
  button('in').addEventListener('click', () => setScale(scale + 0.1));
  button('reset').addEventListener('click', () => setScale(1));
  advancedButton.addEventListener('click', () => { advanced = !advanced; refresh(); });
  setScale(1);
  refresh();
  return { refresh, resetText: () => setScale(1) };
}
