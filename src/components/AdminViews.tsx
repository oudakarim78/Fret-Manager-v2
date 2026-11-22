import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Stamp } from 'lucide-react';
import type {
  AuditLog,
  City,
  ClientProposal,
  CompanySettings,
  Country,
  LookupsData,
  PublicProfile,
  Role,
} from '../types.ts';
import { api, readFileAsBase64 } from '../lib/api.ts';
import { dateTimeText } from '../lib/format.ts';
import { useI18n } from '../lib/i18n.tsx';
import { CompanyStamp } from './CompanyStamp.tsx';
import {
  ConfirmDialog,
  type ConfirmState,
  EmptyState,
  InfoBanner,
  Modal,
  StatusText,
} from './UI.tsx';

// ======================== VALIDATION CLIENTS ========================
export function ProposalsValidationView({
  lookups,
  onRefreshLookups,
  notify,
}: {
  lookups: LookupsData;
  onRefreshLookups: () => Promise<void>;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t, lang, proposalStatusLabel } = useI18n();
  const [list, setList] = useState<ClientProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refuseTarget, setRefuseTarget] = useState<ClientProposal | null>(null);
  const [refuseNote, setRefuseNote] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await api<ClientProposal[]>('/api/client-proposals'));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur chargement propositions.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
        {t('common.loading')}
      </div>
    );
  }

  if (list.length === 0) {
    return <EmptyState title={t('adm.prop.empty_title')} description={t('adm.prop.empty_desc')} />;
  }

  return (
    <div className="space-y-4">
      {list.map((x) => {
        const drvName = lookups.drivers.find((d) => d.id === x.driver_id)?.full_name || x.driver_id;
        return (
          <div key={x.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-[#17324d]">{x.company_name}</h2>
              <StatusText
                label={proposalStatusLabel(x.status)}
                tone={x.status === 'approuvee' ? 'green' : x.status === 'refusee' ? 'red' : 'amber'}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
              <div className="bg-slate-50 rounded-lg p-2.5">
                <div className="text-[11px] text-slate-500">{t('cli.col.contact')}</div>
                <div className="font-bold">{x.contact_name || '—'}</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-2.5">
                <div className="text-[11px] text-slate-500">{t('common.phone')}</div>
                <div className="font-mono font-bold">{x.phone}</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-2.5">
                <div className="text-[11px] text-slate-500">{t('common.email')}</div>
                <div className="font-bold break-all">{x.email}</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-2.5">
                <div className="text-[11px] text-slate-500">{t('common.ice')}</div>
                <div className="font-mono font-bold">{x.ice}</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-2.5">
                <div className="text-[11px] text-slate-500">{t('common.address')}</div>
                <div className="font-bold">{x.address}</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-2.5">
                <div className="text-[11px] text-slate-500">{t('trips.col.driver')}</div>
                <div className="font-bold">{drvName}</div>
              </div>
            </div>

            {x.admin_notes && (
              <div className="text-xs text-slate-700">
                <strong>{t('common.notes')} :</strong> {x.admin_notes}
              </div>
            )}
            <div className="text-xs text-slate-400 font-mono">
              {t('adm.prop.date', { date: dateTimeText(x.created_at, lang) })}
            </div>

            {x.status === 'en_attente' && (
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    setConfirm({
                      open: true,
                      title: t('adm.prop.approve'),
                      message: t('adm.prop.approve_msg', { name: x.company_name, ice: x.ice }),
                      confirmLabel: t('adm.prop.approve_btn'),
                      onConfirm: async () => {
                        try {
                          await api(`/api/client-proposals/${x.id}/review`, {
                            method: 'POST',
                            body: JSON.stringify({ decision: 'approuvee', admin_notes: null }),
                          });
                          notify(t('common.save'), 'success');
                          await onRefreshLookups();
                          await load();
                        } catch (err) {
                          notify(err instanceof Error ? err.message : 'Erreur validation.', 'error');
                        }
                      },
                    })
                  }
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white"
                >
                  {t('adm.prop.approve')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRefuseTarget(x);
                    setRefuseNote('');
                  }}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-red-50 hover:bg-red-100 text-red-700"
                >
                  {t('adm.prop.refuse')}
                </button>
              </div>
            )}
          </div>
        );
      })}

      <Modal
        open={!!refuseTarget}
        title={refuseTarget ? `${t('adm.prop.refuse')} · ${refuseTarget.company_name}` : ''}
        onClose={() => setRefuseTarget(null)}
        maxWidth="max-w-md"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!refuseTarget) return;
            try {
              await api(`/api/client-proposals/${refuseTarget.id}/review`, {
                method: 'POST',
                body: JSON.stringify({ decision: 'refusee', admin_notes: refuseNote.trim() || null }),
              });
              notify(t('adm.prop.refuse'), 'info');
              setRefuseTarget(null);
              await load();
            } catch (err) {
              notify(err instanceof Error ? err.message : 'Erreur refus.', 'error');
            }
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {t('adm.prop.refuse_reason')}
            </label>
            <textarea
              value={refuseNote}
              onChange={(e) => setRefuseNote(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRefuseTarget(null)}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700"
            >
              {t('common.cancel')}
            </button>
            <button type="submit" className="px-4 py-2 text-sm font-bold rounded-lg bg-red-700 text-white">
              {t('adm.prop.refuse_confirm')}
            </button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

// ======================== UTILISATEURS ========================
export function UsersAdminView({
  lookups,
  onRefreshLookups,
  notify,
}: {
  lookups: LookupsData;
  onRefreshLookups: () => Promise<void>;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t, roleLabel } = useI18n();
  const [users, setUsers] = useState<PublicProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PublicProfile | null>(null);

  // New user form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newRole, setNewRole] = useState<Role>('logistique');
  const [newDriver, setNewDriver] = useState('');
  const [newActive, setNewActive] = useState(true);

  // Edit user modal
  const [eName, setEName] = useState('');
  const [eRole, setERole] = useState<Role>('logistique');
  const [eDriver, setEDriver] = useState('');
  const [eActive, setEActive] = useState(true);
  const [ePass, setEPass] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await api<PublicProfile[]>('/api/users'));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur chargement utilisateurs.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  function openEdit(u: PublicProfile) {
    setEditing(u);
    setEName(u.full_name || '');
    setERole(u.role);
    setEDriver(u.driver_id || '');
    setEActive(u.active);
    setEPass('');
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          full_name: newName.trim(),
          email: newEmail.trim(),
          password: newPass,
          role: newRole,
          driver_id: newDriver || null,
          active: newActive,
        }),
      });
      setNewName('');
      setNewEmail('');
      setNewPass('');
      setNewDriver('');
      notify(t('common.save'), 'success');
      await onRefreshLookups();
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur création utilisateur.', 'error');
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    try {
      await api(`/api/users/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          full_name: eName.trim(),
          role: eRole,
          driver_id: eDriver || null,
          active: eActive,
          password: ePass.trim() || undefined,
        }),
      });
      setEditing(null);
      notify(t('common.save'), 'success');
      await onRefreshLookups();
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur mise à jour.', 'error');
    }
  }

  return (
    <div className="space-y-5">
      <InfoBanner>{t('adm.usr.banner')}</InfoBanner>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
          {t('common.loading')}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[700px] text-start border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                <th className="px-4 py-3">{t('auth.reg.fullname')}</th>
                <th className="px-4 py-3">{t('common.email')}</th>
                <th className="px-4 py-3">{t('auth.reg.role')}</th>
                <th className="px-4 py-3">{t('trips.col.driver')}</th>
                <th className="px-4 py-3">{t('common.active')}</th>
                <th className="px-4 py-3">{t('common.action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => {
                const drv = lookups.drivers.find((d) => d.id === u.driver_id)?.full_name || '—';
                return (
                  <tr key={u.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-bold text-[#17324d]">{u.full_name}</td>
                    <td className="px-4 py-3 font-mono text-slate-600">{u.email}</td>
                    <td className="px-4 py-3 font-semibold">{roleLabel(u.role)}</td>
                    <td className="px-4 py-3">
                      {u.role === 'conducteur' && !u.driver_id ? (
                        <StatusText label="Non lié" tone="red" />
                      ) : (
                        drv
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText
                        label={u.active ? t('common.yes') : t('common.no')}
                        tone={u.active ? 'green' : 'red'}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => openEdit(u)}
                        className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 font-semibold"
                      >
                        {t('common.edit')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h2 className="text-base font-bold text-[#17324d]">{t('adm.usr.add_title')}</h2>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('auth.reg.fullname')}
              </label>
              <input
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('auth.reg.email')}
              </label>
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('adm.usr.pass')}
              </label>
              <input
                type="password"
                required
                minLength={4}
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('auth.reg.role')}
              </label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as Role)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {(['admin', 'logistique', 'comptable', 'conducteur'] as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('trips.col.driver')}
              </label>
              <select
                value={newDriver}
                onChange={(e) => setNewDriver(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="">{t('adm.usr.auto_none')}</option>
                {lookups.drivers.map((d) => {
                  const linkedUser = users.find((u) => u.driver_id === d.id);
                  return (
                    <option key={d.id} value={d.id}>
                      {d.full_name}{linkedUser ? ` · ${linkedUser.email}` : ''}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.active')}</label>
              <select
                value={newActive ? 'true' : 'false'}
                onChange={(e) => setNewActive(e.target.value === 'true')}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="true">{t('common.yes')}</option>
                <option value="false">{t('common.no')}</option>
              </select>
            </div>
          </div>
          <button type="submit" className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] text-white">
            {t('adm.usr.create')}
          </button>
        </form>
      </div>

      <Modal
        open={!!editing}
        title={t('adm.usr.edit_title')}
        onClose={() => setEditing(null)}
        maxWidth="max-w-lg"
      >
        {editing && (
          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.email')}</label>
                <input
                  disabled
                  value={editing.email}
                  className="w-full px-3 py-2 text-sm border border-slate-200 bg-slate-100 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {t('auth.reg.fullname')}
                </label>
                <input
                  required
                  value={eName}
                  onChange={(e) => setEName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {t('auth.reg.role')}
                </label>
                <select
                  value={eRole}
                  onChange={(e) => setERole(e.target.value as Role)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {(['admin', 'logistique', 'comptable', 'conducteur'] as Role[]).map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {t('trips.col.driver')}
                </label>
                <select
                  value={eDriver}
                  onChange={(e) => setEDriver(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">{t('common.none')}</option>
                  {lookups.drivers.map((d) => {
                    const linkedUser = users.find((u) => u.driver_id === d.id && u.id !== editing?.id);
                    return (
                      <option key={d.id} value={d.id}>
                        {d.full_name}{linkedUser ? ` · ${linkedUser.email}` : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {t('adm.usr.new_pass')}
                </label>
                <input
                  type="password"
                  value={ePass}
                  onChange={(e) => setEPass(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.active')}</label>
                <select
                  value={eActive ? 'true' : 'false'}
                  onChange={(e) => setEActive(e.target.value === 'true')}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="true">{t('common.yes')}</option>
                  <option value="false">{t('common.no')}</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700"
              >
                {t('common.cancel')}
              </button>
              <button type="submit" className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] text-white">
                {t('common.save')}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

// ======================== JOURNAL DES ACTIONS ========================
export function AuditLogsView({
  notify,
}: {
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t, lang } = useI18n();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<AuditLog[]>('/api/audit-logs')
      .then(setLogs)
      .catch((err) => notify(err instanceof Error ? err.message : 'Erreur chargement journal.', 'error'))
      .finally(() => setLoading(false));
  }, [notify]);

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
        {t('common.loading')}
      </div>
    );
  }

  if (logs.length === 0) {
    return <EmptyState title={t('adm.aud.empty')} />;
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
      <table className="w-full min-w-[760px] text-start border-collapse text-xs">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
            <th className="px-4 py-3">{t('common.date')}</th>
            <th className="px-4 py-3">{t('adm.aud.user')}</th>
            <th className="px-4 py-3">{t('common.action')}</th>
            <th className="px-4 py-3">{t('adm.aud.table')}</th>
            <th className="px-4 py-3">{t('adm.aud.rec')}</th>
            <th className="px-4 py-3">{t('gps.evt.details')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {logs.map((x) => (
            <tr key={x.id}>
              <td className="px-4 py-2.5 font-mono text-slate-600 whitespace-nowrap">
                {dateTimeText(x.created_at, lang)}
              </td>
              <td className="px-4 py-2.5 font-semibold text-[#17324d]">{x.user_name || x.user_id}</td>
              <td className="px-4 py-2.5 font-mono font-bold">{x.action}</td>
              <td className="px-4 py-2.5 font-mono text-slate-600">{x.table_name}</td>
              <td className="px-4 py-2.5 font-mono text-slate-500">{x.record_id}</td>
              <td className="px-4 py-2.5 font-mono text-[11px] text-slate-600">
                {JSON.stringify(x.details || {})}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ======================== PARAMÈTRES DE L'ENTREPRISE ========================
export function CompanySettingsView({
  notify,
}: {
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<CompanySettings | null>(null);
  const [saving, setSaving] = useState(false);
  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [sigDrawing, setSigDrawing] = useState(false);
  const [sigHasInk, setSigHasInk] = useState(false);

  useEffect(() => {
    api<CompanySettings>('/api/company-settings')
      .then((res) =>
        setForm({
          ...res,
          stamp_enabled: res.stamp_enabled !== false,
          stamp_style: res.stamp_style === 'round' ? 'round' : 'rectangular',
          stamp_color: res.stamp_color || '#17365d',
          stamp_signatory_name: res.stamp_signatory_name || '',
          stamp_signatory_title: res.stamp_signatory_title || 'Direction Générale',
          stamp_signature_url: res.stamp_signature_url || '',
        }),
      )
      .catch((err) => notify(err instanceof Error ? err.message : 'Erreur chargement paramètres.', 'error'));
  }, [notify]);

  if (!form) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
        {t('common.loading')}
      </div>
    );
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notify('PNG / JPG / WEBP', 'error');
      return;
    }
    if (file.size > 1024 * 1024) {
      notify('Max 1 MB', 'error');
      return;
    }
    const b64 = await readFileAsBase64(file);
    setForm((prev) => (prev ? { ...prev, logo_url: b64 } : prev));
    notify(t('adm.cmp.save'), 'info');
  }

  async function handleSignatureFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notify('PNG / JPG / WEBP', 'error');
      return;
    }
    if (file.size > 512 * 1024) {
      notify('Max 512 KB', 'error');
      return;
    }
    const b64 = await readFileAsBase64(file);
    setForm((prev) => (prev ? { ...prev, stamp_signature_url: b64 } : prev));
    notify(t('adm.cmp.stamp.sig_applied'), 'info');
  }

  function getSigPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = sigCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * canvas.width) / rect.width,
      y: ((e.clientY - rect.top) * canvas.height) / rect.height,
    };
  }

  function handleSigDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = sigCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.setPointerCapture(e.pointerId);
    const p = getSigPoint(e);
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = form?.stamp_color || '#17365d';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    setSigDrawing(true);
    setSigHasInk(true);
  }

  function handleSigMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!sigDrawing) return;
    const ctx = sigCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    const p = getSigPoint(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function clearSigPad() {
    const canvas = sigCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSigHasInk(false);
  }

  function applyDrawnSignature() {
    if (!sigHasInk) {
      notify(t('sig.help'), 'error');
      return;
    }
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    setForm((prev) => (prev ? { ...prev, stamp_signature_url: dataUrl } : prev));
    notify(t('adm.cmp.stamp.sig_applied'), 'success');
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const updated = await api<CompanySettings>('/api/company-settings', {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      setForm(updated);
      notify(t('common.save'), 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur sauvegarde.', 'error');
    } finally {
      setSaving(false);
    }
  }

  const fields: Array<[keyof CompanySettings, string, string?]> = [
    ['company_name', t('cli.legal_name')],
    ['activity', t('adm.cmp.activity')],
    ['phone', t('common.phone')],
    ['email', t('common.email'), 'email'],
    ['address', t('common.address')],
    ['city', t('adm.cmp.city')],
    ['ice', t('common.ice')],
    ['tax_id', t('adm.cmp.tax_id')],
    ['rc', t('adm.cmp.rc')],
    ['tp', t('adm.cmp.tp')],
    ['bank', t('adm.cmp.bank')],
    ['rib', t('adm.cmp.rib')],
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <form onSubmit={save} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {fields.map(([key, label, type]) => (
            <div key={key}>
              <label className="block text-xs font-bold text-slate-700 mb-1">{label}</label>
              <input
                type={type || 'text'}
                required={key === 'company_name'}
                value={String(form[key] ?? '')}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          ))}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">{t('adm.cmp.logo')}</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleLogoChange}
              className="w-full text-xs text-slate-600 file:me-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-[#eef4f8] file:text-[#17324d] file:font-semibold"
            />
          </div>

          <div>
            <div className="text-xs font-bold text-slate-700 mb-1">{t('adm.cmp.logo_prev')}</div>
            {form.logo_url ? (
              <div className="flex items-center gap-3">
                <img
                  src={form.logo_url}
                  alt={t('adm.cmp.logo_prev')}
                  className="max-w-[180px] max-h-[85px] object-contain border border-slate-200 rounded-lg p-1.5"
                />
                <button
                  type="button"
                  onClick={() => setForm({ ...form, logo_url: '' })}
                  className="px-2.5 py-1 text-xs font-semibold rounded bg-red-50 text-red-700"
                >
                  {t('adm.cmp.remove')}
                </button>
              </div>
            ) : (
              <div className="text-xs text-slate-400">{t('adm.cmp.no_logo')}</div>
            )}
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-bold text-slate-700 mb-1">{t('adm.cmp.terms')}</label>
            <textarea
              value={form.payment_terms}
              onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        {/* Digital Stamp & Signature Section */}
        <div className="border-t border-slate-200 pt-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-extrabold text-[#17324d] inline-flex items-center gap-2">
                <Stamp className="w-4 h-4 text-[#2367a5]" />
                {t('adm.cmp.stamp.title')}
              </h3>
              <p className="text-xs text-slate-500 mt-1">{t('adm.cmp.stamp.desc')}</p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-bold text-[#17324d] bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.stamp_enabled !== false}
                onChange={(e) => setForm({ ...form, stamp_enabled: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 text-[#2367a5]"
              />
              <span>{t('adm.cmp.stamp.enable')}</span>
            </label>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <div className="lg:col-span-7 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t('adm.cmp.stamp.style')}
                  </label>
                  <select
                    value={form.stamp_style === 'round' ? 'round' : 'rectangular'}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        stamp_style: e.target.value === 'round' ? 'round' : 'rectangular',
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="rectangular">{t('adm.cmp.stamp.style_rect')}</option>
                    <option value="round">{t('adm.cmp.stamp.style_round')}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t('adm.cmp.stamp.color')}
                  </label>
                  <div className="flex items-center gap-2 pt-1">
                    {[
                      { hex: '#17365d', label: 'Marine' },
                      { hex: '#1d4ed8', label: 'Bleu' },
                      { hex: '#0f766e', label: 'Émeraude' },
                      { hex: '#991b1b', label: 'Bordeaux' },
                    ].map((c) => {
                      const active = (form.stamp_color || '#17365d').toLowerCase() === c.hex;
                      return (
                        <button
                          key={c.hex}
                          type="button"
                          onClick={() => setForm({ ...form, stamp_color: c.hex })}
                          title={c.label}
                          aria-label={c.label}
                          className={`w-8 h-8 rounded-full border-2 transition-transform ${
                            active ? 'border-slate-900 scale-110 ring-2 ring-slate-300' : 'border-white shadow-xs'
                          }`}
                          style={{ backgroundColor: c.hex }}
                        />
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t('adm.cmp.stamp.sig_name')}
                  </label>
                  <input
                    type="text"
                    value={form.stamp_signatory_name || ''}
                    onChange={(e) => setForm({ ...form, stamp_signatory_name: e.target.value })}
                    placeholder={t('adm.cmp.stamp.sig_name_ph')}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t('adm.cmp.stamp.sig_title')}
                  </label>
                  <input
                    type="text"
                    value={form.stamp_signatory_title || ''}
                    onChange={(e) => setForm({ ...form, stamp_signatory_title: e.target.value })}
                    placeholder={t('adm.cmp.stamp.sig_title_ph')}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-700">
                    {t('adm.cmp.stamp.draw_label')}
                  </span>
                  {form.stamp_signature_url && (
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, stamp_signature_url: '' })}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded bg-red-50 hover:bg-red-100 text-red-700"
                    >
                      {t('adm.cmp.stamp.remove_sig')}
                    </button>
                  )}
                </div>

                <canvas
                  ref={sigCanvasRef}
                  width={600}
                  height={170}
                  onPointerDown={handleSigDown}
                  onPointerMove={handleSigMove}
                  onPointerUp={() => setSigDrawing(false)}
                  onPointerCancel={() => setSigDrawing(false)}
                  className="block w-full h-32 border-2 border-dashed border-slate-300 rounded-lg bg-white touch-none cursor-crosshair"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={applyDrawnSignature}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white"
                  >
                    {t('adm.cmp.stamp.apply_sig')}
                  </button>
                  <button
                    type="button"
                    onClick={clearSigPad}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700"
                  >
                    {t('adm.cmp.stamp.clear_pad')}
                  </button>
                </div>

                <div className="pt-2 border-t border-slate-200">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {t('adm.cmp.stamp.upload_sig')}
                  </label>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleSignatureFileChange}
                    className="w-full text-xs text-slate-600 file:me-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-white file:text-[#17324d] file:font-semibold"
                  />
                </div>
              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col items-center justify-center min-h-[260px]">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">
                  {t('adm.cmp.stamp.preview')}
                </div>
                {form.stamp_enabled !== false ? (
                  <CompanyStamp company={form} />
                ) : (
                  <div className="text-xs text-slate-400 text-center py-8">
                    {t('adm.cmp.stamp.enable')}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2.5 text-sm font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white disabled:opacity-50"
        >
          {saving ? t('common.saving') : t('adm.cmp.save')}
        </button>
      </form>
    </div>
  );
}

// ======================== PAYS ET VILLES ========================
export function CitiesAdminView({
  onRefreshLookups,
  notify,
}: {
  onRefreshLookups: () => Promise<void>;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t } = useI18n();
  const [countries, setCountries] = useState<Country[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);

  const [countryModal, setCountryModal] = useState(false);
  const [editingCountry, setEditingCountry] = useState<Country | null>(null);
  const [cName, setCName] = useState('');
  const [cIso, setCIso] = useState('');

  const [cityModal, setCityModal] = useState(false);
  const [editingCity, setEditingCity] = useState<City | null>(null);
  const [cityName, setCityName] = useState('');
  const [cityCountryId, setCityCountryId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cq, pq] = await Promise.all([
        api<Country[]>('/api/countries'),
        api<City[]>('/api/cities'),
      ]);
      setCountries(cq);
      setCities(pq);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur chargement catalogue.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  function openCountry(c: Country | null = null) {
    setEditingCountry(c);
    setCName(c?.name || '');
    setCIso(c?.iso_code || '');
    setCountryModal(true);
  }

  function openCity(c: City | null = null) {
    setEditingCity(c);
    setCityName(c?.name || '');
    setCityCountryId(c?.country_id || countries.find((x) => x.is_active)?.id || '');
    setCityModal(true);
  }

  return (
    <div className="space-y-5">
      <InfoBanner>{t('adm.cit.banner')}</InfoBanner>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => openCountry(null)}
          className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] text-white"
        >
          {t('adm.cit.add_country')}
        </button>
        <button
          type="button"
          onClick={() => openCity(null)}
          className="px-4 py-2 text-sm font-bold rounded-lg bg-[#17324d] text-white"
        >
          {t('adm.cit.add_city')}
        </button>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
          {t('common.loading')}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <h2 className="text-base font-bold text-[#17324d]">{t('adm.cit.countries')}</h2>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-start border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                    <th className="px-3 py-2">{t('adm.cit.country')}</th>
                    <th className="px-3 py-2">{t('adm.cit.code')}</th>
                    <th className="px-3 py-2">{t('common.status')}</th>
                    <th className="px-3 py-2">{t('common.action')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {countries.map((c) => (
                    <tr key={c.id}>
                      <td className="px-3 py-2 font-bold text-[#17324d]">{c.name}</td>
                      <td className="px-3 py-2 font-mono">{c.iso_code || '—'}</td>
                      <td className="px-3 py-2">
                        {c.is_active ? t('common.active') : t('adm.cit.disabled')}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => openCountry(c)}
                            className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 font-semibold"
                          >
                            {t('common.edit')}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await api(`/api/countries/${c.id}`, {
                                method: 'PUT',
                                body: JSON.stringify({ is_active: !c.is_active }),
                              });
                              await onRefreshLookups();
                              await load();
                            }}
                            className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 font-semibold"
                          >
                            {c.is_active ? t('adm.cit.disable') : t('adm.cit.enable')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <h2 className="text-base font-bold text-[#17324d]">{t('adm.cit.cities')}</h2>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-start border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                    <th className="px-3 py-2">{t('adm.cit.city')}</th>
                    <th className="px-3 py-2">{t('adm.cit.country')}</th>
                    <th className="px-3 py-2">{t('common.status')}</th>
                    <th className="px-3 py-2">{t('common.action')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cities.map((c) => (
                    <tr key={c.id}>
                      <td className="px-3 py-2 font-bold text-[#17324d]">{c.name}</td>
                      <td className="px-3 py-2">{c.country_name || '—'}</td>
                      <td className="px-3 py-2">
                        {c.is_active ? t('common.active') : t('adm.cit.disabled')}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => openCity(c)}
                            className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 font-semibold"
                          >
                            {t('common.edit')}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await api(`/api/cities/${c.id}`, {
                                method: 'PUT',
                                body: JSON.stringify({ is_active: !c.is_active }),
                              });
                              await onRefreshLookups();
                              await load();
                            }}
                            className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 font-semibold"
                          >
                            {c.is_active ? t('adm.cit.disable') : t('adm.cit.enable')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={countryModal}
        title={editingCountry ? t('adm.cit.edit_country') : t('adm.cit.add_country')}
        onClose={() => setCountryModal(false)}
        maxWidth="max-w-md"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const payload = { name: cName.trim(), iso_code: cIso.trim().toUpperCase() || null };
            if (editingCountry) {
              await api(`/api/countries/${editingCountry.id}`, {
                method: 'PUT',
                body: JSON.stringify(payload),
              });
            } else {
              await api('/api/countries', { method: 'POST', body: JSON.stringify(payload) });
            }
            setCountryModal(false);
            await onRefreshLookups();
            await load();
          }}
          className="space-y-4"
        >
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('adm.cit.country')} *
              </label>
              <input
                required
                value={cName}
                onChange={(e) => setCName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('adm.cit.iso')}</label>
              <input
                maxLength={2}
                value={cIso}
                onChange={(e) => setCIso(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCountryModal(false)}
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

      <Modal
        open={cityModal}
        title={editingCity ? t('adm.cit.edit_city') : t('adm.cit.add_city')}
        onClose={() => setCityModal(false)}
        maxWidth="max-w-md"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const payload = { name: cityName.trim(), country_id: cityCountryId };
            if (editingCity) {
              await api(`/api/cities/${editingCity.id}`, {
                method: 'PUT',
                body: JSON.stringify(payload),
              });
            } else {
              await api('/api/cities', { method: 'POST', body: JSON.stringify(payload) });
            }
            setCityModal(false);
            await onRefreshLookups();
            await load();
          }}
          className="space-y-4"
        >
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('adm.cit.city')} *
              </label>
              <input
                required
                value={cityName}
                onChange={(e) => setCityName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('adm.cit.country')} *
              </label>
              <select
                required
                value={cityCountryId}
                onChange={(e) => setCityCountryId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="">{t('common.choose')}</option>
                {countries
                  .filter((x) => x.is_active)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCityModal(false)}
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
