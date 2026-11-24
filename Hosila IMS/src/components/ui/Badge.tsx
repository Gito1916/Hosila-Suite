import React from 'react';
import { cn } from '../../lib/format';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  /* Strict 3-color + 1 semantic alert discipline: Canvas/Ink + Soft Mint (#6AD4B0) + Soft Red (#E05252) */
  const tones: Record<BadgeTone, string> = {
    neutral: 'bg-ink/[0.06] text-ink/85 border border-ink/15',
    accent: 'bg-[#6AD4B0]/18 text-accent-ink border border-[#6AD4B0]/45',
    success: 'bg-[#6AD4B0]/18 text-accent-ink border border-[#6AD4B0]/45',
    warning: 'bg-ink/[0.05] text-ink border border-dashed border-[#E05252]/65 font-medium',
    danger: 'bg-[#E05252]/[0.12] text-danger-ink border border-[#E05252]/45 font-semibold',
    info: 'bg-ink/[0.08] text-ink border border-ink/20',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11.5px] font-medium leading-4 whitespace-nowrap',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
