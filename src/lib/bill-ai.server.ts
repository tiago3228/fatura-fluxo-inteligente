import { createOpenAI } from "@ai-sdk/openai";
import { NoObjectGeneratedError, Output, streamText } from "ai";
import { z } from "zod";

const schema = z.object({
  supplier: z.string().nullable(),
  amount: z.number().nullable(),
  dueDate: z.string().nullable(),
  summary: z.string(),
});

export type BillAnalysis = z.infer<typeof schema>;

export async function analyzeBillText(text: string): Promise<BillAnalysis> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("IA não configurada.");
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });
  const result = streamText({
    model: provider.responses("openai/gpt-6-astra"),
    system:
      "Você lê dados de faturas/boletos em português do Brasil. Identifique o fornecedor (quem cobra), o valor total a pagar em reais (número, ex.: 152.37), e a data de vencimento no formato AAAA-MM-DD. Use null quando não encontrar. Em 'summary', escreva em pt-BR, em até 3 frases curtas, o que precisa ser pago, quanto e até quando, mencionando juros ou valor mínimo se houver.",
    messages: [{ role: "user", content: text.slice(0, 20000) }],
    output: Output.object({ schema }),
    maxRetries: 0,
    providerOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    },
  });
  try {
    return await result.output;
  } catch (e) {
    if (NoObjectGeneratedError.isInstance(e)) throw new Error("Não consegui interpretar a fatura. Revise o texto.");
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 402) throw new Error("Créditos de IA esgotados. Adicione créditos para continuar.");
    if (status === 429) throw new Error("Muitas solicitações agora. Tente de novo em instantes.");
    console.error("bill-ai", e);
    throw new Error("Falha ao analisar a fatura.");
  }
}
