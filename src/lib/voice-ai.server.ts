import { createOpenAI } from "@ai-sdk/openai";
import { NoObjectGeneratedError, Output, streamText } from "ai";
import { z } from "zod";

const actionSchema = z.object({
  kind: z.enum(["purchase", "payment"]),
  personId: z.string().nullable(),
  description: z.string().nullable(),
  amount: z.number().nullable(),
  installments: z.number().nullable(),
  cardId: z.string().nullable(),
});

const schema = z.object({
  actions: z.array(actionSchema),
  message: z.string(),
});

export type VoiceAction = z.infer<typeof actionSchema>;
export type VoiceInterpretation = z.infer<typeof schema>;

export type VoiceContext = {
  people: { id: string; name: string }[];
  cards: { id: string; name: string }[];
};

export async function interpretVoiceCommand(
  text: string,
  ctx: VoiceContext,
): Promise<VoiceInterpretation> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("IA não configurada.");
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });
  const system = `Você interpreta comandos falados (pt-BR) de um app familiar que organiza faturas de cartão.
Ações possíveis:
- "purchase": adicionar uma compra/conta para uma pessoa. Ex.: "adicionar conta para Arlete: Shopee no valor de R$100 dividido em 2 vezes" → personId da Arlete, description "Shopee", amount 100 (valor TOTAL), installments 2. Se disser "2 parcelas de 50", amount = 100. Sem parcelamento → installments 1.
- "payment": a pessoa pagou um valor da parte dela na fatura. Ex.: "adicionar valor de R$1000 para João Cardoso", "João pagou 1000" → personId do João, amount 1000.
Regras:
- Use SOMENTE ids da lista. Associe nomes por semelhança (apelidos, erros de transcrição, sobrenome). Se não houver pessoa compatível, personId = null.
- cardId só se o cartão for citado; senão null.
- Um comando pode ter várias ações.
- Valores em reais como número (ex.: 1250.5). "mil" = 1000.
- Em "message", explique em pt-BR, em 1-2 frases curtas, o que será feito, ou o que faltou entender.
Pessoas: ${JSON.stringify(ctx.people)}
Cartões: ${JSON.stringify(ctx.cards)}`;
  const result = streamText({
    model: provider.responses("openai/gpt-6-astra"),
    system,
    messages: [{ role: "user", content: text.slice(0, 2000) }],
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
    const out = await result.output;
    const peopleIds = new Set(ctx.people.map((p) => p.id));
    const cardIds = new Set(ctx.cards.map((c) => c.id));
    return {
      message: out.message,
      actions: out.actions.map((a) => ({
        ...a,
        personId: a.personId && peopleIds.has(a.personId) ? a.personId : null,
        cardId: a.cardId && cardIds.has(a.cardId) ? a.cardId : null,
      })),
    };
  } catch (e) {
    if (NoObjectGeneratedError.isInstance(e)) throw new Error("Não entendi o pedido. Tente falar de novo.");
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 402) throw new Error("Créditos de IA esgotados. Adicione créditos para continuar.");
    if (status === 429) throw new Error("Muitas solicitações agora. Tente de novo em instantes.");
    console.error("voice-ai", e);
    throw new Error("Falha ao interpretar o comando.");
  }
}
