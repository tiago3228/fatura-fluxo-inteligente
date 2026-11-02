import { describe, expect, it } from "vitest";
import {
  createDefaultOtherAccountCategories,
  isValidOtherAccount,
  splitEvenlyInCents,
  withDefaultOtherAccountCategories,
} from "@/lib/finance/otherAccounts";
import type { OtherAccount } from "@/lib/finance/types";

const people = [
  { id: "p1", name: "Ana" },
  { id: "p2", name: "Bia" },
  { id: "p3", name: "Caio" },
];

describe("contas domésticas", () => {
  it("distribui o resto do rateio sem perder centavos", () => {
    const split = splitEvenlyInCents(10001, people);
    expect(split.map((item) => item.amountCents)).toEqual([3334, 3334, 3333]);
    expect(split.reduce((sum, item) => sum + item.amountCents!, 0)).toBe(10001);
  });

  it("reparte um centavo com resultado determinístico e elimina pessoa duplicada", () => {
    const split = splitEvenlyInCents(1, [people[0]!, people[0]!, people[1]!]);
    expect(split).toEqual([
      { personId: "p1", personName: "Ana", amountCents: 1 },
      { personId: "p2", personName: "Bia", amountCents: 0 },
    ]);
  });

  it("não divide valores inválidos nem quando não há participantes", () => {
    expect(splitEvenlyInCents(0, people)).toEqual([]);
    expect(splitEvenlyInCents(100, [])).toEqual([]);
    expect(splitEvenlyInCents(1.5, people)).toEqual([]);
  });

  it("mantém as seis categorias iniciais e preserva tipos personalizados válidos", () => {
    const categories = withDefaultOtherAccountCategories([
      { id: "internet", name: "Internet alterada", builtIn: false },
      { id: "gas", name: "Gás" },
    ]);
    expect(categories.map((category) => category.id)).toEqual([
      "energy",
      "water",
      "internet",
      "condominium",
      "iptu",
      "ipva",
      "gas",
    ]);
    expect(categories.find((category) => category.id === "internet")?.name).toBe("Internet");
  });

  it("aceita somente divisão com soma exata, participantes únicos e vencimento válido", () => {
    const account: OtherAccount = {
      id: "bill_1",
      categoryId: "energy",
      description: "Cemig",
      amountCents: 10001,
      dueDate: "2026-11-10",
      status: "pending",
      responsibilities: splitEvenlyInCents(10001, people),
    };
    const categories = createDefaultOtherAccountCategories();
    expect(isValidOtherAccount(account, categories)).toBe(true);
    expect(
      isValidOtherAccount(
        { ...account, responsibilities: [{ personId: "p1", personName: "Ana", amountCents: 1 }] },
        categories,
      ),
    ).toBe(false);
    expect(isValidOtherAccount({ ...account, dueDate: "2026-02-30" }, categories)).toBe(false);
  });

  it("rejeita de forma segura registros e responsáveis malformados", () => {
    const categories = createDefaultOtherAccountCategories();
    const account: OtherAccount = {
      id: "bill_2",
      categoryId: "energy",
      description: "Cemig",
      amountCents: 100,
      dueDate: "2026-11-10",
      status: "pending",
      responsibilities: [],
    };
    expect(isValidOtherAccount(null, categories)).toBe(false);
    expect(isValidOtherAccount({ ...account, responsibilities: [null] }, categories)).toBe(false);
    expect(
      isValidOtherAccount(
        { ...account, responsibilities: [{ personId: "p1", personName: 7 }] },
        categories,
      ),
    ).toBe(false);
  });
});
