import type { ReactNode } from "react";
import { FlaskConical, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFinance } from "@/lib/finance/store";
import { availableMonths, limitPct, limitStatus } from "@/lib/finance/calc";
import { fmtMonthLong } from "@/lib/finance/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function PageHeader({
  title,
  description,
  actions,
  showMonth,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  showMonth?: boolean;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {showMonth && <MonthSelect />}
        {actions}
      </div>
    </div>
  );
}

export function MonthSelect() {
  const { state, dispatch } = useFinance();
  return (
    <Select value={state.settings.month} onValueChange={(m) => dispatch({ type: "setMonth", month: m })}>
      <SelectTrigger className="w-[190px] bg-card" aria-label="Mês de referência">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {availableMonths(state).map((m) => (
          <SelectItem key={m} value={m}>
            {fmtMonthLong(m)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
  wrapValue = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "warning" | "danger" | "success";
  wrapValue?: boolean;
}) {
  const toneCls = {
    default: "bg-accent text-accent-foreground",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
    success: "bg-success-soft text-success",
  }[tone];
  return (
    <div className="fade-in-up min-w-0 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {icon && (
          <span className={cn("grid size-8 place-items-center rounded-lg [&_svg]:size-4", toneCls)}>
            {icon}
          </span>
        )}
      </div>
      {wrapValue ? (
        <div className="mt-2 break-words text-2xl font-bold">{value}</div>
      ) : (
        <p className="num mt-2 text-2xl font-bold">{value}</p>
      )}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Panel({ title, description, actions, children, className }: { title?: string; description?: string | undefined; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card shadow-xs", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-bold">{title}</h2>}
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function LimitBar({ total, limit }: { total: number; limit: number }) {
  const { state } = useFinance();
  const pct = limitPct(total, limit);
  const st = limitStatus(total, limit, state.settings.warnPct);
  const color = st === "normal" ? "bg-success" : st === "atencao" ? "bg-warning" : "bg-danger";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="num w-10 text-right text-xs font-semibold">{Math.round(pct)}%</span>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string | undefined; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
        <Inbox className="size-5" />
      </span>
      <p className="font-semibold">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}

export function DemoTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-warning/50 bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">
      <FlaskConical className="size-3" /> Dados importados localmente
    </span>
  );
}

export function Field({ label, htmlFor, error, hint, required, children }: { label: string; htmlFor?: string; error?: string | undefined; hint?: string | undefined; required?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {children}
      {error ? <p className="text-xs font-medium text-danger">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
