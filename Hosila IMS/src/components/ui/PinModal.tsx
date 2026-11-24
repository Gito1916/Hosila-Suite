import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Modal } from './Modal';
import { Field, Input } from './Field';
import { Button } from './Button';

export function PinModal({
  open,
  onOpenChange,
  title = 'Manager PIN Required',
  description = 'Enter an Admin Manager PIN to authorize this action.',
  confirmLabel = 'Authorize & Continue',
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: (pin: string) => Promise<boolean | void> | boolean | void;
}) {
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin.trim()) return;
    setSubmitting(true);
    try {
      const ok = await onConfirm(pin.trim());
      if (ok !== false) {
        setPin('');
        onOpenChange(false);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) setPin('');
        onOpenChange(next);
      }}
      title={title}
      description={description}
      maxWidth="max-w-sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={submitting}
            disabled={pin.trim().length < 4}
            onClick={handleSubmit}
          >
            <ShieldCheck className="h-4 w-4" />
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="Manager PIN" required hint="4–6 digits">
          <Input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••"
            className="text-center tracking-[0.35em] font-mono font-semibold tabular-nums text-base"
          />
        </Field>
      </form>
    </Modal>
  );
}
