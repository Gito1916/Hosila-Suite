import React from 'react';
import { cn } from '../../lib/format';

export const inputBaseClass =
  'w-full h-9 rounded-xl border border-ink/20 bg-canvas px-3.5 text-sm text-ink ' +
  'placeholder:text-ink/55 transition-colors duration-150 ' +
  'hover:border-ink/30 focus:outline-none focus:border-[#6AD4B0] ' +
  'disabled:opacity-55 disabled:cursor-not-allowed';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(inputBaseClass, className)} {...props} />
));
Input.displayName = 'Input';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(inputBaseClass, 'pr-8 cursor-pointer', className)} {...props}>
    {children}
  </select>
));
Select.displayName = 'Select';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink ' +
        'placeholder:text-ink/40 transition-colors duration-150 ' +
        'hover:border-ink/25 focus:outline-none focus:border-[#6AD4B0]',
      className
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-semibold text-ink/85">
          {label}
          {required && <span className="text-danger-ink ml-0.5">*</span>}
        </label>
        {hint && <span className="text-[11.5px] text-ink/70">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-xs text-danger-ink">{error}</p>}
    </div>
  );
}
