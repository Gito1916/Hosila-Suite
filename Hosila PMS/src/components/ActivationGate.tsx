import { useState } from 'react';
import { Check, Copy, KeyRound, Moon, ShieldCheck, Sun } from 'lucide-react';
import type { LicenseStatus } from '../types';
import { HoverTip } from './HoverTip';

interface ActivationGateProps {
  license: LicenseStatus;
  isDark: boolean;
  onToggleTheme: () => void;
  onActivate: (key: string) => Promise<string | null>;
  onStartTrial: () => Promise<string | null>;
}

export function ActivationGate({
  license,
  isDark,
  onToggleTheme,
  onActivate,
  onStartTrial,
}: ActivationGateProps) {
  const [licenseKey, setLicenseKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [startingTrial, setStartingTrial] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleCopyMachineId() {
    try {
      await navigator.clipboard.writeText(license.machineId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback ignored if clipboard unavailable
    }
  }

  async function handleActivateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!licenseKey.trim()) {
      setErrorMsg('Please paste your Hosila PMS activation key.');
      return;
    }
    setSubmitting(true);
    try {
      const err = await onActivate(licenseKey.trim());
      if (err) setErrorMsg(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTrialClick() {
    setErrorMsg(null);
    setStartingTrial(true);
    try {
      const err = await onStartTrial();
      if (err) setErrorMsg(err);
    } finally {
      setStartingTrial(false);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-canvas px-6 py-10 text-ink transition-colors">
      {/* Top-right Light/Dark Switch */}
      <div className="absolute top-5 right-5">
        <HoverTip text={isDark ? 'Switch to Light Mode.' : 'Switch to Dark Mode.'}>
          <button
            type="button"
            onClick={onToggleTheme}
            className="inline-flex items-center gap-2 rounded-xl border border-ink/12 bg-surface px-3 py-2 text-xs font-medium text-ink/75 hover:border-ink/25 hover:text-ink transition-colors"
          >
            {isDark ? (
              <Sun className="h-3.5 w-3.5 text-[#6AD4B0]" />
            ) : (
              <Moon className="h-3.5 w-3.5 text-ink/60" />
            )}
            <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>
          </button>
        </HoverTip>
      </div>

      <div className="w-full max-w-lg space-y-7">
        {/* Brand Masthead */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 text-sm font-semibold tracking-wide text-ink">
            <img
              src="/hosila-logo.png"
              alt="Hosila PMS"
              className="h-6 w-6 shrink-0 object-contain"
            />
            <span>
              <span className="text-accent-ink">Hosila</span> PMS
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Activate Hosila PMS
          </h1>
          <p className="text-sm text-ink/55">
            Activate this Host PC with a signed offline license key, or start a 14-day evaluation trial.
          </p>
        </div>

        <div className="rounded-2xl border border-ink/12 bg-surface p-7 space-y-6">
          {errorMsg && (
            <div className="rounded-xl border border-[#E05252]/35 bg-[#E05252]/[0.07] px-4 py-3 text-xs font-medium text-danger-ink">
              {errorMsg}
            </div>
          )}

          {/* Host Machine ID */}
          <div className="rounded-xl border border-ink/10 bg-ink/[0.025] p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-ink/60">Host PC Machine ID</span>
              <button
                type="button"
                onClick={handleCopyMachineId}
                className="inline-flex items-center gap-1.5 rounded-lg border border-ink/12 bg-surface px-2.5 py-1 text-xs font-medium text-ink/75 hover:border-ink/25 hover:text-ink transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[#6AD4B0]" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy ID</span>
                  </>
                )}
              </button>
            </div>
            <div className="font-mono text-base font-semibold tracking-wide tabular-nums text-ink select-all">
              {license.machineId}
            </div>
            <p className="text-xs text-ink/50 leading-relaxed">
              Send this Machine ID to Hosila to receive your single-machine activation key. Other
              workstations on your LAN connect to this Host PC without separate keys.
            </p>
          </div>

          {/* Activation Key Form */}
          <form onSubmit={handleActivateSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="hosila-activation-key"
                className="block text-xs font-medium text-ink/65 mb-1.5"
              >
                Activation Key
              </label>
              <textarea
                id="hosila-activation-key"
                rows={3}
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                placeholder="Paste your HSL1... activation key here"
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 font-mono text-xs text-ink placeholder:text-ink/40 resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || !licenseKey.trim()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#6AD4B0] px-4 py-2.5 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-45 transition-colors"
            >
              <KeyRound className="h-4 w-4" />
              <span>{submitting ? 'Verifying Key...' : 'Activate Hosila PMS'}</span>
            </button>
          </form>

          {license.trialAvailable && (
            <div className="border-t border-ink/10 pt-5 space-y-2.5">
              <button
                type="button"
                disabled={startingTrial}
                onClick={handleTrialClick}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-ink/15 bg-surface px-4 py-2.5 text-xs font-medium text-ink hover:bg-ink/[0.04] disabled:opacity-45 transition-colors"
              >
                <ShieldCheck className="h-4 w-4 text-accent-ink" />
                <span>{startingTrial ? 'Starting Trial...' : 'Start 14-Day Free Trial (Offline)'}</span>
              </button>
              <p className="text-center text-[11px] text-ink/45">
                Full access to Front Desk, Restaurant POS, and Finance for 14 days. No internet required.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

