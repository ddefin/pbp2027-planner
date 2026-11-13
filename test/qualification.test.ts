import { describe, expect, it } from "vitest";
import { qualifiedSteps, stepFor, QUALIFYING_STEPS } from "../src/shared/qualification.js";

describe("Qualification PBP", () => {
  it("garde 4 étapes, et un 1000 vaut pour l'étape 600", () => {
    expect(QUALIFYING_STEPS).toEqual([200, 300, 400, 600]);
    expect(stepFor(1000)).toBe(600);
    expect(stepFor(600)).toBe(600);
    expect(stepFor(250)).toBeNull();
  });

  it("ne compte que les brevets homologués, sans double compte", () => {
    const steps = qualifiedSteps([
      { distance: 200, status: "homologue" },
      { distance: 300, status: "fait" }, // pas encore homologué
      { distance: 1000, status: "homologue" },
      { distance: 600, status: "homologue" }, // même étape que le 1000
    ]);
    expect([...steps].sort((a, b) => a - b)).toEqual([200, 600]);
  });

  it("série complète avec un 1000 à la place du 600", () => {
    const steps = qualifiedSteps([200, 300, 400, 1000].map((distance) => ({ distance, status: "homologue" })));
    expect(steps.size).toBe(QUALIFYING_STEPS.length);
  });
});
