import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeChoice as Choice } from "../../hooks/useTheme";

const OPTIONS: { value: Choice; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Auto", icon: Monitor },
  { value: "light", label: "Clair", icon: Sun },
  { value: "dark", label: "Sombre", icon: Moon },
];

// Auto / Clair / Sombre : réutilise useTheme (mémorisé sur l'appareil).
export function ThemeChoice() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="app-theme" role="group" aria-label="Thème">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button key={value} type="button" aria-pressed={theme === value} onClick={() => setTheme(value)}>
          <Icon size={15} aria-hidden="true" /> {label}
        </button>
      ))}
    </div>
  );
}
