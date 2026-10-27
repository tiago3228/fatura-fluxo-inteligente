import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));

import { loadCloudState } from "@/lib/finance/cloud";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockImplementation(() => ({
    select: () => ({
      eq: () => ({ maybeSingle: mocks.maybeSingle }),
    }),
    upsert: mocks.upsert,
  }));
});

describe("loadCloudState", () => {
  it("distingue um documento realmente ausente de uma falha de leitura", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(loadCloudState("workspace-test")).resolves.toEqual({ kind: "missing" });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "network failure" } });
    await expect(loadCloudState("workspace-test")).resolves.toEqual({ kind: "error" });
    consoleError.mockRestore();
  });

  it("retorna o documento quando a leitura é bem-sucedida", async () => {
    const state = { settings: { persist: true } };
    mocks.maybeSingle.mockResolvedValueOnce({ data: { data: state }, error: null });

    await expect(loadCloudState("workspace-test")).resolves.toEqual({ kind: "loaded", state });
  });

  it("rejeita documento salvo em formato inválido em vez de tratá-lo como ausente", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.maybeSingle.mockResolvedValueOnce({ data: { data: null }, error: null });

    await expect(loadCloudState("workspace-test")).resolves.toEqual({ kind: "error" });
    consoleError.mockRestore();
  });
});
