import React, { useEffect, useState } from 'react';
import { Truck, Users, ShieldCheck, Calculator, UserPlus, LogIn, Building2, Layers, Cloud } from 'lucide-react';
import type { PublicProfile, Role } from '../types.ts';
import { api, setStoredToken } from '../lib/api.ts';
import {
  auth,
  onAuthStateChanged,
  signInWithGoogleCloud,
  signOutGoogleCloud,
  type User,
} from '../firebase.ts';
import {
  ensureBootHydrated,
  syncCurrentClientWorkspace,
  syncFromCloudAndHydrate,
} from '../lib/persistence.ts';
import { LanguageSwitcher, useI18n } from '../lib/i18n.tsx';
import { PWAInstallButton } from './PWAInstallPrompt.tsx';
import { B2BSubscribeModal } from './B2BSubscribeModal.tsx';

interface AuthScreenProps {
  initialWorkspaceCode?: string;
  initialTab?: 'login' | 'register';
  blockedMessage?: string | null;
  onSuccess: (profile: PublicProfile) => void;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export function AuthScreen({
  initialWorkspaceCode,
  initialTab,
  blockedMessage,
  onSuccess,
  notify,
}: AuthScreenProps) {
  const { t, roleLabel } = useI18n();
  const [tab, setTab] = useState<'login' | 'register'>(
    initialTab || (initialWorkspaceCode ? 'register' : 'login'),
  );
  const [registerMode, setRegisterMode] = useState<'join' | 'create'>(
    initialWorkspaceCode ? 'join' : 'create',
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(blockedMessage || null);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [cloudUser, setCloudUser] = useState<User | null>(() => auth.currentUser);
  const [cloudSyncing, setCloudSyncing] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      setCloudUser(fbUser);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (initialWorkspaceCode) {
      setTab('register');
      setRegisterMode('join');
      setJoinCode(initialWorkspaceCode);
    }
  }, [initialWorkspaceCode]);

  useEffect(() => {
    if (blockedMessage) setError(blockedMessage);
  }, [blockedMessage]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginWsCode, setLoginWsCode] = useState(initialWorkspaceCode || '');

  const [fullName, setFullName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regRole, setRegRole] = useState<Role>('logistique');
  const [companyName, setCompanyName] = useState('');
  const [joinCode, setJoinCode] = useState(initialWorkspaceCode || 'DEMO');
  const [wsPreview, setWsPreview] = useState<{ name: string; code: string } | null>(null);

