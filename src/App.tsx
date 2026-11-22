import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Cloud, LogOut, Share2 } from 'lucide-react';
import type { LookupsData, PageId, PublicProfile } from './types.ts';
import { api, getStoredToken, setStoredToken } from './lib/api.ts';
import {
  auth,
  onAuthStateChanged,
  signInWithGoogleCloud,
  signOutGoogleCloud,
  type User,
} from './firebase.ts';
import {
  ensureBootHydrated,
  syncCurrentClientWorkspace,
  syncFromCloudAndHydrate,
} from './lib/persistence.ts';
import { LanguageSwitcher, useI18n } from './lib/i18n.tsx';
import { ToastStack, type ToastItem } from './components/UI.tsx';
import { AuthScreen } from './components/AuthScreen.tsx';
import { ShareModal } from './components/ShareModal.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { TripsView } from './components/TripsView.tsx';
import { TripDetailModal } from './components/TripDetailModal.tsx';
import {
  AlertsView,
  ClientsView,
  DocumentsView,
  DriversView,
  MaintenanceView,
  VehiclesView,
} from './components/CrudViews.tsx';
import { EmployeesView, ExpensesView, PayrollView } from './components/FinanceViews.tsx';
import { InvoicesView } from './components/InvoicesView.tsx';
import { GpsView } from './components/GpsView.tsx';
import { DriverMissionsView, DriverProposalView } from './components/DriverViews.tsx';
import {
  AuditLogsView,
  CitiesAdminView,
  CompanySettingsView,
  ProposalsValidationView,
  UsersAdminView,
} from './components/AdminViews.tsx';
import { VendorPortal } from './components/VendorPortal.tsx';
import { B2BLandingView } from './components/B2BLandingView.tsx';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallPrompt.tsx';

