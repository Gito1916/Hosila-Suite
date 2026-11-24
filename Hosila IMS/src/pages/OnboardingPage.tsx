import { useState } from 'react';
import { ArrowRight, Check, Database, FileSpreadsheet, PackagePlus, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { commands } from '../../bindings/bindings';
import { useApp } from '../context/AppContext';
import { Button } from '../components/ui/Button';
import { Field, Input } from '../components/ui/Field';
import { ZoomScaleControl } from '../components/layout/AppShell';
import { ImportInventoryReviewer } from '../components/inventory/ImportInventoryReviewer';
import { cn, encodeBackupFileForBackend } from '../lib/format';

const DEFAULT_DEPARTMENTS = [
  { name: 'Kitchen', color: '#6AD4B0' },
  { name: 'F&B', color: '#1D1D1F' },
  { name: 'Housekeeping', color: '#1E8665' },
  { name: 'Maintenance', color: '#52525B' },
  { name: 'Store', color: '#8E8E93' },
];

export function OnboardingPage() {
  const {
    setSessionUser,
    refreshBoot,
    saveCleanBaselineSnapshot,
    setOnboardingInProgress,
  } = useApp();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [submitting, setSubmitting] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [importMode, setImportMode] = useState<'choice' | 'excel'>('choice');

  // Step 1: Company Details
  const [bizName, setBizName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [currencySymbol, setCurrencySymbol] = useState('₦');
  const [currencyCode, setCurrencyCode] = useState('NGN');
  const [address, setAddress] = useState('');

  // Step 2: Admin Account
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');

  // Step 3: Departments & Store Sections
  const [depts, setDepts] = useState(DEFAULT_DEPARTMENTS);
  const [newDept, setNewDept] = useState('');
  const [sections, setSections] = useState<string[]>(['Protein']);
  const [newSection, setNewSection] = useState('');

  async function handleCreateWorkspaceAndAccount() {
    setSubmitting(true);
    try {
      const res = await commands.completeOnboarding({
        business_profile: {
          name: bizName.trim(),
          legal_name: legalName.trim(),
          address: address.trim(),
          phone: '',
          email: '',
          currency_symbol: currencySymbol.trim() || '₦',
          currency_code: currencyCode.trim().toUpperCase() || 'NGN',
          date_format: 'DD MMM YYYY',
          logo_data_url: null,
        },
        admin_username: username.trim(),
        admin_full_name: fullName.trim(),
        admin_password: password,
        admin_pin: pin.trim() ? pin.trim() : null,
        departments: depts.map((d, i) => ({
          name: d.name,
          color: d.color,
          sort_order: i + 1,
        })),
        store_sections: sections
          .filter((s) => s.trim().length > 0)
          .map((name, i) => ({ name: name.trim(), sort_order: i + 1 })),
      });
      if (res.status === 'error') {
        toast.error(res.error.message);
        return;
      }
      setOnboardingInProgress(true);
      setStep(4);
      await setSessionUser(res.data);
      await saveCleanBaselineSnapshot();
    } finally {
      setSubmitting(false);
    }
  }

  async function finishOnboarding() {
    setOnboardingInProgress(false);
    toast.success('Workspace ready.');
    await refreshBoot();
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-[var(--bg-canvas)] flex flex-col items-center justify-center p-6 relative">
      <div className="absolute top-4 right-5">
        <ZoomScaleControl />
      </div>

      <div className={cn('w-full transition-all', step === 4 && importMode === 'excel' ? 'max-w-5xl' : 'max-w-xl')}>
        <div className="flex items-center gap-3 mb-5">
          <img src="/hosila-icon.svg" alt="Hosila" className="h-8 w-8" />
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            <span className="text-accent-ink">Hosila</span> IMS Setup
          </h1>
        </div>

        {/* Step Indicator */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          {[
            { n: 1, label: 'Company' },
            { n: 2, label: 'Admin Account' },
            { n: 3, label: 'Departments' },
            { n: 4, label: 'Inventory' },
          ].map((s) => (
            <div
              key={s.n}
              className={cn(
                'flex items-center gap-2 rounded-xl px-3 py-2 border text-xs font-medium transition-colors',
                step === s.n
                  ? 'border-[#6AD4B0] bg-[#6AD4B0]/14 text-accent-ink'
                  : step > s.n
                    ? 'border-ink/10 bg-surface text-ink'
                    : 'border-ink/10 bg-surface/50 text-ink/50'
              )}
            >
              <span
                className={cn(
                  'h-5 w-5 rounded-full flex items-center justify-center text-[10.5px] font-mono font-semibold shrink-0',
                  step >= s.n
                    ? 'bg-[#6AD4B0] text-[#1D1D1F]'
                    : 'bg-ink/[0.05] text-ink/50'
                )}
              >
                {step > s.n ? <Check className="h-3 w-3" /> : s.n}
              </span>
              <span className="truncate">{s.label}</span>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-ink/10 bg-surface p-6">
          {step === 1 && (
            <div className="space-y-4 animate-view-enter">
              <Field label="Company / Hotel Name" required>
                <Input
                  autoFocus
                  value={bizName}
                  onChange={(e) => setBizName(e.target.value)}
                  placeholder="e.g. Hosila Grand Hotel"
                />
              </Field>
              <Field label="Legal Name">
                <Input
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  placeholder="e.g. Hosila Hospitality Ltd"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Currency Symbol" required>
                  <Input
                    value={currencySymbol}
                    onChange={(e) => setCurrencySymbol(e.target.value)}
                    placeholder="₦"
                  />
                </Field>
                <Field label="Currency Code" required>
                  <Input
                    value={currencyCode}
                    onChange={(e) => setCurrencyCode(e.target.value)}
                    placeholder="NGN"
                  />
                </Field>
              </div>
              <Field label="Address">
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Optional"
                />
              </Field>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-ink/15 bg-surface hover:bg-ink/[0.04] text-xs font-medium text-ink/70 hover:text-ink cursor-pointer transition-colors">
                  <Database className="h-3.5 w-3.5 text-accent-ink" />
                  {restoringBackup ? 'Restoring backup...' : 'Restore from Backup (.db)'}
                  <input
                    type="file"
                    accept=".db,.sqlite,.sqlite3"
                    disabled={restoringBackup}
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      setRestoringBackup(true);
                      try {
                        const payload = await encodeBackupFileForBackend(file);
                        const res = await commands.restoreBackup(payload);
                        if (res.status === 'error') {
                          toast.error(res.error.message);
                          return;
                        }
                        toast.success('Backup restored cleanly. Please sign in with your account.');
                        setOnboardingInProgress(false);
                        await refreshBoot();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : String(err));
                      } finally {
                        setRestoringBackup(false);
                      }
                    }}
                  />
                </label>
                <Button
                  variant="primary"
                  disabled={!bizName.trim() || restoringBackup}
                  onClick={() => setStep(2)}
                >
                  Next: Admin Account
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 animate-view-enter">
              <Field label="Admin Full Name" required>
                <Input
                  autoFocus
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Hosila Store Manager"
                />
              </Field>
              <Field label="Admin Username" required>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Password" required>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 6 characters"
                  />
                </Field>
                <Field label="Manager PIN">
                  <Input
                    type="password"
                    inputMode="numeric"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder="4–6 digits"
                  />
                </Field>
              </div>

              <div className="pt-2 flex justify-between">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button
                  variant="primary"
                  disabled={!fullName.trim() || !username.trim() || password.length < 6}
                  onClick={() => {
                    const trimmedPin = pin.trim();
                    if (trimmedPin && !/^\d{4,6}$/.test(trimmedPin)) {
                      toast.error('Manager PIN must be 4–6 digits (or leave blank).');
                      return;
                    }
                    setStep(3);
                  }}
                >
                  Next: Departments
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5 animate-view-enter">
              <div>
                <div className="text-[12.5px] font-medium mb-2">Departments</div>
                <div className="flex flex-wrap gap-2 mb-2.5">
                  {depts.map((d, idx) => (
                    <span
                      key={d.name}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-subtle)] pl-2.5 pr-1.5 py-1 text-[12px]"
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: d.color }}
                      />
                      {d.name}
                      <button
                        type="button"
                        onClick={() => setDepts(depts.filter((_, i) => i !== idx))}
                        className="p-0.5 text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newDept}
                    onChange={(e) => setNewDept(e.target.value)}
                    placeholder="Add department..."
                  />
                  <Button
                    type="button"
                    onClick={() => {
                      const trimmed = newDept.trim();
                      if (!trimmed) return;
                      if (depts.some((d) => d.name.toLowerCase() === trimmed.toLowerCase())) {
                        toast.error(`Department "${trimmed}" already exists.`);
                        return;
                      }
                      setDepts([...depts, { name: trimmed, color: '#6AD4B0' }]);
                      setNewDept('');
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </Button>
                </div>
              </div>

              <div>
                <div className="text-[12.5px] font-medium mb-2">Store Sections</div>
                <div className="flex flex-wrap gap-2 mb-2.5">
                  {sections.map((s, idx) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-subtle)] pl-2.5 pr-1.5 py-1 text-[12px]"
                    >
                      {s}
                      <button
                        type="button"
                        onClick={() => setSections(sections.filter((_, i) => i !== idx))}
                        className="p-0.5 text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newSection}
                    onChange={(e) => setNewSection(e.target.value)}
                    placeholder="Add store section..."
                  />
                  <Button
                    type="button"
                    onClick={() => {
                      const trimmed = newSection.trim();
                      if (!trimmed) return;
                      if (sections.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
                        toast.error(`Store section "${trimmed}" already exists.`);
                        return;
                      }
                      setSections([...sections, trimmed]);
                      setNewSection('');
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </Button>
                </div>
              </div>

              <div className="pt-2 flex justify-between">
                <Button variant="ghost" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button
                  variant="primary"
                  loading={submitting}
                  disabled={depts.length === 0}
                  onClick={handleCreateWorkspaceAndAccount}
                >
                  Create Account &amp; Continue
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4 animate-view-enter">
              {importMode === 'choice' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => setImportMode('excel')}
                    className="rounded-2xl border border-ink/10 hover:border-[#6AD4B0] bg-ink/[0.02] p-5 text-left transition-colors cursor-pointer group"
                  >
                    <div className="h-10 w-10 rounded-xl bg-[#6AD4B0]/14 text-accent-ink flex items-center justify-center mb-3">
                      <FileSpreadsheet className="h-5 w-5" />
                    </div>
                    <div className="text-sm font-semibold text-ink group-hover:text-accent-ink">
                      Import Inventory from Excel
                    </div>
                    <div className="text-xs text-ink/60 mt-1">
                      Parse your existing Excel inventory sheet, adjust units or prices, and
                      approve before posting.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={finishOnboarding}
                    className="rounded-2xl border border-ink/10 hover:border-[#6AD4B0] bg-ink/[0.02] p-5 text-left transition-colors cursor-pointer group"
                  >
                    <div className="h-10 w-10 rounded-xl bg-ink/[0.05] text-ink flex items-center justify-center mb-3">
                      <PackagePlus className="h-5 w-5" />
                    </div>
                    <div className="text-sm font-semibold text-ink">Add Inventory Manually</div>
                    <div className="text-xs text-ink/60 mt-1">
                      Start with an empty catalog and add items one by one or import later in
                      Settings.
                    </div>
                  </button>
                </div>
              ) : (
                <ImportInventoryReviewer
                  compact
                  onComplete={finishOnboarding}
                  onSkip={finishOnboarding}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
