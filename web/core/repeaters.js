/** Shared empty/row rendering; each form supplies its own platform field markup. */
export function renderRepeater(container, items, renderRow, emptyMessage) {
  container.innerHTML = items.length
    ? items.map(renderRow).join("")
    : `<div class="repeater-empty">${emptyMessage}</div>`;
}
