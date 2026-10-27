import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Volume2, VolumeX } from "lucide-react";
import { useFinance } from "@/lib/finance/store";
import { personMonthTotal } from "@/lib/finance/calc";
import { fmtBRL, fmtMonthLong, round2 } from "@/lib/finance/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ALERT_THRESHOLD = 90;
const DISMISSED_ALERTS_KEY = "fatura-fluxo-dismissed-person-limit-alerts";

interface LimitAlertCandidate {
  key: string;
  level: 90 | 100;
  personName: string;
  month: string;
  total: number;
  limit: number;
  remaining: number;
  percent: number;
  rawPercent: number;
}

const spokenMessage = (candidate: LimitAlertCandidate) =>
  candidate.level === 100
    ? "Você está no sal. Gastou todo seu limite."
    : `Tá gastando demais. Você já usou ${candidate.percent} por cento do limite mensal.`;

export function PersonLimitAlert() {
  const { state, syncStatus } = useFinance();
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = window.sessionStorage.getItem(DISMISSED_ALERTS_KEY);
      const parsed: unknown = stored ? JSON.parse(stored) : [];
      return new Set(
        Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [],
      );
    } catch {
      return new Set();
    }
  });
  const [ready, setReady] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceUnavailable, setVoiceUnavailable] = useState(false);
  const lastSpokenKey = useRef<string | null>(null);
  const month = state.settings.month;

  useEffect(() => setReady(true), []);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
    const SpeechUtterance = window.SpeechSynthesisUtterance;
    if (!SpeechUtterance) return false;
    const synthesis = window.speechSynthesis;
    const utterance = new SpeechUtterance(text);
    utterance.lang = "pt-BR";
    utterance.rate = 0.96;
    const localPortugueseVoice = synthesis
      .getVoices()
      .find((voice) => voice.localService && voice.lang.toLowerCase().startsWith("pt"));
    if (!localPortugueseVoice) return false;
    utterance.voice = localPortugueseVoice;
    synthesis.cancel();
    synthesis.speak(utterance);
    return true;
  }, []);

  const candidates: LimitAlertCandidate[] =
    syncStatus === "loading"
      ? []
      : state.people
          .filter((person) => person.active && person.limit > 0)
          .map((person) => {
            const total = personMonthTotal(state, person.id, month);
            const percent = (total / person.limit) * 100;
            const level: 90 | 100 = total >= person.limit ? 100 : 90;
            return {
              key: `${month}:${person.id}:${level}`,
              level,
              personName: person.name,
              month,
              total,
              limit: person.limit,
              remaining: Math.max(0, round2(person.limit - total)),
              percent: Math.round(percent),
              rawPercent: percent,
            };
          })
          .filter((candidate) => candidate.rawPercent >= ALERT_THRESHOLD)
          .sort((a, b) => b.rawPercent - a.rawPercent);

  const current = candidates.find((candidate) => !dismissedKeys.has(candidate.key));

  useEffect(() => {
    if (!current || !voiceEnabled || lastSpokenKey.current === current.key) return;
    lastSpokenKey.current = current.key;
    if (!speak(spokenMessage(current))) {
      setVoiceEnabled(false);
      setVoiceUnavailable(true);
    }
  }, [current, speak, voiceEnabled]);

  const dismiss = () => {
    if (!current) return;
    setDismissedKeys((previous) => {
      const next = new Set(previous).add(current.key);
      try {
        window.sessionStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify([...next]));
      } catch {
        // Se o navegador bloquear o armazenamento, o fechamento continua válido nesta montagem.
      }
      return next;
    });
  };

  const toggleVoice = () => {
    if (voiceEnabled) {
      if (typeof window !== "undefined" && "speechSynthesis" in window)
        window.speechSynthesis.cancel();
      setVoiceEnabled(false);
      return;
    }
    if (!current) return;
    if (speak(spokenMessage(current))) {
      lastSpokenKey.current = current.key;
      setVoiceUnavailable(false);
      setVoiceEnabled(true);
    } else {
      setVoiceUnavailable(true);
    }
  };

  return (
    <Dialog open={ready && !!current} onOpenChange={(open) => !open && dismiss()}>
      <DialogContent className="z-[80] max-w-md">
        <DialogHeader>
          <div className="mb-2 grid size-10 place-items-center rounded-full bg-warning-soft text-warning">
            <AlertTriangle className="size-5" aria-hidden="true" />
          </div>
          <DialogTitle>
            {current?.level === 100
              ? "Você está no sal, gastou todo seu limite"
              : `Tá gastando demais, ${current?.personName.split(" ")[0]}?`}
          </DialogTitle>
          <DialogDescription>
            {current?.level === 100 ? (
              <>
                {current.total > current.limit
                  ? `O limite mensal de ${fmtBRL(current.limit)} foi ultrapassado em ${fmtBRL(round2(current.total - current.limit))}.`
                  : `Você atingiu 100% do limite mensal de ${fmtBRL(current.limit)}.`}{" "}
                Competência: {fmtMonthLong(current.month)}.
              </>
            ) : (
              <>
                Você já usou {current?.percent}% do limite mensal de {fmtBRL(current?.limit ?? 0)}{" "}
                em {current ? fmtMonthLong(current.month) : ""}. Restam{" "}
                {fmtBRL(current?.remaining ?? 0)} para chegar ao limite.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {voiceUnavailable && (
            <p className="mr-auto self-center text-xs text-muted-foreground">
              Voz em português indisponível neste dispositivo; o aviso visual continuará
              funcionando.
            </p>
          )}
          <Button type="button" variant="outline" onClick={toggleVoice} aria-pressed={voiceEnabled}>
            {voiceEnabled ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
            {voiceEnabled ? "Desativar voz" : "Ativar voz"}
          </Button>
          <Button type="button" onClick={dismiss}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
