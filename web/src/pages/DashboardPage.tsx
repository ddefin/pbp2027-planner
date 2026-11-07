import { DashboardHero } from "../components/DashboardHero";
import { BrmTracker } from "../components/BrmTracker";

export function DashboardPage() {
  return (
    <div className="wrap-wide">
      <DashboardHero />
      <BrmTracker />
    </div>
  );
}
