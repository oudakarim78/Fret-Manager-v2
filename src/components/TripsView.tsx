import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Trash2, X } from 'lucide-react';
import type { Currency, LookupsData, PublicProfile, Trip, TripStatus } from '../types.ts';
import { api } from '../lib/api.ts';
import { getTripTractorIds, inferFleetCategory, isTrailerCategory } from '../lib/fleet.ts';
import { dateText, money, TRIP_STATUSES } from '../lib/format.ts';
import { useI18n } from '../lib/i18n.tsx';
import { findTripAssignmentConflict } from '../lib/tripConflicts.ts';
import {
  ConfirmDialog,
  type ConfirmState,
  EmptyState,
  InfoBanner,
  Modal,
  StatusText,
} from './UI.tsx';

type SearchScope = 'all' | 'vehicle' | 'driver';

function normalizeSearchText(val: string): string {
  return val
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function normalizePlate(val: string): string {
  return normalizeSearchText(val).replace(/[\s\-_/]+/g, '');
}

export function TripsView({
  profile,
  lookups,
  statusFilter,
  onClearFilter,
  onRefreshLookups,
  onOpenDetail,
  notify,
}: {
  profile: PublicProfile;
  lookups: LookupsData;
  statusFilter: string | null;
  onClearFilter: () => void;
  onRefreshLookups: () => Promise<void>;
  onOpenDetail: (tripId: string) => void;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t, lang, tripStatusLabel } = useI18n();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Trip | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // Form state
  const [reference, setReference] = useState('');
  const [clientId, setClientId] = useState('');
  const [tractorIds, setTractorIds] = useState<string[]>([]);
  const [trailerId, setTrailerId] = useState('');
  const [pendingTractorId, setPendingTractorId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [departureCityId, setDepartureCityId] = useState('');
  const [destinationCityId, setDestinationCityId] = useState('');
  const [departureDate, setDepartureDate] = useState('');
  const [arrivalDate, setArrivalDate] = useState('');
  const [status, setStatus] = useState<TripStatus>('À planifier');
  const [revenue, setRevenue] = useState('0');
  const [currency, setCurrency] = useState<Currency>('MAD');
  const [saving, setSaving] = useState(false);

  const canEdit = ['admin', 'logistique'].includes(profile.role);
  const isAdmin = profile.role === 'admin';
  const canViewFinancials = ['admin', 'comptable'].includes(profile.role);

  const vehicleMap = useMemo(() => {
    const map = new Map<string, LookupsData['vehicles'][number]>();
    for (const v of lookups.vehicles) map.set(v.id, v);
    return map;
  }, [lookups.vehicles]);

  const loadTrips = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<Trip[]>('/api/trips');
      setTrips(res);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur chargement missions.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadTrips();
  }, [loadTrips]);

  function openForm(row: Trip | null = null) {
    setEditing(row);
    setReference(row?.reference || '');
    setClientId(row?.client_id || '');
    setTractorIds(row ? getTripTractorIds(row) : []);
    setTrailerId(row?.trailer_id || '');
    setPendingTractorId('');
    setDriverId(row?.driver_id || '');
    setDepartureCityId(row?.departure_city_id || (row?.departure ? '__legacy__' : ''));
    setDestinationCityId(row?.destination_city_id || (row?.destination ? '__legacy__' : ''));
    setDepartureDate(row?.departure_date || '');
    setArrivalDate(row?.arrival_date || '');
    setStatus(row?.status || 'À planifier');
    setRevenue(String(row?.revenue ?? 0));
    setCurrency(row?.currency || 'MAD');
    setModalOpen(true);
  }

  function handleAddTractor(id: string) {
    if (!id || !isAdmin) return;
    setTractorIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setPendingTractorId('');
  }

  function handleRemoveTractor(id: string) {
    if (!isAdmin) return;
    setTractorIds((prev) => prev.filter((item) => item !== id));
  }

  const effectiveTractorIds = useMemo(
    () => (isAdmin ? tractorIds : editing ? getTripTractorIds(editing) : []),
    [isAdmin, tractorIds, editing],
  );
  const effectiveTrailerId = useMemo(
    () => (isAdmin ? trailerId || null : editing?.trailer_id || null),
    [isAdmin, trailerId, editing],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const depCity = lookups.cities.find((c) => c.id === departureCityId);
    const dstCity = lookups.cities.find((c) => c.id === destinationCityId);
    const depName = depCity ? depCity.name : editing?.departure || '';
    const dstName = dstCity ? dstCity.name : editing?.destination || '';

    if (!reference.trim() || !clientId || !driverId || !depName || !dstName) {
      notify('Veuillez remplir référence, client, conducteur, départ et destination.', 'error');
      return;
    }
    if (['À planifier', 'En cours'].includes(status) && (!departureDate || !arrivalDate)) {
      notify(
        'Pour une mission « À planifier » ou « En cours », la date de départ et la date d’arrivée sont obligatoires.',
        'error',
      );
      return;
    }
    if (departureDate && arrivalDate && departureDate > arrivalDate) {
      notify('La date d’arrivée doit être égale ou postérieure à la date de départ.', 'error');
      return;
    }

    const conflictCheck = findTripAssignmentConflict(
      trips,
      {
        id: editing?.id || null,
        vehicle_id: effectiveTractorIds[0] || null,
        tractor_ids: effectiveTractorIds,
        trailer_id: effectiveTrailerId,
        driver_id: driverId || null,
        departure_date: departureDate || null,
        arrival_date: arrivalDate || null,
        status,
      },
      { vehicles: lookups.vehicles, drivers: lookups.drivers },
    );
    if (conflictCheck.hasConflict && conflictCheck.message) {
      notify(conflictCheck.message, 'error');
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        reference: reference.trim(),
        client_id: clientId,
        driver_id: driverId,
        departure: depName,
        destination: dstName,
        departure_city_id: depCity?.id || null,
        destination_city_id: dstCity?.id || null,
        departure_date: departureDate || null,
        arrival_date: arrivalDate || null,
        status,
      };
      if (isAdmin) {
        payload.tractor_ids = tractorIds;
        payload.vehicle_id = tractorIds[0] || null;
        payload.trailer_id = trailerId || null;
        payload.revenue = Number(revenue || 0);
        payload.currency = currency;
      }

      if (editing) {
        await api(`/api/trips/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        notify('Mission mise à jour.', 'success');
      } else {
        await api('/api/trips', { method: 'POST', body: JSON.stringify(payload) });
        notify('Nouvelle mission créée.', 'success');
      }
      setModalOpen(false);
      await onRefreshLookups();
      await loadTrips();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur enregistrement.', 'error');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(trip: Trip) {
    setConfirm({
      open: true,
      title: t('trips.del.title'),
      message: t('trips.del.msg', { ref: trip.reference }),
      confirmLabel: t('common.delete'),
      danger: true,
      onConfirm: async () => {
        try {
          await api(`/api/trips/${trip.id}`, { method: 'DELETE' });
          notify('Mission supprimée.', 'success');
          await onRefreshLookups();
          await loadTrips();
        } catch (err) {
          notify(err instanceof Error ? err.message : 'Erreur suppression.', 'error');
        }
      },
    });
  }

  const activeCities = lookups.cities
    .filter((c) => c.is_active !== false)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  const filtered = useMemo(() => {
    const qNorm = normalizeSearchText(search);
    const qPlate = normalizePlate(search);

    return trips.filter((tr) => {
      if (statusFilter && tr.status !== statusFilter) return false;
      if (!qNorm) return true;

      const clientName = lookups.clients.find((c) => c.id === tr.client_id)?.company_name || '';
      const driverName = lookups.drivers.find((d) => d.id === tr.driver_id)?.full_name || '';

      const unitIds = [
        ...getTripTractorIds(tr),
        ...(tr.trailer_id ? [tr.trailer_id] : []),
      ];
      const unitRegs = unitIds
        .map((id) => vehicleMap.get(id))
        .filter((v): v is NonNullable<typeof v> => Boolean(v));

      const matchesVehicle = unitRegs.some((v) => {
        const raw = normalizeSearchText(`${v.registration} ${v.brand || ''} ${v.vehicle_type || ''}`);
        const plate = normalizePlate(v.registration);
        return raw.includes(qNorm) || (qPlate.length > 0 && plate.includes(qPlate));
      });

      const matchesDriver = normalizeSearchText(driverName).includes(qNorm);

      if (searchScope === 'vehicle') return matchesVehicle;
      if (searchScope === 'driver') return matchesDriver;

      const matchesOther = normalizeSearchText(
        `${tr.reference} ${clientName} ${tr.departure} ${tr.destination} ${tr.status}`,
      ).includes(qNorm);

      return matchesVehicle || matchesDriver || matchesOther;
    });
  }, [trips, statusFilter, search, searchScope, lookups.clients, lookups.drivers, vehicleMap]);

  const statusTone = (s: TripStatus) =>
    s === 'Terminée' ? 'green' : s === 'En cours' ? 'blue' : s === 'Annulée' ? 'red' : 'amber';

  const arrivalRequired = ['À planifier', 'En cours'].includes(status);

  const assignmentConflict = useMemo(() => {
    if (!modalOpen) {
      return {
        hasConflict: false,
        vehicleConflict: null,
        trailerConflict: null,
        driverConflict: null,
        message: null,
      };
    }
    return findTripAssignmentConflict(
      trips,
      {
        id: editing?.id || null,
        vehicle_id: effectiveTractorIds[0] || null,
        tractor_ids: effectiveTractorIds,
        trailer_id: effectiveTrailerId,
        driver_id: driverId || null,
        departure_date: departureDate || null,
        arrival_date: arrivalDate || null,
        status,
      },
      { vehicles: lookups.vehicles, drivers: lookups.drivers },
    );
  }, [
    modalOpen,
    trips,
    editing?.id,
    effectiveTractorIds,
    effectiveTrailerId,
    driverId,
    departureDate,
    arrivalDate,
    status,
    lookups.vehicles,
    lookups.drivers,
  ]);

  const vehicleBusyMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!modalOpen) return map;
    for (const v of lookups.vehicles) {
      const res = findTripAssignmentConflict(
        trips,
        {
          id: editing?.id || null,
          vehicle_id: v.id,
          tractor_ids: [v.id],
          trailer_id: null,
          driver_id: null,
          departure_date: departureDate || null,
          arrival_date: arrivalDate || null,
          status,
        },
        { vehicles: lookups.vehicles, drivers: lookups.drivers },
      );
      if (res.vehicleConflict) {
        map.set(v.id, res.vehicleConflict.conflictingTrip.reference);
      }
    }
    return map;
  }, [modalOpen, trips, editing?.id, departureDate, arrivalDate, status, lookups.vehicles, lookups.drivers]);

  const driverBusyMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!modalOpen) return map;
    for (const d of lookups.drivers) {
      const res = findTripAssignmentConflict(
        trips,
        {
          id: editing?.id || null,
          vehicle_id: null,
          driver_id: d.id,
          departure_date: departureDate || null,
          arrival_date: arrivalDate || null,
          status,
        },
        { vehicles: lookups.vehicles, drivers: lookups.drivers },
      );
      if (res.driverConflict) {
        map.set(d.id, res.driverConflict.conflictingTrip.reference);
      }
    }
    return map;
  }, [modalOpen, trips, editing?.id, departureDate, arrivalDate, status, lookups.vehicles, lookups.drivers]);

  const availableTractors = useMemo(() => {
    const selectedSet = new Set(tractorIds);
    const primary: LookupsData['vehicles'] = [];
    const fallback: LookupsData['vehicles'] = [];
    for (const v of lookups.vehicles) {
      if (selectedSet.has(v.id) || (trailerId && v.id === trailerId)) continue;
      if (isTrailerCategory(inferFleetCategory(v))) {
        fallback.push(v);
      } else {
        primary.push(v);
      }
    }
    return { primary, fallback };
  }, [lookups.vehicles, tractorIds, trailerId]);

  const availableTrailers = useMemo(() => {
    const tractorSet = new Set(tractorIds);
    const trailers: LookupsData['vehicles'] = [];
    const others: LookupsData['vehicles'] = [];
    for (const v of lookups.vehicles) {
      if (tractorSet.has(v.id) && v.id !== trailerId) continue;
      if (isTrailerCategory(inferFleetCategory(v))) {
        trailers.push(v);
      } else {
        others.push(v);
      }
    }
    return { trailers, others };
  }, [lookups.vehicles, tractorIds, trailerId]);

  const hasActiveSearchOrFilter = Boolean(search.trim() || statusFilter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
          {canEdit && (
            <button
              type="button"
              onClick={() => openForm(null)}
              className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white transition-colors whitespace-nowrap"
            >
              {t('trips.new')}
            </button>
          )}
          <div className="relative flex-1 min-w-[230px] max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('trips.search')}
              aria-label={t('trips.search')}
              className="w-full ps-9 pe-8 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                title={t('trips.search_clear')}
                aria-label={t('trips.search_clear')}
                className="absolute end-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <select
            value={searchScope}
            onChange={(e) => setSearchScope(e.target.value as SearchScope)}
            aria-label={t('trips.search_scope_all')}
            className="px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-slate-700 focus:outline-none focus:border-[#2367a5]"
          >
            <option value="all">{t('trips.search_scope_all')}</option>
            <option value="vehicle">{t('trips.search_scope_vehicle')}</option>
            <option value="driver">{t('trips.search_scope_driver')}</option>
          </select>
          {hasActiveSearchOrFilter && (
            <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">
              {t('trips.search_count', { count: filtered.length })}
            </span>
          )}
          {statusFilter && (
            <button
              type="button"
              onClick={onClearFilter}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-200 text-slate-800 hover:bg-slate-300"
            >
              {t('trips.clear_filter', { filter: tripStatusLabel(statusFilter) })}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
          {t('trips.loading')}
        </div>
      ) : trips.length === 0 ? (
        <EmptyState
          title={t('trips.empty_title')}
          description={t('trips.empty_desc')}
          action={
            canEdit && (
              <button
                type="button"
                onClick={() => openForm(null)}
                className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] text-white"
              >
                {t('trips.new')}
              </button>
            )
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={t('trips.search_empty_title')}
          description={t('trips.search_empty_desc')}
          action={
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setSearchScope('all');
                if (statusFilter) onClearFilter();
              }}
              className="px-4 py-2 text-sm font-bold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800"
            >
              {t('trips.search_reset')}
            </button>
          }
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[880px] text-start border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <th className="px-3.5 py-3">{t('trips.col.ref')}</th>
                <th className="px-3.5 py-3">{t('trips.col.client')}</th>
                <th className="px-3.5 py-3">{t('trips.col.tractors')}</th>
                <th className="px-3.5 py-3">{t('trips.col.driver')}</th>
                <th className="px-3.5 py-3">{t('trips.col.route')}</th>
                <th className="px-3.5 py-3">{t('trips.col.dep')}</th>
                <th className="px-3.5 py-3">{t('trips.col.arr')}</th>
                <th className="px-3.5 py-3">{t('common.status')}</th>
                {canViewFinancials && <th className="px-3.5 py-3 text-end">{t('trips.col.rev')}</th>}
                <th className="px-3.5 py-3">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.map((tr) => {
                const cli = lookups.clients.find((c) => c.id === tr.client_id)?.company_name || '—';
                const trTractors = getTripTractorIds(tr)
                  .map((id) => vehicleMap.get(id))
                  .filter((v): v is NonNullable<typeof v> => Boolean(v));
                const trTrailer = tr.trailer_id ? vehicleMap.get(tr.trailer_id) : undefined;
                const trTrailerCat = trTrailer ? inferFleetCategory(trTrailer) : null;
                const drv = lookups.drivers.find((d) => d.id === tr.driver_id)?.full_name || '—';
                return (
                  <tr key={tr.id} className="hover:bg-slate-50/70">
                    <td className="px-3.5 py-2.5 font-bold font-mono text-[#17324d] whitespace-nowrap">
                      {tr.reference}
                    </td>
                    <td className="px-3.5 py-2.5 text-slate-700">{cli}</td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap">
                      <div className="space-y-1">
                        {trTractors.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1">
                            {trTractors.map((v, idx) => (
                              <span
                                key={v.id}
                                className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-[#17324d] bg-slate-100 px-1.5 py-0.5 rounded"
                              >
                                {trTractors.length > 1 && (
                                  <span className="text-[10px] font-sans text-slate-500">#{idx + 1}</span>
                                )}
                                {v.registration}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="font-mono text-slate-400">—</span>
                        )}
                        {trTrailer && trTrailerCat && (
                          <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-800 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded">
                            <span>{t(`veh.cat.${trTrailerCat}`)}:</span>
                            <span className="font-mono">{trTrailer.registration}</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3.5 py-2.5 text-slate-700">{drv}</td>
                    <td className="px-3.5 py-2.5 text-slate-700 whitespace-nowrap">
                      {tr.departure} → {tr.destination}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-slate-600 whitespace-nowrap">
                      {dateText(tr.departure_date, lang)}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-slate-600 whitespace-nowrap">
                      {dateText(tr.arrival_date, lang)}
                    </td>
                    <td className="px-3.5 py-2.5">
                      <StatusText label={tripStatusLabel(tr.status)} tone={statusTone(tr.status)} />
                    </td>
                    {canViewFinancials && (
                      <td className="px-3.5 py-2.5 text-end font-mono font-semibold text-[#17324d] whitespace-nowrap">
                        {money(tr.revenue, tr.currency, lang)}
                      </td>
                    )}
                    <td className="px-3.5 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenDetail(tr.id)}
                          className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                        >
                          {t('trips.detail_btn')}
                        </button>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => openForm(tr)}
                            className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                          >
                            {t('common.edit')}
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => confirmDelete(tr)}
                            className="px-2.5 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-700 font-semibold"
                          >
                            {t('common.delete')}
                          </button>
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

      <Modal
        open={modalOpen}
        title={editing ? t('trips.modal.edit') : t('trips.modal.new')}
        onClose={() => setModalOpen(false)}
        maxWidth="max-w-3xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <InfoBanner>
            <strong>{t('trips.modal.banner_title')}</strong> {t('trips.modal.banner_desc')}
          </InfoBanner>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('trips.col.ref')} *</label>
              <input
                type="text"
                required
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={t('trips.modal.ref_ph')}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('trips.col.client')} *</label>
              <select
                required
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="">{t('common.choose')}</option>
                {lookups.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('trips.col.driver')} *</label>
              <select
                required
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                className={`w-full px-3 py-2 text-sm border rounded-lg bg-white ${
                  assignmentConflict.driverConflict
                    ? 'border-red-500 bg-red-50/40 text-red-900'
                    : 'border-slate-300'
                }`}
              >
                <option value="">{t('common.choose')}</option>
                {lookups.drivers.map((d) => {
                  const busyRef = driverBusyMap.get(d.id);
                  return (
                    <option
                      key={d.id}
                      value={d.id}
                      disabled={Boolean(busyRef) && driverId !== d.id}
                    >
                      {d.full_name}
                      {busyRef ? ` (${t('trips.modal.unavailable')} · ${busyRef})` : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Multi-tractor ordered list */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                {t('trips.modal.tractors_label')}
              </label>
              <div
                className={`border rounded-lg p-3 space-y-2 ${
                  assignmentConflict.vehicleConflict && !assignmentConflict.trailerConflict
                    ? 'border-red-400 bg-red-50/30'
                    : 'border-slate-200 bg-slate-50/60'
                }`}
              >
                {effectiveTractorIds.length === 0 ? (
                  <p className="text-xs text-slate-500">{t('trips.modal.tractor_empty')}</p>
                ) : (
                  <div className="space-y-1.5">
                    {effectiveTractorIds.map((id, idx) => {
                      const v = vehicleMap.get(id);
                      const busyRef = vehicleBusyMap.get(id);
                      const cat = v ? inferFleetCategory(v) : 'tracteur';
                      return (
                        <div
                          key={id}
                          className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs bg-white ${
                            busyRef ? 'border-red-400 bg-red-50/50' : 'border-slate-200'
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <span className="px-1.5 py-0.5 rounded bg-[#17324d] text-white font-bold text-[10px]">
                              #{idx + 1} {idx === 0 ? t('trips.modal.tractor_primary') : t('trips.modal.tractor_relay')}
                            </span>
                            <span className="font-mono font-bold text-[#17324d]">
                              {v?.registration || id}
                            </span>
                            {v?.brand && <span className="text-slate-600">· {v.brand}</span>}
                            <span className="text-[11px] text-slate-500">({t(`veh.cat.${cat}`)})</span>
                            {busyRef && (
                              <span className="text-[11px] font-semibold text-red-700">
                                ({t('trips.modal.unavailable')} · {busyRef})
                              </span>
                            )}
                          </div>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => handleRemoveTractor(id)}
                              title={t('common.delete')}
                              className="p-1 rounded text-slate-400 hover:text-red-700 hover:bg-red-50 shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {isAdmin && (
                  <select
                    value={pendingTractorId}
                    onChange={(e) => handleAddTractor(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">{t('trips.modal.add_tractor')}</option>
                    {availableTractors.primary.length > 0 && (
                      <optgroup label={t('trips.modal.tractor_group')}>
                        {availableTractors.primary.map((v) => {
                          const busyRef = vehicleBusyMap.get(v.id);
                          return (
                            <option key={v.id} value={v.id} disabled={Boolean(busyRef)}>
                              {v.registration}
                              {v.brand ? ` · ${v.brand}` : ''}
                              {busyRef ? ` (${t('trips.modal.unavailable')} · ${busyRef})` : ''}
                            </option>
                          );
                        })}
                      </optgroup>
                    )}
                    {availableTractors.fallback.length > 0 && (
                      <optgroup label={t('trips.modal.other_units_group')}>
                        {availableTractors.fallback.map((v) => {
                          const busyRef = vehicleBusyMap.get(v.id);
                          return (
                            <option key={v.id} value={v.id} disabled={Boolean(busyRef)}>
                              [{t(`veh.cat.${inferFleetCategory(v)}`)}] {v.registration}
                              {v.brand ? ` · ${v.brand}` : ''}
                              {busyRef ? ` (${t('trips.modal.unavailable')} · ${busyRef})` : ''}
                            </option>
                          );
                        })}
                      </optgroup>
                    )}
                  </select>
                )}
              </div>
            </div>

            {/* Single Trailer (Remorque / Frigo / Plateau) selector */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('trips.modal.trailer_label')}
              </label>
              <select
                value={effectiveTrailerId || ''}
                disabled={!isAdmin}
                onChange={(e) => setTrailerId(e.target.value)}
                className={`w-full px-3 py-2 text-sm border rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-500 ${
                  assignmentConflict.trailerConflict
                    ? 'border-red-500 bg-red-50/40 text-red-900'
                    : 'border-slate-300'
                }`}
              >
                <option value="">{t('trips.modal.trailer_none')}</option>
                {availableTrailers.trailers.length > 0 && (
                  <optgroup label={t('trips.modal.trailer_group')}>
                    {availableTrailers.trailers.map((v) => {
                      const busyRef = vehicleBusyMap.get(v.id);
                      const cat = inferFleetCategory(v);
                      return (
                        <option
                          key={v.id}
                          value={v.id}
                          disabled={Boolean(busyRef) && trailerId !== v.id}
                        >
                          [{t(`veh.cat.${cat}`)}] {v.registration}
                          {v.brand ? ` · ${v.brand}` : ''}
                          {busyRef ? ` (${t('trips.modal.unavailable')} · ${busyRef})` : ''}
                        </option>
                      );
                    })}
                  </optgroup>
                )}
                {availableTrailers.others.length > 0 && (
                  <optgroup label={t('trips.modal.other_units_group')}>
                    {availableTrailers.others.map((v) => {
                      const busyRef = vehicleBusyMap.get(v.id);
                      return (
                        <option
                          key={v.id}
                          value={v.id}
                          disabled={Boolean(busyRef) && trailerId !== v.id}
                        >
                          {v.registration}
                          {v.brand ? ` · ${v.brand}` : ''}
                          {busyRef ? ` (${t('trips.modal.unavailable')} · ${busyRef})` : ''}
                        </option>
                      );
                    })}
                  </optgroup>
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.status')} *</label>
              <select
                required
                value={status}
                onChange={(e) => setStatus(e.target.value as TripStatus)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {TRIP_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {tripStatusLabel(s)}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{t('driver.dep')} *</label>
                <select
                  required
                  value={departureCityId}
                  onChange={(e) => setDepartureCityId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">{t('trips.modal.choose_city')}</option>
                  {activeCities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.country_name || ''}
                    </option>
                  ))}
                  {editing && !editing.departure_city_id && editing.departure && (
                    <option value="__legacy__">{editing.departure} ({t('trips.modal.legacy')})</option>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{t('driver.dst')} *</label>
                <select
                  required
                  value={destinationCityId}
                  onChange={(e) => setDestinationCityId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">{t('trips.modal.choose_city')}</option>
                  {activeCities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.country_name || ''}
                    </option>
                  ))}
                  {editing && !editing.destination_city_id && editing.destination && (
                    <option value="__legacy__">{editing.destination} ({t('trips.modal.legacy')})</option>
                  )}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('driver.dep_date')} *</label>
              <input
                type="date"
                required
                value={departureDate}
                onChange={(e) => setDepartureDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('driver.arr_date')}{arrivalRequired ? ' *' : ''}
              </label>
              <input
                type="date"
                required={arrivalRequired}
                value={arrivalDate}
                onChange={(e) => setArrivalDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            {isAdmin && (
              <>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">{t('trips.col.rev')}</label>
                  <input
                    type="number"
                    step="0.01"
                    value={revenue}
                    onChange={(e) => setRevenue(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">{t('trips.modal.rev_currency')}</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as Currency)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="MAD">MAD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
              </>
            )}
          </div>

          {assignmentConflict.hasConflict && assignmentConflict.message && (
            <InfoBanner tone="error">{assignmentConflict.message}</InfoBanner>
          )}

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600 space-y-1">
            <div>{t('trips.modal.tip1')}</div>
            <div>{t('trips.modal.tip2')}</div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving || assignmentConflict.hasConflict}
              className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white disabled:opacity-50"
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
