import type { BrmEvent } from "../api/brm";
import { PBP_DATE } from "../lib/brmMeta";
import { QUALIFYING_STEPS, qualifiedSteps } from "../../../src/shared/qualification";
import { Countdown } from "./Countdown";

export function DashboardHero({ events }: { events: BrmEvent[] | null }) {
  // Série 200/300/400/600 ; un 1000 homologué vaut pour l'étape 600.
  const done = qualifiedSteps(events ?? []).size;
  const total = QUALIFYING_STEPS.length;
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
        <div className="meta" style={{ margin: 0 }}>
          {pct}% des distances requises homologuées
        </div>
      </div>
    </div>
  );
}
