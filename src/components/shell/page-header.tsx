interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="glass-header sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3 md:px-6 md:py-4">
      <div className="min-w-0">
        <h1 className="truncate bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-lg font-semibold tracking-tight text-transparent md:text-xl">
          {title}
        </h1>
        {description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground md:text-sm">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
