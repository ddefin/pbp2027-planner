import { describe, expect, it } from "vitest";
import { barrierPhrase, finishPhrase, planPhrase, rainPhrase } from "../src/shared/onTime.js";

describe("Phrases « dans les temps » pour les proches", () => {
  it("barrière horaire : avance, juste, retard, contrôle fermé", () => {
    expect(barrierPhrase({ marginMin: 130, level: "ok", controlName: "Tinténiac" })).toMatchObject({ level: "ok", short: "Dans les temps — 2 h 10 d'avance" });
    expect(barrierPhrase({ marginMin: 25, level: "tight", controlName: "Tinténiac" })?.long).toBe("Juste : 25 min de marge à Tinténiac avant sa fermeture.");
    expect(barrierPhrase({ marginMin: 130, level: "ok", controlName: "Contrôle Tinténiac" })?.long).toBe("Dans les temps : 2 h 10 d'avance sur la fermeture du contrôle de Tinténiac.");
    expect(barrierPhrase({ marginMin: -5, level: "late", controlName: "Contrôle de Loudéac" })?.long).toContain("barrière horaire du contrôle de Loudéac");
    expect(barrierPhrase({ marginMin: 30, level: "ok", controlName: "X" })?.level).toBe("tight"); // sous 45 min : juste
    expect(barrierPhrase({ marginMin: -10, level: "late", controlName: "X" })?.level).toBe("late");
    expect(barrierPhrase({ marginMin: 60, level: "late", controlName: "X" })?.short).toBe("En retard sur la barrière horaire"); // contrôle déjà fermé
    expect(barrierPhrase({ marginMin: null, level: null, controlName: null })).toBeNull();
  });

  it("plan personnel : avance, à l'heure, retard léger ou net", () => {
    expect(planPhrase(35)).toEqual({ level: "ok", text: "35 min d'avance sur son plan" });
    expect(planPhrase(2)).toEqual({ level: "ok", text: "Pile à l'heure de son plan" });
    expect(planPhrase(-20)).toEqual({ level: "tight", text: "20 min de retard sur son plan" });
    expect(planPhrase(-97)).toEqual({ level: "tight", text: "1 h 37 de retard sur son plan" }); // jamais rouge : ce n'est pas éliminatoire
    expect(planPhrase(null)).toBeNull();
  });

  it("arrivée dans ou hors délai", () => {
    expect(finishPhrase(2292, 2400)).toEqual({ level: "ok", text: "Arrivé en 38 h 12 — dans les délais (1 h 48 d'avance)" });
    expect(finishPhrase(2430, 2400).level).toBe("late");
  });

  it("pluie en mots", () => {
    expect(rainPhrase(0.05, 0)).toEqual({ level: "dry", text: "Pas de pluie prévue (5 %)" });
    expect(rainPhrase(0.45, 1.2)).toEqual({ level: "maybe", text: "Risque d'averses (45 %, ~1 mm)" });
    expect(rainPhrase(0.8, 4)).toEqual({ level: "likely", text: "Pluie probable (80 %, ~4 mm)" });
    expect(rainPhrase(0.1, 0.6).level).toBe("maybe"); // pluie mesurée malgré une faible probabilité
  });
});
