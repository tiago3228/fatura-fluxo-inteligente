import { createServerFn } from "@tanstack/react-start";
import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CEU_SSO_URL = "https://ceu-financas.lovable.app/api/public/sso/link";

const billSchema = z.object({
  id: z.string().min(1).max(200),
  description: z.string().min(1).max(300),
  amount: z.number().finite().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const inputSchema = z.object({ bill: billSchema.optional() }).optional();

export const createCeuSsoLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ context, data }) => {
    const claims = context.claims as Record<string, unknown>;
    const email = typeof claims["email"] === "string" ? claims["email"].trim().toLowerCase() : "";
    if (!email) throw new Error("A sessão atual não possui um e-mail válido.");

    const sharedSecret = process.env["CEU_SSO_SHARED_SECRET"];
    if (!sharedSecret) {
      throw new Error("O SSO do CEU Finanças ainda não foi configurado no ambiente.");
    }

    const bill = data?.bill;
    const payload = bill
      ? { email, bill: { ...bill, amount: Math.round(bill.amount * 100) / 100 } }
      : { email };
    const body = JSON.stringify(payload);
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

    const result = (await response.json()) as { url?: unknown; bill?: unknown };
    if (
      typeof result.url !== "string" ||
      !result.url.startsWith("https://ceu-financas.lovable.app/")
    ) {
      throw new Error("O CEU Finanças retornou um link de acesso inválido.");
    }
    const billStatus =
      result.bill === "created" || result.bill === "duplicate" ? result.bill : null;
    return { url: result.url, bill: billStatus };
  });
