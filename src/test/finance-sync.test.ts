import { describe, expect, it } from "vitest";
import { decideCachedState, stableSerialize } from "@/lib/finance/syncMerge";

describe("merge entre cache local e estado remoto", () => {
  it("serializa objetos de forma estável independentemente da ordem das chaves", () => {
    expect(stableSerialize({ b: 2, a: { d: 4, c: 3 } })).toBe(
      stableSerialize({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it("usa o remoto quando o cache local não mudou desde a última sincronização", () => {
    expect(decideCachedState({ version: 1 }, { version: 2 }, stableSerialize({ version: 1 }))).toBe(
      "useRemote",
    );
  });

  it("publica o cache offline quando o remoto segue igual ao baseline", () => {
    expect(decideCachedState({ version: 2 }, { version: 1 }, stableSerialize({ version: 1 }))).toBe(
      "pushLocal",
    );
  });

  it("exige escolha explícita quando cache e remoto mudaram", () => {
    expect(decideCachedState({ version: 2 }, { version: 3 }, stableSerialize({ version: 1 }))).toBe(
      "conflict",
    );
    expect(decideCachedState({ version: 2 }, { version: 3 }, null)).toBe("conflict");
  });

  it("aceita sem gravar quando cache e remoto já coincidem", () => {
    expect(decideCachedState({ version: 1 }, { version: 1 }, null)).toBe("useRemote");
  });
});
