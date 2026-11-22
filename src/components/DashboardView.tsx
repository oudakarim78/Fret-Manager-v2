import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { PageId, PublicProfile } from '../types.ts';
import { api } from '../lib/api.ts';
import { useI18n } from '../lib/i18n.tsx';
import { InfoBanner } from './UI.tsx';
import { TrialDashboard } from './TrialDashboard.tsx';

interface DashboardCounts {
  vehicles: number;
  drivers: number;
  clients: number;
  trips: number;
  activeTrips: number;
  doneTrips: number;
  alerts: number;
}

export function DashboardView({
  profile,
  onNavigate,
  onOpenTripFilter,
  onOpenShare,
  notify,
}: {
  profile: PublicProfile;
  onNavigate: (page: PageId) => void;
  onOpenTripFilter: (status: string) => void;
  onOpenShare: () => void;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t, roleLabel } = useI18n();
  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ counts: DashboardCounts }>('/api/dashboard')
      .then((res) => {
        if (!cancelled) setCounts(res.counts);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erreur de chargement');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <InfoBanner tone="error">{error}</InfoBanner>;
  }

  if (!counts) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 h-24 animate-pulse" />
        ))}
      </div>
    );
  }

  const cards: Array<{
    label: string;
    value: number;
    hint: string;
    onClick: () => void;
    alert?: boolean;
  }> = [
    { label: t('nav.vehicles'), value: counts.vehicles, hint: t('dash.open_hint'), onClick: () => onNavigate('vehicles') },
    { label: t('nav.drivers'), value: counts.drivers, hint: t('dash.open_hint'), onClick: () => onNavigate('drivers') },
    { label: t('nav.clients'), value: counts.clients, hint: t('dash.open_hint'), onClick: () => onNavigate('clients') },
    { label: t('nav.trips'), value: counts.trips, hint: t('dash.open_hint'), onClick: () => onNavigate('trips') },
    {
      label: t('dash.active_trips'),
      value: counts.activeTrips,
      hint: t('dash.filter_hint'),
      onClick: () => onOpenTripFilter('En cours'),
    },
    {
      label: t('dash.done_trips'),
      value: counts.doneTrips,
      hint: t('dash.filter_hint'),
      onClick: () => onOpenTripFilter('Terminée'),
    },
    {
      label: t('nav.alerts'),
      value: counts.alerts,
      hint: t('dash.view_hint'),
      onClick: () => onNavigate('alerts'),
      alert: counts.alerts > 0,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {cards.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={c.onClick}
            className={`group text-start bg-white rounded-xl p-4 border transition-all hover:border-[#2367a5] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2367a5] ${
              c.alert ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between gap-1 text-xs font-medium text-slate-500">
              <span className="truncate">{c.label}</span>
              {c.alert && <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />}
            </div>
            <div className="text-2xl font-extrabold font-mono tabular-nums text-[#17324d] mt-1.5">
              {c.value}
            </div>
            <div className="text-[11px] text-slate-400 group-hover:text-[#2367a5] mt-1 inline-flex items-center gap-1 transition-colors">
              {c.hint}
              <ArrowRight className="w-3 h-3 rtl:rotate-180" />
            </div>
          </button>
        ))}
      </div>

      {profile.role === 'admin' && <TrialDashboard profile={profile} notify={notify} />}

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[#17324d]">
              {t('dash.welcome', { name: profile.workspace_name })}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {t('dash.space_line', {
                role: roleLabel(profile.role),
                code: profile.workspace_code,
              })}
            </p>
          </div>
          {profile.role === 'admin' && (
            <button
              type="button"
              onClick={onOpenShare}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#eef4f8] text-[#17324d] hover:bg-[#dce8f3] transition-colors whitespace-nowrap shrink-0"
            >
              {t('dash.invite_btn')}
            </button>
          )}
        </div>

        <InfoBanner>{t('dash.banner')}</InfoBanner>
      </div>
    </div>
  );
}
