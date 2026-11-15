import { useEffect, useState } from "react";

function useCountdown(target: Date) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const diff = Math.max(0, target.getTime() - now.getTime());
  return {
    days: Math.floor(diff / 86400000),
    hours: Math.floor((diff % 86400000) / 3600000),
    mins: Math.floor((diff % 3600000) / 60000),
    secs: Math.floor((diff % 60000) / 1000),
  };
}

export function Countdown({ target }: { target: Date }) {
  const { days, hours, mins, secs } = useCountdown(target);
  const pad = (n: number) => String(n).padStart(2, "0");
  // VoiceOver : une phrase stable (à la minute), les chiffres qui défilent sont masqués
  // pour ne pas être relus chaque seconde.
  const spoken = `${days} jour${days > 1 ? "s" : ""}, ${hours} heure${hours > 1 ? "s" : ""} et ${mins} minute${mins > 1 ? "s" : ""} avant le départ`;
  return (
    <>
    <p className="sr-only">{spoken}</p>
    <div className="countdown tabular" aria-hidden="true">
      <div className="unit">
        <div className="num">{days}</div>
        <div className="unit-label">jours</div>
      </div>
      <div className="unit">
        <div className="num">{pad(hours)}</div>
        <div className="unit-label">heures</div>
      </div>
      <div className="unit">
        <div className="num">{pad(mins)}</div>
        <div className="unit-label">min</div>
      </div>
      <div className="unit">
        <div className="num">{pad(secs)}</div>
        <div className="unit-label">sec</div>
      </div>
    </div>
    </>
  );
}
