import { useState } from 'react';
import { KeyRound, Lock, Moon, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { commands } from '../../bindings/bindings';
import { useApp } from '../context/AppContext';
import { Button } from '../components/ui/Button';
import { Field, Input } from '../components/ui/Field';
import { ZoomScaleControl } from '../components/layout/AppShell';
import { cn } from '../lib/format';

export function LoginPage() {
  const { settings, setSessionUser, theme, setTheme } = useApp();
  const [mode, setMode] = useState<'password' | 'pin'>('password');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res =
        mode === 'password'
          ? await commands.login({ username: username.trim(), password })
          : await commands.loginWithPin({ username: username.trim(), pin: pin.trim() });

      if (res.status === 'error') {
        setError(res.error.message);
        return;
      }
      toast.success(`Signed in as ${res.data.full_name}`);
      setSessionUser(res.data);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full w-full bg-[var(--bg-canvas)] flex flex-col items-center justify-center p-6 relative">
      <div className="absolute top-4 right-5 flex items-center gap-2">
        <ZoomScaleControl />
        <Button
          variant="secondary"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          tooltip="Switch between Light and Dark theme"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>

      <div className="w-full max-w-[370px] animate-view-enter">
        <div className="flex flex-col items-center text-center mb-5">
          <img src="/hosila-icon.svg" alt="Hosila IMS" className="h-10 w-10 mb-2.5" />
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            <span className="text-accent-ink">Hosila</span> IMS
          </h1>
          {settings?.business_profile.name && (
            <p className="text-xs text-ink/60">
              {settings.business_profile.name}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-ink/10 bg-surface p-6">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-ink/[0.05] mb-4">
            <button
              type="button"
              onClick={() => {
                setMode('password');
                setError(null);
              }}
              className={cn(
                'flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-medium transition-colors cursor-pointer',
                mode === 'password'
                  ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                  : 'text-ink/50 hover:text-ink'
              )}
            >
              <Lock className="h-3.5 w-3.5" />
              Password
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('pin');
                setError(null);
              }}
              className={cn(
                'flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-medium transition-colors cursor-pointer',
                mode === 'pin'
                  ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                  : 'text-ink/50 hover:text-ink'
              )}
            >
              <KeyRound className="h-3.5 w-3.5" />
              Quick PIN
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <Field label="Username" required>
              <Input
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                autoComplete="username"
              />
            </Field>

            {mode === 'password' ? (
              <Field label="Password" required>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </Field>
            ) : (
              <Field label="PIN" required>
                <Input
                  type="password"
                  inputMode="numeric"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="••••"
                  className="tracking-[0.35em] text-center font-mono font-semibold tabular-nums text-base"
                />
              </Field>
            )}

            {error && (
              <div className="rounded-xl bg-[#E05252]/[0.07] border border-[#E05252]/30 px-3 py-2 text-xs text-danger-ink">
                {error}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              className="w-full"
            >
              Sign In
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
