import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertCircle,
  Bell,
  BookOpen,
  Calculator,
  CalendarClock,
  CheckCircle2,
  CloudOff,
  CreditCard,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  Loader2,
  LogOut,
  Moon,
  Redo2,
  Settings,
  Share2,
  ShoppingBag,
  Sun,
  Undo2,
  Users,
  Wallet,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAlerts } from "@/lib/finance/alerts";
import { useFinance } from "@/lib/finance/store";
import { toast } from "sonner";
import { DemoTag } from "./common";
import { TxActionsProvider } from "./tx-actions";
import { FloatingCalculator } from "./FloatingCalculator";
import { PersonLimitAlert } from "./PersonLimitAlert";
import { cn } from "@/lib/utils";
import { createCeuSsoLink } from "@/lib/ceu-sso.functions";

const NAV = [
  { title: "Visão geral", url: "/", icon: LayoutDashboard },
  { title: "Faturas", url: "/faturas", icon: FileText },
  { title: "Compras", url: "/compras", icon: ShoppingBag },
  { title: "Pessoas", url: "/pessoas", icon: Users },
  { title: "Cartões", url: "/cartoes", icon: CreditCard },
  { title: "Parcelamentos", url: "/parcelamentos", icon: CalendarClock },
  { title: "Calculadora", url: "/calculadora", icon: Calculator },
  { title: "Relatórios", url: "/relatorios", icon: FileSpreadsheet },
  { title: "Enviar conta", url: "/enviar-conta", icon: Share2 },
  { title: "Planilhas", url: "/planilhas", icon: FileSpreadsheet },
  { title: "Como Funciona", url: "/como-funciona", icon: BookOpen },
  { title: "Configurações", url: "/configuracoes", icon: Settings },
] as const;

const THEME_STORAGE_KEY = "fatura-em-dia-theme";

