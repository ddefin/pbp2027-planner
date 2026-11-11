import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getSharedRoadbook, getSharedSituation, type Checkin, type SharedRoadbook } from "../api/roadbooks";
import { WhatsAppShare } from "../components/roadbook/WhatsAppShare";
import { RoadbookView } from "../components/roadbook/RoadbookView";

const REFRESH_MS = 60_000;

function ago(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  return `il y a ${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}

// Page publique (sans compte) ouverte depuis le lien de suivi : lecture seule,
// rafraîchie chaque minute pour suivre la progression pendant le brevet.
export function SharedRoadbookPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<{ roadbook: SharedRoadbook; checkins: Checkin[] } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [situation, setSituation] = useState<{ whatsapp: string; at: string } | null>(null);
  const lastAt = data?.checkins[0]?.at ?? null;

  // Le résumé (météo, ville...) n'est recalculé que lorsqu'un NOUVEAU pointage arrive,
  // pas à chaque rafraîchissement de la page.
  useEffect(() => {
    if (!token || !lastAt) return;
    getSharedSituation(token).then(setSituation).catch(() => setSituation(null));
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

  if (notFound && !data) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Lien expiré</h1>
          <p className="hint">Ce lien de suivi n'existe pas ou a été désactivé par son auteur.</p>
        </div>
      </div>
    );
  }
  if (!data) return <p className="hint" style={{ padding: 24 }}>Chargement…</p>;

  const last = data.checkins[0];
  return (
    <div>
      <div className="topbar">
        <strong>
          PBP<span style={{ color: "var(--accent)" }}>2027</span>
        </strong>
        <span className="hint" style={{ margin: 0 }}>
          {last ? `Dernière position ${ago(last.at)}` : "Pas encore de position"}
        </span>
      </div>
      <RoadbookView
        data={data.roadbook}
        author={data.roadbook.author}
        editable={false}
        live={<WhatsAppShare text={situation?.whatsapp ?? null} at={situation?.at} />}
        position={last ? { km: last.km, lat: last.lat, lon: last.lon, at: last.at, source: last.source } : null}
      />
    </div>
  );
}
