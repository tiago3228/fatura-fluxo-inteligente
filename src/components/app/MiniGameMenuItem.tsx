import { useCallback, useEffect, useRef, useState } from "react";
import { Gamepad2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import gameHtml from "@/assets/minigame-bandeiras.html?raw";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

const embeddedGameHtml = gameHtml.replace(
  "</head>",
  `<style>
    html, body { height: 100%; min-height: 100%; overflow: hidden; }
    .shell { display: none !important; }
    .overlay, .overlay.hidden {
      position: static; inset: auto; z-index: auto; display: grid !important;
      place-items: stretch; padding: 0; background: transparent; backdrop-filter: none;
    }
    .modal { width: 100%; max-height: 100%; overflow: auto; border: 0; border-radius: 0; box-shadow: none; }
    .panel-inner { padding: 16px; }
    @media (max-width: 620px) { .panel-inner { padding: 14px 12px; } .section { margin-top: 14px; padding: 10px; } }
  </style></head>`,
);

type GameResult = {
  score: number;
  correct_answers: number;
  wrong_answers: number;
  timed_mode: boolean;
  mode: "free" | "timed" | "challenge";
  duration_seconds: number;
};

type GameMessage = { type: "minigame:closed" } | { type: "minigame:finished"; result: GameResult };

export function MiniGameMenuItem() {
  const [open, setOpen] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const closeFallbackRef = useRef<number | null>(null);

  const refreshRanking = useCallback(async () => {
    const { data, error } = await supabase
      .from("minigame_scores")
      .select(
        "id, display_name, score, correct_answers, wrong_answers, timed_mode, mode, duration_seconds, created_at",
      )
      .order("score", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(10);

    frameRef.current?.contentWindow?.postMessage(
      {
        type: "minigame:ranking",
        available: !error,
        ranking: error ? [] : data,
      },
      "*",
    );
  }, []);

  const saveScore = useCallback(
    async (result: GameResult) => {
      if (
        !Number.isInteger(result.score) ||
        !Number.isInteger(result.correct_answers) ||
        !Number.isInteger(result.wrong_answers) ||
        !Number.isInteger(result.duration_seconds) ||
        result.correct_answers + result.wrong_answers < 1
      ) {
        return;
      }

      const { data, error: authError } = await supabase.auth.getUser();
      if (authError || !data.user) {
        toast.error("Não foi possível identificar sua conta para salvar a pontuação.");
        return;
      }

      const metadata = data.user.user_metadata ?? {};
      const displayName =
        [metadata["full_name"], metadata["name"], data.user.email?.split("@")[0]]
          .find((value) => typeof value === "string" && value.trim())
          ?.trim() ?? "Jogador";
      const { error } = await supabase.from("minigame_scores").insert({
        user_id: data.user.id,
        display_name: displayName,
        score: result.score,
        correct_answers: result.correct_answers,
        wrong_answers: result.wrong_answers,
        timed_mode: result.timed_mode,
        mode: result.mode,
        duration_seconds: result.duration_seconds,
      });

      if (error) {
        console.error("[Minigame] Não foi possível salvar no ranking global", error);
        toast.error(
          "A pontuação ficou salva neste navegador, mas o ranking global não está disponível.",
          {
            description: "A migração do ranking pode ainda não ter sido aplicada no banco.",
          },
        );
        return;
      }

      toast.success("Pontuação salva no ranking global.");
      await refreshRanking();
    },
    [refreshRanking],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent<GameMessage>) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const message = event.data;
      if (!message || typeof message !== "object") return;

      if (message.type === "minigame:finished") {
        void saveScore(message.result);
      } else if (message.type === "minigame:closed") {
        if (closeFallbackRef.current !== null) {
          window.clearTimeout(closeFallbackRef.current);
          closeFallbackRef.current = null;
        }
        setOpen(false);
      }
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (closeFallbackRef.current !== null) window.clearTimeout(closeFallbackRef.current);
    };
  }, [refreshRanking, saveScore]);

  const requestClose = () => {
    const frameWindow = frameRef.current?.contentWindow;
    if (!frameWindow) {
      setOpen(false);
      return;
    }
    frameWindow.postMessage({ type: "minigame:host-close" }, "*");
    if (closeFallbackRef.current !== null) window.clearTimeout(closeFallbackRef.current);
    closeFallbackRef.current = window.setTimeout(() => setOpen(false), 500);
  };

  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton asChild tooltip="Minigame">
          <button type="button" onClick={() => setOpen(true)} aria-label="Abrir Minigame">
            <Gamepad2 />
            <span>Minigame</span>
          </button>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) setOpen(true);
          else requestClose();
        }}
      >
        <DialogContent className="flex h-[90vh] max-h-[92dvh] w-[calc(100vw-1rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0 [&>button]:hidden sm:w-[calc(100vw-2rem)]">
          <DialogHeader className="sr-only">
            <DialogTitle>Minigame — Adivinhe as bandeiras</DialogTitle>
            <DialogDescription>
              Jogo de perguntas e respostas sobre bandeiras de países.
            </DialogDescription>
          </DialogHeader>
          <iframe
            ref={frameRef}
            title="Minigame — Adivinhe as bandeiras"
            srcDoc={embeddedGameHtml}
            onLoad={() => void refreshRanking()}
            className="min-h-0 w-full flex-1 border-0 bg-[#080b16]"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
