export type BasicCalculatorOperator = "+" | "−" | "×" | "÷";

type BasicCalculatorState = {
  display: string;
  accumulator: number | null;
  operator: BasicCalculatorOperator | null;
  replaceDisplay: boolean;
  lastOperator: BasicCalculatorOperator | null;
  lastOperand: number | null;
  error: boolean;
};

export type BasicCalculatorAction =
  | { type: "digit"; digit: string }
  | { type: "decimal" }
  | { type: "operator"; operator: BasicCalculatorOperator }
  | { type: "equals" }
  | { type: "clear" }
  | { type: "backspace" }
  | { type: "toggleSign" }
  | { type: "percent" };

export const initialBasicCalculatorState: BasicCalculatorState = {
  display: "0",
  accumulator: null,
  operator: null,
  replaceDisplay: true,
  lastOperator: null,
  lastOperand: null,
  error: false,
};

const parseDisplay = (display: string) => Number(display.replace(/\./g, "").replace(",", "."));

const formatEntry = (value: string) => {
  const negative = value.startsWith("-");
  const raw = value.replace(/^-/, "").replace(/\./g, "");
  const [integer = "0", fraction] = raw.split(",");
  const normalizedInteger = integer.replace(/^0+(?=\d)/, "") || "0";
  const groupedInteger = normalizedInteger.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${groupedInteger}${fraction === undefined ? "" : `,${fraction}`}`;
};

const formatResult = (value: number) => {
  if (!Number.isFinite(value)) return "Erro";
  const normalized = Math.round((value + Number.EPSILON) * 1e10) / 1e10;
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 10 }).format(normalized);
};

const calculate = (
  left: number,
  operator: BasicCalculatorOperator,
  right: number,
): number | null => {
  switch (operator) {
    case "+":
      return left + right;
    case "−":
      return left - right;
    case "×":
      return left * right;
    case "÷":
      return right === 0 ? null : left / right;
  }
};

const errorState = (): BasicCalculatorState => ({
  ...initialBasicCalculatorState,
  display: "Erro",
  replaceDisplay: true,
  error: true,
});

export const basicCalculatorReducer = (
  state: BasicCalculatorState,
  action: BasicCalculatorAction,
): BasicCalculatorState => {
  if (action.type === "clear") return initialBasicCalculatorState;
  if (action.type === "digit") {
    const base = state.error ? initialBasicCalculatorState : state;
    if (!/^\d$/.test(action.digit)) return base;
    const current = base.replaceDisplay ? "0" : base.display;
    const digitCount = current.replace(/\D/g, "").length;
    if (digitCount >= 14) return { ...base, replaceDisplay: false };
    const next =
      current === "0"
        ? action.digit
        : current === "-0"
          ? `-${action.digit}`
          : `${current}${action.digit}`;
    return { ...base, display: formatEntry(next), replaceDisplay: false, error: false };
  }
  if (state.error) return action.type === "operator" ? initialBasicCalculatorState : state;

  if (action.type === "decimal") {
    const current = state.replaceDisplay ? "0" : state.display;
    if (current.includes(",")) return { ...state, replaceDisplay: false };
    return { ...state, display: `${current},`, replaceDisplay: false };
  }

  if (action.type === "backspace") {
    if (state.replaceDisplay) return state;
    const shortened = state.display.slice(0, -1).replace(/,$/, "") || "0";
    return { ...state, display: formatEntry(shortened), replaceDisplay: false };
  }

  if (action.type === "toggleSign") {
    const value = parseDisplay(state.display);
    return { ...state, display: formatResult(-value), replaceDisplay: false };
  }

  if (action.type === "percent") {
    const current = parseDisplay(state.display);
    const value =
      state.operator && state.accumulator !== null
        ? (state.accumulator * current) / 100
        : current / 100;
    return { ...state, display: formatResult(value), replaceDisplay: true };
  }

  if (action.type === "operator") {
    const current = parseDisplay(state.display);
    if (state.operator && state.accumulator !== null && !state.replaceDisplay) {
      const result = calculate(state.accumulator, state.operator, current);
      if (result === null) return errorState();
      return {
        ...state,
        display: formatResult(result),
        accumulator: result,
        operator: action.operator,
        replaceDisplay: true,
        lastOperator: null,
        lastOperand: null,
      };
    }
    const accumulator = state.operator && state.accumulator !== null ? state.accumulator : current;
    return {
      ...state,
      display: formatResult(accumulator),
      accumulator,
      operator: action.operator,
      replaceDisplay: true,
      lastOperator: null,
      lastOperand: null,
    };
  }

  if (action.type === "equals") {
    const operator = state.operator ?? state.lastOperator;
    const left = state.operator ? state.accumulator : parseDisplay(state.display);
    const right = state.operator
      ? state.replaceDisplay
        ? parseDisplay(state.display)
        : parseDisplay(state.display)
      : state.lastOperand;
    if (operator === null || left === null || right === null) return state;
    const result = calculate(left, operator, right);
    if (result === null) return errorState();
    return {
      ...state,
      display: formatResult(result),
      accumulator: null,
      operator: null,
      replaceDisplay: true,
      lastOperator: operator,
      lastOperand: right,
    };
  }

  return state;
};
