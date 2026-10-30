import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CEU_APP_URL = "https://ceu-financas.lovable.app";

export const createCeuSsoLink = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const claims = context.claims as Record<string, unknown>;
    const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
    if (!email) throw new Error("A sessão atual não possui um e-mail válido.");

    const ceuUrl = process.env["CEU_SUPABASE_URL"];
    const ceuServiceRoleKey = process.env["CEU_SUPABASE_SERVICE_ROLE_KEY"];
    if (!ceuUrl || !ceuServiceRoleKey) {
      throw new Error("O SSO do CEU Finanças ainda não foi configurado no ambiente.");
    }

    const ceuAdmin = createClient(ceuUrl, ceuServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: users, error: usersError } = await ceuAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (usersError || !users.users.some((user) => user.email?.toLowerCase() === email)) {
      throw new Error("A conta ainda não está cadastrada no CEU Finanças.");
    }

    const { data, error } = await ceuAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `${CEU_APP_URL}/auth/sso` },
    });
    if (error || !data?.properties?.action_link) {
      console.error("[CEU SSO] Não foi possível gerar o link temporário", error);
      throw new Error("Não foi possível preparar o acesso ao CEU Finanças.");
    }

    return { url: data.properties.action_link };
  });
