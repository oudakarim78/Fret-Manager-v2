import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ClientProposal, LookupsData, PublicProfile, Trip } from '../types.ts';
import { api } from '../lib/api.ts';
import { getTripTractorIds, inferFleetCategory } from '../lib/fleet.ts';
import { dateText, dateTimeText } from '../lib/format.ts';
import { useI18n } from '../lib/i18n.tsx';
import {
  ConfirmDialog,
  type ConfirmState,
  EmptyState,
  InfoBanner,
  StatusText,
} from './UI.tsx';

export function DriverMissionsView({
  profile,
  lookups,
  onRefreshLookups,
  onOpenDetail,
  notify,
}: {
  profile: PublicProfile;
  lookups: LookupsData;
  onRefreshLookups?: () => Promise<void>;
  onOpenDetail: (tripId: string) => void;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t, lang, tripStatusLabel } = useI18n();
  const [missions, setMissions] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const rows = await api<Trip[]>('/api/trips');
        setMissions(rows);
        if (onRefreshLookups) {
          await onRefreshLookups();
        }
      } catch (err) {
        if (!silent) {
          notify(err instanceof Error ? err.message : 'Erreur chargement missions.', 'error');
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [notify, onRefreshLookups],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        void load(true);
      }
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void load(true);
      }
    }, 15000);
    return () => {
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
      window.clearInterval(timer);
    };
  }, [load]);

  const sortedMissions = useMemo(() => {
    const isActionablePending = (m: Trip) =>
      (m.driver_response || 'pending') === 'pending' &&
      ['À planifier', 'En cours'].includes(m.status);

    return [...missions].sort((a, b) => {
      const aPend = isActionablePending(a) ? 0 : 1;
      const bPend = isActionablePending(b) ? 0 : 1;
      if (aPend !== bPend) return aPend - bPend;
      const aDate = a.departure_date || a.created_at || '';
      const bDate = b.departure_date || b.created_at || '';
      return bDate.localeCompare(aDate);
    });
  }, [missions]);

  const pendingCount = useMemo(
    () =>
      missions.filter(
        (m) =>
          (m.driver_response || 'pending') === 'pending' &&
          ['À planifier', 'En cours'].includes(m.status),
      ).length,
    [missions],
  );

  function handleRespond(trip: Trip, response: 'accepted' | 'refused') {
    setConfirm({
      open: true,
      title: response === 'accepted' ? t('driver.accept_title') : t('driver.refuse_title'),
      message:
        response === 'accepted'
          ? t('driver.accept_msg', { ref: trip.reference })
          : t('driver.refuse_msg', { ref: trip.reference }),
      confirmLabel: response === 'accepted' ? t('driver.accept') : t('driver.refuse'),
      danger: response === 'refused',
      onConfirm: async () => {
        try {
          await api(`/api/trips/${trip.id}/respond`, {
            method: 'POST',
            body: JSON.stringify({ response, notes: null }),
          });
          notify('Votre réponse a été enregistrée.', 'success');
          await load(true);
        } catch (err) {
          notify(err instanceof Error ? err.message : 'Erreur réponse.', 'error');
        }
      },
    });
  }

  if (!profile.driver_id) {
    return <InfoBanner tone="error">{t('driver.no_driver_linked')}</InfoBanner>;
  }

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {pendingCount > 0 ? (
            <StatusText
              label={`${pendingCount} mission${pendingCount > 1 ? 's' : ''} en attente d’acceptation`}
              tone="amber"
            />
          ) : (
            <span className="text-xs font-semibold text-slate-500">
              {missions.length} mission{missions.length > 1 ? 's' : ''} attribuée{missions.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={refreshing}
          onClick={() => void load(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          <span>Actualiser</span>
        </button>
      </div>

      {sortedMissions.length === 0 ? (
        <EmptyState title={t('driver.no_missions')} description={t('driver.no_missions_desc')} />
      ) : (
        sortedMissions.map((m) => {
          const clientName = lookups.clients.find((c) => c.id === m.client_id)?.company_name || '—';
          const tractorUnits = getTripTractorIds(m)
            .map((id) => lookups.vehicles.find((v) => v.id === id))
            .filter((v): v is NonNullable<typeof v> => Boolean(v));
          const trailerUnit = m.trailer_id
            ? lookups.vehicles.find((v) => v.id === m.trailer_id)
            : undefined;
          const resp = m.driver_response || 'pending';
          const canRespond = resp === 'pending' && ['À planifier', 'En cours'].includes(m.status);
          return (
            <div
              key={m.id}
              className={`bg-white border rounded-xl p-5 space-y-4 ${
                canRespond ? 'border-[#2367a5]/50 ring-1 ring-[#2367a5]/15' : 'border-slate-200'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-[#17324d]">
                    {t('driver.mission_label')} <span className="font-mono">{m.reference}</span>
                  </h2>
                  {tractorUnits.map((v, idx) => (
                    <span
                      key={v.id}
                      className="text-xs font-mono font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded"
                    >
                      {tractorUnits.length > 1 ? `#${idx + 1} ` : ''}
                      {v.registration}
                    </span>
                  ))}
                  {trailerUnit && (
                    <span className="text-xs font-semibold text-sky-800 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded">
                      {t(`veh.cat.${inferFleetCategory(trailerUnit)}`)}: <span className="font-mono">{trailerUnit.registration}</span>
                    </span>
                  )}
                </div>
                <StatusText
                  label={tripStatusLabel(m.status)}
                  tone={m.status === 'Terminée' ? 'green' : m.status === 'En cours' ? 'blue' : m.status === 'Annulée' ? 'red' : 'amber'}
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <div className="text-[11px] font-semibold text-slate-500">{t('driver.client')}</div>
                  <div className="font-bold text-[#17324d] mt-0.5">{clientName}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <div className="text-[11px] font-semibold text-slate-500">{t('driver.dep')}</div>
                  <div className="font-bold text-[#17324d] mt-0.5">{m.departure}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <div className="text-[11px] font-semibold text-slate-500">{t('driver.dst')}</div>
                  <div className="font-bold text-[#17324d] mt-0.5">{m.destination}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <div className="text-[11px] font-semibold text-slate-500">{t('driver.dep_date')}</div>
                  <div className="font-mono font-bold text-[#17324d] mt-0.5">{dateText(m.departure_date, lang)}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <div className="text-[11px] font-semibold text-slate-500">{t('driver.arr_date')}</div>
                  <div className="font-mono font-bold text-[#17324d] mt-0.5">{dateText(m.arrival_date, lang)}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <div className="text-[11px] font-semibold text-slate-500">{t('driver.response')}</div>
                  <div className="font-bold text-[#17324d] mt-0.5">
                    {resp === 'accepted' ? t('driver.resp.accepted') : resp === 'refused' ? t('driver.resp.refused') : t('driver.resp.pending')}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onOpenDetail(m.id)}
                  className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800"
                >
                  {t('driver.detail_btn')}
                </button>
                {canRespond && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleRespond(m, 'accepted')}
                      className="px-3.5 py-2 text-xs font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white"
                    >
                      {t('driver.accept')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRespond(m, 'refused')}
                      className="px-3.5 py-2 text-xs font-bold rounded-lg bg-red-50 hover:bg-red-100 text-red-700"
                    >
                      {t('driver.refuse')}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })
      )}
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

export function DriverProposalView({
  profile,
  notify,
}: {
  profile: PublicProfile;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t, proposalStatusLabel } = useI18n();
  const [proposals, setProposals] = useState<ClientProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [ice, setIce] = useState('');
  const [address, setAddress] = useState('');
  const [contactName, setContactName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProposals(await api<ClientProposal[]>('/api/client-proposals'));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur chargement propositions.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  if (!profile.driver_id) {
    return (
      <InfoBanner tone="error">
        {t('driver.no_driver_linked')}
      </InfoBanner>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api('/api/client-proposals', {
        method: 'POST',
        body: JSON.stringify({
          company_name: companyName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          ice: ice.trim(),
          address: address.trim(),
          contact_name: contactName.trim() || null,
        }),
      });
      setCompanyName('');
      setPhone('');
      setEmail('');
      setIce('');
      setAddress('');
      setContactName('');
      notify('Proposition envoyée à l’administrateur.', 'success');
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur envoi proposition.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h2 className="text-base font-bold text-[#17324d]">{t('driver.prop_title')}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('driver.prop.company')}</label>
              <input required value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.phone')} *</label>
              <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.email')} *</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.ice')} *</label>
              <input required value={ice} onChange={(e) => setIce(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('driver.prop.addr')}</label>
              <textarea required value={address} onChange={(e) => setAddress(e.target.value)} rows={2} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('driver.prop.contact_opt')}</label>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white disabled:opacity-50"
          >
            {submitting ? t('common.saving') : t('driver.send_prop')}
          </button>
        </form>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <h2 className="text-base font-bold text-[#17324d]">{t('driver.my_props')}</h2>
        {loading ? (
          <p className="text-sm text-slate-500">{t('common.loading')}</p>
        ) : proposals.length === 0 ? (
          <p className="text-sm text-slate-500">{t('driver.no_props')}</p>
        ) : (
          <div className="space-y-3">
            {proposals.map((x) => (
              <div key={x.id} className="border border-slate-200 rounded-lg p-4 space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-sm text-[#17324d]">{x.company_name}</strong>
                  <StatusText
                    label={proposalStatusLabel(x.status)}
                    tone={x.status === 'approuvee' ? 'green' : x.status === 'refusee' ? 'red' : 'amber'}
                  />
                </div>
                <div className="text-slate-700">
                  <strong>{t('common.phone')} :</strong> {x.phone} · <strong>{t('common.email')} :</strong> {x.email}
                </div>
                <div className="text-slate-700">
                  <strong>{t('common.ice')} :</strong> <span className="font-mono">{x.ice}</span> · <strong>{t('common.address')} :</strong> {x.address}
                </div>
                {x.admin_notes && (
                  <div className="text-slate-700">
                    <strong>{t('driver.prop.admin_note')}</strong> {x.admin_notes}
                  </div>
                )}
                <div className="text-slate-400 font-mono">{t('driver.prop.sent_at', { date: dateTimeText(x.created_at) })}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
