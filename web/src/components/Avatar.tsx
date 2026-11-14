import { Bike, Coffee, Compass, Croissant, Flag, Heart, Map as MapIcon, Moon, Mountain, Star, Sun, Tent, Trees, Waves, Wind, Zap, type LucideIcon } from "lucide-react";
import type { AvatarData } from "../api/auth";

export const AVATAR_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  bike: { icon: Bike, label: "Vélo" },
  mountain: { icon: Mountain, label: "Montagne" },
  sun: { icon: Sun, label: "Soleil" },
  moon: { icon: Moon, label: "Nuit" },
  wind: { icon: Wind, label: "Vent" },
  coffee: { icon: Coffee, label: "Café" },
  flag: { icon: Flag, label: "Arrivée" },
  compass: { icon: Compass, label: "Boussole" },
  map: { icon: MapIcon, label: "Carte" },
  zap: { icon: Zap, label: "Éclair" },
  heart: { icon: Heart, label: "Cœur" },
  star: { icon: Star, label: "Étoile" },
  croissant: { icon: Croissant, label: "Croissant" },
  tent: { icon: Tent, label: "Bivouac" },
  trees: { icon: Trees, label: "Forêt" },
  waves: { icon: Waves, label: "Océan" },
};
export const AVATAR_COLORS = ["coral", "blue", "green", "amber", "violet", "teal", "slate", "rose"] as const;

// Couleur de repli stable pour les initiales : toujours la même pour un prénom donné.
function fallbackColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// Avatar d'un randonneur, partout sur le site : photo, icône sur couleur, ou initiale.
// Décoratif par défaut (le prénom est écrit à côté) ; `title` l'annonce quand il est seul.
export function Avatar({ name, avatar, size = 32, title, className }: { name: string; avatar?: AvatarData; size?: number; title?: string; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  const cls = `av${className ? ` ${className}` : ""}`;
  const a11y = title ? { role: "img" as const, "aria-label": title, title } : { "aria-hidden": true as const };
  if (avatar?.kind === "photo") {
    return (
      <span className={cls} style={style} {...a11y}>
        <img src={avatar.url} alt="" width={size} height={size} loading="lazy" decoding="async" />
      </span>
    );
  }
  if (avatar?.kind === "preset" && AVATAR_ICONS[avatar.icon]) {
    const Icon = AVATAR_ICONS[avatar.icon].icon;
    return (
      <span className={`${cls} av-${avatar.color}`} style={style} {...a11y}>
        <Icon size={Math.round(size * 0.56)} strokeWidth={2.2} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={`${cls} av-${fallbackColor(name)} av-initial`} style={style} {...a11y}>
      {(name.trim().slice(0, 1) || "?").toUpperCase()}
    </span>
  );
}
