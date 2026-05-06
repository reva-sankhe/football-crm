interface EmptyStateProps {
  icon?: unknown;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center gap-3">
      <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">{title}</p>
      {description && <p className="text-xs text-slate-400 dark:text-slate-600 max-w-xs">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