function AppSidebar() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (u: string) => (u === "/" ? path === "/" : path.startsWith(u));
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1 py-1.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Wallet className="size-4" />
          </span>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-bold text-sidebar-accent-foreground">
              Fatura em Dia
            </p>
            <p className="truncate text-xs opacity-70">Organizador de cartões</p>
          </div>
          <SidebarTrigger
            aria-label="Recolher menu lateral"
            title="Recolher menu lateral"
            className="ml-auto group-data-[collapsible=icon]:hidden"
          />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((n) => (
                <SidebarMenuItem key={n.url}>
                  <SidebarMenuButton asChild isActive={isActive(n.url)} tooltip={n.title}>
                    <Link to={n.url}>
                      <n.icon />
                      <span>{n.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              <CeuFinancasMenuItem />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <p className="px-2 pb-1 text-[11px] leading-snug opacity-60 group-data-[collapsible=icon]:hidden">
          Dados salvos na sua conta e sincronizados entre dispositivos.
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}

function CeuFinancasMenuItem() {
  const createLink = useServerFn(createCeuSsoLink);
  const [loading, setLoading] = useState(false);

  const openCeu = async () => {
    setLoading(true);
    const popup = window.open("about:blank", "_blank", "noopener,noreferrer");
    try {
      const { url } = await createLink();
      if (popup) popup.location.href = url;
      else window.location.assign(url);
    } catch (error) {
      popup?.close();
      console.error("[CEU SSO] Falha ao abrir o CEU Finanças", error);
      toast.error("Não foi possível abrir o CEU Finanças", {
        description: "Verifique se o SSO já foi configurado no ambiente.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip="Abrir CEU Finanças já conectado com sua conta">
        <button
          type="button"
          onClick={() => void openCeu()}
          disabled={loading}
          aria-label="Abrir CEU Finanças"
        >
          <ExternalLink />
          <span>{loading ? "Abrindo CEU..." : "CEU Finanças"}</span>
        </button>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function Notifications() {
  const alerts = useAlerts();
  const criticalCount = alerts.filter((alert) => alert.tone === "danger").length;
  const attentionCount = alerts.filter((alert) => alert.tone === "warning").length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Notificações (${alerts.length})`}
        >
          <Bell className="size-4" />
          {alerts.length > 0 && (
            <span className="absolute right-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-danger text-[10px] font-bold text-primary-foreground">
              {alerts.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="border-b px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-bold">Central de notificações</p>
            <span className="text-xs text-muted-foreground">
              {alerts.length} {alerts.length === 1 ? "item" : "itens"}
            </span>
          </div>
          {alerts.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-medium">
              {criticalCount > 0 && (
                <span className="rounded-full bg-danger-soft px-2 py-1 text-danger">
                  {criticalCount} crítico(s)
                </span>
              )}
              {attentionCount > 0 && (
                <span className="rounded-full bg-warning-soft px-2 py-1 text-warning">
                  {attentionCount} atenção
                </span>
              )}
            </div>
          )}
        </div>
        <div className="max-h-[min(24rem,60vh)] divide-y overflow-y-auto">
          {alerts.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <CheckCircle2 className="size-6 text-success" />
              <p className="text-sm font-medium">Tudo em ordem</p>
              <p className="text-xs text-muted-foreground">
                Nenhuma pendência identificada para este mês.
              </p>
            </div>
          )}
          {alerts.map((a) => (
            <Link
              key={a.id}
              to={a.to}
              className="flex gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted"
            >
              <span
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  a.tone === "danger"
                    ? "bg-danger"
                    : a.tone === "warning"
                      ? "bg-warning"
                      : "bg-info",
                )}
              />
              <span className="leading-relaxed">{a.text}</span>
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Profile() {
  const [email, setEmail] = useState<string | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) setEmail(data.user?.email ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleSignOut = async () => {
    // Higiene de saída: interrompe consultas, limpa o cache, encerra a sessão
    // e substitui a rota para que "Voltar" não restaure dados protegidos.
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    await router.navigate({ to: "/auth", replace: true });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 px-2" aria-label="Menu do perfil">
          <span className="grid size-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            {(email?.[0] ?? "V").toUpperCase()}
          </span>
          <span className="hidden max-w-40 truncate text-sm font-medium sm:inline">
            {email ?? "Sua conta"}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          Sua conta
          <p className="truncate text-xs font-normal text-muted-foreground">
            {email ?? "Carregando..."}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/configuracoes">
            <Settings className="size-4" /> Configurações
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void handleSignOut()}>
          <LogOut className="size-4" /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ConnectionStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (online) return null;
  return (
    <div className="border-b border-warning/30 bg-warning-soft px-4 py-2 text-center text-xs font-medium text-warning">
      Você está sem conexão. Alterações financeiras só serão confirmadas quando o servidor
      responder.
    </div>
  );
}

function SyncStatusIndicator() {
  const { syncStatus } = useFinance();
  const status = {
    loading: {
      label: "Carregando dados",
      Icon: Loader2,
      className: "text-muted-foreground",
    },
    local: { label: "Modo local", Icon: CloudOff, className: "text-muted-foreground" },
    saving: { label: "Salvando na nuvem", Icon: Loader2, className: "text-primary" },
    synced: { label: "Sincronizado", Icon: CheckCircle2, className: "text-success" },
    error: {
      label: "Falha na sincronização",
      Icon: AlertCircle,
      className: "text-destructive",
    },
    conflict: {
      label: "Conflito: envio pausado",
      Icon: AlertCircle,
      className: "text-destructive",
    },
  }[syncStatus];
  const isAlert = syncStatus === "error" || syncStatus === "conflict";
  const Icon = status.Icon;

  return (
    <div
      role={isAlert ? "alert" : "status"}
      aria-live={isAlert ? "assertive" : "polite"}
      aria-label={status.label}
      title={status.label}
      className={`flex items-center gap-1.5 px-2 text-xs font-medium ${status.className}`}
    >
      <Icon
        aria-hidden="true"
        className={`size-4 ${syncStatus === "loading" || syncStatus === "saving" ? "animate-spin" : ""}`}
      />
      <span className="hidden sm:inline">{status.label}</span>
    </div>
  );
}

function SyncStatusBanner() {
  const { syncStatus } = useFinance();
  if (syncStatus !== "error" && syncStatus !== "conflict") return null;
  const message =
    syncStatus === "conflict"
      ? "Outra sessão alterou os dados enquanto havia mudanças locais. O envio foi pausado para evitar sobrescrever dados; preserve esta cópia e reconcilie antes de continuar."
      : "A sincronização não foi confirmada. Alterações após o último estado sincronizado podem existir apenas neste navegador; verifique a conexão antes de encerrar a sessão.";

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-center text-xs font-medium text-destructive"
    >
      {message}
    </div>
  );
}

function ThemeToggle({ darkMode, onToggle }: { darkMode: boolean; onToggle: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onToggle}
      aria-pressed={darkMode}
      aria-label={darkMode ? "Ativar modo clean" : "Ativar modo escuro"}
      title={darkMode ? "Ativar modo clean" : "Ativar modo escuro"}
    >
      {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

function UndoButton() {
  const { state, dispatch } = useFinance();
  const latestUndo = state.auditLog?.find((entry) => entry.undo && !entry.undoneAt);
  if (!latestUndo) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        dispatch({ type: "undoAudit", auditId: latestUndo.id });
        toast.success("Ação desfeita", { description: latestUndo.description });
      }}
      title={latestUndo.description}
      aria-label="Desfazer última ação reversível"
    >
      <Undo2 className="size-4" />
      <span className="hidden sm:inline">Desfazer</span>
    </Button>
  );
}

function RedoButton() {
  const { state, dispatch } = useFinance();
  const latestRedo = state.auditLog?.find((entry) => entry.redo && entry.undoneAt);
  if (!latestRedo) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        dispatch({ type: "redoAudit", auditId: latestRedo.id });
        toast.success("Ação refeita", { description: latestRedo.description });
      }}
      title={latestRedo.description}
      aria-label="Refazer última ação desfeita"
    >
      <Redo2 className="size-4" />
      <span className="hidden sm:inline">Refazer</span>
    </Button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [quickCalculatorOpen, setQuickCalculatorOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const initialDarkMode = storedTheme === "dark";
    setDarkMode(initialDarkMode);
    document.documentElement.classList.toggle("dark", initialDarkMode);
    document.documentElement.style.colorScheme = initialDarkMode ? "dark" : "light";
  }, []);

  const toggleTheme = () => {
    setDarkMode((current) => {
      const next = !current;
      window.localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "clean");
      document.documentElement.classList.toggle("dark", next);
      document.documentElement.style.colorScheme = next ? "dark" : "light";
      return next;
    });
  };

  return (
    <TooltipProvider delayDuration={200}>
      <TxActionsProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset className="min-w-0">
            <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur md:px-6">
              <SidebarTrigger
                aria-label="Abrir ou recolher menu lateral"
                title="Abrir ou recolher menu lateral"
                className="max-md:size-11 max-md:[&_svg]:size-6"
              />
              <div className="hidden sm:block">
                <DemoTag />
              </div>
              <div className="ml-auto flex items-center gap-1">
                <UndoButton />
                <RedoButton />
                <ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />
                <SyncStatusIndicator />
                <Notifications />
                <Profile />
              </div>
            </header>
            <ConnectionStatus />
            <SyncStatusBanner />
            <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 md:p-6">{children}</main>
            <footer
              className="pointer-events-none select-none px-4 pb-3 text-left md:px-6"
              aria-label="Marca d’água"
            >
              <span className="text-[10px] font-medium uppercase tracking-[0.24em] text-muted-foreground/40">
                Tiago Cardoso
              </span>
            </footer>
            <PersonLimitAlert />
            <FloatingCalculator
              open={quickCalculatorOpen}
              onClose={() => setQuickCalculatorOpen(false)}
            />
            {!quickCalculatorOpen && (
              <Button
                type="button"
                size="icon"
                aria-label="Abrir calculadora rápida"
                title="Abrir calculadora rápida"
                className="fixed bottom-4 right-4 z-[70] size-12 rounded-full shadow-lg"
                onClick={() => setQuickCalculatorOpen(true)}
              >
                <Calculator className="size-5" />
              </Button>
            )}
          </SidebarInset>
        </SidebarProvider>
      </TxActionsProvider>
    </TooltipProvider>
  );
}
