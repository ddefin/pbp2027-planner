import { Construction } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/States";

export function ContentPage() {
  return (
    <>
      <PageHeader title="Content" />
      <EmptyState icon={Construction} title="En construction" />
    </>
  );
}
