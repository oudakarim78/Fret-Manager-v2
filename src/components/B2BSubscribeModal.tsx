import React, { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, ShieldCheck } from 'lucide-react';
import type {
  B2BDeploymentRequest,
  B2BPackCatalogItem,
  B2BPackId,
  CompanySettings,
  Currency,
  PublicProfile,
} from '../types.ts';
import { api } from '../lib/api.ts';
import { useI18n } from '../lib/i18n.tsx';
import { persistB2BRequest } from '../lib/persistence.ts';
import { InfoBanner, Modal } from './UI.tsx';

interface B2BSubscribeModalProps {
  open: boolean;
  onClose: () => void;
  profile?: PublicProfile | null;
  defaultEmail?: string;
  isBlocked?: boolean;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
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
    deliverables: [],
  },
];

export function B2BSubscribeModal({
  open,
  onClose,
  profile,
  defaultEmail,
  isBlocked,
  notify,
}: B2BSubscribeModalProps) {
  const { t, packText, packNameById, lang } = useI18n();
  const [packs, setPacks] = useState<B2BPackCatalogItem[]>(FALLBACK_PACKS);
  const [loadingPacks, setLoadingPacks] = useState(false);
  const [currency, setCurrency] = useState<Currency>('MAD');
  const [selectedPack, setSelectedPack] = useState<B2BPackId>('pack_flotte_gps');

  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [fleetSize, setFleetSize] = useState('10');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<B2BDeploymentRequest | null>(null);

  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setSubmitted(null);
    setLoadingPacks(true);

    let active = true;
    const isAdmin = profile?.role === 'admin';

    const loadCatalog = isAdmin
      ? Promise.all([
          api<{
            packCatalog?: B2BPackCatalogItem[];
            usage?: { vehicles: number };
            license?: { currency?: Currency };
          }>('/api/b2b/my-license'),
          api<CompanySettings>('/api/company').catch(() => null),
        ]).then(([licRes, comp]) => {
          if (!active) return;
          if (licRes.packCatalog && licRes.packCatalog.length > 0) {
            setPacks(licRes.packCatalog);
            const featured =
              licRes.packCatalog.find((p) => p.is_featured) || licRes.packCatalog[0];
            if (featured && !licRes.packCatalog.some((p) => p.id === selectedPack)) {
              setSelectedPack(featured.id);
            }
          }
          if (licRes.license?.currency) {
            setCurrency(licRes.license.currency);
          }
          setCompanyName(comp?.company_name || profile.workspace_name || '');
          setContactName(profile.full_name || '');
          setEmail(profile.email || comp?.email || '');
          setPhone(comp?.phone || '');
          setFleetSize(String(Math.max(1, licRes.usage?.vehicles || 5)));
        })
      : api<B2BPackCatalogItem[]>('/api/b2b/packs').then((list) => {
          if (!active) return;
          if (Array.isArray(list) && list.length > 0) {
            setPacks(list);
            const featured = list.find((p) => p.is_featured) || list[0];
            if (featured && !list.some((p) => p.id === selectedPack)) {
              setSelectedPack(featured.id);
            }
          }
          if (defaultEmail) setEmail(defaultEmail);
        });

    loadCatalog
      .catch(() => {
        // Keep fallback catalog silently
      })
      .finally(() => {
        if (active) setLoadingPacks(false);
      });

    return () => {
      active = false;
    };
  }, [open, profile, defaultEmail]);

  function handleSelectPack(packId: B2BPackId) {
    setSelectedPack(packId);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const isAdmin = profile?.role === 'admin';
      const created = isAdmin
        ? await api<B2BDeploymentRequest>('/api/b2b/my-license/upgrade-request', {
            method: 'POST',
            body: JSON.stringify({
              pack: selectedPack,
              currency,
              fleet_size: Number(fleetSize) || 5,
              phone: phone.trim(),
              notes: notes.trim() || undefined,
            }),
          })
        : await api<B2BDeploymentRequest>('/api/b2b/requests', {
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

      if (!isAdmin) {
        await persistB2BRequest(created).catch(() => {});
      }
      setSubmitted(created);
      notify(t('b2b.form.success_toast'), 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur d’envoi.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const localeStr = lang === 'en' ? 'en-GB' : lang === 'es' ? 'es-ES' : 'fr-FR';
  const unit = currency === 'EUR' ? '€' : 'MAD';
  const isAdmin = profile?.role === 'admin';

  return (
    <Modal open={open} onClose={onClose} title={t('sub.modal_title')} maxWidth="max-w-5xl">
      <div className="space-y-6">
        {isBlocked && <InfoBanner tone="warning">{t('sub.blocked_note')}</InfoBanner>}

        {/* Intro + MAD/EUR Currency Switcher */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm text-slate-600 max-w-2xl leading-relaxed">{t('sub.modal_sub')}</p>

          <div className="inline-flex items-center p-1 bg-slate-100 border border-slate-200 rounded-lg self-start shrink-0">
            <button
              type="button"
              onClick={() => setCurrency('MAD')}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                currency === 'MAD' ? 'bg-[#17324d] text-white' : 'text-slate-600 hover:text-[#17324d]'
              }`}
            >
              {t('b2b.packs.mad')}
            </button>
            <button
              type="button"
              onClick={() => setCurrency('EUR')}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                currency === 'EUR' ? 'bg-[#17324d] text-white' : 'text-slate-600 hover:text-[#17324d]'
              }`}
            >
              {t('b2b.packs.eur')}
            </button>
          </div>
        </div>

        {/* 3-Column B2B Pack Catalog */}
        {loadingPacks ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div key={idx} className="h-72 rounded-xl border border-slate-200 bg-slate-50 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
            {packs.map((pack) => {
              const isSelected = selectedPack === pack.id;
              const isFeatured =
                pack.is_featured !== undefined ? pack.is_featured : pack.id === 'pack_flotte_gps';
              const setup = currency === 'EUR' ? pack.setup_fee_eur : pack.setup_fee_mad;
              const annual = currency === 'EUR' ? pack.annual_fee_eur : pack.annual_fee_mad;
              const loc = packText(pack);

              return (
                <div
                  key={pack.id}
                  onClick={() => handleSelectPack(pack.id)}
                  className={`cursor-pointer rounded-xl border p-5 flex flex-col justify-between transition-colors ${
                    isSelected
                      ? 'border-[#2367a5] ring-1 ring-[#2367a5] bg-[#f7fafd]'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-base font-extrabold text-[#17324d]">{loc.name}</h3>
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

                    <p className="text-xs text-slate-600 mt-1.5 leading-relaxed min-h-[34px]">
                      {loc.audience}
                    </p>

                    <div className="mt-4 pb-4 border-b border-slate-200">
                      <div className="text-[11px] font-semibold text-slate-500">
                        {t('b2b.packs.setup_label')}
                      </div>
                      <div className="mt-1 flex items-baseline gap-1.5">
                        <span className="font-mono text-2xl font-extrabold text-[#17324d] tabular-nums">
                          {setup.toLocaleString(localeStr)} {unit}
                        </span>
                        <span className="text-xs text-slate-500">{t('b2b.packs.ht_once')}</span>
                      </div>
                      <div className="mt-1.5 text-xs text-slate-700 font-medium">
                        +{' '}
                        <span className="font-mono font-bold tabular-nums text-[#17324d]">
                          {annual.toLocaleString(localeStr)} {unit}
                        </span>{' '}
                        <span className="text-slate-500">{t('b2b.packs.annual_suffix')}</span>
                      </div>
                    </div>

                    <div className="mt-3.5 grid grid-cols-3 gap-2 text-center border border-slate-200 bg-white rounded-lg p-2">
                      <div>
                        <div className="font-mono text-xs font-bold text-[#17324d] tabular-nums">
                          {pack.max_vehicles >= 900 ? t('b2b.packs.unlimited') : pack.max_vehicles}
                        </div>
                        <div className="text-[10px] text-slate-500">{t('b2b.packs.vehicles')}</div>
                      </div>
                      <div>
                        <div className="font-mono text-xs font-bold text-[#17324d] tabular-nums">
                          {pack.max_users >= 900 ? t('b2b.packs.unlimited') : pack.max_users}
                        </div>
                        <div className="text-[10px] text-slate-500">{t('b2b.packs.accounts')}</div>
                      </div>
                      <div>
                        <div className="font-mono text-xs font-bold text-[#17324d]">
                          {pack.gps_enabled ? t('b2b.packs.included') : t('b2b.packs.option')}
                        </div>
                        <div className="text-[10px] text-slate-500">{t('b2b.packs.gps')}</div>
                      </div>
                    </div>

                    <ul className="mt-4 space-y-2 text-xs text-slate-700">
                      {loc.deliverables.map((item) => (
                        <li key={item} className="flex items-start gap-2">
                          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                          <span className="leading-snug">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectPack(pack.id);
                    }}
                    className={`mt-5 w-full py-2 px-4 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                      isSelected
                        ? 'bg-[#2367a5] text-white'
                        : 'bg-white hover:bg-slate-50 text-[#17324d] border border-slate-300'
                    }`}
                  >
                    {isSelected ? t('sub.selected_label') : t('sub.choose_pack')}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Linked Subscription Request Form */}
        <div className="border-t border-slate-200 pt-5">
          {submitted ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-6 space-y-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-base font-extrabold text-emerald-900">
                    {t('b2b.form.success_title')}
                  </h4>
                  <p className="text-sm text-emerald-900/80 mt-1">{t('sub.success_msg')}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white border border-emerald-200/80 rounded-lg p-3.5 text-xs text-slate-700">
                <div>
                  <span className="text-slate-500">{t('b2b.form.success_ref')}</span>{' '}
                  <span className="font-mono font-bold text-[#17324d]">{submitted.id}</span>
                </div>
                <div>
                  <span className="text-slate-500">Pack :</span>{' '}
                  <span className="font-bold text-[#17324d]">{packNameById(submitted.pack)}</span>
                </div>
                <div>
                  <span className="text-slate-500">{t('b2b.form.success_curr')}</span>{' '}
                  <span className="font-mono font-bold text-[#17324d]">{submitted.currency}</span>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-[#17324d] hover:bg-[#1f4264] text-white text-xs font-bold transition-colors"
                >
                  {t('common.close')}
                </button>
              </div>
            </div>
          ) : (
            <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-base font-extrabold text-[#17324d]">{t('b2b.form.title')}</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {packNameById(selectedPack)} · {currency}
                    {profile?.workspace_code ? ` · ${profile.workspace_code}` : ''}
                  </p>
                </div>
                <ShieldCheck className="w-5 h-5 text-[#2367a5] shrink-0" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label htmlFor="sub-company" className="block text-xs font-bold text-slate-700 mb-1.5">
                    {t('b2b.form.company')}
                  </label>
                  <input
                    id="sub-company"
                    type="text"
                    required
                    disabled={isAdmin}
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Atlas Sud SARL"
                    className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5] disabled:bg-slate-100 disabled:text-slate-600"
                  />
                </div>
                <div>
                  <label htmlFor="sub-contact" className="block text-xs font-bold text-slate-700 mb-1.5">
                    {t('b2b.form.contact')}
                  </label>
                  <input
                    id="sub-contact"
                    type="text"
                    required
                    disabled={isAdmin}
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5] disabled:bg-slate-100 disabled:text-slate-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label htmlFor="sub-phone" className="block text-xs font-bold text-slate-700 mb-1.5">
                    {t('b2b.form.phone')}
                  </label>
                  <input
                    id="sub-phone"
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+212 6 00 00 00 00"
                    className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                  />
                </div>
                <div>
                  <label htmlFor="sub-email" className="block text-xs font-bold text-slate-700 mb-1.5">
                    {t('b2b.form.email')}
                  </label>
                  <input
                    id="sub-email"
                    type="email"
                    required
                    disabled={isAdmin}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="direction@entreprise.ma"
                    className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5] disabled:bg-slate-100 disabled:text-slate-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label htmlFor="sub-pack" className="block text-xs font-bold text-slate-700 mb-1.5">
                    {t('b2b.form.pack')}
                  </label>
                  <select
                    id="sub-pack"
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
                  <label htmlFor="sub-fleet" className="block text-xs font-bold text-slate-700 mb-1.5">
                    {t('b2b.form.fleet')}
                  </label>
                  <input
                    id="sub-fleet"
                    type="number"
                    min={1}
                    max={500}
                    value={fleetSize}
                    onChange={(e) => setFleetSize(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                  />
                </div>

                <div>
                  <label htmlFor="sub-currency" className="block text-xs font-bold text-slate-700 mb-1.5">
                    {t('b2b.form.currency')}
                  </label>
                  <select
                    id="sub-currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as Currency)}
                    className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#2367a5]"
                  >
                    <option value="MAD">MAD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="sub-notes" className="block text-xs font-bold text-slate-700 mb-1.5">
                  {t('b2b.form.notes')}
                </label>
                <textarea
                  id="sub-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('b2b.form.notes_ph')}
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white text-xs font-bold transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {submitting ? t('b2b.form.submitting') : t('sub.submit_btn')}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </Modal>
  );
}
