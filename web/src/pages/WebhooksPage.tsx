import { useState, type FormEvent } from "react";
import type { WebhookEventName, WebhookFormat } from "../api/webhooks";
import { useWebhooks } from "../hooks/useWebhooks";
import { EVENT_OPTIONS, FORMAT_OPTIONS } from "../lib/webhookMeta";

export function WebhooksPage() {
  const { webhooks, loading, error, create, toggleEnabled, remove, test } = useWebhooks();
  const [showForm, setShowForm] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  return (
    <div className="wrap">
      <section className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ marginBottom: 0 }}>Webhooks</h2>
          <button type="button" className="ghost" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Annuler" : "Ajouter un webhook"}
          </button>
        </div>
        <p className="hint">
          Reçois une notification (Discord, Slack, ou un point de terminaison à toi) quand un choix est fait sur le
          calendrier des BRM, ou qu'un vent fort est prévu sur un BRM choisi. Visible et déclenché pour tout le
          groupe, pas seulement pour toi.
        </p>

        {error && <div className="error-banner">{error}</div>}

        {newSecret && (
          <div className="panel" style={{ background: "var(--bg)", marginBottom: 16 }}>
            <div className="t" style={{ fontWeight: 700, marginBottom: 6 }}>Secret du webhook</div>
            <p className="hint">
              Affiché une seule fois : sert à vérifier la signature HMAC-SHA256 (en-tête <code>X-PBP-Signature</code>)
              de chaque requête envoyée à ton point de terminaison. Enregistre-le maintenant si tu en as besoin.
            </p>
            <code style={{ display: "block", padding: 10, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, wordBreak: "break-all", fontSize: 12.5 }}>
              {newSecret}
            </code>
            <button className="primary" style={{ marginTop: 12 }} onClick={() => setNewSecret(null)}>
              J'ai enregistré le secret
            </button>
          </div>
        )}

        {showForm && (
          <WebhookForm
            onSubmit={async (input) => {
              const result = await create(input);
              setNewSecret(result.secret);
              setShowForm(false);
            }}
          />
        )}

        {loading && <p className="hint">Chargement…</p>}
        {!loading && webhooks && webhooks.length === 0 && !showForm && <p className="hint">Aucun webhook configuré.</p>}

        {!loading &&
          webhooks &&
          webhooks.map((w) => (
            <WebhookRow
              key={w.id}
              webhook={w}
              onToggle={() => toggleEnabled(w.id, !w.enabled)}
              onDelete={() => remove(w.id)}
              onTest={() => test(w.id)}
            />
          ))}
      </section>
    </div>
  );
}

function WebhookForm({
  onSubmit,
}: {
  onSubmit: (input: { url: string; format: WebhookFormat; events: WebhookEventName[] }) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<WebhookFormat>("discord");
  const [events, setEvents] = useState<Set<WebhookEventName>>(new Set(["brm.participation_changed"]));
  const [busy, setBusy] = useState(false);

  function toggleEvent(ev: WebhookEventName) {
    setEvents((prev) => {
      const next = new Set(prev);
      if (next.has(ev)) next.delete(ev);
      else next.add(ev);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim() || events.size === 0) return;
    setBusy(true);
    try {
      await onSubmit({ url: url.trim(), format, events: Array.from(events) });
      setUrl("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="panel" style={{ background: "var(--bg)", marginBottom: 16 }}>
      <div className="field">
        <label htmlFor="webhook-url">URL (https uniquement)</label>
        <input
          id="webhook-url"
          type="url"
          required
          placeholder="https://discord.com/api/webhooks/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="webhook-format">Format</label>
        <select
          id="webhook-format"
          value={format}
          onChange={(e) => setFormat(e.target.value as WebhookFormat)}
          style={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: "10px 12px",
            color: "var(--fg)",
            fontFamily: "inherit",
          }}
        >
          {FORMAT_OPTIONS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Événements</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {EVENT_OPTIONS.map((ev) => (
            <label key={ev.value} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
              <input type="checkbox" checked={events.has(ev.value)} onChange={() => toggleEvent(ev.value)} />
              {ev.label}
            </label>
          ))}
        </div>
      </div>
      <button className="primary" type="submit" disabled={busy} style={{ width: "auto", padding: "10px 20px" }}>
        {busy ? "Ajout…" : "Ajouter"}
      </button>
    </form>
  );
}

function WebhookRow({
  webhook,
  onToggle,
  onDelete,
  onTest,
}: {
  webhook: { id: string; url: string; format: string; events: string[]; enabled: boolean; lastStatus: string | null; lastTriggeredAt: string | null };
  onToggle: () => void;
  onDelete: () => void;
  onTest: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function handleTest() {
    setBusy(true);
    setTestResult(null);
    try {
      const status = await onTest();
      setTestResult(status);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Supprimer le webhook ${webhook.url} ?`)) return;
    setBusy(true);
    try {
      await onDelete();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="security-row">
      <div style={{ minWidth: 0 }}>
        <div className="t" style={{ wordBreak: "break-all" }}>
          {webhook.url}
        </div>
        <div className="d">
          {FORMAT_OPTIONS.find((f) => f.value === webhook.format)?.label ?? webhook.format} ·{" "}
          {webhook.events.map((e) => EVENT_OPTIONS.find((o) => o.value === e)?.label ?? e).join(", ")}
          {webhook.lastTriggeredAt && (
            <>
              {" "}
              · dernier essai :{" "}
              <strong style={{ color: webhook.lastStatus === "ok" ? "var(--ok)" : "var(--bad)" }}>
                {webhook.lastStatus === "ok" ? "réussi" : "échoué"}
              </strong>
            </>
          )}
          {testResult && <span style={{ marginLeft: 8 }}>→ test : {testResult === "ok" ? "réussi" : "échoué"}</span>}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
        <button type="button" className="ghost" onClick={handleTest} disabled={busy || !webhook.enabled}>
          Tester
        </button>
        <button type="button" className="ghost" onClick={onToggle} disabled={busy}>
          {webhook.enabled ? "Désactiver" : "Activer"}
        </button>
        <button type="button" className="ghost" onClick={handleDelete} disabled={busy}>
          Supprimer
        </button>
      </div>
    </div>
  );
}
