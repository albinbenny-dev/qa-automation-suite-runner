import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { setAuth } from '../lib/auth';
import { useProjectStore } from '../stores/projectStore';
import { useAuthConfig } from '../hooks/useAuthConfig';
import GoogleAuthButton from '../components/ui/GoogleAuthButton';
import type { AuthResponse } from '../types';
import toast from 'react-hot-toast';

export default function Login() {
  const navigate = useNavigate();
  const { setCurrentUser } = useProjectStore();
  const { data: authConfig } = useAuthConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // ── Google SSO handler ─────────────────────────────────────────────────────
  async function handleGoogleCredential(credential: string) {
    setGoogleLoading(true);
    try {
      const res = await api.post<AuthResponse>('/auth/google', { credential });
      setAuth(res.data.token, res.data.user);
      setCurrentUser(res.data.user);
      toast.success(`Welcome, ${res.data.user.name}!`);
      navigate('/projects', { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Google sign-in failed. Please try again.';
      toast.error(msg);
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<AuthResponse>('/auth/login', { email, password });
      setAuth(res.data.token, res.data.user);
      setCurrentUser(res.data.user);
      toast.success(`Welcome back, ${res.data.user.name}!`);
      navigate('/projects', { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Login failed. Please check your credentials.';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        fontFamily: 'var(--font-ui)',
        background: 'var(--bg)',
      }}
    >
      {/* Left panel — brand */}
      <div
        style={{
          flex: '0 0 50%',
          background: 'linear-gradient(160deg, #06224A 0%, #0A2A57 50%, #2563AB 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px 48px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Decorative glow */}
        <div
          style={{
            position: 'absolute',
            bottom: '-80px',
            right: '-80px',
            width: '320px',
            height: '320px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(37,99,171,0.25) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        {/* QA∞ icon */}
        <div
          style={{
            width: '80px',
            height: '80px',
            borderRadius: '20px',
            background: 'linear-gradient(135deg, #FFB347, #F47B20)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '42px',
            fontWeight: 800,
            color: '#fff',
            marginBottom: '28px',
            boxShadow: '0 8px 24px rgba(244,123,32,0.4)',
          }}
        >
          ∞
        </div>

        <h1
          style={{
            fontSize: '32px',
            fontWeight: 800,
            color: '#fff',
            letterSpacing: '-0.5px',
            marginBottom: '6px',
            textAlign: 'center',
          }}
        >
          QA Infinity
        </h1>

        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: 'rgba(255,255,255,0.45)',
            letterSpacing: '2px',
            textTransform: 'uppercase',
            marginBottom: '36px',
            textAlign: 'center',
          }}
        >
          Autonomous QA Automation Platform
        </p>

        {/* Feature list — colourful per-feature icons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', maxWidth: '300px' }}>
          {[
            {
              label: 'AI Test Case Generation',
              sub: 'From Jira, PRD, HLD, API specs',
              icon: '🤖',
              bg: 'rgba(139,92,246,0.28)',
              border: 'rgba(139,92,246,0.55)',
            },
            {
              label: 'Playwright Script Authoring',
              sub: 'Full TypeScript + Page Object Models',
              icon: '⌨',
              bg: 'rgba(34,211,238,0.22)',
              border: 'rgba(34,211,238,0.50)',
            },
            {
              label: 'Automated Test Execution',
              sub: 'Parallel, scheduled, or ad-hoc runs',
              icon: '▶',
              bg: 'rgba(244,123,32,0.28)',
              border: 'rgba(244,123,32,0.55)',
            },
            {
              label: 'Intelligent Self-Healing',
              sub: 'Auto-fix selector & flow drift',
              icon: '🩹',
              bg: 'rgba(42,157,143,0.28)',
              border: 'rgba(42,157,143,0.55)',
            },
          ].map((f) => (
            <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '10px',
                  background: f.bg,
                  border: `1.5px solid ${f.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '16px',
                  flexShrink: 0,
                }}
              >
                {f.icon}
              </div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>{f.label}</div>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.50)', fontFamily: 'var(--font-mono)' }}>
                  {f.sub}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 6D logo */}
        <div style={{ position: 'absolute', bottom: '24px', left: '48px' }}>
          <img
            src="/6d-logo-white.png"
            alt="6D Technologies"
            style={{ height: '24px', opacity: 0.7 }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      </div>

      {/* Right panel — login form */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px',
          background: '#fff',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '400px',
            background: '#fff',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            padding: '40px',
            boxShadow: '0 8px 32px rgba(15,25,50,0.08)',
          }}
        >
          <div style={{ marginBottom: '32px' }}>
            <div className="page-eyebrow">Sign in</div>
            <h2
              style={{
                fontSize: '22px',
                fontWeight: 800,
                color: 'var(--text)',
                letterSpacing: '-0.3px',
                marginTop: '4px',
              }}
            >
              Welcome back
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text-mid)', marginTop: '6px' }}>
              Enter your credentials to access QA Infinity.
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div>
              <label
                htmlFor="email"
                style={{
                  display: 'block',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  fontWeight: 700,
                  letterSpacing: '1.2px',
                  textTransform: 'uppercase',
                  color: 'var(--text-mid)',
                  marginBottom: '6px',
                }}
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                className="input-field"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                style={{ fontFamily: 'var(--font-ui)', fontSize: '14px' }}
              />
            </div>

            <div>
              <label
                htmlFor="password"
                style={{
                  display: 'block',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  fontWeight: 700,
                  letterSpacing: '1.2px',
                  textTransform: 'uppercase',
                  color: 'var(--text-mid)',
                  marginBottom: '6px',
                }}
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                className="input-field"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                style={{ fontFamily: 'var(--font-ui)', fontSize: '14px' }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px',
                background: loading
                  ? 'rgba(244,123,32,0.5)'
                  : 'linear-gradient(135deg, #F47B20, #D9601A)',
                border: 'none',
                borderRadius: 'var(--radius)',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'var(--font-ui)',
                transition: 'opacity 0.15s',
                marginTop: '4px',
              }}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          {/* ── Google SSO ──────────────────────────────────────────────── */}
          {authConfig?.googleEnabled && (
            <>
              {/* OR divider */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  margin: '20px 0 16px',
                }}
              >
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--text-dim)',
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '1px',
                    textTransform: 'uppercase',
                  }}
                >
                  or
                </span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>

              <GoogleAuthButton
                clientId={authConfig.googleClientId!}
                onCredential={handleGoogleCredential}
                text="signin_with"
                loading={googleLoading}
              />

              {authConfig.allowedDomains.length > 0 && (
                <p
                  style={{
                    marginTop: 10,
                    textAlign: 'center',
                    fontSize: 11,
                    color: 'var(--text-dim)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  Restricted to{' '}
                  <strong style={{ color: 'var(--cyan)' }}>
                    {authConfig.allowedDomains.join(', ')}
                  </strong>
                </p>
              )}
            </>
          )}

          <div
            style={{
              marginTop: '24px',
              textAlign: 'center',
              fontSize: '12px',
              color: 'var(--text-dim)',
            }}
          >
            Don't have an account?{' '}
            <Link
              to="/register"
              style={{ color: 'var(--cyan)', fontWeight: 600, textDecoration: 'none' }}
            >
              Register here
            </Link>
          </div>

          <div
            style={{
              marginTop: '20px',
              padding: '12px',
              background: 'var(--surface2)',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
            }}
          >
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--text-dim)',
                letterSpacing: '0.5px',
                textAlign: 'center',
              }}
            >
              6D Technologies · QA Infinity
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
