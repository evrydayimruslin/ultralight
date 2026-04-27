/**
 * Validate provider-native model identifiers.
 *
 * Examples:
 *   - gpt-4o-mini
 *   - gemini-3-flash-preview
 *   - deepseek-v4-flash
 *   - grok-4.20-reasoning
 *   - deepseek/deepseek-v4-flash
 *   - google/gemini-3.1-flash-lite-preview:nitro
 */
export function isValidModelId(model: string): boolean {
  if (typeof model !== 'string') return false;
  if (model.length === 0 || model.length > 200) return false;
  if (model.trim() !== model) return false;

  if (!/^[a-z0-9][a-z0-9._:/-]*$/i.test(model)) {
    return false;
  }

  if (model.includes('//') || model.endsWith('/')) {
    return false;
  }

  return model.split('/').every((segment) => segment.length > 0);
}
