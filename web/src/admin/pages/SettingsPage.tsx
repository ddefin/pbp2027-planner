import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, CircleAlert, CloudSun, Database, Lock, Mail, MessageCircle, Activity, Webhook } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Skeleton } from "../components/States";
import { errorText, getSettings, type Settings } from "../api";
import { fmtAgo, fmtDateTime } from "../format";

function Row({ ok, label, children }: { ok: boolean | "warn"; label: string; children?: ReactNode }) {
  const good = ok === true;
  return (
    <li className="ad-setting">
      <span className={`ad-setting-icon ${good ? "is-ok" : ok === "warn" ? "is-warn" : "is-off"}`}>{good ? <CheckCircle2 size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}</span>
      <span className="ad-stack">
        <strong>
          {label} <span className="ad-sr">{good ? "(opérationnel)" : "(à vérifier)"}</span>
        </strong>
        {children && <small>{children}</small>}
      </span>
    </li>
  );
}

function Card({ icon: Icon, title, children }: { icon: typeof Mail; title: string; children: ReactNode }) {
  return (
    <section className="ad-card">
      <div className="ad-card-head">
        <h2>
          <Icon size={16} aria-hidden="true" /> {title}
        </h2>
      </div>
      <ul className="ad-settings">{children}</ul>
    </section>
  );
}

export function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getSettings().then(setS).catch((e) => setError(errorText(e)));
  }, []);
  const backupOk = s?.backup.lastAt ? Date.now() - new Date(s.backup.lastAt).getTime() <= s.backup.maxAgeDays * 86_400_000 : false;
  return (
    <>
      <PageHeader title="Paramètres" description="État de la configuration du serveur, en lecture seule. Les clés et mots de passe restent dans .env.production sur le NAS : ils ne sont ni affichés ni modifiables ici." />
      {error && <div className="ad-callout is-danger" role="alert">{error}</div>}
      {!s && !error ? (
        <div className="ad-grid-2">{[0, 1, 2, 3].map((i) => <div key={i} className="ad-card"><Skeleton height={18} width="40%" /><div style={{ height: 12 }} /><Skeleton height={14} /></div>)}</div>
      ) : s ? (
        <div className="ad-grid-2">
          <Card icon={Mail} title="E-mails (mot de passe oublié)">
            <Row ok={s.mail.configured} label={s.mail.configured ? "Serveur mail configuré" : "Aucun serveur mail"}>
              {s.mail.configured ? `${s.mail.host}:${s.mail.port} · expéditeur ${s.mail.from}` : "SMTP_HOST absent : aucune réinitialisation ne peut partir."}
            </Row>
            <Row ok={Boolean(s.publicUrl)} label="Adresse publique du site">{s.publicUrl ?? "PUBLIC_URL absente : les liens envoyés utilisent l'adresse de la requête."}</Row>
            <li className="ad-setting-link">
              <Link to="/admin/journaux?onglet=comptes&kind=mail_failed">Voir les envois échoués</Link>
            </li>
          </Card>
          <Card icon={Database} title="Sauvegardes">
            <Row ok={backupOk ? true : "warn"} label={s.backup.lastAt ? `Dernière sauvegarde ${fmtAgo(s.backup.lastAt)}` : "Aucune sauvegarde enregistrée"}>
              {s.backup.lastAt ? fmtDateTime(s.backup.lastAt) : "Planifie scripts/backup.sh sur le NAS (voir DEPLOY.md)."} · alerte au-delà de {s.backup.maxAgeDays} jours
            </Row>
          </Card>
          <Card icon={MessageCircle} title="Telegram">
            <Row ok={s.telegram.bot} label={s.telegram.bot ? `Bot configuré${s.telegram.botUsername ? ` (@${s.telegram.botUsername})` : ""}` : "Bot non configuré"} />
            <Row ok={s.telegram.newsChannel ? true : "warn"} label="Canal des actualités" />
            <Row ok={s.telegram.trackingChannel ? true : "warn"} label="Canal de suivi des brevets">{s.telegram.trackingChannel ? undefined : "Repli sur le canal des actualités."}</Row>
          </Card>
          <Card icon={Activity} title="Strava">
            <Row ok={s.strava.configured} label={s.strava.configured ? "Application Strava configurée" : "Strava non configuré"}>{s.strava.redirectUri ?? undefined}</Row>
            <Row ok={s.strava.webhook ? true : "warn"} label="Webhook (temps réel)">{s.strava.webhook ? undefined : "Sans lui, synchronisation toutes les 6 h."}</Row>
          </Card>
          <Card icon={CloudSun} title="Météo">
            <Row ok={s.weather.configured} label={s.weather.configured ? "OpenWeather configuré" : "Météo désactivée"} />
          </Card>
          <Card icon={Lock} title="Sécurité">
            <Row ok={s.cookieSecure} label={s.cookieSecure ? "Cookies réservés au HTTPS" : "Cookies acceptés en HTTP"}>{s.cookieSecure ? undefined : "COOKIE_SECURE=false : à réserver aux tests locaux."}</Row>
            <Row ok label="Journal d'audit">Conservation {s.retention.auditLog} · événements de compte {s.retention.authEventsDays} jours</Row>
            <Row ok label={`Version en ligne : ${s.version}`} />
          </Card>
          <Card icon={Webhook} title="Intégrations sortantes">
            <li className="ad-setting-link">
              <Link to="/webhooks">Gérer les webhooks</Link>
            </li>
          </Card>
        </div>
      ) : null}
    </>
  );
}
