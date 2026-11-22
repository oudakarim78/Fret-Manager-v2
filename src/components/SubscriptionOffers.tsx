import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  MapPin,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import type {
  B2BDeploymentRequest,
  B2BPackCatalogItem,
  B2BPackId,
  Currency,
  VendorWorkspaceSummary,
} from '../types.ts';
import { api } from '../lib/api.ts';
import { money } from '../lib/format.ts';
import { useI18n } from '../lib/i18n.tsx';

export interface SubscriptionOffersProps {
  packs?: B2BPackCatalogItem[];
  workspaces?: VendorWorkspaceSummary[];
  currency?: Currency;
  onCurrencyChange?: (next: Currency) => void;
  onApplyPlan?: (
    packId: B2BPackId,
    currency: Currency,
    workspace?: VendorWorkspaceSummary,
  ) => void;
  onSubscriptionCreated?: (req: B2BDeploymentRequest) => void;
  notify?: (msg: string, type?: 'success' | 'error' | 'info') => void;
  editable?: boolean;
  onSavePack?: (packId: B2BPackId, patch: Partial<B2BPackCatalogItem>) => Promise<void>;
  onCreatePack?: (draft: Omit<B2BPackCatalogItem, 'id'>) => Promise<void>;
  onDeletePack?: (packId: B2BPackId) => Promise<void>;
  onResetPacks?: () => Promise<void>;
}

const FALLBACK_PACKS: B2BPackCatalogItem[] = [
  {
    id: 'pack_essentiel',
    name: 'Pack Essentiel PME',
    audience: 'Transporteurs de 1 à 8 véhicules souhaitant structurer missions et facturation',
    setup_fee_mad: 4500,
    annual_fee_mad: 6000,
    setup_fee_eur: 450,
    annual_fee_eur: 600,
    max_vehicles: 8,
    max_users: 10,
    gps_enabled: false,
    is_featured: false,
    deliverables: [],
  },
  {
    id: 'pack_flotte_gps',
    name: 'Pack Flotte & GPS',
    audience: 'Flottes actives de 9 à 30 camions avec suivi temps réel et paie intégrée',
    setup_fee_mad: 8500,
    annual_fee_mad: 11500,
    setup_fee_eur: 850,
    annual_fee_eur: 1150,
    max_vehicles: 30,
    max_users: 35,
    gps_enabled: true,
    is_featured: true,
    deliverables: [],
  },
  {
    id: 'pack_entreprise',
    name: 'Pack Entreprise Multi-Sites',
    audience: 'Groupes logistiques et transitaires à fort volume (flotte illimitée)',
    setup_fee_mad: 15000,
    annual_fee_mad: 19000,
    setup_fee_eur: 1500,
    annual_fee_eur: 1900,
    max_vehicles: 999,
    max_users: 999,
    gps_enabled: true,
    is_featured: false,
    deliverables: [],
  },
];

interface PackDraft {
  name: string;
  audience: string;
  setup_fee_mad: number;
  annual_fee_mad: number;
  setup_fee_eur: number;
  annual_fee_eur: number;
  max_vehicles: number;
  max_users: number;
  gps_enabled: boolean;
  is_featured: boolean;
  logistics_benefit: string;
  deliverables: string[];
}

function emptyDraft(defaultBenefit: string): PackDraft {
  return {
    name: '',
    audience: '',
    setup_fee_mad: 5000,
    annual_fee_mad: 7500,
    setup_fee_eur: 500,
    annual_fee_eur: 750,
    max_vehicles: 15,
    max_users: 15,
    gps_enabled: true,
    is_featured: false,
    logistics_benefit: defaultBenefit,
    deliverables: [''],
  };
}

