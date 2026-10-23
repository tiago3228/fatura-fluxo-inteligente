import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { LimitStatus, PlanStatus, TxStatus } from "@/lib/finance/calc";
import { TX_TYPE_LABEL, isCreditType } from "@/lib/finance/calc";
import type { InvoiceStatus, TxType } from "@/lib/finance/types";

const pill = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap", {
  variants: {
    tone: {
      success: "bg-success-soft text-success",
      warning: "bg-warning-soft text-warning",
      danger: "bg-danger-soft text-danger",
      info: "bg-info-soft text-info",
      neutral: "bg-neutral-soft text-muted-foreground",
      primary: "bg-accent text-accent-foreground",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export type Tone = NonNullable<VariantProps<typeof pill>["tone"]>;

export function Pill({ tone, className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return <span className={cn(pill({ tone }), className)}>{children}</span>;
}

const dot = "size-1.5 rounded-full bg-current";

export function TxStatusBadge({ status }: { status: TxStatus }) {
  const map: Record<TxStatus, [Tone, string]> = {
    pendente: ["warning", "Pendente"],
    atribuida: ["success", "Atribuída"],
    dividida: ["info", "Dividida"],
    nao_aplica: ["neutral", "Não se aplica"],
  };
  const [tone, label] = map[status];
  return (
    <Pill tone={tone}>
      <span className={dot} />
      {label}
    </Pill>
  );
}

export function TxTypeBadge({ type }: { type: TxType }) {
  const tone: Tone = isCreditType(type) ? "success" : type === "tarifa" ? "danger" : type === "parcela" ? "info" : type === "pagamento" ? "neutral" : "primary";
  return <Pill tone={tone}>{TX_TYPE_LABEL[type]}</Pill>;
}

export function LimitBadge({ status }: { status: LimitStatus }) {
  const map: Record<LimitStatus, [Tone, string]> = {
    normal: ["success", "Normal"],
    atencao: ["warning", "Atenção"],
    atingido: ["danger", "Limite atingido"],
    ultrapassado: ["danger", "Ultrapassado"],
  };
  const [tone, label] = map[status];
  return <Pill tone={tone}>{label}</Pill>;
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const map: Record<InvoiceStatus, [Tone, string]> = {
    conferida: ["success", "Conferida"],
    em_revisao: ["warning", "Em revisão"],
    inconsistente: ["danger", "Inconsistente"],
  };
  const [tone, label] = map[status];
  return <Pill tone={tone}>{label}</Pill>;
}

export function PlanStatusBadge({ status }: { status: PlanStatus }) {
  const map: Record<PlanStatus, [Tone, string]> = {
    ativo: ["info", "Ativo"],
    finalizado: ["neutral", "Finalizado"],
    futuro: ["primary", "A iniciar"],
  };
  const [tone, label] = map[status];
  return <Pill tone={tone}>{label}</Pill>;
}
