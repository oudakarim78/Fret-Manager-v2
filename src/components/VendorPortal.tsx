import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  Calculator,
  Check,
  Cloud,
  Copy,
  FileText,
  KeyRound,
  Layers,
  Lock,
  LogIn,
  LogOut,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Unlock,
  Users,
} from 'lucide-react';
import type {
  B2BDeploymentRequest,
  B2BLicense,
  B2BPackCatalogItem,
  B2BPackId,
  Currency,
  VendorAccountPublic,
  VendorBillingDoc,
  VendorPortfolioMetrics,
  VendorProfile,
  VendorSettings,
  VendorWorkspaceSummary,
} from '../types.ts';
import { getVendorToken, setVendorToken, vendorApi } from '../lib/api.ts';
import {
  auth,
  onAuthStateChanged,
  signInWithGoogleCloud,
  signOutGoogleCloud,
  type User,
} from '../firebase.ts';
import {
  ensureBootHydrated,
  syncFromCloudAndHydrate,
  syncVendorPortfolio,
} from '../lib/persistence.ts';
import { dateText, money } from '../lib/format.ts';
import { LanguageSwitcher, useI18n } from '../lib/i18n.tsx';
import { ConfirmDialog, InfoBanner, Modal, StatusText, type ConfirmState } from './UI.tsx';
import { SaasEconomicsView } from './SaasEconomicsView.tsx';
import { PWAInstallButton } from './PWAInstallPrompt.tsx';
import { SubscriptionOffers } from './SubscriptionOffers.tsx';
import { VendorSettingsTab } from './VendorSettingsTab.tsx';

type VendorTab = 'accounts' | 'requests' | 'catalog' | 'economics' | 'settings';
type AccountFilter = 'all' | 'trials' | 'paid' | 'renewals' | 'other';

interface VendorOverviewResponse {
  packs: B2BPackCatalogItem[];
  requests: B2BDeploymentRequest[];
  workspaces: VendorWorkspaceSummary[];
  metrics: VendorPortfolioMetrics;
  vendor_settings?: VendorSettings;
  vendor_billing_docs?: VendorBillingDoc[];
  vendor_accounts?: VendorAccountPublic[];
}

const DEFAULT_VENDOR_SETTINGS: VendorSettings = {
  company_name: 'FRET MANAGER B2B',
  legal_form: 'SARL',
  activity: 'Édition logicielle & Solutions Transport / Logistique',
  ice: '',
  if_number: '',
  rc: '',
  patente: '',
  bank: '',
  rib: '',
  address: '',
  city: 'Casablanca',
  phone: '',
  email: 'editeur@fretmanager.ma',
  website: '',
  logo_url: '',
  quote_prefix: 'DEV-B2B',
  invoice_prefix: 'FAC-B2B',
  default_tax_rate: 20,
  payment_terms: 'Validité du devis : 30 jours. Règlement par virement bancaire à la commande.',
  updated_at: '',
};

