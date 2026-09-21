// Presentation only: consumers own row content, units and summary selection.
export function isUnavailableResult(text) {
  return /^(?:\s*|[-—–]|N\/A|NaN|Infinity)$/i.test(String(text).trim()) || /^(?:[-—–])(?:\s|$)/.test(String(text).trim()) || /\b(?:N\/A|NaN|Infinity)\b/i.test(String(text));
}

export function installResultPanel(section) {
  const body = section.querySelector('.result-panel-body');
  const toolbar = section.querySelector('[data-result-controls]');
  toolbar.innerHTML = '<span>Text</span><button type="button" data-result-text="out" aria-label="Decrease result text">-</button><button type="button" data-result-text="reset" aria-label="Reset result text to 100%">100%</button><button type="button" data-result-text="in" aria-label="Increase result text">+</button><button type="button" data-result-advanced aria-pressed="false">Advanced: Off</button>';
  const button = action => toolbar.querySelector(`[data-result-text="${action}"]`);
  const advancedButton = toolbar.querySelector('[data-result-advanced]');
  let scale = 1;
  let advanced = false;
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
  }
  function setScale(value) {
    scale = Math.max(0.5, Math.min(2, Math.round(value * 10) / 10));
    body.style.fontSize = `${13 * scale}px`;
    button('reset').textContent = `${Math.round(scale * 100)}%`;
    button('out').disabled = scale <= 0.5;
    button('in').disabled = scale >= 2;
  }
  button('out').addEventListener('click', () => setScale(scale - 0.1));
  button('in').addEventListener('click', () => setScale(scale + 0.1));
  button('reset').addEventListener('click', () => setScale(1));
  advancedButton.addEventListener('click', () => { advanced = !advanced; refresh(); });
  setScale(1);
  refresh();
  return { refresh, resetText: () => setScale(1) };
}
