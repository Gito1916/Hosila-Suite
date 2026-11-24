import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/format';

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  maxWidth = 'max-w-lg',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}) {
  const portalContainer =
    typeof document !== 'undefined'
      ? document.getElementById('hosila-zoom-root') ?? undefined
      : undefined;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={portalContainer}>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 dark:bg-black/65 backdrop-blur-[2px] animate-fade-in no-print" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] rounded-2xl border border-ink/15 bg-surface shadow-[0_24px_60px_rgba(0,0,0,0.18)] dark:shadow-[0_24px_60px_rgba(0,0,0,0.55)] animate-modal-in focus:outline-none flex flex-col max-h-[92vh] no-print',
            maxWidth
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-ink/10 shrink-0">
            <div>
              <Dialog.Title className="text-base sm:text-lg font-semibold tracking-tight text-ink">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="mt-0.5 text-xs text-ink/60">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="rounded-lg p-1.5 text-ink/50 hover:text-ink hover:bg-ink/[0.05] transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>
          {footer && (
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-ink/10 bg-ink/[0.02] rounded-b-2xl shrink-0">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'max-w-xl',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}) {
  const portalContainer =
    typeof document !== 'undefined'
      ? document.getElementById('hosila-zoom-root') ?? undefined
      : undefined;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={portalContainer}>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 dark:bg-black/60 backdrop-blur-[2px] animate-fade-in no-print" />
        <Dialog.Content
          className={cn(
            'fixed right-0 top-0 bottom-0 z-50 w-full border-l border-ink/15 bg-surface shadow-[-16px_0_48px_rgba(0,0,0,0.16)] dark:shadow-[-16px_0_48px_rgba(0,0,0,0.55)] animate-drawer-in focus:outline-none flex flex-col no-print',
            width
          )}
        >
          <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-ink/10 shrink-0">
            <div>
              <Dialog.Title className="text-base sm:text-lg font-semibold tracking-tight text-ink">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="mt-0.5 text-xs text-ink/60">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="rounded-lg p-1.5 text-ink/50 hover:text-ink hover:bg-ink/[0.05] transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto px-6 py-5 flex-1">{children}</div>
          {footer && (
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-ink/10 bg-ink/[0.02] shrink-0">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
