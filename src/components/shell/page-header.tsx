interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="glass-header sticky top-0 z-30 flex items-center justify-between border-b border-border/60 px-6 py-4">
      <div>
        <h1 className="bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-xl font-semibold tracking-tight text-transparent">
          {title}
        </h1>
        {description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
