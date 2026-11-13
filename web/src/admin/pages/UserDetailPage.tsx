import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Ban, KeyRound, Laptop, Mail, RotateCcw, ShieldCheck, Trash2, UserX } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { EmptyState, Skeleton } from "../components/States";
import { RoleBadge, StatusBadge } from "../components/StatusBadge";
import { useUserActions } from "../components/UserActions";
import { useBreadcrumbLeaf } from "../components/Breadcrumbs";
import { errorText, getUser, sendResetLink } from "../api";
import { PresenceDot } from "../components/PresenceDot";
import { Dialog } from "../components/Dialog";
import { useToast } from "../components/Toaster";
import { ACTION_LABEL, EVENT_LABEL, fmtAgo, fmtDate, fmtDateTime } from "../format";
import { useAuth } from "../../context/AuthContext";
import type { UserDetail } from "../types";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ad-field-ro">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function UserDetailPage() {
  const { id = "" } = useParams();
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<UserDetail | null>(null);
  const [error, setError] = useState<{ code: number; text: string } | null>(null);
  const [reload, setReload] = useState(0);
  const toast = useToast();
  const [resetOpen, setResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  useBreadcrumbLeaf(data?.user.prenom ?? null);

  useEffect(() => {
    let alive = true;
    getUser(id)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError({ code: (e as { status?: number }).status ?? 0, text: errorText(e) }));
    return () => {
      alive = false;
    };
  }, [id, reload]);

  const actions = useUserActions((kind) => (kind === "delete" ? navigate("/admin/utilisateurs", { replace: true }) : setReload((r) => r + 1)));

  async function doSendReset() {
    setResetBusy(true);
    try {
      const r = await sendResetLink(id);
      if (r.sent) toast("success", "Lien de réinitialisation envoyé (valable 1 heure).");
      else toast("error", `E-mail non envoyé : ${r.error ?? "cause inconnue"}`);
      setResetOpen(false);
      setReload((x) => x + 1);
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setResetBusy(false);
    }
  }

  if (error?.code === 404)
    return <EmptyState icon={UserX} title="Compte introuvable" text="Il a peut-être été supprimé." action={<Link to="/admin/utilisateurs" className="ad-btn">Retour à la liste</Link>} />;
  if (error) return <div className="ad-callout is-danger" role="alert">{error.text}</div>;
  if (!data)
    return (
      <div className="ad-grid-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="ad-card">
            <Skeleton height={20} width="40%" />
            <div style={{ height: 12 }} />
            <Skeleton height={14} />
            <div style={{ height: 8 }} />
            <Skeleton height={14} width="80%" />
          </div>
        ))}
      </div>
    );

  const u = data.user;
  const isMe = u.email === me?.email;
  const target = { id: u.id, prenom: u.prenom, email: u.email, isAdmin: u.isAdmin };
  return (
    <>
      <Link to="/admin/utilisateurs" className="ad-back">
        <ArrowLeft size={15} aria-hidden="true" /> Utilisateurs
      </Link>
      <PageHeader
        title={u.prenom}
        description={u.email}
        actions={
          isMe ? (
            <span className="ad-muted">C'est ton compte</span>
          ) : (
            <>
              {u.status === "suspended" ? (
                <button type="button" className="ad-btn" onClick={() => actions.open("unsuspend", target)}>
                  <RotateCcw size={15} aria-hidden="true" /> Réactiver
                </button>
              ) : (
                <button type="button" className="ad-btn" onClick={() => actions.open("suspend", target)}>
                  <Ban size={15} aria-hidden="true" /> Suspendre
                </button>
              )}
              <button type="button" className="ad-btn" onClick={() => setResetOpen(true)} disabled={u.status === "suspended"} title={u.status === "suspended" ? "Compte suspendu : réactive-le d'abord" : undefined}>
                <Mail size={15} aria-hidden="true" /> Lien de mot de passe
              </button>
              <button type="button" className="ad-btn" onClick={() => actions.open(u.isAdmin ? "demote" : "promote", target)}>
                <ShieldCheck size={15} aria-hidden="true" /> {u.isAdmin ? "Retirer admin" : "Nommer admin"}
              </button>
              <button type="button" className="ad-btn is-danger" onClick={() => actions.open("delete", target)}>
                <Trash2 size={15} aria-hidden="true" /> Supprimer
              </button>
            </>
          )
        }
      />
      <div className="ad-badges-row">
        <StatusBadge status={u.status} />
        <RoleBadge isAdmin={u.isAdmin} />
        <PresenceDot presence={u.presence} lastSeenAt={u.lastSeenAt} />
      </div>
      {u.status === "suspended" && (
        <div className="ad-callout is-warn">
          <Ban size={18} aria-hidden="true" />
          <div>
            Suspendu le {fmtDateTime(u.suspendedAt)} — motif : <em>{u.suspendedReason ?? "non précisé"}</em>
          </div>
        </div>
      )}

      <div className="ad-grid-2">
        <section className="ad-card">
          <div className="ad-card-head">
            <h2>Compte</h2>
          </div>
          <dl className="ad-fields">
            <Field label="Inscrit le">{fmtDate(u.createdAt)}</Field>
            <Field label="Club">{u.club ?? "—"}</Field>
            <Field label="Licence">{u.licenceNumero ?? "—"}</Field>
            <Field label="Verrouillage">{u.lockedUntil && new Date(u.lockedUntil) > new Date() ? `jusqu'à ${fmtDateTime(u.lockedUntil)}` : "non"}</Field>
            <Field label="Erreurs de mot de passe en cours">{u.failedLoginAttempts}</Field>
            <Field label="Liens de réinitialisation valides">{u.activeResetLinks}</Field>
          </dl>
        </section>
        <section className="ad-card">
          <div className="ad-card-head">
            <h2>Données</h2>
          </div>
          <dl className="ad-fields">
            <Field label="Roadbooks">{data.data.roadbooks}</Field>
            <Field label="Messages du groupe">{data.data.messages}</Field>
            <Field label="BRM personnels">{data.data.brm}</Field>
            <Field label="Tracés PBP partagés">{data.data.pbpRoutes}</Field>
            <Field label="Strava">{data.data.strava ? "connecté" : "non"}</Field>
            <Field label="Telegram">{data.data.telegram ? "lié" : "non"}</Field>
          </dl>
        </section>
        <section className="ad-card">
          <div className="ad-card-head">
            <h2>Appareils connectés</h2>
          </div>
          {data.sessions.length === 0 ? (
            <EmptyState icon={Laptop} title="Aucune session ouverte" />
          ) : (
            <ul className="ad-list">
              {data.sessions.map((s, i) => (
                <li key={i}>
                  <span className="ad-list-main">
                    <Laptop size={16} aria-hidden="true" />
                    <span>
                      <strong>{s.device}</strong>
                      <small>ouverte le {fmtDate(s.createdAt)}</small>
                    </span>
                  </span>
                  <span className="ad-muted">{fmtAgo(s.lastSeenAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="ad-card">
          <div className="ad-card-head">
            <h2>Connexions et mot de passe</h2>
          </div>
          {data.events.length === 0 ? (
            <EmptyState icon={KeyRound} title="Aucun événement" text="Connexions, verrouillages et demandes de mot de passe des 60 derniers jours." />
          ) : (
            <ul className="ad-timeline">
              {data.events.map((e, i) => {
                const l = EVENT_LABEL[e.kind] ?? { label: e.kind, tone: "info" as const };
                return (
                  <li key={i} className={`is-${l.tone}`}>
                    <span className="ad-tl-time ad-num">{fmtDateTime(e.at)}</span>
                    <span>{l.label}</span>
                    {e.detail && <small>{e.detail}</small>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="ad-card">
        <div className="ad-card-head">
          <h2>Historique d'administration</h2>
        </div>
        {data.audit.length === 0 ? (
          <p className="ad-muted" style={{ margin: 0 }}>
            Aucune action d'administration sur ce compte.
          </p>
        ) : (
          <ul className="ad-list">
            {data.audit.map((a) => (
              <li key={a.id}>
                <span className="ad-list-main">
                  <span>
                    <strong>{a.actorEmail}</strong> {ACTION_LABEL[a.action] ?? a.action} ce compte
                    {typeof a.metadata?.reason === "string" && <small>Motif : {a.metadata.reason}</small>}
                  </span>
                </span>
                <span className="ad-muted">{fmtDateTime(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {actions.dialog}
      <Dialog
        open={resetOpen}
        title={`Envoyer un lien de mot de passe à ${u.prenom}`}
        onClose={() => !resetBusy && setResetOpen(false)}
        onSubmit={() => void doSendReset()}
        footer={
          <>
            <button type="button" className="ad-btn" onClick={() => setResetOpen(false)} disabled={resetBusy}>
              Annuler
            </button>
            <button type="submit" className="ad-btn is-primary" disabled={resetBusy}>
              {resetBusy ? "Envoi…" : "Envoyer le lien"}
            </button>
          </>
        }
      >
        <p>
          Un e-mail part à <strong>{u.email}</strong> avec un lien valable 1 heure. Tu ne vois pas le lien : seul {u.prenom} peut choisir son nouveau mot de passe.
        </p>
        <p className="ad-muted" style={{ whiteSpace: "normal" }}>
          Le résultat s'affiche tout de suite (envoyé, ou la cause exacte de l'échec) et l'action est inscrite au journal.
        </p>
      </Dialog>
    </>
  );
}
