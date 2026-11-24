import React from 'react';
import { cn } from '../../lib/format';

export function StatCard({
  label,
  value,
  sublabel,
  icon,
  tone = 'default',
  onClick,
}: {
  label: string;
  value: string;
  sublabel?: string;
  icon?: React.ReactNode;
  tone?: 'default' | 'accent' | 'warning' | 'danger';
  onClick?: () => void;
}) {
  const accentColors = {
    default: 'text-ink',
    accent: 'text-accent-ink',
    warning: 'text-danger-ink',
    danger: 'text-danger-ink',
  };

  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink/60">{label}</span>
        {icon && <span className="text-ink/45">{icon}</span>}
      </div>
      <div
        className={cn(
          'mt-2 font-mono text-xl font-semibold tracking-tight tabular-nums leading-tight',
          accentColors[tone]
        )}
      >
        {value}
      </div>
      {sublabel && (
        <div className="mt-1 text-xs text-ink/50 truncate">{sublabel}</div>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left rounded-2xl border border-ink/10 bg-surface p-4 transition-colors duration-150 cursor-pointer hover:border-ink/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-surface p-4 transition-colors duration-150">
      {content}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 rounded-2xl border border-ink/10 bg-surface">
      <div className="h-11 w-11 rounded-xl bg-ink/[0.04] border border-ink/10 flex items-center justify-center text-ink/60 mb-3">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-md text-xs text-ink/60">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
