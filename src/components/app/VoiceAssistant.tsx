import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useFinance } from "@/lib/finance/store";
import { splitEqually } from "@/lib/finance/calc";
import { fmtBRL, fmtMonthLong, uid } from "@/lib/finance/format";
import { interpretVoice } from "@/lib/voice-ai.functions";
import type { VoiceAction } from "@/lib/voice-ai.functions";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Rec = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  start: () => void; stop: () => void;
};
const getRecognition = (): (new () => Rec) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function VoiceAssistant({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch } = useFinance();
  const interpret = useServerFn(interpretVoice);
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ message: string; actions: VoiceAction[] } | null>(null);
  const recRef = useRef<Rec | null>(null);
  const supported = !!getRecognition();
  const month = state.settings.month;

  const stop = () => { recRef.current?.stop(); setListening(false); };
  useEffect(() => { if (!open) { stop(); setText(""); setResult(null); } }, [open]);

  const start = () => {
    const R = getRecognition();
    if (!R) return;
    const rec = new R();
    rec.lang = "pt-BR"; rec.continuous = true; rec.interimResults = true;
    const base = text ? `${text} ` : "";
    rec.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i]?.[0]?.transcript ?? "";
      setText(base + t);
    };
    rec.onend = () => setListening(false);
    rec.onerror = (e) => { setListening(false); if (e.error === "not-allowed") toast.error("Permita o uso do microfone no navegador."); };
    recRef.current = rec; setResult(null); rec.start(); setListening(true);
  };

  const analyze = async () => {
    stop(); setLoading(true); setResult(null);
    try {
      const r = await interpret({ data: {
        text,
        people: state.people.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name })),
        cards: state.cards.filter((c) => c.active).map((c) => ({ id: c.id, name: `${c.name} ${c.issuer} ${c.last4}` })),
      } });
      setResult(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao interpretar.");
    } finally { setLoading(false); }
  };

  const personName = (id: string | null) => state.people.find((p) => p.id === id)?.name;
  const defaultCard = state.cards.find((c) => c.active) ?? state.cards[0];
  const isValid = (a: VoiceAction) => !!a.personId && !!a.amount && a.amount > 0 && (a.kind === "payment" || (!!a.description && (!!a.cardId || !!defaultCard)));
  const describe = (a: VoiceAction) => {
    const who = personName(a.personId) ?? "pessoa não encontrada";
    if (a.kind === "payment") return `Registrar que ${who} pagou ${fmtBRL(a.amount ?? 0)} em ${fmtMonthLong(month)}`;
    const n = Math.max(1, Math.round(a.installments ?? 1));
    const card = state.cards.find((c) => c.id === (a.cardId ?? defaultCard?.id));
    return `Compra "${a.description ?? "?"}" para ${who}: ${fmtBRL(a.amount ?? 0)}${n > 1 ? ` em ${n}x de ${fmtBRL((a.amount ?? 0) / n)}` : ""}${card ? ` · cartão ${card.name}` : ""}`;
  };

  const confirm = () => {
    if (!result) return;
    let done = 0;
    for (const a of result.actions) {
      if (!isValid(a)) continue;
      const amount = Math.round((a.amount ?? 0) * 100) / 100;
      if (a.kind === "payment") {
        dispatch({ type: "recordPersonPayment", payment: { id: uid("payment"), personId: a.personId!, amount, paidAt: today(), month, receiptId: uid("receipt"), receiptMonth: month } });
      } else {
        const n = Math.min(48, Math.max(1, Math.round(a.installments ?? 1)));
        dispatch({ type: "upsertPlan", plan: { id: uid("pl"), description: a.description!.trim(), cardId: a.cardId ?? defaultCard!.id, purchaseDate: today(), total: amount, amounts: splitEqually(amount, n), firstMonth: month, shares: [{ personId: a.personId!, pct: 100 }] } });
      }
      done++;
    }
    if (done) toast.success(done === 1 ? "Ação registrada" : `${done} ações registradas`);
    onClose();
  };

  const validCount = result?.actions.filter(isValid).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="size-4" /> Falar com o assistente</DialogTitle>
          <DialogDescription>
            Ex.: “Adicionar conta para Arlete: Shopee de R$ 100 dividido em 2 vezes” ou “João Cardoso pagou R$ 1.000”.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          {supported ? (
            <Button type="button" size="icon" variant={listening ? "destructive" : "default"} className="size-20 rounded-full shadow-lg"
              aria-label={listening ? "Parar de ouvir" : "Começar a falar"} onClick={listening ? stop : start}>
              {listening ? <MicOff className="size-8" /> : <Mic className="size-8" />}
            </Button>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {listening ? "Ouvindo… fale agora e toque para parar." : supported ? "Toque no microfone e fale, ou digite abaixo." : "Seu navegador não permite voz aqui; digite o pedido."}
          </p>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="O que você disse aparece aqui…" aria-label="Pedido" />
        </div>
        {result && (
          <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
            <p>{result.message}</p>
            {result.actions.length > 0 && (
              <ul className="space-y-1">
                {result.actions.map((a, i) => (
                  <li key={i} className={isValid(a) ? "font-medium" : "text-danger"}>
                    • {describe(a)}{!isValid(a) && " (incompleto, não será feito)"}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          {result && validCount > 0 ? (
            <Button type="button" onClick={confirm}>Confirmar {validCount > 1 ? `${validCount} ações` : ""}</Button>
          ) : (
            <Button type="button" onClick={analyze} disabled={loading || text.trim().length < 3}>
              {loading && <Loader2 className="size-4 animate-spin" />} Interpretar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
