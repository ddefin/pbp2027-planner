import { BRM_PLAN, PBP_DATE } from "../lib/brmPlan";
import { Countdown } from "./Countdown";

export function DashboardHero() {
  const done = BRM_PLAN.filter((b) => b.status === "homologue" || b.status === "fait").length;
  const pct = Math.round((done / BRM_PLAN.length) * 100);
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
          {done} / {BRM_PLAN.length}
        </div>
        <div className="quali-bar">
          <div style={{ width: `${pct}%` }} />
        </div>
        <div className="meta" style={{ margin: 0 }}>
          {pct}% des brevets requis homologués
        </div>
      </div>
    </div>
  );
}
