import { useEffect, useState } from "react";
import { Megaphone, Send } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { EmptyState, Skeleton } from "../components/States";
import { Dialog } from "../components/Dialog";
import { useToast } from "../components/Toaster";
import { errorText, getAnnouncementRecipients, listAnnouncements, sendAnnouncement } from "../api";
import { fmtDateTime } from "../format";
import type { AnnouncementRow } from "../types";
import { announcementSchema } from "../../../../src/shared/adminSchemas";

const MAX = 500;

export function AnnouncementsPage() {
  const toast = useToast();
  const [message, setMessage] = useState("");
  const [telegram, setTelegram] = useState(false);
  const [recipients, setRecipients] = useState<{ members: number; telegram: number } | null>(null);
  const [history, setHistory] = useState<AnnouncementRow[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    getAnnouncementRecipients().then(setRecipients).catch(() => undefined);
    listAnnouncements().then(setHistory).catch((e) => setError(errorText(e)));
  };
  useEffect(load, []);

  const check = announcementSchema.safeParse({ message, telegram });
  const text = message.trim();

  async function send() {
    if (!check.success) return;
    setBusy(true);
    try {
      const r = await sendAnnouncement(text, telegram);
      toast("success", `Annonce envoyée à ${r.recipients} membre${r.recipients > 1 ? "s" : ""}${telegram ? ` · ${r.telegramSent} sur Telegram` : ""}.`);
      setMessage("");
      setConfirm(false);
      load();
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Annonces" description="Publier un message à tous les membres actifs : il arrive dans la cloche du site, et sur Telegram pour ceux qui ont lié leur compte." />
      <section className="ad-card">
        <label className="ad-field">
          <span>Message</span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={MAX} rows={4} placeholder="ex. Sortie de reconnaissance dimanche, départ 8 h à Rambouillet." />
        </label>
        <div className="ad-announce-foot">
          <label className="ad-check">
            <input type="checkbox" checked={telegram} onChange={(e) => setTelegram(e.target.checked)} />
            <span>
              Envoyer aussi sur Telegram{recipients ? ` (${recipients.telegram} compte${recipients.telegram > 1 ? "s" : ""} lié${recipients.telegram > 1 ? "s" : ""})` : ""}
            </span>
          </label>
          <span className="ad-muted ad-num">
            {text.length} / {MAX}
          </span>
        </div>
        {text.length >= 3 && (
          <div className="ad-preview" aria-label="Aperçu de la notification">
            <span className="ad-muted">Aperçu dans la cloche</span>
            <p>📣 Annonce : {text}</p>
          </div>
        )}
        <button type="button" className="ad-btn is-primary" disabled={!check.success} onClick={() => setConfirm(true)}>
          <Send size={15} aria-hidden="true" /> Envoyer{recipients ? ` à ${recipients.members} membre${recipients.members > 1 ? "s" : ""}` : ""}
        </button>
      </section>

      <section className="ad-card">
        <div className="ad-card-head">
          <h2>Annonces envoyées</h2>
        </div>
        {error && <div className="ad-callout is-danger" role="alert">{error}</div>}
        {!history && !error ? (
          <Skeleton height={18} />
        ) : history && history.length > 0 ? (
          <ul className="ad-list">
            {history.map((a) => (
              <li key={a.id}>
                <span className="ad-list-main">
                  <span>
                    <span className="ad-announce-text">{a.message}</span>
                    <small>
                      {a.actorEmail} · {a.recipients} membre{a.recipients > 1 ? "s" : ""}
                      {a.telegramSent ? ` · ${a.telegramSent} sur Telegram` : ""}
                    </small>
                  </span>
                </span>
                <span className="ad-muted">{fmtDateTime(a.at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Megaphone} title="Aucune annonce pour l'instant" />
        )}
      </section>

      <Dialog
        open={confirm}
        title="Envoyer cette annonce ?"
        onClose={() => !busy && setConfirm(false)}
        onSubmit={() => void send()}
        footer={
          <>
            <button type="button" className="ad-btn" onClick={() => setConfirm(false)} disabled={busy}>
              Annuler
            </button>
            <button type="submit" className="ad-btn is-primary" disabled={busy}>
              {busy ? "Envoi…" : `Envoyer à ${recipients?.members ?? "tous les"} membres`}
            </button>
          </>
        }
      >
        <div className="ad-preview">
          <p>📣 Annonce : {text}</p>
        </div>
        <p>
          Elle ne pourra pas être rappelée une fois envoyée{telegram ? ", y compris sur Telegram" : ""}. L'envoi est inscrit au journal d'audit.
        </p>
      </Dialog>
    </>
  );
}
