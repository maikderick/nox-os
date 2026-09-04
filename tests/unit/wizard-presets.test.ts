import { describe, expect, it } from "vitest";

import { findClaimRisks } from "../../src/lib/content-integrity";
import {
  OBJECTIVE_PRESETS,
  TONE_PRESETS,
  VISUAL_PRESETS,
} from "../../src/lib/site-factory/wizard-presets";

describe("presets do assistente", () => {
  it("não dispara regras de afirmações nos objetivos", () => {
    for (const preset of OBJECTIVE_PRESETS) {
      expect(findClaimRisks([{ field: `objective.${preset.label}`, value: preset.text }])).toEqual([]);
    }
  });

  it("não dispara regras de afirmações nos tons", () => {
    for (const preset of TONE_PRESETS) {
      expect(findClaimRisks([{ field: `positioning.${preset.label}`, value: preset.text }])).toEqual([]);
    }
  });

  it("não dispara regras de afirmações nas direções visuais", () => {
    for (const preset of VISUAL_PRESETS) {
      expect(findClaimRisks([{ field: `visualDirection.${preset.label}`, value: preset.text }])).toEqual([]);
    }
  });
});
