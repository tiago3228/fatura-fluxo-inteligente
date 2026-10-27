import { useEffect, useReducer, useRef, useState } from "react";
import { Calculator, Delete, X } from "lucide-react";
import {
  basicCalculatorReducer,
  initialBasicCalculatorState,
  type BasicCalculatorAction,
  type BasicCalculatorOperator,
} from "@/lib/finance/basicCalculator";

type Position = { left: number; top: number };
type DragOrigin = Position & { pointerId: number; startX: number; startY: number };
type Calculation = { expression: string; result: string };
const HISTORY_KEY = "fatura-fluxo-calculadora-historico-v1";
const HISTORY_LIMIT = 100;

const readHistory = (): Calculation[] => {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is Calculation =>
        !!item && typeof item.expression === "string" && typeof item.result === "string",
    ).slice(-HISTORY_LIMIT);
  } catch {
    return [];
  }
};

const formatNumber = (value: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 10 }).format(value);

const keyClass =
  "min-h-11 rounded-md border bg-background px-2 text-lg font-medium shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px";
const operatorClass = "bg-muted font-semibold";

export function FloatingCalculator({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, dispatch] = useReducer(basicCalculatorReducer, initialBasicCalculatorState);
  const [history, setHistory] = useState<Calculation[]>(readHistory);
  const [position, setPosition] = useState<Position | null>(null);
  const dragOrigin = useRef<DragOrigin | null>(null);
  const historyEndRef = useRef<HTMLDivElement | null>(null);
  const actionHandlerRef = useRef<(action: BasicCalculatorAction) => void>(() => {});

  const handleAction = (action: BasicCalculatorAction) => {
    if (action.type === "equals") {
      const expression = state.operator && state.accumulator !== null
        ? `${formatNumber(state.accumulator)} ${state.operator} ${state.display}`
        : state.lastOperator !== null && state.lastOperand !== null
          ? `${state.display} ${state.lastOperator} ${formatNumber(state.lastOperand)}`
          : null;
      const next = basicCalculatorReducer(state, action);
      if (expression && next !== state && !next.error) {
        setHistory((current) => [
          ...current,
          { expression, result: next.display },
        ].slice(-HISTORY_LIMIT));
      }
    }
    dispatch(action);
  };
  actionHandlerRef.current = handleAction;

  useEffect(() => {
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      // A calculadora continua funcional quando o armazenamento da sessão não está disponível.
    }
  }, [history]);

  useEffect(() => {
    if (open) historyEndRef.current?.scrollIntoView({ block: "end" });
  }, [history, open]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!open) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      )
        return;

      const actions: Record<string, BasicCalculatorAction> = {
        Enter: { type: "equals" },
        "=": { type: "equals" },
        Escape: { type: "clear" },
        Backspace: { type: "backspace" },
        ".": { type: "decimal" },
        ",": { type: "decimal" },
        "+": { type: "operator", operator: "+" },
        "-": { type: "operator", operator: "−" },
        "*": { type: "operator", operator: "×" },
        "/": { type: "operator", operator: "÷" },
      };
      const action = /^\d$/.test(event.key)
        ? { type: "digit" as const, digit: event.key }
        : actions[event.key];
      if (!action) return;
      event.preventDefault();
      actionHandlerRef.current(action);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const rect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) return;
    const origin = { left: rect.left, top: rect.top };
    dragOrigin.current = {
      ...origin,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    setPosition(origin);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const origin = dragOrigin.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    const width = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 320;
    const height = event.currentTarget.parentElement?.getBoundingClientRect().height ?? 360;
    const left = Math.min(
      Math.max(0, origin.left + event.clientX - origin.startX),
      window.innerWidth - width,
    );
    const top = Math.min(
      Math.max(0, origin.top + event.clientY - origin.startY),
      window.innerHeight - height,
    );
    setPosition({ left, top });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragOrigin.current?.pointerId === event.pointerId) dragOrigin.current = null;
  };

  const press = (action: BasicCalculatorAction) => () => handleAction(action);
  const operator = (value: BasicCalculatorOperator) => press({ type: "operator", operator: value });

  if (!open) return null;

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-label="Calculadora rápida"
      className="fixed z-[80] w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl"
      style={position ? { left: position.left, top: position.top } : { right: 16, bottom: 16 }}
    >
      <div
        className="flex touch-none cursor-move items-center gap-2 border-b bg-muted/70 px-3 py-2.5 select-none"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <Calculator className="size-4 text-primary" aria-hidden="true" />
        <span className="flex-1 text-sm font-semibold">Calculadora rápida</span>
        <button
          type="button"
          aria-label="Fechar calculadora rápida"
          className="grid size-8 place-items-center rounded-md hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="space-y-3 p-3">
        <div className="rounded-lg bg-muted p-3">
          <div
            role="log"
            aria-label="Histórico de cálculos"
            className="max-h-28 min-h-8 space-y-1 overflow-y-auto text-right font-mono text-xs text-muted-foreground"
          >
            {history.length === 0 && <p className="py-1">O histórico aparecerá aqui.</p>}
            {history.map((item, index) => (
              <p key={`${index}-${item.expression}-${item.result}`} className="break-all">
                {item.expression} = <span className="font-semibold text-foreground">{item.result}</span>
              </p>
            ))}
            <div ref={historyEndRef} />
          </div>
          <output
            aria-live="polite"
            aria-label="Visor da calculadora"
            className="mt-2 block min-h-10 overflow-hidden border-t border-border/60 pt-2 text-right font-mono text-3xl font-semibold tabular-nums"
          >
            {state.display}
          </output>
        </div>
        {history.length > 0 && (
          <button
            type="button"
            className="w-full text-right text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => setHistory([])}
          >
            Limpar histórico
          </button>
        )}

        <div className="grid grid-cols-4 gap-2">
          <button
            type="button"
            className={`${keyClass} ${operatorClass}`}
            onClick={press({ type: "clear" })}
          >
            C
          </button>
          <button
            type="button"
            aria-label="Apagar último dígito"
            className={`${keyClass} ${operatorClass}`}
            onClick={press({ type: "backspace" })}
          >
            <Delete className="mx-auto size-5" />
          </button>
          <button
            type="button"
            aria-label="Por cento"
            className={`${keyClass} ${operatorClass}`}
            onClick={press({ type: "percent" })}
          >
            %
          </button>
          <button
            type="button"
            aria-label="Dividir"
            className={`${keyClass} ${operatorClass}`}
            onClick={operator("÷")}
          >
            ÷
          </button>

          {["7", "8", "9"].map((digit) => (
            <button
              key={digit}
              type="button"
              className={keyClass}
              onClick={press({ type: "digit", digit })}
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            aria-label="Multiplicar"
            className={`${keyClass} ${operatorClass}`}
            onClick={operator("×")}
          >
            ×
          </button>

          {["4", "5", "6"].map((digit) => (
            <button
              key={digit}
              type="button"
              className={keyClass}
              onClick={press({ type: "digit", digit })}
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            aria-label="Subtrair"
            className={`${keyClass} ${operatorClass}`}
            onClick={operator("−")}
          >
            −
          </button>

          {["1", "2", "3"].map((digit) => (
            <button
              key={digit}
              type="button"
              className={keyClass}
              onClick={press({ type: "digit", digit })}
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            aria-label="Somar"
            className={`${keyClass} ${operatorClass}`}
            onClick={operator("+")}
          >
            +
          </button>

          <button
            type="button"
            aria-label="Inverter sinal"
            className={`${keyClass} ${operatorClass}`}
            onClick={press({ type: "toggleSign" })}
          >
            +/−
          </button>
          <button type="button" className={keyClass} onClick={press({ type: "digit", digit: "0" })}>
            0
          </button>
          <button
            type="button"
            aria-label="Separador decimal"
            className={keyClass}
            onClick={press({ type: "decimal" })}
          >
            ,
          </button>
          <button
            type="button"
            aria-label="Igual"
            className="min-h-11 rounded-md bg-primary px-2 text-lg font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={press({ type: "equals" })}
          >
            =
          </button>
        </div>
        <p className="text-center text-[11px] text-muted-foreground">
          Use também o teclado. Arraste pelo título para mover.
        </p>
      </div>
    </section>
  );
}
