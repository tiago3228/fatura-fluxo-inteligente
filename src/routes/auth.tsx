import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, EyeOff, Loader2, LogIn, UserPlus, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [
      { title: "Entrar — Fatura em Dia" },
      { name: "description", content: "Entre com seu e-mail e senha para acessar seu organizador de faturas." },
      { property: "og:title", content: "Entrar — Fatura em Dia" },
      { property: "og:description", content: "Acesse seu organizador de faturas de cartão." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

const friendlyError = (message: string) => {
  if (/invalid login credentials/i.test(message)) return "E-mail ou senha incorretos.";
  if (/user already registered/i.test(message)) return "Este e-mail já tem conta. Tente entrar.";
  if (/known to be weak|easy to guess/i.test(message)) return "Essa senha é muito fácil de adivinhar. Escolha uma senha mais forte.";
  if (/password.*at least|should be at least/i.test(message)) return "A senha deve ter pelo menos 6 caracteres.";
  if (/valid email|unable to validate/i.test(message)) return "Informe um e-mail válido.";
  if (/rate limit|email rate/i.test(message)) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  return "Não foi possível continuar. Verifique os dados e tente novamente.";
};

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"entrar" | "criar">("entrar");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (mode === "entrar") {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) {
          setError(friendlyError(err.message));
          return;
        }
        await navigate({ to: "/" });
      } else {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (err) {
          setError(friendlyError(err.message));
          return;
        }
        if (data.session) {
          await navigate({ to: "/" });
          return;
        }
        setCheckEmail(true);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Wallet className="size-6" />
          </span>
          <h1 className="text-xl font-bold tracking-tight">Fatura em Dia</h1>
          <p className="text-sm text-muted-foreground">Organize faturas de cartão com sua família, em qualquer dispositivo.</p>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          {checkEmail ? (
            <div className="space-y-4 text-center">
              <h2 className="text-lg font-semibold">Confirme seu e-mail</h2>
              <p className="text-sm text-muted-foreground">
                Enviamos um link de confirmação para <b>{email.trim()}</b>. Abra o link no e-mail para ativar sua conta e depois volte aqui para entrar.
              </p>
              <Button variant="outline" className="w-full" onClick={() => setCheckEmail(false)}>
                Voltar para o login
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm font-medium">
                {(["entrar", "criar"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setMode(m); setError(null); }}
                    className={`rounded-md px-3 py-1.5 transition-colors ${mode === m ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                  >
                    {m === "entrar" ? "Entrar" : "Criar conta"}
                  </button>
                ))}
              </div>
              <form onSubmit={submit} className="space-y-3">
                <div className="space-y-1.5">
                  <label htmlFor="auth-email" className="text-sm font-medium">E-mail</label>
                  <Input id="auth-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="auth-password" className="text-sm font-medium">Senha</label>
                  <div className="relative">
                    <Input id="auth-password" type={showPassword ? "text" : "password"} required autoComplete={mode === "entrar" ? "current-password" : "new-password"} minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo de 6 caracteres" className="pr-11" />
                    <button
                      type="button"
                      aria-label={showPassword ? "Esconder a senha" : "Mostrar a senha"}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                {error && <p className="text-sm font-medium text-danger">{error}</p>}
                <Button type="submit" className="w-full" disabled={pending}>
                  {pending ? <Loader2 className="size-4 animate-spin" /> : mode === "entrar" ? <LogIn className="size-4" /> : <UserPlus className="size-4" />}
                  {mode === "entrar" ? "Entrar" : "Criar minha conta"}
                </Button>
              </form>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Esqueceu a senha?{" "}
                <a href="/reset-password" className="font-medium underline underline-offset-2">Redefinir senha</a>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