  useEffect(() => {
    const code = (joinCode || 'DEMO').trim();
    if (!code) {
      setWsPreview(null);
      return;
    }
    let cancelled = false;
    api<{ name: string; code: string }>(`/api/auth/workspace-preview?code=${encodeURIComponent(code)}`)
      .then((res) => {
        if (!cancelled) setWsPreview(res);
      })
      .catch(() => {
        if (!cancelled) setWsPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [joinCode]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await ensureBootHydrated();
      const res = await api<{ token: string; profile: PublicProfile }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          password,
          workspaceCode: loginWsCode.trim() || undefined,
        }),
      });
      setStoredToken(res.token);
      await syncCurrentClientWorkspace(auth.currentUser);
      onSuccess(res.profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion impossible.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await ensureBootHydrated();
      const res = await api<{ token: string; profile: PublicProfile }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          mode: registerMode,
          full_name: fullName.trim(),
          email: regEmail.trim(),
          password: regPassword,
          role: regRole,
          company_name: companyName.trim(),
          workspace_code: joinCode.trim() || 'DEMO',
        }),
      });
      setStoredToken(res.token);
      await syncCurrentClientWorkspace(auth.currentUser);
      notify(t('auth.reg.welcome', { name: res.profile.full_name }), 'success');
      onSuccess(res.profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inscription impossible.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDemoAccess(role: Role) {
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ token: string; profile: PublicProfile }>('/api/auth/demo', {
        method: 'POST',
        body: JSON.stringify({ role }),
      });
      setStoredToken(res.token);
      await syncCurrentClientWorkspace(auth.currentUser);
      onSuccess(res.profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Accès rapide indisponible.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCloudRestore() {
    setCloudSyncing(true);
    try {
      const user = await signInWithGoogleCloud();
      setCloudUser(user);
      await syncFromCloudAndHydrate(user);
      notify(`Données Cloud restaurées (${user.email || 'Google'}).`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (!msg.includes('popup-closed-by-user')) {
        notify('Restauration Cloud Google annulée ou indisponible.', 'error');
      }
    } finally {
      setCloudSyncing(false);
    }
  }

  async function handleCloudDisconnect() {
    await signOutGoogleCloud().catch(() => {});
    setCloudUser(null);
    notify('Compte Cloud Google déconnecté.', 'info');
  }

  const demoRoles: Array<{ role: Role; label: string; desc: string; icon: React.ReactNode }> = [
    {
      role: 'admin',
      label: roleLabel('admin'),
      desc: t('auth.demo.admin_desc'),
      icon: <ShieldCheck className="w-4 h-4 text-[#17324d]" />,
    },
    {
      role: 'logistique',
      label: roleLabel('logistique'),
      desc: t('auth.demo.logistique_desc'),
      icon: <Truck className="w-4 h-4 text-[#2367a5]" />,
    },
    {
      role: 'comptable',
      label: roleLabel('comptable'),
      desc: t('auth.demo.comptable_desc'),
      icon: <Calculator className="w-4 h-4 text-emerald-700" />,
    },
    {
      role: 'conducteur',
      label: roleLabel('conducteur'),
      desc: t('auth.demo.conducteur_desc'),
      icon: <Users className="w-4 h-4 text-amber-700" />,
    },
  ];

  return (
    <div className="min-h-screen bg-[#f3f6f9] flex flex-col">
      <header className="bg-[#17324d] text-white px-5 sm:px-8 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-extrabold tracking-tight">{t('app.brand')}</span>
          <span className="hidden md:inline text-slate-300 text-sm">{t('app.tagline')}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {cloudUser?.emailVerified ? (
            <button
              type="button"
              onClick={handleCloudDisconnect}
              title={cloudUser.email || 'Cloud Google connecté'}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-100 text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>Cloud actif</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={cloudSyncing}
              onClick={handleCloudRestore}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors whitespace-nowrap disabled:opacity-50"
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>{cloudSyncing ? 'Sync…' : 'Sauvegarde Cloud'}</span>
            </button>
          )}
          <PWAInstallButton variant="dark" />
          <LanguageSwitcher variant="dark" />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
          <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left column: Sign in / Free registration */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 sm:p-7">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg mb-6 w-fit">
                <button
                  type="button"
                  onClick={() => {
                    setTab('login');
                    setError(null);
                  }}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${
                    tab === 'login'
                      ? 'bg-white text-[#17324d] shadow-sm'
                      : 'text-slate-600 hover:text-[#17324d]'
                  }`}
                >
                  <LogIn className="w-4 h-4" />
                  {t('auth.tab.login')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTab('register');
                    setError(null);
                  }}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${
                    tab === 'register'
                      ? 'bg-white text-[#17324d] shadow-sm'
                      : 'text-slate-600 hover:text-[#17324d]'
                  }`}
                >
                  <UserPlus className="w-4 h-4" />
                  {t('auth.tab.register')}
                </button>
              </div>

              {error && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 space-y-2.5">
                  <div>{error}</div>
                  {blockedMessage && (
                    <button
                      type="button"
                      onClick={() => setSubscribeOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#17324d] hover:bg-[#1f4469] text-white text-xs font-bold transition-colors"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>{t('sub.blocked_cta')}</span>
                    </button>
                  )}
                </div>
              )}

              {tab === 'login' ? (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <h1 className="text-2xl font-bold text-[#17324d]">{t('auth.login.title')}</h1>
                    <p className="text-sm text-slate-500 mt-1">{t('auth.login.sub')}</p>
                  </div>

                  <div>
                    <label htmlFor="login-email" className="block text-xs font-bold text-slate-700 mb-1.5">
                      {t('auth.login.email')}
                    </label>
                    <input
                      id="login-email"
                      type="email"
                      required
                      autoComplete="username"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="nom@entreprise.ma"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                    />
                  </div>

                  <div>
                    <label htmlFor="login-password" className="block text-xs font-bold text-slate-700 mb-1.5">
                      {t('auth.login.password')}
                    </label>
                    <input
                      id="login-password"
                      type="password"
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                    />
                  </div>

                  <div>
                    <label htmlFor="login-ws" className="block text-xs font-bold text-slate-700 mb-1.5">
                      {t('auth.login.wscode')}
                    </label>
                    <input
                      id="login-ws"
                      type="text"
                      value={loginWsCode}
                      onChange={(e) => setLoginWsCode(e.target.value.toUpperCase())}
                      placeholder={t('auth.login.wscode_ph')}
                      className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 px-4 rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white font-bold text-sm transition-colors disabled:opacity-50"
                  >
                    {loading ? t('auth.login.submitting') : t('auth.login.submit')}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleRegister} className="space-y-4">
                  <div>
                    <h1 className="text-2xl font-bold text-[#17324d]">{t('auth.reg.title')}</h1>
                    <p className="text-sm text-slate-500 mt-1">{t('auth.reg.sub')}</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setRegisterMode('create')}
                      className={`flex items-center gap-2.5 p-3 rounded-lg border text-start transition-colors ${
                        registerMode === 'create'
                          ? 'border-[#2367a5] bg-[#eef4f8] text-[#17324d]'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <Building2 className="w-4 h-4 shrink-0 text-[#2367a5]" />
                      <div>
                        <div className="text-xs font-bold">{t('auth.reg.create')}</div>
                        <div className="text-[11px] text-slate-500">{t('auth.reg.create_sub')}</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRegisterMode('join')}
                      className={`flex items-center gap-2.5 p-3 rounded-lg border text-start transition-colors ${
                        registerMode === 'join'
                          ? 'border-[#2367a5] bg-[#eef4f8] text-[#17324d]'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <Users className="w-4 h-4 shrink-0 text-[#2367a5]" />
                      <div>
                        <div className="text-xs font-bold">{t('auth.reg.join')}</div>
                        <div className="text-[11px] text-slate-500">{t('auth.reg.join_sub')}</div>
                      </div>
                    </button>
                  </div>

                  {registerMode === 'join' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="join-code" className="block text-xs font-bold text-slate-700 mb-1.5">
                          {t('auth.reg.code')}
                        </label>
                        <input
                          id="join-code"
                          type="text"
                          required
                          value={joinCode}
                          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                          placeholder="DEMO"
                          className="w-full px-3.5 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                        />
                        {wsPreview ? (
                          <p className="text-xs text-emerald-700 mt-1 font-medium">
                            {t('auth.reg.ws_found', { name: wsPreview.name })}
                          </p>
                        ) : (
                          <p className="text-xs text-slate-500 mt-1">{t('auth.reg.ws_hint')}</p>
                        )}
                      </div>
                      <div>
                        <label htmlFor="reg-role" className="block text-xs font-bold text-slate-700 mb-1.5">
                          {t('auth.reg.role')}
                        </label>
                        <select
                          id="reg-role"
                          value={regRole}
                          onChange={(e) => setRegRole(e.target.value as Role)}
                          className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#2367a5]"
                        >
                          {(['admin', 'logistique', 'comptable', 'conducteur'] as Role[]).map((r) => (
                            <option key={r} value={r}>
                              {roleLabel(r)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label htmlFor="company-name" className="block text-xs font-bold text-slate-700 mb-1.5">
                        {t('auth.reg.company')}
                      </label>
                      <input
                        id="company-name"
                        type="text"
                        required
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        placeholder={t('auth.reg.company_ph')}
                        className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="reg-name" className="block text-xs font-bold text-slate-700 mb-1.5">
                        {t('auth.reg.fullname')}
                      </label>
                      <input
                        id="reg-name"
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder={t('auth.reg.fullname_ph')}
                        className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                      />
                    </div>
                    <div>
                      <label htmlFor="reg-email" className="block text-xs font-bold text-slate-700 mb-1.5">
                        {t('auth.reg.email')}
                      </label>
                      <input
                        id="reg-email"
                        type="email"
                        required
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="vous@exemple.com"
                        className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="reg-pass" className="block text-xs font-bold text-slate-700 mb-1.5">
                      {t('auth.reg.password')}
                    </label>
                    <input
                      id="reg-pass"
                      type="password"
                      required
                      minLength={4}
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder={t('auth.reg.password_ph')}
                      className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 px-4 rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white font-bold text-sm transition-colors disabled:opacity-50"
                  >
                    {loading ? t('auth.reg.submitting') : t('auth.reg.submit')}
                  </button>
                </form>
              )}
            </div>

            {/* Right column: Instant 1-click free access */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
              <h2 className="text-lg font-bold text-[#17324d]">{t('auth.demo.title')}</h2>
              <p className="text-sm text-slate-500 mt-1">{t('auth.demo.sub')}</p>

              <div className="mt-4 space-y-2.5">
                {demoRoles.map((item) => (
                  <button
                    key={item.role}
                    type="button"
                    disabled={loading}
                    onClick={() => handleDemoAccess(item.role)}
                    className="w-full flex items-start gap-3 p-3.5 rounded-lg border border-slate-200 hover:border-[#2367a5] hover:bg-[#f7fafd] text-start transition-colors disabled:opacity-50"
                  >
                    <div className="p-2 rounded-lg bg-slate-100 shrink-0 mt-0.5">{item.icon}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-[#17324d]">{item.label}</div>
                      <div className="text-xs text-slate-500 mt-0.5 leading-snug">{item.desc}</div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-5 pt-4 border-t border-slate-200 space-y-3">
                <p className="text-xs text-slate-500 leading-relaxed">{t('auth.demo.footer')}</p>
                <button
                  type="button"
                  onClick={() => setSubscribeOpen(true)}
                  className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-[#2367a5] bg-[#eef4f8] hover:bg-[#dfeaf4] text-[#17324d] text-xs font-bold transition-colors"
                >
                  <Layers className="w-3.5 h-3.5 text-[#2367a5]" />
                  <span>{t('sub.auth_btn')}</span>
                </button>
              </div>
            </div>
          </div>
        </main>

      <footer className="bg-white border-t border-slate-200 px-5 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <span>{t('app.brand')} · {t('app.tagline')}</span>
        <div className="flex items-center gap-4">
          <a href="/offres" className="font-semibold text-[#2367a5] hover:underline">
            {t('sub.auth_btn')}
          </a>
          <span>v1.0</span>
        </div>
      </footer>

      <B2BSubscribeModal
        open={subscribeOpen}
        onClose={() => setSubscribeOpen(false)}
        defaultEmail={email || regEmail}
        isBlocked={Boolean(blockedMessage)}
        notify={notify}
      />
    </div>
  );
}