export default function App() {
  const { t, pageHeader, roleLabel, tripStatusLabel, isRtl } = useI18n();
  const [booting, setBooting] = useState(true);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [lookups, setLookups] = useState<LookupsData>({
    vehicles: [],
    drivers: [],
    clients: [],
    trips: [],
    cities: [],
    countries: [],
  });
  const [page, setPage] = useState<PageId>('dashboard');
  const [tripStatusFilter, setTripStatusFilter] = useState<string | null>(null);
  const [detailTripId, setDetailTripId] = useState<string | null>(null);
  const [invoicePresetTripId, setInvoicePresetTripId] = useState<string | null>(null);
  const [expensePresetTripId, setExpensePresetTripId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [cloudUser, setCloudUser] = useState<User | null>(() => auth.currentUser);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [portalMode, setPortalMode] = useState<'client' | 'vendor' | 'offers'>(() => {
    if (typeof window === 'undefined') return 'client';
    const params = new URLSearchParams(window.location.search);
    const p = window.location.pathname;
    if (params.get('portal') === 'vendor' || p === '/vendor' || p.startsWith('/vendor/')) {
      return 'vendor';
    }
    if (
      params.get('portal') === 'offres' ||
      params.get('portal') === 'pro' ||
      p === '/offres' ||
      p.startsWith('/offres/') ||
      p === '/pro' ||
      p.startsWith('/pro/') ||
      p === '/abonnement' ||
      p.startsWith('/abonnement/') ||
      p === '/commercial' ||
      p.startsWith('/commercial/')
    ) {
      return 'offers';
    }
    return 'client';
  });

  const [authInitialTab, setAuthInitialTab] = useState<'login' | 'register' | undefined>(() => {
    if (typeof window === 'undefined') return undefined;
    const mode = new URLSearchParams(window.location.search).get('mode');
    if (mode === 'register' || mode === 'login') return mode;
    return undefined;
  });
  const [offersDemoLoading, setOffersDemoLoading] = useState(false);

  const initialWorkspaceCode = useMemo(() => {
    if (typeof window === 'undefined') return undefined;
    const params = new URLSearchParams(window.location.search);
    return params.get('workspace')?.trim().toUpperCase() || undefined;
  }, []);

  const closeVendorPortal = useCallback(() => {
    setPortalMode('client');
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('portal');
      if (url.pathname === '/vendor' || url.pathname.startsWith('/vendor/') || url.pathname === '/') {
        url.pathname = '/erp';
      }
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const isVendor = portalMode === 'vendor';
    const isOffers = portalMode === 'offers';
    document.title = isVendor
      ? 'FRET MANAGER — Gestion Compte Client Abonnés'
      : isOffers
        ? 'FRET MANAGER — Offres & Abonnements Transport B2B'
        : 'FRET MANAGER — Gestion des Transports, Flotte & Facturation';
    const setAttr = (selector: string, attr: string, value: string) => {
      const el = document.querySelector(selector);
      if (el) el.setAttribute(attr, value);
    };
    setAttr('link[rel="manifest"]', 'href', isVendor ? '/vendor.webmanifest' : '/manifest.webmanifest');
    setAttr('meta[name="theme-color"]', 'content', isVendor ? '#0f2438' : '#17324d');
    setAttr('meta[name="apple-mobile-web-app-title"]', 'content', isVendor ? 'FretÉditeur' : 'FretManager');
    setAttr(
      'link[rel="apple-touch-icon"]',
      'href',
      isVendor ? '/vendor-apple-touch-icon.png' : '/apple-touch-icon.png',
    );
    setAttr('link[rel="icon"]', 'href', isVendor ? '/vendor-icon.svg' : '/icon.svg');
  }, [portalMode]);

  const notify = useCallback((message: string, type: ToastItem['type'] = 'info') => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const refreshLookups = useCallback(async () => {
    try {
      const data = await api<LookupsData>('/api/lookups');
      setLookups(data);
    } catch {
      // ignore on logout
    }
  }, []);

  const enterWorkspace = useCallback(
    async (prof: PublicProfile) => {
      setBlockedMessage(null);
      setProfile(prof);
      setPage(prof.role === 'conducteur' ? 'driver' : 'dashboard');
      await refreshLookups();
      void syncCurrentClientWorkspace(auth.currentUser);
    },
    [refreshLookups],
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      setCloudUser(fbUser);
    });
    return () => unsub();
  }, []);

  async function handleCloudConnect() {
    setCloudSyncing(true);
    try {
      const user = await signInWithGoogleCloud();
      setCloudUser(user);
      await syncFromCloudAndHydrate(user);
      await syncCurrentClientWorkspace(user);
      if (getStoredToken()) {
        await refreshLookups();
      }
      notify(`Sauvegarde Cloud active (${user.email || 'Google'}).`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (!msg.includes('popup-closed-by-user')) {
        notify('Connexion Cloud Google annulée ou indisponible.', 'error');
      }
    } finally {
      setCloudSyncing(false);
    }
  }

  async function handleCloudDisconnect() {
    await signOutGoogleCloud().catch(() => {});
    setCloudUser(null);
    notify('Synchronisation Cloud Google déconnectée.', 'info');
  }

  useEffect(() => {
    const onBlocked = (ev: Event) => {
      const custom = ev as CustomEvent<string>;
      const msg =
        custom.detail ||
        'Accès bloqué : période d’essai expirée ou espace suspendu.';
      setStoredToken(null);
      setProfile(null);
      setDetailTripId(null);
      setBlockedMessage(msg);
      notify(msg, 'error');
    };
    window.addEventListener('fret:workspace-blocked', onBlocked);
    return () => window.removeEventListener('fret:workspace-blocked', onBlocked);
  }, [notify]);

  useEffect(() => {
    let active = true;
    const safetyTimer = window.setTimeout(() => {
      if (active) setBooting(false);
    }, 6000);
    const onCloudHydrated = () => {
      if (active && getStoredToken()) {
        void refreshLookups();
      }
    };
    window.addEventListener('fret:cloud-hydrated', onCloudHydrated);

    (async () => {
      try {
        await ensureBootHydrated();
        if (!active) return;
        const token = getStoredToken();
        if (!token) {
          return;
        }
        const res = await api<{ profile: PublicProfile }>('/api/auth/me');
        if (active) await enterWorkspace(res.profile);
      } catch (err) {
        setStoredToken(null);
        if (active && err instanceof Error && err.message) {
          setBlockedMessage((prev) =>
            prev ||
            (err.message.includes('bloqué') || err.message.includes('expiré')
              ? err.message
              : null),
          );
        }
      } finally {
        window.clearTimeout(safetyTimer);
        if (active) setBooting(false);
      }
    })();
    return () => {
      active = false;
      window.clearTimeout(safetyTimer);
      window.removeEventListener('fret:cloud-hydrated', onCloudHydrated);
    };
  }, [enterWorkspace, refreshLookups]);

  function handleLogout() {
    void syncCurrentClientWorkspace(auth.currentUser);
    setStoredToken(null);
    setProfile(null);
    setBlockedMessage(null);
    setPage('dashboard');
    setDetailTripId(null);
  }

  const navItems = useMemo(() => {
    if (!profile) return [];
    const can = (roles: PublicProfile['role'][]) => roles.includes(profile.role);
    const list: Array<[PageId, string]> = [];

    if (profile.role !== 'conducteur') list.push(['dashboard', t('nav.dashboard')]);
    if (can(['admin', 'logistique', 'comptable'])) list.push(['trips', t('nav.trips')]);
    if (can(['admin', 'logistique', 'comptable'])) {
      list.push(['vehicles', t('nav.vehicles')], ['drivers', t('nav.drivers')], ['clients', t('nav.clients')]);
    }
    if (can(['admin', 'comptable'])) {
      list.push(['employees', t('nav.employees')], ['payroll', t('nav.payroll')], ['expenses', t('nav.expenses')]);
    }
    if (can(['admin', 'logistique', 'comptable'])) {
      list.push(['maintenance', t('nav.maintenance')], ['documents', t('nav.documents')]);
    }
    if (profile.role === 'conducteur') {
      list.push(['driver', t('nav.driver')], ['proposal', t('nav.proposal')]);
    }
    if (can(['admin', 'comptable'])) list.push(['invoices', t('nav.invoices')]);
    if (can(['admin', 'logistique'])) list.push(['gps', t('nav.gps')]);
    if (profile.role === 'admin') {
      list.push(
        ['proposals', t('nav.proposals')],
        ['users', t('nav.users')],
        ['audit', t('nav.audit')],
        ['company', t('nav.company')],
        ['cities', t('nav.cities')],
      );
    }
    return list;
  }, [profile, t]);

  const allowedPages = useMemo(() => {
    const set = new Set<PageId>(navItems.map(([id]) => id));
    if (profile && ['admin', 'logistique', 'comptable'].includes(profile.role)) {
      set.add('alerts');
    }
    return set;
  }, [navItems, profile]);

  const activePage: PageId = useMemo(() => {
    if (!profile) return page;
    if (allowedPages.has(page)) return page;
    return profile.role === 'conducteur' ? 'driver' : 'dashboard';
  }, [allowedPages, page, profile]);

  const openAuthFromOffers = useCallback((mode: 'login' | 'register' = 'login') => {
    setAuthInitialTab(mode);
    setPortalMode('client');
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', `/erp?mode=${mode}`);
    }
  }, []);

  const startDemoFromOffers = useCallback(async () => {
    setOffersDemoLoading(true);
    try {
      const res = await api<{ token: string; profile: PublicProfile }>('/api/auth/demo', {
        method: 'POST',
        body: JSON.stringify({ role: 'admin' }),
      });
      setStoredToken(res.token);
      setBooting(false);
      setPortalMode('client');
      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', '/erp');
      }
      await enterWorkspace(res.profile);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Accès démo indisponible.', 'error');
    } finally {
      setOffersDemoLoading(false);
    }
  }, [enterWorkspace, notify]);

  if (portalMode === 'vendor') {
    return (
      <>
        <VendorPortal onBackToErp={closeVendorPortal} notify={notify} />
        <OfflineIndicator />
        <ToastStack toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((x) => x.id !== id))} />
      </>
    );
  }

  if (portalMode === 'offers') {
    return (
      <>
        <B2BLandingView
          onOpenAuth={openAuthFromOffers}
          onStartDemo={startDemoFromOffers}
          demoLoading={offersDemoLoading}
          notify={notify}
        />
        <OfflineIndicator />
        <ToastStack toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((x) => x.id !== id))} />
      </>
    );
  }

  if (booting) {
    return (
      <div className="min-h-screen bg-[#f3f6f9] flex items-center justify-center text-sm text-slate-500">
        {t('app.loading')}
      </div>
    );
  }

  if (!profile) {
    return (
      <>
        <AuthScreen
          initialWorkspaceCode={initialWorkspaceCode}
          initialTab={authInitialTab}
          blockedMessage={blockedMessage}
          onSuccess={enterWorkspace}
          notify={notify}
        />
        <OfflineIndicator />
        <ToastStack toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((x) => x.id !== id))} />
      </>
    );
  }

  const [headerTitle, headerSubtitle] = pageHeader(activePage);

  return (
    <div className="min-h-screen bg-[#f3f6f9] flex flex-col">
      {/* Top Bar */}
      <header className="bg-[#17324d] text-white px-5 py-3 flex items-center justify-between gap-4 no-print">
        <div className="flex items-center gap-4 min-w-0">
          <span className="text-lg font-extrabold tracking-tight whitespace-nowrap shrink-0">
            {t('app.brand')}
          </span>
          <span className="hidden md:inline text-xs text-slate-300 truncate">
            {profile.workspace_name}
          </span>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <PWAInstallButton variant="dark" />
          <LanguageSwitcher variant="dark" />

          {cloudUser?.emailVerified ? (
            <button
              type="button"
              onClick={handleCloudDisconnect}
              title={cloudUser.email || 'Cloud Google connecté'}
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-100 text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>Cloud</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={cloudSyncing}
              onClick={handleCloudConnect}
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors whitespace-nowrap disabled:opacity-50"
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>{cloudSyncing ? 'Sync…' : 'Sauvegarde Cloud'}</span>
            </button>
          )}

          {profile.role === 'admin' && (
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2367a5] hover:bg-[#2c77bc] text-white text-xs font-bold transition-colors whitespace-nowrap"
            >
              <Share2 className="w-3.5 h-3.5" />
              {t('app.share')}
            </button>
          )}

          <span className="hidden sm:inline text-xs text-slate-200 whitespace-nowrap">
            {profile.full_name} · {roleLabel(profile.role)}
          </span>

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            {t('app.logout')}
          </button>
        </div>
      </header>

      {/* Workspace Layout */}
      <div className="flex-1 flex flex-col md:grid md:grid-cols-[240px_minmax(0,1fr)]">
        <aside
          className={`bg-white border-b md:border-b-0 ${
            isRtl ? 'md:border-l' : 'md:border-r'
          } border-slate-200 p-2.5 flex md:flex-col gap-1 overflow-x-auto no-print`}
        >
          {navItems.map(([id, label]) => {
            const active = activePage === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  if (id !== 'trips') setTripStatusFilter(null);
                  setPage(id);
                }}
                className={`px-3 py-2 rounded-lg text-start text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[#eaf2fb] text-[#2367a5] font-bold'
                    : 'text-[#34465d] hover:bg-slate-100'
                }`}
              >
                {label}
              </button>
            );
          })}
        </aside>

        <main className="p-4 sm:p-6 min-w-0">
          <div className="mb-5 no-print">
            <h1 className="text-2xl font-extrabold text-[#17324d] tracking-tight">{headerTitle}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {activePage === 'trips' && tripStatusFilter
                ? `${tripStatusLabel(tripStatusFilter)} · ${headerSubtitle}`
                : headerSubtitle}
            </p>
          </div>

          {activePage === 'dashboard' && (
            <DashboardView
              profile={profile}
              onNavigate={(p) => {
                setTripStatusFilter(null);
                setPage(p);
              }}
              onOpenTripFilter={(st) => {
                setTripStatusFilter(st);
                setPage('trips');
              }}
              onOpenShare={() => setShareOpen(true)}
              notify={notify}
            />
          )}

          {activePage === 'trips' && (
            <TripsView
              profile={profile}
              lookups={lookups}
              statusFilter={tripStatusFilter}
              onClearFilter={() => setTripStatusFilter(null)}
              onRefreshLookups={refreshLookups}
              onOpenDetail={(id) => setDetailTripId(id)}
              notify={notify}
            />
          )}

          {activePage === 'alerts' && (
            <AlertsView
              onOpenTripDetail={(id) => setDetailTripId(id)}
              onNavigate={(p) => {
                setTripStatusFilter(null);
                setPage(p);
              }}
              notify={notify}
            />
          )}

          {activePage === 'vehicles' && (
            <VehiclesView profile={profile} onRefreshLookups={refreshLookups} notify={notify} />
          )}

          {activePage === 'drivers' && (
            <DriversView profile={profile} onRefreshLookups={refreshLookups} notify={notify} />
          )}

          {activePage === 'clients' && (
            <ClientsView profile={profile} onRefreshLookups={refreshLookups} notify={notify} />
          )}

          {activePage === 'maintenance' && (
            <MaintenanceView profile={profile} lookups={lookups} notify={notify} />
          )}

          {activePage === 'documents' && (
            <DocumentsView profile={profile} lookups={lookups} notify={notify} />
          )}

          {activePage === 'employees' && <EmployeesView lookups={lookups} notify={notify} />}

          {activePage === 'payroll' && <PayrollView lookups={lookups} notify={notify} />}

          {activePage === 'expenses' && (
            <ExpensesView
              lookups={lookups}
              presetTripId={expensePresetTripId}
              onClearPreset={() => setExpensePresetTripId(null)}
              notify={notify}
            />
          )}

          {activePage === 'invoices' && (
            <InvoicesView
              profile={profile}
              presetTripId={invoicePresetTripId}
              onClearPreset={() => setInvoicePresetTripId(null)}
              notify={notify}
            />
          )}

          {activePage === 'gps' && <GpsView profile={profile} lookups={lookups} notify={notify} />}

          {activePage === 'driver' && (
            <DriverMissionsView
              profile={profile}
              lookups={lookups}
              onRefreshLookups={refreshLookups}
              onOpenDetail={(id) => setDetailTripId(id)}
              notify={notify}
            />
          )}

          {activePage === 'proposal' && <DriverProposalView profile={profile} notify={notify} />}

          {activePage === 'proposals' && (
            <ProposalsValidationView
              lookups={lookups}
              onRefreshLookups={refreshLookups}
              notify={notify}
            />
          )}

          {activePage === 'users' && (
            <UsersAdminView lookups={lookups} onRefreshLookups={refreshLookups} notify={notify} />
          )}

          {activePage === 'audit' && <AuditLogsView notify={notify} />}

          {activePage === 'company' && <CompanySettingsView notify={notify} />}

          {activePage === 'cities' && (
            <CitiesAdminView onRefreshLookups={refreshLookups} notify={notify} />
          )}
        </main>
      </div>

      {/* Mission Detail Modal */}
      <TripDetailModal
        tripId={detailTripId}
        profile={profile}
        lookups={lookups}
        onClose={() => setDetailTripId(null)}
        onCreateInvoice={(tripId) => {
          setInvoicePresetTripId(tripId);
          setPage('invoices');
        }}
        onAddExpense={(tripId) => {
          setExpensePresetTripId(tripId);
          setPage('expenses');
        }}
        notify={notify}
      />

      {/* Share Workspace Modal */}
      {profile.role === 'admin' && (
        <ShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          profile={profile}
          notify={notify}
        />
      )}

      {/* Offline Status Banner */}
      <OfflineIndicator />

      {/* Global Toast Notifications */}
      <ToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((x) => x.id !== id))}
      />
    </div>
  );
}
