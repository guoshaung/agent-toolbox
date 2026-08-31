export const FONT_LEVELS = ['compact', 'standard', 'comfortable'];

export function createFontLevelState(initial = 'comfortable', persist = () => {}) {
  let index = Math.max(0, FONT_LEVELS.indexOf(initial));
  if (!FONT_LEVELS.includes(initial)) index = FONT_LEVELS.length - 1;
  const set = (level, options = {}) => {
    const next = FONT_LEVELS.indexOf(level);
    if (next >= 0) index = next;
    if (options.persist !== false) persist(FONT_LEVELS[index]);
    return FONT_LEVELS[index];
  };
  return {
    get level() { return FONT_LEVELS[index]; },
    get canDecrease() { return index > 0; },
    get canIncrease() { return index < FONT_LEVELS.length - 1; },
    set,
    decrease() { return set(FONT_LEVELS[Math.max(0, index - 1)]); },
    increase() { return set(FONT_LEVELS[Math.min(FONT_LEVELS.length - 1, index + 1)]); },
  };
}
