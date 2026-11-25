/**
 * 9Router Web — Prompt Template Variable Utilities (Part C)
 * Pure ES module for extracting and substituting {{variable}} placeholders.
 */

const VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

/**
 * Extract unique variable names from {{variable}} placeholders in order of appearance.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function extractVariables(text) {
  const input = String(text ?? '');
  const seen = new Set();
  const result = [];

  for (const match of input.matchAll(VARIABLE_PATTERN)) {
    const name = String(match[1] || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }

  return result;
}

/**
 * Replace all {{variable}} occurrences with values[name] when provided (non-empty string).
 * Missing or empty variables are left as-is.
 *
 * @param {string} text
 * @param {Record<string, string>} [values={}]
 * @returns {string}
 */
export function substituteVariables(text, values = {}) {
  const input = String(text ?? '');
  const map = values && typeof values === 'object' ? values : {};

  return input.replace(VARIABLE_PATTERN, (fullMatch, rawName) => {
    const name = String(rawName || '').trim();
    if (!name || !Object.prototype.hasOwnProperty.call(map, name)) {
      return fullMatch;
    }
    const rawVal = map[name];
    if (rawVal === undefined || rawVal === null) {
      return fullMatch;
    }
    const strVal = String(rawVal);
    return strVal.length > 0 ? strVal : fullMatch;
  });
}
