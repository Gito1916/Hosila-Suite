import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/format';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid' | 'subtle';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
  tooltip?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'secondary',
      size = 'md',
      type = 'button',
      loading,
      disabled,
      tooltip,
      title,
      children,
      ...props
    },
    ref
  ) => {
    const base =
      'inline-flex items-center justify-center gap-1.5 font-medium rounded-xl select-none ' +
      'transition-colors duration-150 ' +
      'disabled:opacity-45 disabled:pointer-events-none cursor-pointer';

    const variants = {
      primary:
        'bg-[#6AD4B0] text-[#111113] hover:bg-[#6AD4B0]/85 font-semibold',
      secondary:
        'bg-surface text-ink border border-ink/20 hover:bg-ink/[0.05]',
      subtle:
        'bg-ink/[0.06] text-ink hover:bg-ink/[0.10]',
      ghost:
        'bg-transparent text-ink/80 hover:text-ink hover:bg-ink/[0.06]',
      danger:
        'bg-surface text-danger-ink border border-[#E05252]/40 hover:bg-[#E05252]/10 font-medium',
      'danger-solid':
        'bg-[#E05252] text-white hover:bg-[#E05252]/90 font-semibold',
    };

    const sizes = {
      sm: 'h-8 px-2.5 text-xs rounded-lg',
      md: 'h-9 px-3.5 text-sm',
      lg: 'h-10 px-4 text-sm',
      icon: 'h-8 w-8 p-0 rounded-lg',
    };

    const hintText = tooltip || title;

    return (
      <button
        ref={ref}
        type={type}
        title={hintText}
        disabled={disabled || loading}
        className={cn(base, variants[variant], sizes[size], className)}
        {...props}
      >
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
