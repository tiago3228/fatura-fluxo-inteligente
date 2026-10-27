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

const keyClass =
  "min-h-11 rounded-md border bg-background px-2 text-lg font-medium shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px";
const operatorClass = "bg-muted font-semibold";

export function FloatingCalculator({ onClose }: { onClose: () => void }) {
  const [state, dispatch] = useReducer(basicCalculatorReducer, initialBasicCalculatorState);
  const [position, setPosition] = useState<Position | null>(null);
  const dragOrigin = useRef<DragOrigin | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
      dispatch(action);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

  const press = (action: BasicCalculatorAction) => () => dispatch(action);
  const operator = (value: BasicCalculatorOperator) => press({ type: "operator", operator: value });

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
        <output
          aria-live="polite"
          aria-label="Visor da calculadora"
          className="block min-h-16 overflow-hidden rounded-lg bg-muted px-3 py-2 text-right font-mono text-3xl font-semibold tabular-nums"
        >
          {state.display}
        </output>

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
