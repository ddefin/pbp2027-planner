import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function Skeleton({ width = "100%", height = 14, radius = 6 }: { width?: number | string; height?: number; radius?: number }) {
  return <span className="ad-skel" style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="ad-empty">
      <span className="ad-empty-icon" aria-hidden="true">
        <Icon size={26} />
      </span>
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}
