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

type MergeResult<T> = { ok: true; value: T } | { ok: false };
const missing = Symbol("missing");
type MaybeMissing = unknown | typeof missing;

const equal = (left: MaybeMissing, right: MaybeMissing) =>
  left === missing || right === missing
    ? left === right
    : stableSerialize(left) === stableSerialize(right);

/** Combina alterações independentes; retorna conflito apenas quando ambos mudaram o mesmo campo. */
export function mergeConcurrentStates<T>(base: T, local: T, remote: T): MergeResult<T> {
  const merge = (
    before: MaybeMissing,
    ours: MaybeMissing,
    theirs: MaybeMissing,
  ): MergeResult<MaybeMissing> => {
    if (equal(ours, theirs)) return { ok: true, value: ours };
    if (equal(ours, before)) return { ok: true, value: theirs };
    if (equal(theirs, before)) return { ok: true, value: ours };

    if (
      before !== missing &&
      ours !== missing &&
      theirs !== missing &&
      !Array.isArray(before) &&
      !Array.isArray(ours) &&
      !Array.isArray(theirs) &&
      typeof before === "object" &&
      typeof ours === "object" &&
      typeof theirs === "object"
    ) {
      const b = before as Record<string, unknown>;
      const l = ours as Record<string, unknown>;
      const r = theirs as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      const keys = new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)]);
      for (const key of keys) {
        const child = merge(
          Object.hasOwn(b, key) ? b[key] : missing,
          Object.hasOwn(l, key) ? l[key] : missing,
          Object.hasOwn(r, key) ? r[key] : missing,
        );
        if (!child.ok) return child;
        if (child.value !== missing) result[key] = child.value;
      }
      return { ok: true, value: result };
    }

    const arrayKey = (item: unknown): string | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      if (typeof record["id"] === "string") return `id:${record["id"]}`;
      if (typeof record["merchant"] === "string") return `merchant:${record["merchant"]}`;
      if (typeof record["personId"] === "string") return `person:${record["personId"]}`;
      return null;
    };
    const isEntityArray = (value: MaybeMissing): value is Record<string, unknown>[] =>
      Array.isArray(value) && value.every((item) => arrayKey(item) !== null);
    if (isEntityArray(before) && isEntityArray(ours) && isEntityArray(theirs)) {
      const beforeById = new Map(before.map((item) => [arrayKey(item)!, item]));
      const oursById = new Map(ours.map((item) => [arrayKey(item)!, item]));
      const theirsById = new Map(theirs.map((item) => [arrayKey(item)!, item]));
      const ids = new Set([...beforeById.keys(), ...oursById.keys(), ...theirsById.keys()]);
      const resultById = new Map<string, Record<string, unknown> | typeof missing>();
      for (const id of ids) {
        const item = merge(
          beforeById.get(id) ?? missing,
          oursById.get(id) ?? missing,
          theirsById.get(id) ?? missing,
        );
        if (!item.ok) return item;
        resultById.set(id, item.value as Record<string, unknown> | typeof missing);
      }
      const orderedIds = [
        ...theirs.map((item) => arrayKey(item)!),
        ...ours.map((item) => arrayKey(item)!),
        ...before.map((item) => arrayKey(item)!),
      ];
      const result: Record<string, unknown>[] = [];
      const added = new Set<string>();
      for (const id of orderedIds) {
        const item = resultById.get(id);
        if (!added.has(id) && item && item !== missing) result.push(item);
        added.add(id);
      }
      return { ok: true, value: result };
    }

    return { ok: false };
  };

  const result = merge(base, local, remote);
  return result.ok ? { ok: true, value: result.value as T } : result;
}
