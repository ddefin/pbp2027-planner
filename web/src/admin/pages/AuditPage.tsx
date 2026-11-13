import { Construction } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/States";

export function AuditPage() {
  return (
    <>
      <PageHeader title="Audit" />
      <EmptyState icon={Construction} title="En construction" />
    </>
  );
}
