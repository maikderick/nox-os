import { describe, expect, it } from "vitest";

import { evaluateGenerationOutcome, type BarrierInput } from "@/lib/generation/barrier";

/**
 * The barrier is pure, so this suite needs no database and no queue.
 *
 * That is the reason it is pure: the interesting cases are all about facts
 * disagreeing with each other, and building those in a database means building
 * a whole generation to get one field wrong.
 */

const REVISION = "revisao-1";
const COMMIT = "a".repeat(40);

const base: BarrierInput = {
  run: { status: "CONCLUIDO", siteRevisionId: REVISION, commitSha: COMMIT },
  check: { siteRevisionId: REVISION, commitSha: COMMIT, name: "verify", conclusion: "SUCESSO" },
  preview: { siteRevisionId: REVISION, commitSha: COMMIT, status: "PRONTO" },
  requiredCheck: "verify",
};

describe("a barreira da geração", () => {
  it("conclui com os três fatos alinhados", () => {
    expect(evaluateGenerationOutcome(base)).toEqual({
      outcome: "PREVIA_PRONTA",
      reason: "TRES_FATOS_ALINHADOS",
    });
  });

  it("não conclui com dois de três", () => {
    expect(evaluateGenerationOutcome({ ...base, check: null }).outcome).toBe("AGUARDANDO");
    expect(evaluateGenerationOutcome({ ...base, preview: null }).outcome).toBe("AGUARDANDO");
  });

  it("não conclui enquanto o agente não terminou", () => {
    expect(
      evaluateGenerationOutcome({
        ...base,
        run: { status: "EXECUTANDO", siteRevisionId: null, commitSha: null },
      }).outcome,
    ).toBe("AGUARDANDO");
  });

  it("um check de outro commit não fecha a geração", () => {
    // The stale fact is the dangerous one: it is complete, it is green, and it
    // is about code that no longer exists.
    const decision = evaluateGenerationOutcome({
      ...base,
      check: { ...base.check!, commitSha: "b".repeat(40) },
    });

    expect(decision).toEqual({
      outcome: "AGUARDANDO",
      reason: "FATOS_DE_REVISOES_DIFERENTES",
    });
  });

  it("uma prévia de outra revisão não fecha a geração", () => {
    const decision = evaluateGenerationOutcome({
      ...base,
      preview: { ...base.preview!, siteRevisionId: "revisao-anterior" },
    });

    expect(decision.outcome).toBe("AGUARDANDO");
    expect(decision.reason).toBe("FATOS_DE_REVISOES_DIFERENTES");
  });

  it("um check com outro nome não é o fato esperado", () => {
    // A green run of some other check is not the check the ruleset requires.
    const decision = evaluateGenerationOutcome({
      ...base,
      check: { ...base.check!, name: "lint" },
    });

    expect(decision.outcome).toBe("AGUARDANDO");
  });

  it("check falhando derruba a geração, com razão fechada", () => {
    expect(
      evaluateGenerationOutcome({
        ...base,
        check: { ...base.check!, conclusion: "FALHA" },
      }),
    ).toEqual({ outcome: "FALHOU", reason: "CHECK_FALHOU" });
  });

  it("prévia falhando derruba a geração", () => {
    expect(
      evaluateGenerationOutcome({
        ...base,
        preview: { ...base.preview!, status: "FALHOU" },
      }),
    ).toEqual({ outcome: "FALHOU", reason: "PREVIA_FALHOU" });
  });

  it("uma falha decide sem esperar o irmão", () => {
    // Waiting for the sibling would let a green preview arrive and make the
    // pair look ambiguous — the failure is already conclusive.
    const decision = evaluateGenerationOutcome({
      ...base,
      check: { ...base.check!, conclusion: "FALHA" },
      preview: null,
    });

    expect(decision.outcome).toBe("FALHOU");
  });

  it("o agente falhando não espera fato nenhum", () => {
    expect(
      evaluateGenerationOutcome({
        ...base,
        run: { status: "FALHOU", siteRevisionId: null, commitSha: null },
        check: null,
        preview: null,
      }),
    ).toEqual({ outcome: "FALHOU", reason: "AGENTE_FALHOU" });
  });

  it("um check ausente conta como falha, e não como espera", () => {
    // `AUSENTE` is written by the observer only after its deadline; by then the
    // difference between "not yet" and "never" has already been decided.
    expect(
      evaluateGenerationOutcome({
        ...base,
        check: { ...base.check!, conclusion: "AUSENTE" },
      }).outcome,
    ).toBe("FALHOU");
  });

  it("não escreve nada: a mesma entrada dá a mesma saída", () => {
    const input = structuredClone(base);
    const first = evaluateGenerationOutcome(input);
    const second = evaluateGenerationOutcome(input);

    expect(second).toEqual(first);
    expect(input).toEqual(base);
  });
});
