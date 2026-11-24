import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Moon, Sun, Upload, X } from 'lucide-react';
import type { AuthStatusResponse, TaxAppliesTo, TaxMode } from '../types';
import { STAFF_ROLE_LABELS } from '../utils/constants';
import { HoverTip } from './HoverTip';

export interface OnboardingPayload {
  hotel_name: string;
  hotel_tagline: string;
  hotel_address: string;
  hotel_phone: string;
  hotel_email: string;
  hotel_website: string;
  hotel_logo_url: string;
  check_in_time: string;
  check_out_time: string;
  currency_symbol: string;
  tax_id: string;
  tax_enabled: boolean;
  tax_name: string;
  tax_rate: number;
  tax_mode: TaxMode;
  tax_applies_to: TaxAppliesTo;
  full_name: string;
  username: string;
  password: string;
  create_team_profiles: boolean;
  team_password: string;
}

interface AuthGateProps {
  authStatus: AuthStatusResponse;
  isDark: boolean;
  onToggleTheme: () => void;
  onSetup: (payload: OnboardingPayload) => Promise<string | null>;
  onLogin: (payload: {
    username: string;
    password: string;
    opening_cash: number;
  }) => Promise<string | null>;
}

const CURRENCY_PRESETS = ['₦', '$', '€', '£', '₵', 'R', '₹', 'AED '];

