export type CachedStateDecision = "useRemote" | "pushLocal" | "conflict";

/** JSON canônico: JSONB não preserva ordem de chaves, portanto JSON.stringify simples não serve para detectar alterações. */
export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
}

/**
 * Escolhe sem sobrescrita silenciosa: cache inalterado cede ao remoto; remoto inalterado
 * permite publicar o cache offline; alterações dos dois lados exigem decisão do usuário.
 */
export function decideCachedState(
  local: unknown | null,
  remote: unknown,
  lastSynced: string | null,
): CachedStateDecision {
  const remoteJson = stableSerialize(remote);
  if (local === null) return "useRemote";
  const localJson = stableSerialize(local);
  if (localJson === remoteJson || localJson === lastSynced) return "useRemote";
  if (remoteJson === lastSynced) return "pushLocal";
  return "conflict";
}
