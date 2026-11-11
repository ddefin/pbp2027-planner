import { useMemo, useState } from "react";
import { Disclosure } from "../Disclosure";
import { DEFAULT_NUTRITION, formatMinutes, nutritionPlan, type NutritionSettings, type ScheduleRow } from "../../lib/roadbook";
import type { RoadbookPoi } from "../../api/roadbooks";

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

// Liste type d'un brevet : le règlement ACP impose l'éclairage et la carte de contrôle ;
// le reste vient de l'expérience (à adapter, supprimer ou compléter ci-dessous).
const DEFAULT_ITEMS: { id: string; label: string }[] = [
  { id: "lampe-av", label: "Éclairage avant chargé (+ batterie de secours)" },
  { id: "lampe-ar", label: "Éclairage arrière (feu fixe) chargé" },
  { id: "gilet", label: "Gilet réfléchissant + bandes sur le casque ou le sac" },
  { id: "carte", label: "Carte de brevet / carte de contrôle + stylo" },
  { id: "licence", label: "Licence ou pièce d'identité + carte bancaire / espèces" },
  { id: "gpx", label: "Parcours chargé sur le compteur (GPX / TCX) et testé" },
  { id: "compteur", label: "Compteur GPS et téléphone chargés + batterie externe + câbles" },
  { id: "livetrack", label: "LiveTrack lancé et lien partagé aux proches" },
  { id: "crevaison", label: "Kit crevaison : chambre(s), démonte-pneus, rustines, mini-pompe" },
  { id: "outils", label: "Multi-outil, maillon rapide, lubrifiant" },
  { id: "bidons", label: "Bidons remplis, barres / gels / en-cas pour le premier tronçon" },
  { id: "meteo", label: "Météo vérifiée : vêtements chaud/pluie, coupe-vent, gants" },
  { id: "pharmacie", label: "Crème anti-frottements, médicaments personnels, couverture de survie" },
  { id: "velo", label: "Vélo vérifié : pneus gonflés, freins, chaîne, serrages" },
];

export function checklistWithDefaults(stored: ChecklistItem[] | undefined): ChecklistItem[] {
  return stored && stored.length > 0 ? stored : DEFAULT_ITEMS.map((i) => ({ ...i, done: false }));
}

export function ChecklistCard({ stored, onChange }: { stored: ChecklistItem[] | undefined; onChange: (items: ChecklistItem[]) => void }) {
  const items = checklistWithDefaults(stored);
  const [draft, setDraft] = useState("");
  const done = items.filter((i) => i.done).length;
  const complete = done === items.length && items.length > 0;
  return (
    <Disclosure
      title="✅ Check-list de départ"
      summary={complete ? `✓ Tout est prêt (${done}/${items.length})` : `${done}/${items.length} cochés`}
      tone={complete ? "ok" : "muted"}
      storageKey="rb.reglages.checklist"
    >
      <div className="rb-checklist">
        {items.map((it) => (
          <label key={it.id} className={`rb-check${it.done ? " is-done" : ""}`}>
            <input type="checkbox" checked={it.done} onChange={() => onChange(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))} />
            <span>{it.label}</span>
            <button type="button" className="linklike" aria-label={`Retirer « ${it.label} »`} onClick={() => onChange(items.filter((x) => x.id !== it.id))}>
              ✕
            </button>
          </label>
        ))}
      </div>
      <form
        className="live-inline"
        onSubmit={(e) => {
          e.preventDefault();
          const label = draft.trim();
          if (!label) return;
          setDraft("");
          onChange([...items, { id: `perso-${Date.now().toString(36)}`, label, done: false }]);
        }}
      >
        <input className="rb-input" placeholder="Ajouter un élément…" value={draft} maxLength={120} onChange={(e) => setDraft(e.target.value)} aria-label="Nouvel élément" />
        <button type="submit" className="ghost">
          Ajouter
        </button>
      </form>
      <p className="hint" style={{ marginBottom: 0 }}>
        <button type="button" className="linklike" onClick={() => confirm("Remettre la liste type et tout décocher ?") && onChange(DEFAULT_ITEMS.map((i) => ({ ...i, done: false })))}>
          Remettre la liste type
        </button>
      </p>
    </Disclosure>
  );
}

const NUTRI_KEY = "pbp.roadbook.nutrition";
function readNutrition(): NutritionSettings {
  try {
    return { ...DEFAULT_NUTRITION, ...JSON.parse(localStorage.getItem(NUTRI_KEY) ?? "{}") };
  } catch {
    return DEFAULT_NUTRITION;
  }
}

