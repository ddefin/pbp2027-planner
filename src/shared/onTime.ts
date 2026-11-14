// Phrases « est-il dans les temps ? » pour la page des proches : en toutes lettres, sans
// jargon. Deux notions bien séparées : la barrière horaire officielle (fermeture du
// prochain contrôle : la dépasser, c'est être hors délai) et son plan personnel (les
// horaires qu'il s'était fixés : être en retard dessus n'a rien de grave).

export type OnTimeLevel = "ok" | "tight" | "late";

export function humanDuration(min: number): string {
  const m = Math.max(0, Math.round(Math.abs(min)));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
}

export const BARRIER_TIGHT_MIN = 45; // même seuil que computeLiveStatus

export function barrierPhrase(p: { marginMin: number | null; level: OnTimeLevel | null; controlName: string | null }): { level: OnTimeLevel; short: string; long: string } | null {
  if (p.marginMin === null || !p.level || !p.controlName) return null;
  // « Contrôle Tinténiac » → « du contrôle de Tinténiac » ; « Arrivée Brest » reste tel quel.
  const bare = p.controlName.replace(/^contr[oô]le\s+(de\s+|d['’]\s*)?/i, "").trim();
  const name = bare !== p.controlName ? `du contrôle de ${bare}` : `de ${p.controlName}`;
  const at = bare !== p.controlName ? `au contrôle de ${bare}` : `à ${p.controlName}`;
  if (p.level === "late" || p.marginMin < 0) {
    return { level: "late", short: "En retard sur la barrière horaire", long: `En retard sur la barrière horaire ${name} : à ce rythme, il y arriverait après la fermeture.` };
  }
  if (p.level === "tight" || p.marginMin < BARRIER_TIGHT_MIN) {
    return { level: "tight", short: `Juste — ${humanDuration(p.marginMin)} de marge`, long: `Juste : ${humanDuration(p.marginMin)} de marge ${at} avant sa fermeture.` };
  }
  return { level: "ok", short: `Dans les temps — ${humanDuration(p.marginMin)} d'avance`, long: `Dans les temps : ${humanDuration(p.marginMin)} d'avance sur la fermeture ${name}.` };
}

export function planPhrase(deltaMin: number | null): { level: OnTimeLevel; text: string } | null {
  if (deltaMin === null) return null;
  if (Math.abs(deltaMin) < 5) return { level: "ok", text: "Pile à l'heure de son plan" };
  if (deltaMin > 0) return { level: "ok", text: `${humanDuration(deltaMin)} d'avance sur son plan` };
  // Jamais en rouge : être en retard sur SON plan n'élimine pas (c'est la barrière qui compte).
  return { level: "tight", text: `${humanDuration(deltaMin)} de retard sur son plan` };
}

export function finishPhrase(elapsedMin: number, limitMinutes: number): { level: OnTimeLevel; text: string } {
  const diff = limitMinutes - elapsedMin;
  return diff >= 0
    ? { level: "ok", text: `Arrivé en ${humanDuration(elapsedMin)} — dans les délais (${humanDuration(diff)} d'avance)` }
    : { level: "late", text: `Arrivé en ${humanDuration(elapsedMin)} — hors délai officiel (${humanDuration(diff)} de dépassement)` };
}

// Pluie d'un créneau, en mots. `mm` : cumul prévu sur le créneau.
export function rainPhrase(probability: number, mm: number | null): { level: "dry" | "maybe" | "likely"; text: string } {
  const pct = Math.round(probability * 100);
  const amount = mm && mm >= 0.2 ? `, ~${mm < 1 ? mm.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : Math.round(mm)} mm` : "";
  if (probability >= 0.6) return { level: "likely", text: `Pluie probable (${pct} %${amount})` };
  if (probability >= 0.25 || (mm ?? 0) >= 0.5) return { level: "maybe", text: `Risque d'averses (${pct} %${amount})` };
  return { level: "dry", text: `Pas de pluie prévue (${pct} %)` };
}
