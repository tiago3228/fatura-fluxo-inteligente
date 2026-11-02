import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: { rpc: vi.fn(), from: vi.fn() },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));

import { ensureWorkspace, loadCloudState, saveCloudState } from "@/lib/finance/cloud";
import { createEmptyFinanceState } from "@/lib/finance/mock";

const emptyState = createEmptyFinanceState();

beforeEach(() => {
  vi.resetAllMocks();
});

describe("contrato da sincronização Supabase", () => {
  it("usa a RPC segura de workspace e não presume um workspace em caso de erro", async () => {
    supabaseMock.rpc.mockResolvedValueOnce({ data: "workspace-user", error: null });
    expect(await ensureWorkspace()).toEqual({ workspaceId: "workspace-user" });
    expect(supabaseMock.rpc).toHaveBeenCalledWith("ensure_user_workspace");

    supabaseMock.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } });
    const failed = await ensureWorkspace();
    expect(failed.workspaceId).toBeNull();
    if (failed.workspaceId === null) expect(failed.error).toContain("0005");
  });

  it("não confunde erro de acesso com workspace vazio", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } });
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    supabaseMock.from.mockReturnValue(query);

    expect(await loadCloudState("workspace-user")).toMatchObject({ kind: "error" });
    expect(maybeSingle).toHaveBeenCalledOnce();
  });

  it("carrega revisão remota e preserva conflito compare-and-swap em vez de sobrescrever", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { data: emptyState, revision: 4 },
      error: null,
    });
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    supabaseMock.from.mockReturnValue(query);
    expect(await loadCloudState("workspace-user")).toEqual({
      kind: "loaded", state: emptyState, revision: 4,
    });

    supabaseMock.rpc.mockResolvedValueOnce({
      data: [{ saved: false, revision: 5, data: emptyState }],
      error: null,
    });
    expect(await saveCloudState("workspace-user", emptyState, 4)).toEqual({
      kind: "conflict", state: emptyState, revision: 5,
    });
    expect(supabaseMock.rpc).toHaveBeenCalledWith("save_workspace_state", expect.objectContaining({
      p_workspace_id: "workspace-user",
      p_expected_revision: 4,
      p_data: emptyState,
    }));
  });

  it("só reporta persistência concluída quando o RPC devolve saved=true", async () => {
    supabaseMock.rpc.mockResolvedValueOnce({
      data: [{ saved: true, revision: 8, data: null }],
      error: null,
    });
    expect(await saveCloudState("workspace-user", emptyState, 7)).toEqual({
      kind: "saved", revision: 8,
    });
  });
});
