import { Bike, Coffee, Flag, OctagonX } from "lucide-react";
import { CHECKIN_MESSAGE_MAX, CHECKIN_STATUS_LABEL, type CheckinStatus } from "../../lib/roadbook";

const OPTIONS: { value: CheckinStatus; icon: typeof Bike }[] = [
  { value: "route", icon: Bike },
  { value: "pause", icon: Coffee },
  { value: "arrive", icon: Flag },
  { value: "abandon", icon: OctagonX },
];

// Au pointage : état à montrer aux proches et petit mot facultatif. Envoyés avec le
// prochain pointage (y compris s'il part plus tard depuis la file hors réseau).
export function CheckinExtras({
  status,
  onStatus,
  message,
  onMessage,
}: {
  status: CheckinStatus;
  onStatus: (s: CheckinStatus) => void;
  message: string;
  onMessage: (m: string) => void;
}) {
  return (
    <div className="ck-extras">
      <div className="ck-status" role="radiogroup" aria-label="Mon état pour les proches">
        {OPTIONS.map(({ value, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={status === value}
            className={`ck-status-btn is-${value}`}
            onClick={() => {
              if (value === "abandon" && status !== "abandon" && !window.confirm("Signaler un abandon à tes proches avec le prochain pointage ?")) return;
              onStatus(value);
            }}
          >
            <Icon size={16} aria-hidden="true" /> {value === "pause" ? "En pause" : CHECKIN_STATUS_LABEL[value]}
          </button>
        ))}
      </div>
      <label className="ck-note">
        <span>Petit mot pour les proches (facultatif)</span>
        <input
          className="rb-input"
          type="text"
          maxLength={CHECKIN_MESSAGE_MAX}
          placeholder="Ex. : RAS, tout va bien"
          value={message}
          onChange={(e) => onMessage(e.target.value)}
        />
      </label>
    </div>
  );
}
