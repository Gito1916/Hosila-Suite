import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  headerActions?: ReactNode;
  children: ReactNode;
  widthClass?: string;
  printable?: boolean;
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  headerActions,
  children,
  widthClass = 'max-w-lg',
  printable = false,
}: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={`${printable ? '' : 'no-print'} fixed inset-0 z-50 flex justify-end bg-black/30 dark:bg-black/60 backdrop-blur-[2px]`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`relative flex h-full w-full ${widthClass} flex-col border-l border-ink/12 bg-surface text-ink shadow-[-16px_0_48px_rgba(0,0,0,0.16)] dark:shadow-[-16px_0_48px_rgba(0,0,0,0.55)]`}
      >
        <div className="no-print flex shrink-0 items-start justify-between gap-3 border-b border-ink/10 px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-xs text-ink/55">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close panel"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink/55 hover:bg-ink/[0.06] hover:text-ink transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
