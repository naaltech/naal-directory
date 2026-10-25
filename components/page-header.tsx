export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-normal">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-secondary">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
