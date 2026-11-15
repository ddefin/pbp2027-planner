import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { getSharedLive, getSharedRoadbook, getSharedSituation, type Checkin, type LiveView, type SharedRoadbook } from "../api/roadbooks";
import { ElevationProfile } from "../components/ElevationProfile";
import { Disclosure } from "../components/Disclosure";
import { WhatsAppShare } from "../components/roadbook/WhatsAppShare";
import { ScheduleTable } from "../components/roadbook/ScheduleTable";
import { LiveHeader } from "../components/live/LiveHeader";
import { LiveMap } from "../components/live/LiveMap";
import { ProgressPanel } from "../components/live/ProgressPanel";
import { CheckinTimeline } from "../components/live/CheckinTimeline";
import { WeatherWind } from "../components/live/WeatherWind";
import { buildModel } from "../components/live/model";
import { pointAtKm } from "../lib/routeMath";

const REFRESH_MS = 60_000;

// Page publique (sans compte) ouverte par les proches depuis le lien de suivi : 4 blocs
// (statut et liens de suivi continu, carte, progression et journal, météo et vent).
// Tout part des pointages volontaires du randonneur : pas de suivi GPS continu ici.
export function SharedRoadbookPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<{ roadbook: SharedRoadbook; checkins: Checkin[] } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [situation, setSituation] = useState<{ whatsapp: string; at: string } | null>(null);
  const [live, setLive] = useState<LiveView | null>(null);
  const [now, setNow] = useState(() => new Date());
  const lastAt = data?.checkins[0]?.at ?? null;

  // « il y a … », position estimée : recalculés chaque minute sans recharger.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Le résumé à partager n'est recalculé qu'à l'arrivée d'un NOUVEAU pointage.
  useEffect(() => {
    if (!token || !lastAt) return;
    getSharedSituation(token).then(setSituation).catch(() => setSituation(null));
  }, [token, lastAt]);

  // Vue en direct (météo, prévisions) : le serveur la garde 10 min.
  useEffect(() => {
    if (!token || !lastAt) return;
    const load = () => getSharedLive(token).then(setLive).catch(() => undefined);
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => clearInterval(t);
  }, [token, lastAt]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const load = () =>
      getSharedRoadbook(token)
        .then((d) => !cancelled && setData(d))
        .catch(() => !cancelled && setNotFound(true));
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token]);

  const model = useMemo(() => (data ? buildModel(data.roadbook, data.checkins, live, now) : null), [data, live, now]);

  useEffect(() => {
    if (data) document.title = `${data.roadbook.author} · ${data.roadbook.title} — suivi`;
  }, [data]);

  if (notFound && !data) {
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <h1>Lien expiré</h1>
          <p className="hint">Ce lien de suivi n'existe pas ou a été désactivé par son auteur.</p>
        </div>
      </main>
    );
  }
  if (!data || !model) return <p className="hint" style={{ padding: 24 }}>Chargement du suivi…</p>;

  const rb = data.roadbook;
  const last = data.checkins[0] ?? null;
  const position = last ? (last.lat !== null && last.lon !== null ? { lat: last.lat, lon: last.lon } : pointAtKm(rb.points, last.km)) : null;
  const markers = model.schedule.filter((r) => r.index > 0).map((r) => ({ km: r.km, label: String(r.index) }));

  return (
    <div className="lv">
      <LiveHeader author={rb.author} title={rb.title} model={model} live={live} liveTrackUrl={rb.liveTrackUrl} beaconUrl={rb.beaconUrl} now={now} />
      <main className="lv-grid">
        <div className="lv-col-main">
          <section className="lv-card lv-card-flush" aria-label="Carte du parcours">
            <LiveMap points={rb.points} model={model} now={now} />
          </section>
          <ProgressPanel model={model} live={live} limitMinutes={rb.limitMinutes} now={now} />
          <section className="lv-card" aria-labelledby="lv-prof-title">
            <h2 id="lv-prof-title">Profil du parcours</h2>
            <p className="lv-sub">Partie déjà parcourue plus foncée, trait bleu au dernier pointage, numéros des contrôles en bas.</p>
            <ElevationProfile points={rb.points} markers={markers} cursorKm={last ? last.km : null} doneKm={last ? last.km : null} showClimbList={false} />
          </section>
        </div>
        <div className="lv-col-side">
          <WeatherWind live={live} position={position} now={now} />
          <CheckinTimeline checkins={data.checkins} points={rb.points} model={model} now={now} />
          <section className="lv-card">
            <Disclosure title="Horaires prévus aux contrôles" summary={`${model.schedule.length} contrôles · plan de ${rb.author}`}>
              <ScheduleTable schedule={model.schedule} controls={rb.controls} startAt={rb.startAt} passedKm={last?.km ?? null} editable={false} />
            </Disclosure>
          </section>
          {last && (
            <section className="lv-card">
              <h2>Partager le point de situation</h2>
              <WhatsAppShare text={situation?.whatsapp ?? null} at={situation?.at} />
            </section>
          )}
        </div>
      </main>
      <footer className="lv-footer">
        Page mise à jour automatiquement à chaque pointage du randonneur. Entre deux pointages, sa position n'est pas connue
        {rb.liveTrackUrl || rb.beaconUrl ? " : utilisez le suivi GPS continu en haut de page." : "."}
      </footer>
    </div>
  );
}
