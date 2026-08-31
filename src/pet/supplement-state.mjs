export function createSupplementState(initial = false) {
  let expanded = Boolean(initial);
  return {
    get expanded() { return expanded; },
    set(value) { expanded = Boolean(value); return expanded; },
    toggle() { expanded = !expanded; return expanded; },
  };
}
