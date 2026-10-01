// Reading config and answer records by keys that come from authors or users. A plain
// `record[key]` returns Object.prototype members for keys like `constructor`, which would
// count as an existing step, result, override or answer. Every such read goes through here.
export function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