export function SubscriptionOffers({
  packs: propPacks,
  workspaces = [],
  currency: controlledCurrency,
  onCurrencyChange,
  onApplyPlan,
  onSubscriptionCreated,
  notify,
  editable = false,
  onSavePack,
  onCreatePack,
  onDeletePack,
  onResetPacks,
}: SubscriptionOffersProps) {
  const { t, lang, packText, packNameById } = useI18n();
  const [fetchedPacks, setFetchedPacks] = useState<B2BPackCatalogItem[]>(FALLBACK_PACKS);
  const [internalCurrency, setInternalCurrency] = useState<Currency>('MAD');
  const [selectedPack, setSelectedPack] = useState<B2BPackId>('pack_flotte_gps');
  const [targetWsId, setTargetWsId] = useState<string>('');

  // Edit mode states (for Portail Éditeur)
  const [editMode, setEditMode] = useState(false);
  const [editingPackId, setEditingPackId] = useState<B2BPackId | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [draft, setDraft] = useState<PackDraft | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);

  // Client subscription form states
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [fleetSize, setFleetSize] = useState('10');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedRequest, setSubmittedRequest] = useState<B2BDeploymentRequest | null>(null);

  const formRef = useRef<HTMLDivElement | null>(null);

  const currency = controlledCurrency ?? internalCurrency;
  const setCurrency = (next: Currency) => {
    setInternalCurrency(next);
    onCurrencyChange?.(next);
  };

  useEffect(() => {
    if (propPacks && propPacks.length > 0) return;
    let active = true;
    api<B2BPackCatalogItem[]>('/api/b2b/packs')
      .then((data) => {
        if (active && Array.isArray(data) && data.length > 0) {
          setFetchedPacks(data);
        }
      })
      .catch(() => {
        // Keep fallback catalog silently
      });
    return () => {
      active = false;
    };
  }, [propPacks]);

  const packs = propPacks && propPacks.length > 0 ? propPacks : fetchedPacks;

  useEffect(() => {
    if (packs.length > 0 && !packs.some((p) => p.id === selectedPack)) {
      const featured = packs.find((p) => p.is_featured) || packs[0];
      setSelectedPack(featured.id);
    }
  }, [packs, selectedPack]);

  const targetWorkspace = useMemo(
    () => workspaces.find((w) => w.id === targetWsId),
    [workspaces, targetWsId],
  );

  function defaultOpsBenefitForId(packId: B2BPackId): string {
    if (packId === 'pack_essentiel') return t('offers.ops.essentiel');
    if (packId === 'pack_flotte_gps') return t('offers.ops.flotte');
    return t('offers.ops.entreprise');
  }

  function logisticsSummaryForPack(pack: B2BPackCatalogItem) {
    const customOrFr =
      Boolean(pack.customized) ||
      lang === 'fr' ||
      !['pack_essentiel', 'pack_flotte_gps', 'pack_entreprise'].includes(pack.id);
    const text =
      customOrFr && pack.logistics_benefit?.trim()
        ? pack.logistics_benefit.trim()
        : defaultOpsBenefitForId(pack.id);

    if (pack.id === 'pack_essentiel') {
      return {
        icon: <Truck className="w-4 h-4 text-[#2367a5] shrink-0 mt-0.5" />,
        text,
      };
    }
    if (pack.id === 'pack_flotte_gps' || pack.gps_enabled) {
      return {
        icon: <MapPin className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />,
        text,
      };
    }
    return {
      icon: <ShieldCheck className="w-4 h-4 text-[#17324d] shrink-0 mt-0.5" />,
      text,
    };
  }

  function startEditingPack(pack: B2BPackCatalogItem) {
    const loc = packText(pack);
    const summary = logisticsSummaryForPack(pack);
    setEditMode(true);
    setCreatingNew(false);
    setEditingPackId(pack.id);
    setDraft({
      name: loc.name,
      audience: loc.audience,
      setup_fee_mad: pack.setup_fee_mad,
      annual_fee_mad: pack.annual_fee_mad,
      setup_fee_eur: pack.setup_fee_eur,
      annual_fee_eur: pack.annual_fee_eur,
      max_vehicles: pack.max_vehicles,
      max_users: pack.max_users,
      gps_enabled: pack.gps_enabled,
      is_featured: pack.is_featured ?? pack.id === 'pack_flotte_gps',
      logistics_benefit: pack.logistics_benefit?.trim() || summary.text,
      deliverables: loc.deliverables.length > 0 ? [...loc.deliverables] : [''],
    });
  }

  function startCreatingPack() {
    setEditMode(true);
    setEditingPackId(null);
    setCreatingNew(true);
    setDraft(emptyDraft(t('offers.ops.flotte')));
  }

  function cancelEditing() {
    setEditingPackId(null);
    setCreatingNew(false);
    setDraft(null);
  }

  async function handleSaveDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (!draft.name.trim()) return;

    setSavingDraft(true);
    const cleanDeliverables = draft.deliverables.map((d) => d.trim()).filter(Boolean);
    const payload = {
      name: draft.name.trim(),
      audience: draft.audience.trim(),
      setup_fee_mad: Math.max(0, Number(draft.setup_fee_mad) || 0),
      annual_fee_mad: Math.max(0, Number(draft.annual_fee_mad) || 0),
      setup_fee_eur: Math.max(0, Number(draft.setup_fee_eur) || 0),
      annual_fee_eur: Math.max(0, Number(draft.annual_fee_eur) || 0),
      max_vehicles: Math.max(1, Number(draft.max_vehicles) || 1),
      max_users: Math.max(1, Number(draft.max_users) || 1),
      gps_enabled: draft.gps_enabled,
      is_featured: draft.is_featured,
      logistics_benefit: draft.logistics_benefit.trim() || undefined,
      deliverables: cleanDeliverables,
    };

    try {
      if (creatingNew && onCreatePack) {
        await onCreatePack(payload);
        notify?.(t('offers.pack_created', { name: payload.name }), 'success');
      } else if (editingPackId && onSavePack) {
        await onSavePack(editingPackId, payload);
        notify?.(t('offers.pack_saved', { name: payload.name }), 'success');
      }
      cancelEditing();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : 'Erreur d’enregistrement.', 'error');
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleDeletePack(pack: B2BPackCatalogItem) {
    if (!onDeletePack) return;
    setSavingDraft(true);
    try {
      await onDeletePack(pack.id);
      if (editingPackId === pack.id) {
        cancelEditing();
      }
      notify?.(t('offers.pack_deleted'), 'info');
    } catch (err) {
      notify?.(err instanceof Error ? err.message : 'Suppression impossible.', 'error');
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleResetCatalog() {
    if (!onResetPacks) return;
    setSavingDraft(true);
    try {
      await onResetPacks();
      cancelEditing();
      notify?.(t('offers.packs_reset'), 'success');
    } catch (err) {
      notify?.(err instanceof Error ? err.message : 'Réinitialisation impossible.', 'error');
    } finally {
      setSavingDraft(false);
    }
  }

  function handleSelectPack(pack: B2BPackCatalogItem) {
    setSelectedPack(pack.id);
    setSubmittedRequest(null);
    if (targetWorkspace && onApplyPlan) {
      onApplyPlan(pack.id, currency, targetWorkspace);
      return;
    }
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const created = await api<B2BDeploymentRequest>('/api/b2b/requests', {
        method: 'POST',
        body: JSON.stringify({
          company_name: companyName.trim(),
          contact_name: contactName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          fleet_size: Number(fleetSize) || 5,
          pack: selectedPack,
          currency,
          notes: notes.trim() || undefined,
        }),
      });
      setSubmittedRequest(created);
      onSubscriptionCreated?.(created);
      notify?.(t('b2b.form.success_toast'), 'success');
    } catch (err) {
      notify?.(err instanceof Error ? err.message : 'Erreur d’envoi.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const comparisonRows = [
    {
      label: t('offers.row_fleet'),
      values: packs.map((p) =>
        p.max_vehicles >= 900 ? t('b2b.packs.unlimited') : String(p.max_vehicles),
      ),
      mono: true,
    },
    {
      label: t('offers.row_users'),
      values: packs.map((p) =>
        p.max_users >= 900 ? t('b2b.packs.unlimited') : String(p.max_users),
      ),
      mono: true,
    },
    {
      label: t('offers.row_dispatch'),
      values: packs.map(() => t('offers.val_included')),
      mono: false,
    },
    {
      label: t('offers.row_billing'),
      values: packs.map(() => t('offers.val_included')),
      mono: false,
    },
    {
      label: t('offers.row_payroll'),
      values: packs.map((p) =>
        p.max_vehicles >= 900 || p.id === 'pack_entreprise'
          ? t('offers.val_pay_ent')
          : p.gps_enabled || p.id === 'pack_flotte_gps'
            ? t('offers.val_pay_auto')
            : t('offers.val_pay_std'),
      ),
      mono: false,
    },
    {
      label: t('offers.row_gps'),
      values: packs.map((p) =>
        !p.gps_enabled
          ? t('offers.val_gps_opt')
          : p.max_vehicles >= 900 || p.id === 'pack_entreprise'
            ? t('offers.val_gps_api')
            : t('offers.val_gps_inc'),
      ),
      mono: false,
    },
    {
      label: t('offers.row_onboarding'),
      values: packs.map((p) =>
        p.max_vehicles >= 900 || p.id === 'pack_entreprise'
          ? t('offers.val_tr_ent')
          : p.gps_enabled || p.id === 'pack_flotte_gps'
            ? t('offers.val_tr_4h')
            : t('offers.val_tr_2h'),
      ),
      mono: false,
    },
  ];

  function renderDraftEditor(title: string) {
    if (!draft) return null;
    return (
      <form
        onSubmit={handleSaveDraft}
        className="bg-[#f8fafc] border-2 border-[#2367a5] rounded-xl p-5 space-y-3.5 flex flex-col justify-between"
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200">
            <span className="text-xs font-extrabold text-[#17324d]">{title}</span>
            <button
              type="button"
              onClick={cancelEditing}
              className="p-1 rounded-md text-slate-500 hover:text-[#17324d] hover:bg-slate-200/70"
              aria-label={t('common.close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              {t('offers.field_name')}
            </label>
            <input
              type="text"
              required
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="w-full px-3 py-1.5 text-sm font-bold border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#2367a5]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              {t('offers.field_audience')}
            </label>
            <textarea
              rows={2}
              value={draft.audience}
              onChange={(e) => setDraft({ ...draft, audience: e.target.value })}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#2367a5]"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                {t('offers.field_setup_mad')}
              </label>
              <input
                type="number"
                min={0}
                value={draft.setup_fee_mad}
                onChange={(e) => setDraft({ ...draft, setup_fee_mad: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#2367a5]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                {t('offers.field_annual_mad')}
              </label>
              <input
                type="number"
                min={0}
                value={draft.annual_fee_mad}
                onChange={(e) => setDraft({ ...draft, annual_fee_mad: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#2367a5]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                {t('offers.field_setup_eur')}
              </label>
              <input
                type="number"
                min={0}
                value={draft.setup_fee_eur}
                onChange={(e) => setDraft({ ...draft, setup_fee_eur: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#2367a5]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                {t('offers.field_annual_eur')}
              </label>
              <input
                type="number"
                min={0}
                value={draft.annual_fee_eur}
                onChange={(e) => setDraft({ ...draft, annual_fee_eur: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#2367a5]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                {t('offers.field_vehicles')}
              </label>
              <input
                type="number"
                min={1}
                value={draft.max_vehicles}
                onChange={(e) => setDraft({ ...draft, max_vehicles: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#2367a5]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                {t('offers.field_users')}
              </label>
              <input
                type="number"
                min={1}
                value={draft.max_users}
                onChange={(e) => setDraft({ ...draft, max_users: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#2367a5]"
              />
            </div>
          </div>

          <div className="space-y-1.5 pt-1">
            <label className="flex items-center gap-2 text-xs font-semibold text-[#17324d] cursor-pointer">
              <input
                type="checkbox"
                checked={draft.gps_enabled}
                onChange={(e) => setDraft({ ...draft, gps_enabled: e.target.checked })}
              />
              <span>{t('offers.field_gps')}</span>
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-[#17324d] cursor-pointer">
              <input
                type="checkbox"
                checked={draft.is_featured}
                onChange={(e) => setDraft({ ...draft, is_featured: e.target.checked })}
              />
              <span>{t('offers.field_featured')}</span>
            </label>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              {t('offers.field_benefit')}
            </label>
            <textarea
              rows={2}
              value={draft.logistics_benefit}
              onChange={(e) => setDraft({ ...draft, logistics_benefit: e.target.value })}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#2367a5]"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-[11px] font-bold text-slate-700">
                {t('offers.field_deliverables')}
              </label>
              <button
                type="button"
                onClick={() =>
                  setDraft({ ...draft, deliverables: [...draft.deliverables, ''] })
                }
                className="text-[11px] font-bold text-[#2367a5] hover:underline"
              >
                {t('offers.add_deliverable')}
              </button>
            </div>
            <div className="space-y-1.5">
              {draft.deliverables.map((item, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={item}
                    placeholder={t('offers.deliverable_ph')}
                    onChange={(e) => {
                      const next = [...draft.deliverables];
                      next[idx] = e.target.value;
                      setDraft({ ...draft, deliverables: next });
                    }}
                    className="flex-1 px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#2367a5]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = draft.deliverables.filter((_, i) => i !== idx);
                      setDraft({ ...draft, deliverables: next.length > 0 ? next : [''] });
                    }}
                    className="p-1.5 rounded-md border border-slate-200 bg-white text-slate-500 hover:text-red-600 hover:border-red-200"
                    aria-label={t('common.delete')}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={cancelEditing}
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={savingDraft}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white text-xs font-bold disabled:opacity-50 whitespace-nowrap"
          >
            <Save className="w-3.5 h-3.5" />
            {savingDraft
              ? t('common.saving')
              : creatingNew
                ? t('offers.create_pack')
                : t('offers.save_pack')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-6 no-print">
      {/* Header + Edit Mode Controls + Target Client Selector + Currency Toggle */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-extrabold text-[#17324d]">{t('vendor.catalog.title')}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{t('vendor.catalog.sub')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {editable && (
            <>
              <button
                type="button"
                onClick={() => {
                  const next = !editMode;
                  setEditMode(next);
                  if (!next) cancelEditing();
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                  editMode
                    ? 'bg-[#2367a5] text-white'
                    : 'bg-[#f8fafc] border border-slate-300 text-[#17324d] hover:bg-slate-100'
                }`}
              >
                <Pencil className="w-3.5 h-3.5" />
                {editMode ? t('offers.exit_edit_mode') : t('offers.edit_mode')}
              </button>

              {editMode && onCreatePack && (
                <button
                  type="button"
                  onClick={startCreatingPack}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t('offers.add_pack')}
                </button>
              )}

              {editMode && onResetPacks && (
                <button
                  type="button"
                  disabled={savingDraft}
                  onClick={() => void handleResetCatalog()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {t('offers.reset_packs')}
                </button>
              )}
            </>
          )}

          {workspaces.length > 0 && !editMode && (
            <div className="flex items-center gap-2">
              <label
                htmlFor="offers-target-ws"
                className="text-xs font-semibold text-slate-600 whitespace-nowrap"
              >
                {t('offers.target_ws_label')}
              </label>
              <select
                id="offers-target-ws"
                value={targetWsId}
                onChange={(e) => setTargetWsId(e.target.value)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-[#17324d] font-medium focus:outline-none focus:border-[#2367a5]"
              >
                <option value="">{t('offers.target_ws_new')}</option>
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.code} · {ws.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="inline-flex items-center p-1 bg-slate-100 border border-slate-200 rounded-lg shrink-0">
            <button
              type="button"
              onClick={() => setCurrency('MAD')}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                currency === 'MAD' ? 'bg-[#17324d] text-white' : 'text-slate-600 hover:text-[#17324d]'
              }`}
            >
              MAD
            </button>
            <button
              type="button"
              onClick={() => setCurrency('EUR')}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                currency === 'EUR' ? 'bg-[#17324d] text-white' : 'text-slate-600 hover:text-[#17324d]'
              }`}
            >
              EUR
            </button>
          </div>
        </div>
      </div>

      {/* Interactive B2B Service Plans Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
        {packs.map((pack) => {
          if (editable && editMode && editingPackId === pack.id && draft) {
            return <React.Fragment key={pack.id}>{renderDraftEditor(t('offers.edit_pack'))}</React.Fragment>;
          }

          const loc = packText(pack);
          const setup = currency === 'EUR' ? pack.setup_fee_eur : pack.setup_fee_mad;
          const annual = currency === 'EUR' ? pack.annual_fee_eur : pack.annual_fee_mad;
          const monthlyEq = Math.round(annual / 12);
          const isSelected = selectedPack === pack.id;
          const isFeatured =
            pack.is_featured !== undefined ? pack.is_featured : pack.id === 'pack_flotte_gps';
          const opsBenefit = logisticsSummaryForPack(pack);

          return (
            <div
              key={pack.id}
              className={`bg-white rounded-xl border p-6 flex flex-col justify-between transition-colors ${
                isSelected
                  ? 'border-[#2367a5] ring-1 ring-[#2367a5]'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="space-y-4">
                {editable && editMode && (
                  <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-dashed border-slate-200">
                    <span className="font-mono text-[11px] text-slate-400">{pack.id}</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => startEditingPack(pack)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#f3f6f9] hover:bg-[#e5edf5] text-[#17324d] text-[11px] font-bold"
                      >
                        <Pencil className="w-3 h-3" />
                        {t('common.edit')}
                      </button>
                      {onDeletePack && packs.length > 1 && (
                        <button
                          type="button"
                          disabled={savingDraft}
                          onClick={() => void handleDeletePack(pack)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-red-200 bg-white hover:bg-red-50 text-red-700 text-[11px] font-bold disabled:opacity-50"
                        >
                          <Trash2 className="w-3 h-3" />
                          {t('offers.delete_pack')}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Plan Title & Quiet Audience Line */}
                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-lg font-extrabold text-[#17324d]">{loc.name}</h3>
                    {isSelected ? (
                      <span className="text-[11px] font-bold text-[#2367a5] whitespace-nowrap shrink-0">
                        {t('sub.selected_label')}
                      </span>
                    ) : isFeatured ? (
                      <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap shrink-0">
                        {t('b2b.packs.recommended')}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-slate-600 mt-1.5 leading-relaxed min-h-[36px]">
                    {loc.audience}
                  </p>
                </div>

                {/* Pricing Summary */}
                <div className="border-y border-slate-200 py-3.5 space-y-1">
                  <div className="text-[11px] font-semibold text-slate-500">
                    {t('b2b.packs.setup_label')}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-2xl font-extrabold text-[#17324d] tabular-nums">
                      {money(setup, currency)}
                    </span>
                    <span className="text-xs text-slate-500">{t('b2b.packs.ht_once')}</span>
                  </div>
                  <div className="font-mono text-xs text-slate-700 tabular-nums pt-0.5">
                    + {money(annual, currency)} {t('b2b.packs.annual_suffix')}
                  </div>
                  <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                    {t('offers.monthly_eq', { amt: money(monthlyEq, currency) })}
                  </div>
                </div>

                {/* Capacity Strip */}
                <div className="grid grid-cols-3 gap-2 text-center bg-[#f8fafc] border border-slate-200/80 rounded-lg p-2.5 text-xs">
                  <div>
                    <div className="font-mono font-bold text-[#17324d] tabular-nums">
                      {pack.max_vehicles >= 900 ? t('b2b.packs.unlimited') : pack.max_vehicles}
                    </div>
                    <div className="text-[11px] text-slate-500">{t('b2b.packs.vehicles')}</div>
                  </div>
                  <div>
                    <div className="font-mono font-bold text-[#17324d] tabular-nums">
                      {pack.max_users >= 900 ? t('b2b.packs.unlimited') : pack.max_users}
                    </div>
                    <div className="text-[11px] text-slate-500">{t('b2b.packs.accounts')}</div>
                  </div>
                  <div>
                    <div className="font-mono font-bold text-[#17324d]">
                      {pack.gps_enabled ? t('b2b.packs.included') : t('b2b.packs.option')}
                    </div>
                    <div className="text-[11px] text-slate-500">{t('b2b.packs.gps')}</div>
                  </div>
                </div>

                {/* Highlighted Logistics Operations Benefit */}
                <div className="rounded-lg bg-[#f4f8fc] border border-[#dce8f3] p-3 space-y-1">
                  <div className="text-[11px] font-bold text-[#17324d]">
                    {t('offers.ops_heading')}
                  </div>
                  <div className="flex items-start gap-2 text-xs text-slate-700 leading-relaxed">
                    {opsBenefit.icon}
                    <span>{opsBenefit.text}</span>
                  </div>
                </div>

                {/* Deliverables */}
                <ul className="space-y-2 text-xs text-slate-700">
                  {loc.deliverables.map((d, dIdx) => (
                    <li key={`${d}_${dIdx}`} className="flex items-start gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      <span className="leading-snug">{d}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-5 space-y-2">
                {editable && editMode ? (
                  <button
                    type="button"
                    onClick={() => startEditingPack(pack)}
                    className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-lg bg-[#17324d] hover:bg-[#1f4469] text-white text-xs font-bold transition-colors whitespace-nowrap"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    {t('offers.edit_pack')}
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSelectPack(pack)}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                        isSelected
                          ? 'bg-[#2367a5] hover:bg-[#1c5589] text-white'
                          : 'bg-[#f3f6f9] hover:bg-[#e5edf5] text-[#17324d] border border-slate-300'
                      }`}
                    >
                      <span>
                        {targetWorkspace
                          ? t('offers.apply_ws_btn', { code: targetWorkspace.code })
                          : isSelected
                            ? t('offers.selected_btn')
                            : t('offers.select_btn')}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
                    </button>
                    {editable && (
                      <button
                        type="button"
                        onClick={() => startEditingPack(pack)}
                        title={t('offers.edit_pack')}
                        className="p-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-[#17324d] shrink-0"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {editable && editMode && creatingNew && draft && renderDraftEditor(t('offers.new_pack_title'))}
      </div>

      {/* Logistics Operational Comparison Matrix */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-extrabold text-[#17324d]">{t('offers.matrix_title')}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{t('offers.matrix_sub')}</p>
          </div>
          <Receipt className="w-4 h-4 text-[#2367a5] shrink-0" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-start border-collapse text-xs">
            <thead>
              <tr className="bg-[#f8fafc] border-b border-slate-200 text-slate-600 font-bold">
                <th className="px-4 py-3 text-start">{t('offers.col_capability')}</th>
                {packs.map((p) => (
                  <th
                    key={p.id}
                    className={`px-4 py-3 text-start ${
                      selectedPack === p.id ? 'text-[#2367a5]' : 'text-[#17324d]'
                    }`}
                  >
                    {packNameById(p.id, p.name)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {comparisonRows.map((row) => (
                <tr key={row.label} className="hover:bg-slate-50/70">
                  <td className="px-4 py-2.5 font-semibold text-slate-700">{row.label}</td>
                  {row.values.map((val, idx) => (
                    <td
                      key={`${row.label}_${packs[idx]?.id || idx}`}
                      className={`px-4 py-2.5 text-[#17324d] ${
                        row.mono ? 'font-mono font-bold tabular-nums' : 'font-medium'
                      }`}
                    >
                      {val}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Client Plan Selection / Subscription Submission Form */}
      {!targetWorkspace && !editMode && (
        <div ref={formRef} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          {submittedRequest ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-5 space-y-3">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-extrabold text-emerald-900">
                    {t('b2b.form.success_title')}
                  </h4>
                  <p className="text-xs text-emerald-900/80 mt-0.5">
                    {submittedRequest.company_name} ·{' '}
                    {packNameById(
                      submittedRequest.pack,
                      packs.find((p) => p.id === submittedRequest.pack)?.name,
                    )}{' '}
                    · <span className="font-mono font-bold">{submittedRequest.id}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSubmittedRequest(null);
                  setCompanyName('');
                  setContactName('');
                  setPhone('');
                  setEmail('');
                  setNotes('');
                }}
                className="px-3.5 py-1.5 rounded-lg border border-emerald-300 bg-white text-xs font-bold text-emerald-900 hover:bg-emerald-50"
              >
                {t('b2b.form.another')}
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <h3 className="text-base font-extrabold text-[#17324d]">
                  {t('offers.form_title', {
                    pack: packNameById(
                      selectedPack,
                      packs.find((p) => p.id === selectedPack)?.name,
                    ),
                  })}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">{t('offers.form_sub')}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div>
                  <label htmlFor="off-company" className="block text-xs font-bold text-slate-700 mb-1">
                    {t('b2b.form.company')}
                  </label>
                  <input
                    id="off-company"
                    type="text"
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Atlas Sud SARL"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                  />
                </div>
                <div>
                  <label htmlFor="off-contact" className="block text-xs font-bold text-slate-700 mb-1">
                    {t('b2b.form.contact')}
                  </label>
                  <input
                    id="off-contact"
                    type="text"
                    required
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                  />
                </div>
                <div>
                  <label htmlFor="off-phone" className="block text-xs font-bold text-slate-700 mb-1">
                    {t('b2b.form.phone')}
                  </label>
                  <input
                    id="off-phone"
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+212 6 00 00 00 00"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                  />
                </div>
                <div>
                  <label htmlFor="off-email" className="block text-xs font-bold text-slate-700 mb-1">
                    {t('b2b.form.email')}
                  </label>
                  <input
                    id="off-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="direction@entreprise.ma"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5 items-end">
                <div>
                  <label htmlFor="off-pack" className="block text-xs font-bold text-slate-700 mb-1">
                    {t('b2b.form.pack')}
                  </label>
                  <select
                    id="off-pack"
                    value={selectedPack}
                    onChange={(e) => setSelectedPack(e.target.value as B2BPackId)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#2367a5]"
                  >
                    {packs.map((p) => (
                      <option key={p.id} value={p.id}>
                        {packNameById(p.id, p.name)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="off-fleet" className="block text-xs font-bold text-slate-700 mb-1">
                    {t('b2b.form.fleet')}
                  </label>
                  <input
                    id="off-fleet"
                    type="number"
                    min={1}
                    max={500}
                    value={fleetSize}
                    onChange={(e) => setFleetSize(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                  />
                </div>

                <div>
                  <label htmlFor="off-notes" className="block text-xs font-bold text-slate-700 mb-1">
                    {t('b2b.form.notes')}
                  </label>
                  <input
                    id="off-notes"
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t('b2b.form.notes_ph')}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white font-bold text-xs transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {submitting ? t('b2b.form.submitting') : t('sub.submit_btn')}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
