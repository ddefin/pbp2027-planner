import { Construction } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/States";

export function UserDetailPage() {
  return (
    <>
      <PageHeader title="UserDetail" />
      <EmptyState icon={Construction} title="En construction" />
    </>
  );
}
