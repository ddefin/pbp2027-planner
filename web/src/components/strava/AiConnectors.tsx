import { useEffect, useState } from "react";
import { getCoachPrefs, saveCoachPrefs, testStravaMcp, type CoachFrequency, type CoachMetric, type CoachPrefs, type CoachProfile, type CoachTone } from "../../api/strava";

const MCP_URL = "https://mcp.strava.com/mcp";

// Seuls les assistants avec un connecteur officiel Strava sont proposés. Les commandes sont
// celles à lancer sur TON ordinateur : l'authentification Strava se fait dans l'assistant,
// ce site ne voit jamais tes identifiants Claude ou Gemini.
const ASSISTANTS = [
  {
    id: "claude",
    name: "Claude",
    by: "Anthropic",
    icon: "🟠",
    command: `claude mcp add --transport http strava-mcp ${MCP_URL}`,
    steps: [
      "Claude Code : lance la commande ci-dessous dans un terminal, puis tape /mcp et choisis « strava-mcp » pour t'authentifier avec Strava.",
      "Claude.ai ou Claude Desktop : Paramètres → Connecteurs → Ajouter un connecteur personnalisé, avec l'URL du serveur.",
    ],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    by: "Google",
    icon: "🔵",
    command: `gemini mcp add --transport http strava ${MCP_URL}`,
    steps: [
      "Gemini CLI : lance la commande ci-dessous, puis authentifie-toi avec Strava quand l'outil te le demande.",
      "La syntaxe peut varier selon ta version : en cas d'erreur, ajoute le serveur MCP « http » avec l'URL ci-dessous dans les réglages de l'outil.",
    ],
  },
] as const;

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="sv-copy">
      <code aria-label={label}>{value}</code>
      <button
        type="button"
        className="ghost"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            window.prompt("Copie la commande :", value);
          }
        }}
      >
        {copied ? "✓ Copié" : "Copier"}
      </button>
    </div>
  );
}

function McpTest() {
  const [state, setState] = useState<{ busy: boolean; ok?: boolean; message?: string }>({ busy: false });
  return (
    <div className="sv-test">
      <button
        type="button"
        className="ghost"
        disabled={state.busy}
        onClick={async () => {
          setState({ busy: true });
          try {
            const r = await testStravaMcp();
            setState({ busy: false, ok: r.reachable, message: r.message });
          } catch {
            setState({ busy: false, ok: false, message: "Test impossible pour le moment." });
          }
        }}
      >
        {state.busy ? "Test en cours…" : "Tester la connexion au serveur MCP"}
      </button>
      {state.message && (
        <span role="status" className={state.ok ? "sv-lvl-ok" : "sv-lvl-alerte"}>
          {state.ok ? "✓" : "✗"} {state.message}
        </span>
      )}
    </div>
  );
}

const PROFILES: { id: CoachProfile; label: string; hint: string }[] = [
  { id: "endurance", label: "Endurance / Ultra & BRM", hint: "Socle aérobie, longues sorties, nutrition" },
  { id: "performance", label: "Performance / Compétition", hint: "Séances de qualité, fraîcheur avant l'objectif" },
  { id: "forme", label: "Remise en forme", hint: "Régularité, progression douce" },
];
const FREQUENCIES: { id: CoachFrequency; label: string }[] = [
  { id: "activite", label: "Après chaque sortie" },
  { id: "hebdo", label: "Chaque dimanche soir" },
  { id: "demande", label: "À la demande uniquement" },
];
const METRICS: { id: CoachMetric; label: string }[] = [
  { id: "hr", label: "Fréquence cardiaque" },
  { id: "power", label: "Puissance (watts)" },
  { id: "elevation", label: "Dénivelé" },
  { id: "speed", label: "Vitesse" },
];
const TONES: { id: CoachTone; label: string }[] = [
  { id: "bienveillant", label: "Bienveillant" },
  { id: "direct", label: "Direct" },
  { id: "technique", label: "Technique" },
];

