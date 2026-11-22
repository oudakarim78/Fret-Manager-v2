import React, { useCallback, useEffect, useState } from 'react';
import type {
  Client,
  Currency,
  DocumentItem,
  Driver,
  FleetCategory,
  LookupsData,
  Maintenance,
  PageId,
  PublicProfile,
  TripAlert,
  Vehicle,
} from '../types.ts';
import { api, getAuthenticatedFileUrl } from '../lib/api.ts';
import { FLEET_CATEGORIES, inferFleetCategory, isTrailerCategory } from '../lib/fleet.ts';
import { dateText, money } from '../lib/format.ts';
import {
  ConfirmDialog,
  type ConfirmState,
  EmptyState,
  InfoBanner,
  Modal,
  StatusText,
} from './UI.tsx';
import { useI18n } from '../lib/i18n.tsx';

function getExpiryState(dateStr?: string | null): 'none' | 'expired' | 'soon' | 'ok' {
  if (!dateStr) return 'none';
  const today = new Date().toISOString().slice(0, 10);
  if (dateStr < today) return 'expired';
  const limit = new Date();
  limit.setDate(limit.getDate() + 30);
  const limitStr = limit.toISOString().slice(0, 10);
  return dateStr <= limitStr ? 'soon' : 'ok';
}

function expiryTone(state: 'none' | 'expired' | 'soon' | 'ok'): 'red' | 'amber' | 'green' | 'neutral' {
  if (state === 'expired') return 'red';
  if (state === 'soon') return 'amber';
  if (state === 'ok') return 'green';
  return 'neutral';
}

