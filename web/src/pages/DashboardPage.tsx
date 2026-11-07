import { DashboardHero } from "../components/DashboardHero";
import { BrmTracker } from "../components/BrmTracker";
import { useBrmEvents } from "../hooks/useBrmEvents";

export function DashboardPage() {
  const brm = useBrmEvents();

  return (
    <div className="wrap-wide">
      <DashboardHero events={brm.events} />
      <BrmTracker brm={brm} />
    </div>
  );
}
