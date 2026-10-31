import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error jsdom is a test dependency without bundled declarations in this project.
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const gameHtml = readFileSync(resolve(process.cwd(), "src/assets/minigame-bandeiras.html"), "utf8");

describe("minigame de bandeiras", () => {
  it("mostra a bandeira e as opções após escolher uma skin e um modo", () => {
    const dom = new JSDOM(gameHtml, {
      runScripts: "dangerously",
      url: "https://minigame.test/",
    });

    try {
      dom.window.document.querySelector<HTMLButtonElement>('.theme[data-theme="gameboy"]')?.click();
      dom.window.document.querySelector<HTMLButtonElement>('[data-mode="free"]')?.click();

      expect(dom.window.document.getElementById("startScreen")?.hidden).toBe(true);
      expect(dom.window.document.getElementById("gameScreen")?.hidden).toBe(false);
      expect(
        dom.window.document.querySelector("#gameScreen .flag-wrap img")?.getAttribute("src"),
      ).toContain("flagcdn.com/w320/");
      expect(dom.window.document.querySelectorAll("#gameScreen .answer")).toHaveLength(4);
    } finally {
      dom.window.close();
    }
  });
});
