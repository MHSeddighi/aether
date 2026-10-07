import React, { useState } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { writeRoute } from '../../lib/router';
import { Sparkles, Mail, Lock, User, ArrowRight, ArrowLeft, Check } from 'lucide-react';

type AuthMode = 'signin' | 'signup';

const fieldBase =
  'w-full h-11 ps-10 pe-3 rounded-lg bg-[var(--md-sys-color-surface-container)] text-sm text-[var(--md-sys-color-on-surface)] placeholder:text-[var(--md-sys-color-on-surface-variant)] outline-none focus:outline-none transition-colors';
const labelBase = 'block text-xs font-medium text-[var(--md-sys-color-on-surface-variant)] mb-1.5';

export const AuthWorkspace: React.FC = () => {
  const { signIn, signUp, t, isRTL } = useWorkspace();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignUp = mode === 'signup';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSignUp && password !== confirm) {
      setError(t.authCheckPasswords);
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (isSignUp) {
        await signUp(email.trim(), name.trim() || email.split('@')[0], password);
      } else {
        await signIn(email.trim(), password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSocial = async () => {
    if (!email.trim() || !password) {
      setError('Enter your email and password first.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
    writeRoute({ section: 'auth' });
  };

  return (
    <div className="relative min-h-screen w-full bg-[var(--md-sys-color-surface)] text-[var(--md-sys-color-on-surface)] overflow-y-auto">
      {/* Backdrop: swap in your own asset by replacing /auth-backdrop.svg */}
      <img
        src="/auth-backdrop.svg"
        alt=""
        aria-hidden="true"
        className="fixed inset-0 w-full h-full object-cover opacity-70 dark:opacity-100 pointer-events-none"
      />
      <div className="fixed inset-0 bg-gradient-to-b from-[var(--md-sys-color-surface)]/70 via-[var(--md-sys-color-surface)]/60 to-[var(--md-sys-color-surface)]/95 pointer-events-none" />

      <div className="relative min-h-screen flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          {/* Brand */}
          <div className="flex items-center gap-2.5 mb-8">
            <span className="w-10 h-10 rounded-xl bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </span>
            <span className="text-sm font-semibold">{t.appName}</span>
          </div>

          {/* Card */}
          <div className="rounded-2xl bg-[var(--md-sys-color-surface-container)]/85 backdrop-blur-sm p-6 shadow-2xl">
            <h1 className="text-xl font-semibold">{isSignUp ? t.authSignUpTitle : t.authSignInTitle}</h1>
            <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] mt-1.5 leading-relaxed">
              {t.authTagline}
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-3.5">
              {isSignUp && (
                <div>
                  <label htmlFor="auth-name" className={labelBase}>
                    {t.authFullName}
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 absolute start-3.5 top-1/2 -translate-y-1/2 text-[var(--md-sys-color-on-surface-variant)]" />
                    <input
                      id="auth-name"
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={fieldBase}
                      autoComplete="name"
                    />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="auth-email" className={labelBase}>
                  {t.authEmail}
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute start-3.5 top-1/2 -translate-y-1/2 text-[var(--md-sys-color-on-surface-variant)]" />
                  <input
                    id="auth-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={fieldBase}
                    autoComplete="email"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label htmlFor="auth-password" className="text-xs font-medium text-[var(--md-sys-color-on-surface-variant)]">
                    {t.authPassword}
                  </label>
                  {!isSignUp && (
                    <button
                      type="button"
                      className="text-[11px] text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] transition-colors"
                    >
                      {t.authForgot}
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute start-3.5 top-1/2 -translate-y-1/2 text-[var(--md-sys-color-on-surface-variant)]" />
                  <input
                    id="auth-password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={fieldBase}
                    autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  />
                </div>
              </div>

              {isSignUp && (
                <div>
                  <label htmlFor="auth-confirm" className={labelBase}>
                    {t.authPassword}
                  </label>
                  <div className="relative">
                    <Check className="w-4 h-4 absolute start-3.5 top-1/2 -translate-y-1/2 text-[var(--md-sys-color-on-surface-variant)]" />
                    <input
                      id="auth-confirm"
                    type="password"
                    required
                    minLength={8}
                    value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      className={fieldBase}
                      autoComplete="new-password"
                    />
                  </div>
                </div>
              )}

              {!isSignUp && (
                <label className="flex items-center gap-2 text-xs text-[var(--md-sys-color-on-surface-variant)] cursor-pointer select-none">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={remember}
                    onClick={() => setRemember((v) => !v)}
                    className={`w-4 h-4 rounded flex items-center justify-center transition-colors ${
                      remember
                        ? 'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]'
                        : 'bg-[var(--md-sys-color-surface-container-highest)]'
                    }`}
                  >
                    {remember && <Check className="w-3 h-3" />}
                  </button>
                  {t.authRememberMe}
                </label>
              )}

              {error && (
                <p role="alert" className="text-xs text-[var(--md-sys-color-error)]">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full h-11 rounded-lg bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] text-sm font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5 disabled:opacity-60"
              >
                <span>{busy ? '…' : isSignUp ? t.authCreateAccount : t.authContinue}</span>
                {isRTL ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-[var(--md-sys-color-outline-variant)]" />
              <span className="text-[11px] text-[var(--md-sys-color-on-surface-variant)]">{t.authOr}</span>
              <span className="h-px flex-1 bg-[var(--md-sys-color-outline-variant)]" />
            </div>

            <div className="space-y-2">
              {[t.authGoogle, t.authGithub].map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={handleSocial}
                  disabled={busy}
                  className="w-full h-10 rounded-lg bg-[var(--md-sys-color-surface-container-high)] hover:bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface)] text-xs font-medium transition-colors disabled:opacity-60"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <p className="mt-5 text-center text-xs text-[var(--md-sys-color-on-surface-variant)]">
            {isSignUp ? t.authHaveAccount : t.authNoAccount}{' '}
            <button
              type="button"
              onClick={() => switchMode(isSignUp ? 'signin' : 'signup')}
              className="font-semibold text-[var(--md-sys-color-on-surface)] hover:underline"
            >
              {isSignUp ? t.authContinue : t.authCreateAccount}
            </button>
          </p>

          <p className="mt-6 text-center text-[10px] text-[var(--md-sys-color-on-surface-variant)] max-w-xs mx-auto">
            {t.authFooter}
          </p>
        </div>
      </div>
    </div>
  );
};