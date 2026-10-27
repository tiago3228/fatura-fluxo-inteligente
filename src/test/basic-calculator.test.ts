import { describe, expect, it } from "vitest";
import {
  basicCalculatorReducer,
  initialBasicCalculatorState,
  type BasicCalculatorAction,
} from "@/lib/finance/basicCalculator";

const calculate = (actions: BasicCalculatorAction[]) =>
  actions.reduce(basicCalculatorReducer, initialBasicCalculatorState);

const digits = (value: string): BasicCalculatorAction[] =>
  [...value].map((digit) => ({ type: "digit", digit }));

describe("calculadora rápida", () => {
  it("calcula decimais digitados com vírgula", () => {
    const state = calculate([
      ...digits("12"),
      { type: "decimal" },
      ...digits("5"),
      { type: "operator", operator: "+" },
      ...digits("7"),
      { type: "decimal" },
      ...digits("5"),
      { type: "equals" },
    ]);

    expect(state.display).toBe("20");
  });

  it("repete a última operação ao pressionar igual novamente", () => {
    const state = calculate([
      ...digits("5"),
      { type: "operator", operator: "+" },
      ...digits("2"),
      { type: "equals" },
      { type: "equals" },
    ]);

    expect(state.display).toBe("9");
  });

  it("mostra erro ao dividir por zero e permite continuar digitando", () => {
    const error = calculate([
      ...digits("9"),
      { type: "operator", operator: "÷" },
      ...digits("0"),
      { type: "equals" },
    ]);
    const recovered = basicCalculatorReducer(error, { type: "digit", digit: "4" });

    expect(error.display).toBe("Erro");
    expect(recovered.display).toBe("4");
  });

  it("trata porcentagem como conversão do visor para percentual decimal", () => {
    const state = calculate([...digits("100"), { type: "percent" }]);
    expect(state.display).toBe("1");
  });

  it("calcula percentuais em relação ao primeiro valor quando há uma operação pendente", () => {
    const state = calculate([
      ...digits("200"),
      { type: "operator", operator: "+" },
      ...digits("10"),
      { type: "percent" },
      { type: "equals" },
    ]);

    expect(state.display).toBe("220");
  });
});
