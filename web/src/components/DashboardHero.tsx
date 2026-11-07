import type { BrmEvent } from "../api/brm";
import { PBP_DATE, VALID_DISTANCES } from "../lib/brmMeta";
import { Countdown } from "./Countdown";

export function DashboardHero({ events }: { events: BrmEvent[] | null }) {
  const homologatedDistances = new Set((events ?? []).filter((e) => e.status === "homologue").map((e) => e.distance));
  const done = homologatedDistances.size;
  const total = VALID_DISTANCES.length;
  const pct = Math.round((done / total) * 100);

  return (
    <div className="hero">
      <div>
        <div className="label">Départ Paris-Brest-Paris 2027</div>
        <h1 style={{ fontSize: "clamp(20px,3vw,28px)" }}>Rambouillet, dimanche 17 août 2027</h1>
        <Countdown target={PBP_DATE} />
        <div className="meta">Brevet de 1200 km homologué ACP — 4 BRM de qualification requis dans la saison précédente.</div>
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
