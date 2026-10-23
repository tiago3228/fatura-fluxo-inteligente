import type { FinanceState } from "./types";
import type { Json } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";

const DEFAULT_WORKSPACE_NAME = "Fatura da família";

/** Garante que o usuário autenticado tenha um workspace; cria um na primeira vez. */
export async function ensureWorkspace(): Promise<string | null> {
  const { data: members, error } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .limit(1);
  if (error) return null;
  const existing = members?.[0]?.workspace_id;
  if (existing) return existing as string;

  const { data, error: rpcError } = await supabase.rpc("create_workspace", {
    p_name: DEFAULT_WORKSPACE_NAME,
  });
  if (rpcError) return null;
  return typeof data === "string" ? data : null;
}

/** Carrega o estado completo do aplicativo salvo na nuvem (documento por workspace). */
export async function loadCloudState(workspaceId: string): Promise<FinanceState | null> {
  const { data, error } = await supabase
    .from("workspace_state")
    .select("data")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !data) return null;
  const parsed = (data as unknown as { data: unknown }).data;
  return parsed && typeof parsed === "object" ? (parsed as FinanceState) : null;
}

/** Salva o estado completo do aplicativo na nuvem (última versão vence). */
export async function saveCloudState(workspaceId: string, state: FinanceState): Promise<boolean> {
  const { error } = await supabase
    .from("workspace_state")
    .upsert({ workspace_id: workspaceId, data: state as unknown as Json });
  if (error) console.error("Falha ao salvar na nuvem", error);
  return !error;
}
