import type { FinanceState } from "./types";
import type { Json } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";

export type WorkspaceResult = { workspaceId: string } | { workspaceId: null; error: string };

function errorMessage(error: unknown): string {
  const value = error as { code?: string; message?: string; status?: number } | null;
  const code = value?.code ?? "";
  const message = value?.message ?? "Falha de comunicação com Supabase.";
  if (code === "PGRST202" || code === "42883" || /function .* does not exist/i.test(message)) {
    return "A RPC de sincronização não existe neste banco. Aplique a migration 0005 antes de habilitar a sincronização.";
  }
  if (code === "42501" || value?.status === 401 || /permission|not authorized|unauthorized/i.test(message)) {
    return "Permissão negada ao acessar o workspace. Aplique a migration 0005 e confirme os grants de workspace_state; RLS permanece ativo.";
  }
  return message;
}

/** Garante um workspace privado para o usuário autenticado (membros explícitos continuam juntos). */
export async function ensureWorkspace(): Promise<WorkspaceResult> {
  try {
    const { data, error } = await supabase.rpc("ensure_user_workspace");
    if (error) return { workspaceId: null, error: errorMessage(error) };
    return typeof data === "string"
      ? { workspaceId: data }
      : { workspaceId: null, error: "Supabase não retornou um identificador de workspace válido." };
  } catch (error) {
    return { workspaceId: null, error: errorMessage(error) };
  }
}

export type CloudStateLoadResult =
  | { kind: "loaded"; state: FinanceState; revision: number }
  | { kind: "missing"; revision: 0 }
  | { kind: "error"; message: string };

/** Carrega o estado completo e sua revisão de controle de concorrência. */
export async function loadCloudState(workspaceId: string): Promise<CloudStateLoadResult> {
  try {
    const { data, error } = await supabase
      .from("workspace_state")
      .select("data, revision")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) return { kind: "error", message: errorMessage(error) };
    if (!data) return { kind: "missing", revision: 0 };
    const parsed = data.data as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { kind: "error", message: "O estado salvo na nuvem tem formato inválido." };
    }
    const revision = Number(data.revision);
    if (!Number.isInteger(revision) || revision < 0) {
      return { kind: "error", message: "A revisão salva na nuvem é inválida; aplique a migration 0005." };
    }
    return { kind: "loaded", state: parsed as FinanceState, revision };
  } catch (error) {
    return { kind: "error", message: errorMessage(error) };
  }
}

export type CloudStateSaveResult =
  | { kind: "saved"; revision: number }
  | { kind: "conflict"; revision: number; state: FinanceState }
  | { kind: "error"; message: string };

/** Grava por Compare-and-Swap; nunca sobrescreve uma revisão remota mais nova. */
export async function saveCloudState(
  workspaceId: string,
  state: FinanceState,
  expectedRevision: number,
): Promise<CloudStateSaveResult> {
  try {
    const { data, error } = await supabase.rpc("save_workspace_state", {
      p_workspace_id: workspaceId,
      p_expected_revision: expectedRevision,
      p_data: state as unknown as Json,
    });
    if (error) return { kind: "error", message: errorMessage(error) };
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.revision !== "number") {
      return { kind: "error", message: "Supabase retornou uma resposta CAS inválida." };
    }
    if (row.saved) return { kind: "saved", revision: row.revision };
    const remote = row.data as unknown;
    if (!remote || typeof remote !== "object" || Array.isArray(remote)) {
      return { kind: "error", message: "A revisão mudou, mas o estado remoto recebido é inválido." };
    }
    return { kind: "conflict", revision: row.revision, state: remote as FinanceState };
  } catch (error) {
    return { kind: "error", message: errorMessage(error) };
  }
}
