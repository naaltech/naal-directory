import { Tile } from "@carbon/react";
import { PageHeader } from "./page-header.tsx";

/** Henüz yapılmamış bölümler için boş durum */
export function ComingSoon({ title, description, next }: { title: string; description: string; next: string }) {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={title} description={description} />
      <Tile>
        <p className="text-sm text-secondary">Bu bölüm henüz hazır değil.</p>
        <p className="mt-2 text-sm">{next}</p>
      </Tile>
    </div>
  );
}
