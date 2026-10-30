export const stableJsonStringify = (value: unknown): string =>
  JSON.stringify(value, (_key, current: unknown) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return current;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(current).sort()) {
      sorted[key] = (current as Record<string, unknown>)[key];
    }
    return sorted;
  }) ?? "null";
