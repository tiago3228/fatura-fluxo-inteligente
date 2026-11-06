import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { interpretVoiceCommand, type VoiceContext } from "./voice-ai.server";

const list = (v: unknown) =>
  (Array.isArray(v) ? v : [])
    .slice(0, 200)
    .map((x) => ({ id: String((x as { id?: unknown })?.id ?? ""), name: String((x as { name?: unknown })?.name ?? "").slice(0, 80) }))
    .filter((x) => x.id && x.name);

export const interpretVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { text: string } & VoiceContext) => {
    const text = String(input?.text ?? "").trim();
    if (text.length < 3) throw new Error("Fale ou digite o que deseja fazer.");
    return { text, people: list(input?.people), cards: list(input?.cards) };
  })
  .handler(async ({ data }) =>
    interpretVoiceCommand(data.text, { people: data.people, cards: data.cards }),
  );
export type { VoiceAction } from "./voice-ai.server";
