import { Construction } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/States";

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <EmptyState icon={Construction} title="En construction" />
    </>
  );
}
