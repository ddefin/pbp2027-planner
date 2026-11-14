import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  deleteRoadbook,
  getRoadbook,
  getRoadbookSituation,
  postCheckin,
  resetCheckins,
  roadbookGpxUrl,
  updateRoadbook,
  type AnnounceStatus,
  type RoadbookSettings,
} from "../api/roadbooks";
import { RoadbookView, type RoadbookData } from "../components/roadbook/RoadbookView";
import { LiveTracker, type LivePosition } from "../components/roadbook/LiveTracker";
import { Disclosure } from "../components/Disclosure";
import { GroupShareCard, LiveTrackCard, TelegramCard } from "../components/roadbook/TrackingCards";
import { enqueue, flushQueue, isNetworkError, newClientId, queuedFor } from "../lib/checkinQueue";
import { ChecklistCard, GpsExportCard } from "../components/roadbook/PrepCards";
import { QuickShare, ShareLinkCard, WhatsAppCard } from "../components/roadbook/ShareCards";

const SAVE_DEBOUNCE_MS = 700;

export function RoadbookPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<(RoadbookData & { id: string; announceStatus?: AnnounceStatus }) | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [position, setPosition] = useState<LivePosition | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [situation, setSituation] = useState<{ whatsapp: string; at: string } | null>(null);
  const refreshSituation = useCallback(() => {
    if (!id) return;
    getRoadbookSituation(id).then(setSituation).catch(() => setSituation(null));
  }, [id]);

  const pending = useRef<Partial<RoadbookSettings>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!id) return;
    getRoadbook(id)
      .then(({ roadbook, checkins }) => {
        setData(roadbook);
        setShareToken(roadbook.shareToken);
        const last = checkins[0];
        if (last) refreshSituation();
        if (last) {
          setPosition({ km: last.km, lat: last.lat, lon: last.lon, at: last.at, source: last.source });
        }
      })
      .catch(() => setError("Roadbook introuvable."));
  }, [id]);

  // Chaque modification est appliquée tout de suite à l'écran, puis enregistrée par
  // lots (curseur de vitesse glissé = une seule requête, pas une par cran).
  const handleChange = useCallback(
    (patch: Partial<RoadbookSettings>) => {
      if (!id) return;
      setData((prev) => (prev ? { ...prev, ...patch } : prev));
      pending.current = { ...pending.current, ...patch };
      if (timer.current) clearTimeout(timer.current);
      setSaveState("saving");
      timer.current = setTimeout(async () => {
        const body = pending.current;
        pending.current = {};
        try {
          await updateRoadbook(id, body);
          setSaveState("saved");
        } catch {
          setSaveState("error");
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [id],
  );

  // Chaque pointage est une action volontaire du randonneur : toujours envoyé (pas de
  // tri ni de cadence, il n'y a plus de suivi continu). Renvoie false si l'envoi a
  // échoué (pas de réseau), pour que l'écran le dise au lieu de laisser croire que
  // les proches voient la position.
  const [queued, setQueued] = useState(0);

  const afterSend = useCallback(() => {
    if (!id) return;
    refreshSituation();
    // La publication sur le canal se fait en arrière-plan côté serveur (météo +
    // Telegram) : on relit son résultat quelques secondes plus tard pour l'afficher.
    setTimeout(() => {
      getRoadbook(id)
        .then(({ roadbook }) => setData((prev) => (prev ? { ...prev, announceStatus: roadbook.announceStatus } : prev)))
        .catch(() => undefined);
    }, 6000);
  }, [id, refreshSituation]);

  // Renvoie les pointages faits hors réseau dès que la connexion revient.
  const flush = useCallback(async () => {
    if (!id || queuedFor(id).length === 0) return;
    const n = await flushQueue(id, (c, announce) =>
      postCheckin(id, { km: c.km, lat: c.lat, lon: c.lon, source: c.source, at: c.at, clientId: c.clientId, announce }),
    );
    setQueued(queuedFor(id).length);
    if (n > 0) afterSend();
  }, [id, afterSend]);

  useEffect(() => {
    if (!id) return;
    setQueued(queuedFor(id).length);
    void flush();
    const onQueue = () => setQueued(queuedFor(id).length);
    window.addEventListener("online", flush);
    window.addEventListener("pbp-checkin-queue", onQueue);
    const t = setInterval(flush, 30_000);
    return () => {
      window.removeEventListener("online", flush);
      window.removeEventListener("pbp-checkin-queue", onQueue);
      clearInterval(t);
    };
  }, [id, flush]);

  // Chaque pointage est une action volontaire du randonneur. Sans réseau, il est gardé
  // dans le téléphone (avec son heure réelle) et renvoyé automatiquement : "queued".
  const handlePosition = useCallback(
    async (p: LivePosition): Promise<"sent" | "queued" | false> => {
      if (!id) return false;
      setPosition(p);
      const entry = { km: Math.round(p.km * 100) / 100, lat: p.lat, lon: p.lon, source: p.source, at: p.at, clientId: newClientId() };
      try {
        await postCheckin(id, entry);
        afterSend();
        void flush();
        return "sent";
      } catch (err) {
        if (!isNetworkError(err)) return false;
        enqueue({ roadbookId: id, ...entry });
        return "queued";
      }
    },
    [id, afterSend, flush],
  );

  if (error) return <div className="wrap"><div className="error-banner">{error}</div></div>;
  if (!data) return <p className="hint" style={{ padding: 24 }}>Chargement du roadbook…</p>;

  const saveLabel =
    saveState === "saving" ? "Enregistrement…" : saveState === "saved" ? "✓ Enregistré" : saveState === "error" ? "⚠️ Échec de l'enregistrement" : null;

  return (
    <RoadbookView
      data={data}
      position={position}
      editable
      onChange={handleChange}
      slots={{
        saveStatus: saveLabel,
        pointage: (
          <>
            <h3 className="rb-h3">Pointer ma position</h3>
            {queued > 0 && (
              <div className="live-feedback live-feedback-warn" role="status">
                📵 {queued} pointage{queued > 1 ? "s" : ""} en attente d'envoi : {queued > 1 ? "ils seront envoyés" : "il sera envoyé"} automatiquement dès que le réseau revient.
              </div>
            )}
            <LiveTracker
              points={data.points}
              controls={[...data.controls].sort((a, b) => a.km - b.km)}
              lastKm={position?.km ?? null}
              onPosition={handlePosition}
              onReset={async () => {
                await resetCheckins(data.id);
                setPosition(null);
                setSituation(null);
              }}
            />
          </>
        ),
        quickShare: (goTo) => (
          <QuickShare
            roadbookId={data.id}
            title={data.title}
            shareToken={shareToken}
            onShareToken={setShareToken}
            whatsapp={situation ? { text: situation.whatsapp, at: situation.at } : null}
            telegramAnnounce={data.telegramAnnounce ?? true}
            announceStatus={data.announceStatus}
            onOpenSharing={() => goTo("partage")}
          />
        ),
        roadbookActions: (
          <>
            <button type="button" className="primary" style={{ width: "auto", padding: "9px 16px" }} onClick={() => window.print()}>
              🖨️ Exporter en PDF
            </button>
          </>
        ),
        sharing: (
          <>
            <ShareLinkCard roadbookId={data.id} title={data.title} startAt={data.startAt} shareToken={shareToken} onShareToken={setShareToken} />
            <WhatsAppCard text={situation?.whatsapp ?? null} at={situation?.at} />
            <TelegramCard
              roadbookId={data.id}
              telegramAnnounce={data.telegramAnnounce ?? true}
              announceStatus={data.announceStatus}
              onSaved={(patch) => setData((prev) => (prev ? { ...prev, ...patch } : prev))}
            />
            <GroupShareCard roadbookId={data.id} groupShare={data.groupShare ?? false} onSaved={(patch) => setData((prev) => (prev ? { ...prev, ...patch } : prev))} />
            <LiveTrackCard roadbookId={data.id} liveTrackUrl={data.liveTrackUrl ?? null} onSaved={(patch) => setData((prev) => (prev ? { ...prev, ...patch } : prev))} />
          </>
        ),
        preparation: (
          <>
            <ChecklistCard stored={data.checklist} onChange={(checklist) => handleChange({ checklist })} />
            <GpsExportCard roadbookId={data.id} />
          </>
        ),
        settingsFooter: (
          <Disclosure title="📁 Fichier et suppression" summary="GPX d'origine · supprimer le roadbook" storageKey="rb.reglages.fichier">
            <div className="rb-card-actions">
              <a className="ghost-link" href={roadbookGpxUrl(data.id)} download>
                Télécharger le GPX d'origine
              </a>
              <button
                type="button"
                className="ghost rb-danger"
                onClick={async () => {
                  if (!confirm(`Supprimer le roadbook « ${data.title} » et son suivi ?`)) return;
                  await deleteRoadbook(data.id);
                  navigate("/roadbooks", { replace: true });
                }}
              >
                Supprimer ce roadbook
              </button>
            </div>
          </Disclosure>
        ),
      }}
    />
  );
}
