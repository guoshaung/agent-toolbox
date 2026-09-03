function splitTopLevel(source, delimiter) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') depth = Math.max(0, depth - 1);
    else if (char === delimiter && depth === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

export function splitAlignedEquation(value) {
  const source = String(value || '').trim();
  if (!source || /\\begin\{(?:aligned|align|array|gathered)\}/.test(source)) return null;
  const equation = splitTopLevel(source, '=');
  if (equation.length !== 2) return null;
  const left = equation[0].trim();
  const terms = splitTopLevel(equation[1], '+').map((term) => term.trim()).filter(Boolean);
  if (!left || terms.length < 2) return null;
  return { left, terms };
}

export function formatAlignedLatex(value) {
  const source = String(value || '').trim();
  const equation = splitAlignedEquation(source);
  if (!equation) return source;
  return [
    '\\begin{aligned}',
    `${equation.left} &= ${equation.terms[0]} \\\\[0.8em]`,
    ...equation.terms.slice(1).map((term, index, rest) => `&\\quad+ ${term}${index === rest.length - 1 ? '' : ' \\\\[0.8em]'}`),
    '\\end{aligned}',
  ].join('\n');
}

export function hasTopLevelEquation(value) {
  const source = String(value || '').trim();
  return splitTopLevel(source, '=').length === 2 && splitTopLevel(splitTopLevel(source, '=')[1], '+').length > 1;
}
