import { describe, expect, it } from "vitest";
import { allocateByPercent } from "@/lib/finance/calc";

const shares = [
  { personId: "p_a", pct: 33 },
  { personId: "p_b", pct: 33 },
  { personId: "p_c", pct: 34 },
];

describe("allocateByPercent", () => {
  it("preserva exatamente dois centavos em um rateio 33/33/34", () => {
    const allocations = allocateByPercent(0.02, shares);

    expect(allocations).toEqual([
      { personId: "p_a", amount: 0.01 },
      { personId: "p_b", amount: 0.01 },
      { personId: "p_c", amount: 0 },
    ]);
    expect(allocations.reduce((sum, allocation) => sum + allocation.amount, 0)).toBe(0.02);
  });

  it("atribui o resíduo do arredondamento de forma determinística", () => {
    const allocations = allocateByPercent(0.01, shares);

    expect(allocations.map((allocation) => allocation.amount)).toEqual([0, 0, 0.01]);
    expect(allocations.reduce((sum, allocation) => sum + allocation.amount, 0)).toBe(0.01);
  });

  it("não gera alocações quando não há percentual positivo", () => {
    expect(allocateByPercent(10, [{ personId: "p_a", pct: 0 }])).toEqual([]);
  });
});
