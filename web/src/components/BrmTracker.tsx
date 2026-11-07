import { BRM_PLAN, STATUS_LABEL } from "../lib/brmPlan";

export function BrmTracker() {
  return (
    <section className="panel">
      <h2>Suivi des BRM de qualification</h2>
      <div className="brm-grid">
        {BRM_PLAN.map((b) => (
          <div className="brm-card" key={b.dist}>
            <div className="dist">
              {b.dist} <small>km</small>
            </div>
            <span className={`pill ${b.status}`}>{STATUS_LABEL[b.status]}</span>
            <div className="row">
              <span>Date</span>
              <b className="tabular">{b.date}</b>
            </div>
            <div className="row">
              <span>Lieu</span>
              <b>{b.lieu}</b>
            </div>
            <div className="row">
              <span>Limite</span>
              <b className="tabular">{b.limite}</b>
            </div>
            {b.temps && (
              <div className="row">
                <span>Réalisé</span>
                <b className="tabular">{b.temps}</b>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
