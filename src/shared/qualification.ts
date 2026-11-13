// Qualification au PBP : une série 200, 300, 400 et 600 km homologués dans la saison.
// Un BRM 1000 homologué vaut pour l'étape 600 (il la remplace dans la série).

export const QUALIFYING_STEPS = [200, 300, 400, 600] as const;

// Étape de la série couverte par un brevet d'une distance donnée (null si aucune).
export function stepFor(distance: number): number | null {
  if (distance >= 1000) return 600;
  return (QUALIFYING_STEPS as readonly number[]).includes(distance) ? distance : null;
}

// Étapes de la série couvertes par les brevets homologués.
export function qualifiedSteps(events: { distance: number; status: string }[]): Set<number> {
  const steps = new Set<number>();
  for (const e of events) {
    if (e.status !== "homologue") continue;
    const s = stepFor(e.distance);
    if (s !== null) steps.add(s);
  }
  return steps;
}
