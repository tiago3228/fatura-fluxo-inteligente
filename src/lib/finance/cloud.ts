import type { FinanceState } from "./types";
import type { Json } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";

/** Entra no espaço compartilhado da família (o mesmo para todas as contas). */
export async function ensureWorkspace(): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc("join_family_workspace");
    if (error) {
      console.error("Falha ao entrar no espaço da família", error);
      return null;
    }
    return typeof data === "string" ? data : null;
  } catch (error) {
    console.error("Falha ao entrar no espaço da família", error);
    return null;
  }
}

export type CloudStateLoadResult =
  { kind: "loaded"; state: FinanceState } | { kind: "missing" } | { kind: "error" };

/** Carrega o estado completo do aplicativo salvo na nuvem (documento por workspace). */
export async function loadCloudState(workspaceId: string): Promise<CloudStateLoadResult> {
  try {
    const { data, error } = await supabase
      .from("workspace_state")
      .select("data")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) {
      console.error("Falha ao carregar o estado da nuvem", error);
      return { kind: "error" };
    }
    if (!data) return { kind: "missing" };
    const parsed = (data as unknown as { data: unknown }).data;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.error("O estado salvo na nuvem tem formato inválido");
      return { kind: "error" };
    }
    return { kind: "loaded", state: parsed as FinanceState };
  } catch (error) {
    console.error("Falha ao carregar o estado da nuvem", error);
    return { kind: "error" };
  }
}

/** Salva o estado completo do aplicativo na nuvem (documento por workspace). */
export async function saveCloudState(workspaceId: string, state: FinanceState): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("workspace_state")
      .upsert({ workspace_id: workspaceId, data: state as unknown as Json });
    if (error) console.error("Falha ao salvar na nuvem", error);
    return !error;
  } catch (error) {
    console.error("Falha ao salvar na nuvem", error);
    return false;
  }
}
