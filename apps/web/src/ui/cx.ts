/** Joins class names, skipping empty ones (CSS module lookups may be undefined). */
export function cx(...names: readonly (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}
