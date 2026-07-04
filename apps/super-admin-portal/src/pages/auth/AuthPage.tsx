import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@org/data';

export function AuthPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [showForgot, setShowForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetStatus, setResetStatus] = useState<'idle' | 'sent' | 'error'>('idle');
  const [resetError, setResetError] = useState('');

  const [showSetPassword, setShowSetPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [setPasswordError, setSetPasswordError] = useState('');

  useEffect(() => {
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setShowSetPassword(true);
      } else if (event === 'SIGNED_IN' && session) {
        navigate('/');
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate('/');
    });
  }, [navigate]);

  const returnTo = searchParams.get('returnTo');

  async function handleAuth(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError(authError.message || 'Authentication failed.');
      } else {
        navigate(returnTo ?? '/');
      }
    } catch {
      setError('Unable to connect. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSendReset(e: FormEvent) {
    e.preventDefault();
    setResetError('');
    try {
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: window.location.origin + '/auth',
      });
      if (resetErr) { setResetError(resetErr.message); return; }
      setResetStatus('sent');
    } catch {
      setResetError('Could not send reset email. Please try again.');
    }
  }

  async function handleSetNewPassword(e: FormEvent) {
    e.preventDefault();
    setSetPasswordError('');
    if (newPassword !== confirmPassword) { setSetPasswordError('Passwords do not match.'); return; }
    if (newPassword.length < 8) { setSetPasswordError('Password must be at least 8 characters.'); return; }

    const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
    if (updateErr) { setSetPasswordError(updateErr.message); return; }
    setShowSetPassword(false);
    navigate('/');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F6FBFF] p-6">
      <div className="w-full max-w-[420px]">
        <div className="bg-white rounded-[20px] p-10 shadow-[0_12px_30px_rgba(11,42,74,0.12)] border border-[rgba(11,42,74,0.12)]">
          <div className="text-center mb-7">
            <span
              className="block text-[1.7rem] text-[#0B2A4A] font-normal"
              style={{ fontFamily: "'DM Serif Display', serif" }}
            >
              venOS Super Admin
            </span>
            <span className="block text-[0.8rem] text-[#64748b] mt-0.5">Super admin access only</span>
          </div>

          <h2 className="mt-0 mb-1.5 text-[1.25rem] font-bold text-[#0B2A4A]">Sign In</h2>
          <p className="mt-0 mb-5 text-[0.88rem] text-[#64748b]">Welcome back. Sign in to access the super admin portal.</p>

          <form onSubmit={handleAuth}>
            <div className="flex flex-col gap-3 mb-4">
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <div className="text-[#dc2626] text-[0.85rem] min-h-5 mb-2">{error}</div>
            <button type="submit" className="btn-primary w-full justify-center py-[11px] text-base" disabled={loading}>
              {loading && <span className="spinner" />}
              Sign In
            </button>
          </form>

          <p className="text-center text-[0.85rem] text-[#64748b] mt-3.5">
            <a
              href="#"
              className="text-[0.82em] text-[#64748b] no-underline hover:underline"
              onClick={e => { e.preventDefault(); setResetEmail(email); setShowForgot(true); }}
            >
              Forgot Password?
            </a>
          </p>
        </div>
      </div>

      {showForgot && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowForgot(false); }}>
          <div className="modal-box" style={{ maxWidth: 400 }}>
            <button className="modal-close" onClick={() => setShowForgot(false)}><i className="fa-solid fa-xmark" aria-hidden="true" /></button>
            <h3 style={{ margin: '0 0 8px' }}>Reset Password</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--muted)', margin: '0 0 16px' }}>
              Enter your email and we'll send a reset link.
            </p>
            {resetStatus === 'sent' ? (
              <p style={{ color: '#166534', fontSize: '0.9rem' }}>
                Reset link sent! Check your email — click the link, then come back here to set your new password.
              </p>
            ) : (
              <form onSubmit={handleSendReset}>
                <div className="form-group">
                  <input
                    type="email"
                    placeholder="Email address"
                    value={resetEmail}
                    onChange={e => setResetEmail(e.target.value)}
                    required
                  />
                </div>
                {resetError && <p className="form-error">{resetError}</p>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                  <button type="button" className="btn-secondary" onClick={() => setShowForgot(false)}>Cancel</button>
                  <button type="submit" className="btn-primary">Send Reset Link</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {showSetPassword && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 400 }}>
            <h3 style={{ margin: '0 0 8px' }}>Set New Password</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--muted)', margin: '0 0 16px' }}>
              Choose a new password for your account.
            </p>
            <form onSubmit={handleSetNewPassword}>
              <div className="form-group">
                <input
                  type="password"
                  placeholder="New password"
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
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              {setPasswordError && <p className="form-error">{setPasswordError}</p>}
              <button type="submit" className="btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                Update Password
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
