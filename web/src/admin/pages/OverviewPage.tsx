import { Construction } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/States";

export function OverviewPage() {
  return (
    <>
      <PageHeader title="Overview" />
      <EmptyState icon={Construction} title="En construction" />
    </>
  );
}
