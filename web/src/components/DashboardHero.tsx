import { useEffect, useState } from "react";
import type { BrmEvent } from "../api/brm";
import { getQualification, type Qualification } from "../api/brmCatalog";
import { PBP_DATE } from "../lib/brmMeta";
import { Countdown } from "./Countdown";

// Qualification calculée par le serveur : BRM perso + BRM du calendrier marqués
// « Homologué » ; un 1000 vaut pour l'étape 600. `events` (BRM perso) sert seulement à
// relancer le calcul quand un statut change sur le tableau de bord.
export function DashboardHero({ events }: { events: BrmEvent[] | null }) {
  const [q, setQ] = useState<Qualification | null>(null);
  const statusKey = (events ?? []).map((e) => `${e.id}:${e.status}`).join(",");

  useEffect(() => {
    getQualification()
      .then(setQ)
      .catch(() => setQ(null));
  }, [statusKey]);

  const total = q?.total ?? 4;
  const done = q?.steps.filter((s) => s.done).length ?? 0;
  const pct = Math.round((done / total) * 100);

  return (
    <div className="hero">
      <div>
        <div className="label">Départ Paris-Brest-Paris 2027</div>
        <h1 style={{ fontSize: "clamp(20px,3vw,28px)" }}>Rambouillet, dimanche 22 août 2027</h1>
        <Countdown target={PBP_DATE} />
        <div className="meta">Brevet de 1200 km homologué ACP — 4 BRM de qualification requis dans la saison précédente (un 1000 compte pour le 600).</div>
      </div>
      <div className="quali">
        <div className="label">Qualification BRM</div>
        <div className="quali-pct">
          {done} / {total}
        </div>
        <div className="quali-bar">
          <div style={{ width: `${pct}%` }} />
        </div>
        {q && (
          <ul className="quali-steps" aria-label="Étapes de qualification">
            {q.steps.map((s) => (
              <li key={s.step} className={s.done ? "is-done" : undefined} title={s.by ? `${s.by.distance} km — ${s.by.lieu}, ${s.by.date}` : "Pas encore homologué"}>
                {s.done ? "✓" : "○"} {s.step}
                {s.done && s.by && s.by.distance !== s.step ? <small> (via {s.by.distance})</small> : null}
              </li>
            ))}
          </ul>
        )}
        <div className="meta" style={{ margin: 0 }}>
          {pct}% des distances requises homologuées
          {q && !q.catalogAvailable ? " · calendrier ACP indisponible : seuls tes BRM perso sont comptés" : ""}
        </div>
      </div>
    </div>
  );
}
