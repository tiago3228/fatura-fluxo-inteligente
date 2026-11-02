import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  maybeSingle: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
  currentUserId: "user-test",
  authCallback: undefined as ((event: string, session: unknown) => void) | undefined,
  realtimeCallback: undefined as
    | ((payload: { new?: { data?: unknown; revision?: number } | null }) => void)
    | undefined,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
    },
    rpc: mocks.rpc,
    from: mocks.from,
    channel: mocks.channel,
    removeChannel: mocks.removeChannel,
  },
}));

import { createEmptyFinanceState } from "@/lib/finance/mock";
import { FinanceProvider, useFinance } from "@/lib/finance/store";

function SyncStatusProbe() {
  const { syncStatus, state, dispatch } = useFinance();
  return (
    <>
      <output data-testid="sync-status">{syncStatus.phase}</output>
      <output data-testid="sync-message">{syncStatus.message ?? ""}</output>
      <output data-testid="warn-pct">{state.settings.warnPct}</output>
      <output data-testid="user-data">{state.people.map((person) => person.name).join(",")}</output>
      <button
        type="button"
        onClick={() =>
          dispatch({ type: "updateSettings", patch: { warnPct: state.settings.warnPct + 1 } })
        }
      >
        Editar estado local
      </button>
    </>
  );
}

function renderProvider() {
  return render(
    <FinanceProvider>
      <SyncStatusProbe />
    </FinanceProvider>,
  );
}

const saveCalls = () =>
  mocks.rpc.mock.calls.filter(([procedure]) => procedure === "save_workspace_state");
const savedResponse = (revision: number) => ({
  data: [{ saved: true, revision, data: null }],
  error: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.currentUserId = "user-test";
  mocks.authCallback = undefined;
  mocks.getSession.mockImplementation(() => {
    return Promise.resolve({
      data: { session: { user: { id: mocks.currentUserId } } },
      error: null,
    });
  });
  mocks.onAuthStateChange.mockImplementation((callback) => {
    mocks.authCallback = callback;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  mocks.rpc.mockImplementation((procedure: string) => {
    if (procedure === "ensure_user_workspace")
      return Promise.resolve({ data: `workspace-${mocks.currentUserId}`, error: null });
    return Promise.resolve(savedResponse(2));
  });
  mocks.from.mockImplementation(() => {
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: mocks.maybeSingle };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    return query;
  });
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  channel.on.mockImplementation((_event, _filter, callback) => {
    mocks.realtimeCallback = callback;
    return channel;
  });
  channel.subscribe.mockReturnValue(channel);
  mocks.channel.mockReturnValue(channel);
  mocks.removeChannel.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("FinanceProvider com Compare-and-Swap", () => {
  it("preserva cache e não tenta gravar quando a leitura remota falha", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("error"));

    expect(screen.getByTestId("sync-message")).toHaveTextContent("Permissão negada");
    expect(saveCalls()).toHaveLength(0);
  });

  it("limpa a visualização anterior imediatamente ao trocar de usuário", async () => {
    const firstState = {
      ...createEmptyFinanceState(),
      people: [{ id: "p_private", name: "PRIVADO USER 1", limit: 0, active: true, cardIds: [] }],
    };
    const secondState = createEmptyFinanceState();
    mocks.maybeSingle
      .mockResolvedValueOnce({ data: { data: firstState, revision: 1 }, error: null })
      .mockResolvedValueOnce({ data: { data: secondState, revision: 0 }, error: null });
    let finishWorkspace: ((value: { data: string; error: null }) => void) | undefined;
    mocks.rpc.mockImplementation((procedure: string) => {
      if (procedure !== "ensure_user_workspace") return Promise.resolve(savedResponse(2));
      if (mocks.currentUserId === "user-2")
        return new Promise((resolve) => {
          finishWorkspace = resolve;
        });
      return Promise.resolve({ data: `workspace-${mocks.currentUserId}`, error: null });
    });

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("user-data")).toHaveTextContent("PRIVADO USER 1"));
    mocks.currentUserId = "user-2";
    act(() => mocks.authCallback?.("SIGNED_IN", null));

    await waitFor(() => expect(screen.getByTestId("user-data")).toBeEmptyDOMElement());
    expect(screen.getByTestId("user-data")).not.toHaveTextContent("PRIVADO USER 1");
    await act(async () => finishWorkspace?.({ data: "workspace-user-2", error: null }));
    await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("synced"));
    expect(screen.getByTestId("user-data")).toBeEmptyDOMElement();
  });

  it("inicializa o workspace por CAS somente depois de confirmar que ele está ausente", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("synced"));

    expect(saveCalls()).toHaveLength(1);
    expect(saveCalls()[0]?.[1]).toMatchObject({
      p_workspace_id: "workspace-user-test",
      p_expected_revision: 0,
    });
  });

  it("mantém a edição local e sinaliza conflito quando CAS encontra revisão mais nova", async () => {
    const remoteState = createEmptyFinanceState();
    mocks.maybeSingle.mockResolvedValue({ data: { data: remoteState, revision: 4 }, error: null });
    mocks.rpc.mockImplementation((procedure: string) =>
      procedure === "ensure_user_workspace"
        ? Promise.resolve({ data: "workspace-test", error: null })
        : Promise.resolve({
            data: [{ saved: false, revision: 5, data: remoteState }],
            error: null,
          }),
    );

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("synced"));
    const initialWarnPct = Number(screen.getByTestId("warn-pct").textContent);
    fireEvent.click(screen.getByRole("button", { name: "Editar estado local" }));

    await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("conflict"));
    expect(screen.getByTestId("warn-pct")).toHaveTextContent(String(initialWarnPct + 1));
    expect(saveCalls()[0]?.[1]).toMatchObject({ p_expected_revision: 4 });
  });

  it("ignora a resposta de uma gravação antiga se uma gravação mais nova detectou conflito", async () => {
    const remoteState = createEmptyFinanceState();
    mocks.maybeSingle.mockResolvedValue({ data: { data: remoteState, revision: 1 }, error: null });
    let resolveFirst: ((value: ReturnType<typeof savedResponse>) => void) | undefined;
    let saveIndex = 0;
    mocks.rpc.mockImplementation((procedure: string) => {
      if (procedure === "ensure_user_workspace")
        return Promise.resolve({ data: "workspace-test", error: null });
      saveIndex++;
      if (saveIndex === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({
        data: [{ saved: false, revision: 2, data: remoteState }],
        error: null,
      });
    });

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("synced"));
    fireEvent.click(screen.getByRole("button", { name: "Editar estado local" }));
    await waitFor(() => expect(saveCalls()).toHaveLength(1), { timeout: 1500 });
    fireEvent.click(screen.getByRole("button", { name: "Editar estado local" }));
    await waitFor(() => expect(saveCalls()).toHaveLength(2), { timeout: 1500 });
    await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("conflict"));

    await act(async () => resolveFirst?.(savedResponse(2)));
    expect(screen.getByTestId("sync-status")).toHaveTextContent("conflict");
    expect(screen.getByTestId("warn-pct")).toHaveTextContent("82");
  });
});
