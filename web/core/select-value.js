/** Keep an unavailable selection visible without silently choosing a different value. */
export function retainSelectValue(select, value, message, label = '当前不可用') {
  const requested = value == null ? '' : String(value);
  if (requested && ![...select.options].some(option => option.value === requested)) {
    const option = document.createElement('option');
    option.value = requested;
    option.textContent = `${requested} · ${label}`;
    option.dataset.selectionError = message;
    select.add(option);
  }
  select.value = requested;
  validateSelectValue(select);
}

export function validateSelectValue(select) {
  select.setCustomValidity(select.selectedOptions[0]?.dataset.selectionError || '');
}
