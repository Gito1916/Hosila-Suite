import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { Modal } from './Modal';

export interface VoidTargetSummary {
  entityLabel: string;
  title: string;
  reference?: string;
  party?: string;
  amount: number;
  currency: string;
  warningNote?: string;
}

interface VoidConfirmModalProps {
  open: boolean;
  target: VoidTargetSummary | null;
  reasonPresets?: string[];
  submitting?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
}

export function VoidConfirmModal({
  open,
  target,
  reasonPresets = [],
  submitting = false,
  onClose,
  onConfirm,
}: VoidConfirmModalProps) {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setConfirmed(false);
    }
  }, [open, target?.title, target?.reference, target?.amount]);

  const trimmedReason = reason.trim();
  const canSubmit = !submitting && trimmedReason.length >= 4 && confirmed;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    await onConfirm(trimmedReason);
  }

  return (
    <Modal
      open={open && Boolean(target)}
      onClose={onClose}
      title={target ? `Void & Reverse ${target.entityLabel}` : 'Void Transaction'}
      subtitle="Audit-safe reversal · Original record remains preserved with a contra journal entry"
      maxWidthClass="max-w-lg"
    >
      {target && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-xl border border-[#E05252]/30 bg-[#E05252]/[0.06] p-4 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-danger-ink">
                  {target.entityLabel}
                </div>
                <div className="mt-0.5 text-sm font-semibold text-ink break-words">
                  {target.title}
                </div>
                {(target.reference || target.party) && (
                  <div className="mt-1 text-xs text-ink/65">
                    {[target.reference, target.party].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
              <div className="font-mono text-base font-semibold tabular-nums text-danger-ink shrink-0">
                {target.currency}
                {Math.abs(target.amount).toFixed(2)}
              </div>
            </div>
            {target.warningNote && (
              <div className="flex items-start gap-2 border-t border-[#E05252]/20 pt-2.5 text-xs text-danger-ink">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{target.warningNote}</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-ink/75">
                Reason for Void / Reversal *
              </label>
              <span
                className={`font-mono text-[11px] tabular-nums ${
                  trimmedReason.length >= 4 ? 'text-accent-ink' : 'text-ink/45'
                }`}
              >
                {trimmedReason.length}/200 (min 4)
              </span>
            </div>

            {reasonPresets.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {reasonPresets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setReason(preset)}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      reason === preset
                        ? 'border-ink/40 bg-ink/[0.08] text-ink'
                        : 'border-ink/12 bg-surface text-ink/65 hover:border-ink/25 hover:text-ink'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            )}

            <textarea
              required
              rows={2}
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this transaction is being voided (logged permanently in the Void Audit Report)..."
              className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/40"
            />
          </div>

          <label className="flex items-start gap-2.5 rounded-xl border border-ink/12 bg-ink/[0.02] p-3 text-xs text-ink/80 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded accent-[#E05252]"
            />
            <span className="leading-relaxed">
              <strong className="text-ink">I confirm this void is authorized.</strong> A permanent
              contra journal voucher and audit log entry will be recorded under my staff account and
              cannot be erased.
            </span>
          </label>

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-ink/8">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-ink/50">
              <ShieldAlert className="h-3.5 w-3.5 text-ink/45" />
              Management, Accountant &amp; Auditor only
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="rounded-xl bg-[#E05252] px-4 py-2 text-sm font-semibold text-white hover:bg-[#E05252]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? 'Voiding...' : 'Confirm Void & Reversal'}
              </button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
