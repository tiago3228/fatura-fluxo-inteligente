import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  beforeLoad: async () => {
    // Sem fluxo de recuperação em andamento, a página não faz sentido.
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/auth" });
  },
  head: () => ({
    meta: [
      { title: "Redefinir senha — Fatura em Dia" },
      { name: "description", content: "Defina uma nova senha para sua conta do organizador de faturas." },
      { property: "og:title", content: "Redefinir senha — Fatura em Dia" },
      { property: "og:description", content: "Defina uma nova senha para sua conta." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const isRecovery = typeof window !== "undefined" && window.location.hash.includes("type=recovery");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (!isRecovery) return;
    // Garante que a sessão de recuperação (vinda no hash) fique estabelecida.
    void supabase.auth.getSession();
  }, [isRecovery]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }
    setPending(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) {
        setError("Não foi possível alterar a senha. Tente novamente.");
        return;
      }
      setDone(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          {done ? (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="mx-auto size-10 text-success" />
              <h1 className="text-lg font-semibold">Senha alterada</h1>
              <p className="text-sm text-muted-foreground">Sua nova senha já está ativa. Use-a para entrar.</p>
              <Button asChild className="w-full"><Link to="/auth">Ir para o login</Link></Button>
            </div>
          ) : (
            <>
              <h1 className="mb-1 text-lg font-semibold">Definir nova senha</h1>
              <p className="mb-4 text-sm text-muted-foreground">Escolha uma nova senha para sua conta.</p>
              <form onSubmit={submit} className="space-y-3">
                <div className="space-y-1.5">
                  <label htmlFor="new-password" className="text-sm font-medium">Nova senha</label>
                  <div className="relative">
                    <Input id="new-password" type={showNew ? "text" : "password"} required autoComplete="new-password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo de 6 caracteres" className="pr-11" />
                    <button
                      type="button"
                      aria-label={showNew ? "Esconder a senha" : "Mostrar a senha"}
                      aria-pressed={showNew}
                      onClick={() => setShowNew((v) => !v)}
                      className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="confirm-password" className="text-sm font-medium">Confirmar nova senha</label>
                  <div className="relative">
                    <Input id="confirm-password" type={showConfirm ? "text" : "password"} required autoComplete="new-password" minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} className="pr-11" />
                    <button
                      type="button"
                      aria-label={showConfirm ? "Esconder a confirmação" : "Mostrar a confirmação"}
                      aria-pressed={showConfirm}
                      onClick={() => setShowConfirm((v) => !v)}
                      className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                {error && <p className="text-sm font-medium text-danger">{error}</p>}
                <Button type="submit" className="w-full" disabled={pending}>
                  {pending && <Loader2 className="size-4 animate-spin" />} Salvar nova senha
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
