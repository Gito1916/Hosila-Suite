import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidthClass?: string;
  children: ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  maxWidthClass = 'max-w-lg',
  children,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/65 p-3 sm:p-4 no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-heading"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full ${maxWidthClass} max-h-[92vh] overflow-y-auto rounded-2xl bg-surface border border-ink/12 p-4 sm:p-6 shadow-[0_24px_60px_rgba(0,0,0,0.18)] dark:shadow-[0_24px_60px_rgba(0,0,0,0.55)]`}
      >
        <div className="flex items-start justify-between gap-4 pb-4 sm:pb-5 border-b border-ink/8">
          <div className="min-w-0">
            <h2 id="modal-heading" className="text-base sm:text-lg font-semibold tracking-tight text-ink">
              {title}
            </h2>
            {subtitle && <p className="mt-1 text-xs sm:text-sm text-ink/55">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg text-ink/55 hover:bg-ink/[0.06] hover:text-ink transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="pt-4 sm:pt-5">{children}</div>
      </div>
    </div>
  );
}
