import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
  realtimeCallback: undefined as
    ((payload: { new?: { data?: unknown } | null }) => void) | undefined,
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

import { createDemoState } from "@/lib/finance/mock";
import { FinanceProvider, useFinance } from "@/lib/finance/store";

function SyncStatusProbe() {
  const { syncStatus, state, dispatch } = useFinance();
  return (
    <>
      <output data-testid="sync-status">{syncStatus}</output>
      <output data-testid="warn-pct">{state.settings.warnPct}</output>
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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.getSession.mockResolvedValue({
    data: { session: { user: { id: "user-test" } } },
    error: null,
  });
  mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  mocks.rpc.mockResolvedValue({ data: "workspace-test", error: null });
  mocks.from.mockImplementation(() => ({
    select: () => ({
      eq: () => ({ maybeSingle: mocks.maybeSingle }),
    }),
    upsert: mocks.upsert,
  }));
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  channel.on.mockImplementation((_event, _filter, callback) => {
    mocks.realtimeCallback = callback;
    return channel;
  });
  channel.subscribe.mockReturnValue(channel);
  mocks.channel.mockReturnValue(channel);
  mocks.removeChannel.mockResolvedValue(undefined);
  mocks.upsert.mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
});

describe("FinanceProvider cloud bootstrap", () => {
  it("não publica estado local quando a leitura remota falha", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: "temporary read failure" },
    });

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("error"));

    expect(mocks.upsert).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("semeia o estado local somente quando a leitura confirma ausência", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("synced"));

    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });

  it("pausa o envio e preserva o estado local diante de conflito remoto durante gravação", async () => {
    const remoteState = createDemoState();
    const conflictingRemote = {
      ...remoteState,
      settings: { ...remoteState.settings, warnPct: 42 },
    };
    mocks.maybeSingle.mockResolvedValue({ data: { data: remoteState }, error: null });

    let resolveSave: ((value: { error: null }) => void) | undefined;
    mocks.upsert.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("synced"));
    const initialWarnPct = Number(screen.getByTestId("warn-pct").textContent);
    fireEvent.click(screen.getByRole("button", { name: "Editar estado local" }));

    await waitFor(() => expect(mocks.upsert).toHaveBeenCalledTimes(1));
    expect(mocks.realtimeCallback).toBeDefined();
    act(() => mocks.realtimeCallback?.({ new: { data: conflictingRemote } }));

    await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("conflict"));
    expect(screen.getByTestId("warn-pct")).toHaveTextContent(String(initialWarnPct + 1));

    await act(async () => resolveSave?.({ error: null }));
    await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("conflict"));
    expect(screen.getByTestId("warn-pct")).toHaveTextContent(String(initialWarnPct + 1));
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });
});
