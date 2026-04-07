/**
 * Safely resolves a JS-style accessor path against a parsed JSON value.
 * Supports dot notation and bracket notation: "choices[0].message.content"
 * Returns { value } on success, { value: undefined, error } on failure.
 * NO eval() is used.
 */
export function resolveResponseField(
  obj: unknown,
  path: string
): { value: unknown; error?: string } {
  if (obj === null || obj === undefined) return { value: undefined, error: 'Object is null or undefined' };
  if (!path || path.trim() === '') return { value: obj };

  // Normalize path by converting brackets to dots: choices[0].message -> choices.0.message
  const normalizedPath = path
    .replace(/\[\s*['"]?([^'"\]]+)['"]?\s*\]/g, '.$1') // Handle "['prop']", '["prop"]', or '[0]'
    .replace(/^\./, ''); // Remove leading dot if any

  // Clean empty dots resulting from something like `..` (unlikely but possible)
  const keys = normalizedPath.split('.').filter(Boolean);
  let current: any = obj;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (current === null || current === undefined) {
      return { value: undefined, error: `Cannot read property '${key}' of undefined at path '${keys.slice(0, i).join('.')}'` };
    }
    current = current[key];
  }

  return { value: current };
}
