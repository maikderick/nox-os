import { describe, expect, it } from "vitest";

import { pickVariant } from "@/lib/design/art-direction";

describe("escolha de variante por semente", () => {
  const options = ["a", "b", "c"] as const;

  it("é determinística para a mesma semente e o mesmo eixo", () => {
    expect(pickVariant(options, "cmtm2yp9u0004zpc3r7jgufvr", "palette")).toBe(
      pickVariant(options, "cmtm2yp9u0004zpc3r7jgufvr", "palette"),
    );
  });

  it("separa os eixos: a mesma semente não escolhe o mesmo índice em tudo", () => {
    const axes = ["palette", "type", "hero", "rhythm", "device", "case"];
    const picks = axes.map((axis) => pickVariant(options, "seed-fixo", axis));
    expect(new Set(picks).size).toBeGreaterThan(1);
  });

  it("espalha sementes diferentes por mais de uma opção", () => {
    const seeds = Array.from({ length: 40 }, (_, index) => `projeto-${index}`);
    const picks = seeds.map((seed) => pickVariant(options, seed, "palette"));
    expect(new Set(picks).size).toBeGreaterThan(1);
  });

  it("devolve a única opção quando só existe uma", () => {
    expect(pickVariant(["só-essa"], "qualquer", "palette")).toBe("só-essa");
  });

  it("recusa uma lista vazia em vez de devolver undefined", () => {
    expect(() => pickVariant([], "semente", "palette")).toThrow(/vazia/i);
  });
});
