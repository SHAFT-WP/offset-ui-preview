// Offset-only chrome. Move the live controls, retaining their listeners, values and host queries.
// Common diagram markup and the dedicated BDP app are not changed.
const AUXILIARY = '[data-view-control="reset"], #zoom-reset, #capture-top-view, #top-view-ip-bottom, #top-view-advanced, [data-full-views], [data-bdp-advanced], [data-bdp-profile-advanced], .bdp-orientation, [data-bdp-3d="reset"], [data-bdp-hud="reset"], [data-sr-png], [data-sr-ip-bottom], [data-sr-undo], [data-sr-redo]';
const optionLayouts = new WeakSet();

function installOptionsLayout(options) {
  if (optionLayouts.has(options)) return;
  optionLayouts.add(options);
  const actions = options.closest('.diagram-actions');
  let compactOpen = false;
  const layout = () => {
    const inline = Boolean(actions && actions.clientWidth > 700);
    if (options.dataset.inline === String(inline)) return;
    if (options.dataset.inline === 'false') compactOpen = options.open;
    options.dataset.inline = String(inline);
    options.open = inline || compactOpen;
  };
  // Native details stays semantically open while its controls are inline and collapsed in compact mode.
  options.addEventListener('toggle', () => { if (options.dataset.inline === 'false') compactOpen = options.open; });
  if (actions && typeof ResizeObserver !== 'undefined') new ResizeObserver(layout).observe(actions);
  layout();
}

function optionsFor(row) {
  let options = [...row.children].find(node => node.classList.contains('offset-options'));
  if (options) return options;
  options = row.ownerDocument.createElement('details');
  options.className = 'offset-options';
  const summary = row.ownerDocument.createElement('summary');
  summary.className = 'capture-button';
  summary.textContent = 'Options';
  const body = row.ownerDocument.createElement('div');
  body.className = 'offset-options-body';
  options.append(summary, body);
  row.append(options);
  return options;
}

function prepareBdpPanel(panel) {
  if (panel.dataset.offsetToolbarReady) return;
  panel.dataset.offsetToolbarReady = 'true';
  const summary = panel.querySelector(':scope > summary');
  if (!summary) return;
  const titleTools = [...summary.querySelectorAll('.bdp-view-tools, .bdp-orientation, [data-bdp-advanced], [data-bdp-profile-advanced]')];
  if (!titleTools.length) return;
  let actions = panel.querySelector(':scope > .diagram-actions');
  // HUD's existing inputs stay below its canvas; camera tools get the same position as the other charts.
  if (!actions || panel.dataset.bdpDiagram === 'hud') {
    actions = panel.ownerDocument.createElement('div');
    actions.className = 'diagram-actions';
    summary.after(actions);
  }
  let row = actions.querySelector('[data-view-controls]');
  if (!row) {
    row = panel.ownerDocument.createElement('div');
    row.className = 'diagram-action-row';
    actions.prepend(row);
  }
  for (const tools of titleTools) {
    if (!tools.classList.contains('bdp-view-tools')) { row.append(tools); continue; }
    const group = panel.ownerDocument.createElement('div');
    group.className = 'view-scale-control';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', `${panel.dataset.bdpDiagram === '3d' ? '3D Profile' : 'HUD View'} picture size`);
    const label = panel.ownerDocument.createElement('span');
    label.className = 'diagram-control-label';
    label.textContent = 'Size';
    group.append(label);
    for (const control of [...tools.children]) {
      if (control.dataset.bdp3d === 'reset' || control.dataset.bdpHud === 'reset') row.append(control);
      else group.append(control);
    }
    row.prepend(group);
    tools.remove();
  }
}

export function enhanceOffsetToolbars(root) {
  if (!root?.querySelectorAll) return;
  const all = selector => [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];
  all('.bdp-diagram').forEach(prepareBdpPanel);
  for (const header of all('.section-head')) {
    header.classList.add('offset-section-head');
    const nested = header.querySelector('h2 > .section-collapse-icon');
    if (nested) header.append(nested);
  }
  // S&R embeds Common's control row inside its own row. Flatten only the wrapper, not the controls.
  for (const nested of all('.sr-toolbar > [data-view-controls]')) nested.replaceWith(...nested.childNodes);
  for (const row of all('.diagram-action-row:not(.time-dial)')) {
    const auxiliary = [...row.children].filter(node => node.matches(AUXILIARY));
    if (!auxiliary.length) continue;
    const options = optionsFor(row);
    const body = options.querySelector('.offset-options-body');
    auxiliary.forEach(node => body.append(node));
  }
  // Standard's tab header has Save/Default as well as its primary visibility toggle.
  for (const tools of all('.section-tools')) {
    const secondary = [...tools.children].filter(node => node.matches('[data-tab-tool="save"], [data-tab-tool="default"]'));
    if (secondary.length < 2) continue;
    const body = optionsFor(tools).querySelector('.offset-options-body');
    secondary.forEach(node => body.append(node));
  }
  for (const controls of all('[data-result-controls]')) {
    if (controls.querySelector('.font-scale-control')) continue;
    const buttons = [...controls.querySelectorAll('[data-result-text]')];
    if (!buttons.length) continue;
    const group = controls.ownerDocument.createElement('span');
    group.className = 'font-scale-control';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Result text size');
    const label = controls.querySelector(':scope > span');
    controls.prepend(group);
    if (label) group.append(label);
    group.append(...buttons);
  }
  all('.offset-options').forEach(installOptionsLayout);
}

export function installOffsetToolbarUi(root = document.getElementById('offset-calculator')) {
  if (!root || root.dataset.offsetToolbarUi) return;
  root.dataset.offsetToolbarUi = 'true';
  enhanceOffsetToolbars(root);
  // New aircraft and S&R mount later. Ignore SVG/result painting and text changes during Play.
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType !== 1 || node.closest('svg, .result-panel-body, .offset-options')) continue;
      if (node.matches('.section, .bdp-diagram, .diagram-actions, .section-tools') || node.querySelector('.section, .bdp-diagram, .diagram-actions, .section-tools')) enhanceOffsetToolbars(node);
    }
  });
  observer.observe(root, {childList:true, subtree:true});
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const options = event.target.closest('.offset-options[open]');
    if (!options || options.dataset.inline === 'true') return;
    event.preventDefault();
    event.stopPropagation();
    options.open = false;
    options.querySelector('summary').focus();
  });
}
