'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Image from 'next/image';
import Link from 'next/link';

type TokenStatus = 'loading' | 'valid' | 'invalid' | 'expired' | 'used' | 'error';

interface InviteData {
  email: string;
  role: string;
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  expires_at: string;
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<RegisterPageSkeleton />}>
      <RegisterPageContent />
    </Suspense>
  );
}

function RegisterPageSkeleton() {
  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 40, height: 40, border: '3px solid #e5e7eb', borderTopColor: '#2272B4', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      <style jsx>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function RegisterPageContent() {
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tokenStatus, setTokenStatus] = useState<TokenStatus>('loading');
  const [inviteData, setInviteData] = useState<InviteData | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const supabase = useMemo(() => {
    try {
      return createClient();
    } catch {
      return null;
    }
  }, []);

  // Validate token on mount
  useEffect(() => {
    if (!token) {
      setTokenStatus('invalid');
      return;
    }

    const validateToken = async () => {
      try {
        const res = await fetch(`/api/v1/invites/validate?token=${token}`);
        const json = await res.json();

        if (!json.data?.valid) {
          if (json.data?.error === 'TOKEN_EXPIRED') {
            setTokenStatus('expired');
          } else if (json.data?.error === 'TOKEN_ALREADY_USED') {
            setTokenStatus('used');
          } else {
            setTokenStatus('invalid');
          }
          return;
        }

        setInviteData({
          email: json.data.email,
          role: json.data.role,
          tenant: json.data.tenant,
          expires_at: json.data.expires_at,
        });
        setTokenStatus('valid');
      } catch {
        setTokenStatus('error');
      }
    };

    validateToken();
  }, [token]);

  // Check if user is already logged in
  useEffect(() => {
    if (!supabase) return;

    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // If logged in and has valid token, redirect to accept flow
        if (tokenStatus === 'valid' && token) {
          router.push(`/login?token=${token}&action=accept`);
        } else {
          router.push('/dashboard');
        }
      }
    };
    checkUser();
  }, [supabase, router, tokenStatus, token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate passwords match
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // Validate password strength
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          password,
          full_name: fullName,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        if (json.error?.code === 'USER_EXISTS') {
          setError('An account with this email already exists. Please login instead.');
        } else if (json.error?.code === 'TOKEN_EXPIRED') {
          setTokenStatus('expired');
        } else if (json.error?.code === 'TOKEN_USED') {
          setTokenStatus('used');
        } else {
          setError(json.error?.message || 'Registration failed. Please try again.');
        }
        return;
      }

      // Registration successful - sign in the user
      if (supabase && inviteData) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: inviteData.email,
          password,
        });

        if (signInError) {
          // Registration succeeded but auto-login failed
          // Redirect to login page
          router.push('/login?registered=true');
          return;
        }
      }

      // Redirect to dashboard
      router.push('/dashboard');
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin': return '#3b82f6';
      case 'counselor': return '#8b5cf6';
      case 'viewer': return '#6b7280';
      default: return '#6b7280';
    }
  };

  // Render error states
  if (tokenStatus === 'loading') {
    return (
      <div className="register-page">
        <div className="register-main">
          <div className="register-content">
            <div className="loading-spinner" />
            <p className="loading-text">Validating invite...</p>
          </div>
        </div>
        <style jsx>{styles}</style>
      </div>
    );
  }

  if (tokenStatus === 'invalid') {
    return (
      <div className="register-page">
        <RegisterHeader />
        <div className="register-main">
          <div className="register-content">
            <div className="error-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#ef4444" strokeWidth="2"/>
                <path d="M15 9L9 15M9 9L15 15" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <h1 className="register-title">Invalid Invite Link</h1>
            <p className="register-subtitle">
              This invite link is invalid or has been revoked. Please contact your administrator for a new invitation.
            </p>
            <Link href="/login" className="back-link">
              Go to Login
            </Link>
          </div>
        </div>
        <RegisterFooter />
        <style jsx>{styles}</style>
      </div>
    );
  }

  if (tokenStatus === 'expired') {
    return (
      <div className="register-page">
        <RegisterHeader />
        <div className="register-main">
          <div className="register-content">
            <div className="error-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#f59e0b" strokeWidth="2"/>
                <path d="M12 6V12L16 14" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <h1 className="register-title">Invite Expired</h1>
            <p className="register-subtitle">
              This invite link has expired. Please contact your administrator to request a new invitation.
            </p>
            <Link href="/login" className="back-link">
              Go to Login
            </Link>
          </div>
        </div>
        <RegisterFooter />
        <style jsx>{styles}</style>
      </div>
    );
  }

  if (tokenStatus === 'used') {
    return (
      <div className="register-page">
        <RegisterHeader />
        <div className="register-main">
          <div className="register-content">
            <div className="error-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#22c55e" strokeWidth="2"/>
                <path d="M8 12L11 15L16 9" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1 className="register-title">Invite Already Used</h1>
            <p className="register-subtitle">
              This invite has already been accepted. If this was you, please login with your account.
            </p>
            <Link href="/login" className="back-link">
              Go to Login
            </Link>
          </div>
        </div>
        <RegisterFooter />
        <style jsx>{styles}</style>
      </div>
    );
  }

  if (tokenStatus === 'error') {
    return (
      <div className="register-page">
        <RegisterHeader />
        <div className="register-main">
          <div className="register-content">
            <div className="error-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#ef4444" strokeWidth="2"/>
                <path d="M12 8V12M12 16H12.01" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <h1 className="register-title">Something Went Wrong</h1>
            <p className="register-subtitle">
              We couldn&apos;t validate your invite. Please try again or contact support.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="back-link"
              style={{ cursor: 'pointer', background: 'none', border: 'none' }}
            >
              Try Again
            </button>
          </div>
        </div>
        <RegisterFooter />
        <style jsx>{styles}</style>
      </div>
    );
  }

  // Valid token - show registration form
  return (
    <div className="register-page">
      <RegisterHeader />

      <div className="register-main">
        <div className="register-content">
          <div className="register-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="24" height="24" rx="6" fill="#2272B4"/>
              <path d="M7 8.5C7 7.67157 7.67157 7 8.5 7H10.5C11.3284 7 12 7.67157 12 8.5V10.5C12 11.3284 11.3284 12 10.5 12H8.5C7.67157 12 7 11.3284 7 10.5V8.5Z" fill="white"/>
              <path d="M12 13.5C12 12.6716 12.6716 12 13.5 12H15.5C16.3284 12 17 12.6716 17 13.5V15.5C17 16.3284 16.3284 17 15.5 17H13.5C12.6716 17 12 16.3284 12 15.5V13.5Z" fill="white"/>
              <path d="M7 13.5C7 12.6716 7.67157 12 8.5 12H10.5C11.3284 12 12 12.6716 12 13.5V15.5C12 16.3284 11.3284 17 10.5 17H8.5C7.67157 17 7 16.3284 7 15.5V13.5Z" fill="white" fillOpacity="0.5"/>
              <path d="M12 8.5C12 7.67157 12.6716 7 13.5 7H15.5C16.3284 7 17 7.67157 17 8.5V10.5C17 11.3284 16.3284 12 15.5 12H13.5C12.6716 12 12 11.3284 12 10.5V8.5Z" fill="white" fillOpacity="0.5"/>
            </svg>
          </div>

          <h1 className="register-title">Create your account</h1>
          <p className="register-subtitle">
            Join <strong>{inviteData?.tenant.name}</strong> as{' '}
            <span
              className="role-badge"
              style={{ backgroundColor: getRoleBadgeColor(inviteData?.role || '') }}
            >
              {inviteData?.role}
            </span>
          </p>

          <div className="register-card">
            {error && (
              <div className="register-error">{error}</div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={inviteData?.email || ''}
                  disabled
                  className="disabled-input"
                />
              </div>

              <div className="form-group">
                <label>Full Name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Enter your full name"
                  required
                  disabled={loading}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a password (min. 8 characters)"
                  required
                  minLength={8}
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                  required
                  minLength={8}
                  disabled={loading}
                />
              </div>

              <button type="submit" className="register-btn" disabled={loading}>
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
            </form>

            <div className="auth-toggle">
              <span>
                Already have an account?{' '}
                <Link href={`/login${token ? `?token=${token}` : ''}`}>Sign in</Link>
              </span>
            </div>
          </div>
        </div>
      </div>

      <RegisterFooter />
      <style jsx>{styles}</style>
    </div>
  );
}

function RegisterHeader() {
  return (
    <div className="register-header">
      <div className="register-brand">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="24" height="24" rx="6" fill="#2272B4"/>
          <path d="M7 8.5C7 7.67157 7.67157 7 8.5 7H10.5C11.3284 7 12 7.67157 12 8.5V10.5C12 11.3284 11.3284 12 10.5 12H8.5C7.67157 12 7 11.3284 7 10.5V8.5Z" fill="white"/>
          <path d="M12 13.5C12 12.6716 12.6716 12 13.5 12H15.5C16.3284 12 17 12.6716 17 13.5V15.5C17 16.3284 16.3284 17 15.5 17H13.5C12.6716 17 12 16.3284 12 15.5V13.5Z" fill="white"/>
          <path d="M7 13.5C7 12.6716 7.67157 12 8.5 12H10.5C11.3284 12 12 12.6716 12 13.5V15.5C12 16.3284 11.3284 17 10.5 17H8.5C7.67157 17 7 16.3284 7 15.5V13.5Z" fill="white" fillOpacity="0.5"/>
          <path d="M12 8.5C12 7.67157 12.6716 7 13.5 7H15.5C16.3284 7 17 7.67157 17 8.5V10.5C17 11.3284 16.3284 12 15.5 12H13.5C12.6716 12 12 11.3284 12 10.5V8.5Z" fill="white" fillOpacity="0.5"/>
        </svg>
        <span>Lead Gen CRM</span>
      </div>
    </div>
  );
}

function RegisterFooter() {
  return (
    <div className="register-footer">
      <div className="register-footer-brand">
        <span className="from-text">from</span>
        <Image src="/zunkireelabs-icon.png" alt="Zunkireelabs" width={18} height={18} />
        <span className="brand-name">zunkireelabs</span>
      </div>
      <div className="register-footer-links">
        <a href="#">Terms of service</a>
        <a href="#">Privacy policy</a>
        <span>&copy;2026 Zunkireelabs</span>
      </div>
    </div>
  );
}

const styles = `
  .register-page {
    height: 100vh;
    background: var(--background);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
    font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  .register-header,
  .register-main,
  .register-footer {
    position: relative;
    z-index: 1;
  }
  .register-header {
    flex-shrink: 0;
    padding: 20px 32px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .register-brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .register-brand span {
    font-size: 18px;
    font-weight: 600;
    color: var(--foreground);
    letter-spacing: -0.02em;
  }
  .register-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 40px 20px;
    overflow-y: auto;
  }
  .register-content {
    margin: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    max-width: 420px;
  }
  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid var(--border);
    border-top-color: var(--primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .loading-text {
    margin-top: 16px;
    color: var(--muted-foreground);
    font-size: 14px;
  }
  .error-icon {
    margin-bottom: 24px;
  }
  .register-icon {
    margin-bottom: 24px;
    flex-shrink: 0;
  }
  .register-title {
    font-size: 28px;
    font-weight: 600;
    color: var(--foreground);
    margin-bottom: 8px;
    text-align: center;
    letter-spacing: -0.025em;
  }
  .register-subtitle {
    font-size: 15px;
    font-weight: 400;
    color: var(--muted-foreground);
    margin-bottom: 32px;
    text-align: center;
    letter-spacing: -0.01em;
  }
  .register-subtitle strong {
    color: var(--foreground);
    font-weight: 600;
  }
  .role-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    color: white;
    font-size: 12px;
    font-weight: 500;
    text-transform: capitalize;
    vertical-align: middle;
  }
  .back-link {
    display: inline-block;
    margin-top: 24px;
    padding: 12px 24px;
    background: var(--primary);
    color: var(--primary-foreground);
    border-radius: 10px;
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
    transition: opacity 0.15s ease;
  }
  .back-link:hover {
    opacity: 0.9;
  }
  .register-card {
    width: 100%;
    max-width: 420px;
  }
  .register-error {
    background: #fef2f2;
    color: #991b1b;
    padding: 12px 14px;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 450;
    margin-bottom: 16px;
    letter-spacing: -0.01em;
  }
  :global(.dark) .register-error {
    background: #450a0a;
    color: #fca5a5;
  }
  .form-group {
    margin-bottom: 16px;
  }
  .form-group label {
    display: block;
    margin-bottom: 6px;
    font-size: 13px;
    font-weight: 500;
    color: var(--foreground);
  }
  .form-group input {
    width: 100%;
    padding: 12px 14px;
    font-size: 14px;
    font-weight: 400;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--card);
    color: var(--foreground);
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
    letter-spacing: -0.01em;
  }
  .form-group input:focus {
    border-color: var(--ring);
    box-shadow: 0 0 0 3px rgba(34, 114, 180, 0.15);
  }
  .form-group input::placeholder {
    color: var(--muted-foreground);
    font-weight: 400;
  }
  .form-group input:disabled {
    background: var(--muted);
    cursor: not-allowed;
  }
  .disabled-input {
    background: var(--muted) !important;
    color: var(--muted-foreground) !important;
  }
  .register-btn {
    width: 100%;
    padding: 12px 20px;
    font-size: 14px;
    font-weight: 500;
    border-radius: 10px;
    background: var(--primary);
    color: var(--primary-foreground);
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
    margin-top: 8px;
    letter-spacing: -0.01em;
  }
  .register-btn:hover:not(:disabled) {
    opacity: 0.9;
  }
  .register-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .auth-toggle {
    text-align: center;
    margin-top: 20px;
    font-size: 14px;
    font-weight: 400;
    color: var(--muted-foreground);
    letter-spacing: -0.01em;
  }
  .auth-toggle a {
    color: var(--foreground);
    font-weight: 500;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .auth-toggle a:hover {
    opacity: 0.8;
  }
  .register-footer {
    flex-shrink: 0;
    padding: 20px 32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  .register-footer-brand {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    letter-spacing: -0.01em;
  }
  .register-footer-brand .from-text {
    color: var(--muted-foreground);
    font-weight: 400;
  }
  .register-footer-brand .brand-name {
    color: var(--foreground);
    font-weight: 500;
  }
  .register-footer-links {
    display: flex;
    align-items: center;
    gap: 24px;
    font-size: 12px;
    font-weight: 400;
    color: var(--muted-foreground);
    letter-spacing: -0.01em;
  }
  .register-footer-links a {
    color: var(--muted-foreground);
    text-decoration: none;
    transition: color 0.15s ease;
  }
  .register-footer-links a:hover {
    color: var(--foreground);
  }
`;
