import { fitness, intensityShare, lastDays, sumVolume, type ActivityInput, type Fitness, type IntensityShare } from "./stravaMetrics.js";

// Moteur d'analyse du Coach : des RÈGLES transparentes appliquées aux chiffres (pas de
// modèle de langage : les données de santé du sportif ne quittent pas le serveur et
// chaque conseil est explicable). Les réglages (profil, ton, métriques) ne changent que
// les seuils, le vocabulaire et les conseils retenus.

export type CoachProfile = "endurance" | "performance" | "forme";
export type CoachTone = "bienveillant" | "direct" | "technique";
export type CoachMetric = "hr" | "power" | "elevation" | "speed";

export interface CoachPrefsInput {
  profile: CoachProfile;
  tone: CoachTone;
  metrics: CoachMetric[];
  goal: string | null;
}

export type Level = "ok" | "attention" | "alerte" | "info";

export interface Insight {
  level: Level;
  title: string;
  text: string;
}

export interface CoachReport {
  headline: { level: Level; text: string };
  diagnostics: Insight[];
  balance: Insight | null;
  metrics: Insight[];
  advice: string[];
  facts: { fitness: Fitness; intensity: IntensityShare; volumeChangePct: number | null };
}

const pct = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n)} %`;
const num = (n: number, d = 0) => n.toLocaleString("fr-FR", { maximumFractionDigits: d });

// Phrases selon le ton : même diagnostic, formulation différente.
function say(tone: CoachTone, v: { bienveillant: string; direct: string; technique: string }): string {
  return v[tone];
}

export function analyze(list: ActivityInput[], prefs: CoachPrefsInput, today: Date): CoachReport {
  const fit = fitness(list, today);
  const week = sumVolume(lastDays(list, 7, today));
  const prev3 = sumVolume(lastDays(list, 21, today, 7));
  const prevWeeklyHours = prev3.hours / 3;
  const prevWeeklyLoad = prev3.load / 3;
  const volumeChangePct = prevWeeklyLoad > 0 ? ((week.load - prevWeeklyLoad) / prevWeeklyLoad) * 100 : prevWeeklyHours > 0 ? ((week.hours - prevWeeklyHours) / prevWeeklyHours) * 100 : null;
  const share = intensityShare(lastDays(list, 7, today));
  const share28 = intensityShare(lastDays(list, 28, today));
  const diagnostics: Insight[] = [];
  const advice: string[] = [];
  const t = prefs.tone;
  const endurance = prefs.profile === "endurance";

  const noData = list.length === 0 || lastDays(list, 56, today).length === 0;
  if (noData) {
    return {
      headline: { level: "info", text: "Pas encore assez de sorties récentes pour analyser ta forme." },
      diagnostics: [],
      balance: null,
      metrics: [],
      advice: ["Synchronise tes sorties Strava (ou fais une première sortie) : l'analyse démarre dès que quelques semaines sont disponibles."],
      facts: { fitness: fit, intensity: share, volumeChangePct },
    };
  }

  // 1) Évolution brutale du volume (> 15 %) et ratio de charge aiguë/chronique.
  const surge = volumeChangePct ?? 0;
  let headline: CoachReport["headline"];
  if ((fit.acwr !== null && fit.acwr > 1.5) || surge > 40) {
    headline = { level: "alerte", text: say(t, { bienveillant: "Attention, tu as beaucoup chargé : ton corps a besoin de souffler.", direct: "Surmenage probable : charge trop forte, lève le pied.", technique: `Charge aiguë excessive (ACWR ${fit.acwr ?? "—"}) : risque de surmenage.` }) };
    diagnostics.push({ level: "alerte", title: "Risque de surmenage", text: `Ta charge des 7 derniers jours (${week.load}) dépasse nettement ta moyenne habituelle (${fit.chronic}/semaine)${volumeChangePct !== null ? `, soit ${pct(volumeChangePct)} par rapport aux 3 semaines précédentes` : ""}. Au-delà de +15 % par semaine, le risque de blessure ou de fatigue durable augmente.` });
    advice.push("Prends 1 à 2 jours de repos complet ou une sortie très facile (Z1, < 1 h, cadence souple) avant de reprendre.");
  } else if ((fit.acwr !== null && fit.acwr > 1.3) || surge > 15) {
    headline = { level: "attention", text: say(t, { bienveillant: "Belle progression, mais garde un œil sur la récupération.", direct: "Hausse de charge marquée : surveille ta fatigue.", technique: `Charge en hausse (ACWR ${fit.acwr ?? "—"}) : zone de vigilance.` }) };
    diagnostics.push({ level: "attention", title: "Volume en hausse rapide", text: `Ta charge récente progresse${volumeChangePct !== null ? ` de ${pct(volumeChangePct)}` : ""} par rapport aux semaines précédentes. Reste sous +10 à +15 % par semaine pour que ton corps assimile.` });
    advice.push("Garde la semaine à venir à charge égale (pas de nouvelle hausse), avec au moins un jour très facile.");
  } else if ((fit.acwr !== null && fit.acwr < 0.8 && fit.chronic > 0) || surge < -30) {
    headline = { level: "info", text: say(t, { bienveillant: "Semaine plus calme : bon moment pour relancer en douceur.", direct: "Sous-entraînement relatif : ta charge a chuté.", technique: `Charge aiguë basse (ACWR ${fit.acwr ?? "—"}) : désentraînement possible.` }) };
    diagnostics.push({ level: "info", title: "Charge en baisse", text: `Tu as roulé moins que d'habitude cette semaine (charge ${week.load} contre ${fit.chronic} en moyenne). Si c'est voulu (récupération, repos), c'est parfait ; sinon relance progressivement.` });
    advice.push(endurance ? "Reprends avec une sortie d'endurance de 2 à 3 h en Z2, sans chercher l'intensité." : "Reprends avec une sortie de 1 h 30 en endurance, puis remonte l'intensité d'ici 3 à 4 jours.");
  } else {
    headline = { level: "ok", text: say(t, { bienveillant: "Tu es sur une très bonne dynamique, continue comme ça !", direct: "Charge maîtrisée, dans la bonne zone.", technique: `Charge dans la zone optimale (ACWR ${fit.acwr ?? "—"}).` }) };
    diagnostics.push({ level: "ok", title: "Charge maîtrisée", text: `Ta charge de la semaine (${week.load}) est cohérente avec ton habitude (${fit.chronic}/semaine) : progression saine.` });
  }

  // 2) Forme / fatigue (fraîcheur = forme - fatigue).
  if (fit.tsb <= -30) {
    diagnostics.push({ level: "alerte", title: "Fatigue élevée", text: `Ta fraîcheur est très basse (${fit.tsb}) : la fatigue accumulée dépasse largement ta forme. Une semaine allégée t'aidera à encaisser la charge.` });
    if (!advice.some((a) => /repos|facile/i.test(a))) advice.push("Allège les 3 à 5 prochains jours : sorties courtes et faciles, sommeil prioritaire.");
  } else if (fit.tsb <= -20) {
    diagnostics.push({ level: "attention", title: "Fatigue marquée", text: `Ta fraîcheur est basse (${fit.tsb}) : tu portes une fatigue notable par rapport à ta forme. Prévois une journée facile dans les prochains jours.` });
  } else if (fit.tsb >= 15) {
    diagnostics.push({ level: "info", title: "Bien reposé", text: `Ta fraîcheur est élevée (+${fit.tsb}) : tu es frais. C'est le bon moment pour une sortie exigeante ou un objectif.` });
  } else {
    diagnostics.push({ level: "ok", title: "Équilibre forme / fatigue", text: `Forme ${fit.ctl} · fatigue ${fit.atl} · fraîcheur ${fit.tsb > 0 ? "+" : ""}${fit.tsb} : équilibre correct.` });
  }

  // 3) Polarisation.
  let balance: Insight | null = null;
  const useShare = share.coveredSeconds >= 3600 ? share : share28.coveredSeconds >= 3 * 3600 ? share28 : null;
  const scope = useShare === share ? "cette semaine" : "ces 4 dernières semaines";
  if (useShare) {
    if (useShare.low >= 75) {
      balance = { level: "ok", title: "Bon socle d'endurance", text: `${useShare.low} % de ton temps ${scope} était en endurance (Z1-Z2) : excellent socle aérobie${useShare.high >= 10 ? `, avec ${useShare.high} % de haute intensité` : ""}.` };
    } else if (useShare.mid >= 35) {
      balance = { level: "attention", title: "Trop de « zone grise »", text: `${useShare.mid} % de ton temps ${scope} était en allure moyenne (Z3) : trop dur pour récupérer, pas assez pour progresser vite. Sépare mieux tes sorties : très faciles ou vraiment intenses.` };
      advice.push("Ralentis tes sorties de base (Z2, tu dois pouvoir parler) et réserve l'intensité à 1 séance par semaine.");
    } else if (useShare.high >= 30) {
      balance = { level: "attention", title: "Beaucoup d'intensité", text: `${useShare.high} % de ton temps ${scope} était en haute intensité (Z4-Z5) : c'est beaucoup. L'idéal tourne autour de 80 % facile / 20 % dur.` };
    } else {
      balance = { level: "info", title: "Répartition des intensités", text: `${useShare.low} % endurance · ${useShare.mid} % allure moyenne · ${useShare.high} % haute intensité ${scope}.` };
    }
  } else {
    balance = { level: "info", title: "Intensités non mesurables", text: "Pas assez de sorties avec cardiofréquencemètre ou capteur de puissance pour évaluer la répartition des intensités." };
  }

  // 4) Métriques prioritaires.
  const metrics: Insight[] = [];
  const recent = lastDays(list, 28, today);
  const before = lastDays(list, 28, today, 28);
  const avg = (l: ActivityInput[], f: (a: ActivityInput) => number | null) => {
    const v = l.map(f).filter((x): x is number => x !== null && x > 0);
    return v.length >= 2 ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  const trend = (a: number | null, b: number | null) => (a !== null && b !== null && b > 0 ? ((a - b) / b) * 100 : null);
  if (prefs.metrics.includes("hr")) {
    const a = avg(recent, (x) => x.avgHr), b = avg(before, (x) => x.avgHr);
    if (a !== null) metrics.push({ level: "info", title: "Fréquence cardiaque", text: `FC moyenne des sorties : ${Math.round(a)} bpm${b !== null ? ` (${Math.round(a - b) > 0 ? "+" : ""}${Math.round(a - b)} bpm vs les 4 semaines précédentes)` : ""}. À allure égale, une FC qui baisse signale un gain de forme.` });
  }
  if (prefs.metrics.includes("power")) {
    const a = avg(recent, (x) => x.weightedWatts ?? x.avgWatts), b = avg(before, (x) => x.weightedWatts ?? x.avgWatts);
    if (a !== null) { const tr = trend(a, b); metrics.push({ level: "info", title: "Puissance", text: `Puissance moyenne pondérée : ${Math.round(a)} W${tr !== null ? ` (${pct(tr)} vs les 4 semaines précédentes)` : ""}.` }); }
  }
  if (prefs.metrics.includes("elevation")) {
    const w = sumVolume(recent), wb = sumVolume(before);
    const tr = wb.elevationM > 0 ? ((w.elevationM - wb.elevationM) / wb.elevationM) * 100 : null;
    metrics.push({ level: "info", title: "Dénivelé", text: `${num(w.elevationM)} m de D+ sur 4 semaines (${num(w.elevationM / 4)} m par semaine)${tr !== null ? `, ${pct(tr)} vs les 4 semaines précédentes` : ""}.` });
  }
  if (prefs.metrics.includes("speed")) {
    const a = avg(recent, (x) => (x.avgSpeedMs ? x.avgSpeedMs * 3.6 : null)), b = avg(before, (x) => (x.avgSpeedMs ? x.avgSpeedMs * 3.6 : null));
    if (a !== null) { const tr = trend(a, b); metrics.push({ level: "info", title: "Vitesse", text: `Vitesse moyenne des sorties : ${num(a, 1)} km/h${tr !== null ? ` (${pct(tr)} vs les 4 semaines précédentes)` : ""}.` }); }
  }

  // 5) Conseils spécifiques au profil.
  const longest14 = Math.max(0, ...lastDays(list, 14, today).map((a) => a.distanceM / 1000));
  const calm = headline.level === "ok" || headline.level === "info";
  if (endurance) {
    if (calm && longest14 < 100) advice.push(`Programme une longue sortie de 120 à 150 km en Z2 ce week-end (ta plus longue récente : ${Math.round(longest14)} km) : c'est la base d'un BRM 300+.`);
    advice.push("Avant la prochaine sortie longue : viser 60 g de glucides et ~500 ml d'eau par heure, et tester ton alimentation de course à l'entraînement, pas le jour J.");
  } else if (prefs.profile === "performance") {
    if (fit.tsb >= 5 && fit.tsb < 30) advice.push("Tu es assez frais : place une séance de qualité (3 × 10 min au seuil) dans les 48 h, puis une sortie facile.");
    advice.push("Garde 2 séances intenses maximum par semaine, séparées d'au moins 48 h, et protège ton sommeil.");
  } else {
    advice.push("Vise la régularité : 3 sorties par semaine, dont une plus longue à allure facile, plutôt qu'un gros effort isolé.");
    if (calm) advice.push("Augmente la durée de ta sortie la plus longue de 10 minutes cette semaine.");
  }
  if (prefs.goal?.trim()) advice.push(`Objectif « ${prefs.goal.trim().slice(0, 80)} » : garde-le en tête pour choisir entre repos et séance cette semaine.`);

  return { headline, diagnostics, balance, metrics, advice: advice.slice(0, 3), facts: { fitness: fit, intensity: share, volumeChangePct } };
}