export function NutritionCard({ schedule, pois }: { schedule: ScheduleRow[]; pois: RoadbookPoi[] }) {
  const [settings, setSettings] = useState<NutritionSettings>(readNutrition);
  const plan = useMemo(() => nutritionPlan(schedule, pois, settings), [schedule, pois, settings]);
  const refills = plan.segments.filter((s) => s.needsRefill).length;

  function set(patch: Partial<NutritionSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      localStorage.setItem(NUTRI_KEY, JSON.stringify(next));
    } catch {
      /* non mémorisé */
    }
  }
  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);

  return (
    <Disclosure
      title="🥤 Nutrition et ravitaillement"
      summary={`${plan.totalWaterL} L d'eau · ${Math.round(plan.totalCarbsG / 10) * 10} g de glucides${refills ? ` · ⚠ ${refills} tronçon${refills > 1 ? "s" : ""} à ravitailler` : ""}`}
      tone={refills ? "warn" : "muted"}
      storageKey="rb.roadbook.nutrition"
    >
      <div className="rb-nutri-settings">
        <label>
          Eau (ml/h)
          <input className="rb-input rb-input-num" inputMode="numeric" value={settings.waterMlPerHour} onChange={(e) => set({ waterMlPerHour: num(e.target.value, DEFAULT_NUTRITION.waterMlPerHour) })} />
        </label>
        <label>
          Glucides (g/h)
          <input className="rb-input rb-input-num" inputMode="numeric" value={settings.carbsGPerHour} onChange={(e) => set({ carbsGPerHour: num(e.target.value, DEFAULT_NUTRITION.carbsGPerHour) })} />
        </label>
        <label>
          Réserve embarquée (ml)
          <input className="rb-input rb-input-num" inputMode="numeric" value={settings.bottleMl} onChange={(e) => set({ bottleMl: num(e.target.value, DEFAULT_NUTRITION.bottleMl) })} />
        </label>
      </div>
      <div className="rb-table-wrap">
        <table className="rb-table tabular">
          <thead>
            <tr>
              <th>Tronçon</th>
              <th>Roulage</th>
              <th>Eau</th>
              <th>Glucides</th>
              <th>Points en route</th>
            </tr>
          </thead>
          <tbody>
            {plan.segments.map((s) => (
              <tr key={`${s.fromKm}-${s.toKm}`} className={s.needsRefill ? "lvl-row-tight" : undefined}>
                <td>
                  {s.from} → {s.to}
                  <br />
                  <span className="hint" style={{ margin: 0 }}>
                    {s.km} km
                  </span>
                </td>
                <td>{formatMinutes(s.rideMin)}</td>
                <td>{(s.waterMl / 1000).toFixed(1)} L</td>
                <td>
                  {s.carbsG} g<br />
                  <span className="hint" style={{ margin: 0 }}>
                    ≈ {s.kcal} kcal
                  </span>
                </td>
                <td>
                  {s.stops.length === 0 ? (
                    <span className="hint" style={{ margin: 0 }}>
                      {s.needsRefill ? "⚠ rien de repéré : emporte plus d'eau" : "—"}
                    </span>
                  ) : (
                    s.stops.map((p) => (
                      <div key={`${p.km}-${p.name}`}>
                        {p.kind === "eau" ? "💧" : "🍴"} {p.name} <span className="hint">km {Math.round(p.km)}</span>
                      </div>
                    ))
                  )}
                  {s.needsRefill && s.stops.length > 0 && <div className="hint">⚠ plus long tronçon sans point : {s.longestGapKm} km</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginBottom: 0 }}>
        Estimation d'après le temps de roulage prévu (pauses aux contrôles exclues). Les points d'eau et de ravitaillement sont ceux
        du GPX, reconnus à leur nom (fontaine, boulangerie, supermarché…) : vérifie leurs horaires d'ouverture, surtout la nuit.
      </p>
    </Disclosure>
  );
}

export function GpsExportCard({ roadbookId }: { roadbookId: string }) {
  return (
    <Disclosure title="⌚ Compteur GPS" summary="GPX ou TCX avec contrôles, horaires et points d'eau" storageKey="rb.reglages.gps">
      <p className="hint" style={{ margin: 0 }}>
        Exporte le roadbook pour ton compteur : le tracé, les contrôles (avec heures d'ouverture et de fermeture) et les points d'eau /
        ravitaillement deviennent des points de parcours.
      </p>
      <div className="rb-card-actions">
        <a className="ghost-link" href={`/api/roadbooks/${roadbookId}/export?format=gpx`} download>
          GPX · Garmin, Wahoo, Karoo, Hammerhead
        </a>
        <a className="ghost-link" href={`/api/roadbooks/${roadbookId}/export?format=tcx`} download>
          TCX « Course » · import Garmin Connect
        </a>
      </div>
      <p className="hint" style={{ marginBottom: 0 }}>
        Garmin : Garmin Connect → Entraînement → Parcours → Importer, puis synchronise le compteur. Wahoo / Karoo / Hammerhead :
        importe le GPX dans l'application du compteur (ou via Komoot / Strava / RideWithGPS).
      </p>
    </Disclosure>
  );
}
