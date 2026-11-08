import { DashboardHero } from "../components/DashboardHero";
import { BrmTracker } from "../components/BrmTracker";
import { BrmChoicesOverview } from "../components/BrmChoicesOverview";
import { useBrmEvents } from "../hooks/useBrmEvents";

export function DashboardPage() {
  const brm = useBrmEvents();

  return (
    <div className="wrap-wide">
      <DashboardHero events={brm.events} />
      <BrmChoicesOverview />
      <BrmTracker brm={brm} />
    </div>
  );
}