export function AlertsView({
  onOpenTripDetail,
  onNavigate,
  notify,
}: {
  onOpenTripDetail: (tripId: string) => void;
  onNavigate?: (page: PageId) => void;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t, alertSeverityLabel } = useI18n();
  const [alerts, setAlerts] = useState<TripAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<TripAlert[]>('/api/alerts')
      .then(setAlerts)
      .catch((err) => notify(err instanceof Error ? err.message : t('common.loading'), 'error'))
      .finally(() => setLoading(false));
  }, [notify, t]);

  if (loading) {
    return <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">{t('common.loading')}</div>;
  }

  if (alerts.length === 0) {
    return (
      <EmptyState
        title={t('alerts.empty_title')}
        description={t('alerts.empty_desc')}
      />
    );
  }

  return (
    <div className="space-y-4">
      <InfoBanner>{t('alerts.banner')}</InfoBanner>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full min-w-[680px] text-start border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
              <th className="px-4 py-3">{t('alerts.col.prio')}</th>
              <th className="px-4 py-3">{t('driver.mission_label')}</th>
              <th className="px-4 py-3">{t('alerts.col.type')}</th>
              <th className="px-4 py-3">{t('alerts.col.detail')}</th>
              <th className="px-4 py-3">{t('common.action')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {alerts.map((a, idx) => (
              <tr key={`${a.id}_${idx}`} className="hover:bg-slate-50/70">
                <td className="px-4 py-3">
                  <StatusText label={alertSeverityLabel(a.level)} tone={a.level === 'Urgent' ? 'red' : 'amber'} />
                </td>
                <td className="px-4 py-3 font-mono font-bold text-[#17324d]">{a.reference}</td>
                <td className="px-4 py-3 font-semibold text-slate-800">{a.type}</td>
                <td className="px-4 py-3 text-slate-600">{a.detail}</td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (a.target_page && a.target_page !== 'trips' && onNavigate) {
                        onNavigate(a.target_page);
                      } else {
                        onOpenTripDetail(a.id);
                      }
                    }}
                    className="px-3 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold whitespace-nowrap"
                  >
                    {a.target_page === 'vehicles'
                      ? t('alerts.open_vehicles')
                      : a.target_page === 'drivers'
                        ? t('alerts.open_drivers')
                        : a.target_page === 'documents'
                          ? t('alerts.open_documents')
                          : t('alerts.open_trip')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function VehiclesView({
  profile,
  onRefreshLookups,
  notify,
}: {
  profile: PublicProfile;
  onRefreshLookups: () => Promise<void>;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t, lang, entityStatusLabel } = useI18n();
  const [rows, setRows] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expiriesOnly, setExpiriesOnly] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const [registration, setRegistration] = useState('');
  const [fleetCategory, setFleetCategory] = useState<FleetCategory>('tracteur');
  const [vehicleType, setVehicleType] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [status, setStatus] = useState<Vehicle['status']>('actif');
  const [insuranceExpiry, setInsuranceExpiry] = useState('');
  const [techExpiry, setTechExpiry] = useState('');
  const [vignetteExpiry, setVignetteExpiry] = useState('');

  const editable = ['admin', 'logistique'].includes(profile.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api<Vehicle[]>('/api/vehicles'));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur chargement véhicules.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  function openForm(v: Vehicle | null = null) {
    setEditing(v);
    setRegistration(v?.registration || '');
    setFleetCategory(v ? inferFleetCategory(v) : 'tracteur');
    setVehicleType(v?.vehicle_type || '');
    setBrand(v?.brand || '');
    setModel(v?.model || '');
    setYear(v?.year ? String(v.year) : '');
    setStatus(v?.status || 'actif');
    setInsuranceExpiry(v?.insurance_expiry || '');
    setTechExpiry(v?.technical_inspection_expiry || '');
    setVignetteExpiry(v?.vignette_expiry || '');
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        registration: registration.trim(),
        fleet_category: fleetCategory,
        vehicle_type: vehicleType.trim() || null,
        brand: brand.trim() || null,
        model: model.trim() || null,
        year: year ? Number(year) : null,
        status,
        insurance_expiry: insuranceExpiry || null,
        technical_inspection_expiry: techExpiry || null,
        vignette_expiry: vignetteExpiry || null,
      };
      if (editing) {
        await api(`/api/vehicles/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        notify('Véhicule mis à jour.', 'success');
      } else {
        await api('/api/vehicles', { method: 'POST', body: JSON.stringify(payload) });
        notify('Véhicule ajouté.', 'success');
      }
      setOpen(false);
      await onRefreshLookups();
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur enregistrement.', 'error');
    }
  }

  const hasVehicleIssue = (v: Vehicle) =>
    [v.insurance_expiry, v.technical_inspection_expiry, v.vignette_expiry].some((d) => {
      const st = getExpiryState(d);
      return st === 'expired' || st === 'soon';
    });

  const expiringCount = rows.filter(hasVehicleIssue).length;

  const filtered = rows.filter((r) => {
    if (expiriesOnly && !hasVehicleIssue(r)) return false;
    const cat = inferFleetCategory(r);
    const catLabel = t(`veh.cat.${cat}`);
    return `${r.registration} ${cat} ${catLabel} ${r.vehicle_type || ''} ${r.brand || ''} ${r.model || ''} ${r.status}`
      .toLowerCase()
      .includes(search.toLowerCase());
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <button
            type="button"
            onClick={() => openForm(null)}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white"
          >
            {t('veh.add')}
          </button>
        )}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('common.search')}
          className="w-64 px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg"
        />
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => setExpiriesOnly(false)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              !expiriesOnly ? 'bg-white text-[#17324d] shadow-xs' : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            {t('veh.filter.all')}
          </button>
          <button
            type="button"
            onClick={() => setExpiriesOnly(true)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              expiriesOnly ? 'bg-white text-amber-700 shadow-xs' : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            {t('veh.filter.expiring', { count: expiringCount })}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">{t('common.loading')}</div>
      ) : filtered.length === 0 ? (
        <EmptyState title={t('veh.empty')} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[820px] text-start border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <th className="px-4 py-3">{t('veh.col.reg')}</th>
                <th className="px-4 py-3">{t('common.type')}</th>
                <th className="px-4 py-3">{t('veh.col.brand')}</th>
                <th className="px-4 py-3">{t('veh.col.model')}</th>
                <th className="px-4 py-3">{t('veh.col.year')}</th>
                <th className="px-4 py-3">{t('veh.col.expiries')}</th>
                <th className="px-4 py-3">{t('common.status')}</th>
                {editable && <th className="px-4 py-3">{t('common.actions')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.map((r) => {
                const expItems: Array<[string, string | null | undefined]> = [
                  [t('veh.exp.insurance'), r.insurance_expiry],
                  [t('veh.exp.tech'), r.technical_inspection_expiry],
                  [t('veh.exp.vignette'), r.vignette_expiry],
                ];
                const setItems = expItems.filter(([, dt]) => Boolean(dt));
                const cat = inferFleetCategory(r);
                const isTrailer = isTrailerCategory(cat);
                return (
                <tr key={r.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-mono font-bold text-[#17324d]">{r.registration}</td>
                  <td className="px-4 py-3 text-slate-700">
                    <div className="flex flex-col gap-0.5">
                      <span
                        className={`inline-flex w-fit items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
                          isTrailer
                            ? 'bg-sky-50 text-sky-800 border border-sky-200'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {t(`veh.cat.${cat}`)}
                      </span>
                      {r.vehicle_type && (
                        <span className="text-[11px] text-slate-500">{r.vehicle_type}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{r.brand || '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{r.model || '—'}</td>
                  <td className="px-4 py-3 font-mono text-slate-600">{r.year || '—'}</td>
                  <td className="px-4 py-3">
                    {setItems.length === 0 ? (
                      <span className="text-slate-400">{t('expiry.none')}</span>
                    ) : (
                      <div className="space-y-1">
                        {setItems.map(([label, dt]) => {
                          const st = getExpiryState(dt);
                          return (
                            <div key={label} className="flex items-center gap-1.5 whitespace-nowrap">
                              <StatusText label={t(`expiry.${st}`)} tone={expiryTone(st)} />
                              <span className="text-slate-600">{label}:</span>
                              <span className="font-mono text-slate-700">{dateText(dt, lang)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusText
                      label={entityStatusLabel(r.status)}
                      tone={r.status === 'actif' ? 'green' : r.status === 'en_maintenance' ? 'amber' : 'red'}
                    />
                  </td>
                  {editable && (
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => openForm(r)}
                          className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                        >
                          {t('common.edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirm({
                              open: true,
                              title: t('veh.del_title'),
                              message: t('veh.del_msg', { reg: r.registration }),
                              confirmLabel: t('common.delete'),
                              danger: true,
                              onConfirm: async () => {
                                try {
                                  await api(`/api/vehicles/${r.id}`, { method: 'DELETE' });
                                  notify('OK', 'success');
                                  await onRefreshLookups();
                                  await load();
                                } catch (err) {
                                  notify(err instanceof Error ? err.message : 'Erreur suppression.', 'error');
                                }
                              },
                            })
                          }
                          className="px-2.5 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-700 font-semibold"
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} title={editing ? t('veh.modal.edit') : t('veh.modal.add')} onClose={() => setOpen(false)} maxWidth="max-w-xl">
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('veh.col.reg')} *</label>
              <input required value={registration} onChange={(e) => setRegistration(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('veh.cat_label')} *</label>
              <select
                value={fleetCategory}
                onChange={(e) => setFleetCategory(e.target.value as FleetCategory)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {FLEET_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {t(`veh.cat.${c.value}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('veh.type_label')}</label>
              <input value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} placeholder="Ex. Tracteur 4x2, Frigo 40T…" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('veh.col.brand')}</label>
              <input value={brand} onChange={(e) => setBrand(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('veh.col.model')}</label>
              <input value={model} onChange={(e) => setModel(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('veh.col.year')}</label>
              <input type="number" value={year} onChange={(e) => setYear(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.status')}</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as Vehicle['status'])} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="actif">{entityStatusLabel('actif')}</option>
                <option value="en_maintenance">{entityStatusLabel('en_maintenance')}</option>
                <option value="inactif">{entityStatusLabel('inactif')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('veh.exp.insurance')}</label>
              <input type="date" value={insuranceExpiry} onChange={(e) => setInsuranceExpiry(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('veh.exp.tech')}</label>
              <input type="date" value={techExpiry} onChange={(e) => setTechExpiry(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('veh.exp.vignette')}</label>
              <input type="date" value={vignetteExpiry} onChange={(e) => setVignetteExpiry(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700">{t('common.cancel')}</button>
            <button type="submit" className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] text-white">{t('common.save')}</button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

export function DriversView({
  profile,
  onRefreshLookups,
  notify,
}: {
  profile: PublicProfile;
  onRefreshLookups: () => Promise<void>;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t, lang, entityStatusLabel } = useI18n();
  const [rows, setRows] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expiriesOnly, setExpiriesOnly] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [license, setLicense] = useState('');
  const [status, setStatus] = useState<'actif' | 'inactif'>('actif');
  const [licenseExpiry, setLicenseExpiry] = useState('');
  const [medicalExpiry, setMedicalExpiry] = useState('');

  const editable = ['admin', 'logistique'].includes(profile.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api<Driver[]>('/api/drivers'));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur chargement conducteurs.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  function openForm(d: Driver | null = null) {
    setEditing(d);
    setFullName(d?.full_name || '');
    setPhone(d?.phone || '');
    setEmail(d?.email || '');
    setLicense(d?.license_number || '');
    setStatus(d?.status || 'actif');
    setLicenseExpiry(d?.license_expiry || '');
    setMedicalExpiry(d?.medical_visit_expiry || '');
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        license_number: license.trim() || null,
        status,
        license_expiry: licenseExpiry || null,
        medical_visit_expiry: medicalExpiry || null,
      };
      if (editing) {
        await api(`/api/drivers/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        notify('Conducteur mis à jour.', 'success');
      } else {
        await api('/api/drivers', { method: 'POST', body: JSON.stringify(payload) });
        notify('Conducteur ajouté.', 'success');
      }
      setOpen(false);
      await onRefreshLookups();
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur enregistrement.', 'error');
    }
  }

  const hasDriverIssue = (d: Driver) =>
    [d.license_expiry, d.medical_visit_expiry].some((dt) => {
      const st = getExpiryState(dt);
      return st === 'expired' || st === 'soon';
    });

  const expiringCount = rows.filter(hasDriverIssue).length;

  const filtered = rows.filter((r) => {
    if (expiriesOnly && !hasDriverIssue(r)) return false;
    return `${r.full_name} ${r.phone || ''} ${r.email || ''} ${r.license_number || ''}`
      .toLowerCase()
      .includes(search.toLowerCase());
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <button
            type="button"
            onClick={() => openForm(null)}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white"
          >
            {t('drv.add')}
          </button>
        )}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('common.search')}
          className="w-64 px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg"
        />
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => setExpiriesOnly(false)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              !expiriesOnly ? 'bg-white text-[#17324d] shadow-xs' : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            {t('veh.filter.all')}
          </button>
          <button
            type="button"
            onClick={() => setExpiriesOnly(true)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              expiriesOnly ? 'bg-white text-amber-700 shadow-xs' : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            {t('drv.filter.expiring', { count: expiringCount })}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">{t('common.loading')}</div>
      ) : filtered.length === 0 ? (
        <EmptyState title={t('drv.empty')} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[800px] text-start border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <th className="px-4 py-3">{t('trips.col.driver')}</th>
                <th className="px-4 py-3">{t('common.phone')}</th>
                <th className="px-4 py-3">{t('common.email')}</th>
                <th className="px-4 py-3">{t('drv.col.license')}</th>
                <th className="px-4 py-3">{t('drv.col.expiries')}</th>
                <th className="px-4 py-3">{t('common.status')}</th>
                {editable && <th className="px-4 py-3">{t('common.actions')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.map((r) => {
                const expItems: Array<[string, string | null | undefined]> = [
                  [t('drv.exp.license'), r.license_expiry],
                  [t('drv.exp.medical'), r.medical_visit_expiry],
                ];
                const setItems = expItems.filter(([, dt]) => Boolean(dt));
                return (
                <tr key={r.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-bold text-[#17324d]">{r.full_name}</td>
                  <td className="px-4 py-3 font-mono text-slate-700">{r.phone || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{r.email || '—'}</td>
                  <td className="px-4 py-3 font-mono text-slate-700">{r.license_number || '—'}</td>
                  <td className="px-4 py-3">
                    {setItems.length === 0 ? (
                      <span className="text-slate-400">{t('expiry.none')}</span>
                    ) : (
                      <div className="space-y-1">
                        {setItems.map(([label, dt]) => {
                          const st = getExpiryState(dt);
                          return (
                            <div key={label} className="flex items-center gap-1.5 whitespace-nowrap">
                              <StatusText label={t(`expiry.${st}`)} tone={expiryTone(st)} />
                              <span className="text-slate-600">{label}:</span>
                              <span className="font-mono text-slate-700">{dateText(dt, lang)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusText label={entityStatusLabel(r.status)} tone={r.status === 'actif' ? 'green' : 'red'} />
                  </td>
                  {editable && (
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => openForm(r)}
                          className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                        >
                          {t('common.edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirm({
                              open: true,
                              title: t('drv.del_title'),
                              message: t('drv.del_msg', { name: r.full_name }),
                              confirmLabel: t('common.delete'),
                              danger: true,
                              onConfirm: async () => {
                                try {
                                  await api(`/api/drivers/${r.id}`, { method: 'DELETE' });
                                  notify('OK', 'success');
                                  await onRefreshLookups();
                                  await load();
                                } catch (err) {
                                  notify(err instanceof Error ? err.message : 'Erreur suppression.', 'error');
                                }
                              },
                            })
                          }
                          className="px-2.5 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-700 font-semibold"
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} title={editing ? t('drv.modal.edit') : t('drv.modal.add')} onClose={() => setOpen(false)} maxWidth="max-w-xl">
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('auth.reg.fullname')}</label>
              <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.phone')}</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.email')}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('drv.license_no')}</label>
              <input value={license} onChange={(e) => setLicense(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.status')}</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as 'actif' | 'inactif')} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="actif">{entityStatusLabel('actif')}</option>
                <option value="inactif">{entityStatusLabel('inactif')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('drv.exp.license')}</label>
              <input type="date" value={licenseExpiry} onChange={(e) => setLicenseExpiry(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('drv.exp.medical')}</label>
              <input type="date" value={medicalExpiry} onChange={(e) => setMedicalExpiry(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700">{t('common.cancel')}</button>
            <button type="submit" className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] text-white">{t('common.save')}</button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

export function ClientsView({
  profile,
  onRefreshLookups,
  notify,
}: {
  profile: PublicProfile;
  onRefreshLookups: () => Promise<void>;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Client | null>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [ice, setIce] = useState('');
  const [clientType, setClientType] = useState('');
  const [active, setActive] = useState(true);

  const editable = ['admin', 'logistique'].includes(profile.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api<Client[]>('/api/clients'));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur chargement clients.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  function openForm(c: Client | null = null) {
    setEditing(c);
    setCompanyName(c?.company_name || '');
    setContactName(c?.contact_name || '');
    setPhone(c?.phone || '');
    setEmail(c?.email || '');
    setAddress(c?.address || '');
    setIce(c?.ice || '');
    setClientType(c?.client_type || '');
    setActive(c?.active ?? true);
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        company_name: companyName.trim(),
        contact_name: contactName.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        ice: ice.trim() || null,
        client_type: clientType.trim() || null,
        active,
      };
      if (editing) {
        await api(`/api/clients/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        notify('Client mis à jour.', 'success');
      } else {
        await api('/api/clients', { method: 'POST', body: JSON.stringify(payload) });
        notify('Client ajouté.', 'success');
      }
      setOpen(false);
      await onRefreshLookups();
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur enregistrement.', 'error');
    }
  }

  const filtered = rows.filter((r) =>
    `${r.company_name} ${r.contact_name || ''} ${r.ice || ''} ${r.phone || ''}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <button
            type="button"
            onClick={() => openForm(null)}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white"
          >
            {t('cli.add')}
          </button>
        )}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('common.search')}
          className="w-64 px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg"
        />
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">{t('common.loading')}</div>
      ) : filtered.length === 0 ? (
        <EmptyState title={t('cli.empty')} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[740px] text-start border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <th className="px-4 py-3">{t('cli.col.company')}</th>
                <th className="px-4 py-3">{t('cli.col.contact')}</th>
                <th className="px-4 py-3">{t('common.phone')}</th>
                <th className="px-4 py-3">{t('common.ice')}</th>
                <th className="px-4 py-3">{t('cli.col.active')}</th>
                {editable && <th className="px-4 py-3">{t('common.actions')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-bold text-[#17324d]">{r.company_name}</td>
                  <td className="px-4 py-3 text-slate-700">{r.contact_name || '—'}</td>
                  <td className="px-4 py-3 font-mono text-slate-700">{r.phone || '—'}</td>
                  <td className="px-4 py-3 font-mono text-slate-600">{r.ice || '—'}</td>
                  <td className="px-4 py-3">
                    <StatusText label={r.active ? t('common.yes') : t('common.no')} tone={r.active ? 'green' : 'neutral'} />
                  </td>
                  {editable && (
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => openForm(r)}
                          className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                        >
                          {t('common.edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirm({
                              open: true,
                              title: t('cli.del_title'),
                              message: t('cli.del_msg', { name: r.company_name }),
                              confirmLabel: t('common.delete'),
                              danger: true,
                              onConfirm: async () => {
                                try {
                                  await api(`/api/clients/${r.id}`, { method: 'DELETE' });
                                  notify('OK', 'success');
                                  await onRefreshLookups();
                                  await load();
                                } catch (err) {
                                  notify(err instanceof Error ? err.message : 'Erreur suppression.', 'error');
                                }
                              },
                            })
                          }
                          className="px-2.5 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-700 font-semibold"
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} title={editing ? t('cli.modal.edit') : t('cli.modal.add')} onClose={() => setOpen(false)} maxWidth="max-w-2xl">
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('cli.legal_name')}</label>
              <input required value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('cli.contact_name')}</label>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.phone')}</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.email')}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.ice')}</label>
              <input value={ice} onChange={(e) => setIce(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('cli.client_type')}</label>
              <input value={clientType} onChange={(e) => setClientType(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.address')}</label>
              <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('cli.is_active')}</label>
              <select value={active ? 'true' : 'false'} onChange={(e) => setActive(e.target.value === 'true')} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="true">{t('common.yes')}</option>
                <option value="false">{t('common.no')}</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700">{t('common.cancel')}</button>
            <button type="submit" className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] text-white">{t('common.save')}</button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

export function MaintenanceView({
  profile,
  lookups,
  notify,
}: {
  profile: PublicProfile;
  lookups: LookupsData;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Maintenance[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Maintenance | null>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const [vehicleId, setVehicleId] = useState('');
  const [mType, setMType] = useState('');
  const [desc, setDesc] = useState('');
  const [mDate, setMDate] = useState('');
  const [cost, setCost] = useState('');
  const [currency, setCurrency] = useState<Currency>('MAD');
  const [nextDate, setNextDate] = useState('');

  const editable = ['admin', 'logistique'].includes(profile.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api<Maintenance[]>('/api/maintenance'));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur chargement maintenance.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  function openForm(m: Maintenance | null = null) {
    setEditing(m);
    setVehicleId(m?.vehicle_id || '');
    setMType(m?.maintenance_type || '');
    setDesc(m?.description || '');
    setMDate(m?.maintenance_date || '');
    setCost(m?.cost !== null && m?.cost !== undefined ? String(m.cost) : '');
    setCurrency(m?.currency || 'MAD');
    setNextDate(m?.next_maintenance_date || '');
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        vehicle_id: vehicleId || null,
        maintenance_type: mType.trim(),
        description: desc.trim() || null,
        maintenance_date: mDate || null,
        cost: cost ? Number(cost) : null,
        currency,
        next_maintenance_date: nextDate || null,
      };
      if (editing) {
        await api(`/api/maintenance/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        notify('Entretien mis à jour.', 'success');
      } else {
        await api('/api/maintenance', { method: 'POST', body: JSON.stringify(payload) });
        notify('Entretien enregistré.', 'success');
      }
      setOpen(false);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur enregistrement.', 'error');
    }
  }

  const filtered = rows.filter((r) => {
    const vReg = lookups.vehicles.find((v) => v.id === r.vehicle_id)?.registration || '';
    return `${vReg} ${r.maintenance_type} ${r.description || ''}`
      .toLowerCase()
      .includes(search.toLowerCase());
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <button
            type="button"
            onClick={() => openForm(null)}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white"
          >
            {t('mnt.add')}
          </button>
        )}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('common.search')}
          className="w-64 px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg"
        />
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">{t('common.loading')}</div>
      ) : filtered.length === 0 ? (
        <EmptyState title={t('mnt.empty')} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[700px] text-start border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <th className="px-4 py-3">{t('trips.col.vehicle')}</th>
                <th className="px-4 py-3">{t('common.type')}</th>
                <th className="px-4 py-3">{t('common.date')}</th>
                <th className="px-4 py-3 text-end">{t('mnt.col.cost')}</th>
                <th className="px-4 py-3">{t('mnt.col.next')}</th>
                {editable && <th className="px-4 py-3">{t('common.actions')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.map((r) => {
                const vReg = lookups.vehicles.find((v) => v.id === r.vehicle_id)?.registration || '—';
                return (
                  <tr key={r.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono font-bold text-[#17324d]">{vReg}</td>
                    <td className="px-4 py-3 text-slate-800 font-medium">{r.maintenance_type}</td>
                    <td className="px-4 py-3 font-mono text-slate-600">{dateText(r.maintenance_date)}</td>
                    <td className="px-4 py-3 text-end font-mono font-semibold text-[#17324d]">
                      {r.cost !== null ? money(r.cost, r.currency) : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600">{dateText(r.next_maintenance_date)}</td>
                    {editable && (
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          <button type="button" onClick={() => openForm(r)} className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold">{t('common.edit')}</button>
                          <button
                            type="button"
                            onClick={() =>
                              setConfirm({
                                open: true,
                                title: t('mnt.del_title'),
                                message: t('mnt.del_msg'),
                                confirmLabel: t('common.delete'),
                                danger: true,
                                onConfirm: async () => {
                                  try {
                                    await api(`/api/maintenance/${r.id}`, { method: 'DELETE' });
                                    notify('OK', 'success');
                                    await load();
                                  } catch (err) {
                                    notify(err instanceof Error ? err.message : 'Erreur suppression.', 'error');
                                  }
                                },
                              })
                            }
                            className="px-2.5 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-700 font-semibold"
                          >
                            {t('common.delete')}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} title={editing ? t('mnt.modal.edit') : t('mnt.modal.add')} onClose={() => setOpen(false)} maxWidth="max-w-xl">
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('trips.col.vehicle')}</label>
              <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="">{t('common.choose')}</option>
                {lookups.vehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.registration}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('mnt.type_req')}</label>
              <input required value={mType} onChange={(e) => setMType(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('mnt.date')}</label>
              <input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('mnt.col.next')}</label>
              <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('mnt.col.cost')}</label>
              <input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.currency')}</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="MAD">MAD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.description')}</label>
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700">{t('common.cancel')}</button>
            <button type="submit" className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] text-white">{t('common.save')}</button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

export function DocumentsView({
  profile,
  lookups,
  notify,
}: {
  profile: PublicProfile;
  lookups: LookupsData;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<DocumentItem | null>(null);
  const [open, setOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<DocumentItem | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const [tripId, setTripId] = useState('');
  const [docType, setDocType] = useState('Document');
  const [docName, setDocName] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  const editable = ['admin', 'logistique'].includes(profile.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api<DocumentItem[]>('/api/documents'));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur chargement documents.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  function openForm(d: DocumentItem | null = null) {
    setEditing(d);
    setTripId(d?.trip_id || '');
    setDocType(d?.document_type || 'Document');
    setDocName(d?.document_name || '');
    setExpiryDate(d?.expiry_date || '');
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        trip_id: tripId,
        document_type: docType,
        document_name: docName.trim(),
        expiry_date: expiryDate || null,
      };
      if (editing) {
        await api(`/api/documents/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        notify('Document mis à jour.', 'success');
      } else {
        await api('/api/documents', { method: 'POST', body: JSON.stringify(payload) });
        notify('Document enregistré.', 'success');
      }
      setOpen(false);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur enregistrement.', 'error');
    }
  }

  const filtered = rows.filter((r) => {
    const tRef = lookups.trips.find((t) => t.id === r.trip_id)?.reference || '';
    return `${r.document_name} ${r.document_type} ${r.media_kind} ${tRef}`
      .toLowerCase()
      .includes(search.toLowerCase());
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <button
            type="button"
            onClick={() => openForm(null)}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white"
          >
            {t('doc.add')}
          </button>
        )}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('common.search')}
          className="w-64 px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg"
        />
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">{t('common.loading')}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={t('doc.empty_title')}
          description={t('doc.empty_desc')}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[700px] text-start border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <th className="px-4 py-3">{t('doc.col.name')}</th>
                <th className="px-4 py-3">{t('common.type')}</th>
                <th className="px-4 py-3">{t('doc.col.cat')}</th>
                <th className="px-4 py-3">{t('driver.mission_label')}</th>
                <th className="px-4 py-3">{t('doc.expiry')}</th>
                <th className="px-4 py-3">{t('doc.col.added')}</th>
                <th className="px-4 py-3">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.map((r) => {
                const tRef = lookups.trips.find((tr) => tr.id === r.trip_id)?.reference || r.trip_id;
                const expState = getExpiryState(r.expiry_date);
                return (
                  <tr key={r.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-semibold text-[#17324d]">{r.document_name}</td>
                    <td className="px-4 py-3 text-slate-600">{r.document_type}</td>
                    <td className="px-4 py-3">
                      <StatusText label={r.media_kind} tone="blue" />
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700">{tRef}</td>
                    <td className="px-4 py-3">
                      {r.expiry_date ? (
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          <StatusText label={t(`expiry.${expState}`)} tone={expiryTone(expState)} />
                          <span className="font-mono text-slate-700">{dateText(r.expiry_date, lang)}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500">{dateText(r.created_at, lang)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        {r.file_path && (
                          <button
                            type="button"
                            onClick={() => {
                              setPreviewError(false);
                              setPreviewDoc(r);
                            }}
                            className="px-2.5 py-1 rounded-md bg-[#2367a5] text-white font-semibold"
                          >
                            {t('common.open')}
                          </button>
                        )}
                        {editable && (
                          <>
                            <button type="button" onClick={() => openForm(r)} className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold">{t('common.edit')}</button>
                            <button
                              type="button"
                              onClick={() =>
                                setConfirm({
                                  open: true,
                                  title: t('doc.del_title'),
                                  message: t('doc.del_msg', { name: r.document_name }),
                                  confirmLabel: t('common.delete'),
                                  danger: true,
                                  onConfirm: async () => {
                                    try {
                                      await api(`/api/documents/${r.id}`, { method: 'DELETE' });
                                      notify('OK', 'success');
                                      await load();
                                    } catch (err) {
                                      notify(err instanceof Error ? err.message : 'Erreur suppression.', 'error');
                                    }
                                  },
                                })
                              }
                              className="px-2.5 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-700 font-semibold"
                            >
                              {t('common.delete')}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} title={editing ? t('doc.modal.edit') : t('doc.modal.add')} onClose={() => setOpen(false)} maxWidth="max-w-lg">
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('driver.mission_label')} *</label>
              <select required value={tripId} onChange={(e) => setTripId(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="">{t('common.choose')}</option>
                {lookups.trips.map((tr) => (
                  <option key={tr.id} value={tr.id}>{tr.reference} · {tr.departure} → {tr.destination}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.type')}</label>
              <select value={docType} onChange={(e) => setDocType(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="Document">{t('tdetail.doc_pdf')}</option>
                <option value="Photo">{t('tdetail.photo')}</option>
                <option value="Signature">Signature</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('doc.col.name')} *</label>
              <input required value={docName} onChange={(e) => setDocName(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('doc.expiry')}</label>
              <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700">{t('common.cancel')}</button>
            <button type="submit" className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] text-white">{t('common.save')}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!previewDoc} title={previewDoc?.document_name || t('tdetail.preview_title')} onClose={() => setPreviewDoc(null)} maxWidth="max-w-3xl">
        {previewDoc && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <a
                href={getAuthenticatedFileUrl(previewDoc.id)}
                download={previewDoc.document_name}
                className="px-3 py-1.5 rounded-lg bg-[#2367a5] text-white text-xs font-semibold"
              >
                {t('common.download')}
              </a>
            </div>
            {previewDoc.mime_type === 'application/pdf' ? (
              <iframe title={previewDoc.document_name} src={getAuthenticatedFileUrl(previewDoc.id)} className="w-full h-[65vh] border border-slate-200 rounded-lg" />
            ) : previewError ? (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 text-center text-sm text-slate-600">
                {t('tdetail.preview_error')}
              </div>
            ) : (
              <img
                src={getAuthenticatedFileUrl(previewDoc.id)}
                alt={previewDoc.document_name}
                onError={() => setPreviewError(true)}
                className="max-h-[65vh] mx-auto object-contain rounded"
              />
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
