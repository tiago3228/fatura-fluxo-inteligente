import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
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
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  Loader2,
  LogOut,
  Settings,
  ShoppingBag,
  Users,
  Wallet,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
} from "@/components/ui/sidebar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAlerts } from "@/lib/finance/alerts";
import { useFinance } from "@/lib/finance/store";
import { DemoTag } from "./common";
import { TxActionsProvider } from "./tx-actions";
import { cn } from "@/lib/utils";

const NAV = [
  { title: "Visão geral", url: "/", icon: LayoutDashboard },
  { title: "Faturas", url: "/faturas", icon: FileText },
  { title: "Compras", url: "/compras", icon: ShoppingBag },
  { title: "Pessoas", url: "/pessoas", icon: Users },
  { title: "Cartões", url: "/cartoes", icon: CreditCard },
  { title: "Parcelamentos", url: "/parcelamentos", icon: CalendarClock },
  { title: "Calculadora", url: "/calculadora", icon: Calculator },
  { title: "Relatórios", url: "/relatorios", icon: FileSpreadsheet },
  { title: "Planilhas", url: "/planilhas", icon: FileSpreadsheet },
  { title: "Como Funciona", url: "/como-funciona", icon: BookOpen },
  { title: "Configurações", url: "/configuracoes", icon: Settings },
] as const;

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
            <p className="truncate text-sm font-bold text-sidebar-accent-foreground">Fatura em Dia</p>
            <p className="truncate text-xs opacity-70">Organizador de cartões</p>
          </div>
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

function Notifications() {
  const alerts = useAlerts();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notificações (${alerts.length})`}>
          <Bell className="size-4" />
          {alerts.length > 0 && (
            <span className="absolute right-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-danger text-[10px] font-bold text-primary-foreground">
              {alerts.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <p className="border-b px-4 py-2.5 text-sm font-bold">Alertas do mês</p>
        <div className="max-h-80 divide-y overflow-y-auto">
          {alerts.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Tudo em ordem.</p>}
          {alerts.map((a) => (
            <Link key={a.id} to={a.to} className="flex gap-2 px-4 py-2.5 text-sm hover:bg-muted">
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", a.tone === "danger" ? "bg-danger" : a.tone === "warning" ? "bg-warning" : "bg-info")} />
              {a.text}
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
    return () => { active = false; };
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
          <span className="hidden max-w-40 truncate text-sm font-medium sm:inline">{email ?? "Sua conta"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          Sua conta
          <p className="truncate text-xs font-normal text-muted-foreground">{email ?? "Carregando..."}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/configuracoes"><Settings className="size-4" /> Configurações</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void handleSignOut()}>
          <LogOut className="size-4" /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ConnectionStatus() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);

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
  return <div className="border-b border-warning/30 bg-warning-soft px-4 py-2 text-center text-xs font-medium text-warning">Você está sem conexão. Alterações financeiras só serão confirmadas quando o servidor responder.</div>;
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

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={200}>
      <TxActionsProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset className="min-w-0">
            <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur md:px-6">
              <SidebarTrigger aria-label="Alternar menu" className="max-md:size-11 max-md:[&_svg]:size-6" />
              <div className="hidden sm:block"><DemoTag /></div>
              <div className="ml-auto flex items-center gap-1">
                <SyncStatusIndicator />
                <Notifications />
                <Profile />
              </div>
            </header>
            <ConnectionStatus />
            <SyncStatusBanner />
            <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 md:p-6">{children}</main>
          </SidebarInset>
        </SidebarProvider>
      </TxActionsProvider>
    </TooltipProvider>
  );
}
