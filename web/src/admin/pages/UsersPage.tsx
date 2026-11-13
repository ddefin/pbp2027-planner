import { Construction } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/States";

export function UsersPage() {
  return (
    <>
      <PageHeader title="Users" />
      <EmptyState icon={Construction} title="En construction" />
    </>
  );
}