export function CoachSettings({ onSaved }: { onSaved: () => void }) {
  const [prefs, setPrefs] = useState<CoachPrefs | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    getCoachPrefs().then(setPrefs).catch(() => setState("error"));
  }, []);
  if (!prefs) return <p className="hint">Chargement des réglages…</p>;

  const set = (patch: Partial<CoachPrefs>) => {
    setPrefs({ ...prefs, ...patch });
    setState("idle");
  };
  const toggleMetric = (m: CoachMetric) => {
    const has = prefs.metrics.includes(m);
    if (has && prefs.metrics.length === 1) return; // au moins une métrique
    set({ metrics: has ? prefs.metrics.filter((x) => x !== m) : [...prefs.metrics, m] });
  };

  return (
    <form
      className="sv-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("saving");
        try {
          await saveCoachPrefs(prefs);
          setState("saved");
          onSaved();
        } catch {
          setState("error");
        }
      }}
    >
      <fieldset>
        <legend>Profil de coaching</legend>
        <div className="sv-choices">
          {PROFILES.map((p) => (
            <label key={p.id} className={`sv-choice${prefs.profile === p.id ? " is-on" : ""}`}>
              <input type="radio" name="profile" checked={prefs.profile === p.id} onChange={() => set({ profile: p.id })} />
              <strong>{p.label}</strong>
              <span>{p.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Bilans automatiques</legend>
        <div className="sv-choices sv-choices-row">
          {FREQUENCIES.map((f) => (
            <label key={f.id} className={`sv-choice${prefs.frequency === f.id ? " is-on" : ""}`}>
              <input type="radio" name="frequency" checked={prefs.frequency === f.id} onChange={() => set({ frequency: f.id })} />
              <strong>{f.label}</strong>
            </label>
          ))}
        </div>
        <p className="hint" style={{ margin: "6px 0 0" }}>Le bilan arrive dans la cloche du site, et sur Telegram si ton compte est lié.</p>
      </fieldset>

      <fieldset>
        <legend>Métriques prioritaires</legend>
        <div className="sv-choices sv-choices-row">
          {METRICS.map((m) => (
            <label key={m.id} className={`sv-choice${prefs.metrics.includes(m.id) ? " is-on" : ""}`}>
              <input type="checkbox" checked={prefs.metrics.includes(m.id)} onChange={() => toggleMetric(m.id)} />
              <strong>{m.label}</strong>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="sv-row">
        <label>
          Ton du coach
          <select value={prefs.tone} onChange={(e) => set({ tone: e.target.value as CoachTone })}>
            {TONES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="sv-grow">
          Objectif (facultatif)
          <input type="text" maxLength={120} placeholder="ex. BRM 400 en avril, PBP 2027" value={prefs.goal ?? ""} onChange={(e) => set({ goal: e.target.value || null })} />
        </label>
      </div>

      <div className="sv-actions">
        <button type="submit" className="primary" style={{ width: "auto" }} disabled={state === "saving"}>
          {state === "saving" ? "Enregistrement…" : "Enregistrer mes réglages"}
        </button>
        {state === "saved" && <span role="status" className="sv-lvl-ok">✓ Réglages enregistrés</span>}
        {state === "error" && <span role="alert" className="sv-lvl-alerte">⚠️ Échec de l'enregistrement</span>}
      </div>
    </form>
  );
}

export function AiConnectors() {
  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        Discute de tes données Strava avec un assistant IA officiellement connecté à Strava (lecture seule). Il faut un <strong>abonnement Strava actif</strong> pour utiliser le serveur MCP officiel.
      </p>
      <div className="sv-assistants">
        {ASSISTANTS.map((a) => (
          <article key={a.id} className="sv-assistant">
            <header>
              <span aria-hidden="true">{a.icon}</span>
              <div>
                <strong>{a.name}</strong>
                <span className="sv-sub"> · {a.by}</span>
              </div>
              <span className="sv-pill">Connecteur officiel</span>
            </header>
            <ul className="sv-steps">
              {a.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <CopyField label={`Commande ${a.name}`} value={a.command} />
            <CopyField label="URL du serveur MCP" value={MCP_URL} />
          </article>
        ))}
      </div>
      <McpTest />
      <p className="hint" style={{ marginBottom: 0 }}>
        Le test vérifie seulement que le serveur MCP de Strava est joignable. La liaison de ton compte se fait dans l'assistant lui-même, ce site n'y a pas accès.
      </p>
    </div>
  );
}
