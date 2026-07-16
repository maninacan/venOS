import { useState, useEffect, type FormEvent } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@org/data';
import venviewLogo from '../../assets/venOS-logo.jpg';

type AuthMode = 'signin' | 'signup';

// Capture the password-recovery indicator at module load — this runs during the
// synchronous import phase, BEFORE Supabase's auto-init clears the URL hash in a
// microtask. Reading it later (during render) is too late: the hash is already
// gone, we'd miss the recovery flow, and getSession() would sign the user in.
const IS_RECOVERY_REDIRECT =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.hash.replace(/^#/, '')).get('type') === 'recovery';

export function AuthPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [signupSent, setSignupSent] = useState(false);
  const [existingAccount, setExistingAccount] = useState(false);
  const [resent, setResent] = useState(false);

  // Forgot password modal state
  const [showForgot, setShowForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetStatus, setResetStatus] = useState<'idle' | 'sent' | 'error'>('idle');
  const [resetError, setResetError] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  // Set new password modal (after clicking email link). IS_RECOVERY_REDIRECT is
  // captured at module load (see top of file) so it survives Supabase clearing
  // the hash during init.
  const isRecovery = IS_RECOVERY_REDIRECT;
  const [showSetPassword, setShowSetPassword] = useState(isRecovery);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [setPasswordError, setSetPasswordError] = useState('');

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setShowSetPassword(true);
      } else if (event === 'SIGNED_IN' && session && !isRecovery) {
        // Don't follow the auto sign-in that a recovery link produces — the
        // user must set a new password first.
        navigate('/companies');
      }
    });

    // A recovery redirect creates a valid session; skip the auto-navigate so the
    // set-password form stays up. Otherwise, send already-signed-in users in.
    if (!isRecovery) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) navigate('/companies');
      });
    }

    return () => subscription.unsubscribe();
  }, [navigate, isRecovery]);

  // Handle sq=connected param after Square OAuth
  const returnTo = searchParams.get('returnTo');

  async function handleAuth(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'signup') {
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + '/auth' },
        });
        if (authError) {
          setError(authError.message || t('error.authFailed', 'Authentication failed.'));
        } else if (data.session) {
          // Email confirmation disabled — signed in immediately.
          navigate(returnTo ?? '/companies');
        } else if (data.user && data.user.identities && data.user.identities.length === 0) {
          // Supabase returns no session + no error for BOTH a genuine new signup
          // (confirmation pending) AND an already-registered email (enumeration
          // protection returns an obfuscated user). They differ by identities: a
          // new user has one identity; a duplicate signup comes back with an
          // empty identities array. Detect the latter to point the user at sign-in
          // instead of the misleading "check your email" screen. Best-effort — if
          // Supabase ever stops exposing this, we fall through to signupSent.
          setExistingAccount(true);
        } else {
          // Confirmation required — verification email sent, no session yet.
          setSignupSent(true);
        }
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) {
          setError(authError.message || t('error.authFailed', 'Authentication failed.'));
        } else {
          navigate(returnTo ?? '/companies');
        }
      }
    } catch {
      setError(t('error.connect', 'Unable to connect. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleSendReset(e: FormEvent) {
    e.preventDefault();
    setResetError('');
    setResetLoading(true);
    try {
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: window.location.origin + '/auth',
      });
      if (resetErr) { setResetError(resetErr.message); return; }
      setResetStatus('sent');
    } catch {
      setResetError(t('error.sendReset', 'Could not send reset email. Please try again.'));
    } finally {
      setResetLoading(false);
    }
  }

  async function handleSetNewPassword(e: FormEvent) {
    e.preventDefault();
    setSetPasswordError('');
    if (newPassword !== confirmPassword) { setSetPasswordError(t('error.passwordsDoNotMatch', 'Passwords do not match.')); return; }
    if (newPassword.length < 8) { setSetPasswordError(t('error.passwordTooShort', 'Password must be at least 8 characters.')); return; }

    const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
    if (updateErr) { setSetPasswordError(updateErr.message); return; }
    setShowSetPassword(false);
    navigate('/companies');
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#f3f5fa]">
      {/* Header — matches the main app header */}
      <header className="bg-white px-5 h-[70px] flex items-center justify-between border-b border-[#dde3f0] shadow-[0_2px_6px_rgba(0,0,0,0.08)]">
        <Link to="/auth" className="flex items-center gap-2.5 no-underline">
          <img src={venviewLogo} alt={t('logoAlt', 'venOS')} className="h-[50px] w-auto" />
          <div>
            <span className="block text-[1.05rem] font-bold leading-tight" style={{ color: '#2E7D32' }}>
              {t('brand', 'venOS Events')}
            </span>
            <span className="block text-[0.68rem] text-[#666]">{t('tagline', 'Vendor Intelligence for Events')}</span>
          </div>
        </Link>
        <Link to="/auth" className="text-[0.87rem] text-[#222] no-underline hover:text-[#0B2A4A]">{t('home', 'Home')}</Link>
      </header>

      <div className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-[420px]">
        <div className="bg-white rounded-[20px] p-10 shadow-[0_12px_30px_rgba(11,42,74,0.12)] border border-[rgba(11,42,74,0.12)]">
          <div className="text-center mb-7">
            <span className="block text-[1.4rem] font-semibold" style={{ color: '#2E7D32' }}>{t('brand', 'venOS Events')}</span>
            <span className="block text-[0.8rem] text-[#64748b] mt-0.5">{t('tagline', 'Vendor Intelligence for Events')}</span>
          </div>

          {existingAccount ? (
            <div className="text-center py-2">
              <div className="text-[2.4rem] mb-2" style={{ color: '#0B2A4A' }}>
                <i className="fa-solid fa-circle-user" />
              </div>
              <h2 className="mt-0 mb-1.5 text-[1.25rem] font-bold text-[#0B2A4A]">{t('existingAccount.title', 'You already have an account')}</h2>
              <p className="mt-0 mb-5 text-[0.88rem] text-[#64748b]">
                <Trans
                  i18nKey="existingAccount.body"
                  ns="auth"
                  defaults="An account with <1>{{email}}</1> already exists. Sign in below, or reset your password if you've forgotten it."
                  values={{ email }}
                  components={{ 1: <strong className="text-[#0B2A4A]" /> }}
                />
              </p>
              <button
                type="button"
                className="btn-primary w-full justify-center py-[11px] text-base"
                onClick={() => { setExistingAccount(false); setMode('signin'); setPassword(''); setError(''); }}
              >
                <span>{t('signIn', 'Sign In')}</span>
              </button>
              <p className="text-center text-[0.85rem] text-[#64748b] mt-3.5">
                <a
                  href="#"
                  className="text-[#0B2A4A] font-semibold no-underline hover:underline"
                  onClick={e => { e.preventDefault(); setExistingAccount(false); setMode('signin'); setPassword(''); setError(''); setResetEmail(email); setShowForgot(true); }}
                >
                  {t('forgotPassword', 'Forgot Password?')}
                </a>
              </p>
            </div>
          ) : signupSent ? (
            <div className="text-center py-2">
              <div className="text-[2.4rem] mb-2" style={{ color: '#2E7D32' }}>
                <i className="fa-solid fa-envelope-circle-check" />
              </div>
              <h2 className="mt-0 mb-1.5 text-[1.25rem] font-bold text-[#0B2A4A]">{t('signupSent.title', 'Check your email')}</h2>
              <p className="mt-0 mb-5 text-[0.88rem] text-[#64748b]">
                <Trans
                  i18nKey="signupSent.body"
                  ns="auth"
                  defaults="We've sent a verification link to <1>{{email}}</1>. Click it to activate your account, then sign in."
                  values={{ email }}
                  components={{ 1: <strong className="text-[#0B2A4A]" /> }}
                />
              </p>
              <button
                type="button"
                className="btn-primary w-full justify-center py-[11px] text-base"
                onClick={() => { setSignupSent(false); setMode('signin'); setPassword(''); setError(''); }}
              >
                <span>{t('signupSent.backToSignIn', 'Back to Sign In')}</span>
              </button>
              <p className="text-center text-[0.82rem] text-[#64748b] mt-3.5">
                {t('signupSent.didntGetItPrefix', "Didn't get it? Check your spam folder, or ")}
                <a
                  href="#"
                  className="text-[#0B2A4A] font-semibold no-underline hover:underline"
                  onClick={async e => {
                    e.preventDefault();
                    setResent(false);
                    const { error: resendErr } = await supabase.auth.resend({
                      type: 'signup',
                      email,
                      options: { emailRedirectTo: window.location.origin + '/auth' },
                    });
                    if (resendErr) { setError(resendErr.message); }
                    else { setError(''); setResent(true); }
                  }}
                >
                  {t('signupSent.resendLink', 'resend the email')}
                </a>.
              </p>
              {resent && <div className="text-[#166534] text-[0.85rem] mt-1">{t('signupSent.resent', 'Verification email resent.')}</div>}
              {error && <div className="text-[#dc2626] text-[0.85rem] mt-1">{error}</div>}
              <p className="text-center text-[0.82rem] text-[#64748b] mt-3.5">
                {t('signupSent.alreadyHavePrefix', 'Already have an account? ')}
                <a
                  href="#"
                  className="text-[#0B2A4A] font-semibold no-underline hover:underline"
                  onClick={e => { e.preventDefault(); setSignupSent(false); setMode('signin'); setPassword(''); setError(''); setResetEmail(email); setShowForgot(true); }}
                >
                  {t('forgotPassword', 'Forgot Password?')}
                </a>
              </p>
            </div>
          ) : (
          <>
          <h2 className="mt-0 mb-1.5 text-[1.25rem] font-bold text-[#0B2A4A]">
            {mode === 'signin' ? t('signIn', 'Sign In') : t('signUp', 'Sign Up')}
          </h2>
          <p className="mt-0 mb-5 text-[0.88rem] text-[#64748b]">
            {mode === 'signin'
              ? t('signInSubtitle', 'Welcome back! Sign in to manage your events.')
              : t('signUpSubtitle', 'Create your account to get started.')}
          </p>

          <form onSubmit={handleAuth}>
            <div className="flex flex-col gap-3 mb-4">
              <input
                type="email"
                placeholder={t('emailPlaceholder', 'Email address')}
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
              <input
                type="password"
                placeholder={t('passwordPlaceholder', 'Password')}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            </div>
            <div className="text-[#dc2626] text-[0.85rem] min-h-5 mb-2">{error}</div>
            <button type="submit" className="btn-primary w-full justify-center py-[11px] text-base" disabled={loading}>
              {loading && <span className="spinner" />}
              <span>{mode === 'signin' ? t('signIn', 'Sign In') : t('signUp', 'Sign Up')}</span>
            </button>
          </form>

          <p className="text-center text-[0.85rem] text-[#64748b] mt-3.5">
            {mode === 'signin' ? t('noAccount', "Don't have an account? ") : t('haveAccount', 'Already have an account? ')}
            <a
              href="#"
              className="text-[#0B2A4A] font-semibold no-underline hover:underline"
              onClick={e => { e.preventDefault(); setMode(m => m === 'signin' ? 'signup' : 'signin'); setError(''); }}
            >
              {mode === 'signin' ? t('signUp', 'Sign Up') : t('signIn', 'Sign In')}
            </a>
          </p>

          {mode === 'signin' && (
            <p className="text-center text-[0.85rem] text-[#64748b] mt-2">
              <a
                href="#"
                className="text-[0.82em] text-[#64748b] no-underline hover:underline"
                onClick={e => { e.preventDefault(); setResetEmail(email); setShowForgot(true); }}
              >
                {t('forgotPassword', 'Forgot Password?')}
              </a>
            </p>
          )}
          </>
          )}
        </div>
      </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgot && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowForgot(false); }}>
          <div className="modal-box" style={{ maxWidth: 400 }}>
            <button className="modal-close" onClick={() => setShowForgot(false)}><i className="fa-solid fa-xmark" /></button>
            <h3 style={{ margin: '0 0 8px' }}>{t('reset.title', 'Reset Password')}</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--muted)', margin: '0 0 16px' }}>
              {t('reset.description', "Enter your email and we'll send a reset link.")}
            </p>
            {resetStatus === 'sent' ? (
              <p style={{ color: '#166534', fontSize: '0.9rem' }}>
                {t('reset.sent', 'Reset link sent! Check your email — click the link, then come back here to set your new password.')}
              </p>
            ) : (
              <form onSubmit={handleSendReset}>
                <div className="form-group">
                  <input
                    type="email"
                    placeholder={t('emailPlaceholder', 'Email address')}
                    value={resetEmail}
                    onChange={e => setResetEmail(e.target.value)}
                    required
                  />
                </div>
                {resetError && <p className="form-error">{resetError}</p>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                  <button type="button" className="btn-secondary" onClick={() => setShowForgot(false)} disabled={resetLoading}>{t('reset.cancel', 'Cancel')}</button>
                  <button type="submit" className="btn-primary" disabled={resetLoading}>
                    {resetLoading && <span className="spinner" />}
                    <span>{t('reset.sendLink', 'Send Reset Link')}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Set New Password Modal */}
      {showSetPassword && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 400 }}>
            <h3 style={{ margin: '0 0 8px' }}>{t('setPassword.title', 'Set New Password')}</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--muted)', margin: '0 0 16px' }}>
              {t('setPassword.description', 'Choose a new password for your account.')}
            </p>
            <form onSubmit={handleSetNewPassword}>
              <div className="form-group">
                <input
                  type="password"
                  placeholder={t('setPassword.newPasswordPlaceholder', 'New password')}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              <div className="form-group">
                <input
                  type="password"
                  placeholder={t('setPassword.confirmPasswordPlaceholder', 'Confirm new password')}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              {setPasswordError && <p className="form-error">{setPasswordError}</p>}
              <button type="submit" className="btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                {t('setPassword.update', 'Update Password')}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