export function VendorPortal({
  onBackToErp,
  notify,
}: {
  onBackToErp: () => void;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t, isRtl, licenseStatusLabel, requestStatusLabel, packNameById, checklistLabel } = useI18n();

  const [booting, setBooting] = useState(true);
  const [vendor, setVendor] = useState<VendorProfile | null>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showPublicOffers, setShowPublicOffers] = useState(false);
  const [cloudUser, setCloudUser] = useState<User | null>(() => auth.currentUser);
  const [cloudSyncing, setCloudSyncing] = useState(false);

  const [tab, setTab] = useState<VendorTab>('accounts');
  const [filter, setFilter] = useState<AccountFilter>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const [packs, setPacks] = useState<B2BPackCatalogItem[]>([]);
  const [requests, setRequests] = useState<B2BDeploymentRequest[]>([]);
  const [workspaces, setWorkspaces] = useState<VendorWorkspaceSummary[]>([]);
  const [metrics, setMetrics] = useState<VendorPortfolioMetrics | null>(null);
  const [vendorSettings, setVendorSettings] = useState<VendorSettings>(DEFAULT_VENDOR_SETTINGS);
  const [vendorBillingDocs, setVendorBillingDocs] = useState<VendorBillingDoc[]>([]);
  const [vendorAccounts, setVendorAccounts] = useState<VendorAccountPublic[]>([]);
  const [settingsDraftRequest, setSettingsDraftRequest] = useState<B2BDeploymentRequest | null>(null);
  const [catalogCurrency, setCatalogCurrency] = useState<Currency>('MAD');

  const [renewingId, setRenewingId] = useState<string | null>(null);
  const [blockingId, setBlockingId] = useState<string | null>(null);
  const [provisioningId, setProvisioningId] = useState<string | null>(null);
  const [provisionResult, setProvisionResult] = useState<{
    workspace_code: string;
    workspace_name: string;
    admin_email: string;
    temp_password: string;
  } | null>(null);

  const [editingWs, setEditingWs] = useState<VendorWorkspaceSummary | null>(null);
  const [editForm, setEditForm] = useState<B2BLicense | null>(null);
  const [activatingRequestId, setActivatingRequestId] = useState<string | null>(null);
  const [savingLicense, setSavingLicense] = useState(false);

  const [quoteRequest, setQuoteRequest] = useState<B2BDeploymentRequest | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const loadOverview = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await vendorApi<VendorOverviewResponse>('/api/vendor/overview');
        setPacks(res.packs);
        setRequests(res.requests);
        setWorkspaces(res.workspaces);
        setMetrics(res.metrics);
        if (res.vendor_settings) setVendorSettings(res.vendor_settings);
        if (res.vendor_billing_docs) setVendorBillingDocs(res.vendor_billing_docs);
        if (res.vendor_accounts) setVendorAccounts(res.vendor_accounts);
      } catch (err) {
        if (!silent) {
          notify(err instanceof Error ? err.message : t('common.loading'), 'error');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [notify, t],
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      setCloudUser(fbUser);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let active = true;
    const safetyTimer = window.setTimeout(() => {
      if (active) setBooting(false);
    }, 6000);
    const onCloudHydrated = () => {
      if (active && getVendorToken()) {
        void loadOverview(true);
      }
    };
    window.addEventListener('fret:cloud-hydrated', onCloudHydrated);

    (async () => {
      try {
        await ensureBootHydrated();
        if (!active) return;
        const token = getVendorToken();
        if (!token) {
          return;
        }
        const res = await vendorApi<{ vendor: VendorProfile }>('/api/vendor/me');
        if (!active) return;
        setVendor(res.vendor);
        await loadOverview();
        void syncVendorPortfolio(auth.currentUser);
      } catch {
        setVendorToken(null);
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
  }, [loadOverview]);

  useEffect(() => {
    if (!vendor) return;
    const onFocus = () => {
      void loadOverview(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadOverview(true);
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadOverview(true);
      }
    }, 15000);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [vendor, loadOverview]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      await ensureBootHydrated();
      const res = await vendorApi<{ token: string; vendor: VendorProfile }>('/api/vendor/login', {
        method: 'POST',
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPass }),
      });
      setVendorToken(res.token);
      setVendor(res.vendor);
      await loadOverview();
      await syncVendorPortfolio(auth.currentUser);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Erreur de connexion.');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleDemoVendor() {
    setAuthError(null);
    setAuthLoading(true);
    try {
      await ensureBootHydrated();
      const res = await vendorApi<{ token: string; vendor: VendorProfile }>('/api/vendor/demo', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setVendorToken(res.token);
      setVendor(res.vendor);
      await loadOverview();
      await syncVendorPortfolio(auth.currentUser);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Accès indisponible.');
    } finally {
      setAuthLoading(false);
    }
  }

  function handleLogout() {
    void syncVendorPortfolio(auth.currentUser);
    setVendorToken(null);
    setVendor(null);
    setWorkspaces([]);
    setRequests([]);
    setMetrics(null);
  }

  async function handleVendorCloudConnect() {
    setCloudSyncing(true);
    try {
      const user = await signInWithGoogleCloud();
      setCloudUser(user);
      await syncFromCloudAndHydrate(user);
      if (getVendorToken()) {
        await syncVendorPortfolio(user);
        await loadOverview(true);
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

  async function handleVendorCloudDisconnect() {
    await signOutGoogleCloud().catch(() => {});
    setCloudUser(null);
    notify('Synchronisation Cloud Google déconnectée.', 'info');
  }

  async function handleRenewOneYear(ws: VendorWorkspaceSummary) {
    setRenewingId(ws.id);
    try {
      await vendorApi<VendorWorkspaceSummary>(`/api/vendor/workspaces/${ws.id}/renew`, {
        method: 'POST',
        body: JSON.stringify({ years: 1 }),
      });
      notify(t('vendor.renew_ok', { name: ws.name }), 'success');
      await loadOverview();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Renouvellement impossible.', 'error');
    } finally {
      setRenewingId(null);
    }
  }

  async function handleToggleBlock(ws: VendorWorkspaceSummary) {
    setBlockingId(ws.id);
    try {
      const currentlySuspended = ws.b2b_license.status === 'suspendu';
      const isFreeTrialAccount =
        ws.b2b_license.pack === 'demo_gratuit' ||
        (ws.b2b_license.setup_fee === 0 && ws.b2b_license.annual_fee === 0);
      const nextStatus: B2BLicense['status'] = currentlySuspended
        ? isFreeTrialAccount
          ? 'essai_gratuit'
          : 'actif'
        : 'suspendu';

      let nextValidUntil = ws.b2b_license.valid_until;
      if (currentlySuspended && ws.days_remaining < 0) {
        const d = new Date();
        d.setDate(d.getDate() + (nextStatus === 'essai_gratuit' ? 14 : 365));
        nextValidUntil = d.toISOString().slice(0, 10);
      }

      await vendorApi(`/api/vendor/workspaces/${ws.id}/license`, {
        method: 'PUT',
        body: JSON.stringify({
          status: nextStatus,
          valid_until: nextValidUntil,
        }),
      });
      notify(
        t(currentlySuspended ? 'vendor.unblocked_ok' : 'vendor.blocked_ok', { name: ws.name }),
        currentlySuspended ? 'success' : 'info',
      );
      await loadOverview();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Action impossible.', 'error');
    } finally {
      setBlockingId(null);
    }
  }

  function openLicenseEditor(
    ws: VendorWorkspaceSummary,
    forceActivatePack?: B2BPackId,
    preferredCurrency?: Currency,
    linkedRequestId?: string,
  ) {
    setEditingWs(ws);
    setActivatingRequestId(linkedRequestId || null);
    const lic = {
      ...ws.b2b_license,
      onboarding_checklist: [...ws.b2b_license.onboarding_checklist],
    };
    if (preferredCurrency) {
      lic.currency = preferredCurrency;
    }
    if (forceActivatePack) {
      const cat = packs.find((p) => p.id === forceActivatePack);
      lic.pack = forceActivatePack;
      lic.status = 'actif';
      if (cat) {
        lic.setup_fee = lic.currency === 'EUR' ? cat.setup_fee_eur : cat.setup_fee_mad;
        lic.annual_fee = lic.currency === 'EUR' ? cat.annual_fee_eur : cat.annual_fee_mad;
        lic.max_vehicles = cat.max_vehicles;
        lic.max_users = cat.max_users;
        lic.gps_enabled = cat.gps_enabled;
      }
      const nextYr = new Date();
      nextYr.setFullYear(nextYr.getFullYear() + 1);
      lic.valid_until = nextYr.toISOString().slice(0, 10);
    }
    setEditForm(lic);
  }

  function applyCatalogDefaultsToEdit(nextPack: B2BPackId, nextCurrency: Currency) {
    if (!editForm) return;
    const cat = packs.find((p) => p.id === nextPack);
    if (!cat) {
      setEditForm({ ...editForm, pack: nextPack, currency: nextCurrency });
      return;
    }
    setEditForm({
      ...editForm,
      pack: nextPack,
      currency: nextCurrency,
      setup_fee: nextCurrency === 'EUR' ? cat.setup_fee_eur : cat.setup_fee_mad,
      annual_fee: nextCurrency === 'EUR' ? cat.annual_fee_eur : cat.annual_fee_mad,
      max_vehicles: cat.max_vehicles,
      max_users: cat.max_users,
      gps_enabled: cat.gps_enabled,
    });
  }

  async function saveLicenseEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingWs || !editForm) return;
    setSavingLicense(true);
    try {
      await vendorApi(`/api/vendor/workspaces/${editingWs.id}/license`, {
        method: 'PUT',
        body: JSON.stringify(editForm),
      });
      if (activatingRequestId) {
        await vendorApi(`/api/vendor/requests/${activatingRequestId}/status`, {
          method: 'PUT',
          body: JSON.stringify({ status: 'convertie' }),
        }).catch(() => {});
      }
      notify(`${editingWs.name} · ${t('b2b.lic.save')}`, 'success');
      setEditingWs(null);
      setEditForm(null);
      setActivatingRequestId(null);
      await loadOverview();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur enregistrement.', 'error');
    } finally {
      setSavingLicense(false);
    }
  }

  async function updateRequestStatus(id: string, status: B2BDeploymentRequest['status']) {
    try {
      await vendorApi(`/api/vendor/requests/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
      await loadOverview();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Mise à jour impossible.', 'error');
    }
  }

  async function handleProvision(reqItem: B2BDeploymentRequest) {
    setProvisioningId(reqItem.id);
    try {
      const res = await vendorApi<{
        workspace_code: string;
        workspace_name: string;
        admin_email: string;
        temp_password: string;
      }>(`/api/vendor/requests/${reqItem.id}/provision`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setProvisionResult(res);
      notify(`${res.workspace_code} · ${res.workspace_name}`, 'success');
      await loadOverview();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Provisionnement impossible.', 'error');
    } finally {
      setProvisioningId(null);
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify(t('common.copied'), 'success');
    } catch {
      notify(t('common.copy_manual'), 'info');
    }
  }

  function askResetDemo() {
    setConfirmState({
      open: true,
      title: t('vendor.reset_demo_title'),
      message: t('vendor.reset_demo_msg'),
      confirmLabel: t('vendor.reset_demo_btn'),
      danger: false,
      onConfirm: async () => {
        try {
          await vendorApi('/api/vendor/reset-demo', { method: 'POST', body: JSON.stringify({}) });
          notify(t('vendor.reset_demo_ok'), 'success');
          await loadOverview();
        } catch (err) {
          notify(err instanceof Error ? err.message : 'Erreur réinitialisation.', 'error');
        }
      },
    });
  }

  function askPurgeDemo() {
    setConfirmState({
      open: true,
      title: t('vendor.purge_demo_title'),
      message: t('vendor.purge_demo_msg'),
      confirmLabel: t('vendor.purge_demo_btn'),
      danger: true,
      onConfirm: async () => {
        try {
          const res = await vendorApi<{ removed_workspaces: number; removed_requests: number }>(
            '/api/vendor/purge-demo',
            { method: 'POST', body: JSON.stringify({}) },
          );
          notify(
            t('vendor.purge_demo_ok', {
              ws: res.removed_workspaces,
              req: res.removed_requests,
            }),
            'success',
          );
          await loadOverview();
        } catch (err) {
          notify(err instanceof Error ? err.message : 'Suppression impossible.', 'error');
        }
      },
    });
  }

  function askDeleteWorkspace(ws: VendorWorkspaceSummary) {
    setConfirmState({
      open: true,
      title: t('vendor.del_ws_title'),
      message: t('vendor.del_ws_msg', { name: ws.name, code: ws.code }),
      confirmLabel: t('common.delete'),
      danger: true,
      onConfirm: async () => {
        try {
          await vendorApi(`/api/vendor/workspaces/${ws.id}`, { method: 'DELETE' });
          notify(t('vendor.del_ws_ok', { name: ws.name }), 'success');
          await loadOverview();
        } catch (err) {
          notify(err instanceof Error ? err.message : 'Suppression impossible.', 'error');
        }
      },
    });
  }

  function askDeleteRequest(r: B2BDeploymentRequest) {
    setConfirmState({
      open: true,
      title: t('vendor.del_req_title'),
      message: t('vendor.del_req_msg', { name: r.company_name }),
      confirmLabel: t('common.delete'),
      danger: true,
      onConfirm: async () => {
        try {
          await vendorApi(`/api/vendor/requests/${r.id}`, { method: 'DELETE' });
          notify(t('vendor.del_req_ok'), 'success');
          await loadOverview();
        } catch (err) {
          notify(err instanceof Error ? err.message : 'Suppression impossible.', 'error');
        }
      },
    });
  }

  async function handleSavePack(packId: B2BPackId, patch: Partial<B2BPackCatalogItem>) {
    const res = await vendorApi<{ pack: B2BPackCatalogItem; packs: B2BPackCatalogItem[] }>(
      `/api/vendor/packs/${encodeURIComponent(packId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(patch),
      },
    );
    setPacks(res.packs);
  }

  async function handleCreatePack(draft: Omit<B2BPackCatalogItem, 'id'>) {
    const res = await vendorApi<{ pack: B2BPackCatalogItem; packs: B2BPackCatalogItem[] }>(
      '/api/vendor/packs',
      {
        method: 'POST',
        body: JSON.stringify(draft),
      },
    );
    setPacks(res.packs);
  }

  async function handleDeletePack(packId: B2BPackId) {
    const res = await vendorApi<{ ok: boolean; packs: B2BPackCatalogItem[] }>(
      `/api/vendor/packs/${encodeURIComponent(packId)}`,
      {
        method: 'DELETE',
      },
    );
    setPacks(res.packs);
  }

  async function handleResetPacks() {
    const res = await vendorApi<{ ok: boolean; packs: B2BPackCatalogItem[] }>(
      '/api/vendor/packs/reset',
      {
        method: 'POST',
        body: JSON.stringify({}),
      },
    );
    setPacks(res.packs);
  }

  const filterCounts = useMemo(() => {
    const trials = workspaces.filter((w) => w.b2b_license.status === 'essai_gratuit').length;
    const paid = workspaces.filter((w) => w.b2b_license.status === 'actif').length;
    const renewals = workspaces.filter(
      (w) =>
        w.b2b_license.status !== 'suspendu' &&
        (w.renewal_state === 'due_soon' || w.renewal_state === 'expired'),
    ).length;
    const other = workspaces.filter((w) =>
      ['en_attente_activation', 'suspendu'].includes(w.b2b_license.status),
    ).length;
    return { all: workspaces.length, trials, paid, renewals, other };
  }, [workspaces]);

  const livePaidCounts = useMemo(() => {
    const activePaid = workspaces.filter((w) => w.b2b_license.status === 'actif');
    return {
      essentiel: activePaid.filter((w) => w.b2b_license.pack === 'pack_essentiel').length,
      flotte: activePaid.filter((w) => w.b2b_license.pack === 'pack_flotte_gps').length,
      entreprise: activePaid.filter((w) => w.b2b_license.pack === 'pack_entreprise').length,
    };
  }, [workspaces]);

  const filteredWorkspaces = useMemo(() => {
    const q = search.trim().toLowerCase();
    return workspaces.filter((w) => {
      if (filter === 'trials' && w.b2b_license.status !== 'essai_gratuit') return false;
      if (filter === 'paid' && w.b2b_license.status !== 'actif') return false;
      if (
        filter === 'renewals' &&
        !(
          w.b2b_license.status !== 'suspendu' &&
          (w.renewal_state === 'due_soon' || w.renewal_state === 'expired')
        )
      ) {
        return false;
      }
      if (filter === 'other' && !['en_attente_activation', 'suspendu'].includes(w.b2b_license.status)) {
        return false;
      }
      if (!q) return true;
      return (
        w.name.toLowerCase().includes(q) ||
        w.code.toLowerCase().includes(q) ||
        w.admin_email.toLowerCase().includes(q) ||
        w.admin_name.toLowerCase().includes(q) ||
        (w.member_emails || []).some((em) => em.toLowerCase().includes(q)) ||
        (w.members || []).some((m) => m.full_name.toLowerCase().includes(q))
      );
    });
  }, [workspaces, filter, search]);

  if (booting) {
    return (
      <div className="min-h-screen bg-[#f3f6f9] flex items-center justify-center text-sm text-slate-500">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f3f6f9] flex flex-col">
      {/* Standalone Vendor Top Bar */}
      <header className="bg-[#0f2438] text-white px-5 sm:px-7 py-3.5 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 no-print">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-[#2367a5]">
            <ShieldCheck className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-extrabold tracking-tight truncate">{t('vendor.brand')}</div>
            <div className="text-[11px] text-slate-300 truncate hidden sm:block">{t('vendor.tagline')}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {cloudUser?.emailVerified ? (
            <button
              type="button"
              onClick={handleVendorCloudDisconnect}
              title={cloudUser.email || 'Cloud Google connecté'}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-100 text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>Cloud</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={cloudSyncing}
              onClick={handleVendorCloudConnect}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors whitespace-nowrap disabled:opacity-50"
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>{cloudSyncing ? 'Sync…' : 'Sauvegarde Cloud'}</span>
            </button>
          )}
          <PWAInstallButton variant="dark" appLabel="FretÉditeur" />
          <LanguageSwitcher variant="dark" />
          <a
            href="/erp"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors whitespace-nowrap"
          >
            <ArrowLeft className={`w-3.5 h-3.5 ${isRtl ? 'rotate-180' : ''}`} />
            {t('vendor.back_erp')}
          </a>
          {vendor && (
            <>
              <span className="hidden md:inline text-xs text-slate-300 whitespace-nowrap">
                {vendor.full_name}
              </span>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-100 text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5" />
                {t('app.logout')}
              </button>
            </>
          )}
        </div>
      </header>

      {/* Unauthenticated Vendor Gate or Public B2B Subscription Offers */}
      {!vendor ? (
        showPublicOffers ? (
          <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setShowPublicOffers(false)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-xs font-bold text-[#17324d] transition-colors"
              >
                <ArrowLeft className={`w-3.5 h-3.5 ${isRtl ? 'rotate-180' : ''}`} />
                {t('vendor.login.title')}
              </button>
            </div>
            <SubscriptionOffers
              currency={catalogCurrency}
              onCurrencyChange={setCatalogCurrency}
              notify={notify}
            />
          </main>
        ) : (
          <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
            <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 sm:p-7 shadow-sm space-y-5">
              <div>
                <h1 className="text-xl font-extrabold text-[#17324d]">{t('vendor.login.title')}</h1>
                <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{t('vendor.login.sub')}</p>
              </div>

              {authError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-900">
                  {authError}
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label htmlFor="vnd-email" className="block text-xs font-bold text-slate-700 mb-1.5">
                    {t('vendor.login.email')}
                  </label>
                  <input
                    id="vnd-email"
                    type="email"
                    required
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="editeur@fretmanager.ma"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                  />
                </div>

                <div>
                  <label htmlFor="vnd-pass" className="block text-xs font-bold text-slate-700 mb-1.5">
                    {t('vendor.login.password')}
                  </label>
                  <input
                    id="vnd-pass"
                    type="password"
                    required
                    value={loginPass}
                    onChange={(e) => setLoginPass(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  <LogIn className="w-4 h-4" />
                  {authLoading ? t('vendor.login.submitting') : t('vendor.login.submit')}
                </button>
              </form>

              <div className="pt-4 border-t border-slate-200 space-y-2.5">
                <button
                  type="button"
                  disabled={authLoading}
                  onClick={handleDemoVendor}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#17324d] hover:bg-[#1f4469] text-white text-xs font-bold transition-colors disabled:opacity-50"
                >
                  {t('vendor.login.demo_btn')}
                </button>
                <p className="text-[11px] text-slate-500 text-center font-mono">
                  {t('vendor.login.demo_hint')}
                </p>
                <button
                  type="button"
                  onClick={() => setShowPublicOffers(true)}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-lg border border-slate-300 bg-[#f8fafc] hover:bg-slate-100 text-[#17324d] text-xs font-bold transition-colors"
                >
                  <Layers className="w-3.5 h-3.5 text-[#2367a5]" />
                  {t('sub.auth_btn')}
                </button>
              </div>
            </div>
          </main>
        )
      ) : (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-5">
          {/* 4 Portfolio KPIs */}
          {metrics && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 no-print">
              <button
                type="button"
                onClick={() => {
                  setTab('accounts');
                  setFilter('trials');
                }}
                className="bg-white border border-slate-200 hover:border-[#2367a5] rounded-xl p-5 text-start transition-colors"
              >
                <div className="text-xs font-semibold text-slate-500">{t('vendor.kpi.trials')}</div>
                <div className="font-mono text-2xl font-extrabold text-[#2367a5] mt-1 tabular-nums">
                  {metrics.trials_count}
                </div>
                <div className="text-xs text-slate-500 mt-1">{t('vendor.kpi.trials_sub')}</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setTab('accounts');
                  setFilter('paid');
                }}
                className="bg-white border border-slate-200 hover:border-emerald-600 rounded-xl p-5 text-start transition-colors"
              >
                <div className="text-xs font-semibold text-slate-500">{t('vendor.kpi.paid')}</div>
                <div className="font-mono text-2xl font-extrabold text-emerald-700 mt-1 tabular-nums">
                  {metrics.active_paid_count}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {t('vendor.kpi.paid_sub', {
                    pending: metrics.pending_activation_count,
                    suspended: metrics.suspended_count,
                  })}
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setTab('accounts');
                  setFilter('renewals');
                }}
                className="bg-white border border-slate-200 hover:border-amber-600 rounded-xl p-5 text-start transition-colors"
              >
                <div className="text-xs font-semibold text-slate-500">{t('vendor.kpi.renewals')}</div>
                <div className="font-mono text-2xl font-extrabold text-amber-700 mt-1 tabular-nums">
                  {metrics.renewals_due_soon_count + metrics.expired_count}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {t('vendor.kpi.renewals_sub', {
                    soon: metrics.renewals_due_soon_count,
                    expired: metrics.expired_count,
                  })}
                </div>
              </button>

              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="text-xs font-semibold text-slate-500">{t('vendor.kpi.arr')}</div>
                <div className="font-mono text-lg font-extrabold text-[#17324d] mt-1 tabular-nums">
                  {money(metrics.arr_mad, 'MAD')}
                </div>
                <div className="font-mono text-sm font-bold text-[#2367a5] tabular-nums">
                  {money(metrics.arr_eur, 'EUR')}
                </div>
                <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                  {t('vendor.kpi.setup_sub')} {money(metrics.setup_mad, 'MAD')} · {money(metrics.setup_eur, 'EUR')}
                </div>
              </div>
            </div>
          )}

          {/* Top Navigation Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3 no-print">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setTab('accounts')}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
                  tab === 'accounts'
                    ? 'bg-[#17324d] text-white'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Building2 className="w-4 h-4" />
                {t('vendor.tab.accounts', { count: workspaces.length })}
              </button>
              <button
                type="button"
                onClick={() => setTab('requests')}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
                  tab === 'requests'
                    ? 'bg-[#17324d] text-white'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <FileText className="w-4 h-4" />
                {t('vendor.tab.requests', { count: requests.length })}
              </button>
              <button
                type="button"
                onClick={() => setTab('catalog')}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
                  tab === 'catalog'
                    ? 'bg-[#17324d] text-white'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Layers className="w-4 h-4" />
                {t('vendor.tab.catalog')}
              </button>
              <button
                type="button"
                onClick={() => setTab('economics')}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
                  tab === 'economics'
                    ? 'bg-[#17324d] text-white'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Calculator className="w-4 h-4" />
                {t('vendor.tab.economics')}
              </button>
              <button
                type="button"
                onClick={() => setTab('settings')}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
                  tab === 'settings'
                    ? 'bg-[#17324d] text-white'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Settings className="w-4 h-4" />
                {t('vendor.tab.settings')}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => copyText(`${window.location.origin}/pro`)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-bold text-emerald-900"
              >
                <Copy className="w-3.5 h-3.5" />
                Lien court (/pro)
              </button>
              <button
                type="button"
                onClick={askResetDemo}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-sky-200 bg-sky-50 hover:bg-sky-100 text-xs font-bold text-[#17324d]"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t('vendor.reset_demo_btn')}
              </button>
              <button
                type="button"
                onClick={askPurgeDemo}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-xs font-bold text-red-700"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t('vendor.purge_demo_btn')}
              </button>
              <button
                type="button"
                onClick={() => void loadOverview()}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                {t('gps.map.refresh')}
              </button>
            </div>
          </div>

          {loading && workspaces.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-sm text-slate-500">
              {t('common.loading')}
            </div>
          ) : tab === 'accounts' ? (
            <div className="space-y-4 no-print">
              {/* Filter Bar + Search */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5 bg-white border border-slate-200 p-1 rounded-lg w-fit">
                  {(
                    [
                      ['all', t('vendor.filter.all', { count: filterCounts.all })],
                      ['trials', t('vendor.filter.trials', { count: filterCounts.trials })],
                      ['paid', t('vendor.filter.paid', { count: filterCounts.paid })],
                      ['renewals', t('vendor.filter.renewals', { count: filterCounts.renewals })],
                      ['other', t('vendor.filter.other', { count: filterCounts.other })],
                    ] as Array<[AccountFilter, string]>
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setFilter(id)}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                        filter === id
                          ? 'bg-[#2367a5] text-white'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-[#17324d]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="relative w-full lg:w-80">
                  <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('vendor.search_ph')}
                    className="w-full ps-9 pe-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#2367a5]"
                  />
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[940px] text-start border-collapse text-sm">
                    <thead>
                      <tr className="bg-[#f8fafc] border-b border-slate-200 text-xs font-bold text-slate-600 uppercase">
                        <th className="px-4 py-3">{t('vendor.col.client')}</th>
                        <th className="px-4 py-3">{t('vendor.col.pack')}</th>
                        <th className="px-4 py-3">{t('vendor.col.finance')}</th>
                        <th className="px-4 py-3">{t('vendor.col.renewal')}</th>
                        <th className="px-4 py-3">{t('vendor.col.usage')}</th>
                        <th className="px-4 py-3 text-end">{t('common.actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredWorkspaces.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                            {t('vendor.empty_accounts')}
                          </td>
                        </tr>
                      ) : (
                        filteredWorkspaces.map((ws) => {
                          const licTone =
                            ws.b2b_license.status === 'actif'
                              ? 'green'
                              : ws.b2b_license.status === 'en_attente_activation'
                                ? 'amber'
                                : ws.b2b_license.status === 'suspendu'
                                  ? 'red'
                                  : 'blue';

                          const dueTone =
                            ws.renewal_state === 'expired'
                              ? 'red'
                              : ws.renewal_state === 'due_soon'
                                ? 'amber'
                                : ws.renewal_state === 'trial'
                                  ? 'blue'
                                  : 'green';

                          const dueBadgeLabel =
                            ws.days_remaining < 0
                              ? t('vendor.expired_days', { days: Math.abs(ws.days_remaining) })
                              : ws.days_remaining === 0
                                ? t('vendor.due_today')
                                : t('vendor.days_left', { days: ws.days_remaining });

                          const isTrial = ws.b2b_license.status === 'essai_gratuit';

                          return (
                            <tr key={ws.id} className="hover:bg-slate-50/70">
                              <td className="px-4 py-3.5 align-top">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 text-[#17324d]">
                                    {ws.code}
                                  </span>
                                  <span className="font-bold text-[#17324d]">{ws.name}</span>
                                </div>
                                <div className="text-xs text-slate-500 mt-1">
                                  {ws.admin_name || 'Admin'} · {ws.admin_email || '—'}
                                </div>
                                {ws.members && ws.members.length > 1 && (
                                  <div className="text-[11px] text-slate-500 mt-0.5">
                                    +{ws.members.length - 1} compte(s) :{' '}
                                    <span className="font-mono">
                                      {ws.members
                                        .filter((m) => m.email !== ws.admin_email)
                                        .slice(-2)
                                        .map((m) => m.email)
                                        .join(', ')}
                                    </span>
                                  </div>
                                )}
                                {ws.company_phone && (
                                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                                    {ws.company_phone}
                                  </div>
                                )}
                              </td>

                              <td className="px-4 py-3.5 align-top space-y-1">
                                <div className="font-semibold text-[#17324d] text-xs">
                                  {packNameById(
                                    ws.b2b_license.pack,
                                    packs.find((p) => p.id === ws.b2b_license.pack)?.name,
                                  )}
                                </div>
                                <div>
                                  <StatusText
                                    label={licenseStatusLabel(ws.b2b_license.status)}
                                    tone={licTone}
                                  />
                                </div>
                              </td>

                              <td className="px-4 py-3.5 align-top text-xs">
                                <div className="font-mono font-bold text-[#17324d] tabular-nums">
                                  Setup : {money(ws.b2b_license.setup_fee, ws.b2b_license.currency)}
                                </div>
                                <div className="font-mono text-slate-600 tabular-nums mt-0.5">
                                  {money(ws.b2b_license.annual_fee, ws.b2b_license.currency)} / an
                                </div>
                              </td>

                              <td className="px-4 py-3.5 align-top text-xs space-y-1">
                                <div className="font-mono font-semibold text-[#17324d]">
                                  {dateText(ws.b2b_license.valid_until)}
                                </div>
                                <div>
                                  <StatusText label={dueBadgeLabel} tone={dueTone} />
                                </div>
                              </td>

                              <td className="px-4 py-3.5 align-top text-xs font-mono text-slate-700 tabular-nums">
                                <div>
                                  {t('b2b.packs.vehicles')} : {ws.usage.vehicles} /{' '}
                                  {ws.b2b_license.max_vehicles >= 900 ? '∞' : ws.b2b_license.max_vehicles}
                                </div>
                                <div>
                                  {t('b2b.packs.accounts')} : {ws.usage.users} /{' '}
                                  {ws.b2b_license.max_users >= 900 ? '∞' : ws.b2b_license.max_users}
                                </div>
                                <div>
                                  {t('nav.trips')} : {ws.usage.trips} · {t('nav.invoices')} : {ws.usage.invoices}
                                </div>
                              </td>

                              <td className="px-4 py-3.5 align-top text-end whitespace-nowrap">
                                <div className="flex flex-wrap justify-end gap-1.5">
                                  {isTrial ? (
                                    <button
                                      type="button"
                                      onClick={() => openLicenseEditor(ws, 'pack_flotte_gps')}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                      {t('vendor.activate_btn')}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={renewingId === ws.id}
                                      onClick={() => handleRenewOneYear(ws)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold disabled:opacity-50"
                                    >
                                      <RefreshCw className="w-3.5 h-3.5" />
                                      {t('vendor.renew_btn')}
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => openLicenseEditor(ws)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white text-xs font-bold"
                                  >
                                    <Users className="w-3.5 h-3.5" />
                                    {t('b2b.console.edit_lic')}
                                  </button>

                                  <button
                                    type="button"
                                    disabled={blockingId === ws.id}
                                    onClick={() => handleToggleBlock(ws)}
                                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50 ${
                                      ws.b2b_license.status === 'suspendu'
                                        ? 'bg-amber-600 hover:bg-amber-700 text-white'
                                        : 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'
                                    }`}
                                  >
                                    {ws.b2b_license.status === 'suspendu' ? (
                                      <>
                                        <Unlock className="w-3.5 h-3.5" />
                                        {t('vendor.unblock_btn')}
                                      </>
                                    ) : (
                                      <>
                                        <Lock className="w-3.5 h-3.5" />
                                        {t('vendor.block_btn')}
                                      </>
                                    )}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      copyText(`${window.location.origin}/erp?workspace=${ws.code}`)
                                    }
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                    {t('share.copy_link')}
                                  </button>

                                  <button
                                    type="button"
                                    title={t('common.delete')}
                                    aria-label={`${t('common.delete')} ${ws.name}`}
                                    onClick={() => askDeleteWorkspace(ws)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 bg-white hover:bg-red-50 text-xs font-semibold text-red-700"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    {t('common.delete')}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : tab === 'requests' ? (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden no-print">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-start border-collapse text-sm">
                  <thead>
                    <tr className="bg-[#f8fafc] border-b border-slate-200 text-xs font-bold text-slate-600 uppercase">
                      <th className="px-4 py-3">{t('trips.col.client')}</th>
                      <th className="px-4 py-3">Pack</th>
                      <th className="px-4 py-3">{t('common.status')}</th>
                      <th className="px-4 py-3">Notes</th>
                      <th className="px-4 py-3 text-end">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {requests.map((r) => {
                      const reqTone =
                        r.status === 'convertie'
                          ? 'green'
                          : r.status === 'en_deploiement'
                            ? 'blue'
                            : r.status === 'contactee'
                              ? 'amber'
                              : r.status === 'archivee'
                                ? 'neutral'
                                : 'red';
                      return (
                        <tr key={r.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-3.5 align-top">
                            <div className="font-bold text-[#17324d]">{r.company_name}</div>
                            <div className="text-xs text-slate-600 mt-0.5">
                              {r.contact_name} · {r.phone}
                            </div>
                            <div className="text-xs text-slate-500">{r.email}</div>
                            <div className="text-[11px] text-slate-400 mt-1">{dateText(r.created_at)}</div>
                          </td>
                          <td className="px-4 py-3.5 align-top">
                            <div className="font-semibold text-[#17324d]">
                              {packNameById(r.pack, packs.find((p) => p.id === r.pack)?.name)}
                            </div>
                            <div className="text-xs text-slate-600 font-mono mt-0.5 tabular-nums">
                              {r.fleet_size} · {r.currency}
                            </div>
                            {r.provisioned_workspace_code && (
                              <div className="mt-1 text-xs font-mono font-bold text-emerald-700">
                                {r.provisioned_workspace_code}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3.5 align-top space-y-2">
                            <div>
                              <StatusText label={requestStatusLabel(r.status)} tone={reqTone} />
                            </div>
                            <select
                              aria-label={r.company_name}
                              value={r.status}
                              onChange={(e) =>
                                updateRequestStatus(
                                  r.id,
                                  e.target.value as B2BDeploymentRequest['status'],
                                )
                              }
                              className="block text-xs border border-slate-300 rounded-md px-2 py-1 bg-white"
                            >
                              <option value="nouvelle">{requestStatusLabel('nouvelle')}</option>
                              <option value="contactee">{requestStatusLabel('contactee')}</option>
                              <option value="en_deploiement">
                                {requestStatusLabel('en_deploiement')}
                              </option>
                              <option value="convertie">{requestStatusLabel('convertie')}</option>
                              <option value="archivee">{requestStatusLabel('archivee')}</option>
                            </select>
                          </td>
                          <td className="px-4 py-3.5 align-top max-w-xs text-xs text-slate-600">
                            {r.notes || '—'}
                          </td>
                          <td className="px-4 py-3.5 align-top text-end whitespace-nowrap">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setQuoteRequest(r)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-[#17324d]"
                              >
                                <Printer className="w-3.5 h-3.5" />
                                {t('b2b.console.quote_a4')}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSettingsDraftRequest(r);
                                  setTab('settings');
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-200 bg-sky-50 hover:bg-sky-100 text-xs font-semibold text-[#2367a5]"
                              >
                                <FileText className="w-3.5 h-3.5" />
                                Éditer devis / facture
                              </button>
                              {(() => {
                                const linkedWs = r.provisioned_workspace_code
                                  ? workspaces.find((w) => w.code === r.provisioned_workspace_code)
                                  : undefined;
                                if (linkedWs && r.status !== 'convertie') {
                                  return (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openLicenseEditor(linkedWs, r.pack, r.currency, r.id)
                                      }
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                      {t('vendor.activate_req_btn', { code: linkedWs.code })}
                                    </button>
                                  );
                                }
                                if (!r.provisioned_workspace_code) {
                                  return (
                                    <button
                                      type="button"
                                      disabled={provisioningId === r.id}
                                      onClick={() => handleProvision(r)}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white text-xs font-bold disabled:opacity-50"
                                    >
                                      <KeyRound className="w-3.5 h-3.5" />
                                      {provisioningId === r.id
                                        ? t('common.saving')
                                        : t('b2b.console.provision')}
                                    </button>
                                  );
                                }
                                return null;
                              })()}
                              <button
                                type="button"
                                title={t('common.delete')}
                                aria-label={`${t('common.delete')} ${r.company_name}`}
                                onClick={() => askDeleteRequest(r)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 bg-white hover:bg-red-50 text-xs font-semibold text-red-700"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : tab === 'catalog' ? (
            <SubscriptionOffers
              packs={packs}
              workspaces={workspaces}
              currency={catalogCurrency}
              onCurrencyChange={setCatalogCurrency}
              editable
              onSavePack={handleSavePack}
              onCreatePack={handleCreatePack}
              onDeletePack={handleDeletePack}
              onResetPacks={handleResetPacks}
              onApplyPlan={(packId, curr, targetWs) => {
                if (targetWs) {
                  openLicenseEditor(targetWs, packId, curr);
                }
              }}
              onSubscriptionCreated={() => {
                void loadOverview(true);
                setTab('requests');
              }}
              notify={notify}
            />
          ) : tab === 'economics' ? (
            <div className="no-print">
              <SaasEconomicsView packs={packs} livePortfolioCounts={livePaidCounts} />
            </div>
          ) : (
            <VendorSettingsTab
              vendor={vendor}
              onVendorUpdated={setVendor}
              settings={vendorSettings}
              onSettingsUpdated={setVendorSettings}
              accounts={vendorAccounts}
              onAccountsUpdated={setVendorAccounts}
              billingDocs={vendorBillingDocs}
              onBillingDocsUpdated={setVendorBillingDocs}
              workspaces={workspaces}
              requests={requests}
              packs={packs}
              initialDraftFromRequest={settingsDraftRequest}
              onClearInitialDraft={() => setSettingsDraftRequest(null)}
              notify={notify}
            />
          )}
        </main>
      )}

      {/* Provisioned Credentials Modal */}
      <Modal
        open={Boolean(provisionResult)}
        title={t('b2b.prov.title')}
        onClose={() => setProvisionResult(null)}
        maxWidth="max-w-lg"
      >
        {provisionResult && (
          <div className="space-y-4">
            <InfoBanner>{t('b2b.prov.banner')}</InfoBanner>

            <div className="bg-[#f8fafc] border border-slate-200 rounded-lg p-4 space-y-2 text-sm">
              <div>
                {t('b2b.prov.company')}{' '}
                <strong className="text-[#17324d]">{provisionResult.workspace_name}</strong>
              </div>
              <div>
                {t('b2b.prov.code')}{' '}
                <span className="font-mono font-extrabold text-[#2367a5]">
                  {provisionResult.workspace_code}
                </span>
              </div>
              <div>
                {t('b2b.prov.email')} <span className="font-mono">{provisionResult.admin_email}</span>
              </div>
              <div>
                {t('b2b.prov.pass')}{' '}
                <span className="font-mono font-bold text-[#17324d]">
                  {provisionResult.temp_password}
                </span>
              </div>
              <div className="text-xs text-slate-600 pt-1 break-all">
                {t('b2b.prov.link')}{' '}
                <span className="font-mono" dir="ltr">
                  {window.location.origin}/erp?workspace={provisionResult.workspace_code}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  copyText(
                    `FRET MANAGER\n${t('b2b.prov.company')} ${provisionResult.workspace_name}\n${t('b2b.prov.code')} ${provisionResult.workspace_code}\n${t('b2b.prov.link')} ${window.location.origin}/erp?workspace=${provisionResult.workspace_code}\n${t('b2b.prov.email')} ${provisionResult.admin_email}\n${t('b2b.prov.pass')} ${provisionResult.temp_password}`,
                  )
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white text-xs font-bold"
              >
                <Copy className="w-4 h-4" />
                {t('b2b.console.copy_kit')}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* License & Onboarding Editor Modal */}
      <Modal
        open={Boolean(editingWs && editForm)}
        title={t('b2b.lic.edit_title', { name: editingWs?.name || '' })}
        onClose={() => {
          setEditingWs(null);
          setEditForm(null);
        }}
        maxWidth="max-w-2xl"
      >
        {editingWs && editForm && (
          <form onSubmit={saveLicenseEdit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Pack</label>
                <select
                  value={editForm.pack}
                  onChange={(e) =>
                    applyCatalogDefaultsToEdit(e.target.value as B2BPackId, editForm.currency)
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="demo_gratuit">{packNameById('demo_gratuit')}</option>
                  {packs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {packNameById(p.id, p.name)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{t('b2b.lic.status')}</label>
                <select
                  value={editForm.status}
                  onChange={(e) =>
                    setEditForm({ ...editForm, status: e.target.value as B2BLicense['status'] })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="essai_gratuit">{licenseStatusLabel('essai_gratuit')}</option>
                  <option value="en_attente_activation">
                    {licenseStatusLabel('en_attente_activation')}
                  </option>
                  <option value="actif">{licenseStatusLabel('actif')}</option>
                  <option value="suspendu">{licenseStatusLabel('suspendu')}</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{t('b2b.lic.setup')}</label>
                <input
                  type="number"
                  value={editForm.setup_fee}
                  onChange={(e) => setEditForm({ ...editForm, setup_fee: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{t('b2b.lic.annual')}</label>
                <input
                  type="number"
                  value={editForm.annual_fee}
                  onChange={(e) => setEditForm({ ...editForm, annual_fee: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.currency')}</label>
                <select
                  value={editForm.currency}
                  onChange={(e) =>
                    applyCatalogDefaultsToEdit(editForm.pack, e.target.value as Currency)
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="MAD">MAD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{t('b2b.lic.due')}</label>
                <input
                  type="date"
                  value={editForm.valid_until}
                  onChange={(e) => setEditForm({ ...editForm, valid_until: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <div className="flex flex-wrap gap-1 mt-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() + 14);
                      setEditForm({ ...editForm, status: 'essai_gratuit', valid_until: d.toISOString().slice(0, 10) });
                    }}
                    className="px-2 py-0.5 rounded bg-sky-50 hover:bg-sky-100 text-sky-800 text-[10px] font-bold border border-sky-200"
                  >
                    {t('vendor.preset_14d')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() - 1);
                      setEditForm({ ...editForm, valid_until: d.toISOString().slice(0, 10) });
                    }}
                    className="px-2 py-0.5 rounded bg-red-50 hover:bg-red-100 text-red-700 text-[10px] font-bold border border-red-200"
                  >
                    {t('vendor.preset_expired')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setFullYear(d.getFullYear() + 1);
                      setEditForm({ ...editForm, status: 'actif', valid_until: d.toISOString().slice(0, 10) });
                    }}
                    className="px-2 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold border border-emerald-200"
                  >
                    {t('vendor.preset_1y')}
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{t('b2b.lic.q_veh')}</label>
                <input
                  type="number"
                  min={1}
                  value={editForm.max_vehicles}
                  onChange={(e) =>
                    setEditForm({ ...editForm, max_vehicles: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{t('b2b.lic.q_usr')}</label>
                <input
                  type="number"
                  min={1}
                  value={editForm.max_users}
                  onChange={(e) => setEditForm({ ...editForm, max_users: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold text-[#17324d] pt-5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.gps_enabled}
                  onChange={(e) => setEditForm({ ...editForm, gps_enabled: e.target.checked })}
                />
                {t('b2b.lic.gps_incl')}
              </label>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">{t('b2b.lic.chk')}</label>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {editForm.onboarding_checklist.map((item, idx) => (
                  <label
                    key={item.id}
                    className="flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 cursor-pointer hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={(e) => {
                        const next = [...editForm.onboarding_checklist];
                        next[idx] = { ...item, done: e.target.checked };
                        setEditForm({ ...editForm, onboarding_checklist: next });
                      }}
                    />
                    <span>{checklistLabel(item.id, item.label)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('b2b.lic.notes')}</label>
              <textarea
                rows={2}
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setEditingWs(null);
                  setEditForm(null);
                }}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={savingLicense}
                className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white disabled:opacity-50"
              >
                {savingLicense ? t('common.saving') : t('b2b.lic.save')}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Printable A4 B2B Turnkey Quote Modal */}
      {quoteRequest && (
        <VendorQuotePrintModal
          request={quoteRequest}
          packCatalog={packs}
          vendorSettings={vendorSettings}
          onClose={() => setQuoteRequest(null)}
        />
      )}

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}

function VendorQuotePrintModal({
  request,
  packCatalog,
  vendorSettings,
  onClose,
}: {
  request: B2BDeploymentRequest;
  packCatalog: B2BPackCatalogItem[];
  vendorSettings?: VendorSettings;
  onClose: () => void;
}) {
  const { t, packText } = useI18n();
  const pack = packCatalog.find((p) => p.id === request.pack) || packCatalog[0];
  const localizedPack = pack ? packText(pack) : null;
  const packName = localizedPack?.name || request.pack;
  const setup = request.currency === 'EUR' ? pack?.setup_fee_eur || 0 : pack?.setup_fee_mad || 0;
  const annual = request.currency === 'EUR' ? pack?.annual_fee_eur || 0 : pack?.annual_fee_mad || 0;
  const totalHt = setup + annual;
  const taxRate = vendorSettings?.default_tax_rate ?? 20;
  const tva = Number(((totalHt * taxRate) / 100).toFixed(2));
  const totalTtc = totalHt + tva;
  const prefix = vendorSettings?.quote_prefix || 'DEV-B2B';
  const quoteNumber = `${prefix}-${request.id.slice(-6).toUpperCase()}`;

  return (
    <div className="fixed inset-0 z-50 bg-[#10243a]/70 flex items-center justify-center p-4 overflow-y-auto print:static print:bg-white print:p-0">
      <div className="bg-white rounded-xl max-w-3xl w-full shadow-2xl overflow-hidden print:shadow-none print:rounded-none">
        <div className="flex items-center justify-between px-6 py-3 bg-slate-100 border-b border-slate-200 no-print">
          <span className="text-sm font-bold text-[#17324d]">
            {t('b2b.quote.preview', { no: quoteNumber })}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white text-xs font-bold"
            >
              <Printer className="w-3.5 h-3.5" />
              {t('b2b.quote.print')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-slate-700"
            >
              {t('common.close')}
            </button>
          </div>
        </div>

        <div className="p-8 sm:p-10 text-[#17324d] space-y-6">
          <div className="flex justify-between items-start gap-6 border-b-2 border-[#17324d] pb-5">
            <div className="flex items-start gap-4">
              {vendorSettings?.logo_url && (
                <img
                  src={vendorSettings.logo_url}
                  alt={vendorSettings.company_name}
                  className="max-w-[110px] max-h-[60px] object-contain"
                />
              )}
              <div>
                <div className="text-2xl font-extrabold tracking-tight">
                  {vendorSettings?.company_name || 'FRET MANAGER B2B'}
                  {vendorSettings?.legal_form ? ` ${vendorSettings.legal_form}` : ''}
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  {vendorSettings?.activity || t('b2b.quote.sub')}
                </div>
                {(vendorSettings?.address || vendorSettings?.city) && (
                  <div className="text-xs text-slate-500 mt-0.5">
                    {[vendorSettings.address, vendorSettings.city].filter(Boolean).join(' · ')}
                  </div>
                )}
                {(vendorSettings?.phone || vendorSettings?.email) && (
                  <div className="text-xs text-slate-500">
                    {[vendorSettings.phone, vendorSettings.email].filter(Boolean).join(' · ')}
                  </div>
                )}
                {(vendorSettings?.ice || vendorSettings?.rc || vendorSettings?.rib) && (
                  <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                    {[
                      vendorSettings.ice ? `ICE: ${vendorSettings.ice}` : '',
                      vendorSettings.rc ? `RC: ${vendorSettings.rc}` : '',
                      vendorSettings.rib ? `RIB: ${vendorSettings.rib}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                )}
              </div>
            </div>
            <div className="text-end shrink-0">
              <div className="text-lg font-extrabold text-[#2367a5]">{t('b2b.quote.doc')}</div>
              <div className="font-mono text-xs mt-1">N° {quoteNumber}</div>
              <div className="text-xs text-slate-600">
                {t('common.date')} : {dateText(new Date().toISOString())}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 text-sm bg-[#f8fafc] border border-slate-200 rounded-lg p-4">
            <div>
              <div className="text-xs font-bold uppercase text-slate-500">{t('b2b.quote.client')}</div>
              <div className="font-bold mt-1">{request.company_name}</div>
              <div className="text-xs text-slate-600 mt-0.5">
                {t('b2b.quote.attn')} {request.contact_name}
              </div>
              <div className="text-xs text-slate-600">
                {request.phone} · {request.email}
              </div>
            </div>
            <div>
              <div className="text-xs font-bold uppercase text-slate-500">{t('b2b.quote.scope')}</div>
              <div className="font-bold mt-1">{packName}</div>
              <div className="text-xs text-slate-600 mt-0.5">
                {t('b2b.quote.fleet', { count: request.fleet_size, cur: request.currency })}
              </div>
              <div className="text-xs text-slate-600">{t('b2b.quote.delay')}</div>
            </div>
          </div>

          <table className="w-full text-start border-collapse text-sm">
            <thead>
              <tr className="bg-[#17324d] text-white text-xs uppercase">
                <th className="px-4 py-2.5">{t('b2b.quote.col_svc')}</th>
                <th className="px-4 py-2.5 text-end">{t('b2b.quote.col_ht')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 border border-slate-200">
              <tr>
                <td className="px-4 py-3">
                  <div className="font-bold">{t('b2b.quote.row1_t', { pack: packName })}</div>
                  <div className="text-xs text-slate-600 mt-0.5">{t('b2b.quote.row1_d')}</div>
                </td>
                <td className="px-4 py-3 text-end font-mono font-bold tabular-nums">
                  {money(setup, request.currency)}
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3">
                  <div className="font-bold">{t('b2b.quote.row2_t')}</div>
                  <div className="text-xs text-slate-600 mt-0.5">
                    {pack && pack.max_vehicles >= 900
                      ? t('b2b.packs.unlimited')
                      : `${pack?.max_vehicles} ${t('b2b.packs.vehicles')}`}{' '}
                    ·{' '}
                    {pack && pack.max_users >= 900
                      ? t('b2b.packs.unlimited')
                      : `${pack?.max_users} ${t('b2b.packs.accounts')}`}
                  </div>
                </td>
                <td className="px-4 py-3 text-end font-mono font-bold tabular-nums">
                  {money(annual, request.currency)}
                </td>
              </tr>
            </tbody>
          </table>

          {localizedPack && (
            <div className="text-xs text-slate-700 space-y-1">
              <div className="font-bold text-[#17324d]">{t('b2b.quote.deliv')}</div>
              <ul className="list-disc ps-5 space-y-0.5">
                {localizedPack.deliverables.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end">
            <div className="w-72 border border-slate-200 rounded-lg p-4 space-y-1.5 text-sm bg-[#f8fafc]">
              <div className="flex justify-between">
                <span className="text-slate-600">{t('inv.print.total_ht')}</span>
                <span className="font-mono font-bold tabular-nums">{money(totalHt, request.currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">{t('inv.tva', { rate: taxRate })}</span>
                <span className="font-mono font-bold tabular-nums">{money(tva, request.currency)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-300 pt-2 text-base font-extrabold text-[#17324d]">
                <span>{t('b2b.quote.net_ttc')}</span>
                <span className="font-mono tabular-nums">{money(totalTtc, request.currency)}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 pt-6 border-t border-slate-200 text-xs text-slate-600">
            <div>{vendorSettings?.payment_terms || t('b2b.quote.terms')}</div>
            <div className="text-end">
              <div className="font-bold text-[#17324d] mb-8">{t('b2b.quote.sign')}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