export function AuthGate({
  authStatus,
  isDark,
  onToggleTheme,
  onSetup,
  onLogin,
}: AuthGateProps) {
  // Multi-step onboarding state
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: Hotel Information & Logo (blank until the property enters its own profile)
  const [hotelName, setHotelName] = useState(authStatus.hotelName || '');
  const [hotelTagline, setHotelTagline] = useState('');
  const [hotelAddress, setHotelAddress] = useState('');
  const [hotelPhone, setHotelPhone] = useState('');
  const [hotelEmail, setHotelEmail] = useState('');
  const [hotelWebsite, setHotelWebsite] = useState('');
  const [hotelLogoUrl, setHotelLogoUrl] = useState(authStatus.hotelLogoUrl || '');

  // Step 2: Policies, Currency & Tax
  const [checkInTime, setCheckInTime] = useState('14:00');
  const [checkOutTime, setCheckOutTime] = useState('11:00');
  const [currencySymbol, setCurrencySymbol] = useState('₦');
  const [taxId, setTaxId] = useState('');
  const [taxEnabled, setTaxEnabled] = useState(true);
  const [taxName, setTaxName] = useState('VAT');
  const [taxRate, setTaxRate] = useState('7.5');
  const [taxMode, setTaxMode] = useState<TaxMode>('exclusive');
  const [taxAppliesTo, setTaxAppliesTo] = useState<TaxAppliesTo>('both');

  // Step 3: First Admin Account
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState(
    authStatus.needsSetup ? 'admin' : authStatus.staffDirectory[0]?.username ?? ''
  );
  const [password, setPassword] = useState('');
  const [createTeamProfiles, setCreateTeamProfiles] = useState(true);
  const [teamPassword, setTeamPassword] = useState('');

  // Sign-in state
  const [openingCash, setOpeningCash] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function handleLogoFileUpload(file: File | null) {
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.type)) {
      setErrorMsg('Please upload a PNG, JPEG, or WebP logo image.');
      return;
    }
    if (file.size > 500 * 1024) {
      setErrorMsg('Logo image must be 500 KB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setHotelLogoUrl(reader.result);
        setErrorMsg(null);
      }
    };
    reader.readAsDataURL(file);
  }

  function handleNextStep() {
    setErrorMsg(null);
    if (step === 1) {
      if (!hotelName.trim()) {
        setErrorMsg('Please enter your hotel name to continue.');
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!currencySymbol.trim()) {
        setErrorMsg('Please choose or enter a currency symbol.');
        return;
      }
      setStep(3);
    }
  }

  async function handleSetupSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!fullName.trim() || !username.trim() || password.length < 8) {
      setErrorMsg('Complete manager name, username, and password (min 8 characters).');
      return;
    }
    if (createTeamProfiles && teamPassword.length < 6) {
      setErrorMsg('Initial staff password must be at least 6 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const err = await onSetup({
        hotel_name: hotelName.trim(),
        hotel_tagline: hotelTagline.trim(),
        hotel_address: hotelAddress.trim(),
        hotel_phone: hotelPhone.trim(),
        hotel_email: hotelEmail.trim(),
        hotel_website: hotelWebsite.trim(),
        hotel_logo_url: hotelLogoUrl.trim(),
        check_in_time: checkInTime,
        check_out_time: checkOutTime,
        currency_symbol: currencySymbol.trim() || '₦',
        tax_id: taxId.trim(),
        tax_enabled: taxEnabled,
        tax_name: taxName.trim() || 'Tax',
        tax_rate: Math.max(0, Number(taxRate) || 0),
        tax_mode: taxMode,
        tax_applies_to: taxAppliesTo,
        full_name: fullName.trim(),
        username: username.trim(),
        password,
        create_team_profiles: createTeamProfiles,
        team_password: teamPassword,
      });
      if (err) setErrorMsg(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const err = await onLogin({
        username,
        password,
        opening_cash: Number(openingCash) || 0,
      });
      if (err) setErrorMsg(err);
    } finally {
      setSubmitting(false);
    }
  }

  const STEP_LABELS: Array<{ num: 1 | 2 | 3; label: string }> = [
    { num: 1, label: 'Hotel Profile' },
    { num: 2, label: 'Policies & Tax' },
    { num: 3, label: 'Admin Account' },
  ];

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
            {isDark ? <Sun className="h-3.5 w-3.5 text-[#6AD4B0]" /> : <Moon className="h-3.5 w-3.5 text-ink/60" />}
            <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>
          </button>
        </HoverTip>
      </div>

      <div className={`w-full space-y-7 ${authStatus.needsSetup ? 'max-w-xl' : 'max-w-md'}`}>
        {/* Brand Masthead */}
        <div className="text-center space-y-2">
          {(authStatus.needsSetup ? hotelLogoUrl : authStatus.hotelLogoUrl) && (
            <img
              src={authStatus.needsSetup ? hotelLogoUrl : authStatus.hotelLogoUrl}
              alt={authStatus.needsSetup ? hotelName : authStatus.hotelName}
              referrerPolicy="no-referrer"
              className="mx-auto mb-3 max-h-12 max-w-[160px] object-contain"
            />
          )}
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
            {authStatus.needsSetup ? 'Welcome to Hosila PMS' : authStatus.hotelName}
          </h1>
          <p className="text-sm text-ink/55">
            {authStatus.needsSetup
              ? 'Configure your hotel profile, policies, and primary administrator account.'
              : 'Sign in to open your workstation shift on the local network.'}
          </p>
        </div>

        {/* Onboarding Step Indicator */}
        {authStatus.needsSetup && (
          <div className="grid grid-cols-3 gap-2">
            {STEP_LABELS.map((item) => {
              const isDone = step > item.num;
              const isCurrent = step === item.num;
              return (
                <button
                  key={item.num}
                  type="button"
                  onClick={() => {
                    if (item.num < step) setStep(item.num);
                  }}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${isCurrent
                      ? 'border-[#6AD4B0] bg-[#6AD4B0]/15 text-ink'
                      : isDone
                        ? 'border-ink/15 bg-surface text-ink hover:border-[#6AD4B0]'
                        : 'border-ink/10 bg-surface text-ink/40'
                    }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${isDone || isCurrent
                        ? 'bg-[#6AD4B0] text-[#1D1D1F]'
                        : 'bg-ink/10 text-ink/45'
                      }`}
                  >
                    {isDone ? <Check className="h-3 w-3" /> : item.num}
                  </span>
                  <span className="truncate text-xs font-medium">{item.label}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="rounded-2xl border border-ink/12 bg-surface p-7">
          {errorMsg && (
            <div className="mb-5 rounded-xl border border-[#E05252]/35 bg-[#E05252]/8 px-4 py-3 text-xs font-medium text-danger-ink">
              {errorMsg}
            </div>
          )}

          {authStatus.needsSetup ? (
            <form onSubmit={handleSetupSubmit} className="space-y-5">
              {/* STEP 1: Hotel Information & Logo */}
              {step === 1 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-medium text-ink/65 mb-1.5">
                        Hotel Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={hotelName}
                        onChange={(e) => setHotelName(e.target.value)}
                        placeholder="e.g. The Linen House Hotel"
                        className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink/65 mb-1.5">
                        Tagline
                      </label>
                      <input
                        type="text"
                        value={hotelTagline}
                        onChange={(e) => setHotelTagline(e.target.value)}
                        placeholder="Quiet luxury on the harbor"
                        className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-ink/65 mb-1.5">
                      Street Address
                    </label>
                    <input
                      type="text"
                      value={hotelAddress}
                      onChange={(e) => setHotelAddress(e.target.value)}
                      placeholder="42 Harbor Boulevard, Downtown"
                      className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-medium text-ink/65 mb-1.5">
                        Phone Number
                      </label>
                      <input
                        type="text"
                        value={hotelPhone}
                        onChange={(e) => setHotelPhone(e.target.value)}
                        placeholder="+234 800 000 0000"
                        className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink/65 mb-1.5">
                        Front Desk Email
                      </label>
                      <input
                        type="email"
                        value={hotelEmail}
                        onChange={(e) => setHotelEmail(e.target.value)}
                        placeholder="frontdesk@hotel.com"
                        className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-ink/65 mb-1.5">
                      Website (Optional)
                    </label>
                    <input
                      type="url"
                      value={hotelWebsite}
                      onChange={(e) => setHotelWebsite(e.target.value)}
                      placeholder="https://yourhotel.com"
                      className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
                    />
                  </div>

                  {/* Logo Upload or Link */}
                  <div className="rounded-xl border border-ink/10 bg-ink/[0.02] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-ink">
                        Hotel Logo (Prints &amp; Emails)
                      </span>
                      {hotelLogoUrl && (
                        <button
                          type="button"
                          onClick={() => setHotelLogoUrl('')}
                          className="inline-flex items-center gap-1 text-xs text-ink/55 hover:text-ink"
                        >
                          <X className="h-3.5 w-3.5" />
                          Clear
                        </button>
                      )}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <input
                        type="text"
                        value={hotelLogoUrl.startsWith('data:') ? '' : hotelLogoUrl}
                        onChange={(e) => setHotelLogoUrl(e.target.value)}
                        placeholder="Paste logo URL (https://...)"
                        className="flex-1 rounded-xl border border-ink/15 bg-surface px-3 py-2 text-xs text-ink"
                      />
                      <HoverTip text="Upload a PNG, JPEG, or WebP logo up to 500 KB, or paste a direct image URL.">
                        <label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-ink/15 bg-surface px-3.5 py-2 text-xs font-medium text-ink hover:border-[#6AD4B0] transition-colors whitespace-nowrap">
                          <Upload className="h-3.5 w-3.5" />
                          Upload Logo
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={(e) => handleLogoFileUpload(e.target.files?.[0] ?? null)}
                          />
                        </label>
                      </HoverTip>
                    </div>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={handleNextStep}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#6AD4B0] px-5 py-2.5 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 transition-colors"
                    >
                      Continue to Policies
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2: Policies, Currency & Tax */}
              {step === 2 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-medium text-ink/65 mb-1.5">
                        Standard Check-In Time
                      </label>
                      <input
                        type="time"
                        value={checkInTime}
                        onChange={(e) => setCheckInTime(e.target.value)}
                        className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 font-mono text-sm text-ink"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink/65 mb-1.5">
                        Standard Check-Out Time
                      </label>
                      <input
                        type="time"
                        value={checkOutTime}
                        onChange={(e) => setCheckOutTime(e.target.value)}
                        className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 font-mono text-sm text-ink"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-medium text-ink/65 mb-1.5">
                        Currency Symbol *
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          required
                          maxLength={6}
                          value={currencySymbol}
                          onChange={(e) => setCurrencySymbol(e.target.value)}
                          className="w-20 rounded-xl border border-ink/15 bg-canvas px-3 py-2 text-center font-mono text-sm font-semibold text-ink"
                        />
                        <div className="flex flex-wrap gap-1">
                          {CURRENCY_PRESETS.slice(0, 6).map((sym) => (
                            <button
                              key={sym}
                              type="button"
                              onClick={() => setCurrencySymbol(sym)}
                              className={`rounded-lg border px-2 py-1 font-mono text-xs transition-colors ${currencySymbol === sym
                                  ? 'border-[#6AD4B0] bg-[#6AD4B0]/20 font-semibold text-ink'
                                  : 'border-ink/12 text-ink/65 hover:border-ink/30'
                                }`}
                            >
                              {sym.trim()}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-ink/65 mb-1.5">
                        Tax ID / Business Registration
                      </label>
                      <input
                        type="text"
                        value={taxId}
                        onChange={(e) => setTaxId(e.target.value)}
                        placeholder="e.g. TIN-4820194"
                        className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2 font-mono text-sm text-ink"
                      />
                    </div>
                  </div>

                  {/* Quick Tax Setup */}
                  <div className="rounded-xl border border-ink/12 bg-ink/[0.02] p-4 space-y-3.5">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-ink">
                        Enable Transaction Tax
                      </div>
                      <HoverTip text="Automatically applies tax to room and restaurant bills. Multiple tax rules can be configured in Settings.">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={taxEnabled}
                          onClick={() => setTaxEnabled((v) => !v)}
                          className={`relative h-6 w-11 rounded-full transition-colors ${taxEnabled ? 'bg-[#6AD4B0]' : 'bg-ink/20'
                            }`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${taxEnabled ? 'translate-x-5' : 'translate-x-0'
                              }`}
                          />
                        </button>
                      </HoverTip>
                    </div>

                    {taxEnabled && (
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <div>
                          <label className="block text-[11px] font-medium text-ink/60 mb-1">
                            Tax Name
                          </label>
                          <input
                            type="text"
                            value={taxName}
                            onChange={(e) => setTaxName(e.target.value)}
                            placeholder="VAT / State Tax"
                            className="w-full rounded-lg border border-ink/15 bg-surface px-3 py-2 text-xs text-ink"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-ink/60 mb-1">
                            Rate (%)
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            max="100"
                            value={taxRate}
                            onChange={(e) => setTaxRate(e.target.value)}
                            className="w-full rounded-lg border border-ink/15 bg-surface px-3 py-2 font-mono text-xs tabular-nums text-ink"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-ink/60 mb-1">
                            Pricing Mode
                          </label>
                          <select
                            value={taxMode}
                            onChange={(e) => setTaxMode(e.target.value as TaxMode)}
                            className="w-full rounded-lg border border-ink/15 bg-surface px-2.5 py-2 text-xs text-ink"
                          >
                            <option value="exclusive">Excluded (added to price)</option>
                            <option value="inclusive">Included in base price</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-ink/60 mb-1">
                            Applies To
                          </label>
                          <select
                            value={taxAppliesTo}
                            onChange={(e) => setTaxAppliesTo(e.target.value as TaxAppliesTo)}
                            className="w-full rounded-lg border border-ink/15 bg-surface px-2.5 py-2 text-xs text-ink"
                          >
                            <option value="both">Accommodation &amp; Restaurant</option>
                            <option value="accommodation">Accommodation only</option>
                            <option value="restaurant">Restaurant only</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-medium text-ink/65 hover:bg-ink/[0.05]"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleNextStep}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#6AD4B0] px-5 py-2.5 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 transition-colors"
                    >
                      Continue to Admin Account
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 3: Create First Admin Account */}
              {step === 3 && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-ink/65 mb-1.5">
                      Administrator Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Elena Brooks"
                      className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-ink/65 mb-1.5">
                        Username *
                      </label>
                      <input
                        type="text"
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="admin"
                        className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 font-mono text-sm text-ink"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink/65 mb-1.5">
                        Password *
                      </label>
                      <input
                        type="password"
                        required
                        minLength={4}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Min 4 chars"
                        className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-ink/10 bg-ink/[0.02] p-4 space-y-3">
                    <HoverTip
                      text="Management and Accountant accounts can access Finance and Settings. Front Desk and Restaurant roles stay focused on daily operations."
                      className="block w-full"
                    >
                      <label className="flex items-start gap-2.5 text-xs text-ink">
                        <input
                          type="checkbox"
                          checked={createTeamProfiles}
                          onChange={(e) => setCreateTeamProfiles(e.target.checked)}
                          className="mt-0.5 h-4 w-4 accent-[#6AD4B0]"
                        />
                        <span>
                          Also create staff accounts for <span className="font-mono">accountant</span>,{' '}
                          <span className="font-mono">frontdesk</span>, and{' '}
                          <span className="font-mono">restaurant</span>
                        </span>
                      </label>
                    </HoverTip>

                    {createTeamProfiles && (
                      <div>
                        <label className="block text-xs font-medium text-ink/65 mb-1.5">
                          Initial Staff Password *
                        </label>
                        <input
                          type="password"
                          required
                          minLength={4}
                          value={teamPassword}
                          onChange={(e) => setTeamPassword(e.target.value)}
                          placeholder="Set staff password (min 4 chars)"
                          className="w-full rounded-xl border border-ink/15 bg-surface px-3.5 py-2 text-sm text-ink"
                        />
                      </div>
                    )}
                  </div>

                  {/* Quiet Summary Review */}
                  <div className="rounded-xl border border-ink/10 px-4 py-3 text-xs text-ink/65 space-y-1">
                    <div className="font-medium text-ink">{hotelName}</div>
                    <div>
                      Check-in {checkInTime} · Check-out {checkOutTime} · Currency{' '}
                      <span className="font-mono text-ink">{currencySymbol}</span>
                      {taxId ? ` · Tax ID ${taxId}` : ''}
                    </div>
                    <div>
                      {taxEnabled
                        ? `${taxName || 'Tax'} ${taxRate || 0}% (${taxMode}) on ${taxAppliesTo}`
                        : 'Tax currently disabled'}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-medium text-ink/65 hover:bg-ink/[0.05]"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="rounded-xl bg-[#6AD4B0] px-6 py-2.5 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-50 transition-colors"
                    >
                      {submitting ? 'Setting up...' : 'Complete Setup & Launch'}
                    </button>
                  </div>
                </div>
              )}
            </form>
          ) : (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              {authStatus.staffDirectory.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-ink/60 mb-2">Select Staff Account</div>
                  <div className="grid grid-cols-2 gap-2">
                    {authStatus.staffDirectory.map((staff) => {
                      const active = username === staff.username;
                      return (
                        <button
                          key={staff.username}
                          type="button"
                          onClick={() => setUsername(staff.username)}
                          className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${active
                              ? 'border-[#6AD4B0] bg-[#6AD4B0]/15'
                              : 'border-ink/12 hover:border-ink/30'
                            }`}
                        >
                          <div className="text-xs font-semibold truncate text-ink">
                            {staff.full_name}
                          </div>
                          <div className="mt-0.5 text-[11px] text-ink/55">
                            {STAFF_ROLE_LABELS[staff.role]} · <span className="font-mono">{staff.username}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-ink/65 mb-1.5">Username</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 font-mono text-sm text-ink"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-ink/65 mb-1.5">Password</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter staff password"
                    className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink/65 mb-1.5">Opening Cash</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={openingCash}
                    onChange={(e) => setOpeningCash(e.target.value)}
                    className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2.5 font-mono text-sm tabular-nums text-ink"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-[#6AD4B0] py-3 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Signing In...' : 'Sign In & Start Shift'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-ink/40">Powered by Hosila</p>
      </div>
    </div>
  );
}
