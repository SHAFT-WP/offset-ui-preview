// Design-tab field mirror (owner 2026-11-24: "디자이너에 있는 인풋들은 모두 입력에 있는 기능들 (lock, time) 모두 동일해야 하고
// 인풋이건 디자인이건 한쪽이라도 록되면 양쪽 다 표시되어야 해. 이는 다른 be들도 마찬가지다").
// A Design copy of a page input gets a proxy of every control its page field carries (LOCK / LINK / TIME / ANGLE
// buttons, a unit or mode select). Pressing a proxy presses the page's own control; every sync copies the page
// control's state (pressed, text, disabled, hidden, value) back, so both sides always show the same state.
// Shared by the Offset and POP-UP Design tabs. DOM only, no calculation.
export const DESIGN_FIELD_MIRROR_V0_1 = Object.freeze({ id: "design-field-mirror-v0.1", version: "0.1.0" });

const container = (main) => main?.closest("label, .field, .offset-card") ?? null;

// input: the Design copy (inside its own label.field). main: the page input. covered(button) → true for a page
// button the caller already mirrors itself. press(fn): runs a page action (the caller's busy / settle wrapper).
export function mirrorFieldControls(input, main, { covered = () => false, press = (fn) => fn() } = {}) {
  if (input.__mirror && input.__mirror.main === main) return input.__mirror;
  const host = container(main);
  const field = input.closest(".field");
  if (input.__mirror) for (const [proxy] of [...input.__mirror.buttons, ...input.__mirror.selects]) proxy.remove();
  const mirror = { main, buttons: [], selects: [] };
  input.__mirror = mirror;
  if (!host || !field) return mirror;
  // A page LOCK the Design field already stands for with its own button (data-design-lock = the same key) is skipped.
  const own = new Set([...field.querySelectorAll("[data-design-lock]")].map((b) => b.getAttribute("data-design-lock")));
  const pageButtons = [...host.querySelectorAll("button")].filter((b) => !covered(b) && !own.has(b.getAttribute("data-lock-key")));
  if (pageButtons.length) {
    let title = field.querySelector(":scope > .lock-title");
    if (!title) {
      const label = field.querySelector(":scope > span");
      title = document.createElement("span");
      title.className = "lock-title";
      if (label) { label.replaceWith(title); title.append(label); } else field.prepend(title);
    }
    let group = title.querySelector(":scope > .lock-group");
    if (!group) { group = document.createElement("span"); group.className = "lock-group"; title.append(group); }
    for (const b of pageButtons) {
      const proxy = document.createElement("button");
      proxy.type = "button";
      proxy.className = b.className;
      proxy.setAttribute("data-design-mirror", b.getAttribute("data-lock-key") || b.id || b.textContent.trim().toLowerCase());
      proxy.addEventListener("click", (event) => { event.preventDefault(); press(() => b.click()); });
      group.append(proxy);
      mirror.buttons.push([proxy, b]);
    }
  }
  for (const s of host.querySelectorAll("select")) {
    const proxy = s.cloneNode(true);
    proxy.removeAttribute("id");
    proxy.removeAttribute("data-key");
    proxy.setAttribute("data-design-mirror", s.getAttribute("data-key") ?? "");
    proxy.addEventListener("change", () => press(() => { s.value = proxy.value; s.dispatchEvent(new Event("input", { bubbles: true })); s.dispatchEvent(new Event("change", { bubbles: true })); }));
    // Placed right after the copy, as a compound field (value + unit select) on the page.
    if (!input.parentElement.classList.contains("compound")) {
      const compound = document.createElement("span");
      compound.className = "compound";
      input.replaceWith(compound);
      compound.append(input);
    }
    input.parentElement.append(proxy);
    mirror.selects.push([proxy, s]);
  }
  return mirror;
}

// Copies the page controls' state onto their proxies (call on every render).
export function syncFieldControls(input, { busy = false } = {}) {
  const mirror = input.__mirror;
  if (!mirror) return;
  for (const [proxy, b] of mirror.buttons) {
    proxy.textContent = b.textContent;
    proxy.className = b.className;
    for (const a of ["aria-pressed", "aria-label", "title"]) { const v = b.getAttribute(a); if (v === null) proxy.removeAttribute(a); else proxy.setAttribute(a, v); }
    proxy.hidden = b.hidden;
    proxy.disabled = busy || b.disabled;
  }
  for (const [proxy, s] of mirror.selects) {
    if (document.activeElement !== proxy) proxy.value = s.value;
    proxy.disabled = busy || s.disabled;
  }
}
