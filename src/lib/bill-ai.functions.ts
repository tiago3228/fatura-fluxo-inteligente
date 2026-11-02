import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { analyzeBillText } from "./bill-ai.server";

export const analyzeBill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { text: string }) => {
    const text = String(input?.text ?? "").trim();
    if (text.length < 5) throw new Error("Informe os dados da fatura.");
    return { text };
  })
  .handler(async ({ data }) => analyzeBillText(data.text));
