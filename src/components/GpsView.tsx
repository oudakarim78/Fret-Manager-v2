import React, { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { RefreshCw, Radio } from 'lucide-react';
import type {
  GpsAlert,
  GpsDevice,
  GpsDeviceEvent,
  GpsGeofence,
  GpsPosition,
  GpsTripSummary,
  LookupsData,
  PublicProfile,
} from '../types.ts';
import { api } from '../lib/api.ts';
import { dateTimeText } from '../lib/format.ts';
import { useI18n } from '../lib/i18n.tsx';
import { InfoBanner, Modal, StatusText } from './UI.tsx';

interface GpsOverview {
  devices: GpsDevice[];
  positions: GpsPosition[];
  alerts: GpsAlert[];
  trip_summaries: GpsTripSummary[];
  geofences: GpsGeofence[];
  events: GpsDeviceEvent[];
}

type GpsTab = 'map' | 'devices' | 'alerts' | 'trips' | 'zones' | 'events';

export function GpsView({
  profile,
  lookups,
  notify,
}: {
  profile: PublicProfile;
  lookups: LookupsData;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t, lang, entityStatusLabel, alertSeverityLabel } = useI18n();
  const [tab, setTab] = useState<GpsTab>('map');
  const [data, setData] = useState<GpsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);

  // Device form
  const [devModal, setDevModal] = useState(false);
  const [editingDev, setEditingDev] = useState<GpsDevice | null>(null);
  const [gdVehicle, setGdVehicle] = useState('');
  const [gdName, setGdName] = useState('');
  const [gdProvider, setGdProvider] = useState('');
  const [gdImei, setGdImei] = useState('');
  const [gdPid, setGdPid] = useState('');
  const [gdStatus, setGdStatus] = useState<GpsDevice['status']>('inactive');
  const [gdDate, setGdDate] = useState('');

  // Geofence form
  const [zoneModal, setZoneModal] = useState(false);
  const [editingZone, setEditingZone] = useState<GpsGeofence | null>(null);
  const [gzName, setGzName] = useState('');
  const [gzDesc, setGzDesc] = useState('');
  const [gzGeo, setGzGeo] = useState('');
  const [gzActive, setGzActive] = useState(true);
  const [gzEntry, setGzEntry] = useState(false);
  const [gzExit, setGzExit] = useState(true);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  const isAdmin = profile.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<GpsOverview>('/api/gps/overview'));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur chargement GPS.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const latestMap = new Map<string, GpsPosition>();
  (data?.positions || []).forEach((p) => {
    if (!latestMap.has(p.vehicle_id)) latestMap.set(p.vehicle_id, p);
  });

  // Render Leaflet map when on 'map' tab
  useEffect(() => {
    if (tab !== 'map' || !data || !mapContainerRef.current) return;
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const map = L.map(mapContainerRef.current).setView([33.5731, -7.5898], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map);

    const bounds: L.LatLngTuple[] = [];
    latestMap.forEach((pos) => {
      const veh = lookups.vehicles.find((v) => v.id === pos.vehicle_id);
      const markerIcon = L.divIcon({
        className: 'custom-truck-marker',
        html: `<div style="background:#17324d;color:#fff;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);white-space:nowrap">${veh?.registration || 'GPS'}</div>`,
        iconSize: [96, 28],
        iconAnchor: [48, 14],
      });
      const marker = L.marker([pos.latitude, pos.longitude], { icon: markerIcon }).addTo(map);
      marker.bindPopup(
        `<b>${veh?.registration || t('trips.col.vehicle')}</b><br>${t('gps.map.popup_speed')} : ${pos.speed_kmh ?? '—'} km/h<br>${dateTimeText(pos.recorded_at, lang)}`,
      );
      bounds.push([pos.latitude, pos.longitude]);
    });

    // Draw active geofences
    (data.geofences || [])
      .filter((g) => g.is_active)
      .forEach((g) => {
        try {
          L.geoJSON(g.geometry_json as GeoJSON.GeoJsonObject, {
            style: { color: '#2367a5', weight: 2, fillOpacity: 0.12 },
          })
            .bindPopup(`<b>${t('gps.map.popup_zone')} : ${g.name}</b><br>${g.description || ''}`)
            .addTo(map);
        } catch {
          // ignore malformed geojson
        }
      });

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [35, 35], maxZoom: 11 });
    }
    setTimeout(() => map.invalidateSize(), 120);
    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [tab, data, lookups.vehicles, t, lang]);

  async function handleSimulatePing() {
    setSimulating(true);
    try {
      await api('/api/gps/simulate', { method: 'POST' });
      notify(t('common.save'), 'success');
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Simulation impossible.', 'error');
    } finally {
      setSimulating(false);
    }
  }

  function openDeviceForm(row: GpsDevice | null = null) {
    setEditingDev(row);
    setGdVehicle(row?.vehicle_id || '');
    setGdName(row?.device_name || '');
    setGdProvider(row?.provider || '');
    setGdImei(row?.imei || '');
    setGdPid(row?.provider_device_id || '');
    setGdStatus(row?.status || 'inactive');
    setGdDate(row?.installed_at || '');
    setDevModal(true);
  }

  async function saveDevice(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        vehicle_id: gdVehicle,
        device_name: gdName.trim() || null,
        provider: gdProvider.trim() || null,
        imei: gdImei.trim() || null,
        provider_device_id: gdPid.trim() || null,
        status: gdStatus,
        installed_at: gdDate || null,
      };
      if (editingDev) {
        await api(`/api/gps/devices/${editingDev.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/api/gps/devices', { method: 'POST', body: JSON.stringify(payload) });
      }
      notify(t('common.save'), 'success');
      setDevModal(false);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur boîtier.', 'error');
    }
  }

  function openZoneForm(row: GpsGeofence | null = null) {
    setEditingZone(row);
    setGzName(row?.name || '');
    setGzDesc(row?.description || '');
    setGzGeo(
      row
        ? JSON.stringify(row.geometry_json, null, 2)
        : JSON.stringify(
            {
              type: 'Polygon',
              coordinates: [
                [
                  [-7.62, 33.56],
                  [-7.55, 33.56],
                  [-7.55, 33.61],
                  [-7.62, 33.61],
                  [-7.62, 33.56],
                ],
              ],
            },
            null,
            2,
          ),
    );
    setGzActive(row?.is_active ?? true);
    setGzEntry(row?.alert_on_entry ?? false);
    setGzExit(row?.alert_on_exit ?? true);
    setZoneModal(true);
  }

  async function saveZone(e: React.FormEvent) {
    e.preventDefault();
    try {
      const parsed = JSON.parse(gzGeo);
      if (!['Polygon', 'MultiPolygon'].includes(parsed?.type)) {
        throw new Error('Polygon / MultiPolygon');
      }
      const payload = {
        name: gzName.trim(),
        description: gzDesc.trim() || null,
        geometry_json: parsed,
        is_active: gzActive,
        alert_on_entry: gzEntry,
        alert_on_exit: gzExit,
      };
      if (editingZone) {
        await api(`/api/gps/geofences/${editingZone.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/api/gps/geofences', { method: 'POST', body: JSON.stringify(payload) });
      }
      notify(t('common.save'), 'success');
      setZoneModal(false);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'GeoJSON invalide.', 'error');
    }
  }

  if (loading || !data) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
        {t('common.loading')}
      </div>
    );
  }

  const online = data.devices.filter(
    (x) =>
      x.status === 'active' &&
      x.last_seen_at &&
      Date.now() - new Date(x.last_seen_at).getTime() < 600000,
  ).length;

  const tabs: Array<[GpsTab, string]> = [
    ['map', t('gps.tab.map')],
    ['devices', t('gps.tab.devices')],
    ['alerts', t('gps.tab.alerts')],
    ['trips', t('gps.tab.trips')],
    ['zones', t('gps.tab.zones')],
    ['events', t('gps.tab.events')],
  ];

  return (
    <div className="space-y-4">
      <InfoBanner>{t('gps.banner')}</InfoBanner>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">{t('gps.kpi.devices')}</div>
          <div className="text-2xl font-extrabold font-mono text-[#17324d] mt-1 tabular-nums">
            {data.devices.length}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">{t('gps.kpi.online')}</div>
          <div className="text-2xl font-extrabold font-mono text-[#17324d] mt-1 tabular-nums">
            {online}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">{t('gps.kpi.located')}</div>
          <div className="text-2xl font-extrabold font-mono text-[#17324d] mt-1 tabular-nums">
            {latestMap.size}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">{t('gps.kpi.alerts')}</div>
          <div className="text-2xl font-extrabold font-mono text-[#17324d] mt-1 tabular-nums">
            {data.alerts.filter((a) => !a.acknowledged).length}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 bg-slate-200/70 p-1 rounded-lg w-fit">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              tab === id ? 'bg-white text-[#17324d] shadow-sm' : 'text-slate-600 hover:text-[#17324d]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'map' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-[#17324d]">{t('gps.map.title')}</h2>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={simulating}
                onClick={handleSimulatePing}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white disabled:opacity-50"
              >
                <Radio className="w-3.5 h-3.5" />
                {simulating ? t('gps.map.simulating') : t('gps.map.simulate')}
              </button>
              <button
                type="button"
                onClick={load}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {t('gps.map.refresh')}
              </button>
            </div>
          </div>

          <div
            ref={mapContainerRef}
            className="w-full h-[420px] rounded-xl border border-slate-200 bg-slate-100"
          />

          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full min-w-[680px] text-start border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                  <th className="px-4 py-2.5">{t('trips.col.vehicle')}</th>
                  <th className="px-4 py-2.5">{t('gps.map.pos')}</th>
                  <th className="px-4 py-2.5">{t('gps.map.speed')}</th>
                  <th className="px-4 py-2.5">{t('gps.map.last')}</th>
                  <th className="px-4 py-2.5">{t('driver.mission_label')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Array.from(latestMap.values()).map((pos) => {
                  const v = lookups.vehicles.find((z) => z.id === pos.vehicle_id);
                  const d = data.devices.find((z) => z.vehicle_id === pos.vehicle_id);
                  const tr = lookups.trips.find((z) => z.id === pos.trip_id);
                  return (
                    <tr key={pos.id}>
                      <td className="px-4 py-2.5 font-mono font-bold text-[#17324d]">
                        {v?.registration || pos.vehicle_id}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-700">
                        {pos.latitude.toFixed(5)}, {pos.longitude.toFixed(5)} ·{' '}
                        {dateTimeText(pos.recorded_at, lang)}
                      </td>
                      <td className="px-4 py-2.5 font-mono">
                        {pos.speed_kmh == null ? '—' : `${pos.speed_kmh} km/h`}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-600">
                        {dateTimeText(d?.last_seen_at, lang)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-700">{tr?.reference || '—'}</td>
                    </tr>
                  );
                })}
                {latestMap.size === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                      {t('gps.map.empty')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'devices' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#17324d]">{t('gps.dev.title')}</h2>
            {isAdmin && (
              <button
                type="button"
                onClick={() => openDeviceForm(null)}
                className="px-3.5 py-2 text-xs font-bold rounded-lg bg-[#2367a5] text-white"
              >
                {t('gps.dev.add')}
              </button>
            )}
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full min-w-[780px] text-start border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                  <th className="px-3.5 py-2.5">{t('trips.col.vehicle')}</th>
                  <th className="px-3.5 py-2.5">{t('gps.dev.name')}</th>
                  <th className="px-3.5 py-2.5">{t('gps.dev.provider')}</th>
                  <th className="px-3.5 py-2.5">IMEI</th>
                  <th className="px-3.5 py-2.5">{t('gps.dev.pid')}</th>
                  <th className="px-3.5 py-2.5">{t('common.status')}</th>
                  <th className="px-3.5 py-2.5">{t('gps.map.last')}</th>
                  <th className="px-3.5 py-2.5">{t('common.action')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.devices.map((d) => (
                  <tr key={d.id}>
                    <td className="px-3.5 py-2.5 font-mono font-bold text-[#17324d]">
                      {lookups.vehicles.find((v) => v.id === d.vehicle_id)?.registration || d.vehicle_id}
                    </td>
                    <td className="px-3.5 py-2.5">{d.device_name || '—'}</td>
                    <td className="px-3.5 py-2.5">{d.provider || '—'}</td>
                    <td className="px-3.5 py-2.5 font-mono">{d.imei || '—'}</td>
                    <td className="px-3.5 py-2.5 font-mono">{d.provider_device_id || '—'}</td>
                    <td className="px-3.5 py-2.5">
                      <StatusText
                        label={entityStatusLabel(d.status)}
                        tone={
                          d.status === 'active'
                            ? 'green'
                            : d.status === 'maintenance'
                              ? 'amber'
                              : 'neutral'
                        }
                      />
                    </td>
                    <td className="px-3.5 py-2.5 font-mono">{dateTimeText(d.last_seen_at, lang)}</td>
                    <td className="px-3.5 py-2.5">
                      {isAdmin ? (
                        <button
                          type="button"
                          onClick={() => openDeviceForm(d)}
                          className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 font-semibold"
                        >
                          {t('common.edit')}
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'alerts' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[740px] text-start border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                <th className="px-3.5 py-2.5">{t('alerts.col.level')}</th>
                <th className="px-3.5 py-2.5">{t('trips.col.vehicle')}</th>
                <th className="px-3.5 py-2.5">{t('common.type')}</th>
                <th className="px-3.5 py-2.5">{t('gps.alt.event')}</th>
                <th className="px-3.5 py-2.5">{t('common.date')}</th>
                <th className="px-3.5 py-2.5">{t('common.status')}</th>
                <th className="px-3.5 py-2.5">{t('common.action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.alerts.map((a) => (
                <tr key={a.id}>
                  <td className="px-3.5 py-2.5">
                    <StatusText
                      label={alertSeverityLabel(a.severity)}
                      tone={a.severity === 'critical' || a.severity === 'high' ? 'red' : 'amber'}
                    />
                  </td>
                  <td className="px-3.5 py-2.5 font-mono font-bold">
                    {lookups.vehicles.find((v) => v.id === a.vehicle_id)?.registration || a.vehicle_id}
                  </td>
                  <td className="px-3.5 py-2.5 font-mono">{a.alert_type}</td>
                  <td className="px-3.5 py-2.5">
                    <div className="font-bold text-[#17324d]">{a.title}</div>
                    <div className="text-slate-500">{a.description}</div>
                  </td>
                  <td className="px-3.5 py-2.5 font-mono">{dateTimeText(a.occurred_at, lang)}</td>
                  <td className="px-3.5 py-2.5">
                    {a.acknowledged ? t('gps.alt.ack') : t('gps.alt.unack')}
                  </td>
                  <td className="px-3.5 py-2.5">
                    {!a.acknowledged ? (
                      <button
                        type="button"
                        onClick={async () => {
                          await api(`/api/gps/alerts/${a.id}/acknowledge`, { method: 'POST' });
                          notify(t('gps.alt.ack'), 'success');
                          await load();
                        }}
                        className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 font-semibold"
                      >
                        {t('gps.alt.mark')}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'trips' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[740px] text-start border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                <th className="px-3.5 py-2.5">{t('driver.mission_label')}</th>
                <th className="px-3.5 py-2.5">{t('trips.col.vehicle')}</th>
                <th className="px-3.5 py-2.5">{t('gps.trp.dist')}</th>
                <th className="px-3.5 py-2.5">{t('gps.trp.drive')}</th>
                <th className="px-3.5 py-2.5">{t('gps.trp.stop')}</th>
                <th className="px-3.5 py-2.5">{t('gps.trp.stops')}</th>
                <th className="px-3.5 py-2.5">{t('gps.trp.start')}</th>
                <th className="px-3.5 py-2.5">{t('gps.trp.end')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.trip_summaries.map((s) => (
                <tr key={s.id}>
                  <td className="px-3.5 py-2.5 font-mono font-bold text-[#17324d]">
                    {lookups.trips.find((tr) => tr.id === s.trip_id)?.reference || s.trip_id}
                  </td>
                  <td className="px-3.5 py-2.5 font-mono">
                    {lookups.vehicles.find((v) => v.id === s.vehicle_id)?.registration || s.vehicle_id}
                  </td>
                  <td className="px-3.5 py-2.5 font-mono">{s.distance_km} km</td>
                  <td className="px-3.5 py-2.5 font-mono">{s.driving_duration_minutes} min</td>
                  <td className="px-3.5 py-2.5 font-mono">{s.stopped_duration_minutes} min</td>
                  <td className="px-3.5 py-2.5 font-mono">{s.stop_count}</td>
                  <td className="px-3.5 py-2.5 font-mono">{dateTimeText(s.started_at, lang)}</td>
                  <td className="px-3.5 py-2.5 font-mono">{dateTimeText(s.ended_at, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'zones' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#17324d]">{t('gps.zon.title')}</h2>
            {isAdmin && (
              <button
                type="button"
                onClick={() => openZoneForm(null)}
                className="px-3.5 py-2 text-xs font-bold rounded-lg bg-[#2367a5] text-white"
              >
                {t('gps.zon.add')}
              </button>
            )}
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-start border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                  <th className="px-3.5 py-2.5">{t('gps.zon.zone')}</th>
                  <th className="px-3.5 py-2.5">{t('common.description')}</th>
                  <th className="px-3.5 py-2.5">{t('gps.zon.active')}</th>
                  <th className="px-3.5 py-2.5">{t('gps.zon.entry')}</th>
                  <th className="px-3.5 py-2.5">{t('gps.zon.exit')}</th>
                  <th className="px-3.5 py-2.5">{t('common.action')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.geofences.map((z) => (
                  <tr key={z.id}>
                    <td className="px-3.5 py-2.5 font-bold text-[#17324d]">{z.name}</td>
                    <td className="px-3.5 py-2.5 text-slate-600">{z.description || '—'}</td>
                    <td className="px-3.5 py-2.5">{z.is_active ? t('common.yes') : t('common.no')}</td>
                    <td className="px-3.5 py-2.5">
                      {z.alert_on_entry ? t('common.yes') : t('common.no')}
                    </td>
                    <td className="px-3.5 py-2.5">
                      {z.alert_on_exit ? t('common.yes') : t('common.no')}
                    </td>
                    <td className="px-3.5 py-2.5">
                      {isAdmin ? (
                        <button
                          type="button"
                          onClick={() => openZoneForm(z)}
                          className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 font-semibold"
                        >
                          {t('common.edit')}
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'events' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-start border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                <th className="px-3.5 py-2.5">{t('common.date')}</th>
                <th className="px-3.5 py-2.5">{t('trips.col.vehicle')}</th>
                <th className="px-3.5 py-2.5">{t('gps.alt.event')}</th>
                <th className="px-3.5 py-2.5">{t('gps.evt.details')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.events.map((ev) => (
                <tr key={ev.id}>
                  <td className="px-3.5 py-2.5 font-mono">{dateTimeText(ev.occurred_at, lang)}</td>
                  <td className="px-3.5 py-2.5 font-mono font-bold">
                    {lookups.vehicles.find((v) => v.id === ev.vehicle_id)?.registration ||
                      ev.vehicle_id ||
                      '—'}
                  </td>
                  <td className="px-3.5 py-2.5 font-mono">{ev.event_type}</td>
                  <td className="px-3.5 py-2.5 text-slate-600">{ev.details || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* GPS Device Modal */}
      <Modal
        open={devModal}
        title={editingDev ? t('gps.dev.modal_edit') : t('gps.dev.modal_add')}
        onClose={() => setDevModal(false)}
        maxWidth="max-w-lg"
      >
        <form onSubmit={saveDevice} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('trips.col.vehicle')} *
              </label>
              <select
                required
                value={gdVehicle}
                onChange={(e) => setGdVehicle(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="">{t('common.choose')}</option>
                {lookups.vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registration} · {v.brand || ''} {v.model || ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('gps.dev.name')}</label>
              <input
                value={gdName}
                onChange={(e) => setGdName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('gps.dev.provider')}
              </label>
              <input
                value={gdProvider}
                onChange={(e) => setGdProvider(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">IMEI</label>
              <input
                value={gdImei}
                onChange={(e) => setGdImei(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('gps.dev.pid')}</label>
              <input
                value={gdPid}
                onChange={(e) => setGdPid(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.status')}</label>
              <select
                value={gdStatus}
                onChange={(e) => setGdStatus(e.target.value as GpsDevice['status'])}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="inactive">{entityStatusLabel('inactive')}</option>
                <option value="active">{entityStatusLabel('active')}</option>
                <option value="maintenance">{entityStatusLabel('maintenance')}</option>
                <option value="offline">{entityStatusLabel('offline')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('gps.dev.install_date')}
              </label>
              <input
                type="date"
                value={gdDate}
                onChange={(e) => setGdDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDevModal(false)}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700"
            >
              {t('common.cancel')}
            </button>
            <button type="submit" className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] text-white">
              {t('common.save')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Geofence Modal */}
      <Modal
        open={zoneModal}
        title={editingZone ? t('gps.zon.modal_edit') : t('gps.zon.modal_add')}
        onClose={() => setZoneModal(false)}
        maxWidth="max-w-xl"
      >
        <form onSubmit={saveZone} className="space-y-4">
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('gps.zon.zone')} *
              </label>
              <input
                required
                value={gzName}
                onChange={(e) => setGzName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('common.description')}
              </label>
              <textarea
                value={gzDesc}
                onChange={(e) => setGzDesc(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                GeoJSON Polygon / MultiPolygon *
              </label>
              <textarea
                required
                value={gzGeo}
                onChange={(e) => setGzGeo(e.target.value)}
                rows={7}
                dir="ltr"
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {t('gps.zon.active')}
                </label>
                <select
                  value={gzActive ? 'true' : 'false'}
                  onChange={(e) => setGzActive(e.target.value === 'true')}
                  className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="true">{t('common.yes')}</option>
                  <option value="false">{t('common.no')}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {t('gps.zon.entry')}
                </label>
                <select
                  value={gzEntry ? 'true' : 'false'}
                  onChange={(e) => setGzEntry(e.target.value === 'true')}
                  className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="true">{t('common.yes')}</option>
                  <option value="false">{t('common.no')}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {t('gps.zon.exit')}
                </label>
                <select
                  value={gzExit ? 'true' : 'false'}
                  onChange={(e) => setGzExit(e.target.value === 'true')}
                  className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="true">{t('common.yes')}</option>
                  <option value="false">{t('common.no')}</option>
                </select>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setZoneModal(false)}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700"
            >
              {t('common.cancel')}
            </button>
            <button type="submit" className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] text-white">
              {t('common.save')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
