import { createServerFn } from "@tanstack/react-start";
import { createHmac, randomUUID } from "node:crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CEU_SSO_URL = "https://ceu-financas.lovable.app/api/public/sso/link";

export const createCeuSsoLink = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const claims = context.claims as Record<string, unknown>;
    const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
    if (!email) throw new Error("A sessão atual não possui um e-mail válido.");

    const sharedSecret = process.env["CEU_SSO_SHARED_SECRET"];
    if (!sharedSecret) {
      throw new Error("O SSO do CEU Finanças ainda não foi configurado no ambiente.");
    }

    const body = JSON.stringify({ email });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomUUID().replaceAll("-", "");
    const signature = createHmac("sha256", sharedSecret)
      .update(`${timestamp}.${nonce}.${body}`)
      .digest("hex");
    const response = await fetch(CEU_SSO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CEU-Timestamp": timestamp,
        "X-CEU-Nonce": nonce,
        "X-CEU-Signature": signature,
      },
      body,
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("A conta ainda não está cadastrada no CEU Finanças.");
      }
      if (response.status === 503) {
        throw new Error("O SSO do CEU Finanças ainda não foi configurado.");
      }
      throw new Error("Não foi possível preparar o acesso ao CEU Finanças.");
    }

    const result = (await response.json()) as { url?: unknown };
    if (
      typeof result.url !== "string" ||
      !result.url.startsWith("https://ceu-financas.lovable.app/")
    ) {
      throw new Error("O CEU Finanças retornou um link de acesso inválido.");
    }
    return { url: result.url };
  });
