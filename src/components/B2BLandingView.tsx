import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Play, ShieldCheck, Truck } from 'lucide-react';
import type { B2BDeploymentRequest, B2BPackCatalogItem, B2BPackId, Currency } from '../types.ts';
import { api } from '../lib/api.ts';
import { persistB2BRequest } from '../lib/persistence.ts';
import { LanguageSwitcher, useI18n } from '../lib/i18n.tsx';
import heroFreightImg from '../assets/images/hero_freight_logistics_1794663208024.jpg';

interface B2BLandingViewProps {
  onOpenAuth: (mode?: 'login' | 'register') => void;
  onStartDemo: () => void;
  demoLoading: boolean;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const FALLBACK_PACKS: B2BPackCatalogItem[] = [
  {
    id: 'pack_essentiel',
    name: 'Pack Essentiel PME',
    audience: 'Transporteurs de 1 à 8 véhicules',
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
    audience: 'Flottes de 9 à 30 camions',
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
    audience: 'Flotte illimitée',
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

export function B2BLandingView({ onOpenAuth, onStartDemo, demoLoading, notify }: B2BLandingViewProps) {
  const { t, packText, packNameById, lang } = useI18n();
  const [packs, setPacks] = useState<B2BPackCatalogItem[]>(FALLBACK_PACKS);
  const [currency, setCurrency] = useState<Currency>('MAD');
  const [selectedPack, setSelectedPack] = useState<B2BPackId>('pack_flotte_gps');

  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [fleetSize, setFleetSize] = useState('12');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedRequest, setSubmittedRequest] = useState<B2BDeploymentRequest | null>(null);

  const formRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    api<B2BPackCatalogItem[]>('/api/b2b/packs')
      .then((data) => {
        if (active && Array.isArray(data) && data.length > 0) setPacks(data);
      })
      .catch(() => {
        // Keep fallback catalog silently
      });
    return () => {
      active = false;
    };
  }, []);

  function scrollToForm(packId?: B2BPackId) {
    if (packId) setSelectedPack(packId);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      await persistB2BRequest(created).catch(() => {});
      setSubmittedRequest(created);
      notify(t('b2b.form.success_toast'), 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Error', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const localeStr = lang === 'en' ? 'en-GB' : lang === 'es' ? 'es-ES' : 'fr-FR';
  const turnkeySteps = [
    { num: '01.', title: t('b2b.step.1.title'), desc: t('b2b.step.1.desc') },
    { num: '02.', title: t('b2b.step.2.title'), desc: t('b2b.step.2.desc') },
    { num: '03.', title: t('b2b.step.3.title'), desc: t('b2b.step.3.desc') },
    { num: '04.', title: t('b2b.step.4.title'), desc: t('b2b.step.4.desc') },
  ];

  return (
    <div className="min-h-screen bg-[#f3f6f9] text-[#17324d]">
      {/* Commercial Top Bar */}
      <header className="sticky top-0 z-30 bg-[#0e2236]/95 backdrop-blur border-b border-white/10 text-white px-5 sm:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-[#2367a5]">
            <Truck className="w-4 h-4 text-white" />
          </div>
          <span className="text-base sm:text-lg font-extrabold tracking-tight truncate">
            {t('app.brand')}
          </span>
          <span className="hidden md:inline text-xs text-slate-300 truncate">
            · {t('app.tagline')}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 shrink-0">
          <LanguageSwitcher variant="dark" />
          <button
            type="button"
            onClick={() => onOpenAuth('login')}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors whitespace-nowrap"
          >
            {t('b2b.hero.cta_login')}
          </button>
          <button
            type="button"
            onClick={() => onOpenAuth('register')}
            className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition-colors whitespace-nowrap"
          >
            {t('b2b.form.btn_trial')}
          </button>
        </div>
      </header>

      {/* Hero Banner */}
      <section className="relative bg-[#10243a] text-white overflow-hidden">
        <img
          src={heroFreightImg}
          alt={t('b2b.hero.kicker')}
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover opacity-35"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0e2236]/95 via-[#17324d]/85 to-[#17324d]/60" />

        <div className="relative max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20">
          <div className="max-w-3xl">
            <div className="text-xs font-bold uppercase tracking-wider text-sky-300 mb-3">
              {t('b2b.hero.kicker')}
            </div>
            <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight leading-[1.15] [text-wrap:balance]">
              {t('b2b.hero.title')}
            </h1>
            <p className="mt-5 text-base sm:text-lg text-slate-200 leading-relaxed max-w-2xl">
              {t('b2b.hero.sub')}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => scrollToForm('pack_flotte_gps')}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-[#2367a5] hover:bg-[#2d79be] text-white font-bold text-sm transition-colors"
              >
                {t('b2b.hero.cta_primary')}
                <ArrowRight className="w-4 h-4 rtl:rotate-180" />
              </button>

              <button
                type="button"
                disabled={demoLoading}
                onClick={onStartDemo}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-white/10 hover:bg-white/20 text-white font-semibold text-sm border border-white/20 transition-colors disabled:opacity-50"
              >
                <Play className="w-4 h-4" />
                {demoLoading ? t('b2b.hero.cta_opening') : t('b2b.hero.cta_demo')}
              </button>

              <button
                type="button"
                onClick={() => onOpenAuth('login')}
                className="px-4 py-3 text-sm font-semibold text-slate-200 hover:text-white transition-colors"
              >
                {t('b2b.hero.cta_login')}
              </button>
            </div>
          </div>

          <div className="mt-12 pt-8 border-t border-white/15 grid grid-cols-2 sm:grid-cols-4 gap-6 text-sm">
            <div>
              <div className="font-mono text-2xl font-bold tabular-nums text-white">{t('b2b.stat.1_v')}</div>
              <div className="text-slate-300 mt-1">{t('b2b.stat.1_l')}</div>
            </div>
            <div>
              <div className="font-mono text-2xl font-bold tabular-nums text-white">{t('b2b.stat.2_v')}</div>
              <div className="text-slate-300 mt-1">{t('b2b.stat.2_l')}</div>
            </div>
            <div>
              <div className="font-mono text-2xl font-bold tabular-nums text-white">{t('b2b.stat.3_v')}</div>
              <div className="text-slate-300 mt-1">{t('b2b.stat.3_l')}</div>
            </div>
            <div>
              <div className="font-mono text-2xl font-bold tabular-nums text-white">{t('b2b.stat.4_v')}</div>
              <div className="text-slate-300 mt-1">{t('b2b.stat.4_l')}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Turnkey Packs Section */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 py-14">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#17324d]">
              {t('b2b.packs.title')}
            </h2>
            <p className="text-sm text-slate-600 mt-1.5 max-w-2xl">{t('b2b.packs.sub')}</p>
          </div>

          <div className="inline-flex items-center p-1 bg-white border border-slate-200 rounded-lg self-start">
            <button
              type="button"
              onClick={() => setCurrency('MAD')}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition-colors ${
                currency === 'MAD' ? 'bg-[#17324d] text-white' : 'text-slate-600 hover:text-[#17324d]'
              }`}
            >
              {t('b2b.packs.mad')}
            </button>
            <button
              type="button"
              onClick={() => setCurrency('EUR')}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition-colors ${
                currency === 'EUR' ? 'bg-[#17324d] text-white' : 'text-slate-600 hover:text-[#17324d]'
              }`}
            >
              {t('b2b.packs.eur')}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
          {packs.map((pack) => {
            const featured = pack.is_featured ?? pack.id === 'pack_flotte_gps';
            const setup = currency === 'EUR' ? pack.setup_fee_eur : pack.setup_fee_mad;
            const annual = currency === 'EUR' ? pack.annual_fee_eur : pack.annual_fee_mad;
            const unit = currency === 'EUR' ? '€' : 'MAD';
            const loc = packText(pack);

            return (
              <div
                key={pack.id}
                className={`bg-white rounded-xl border p-6 flex flex-col justify-between transition-shadow ${
                  featured
                    ? 'border-[#2367a5] ring-1 ring-[#2367a5] shadow-md'
                    : 'border-slate-200 shadow-sm'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-extrabold text-[#17324d]">{loc.name}</h3>
                    {featured && (
                      <span className="text-[11px] font-bold uppercase tracking-wide text-[#2367a5]">
                        {t('b2b.packs.recommended')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 mt-1.5 leading-relaxed min-h-[36px]">
                    {loc.audience}
                  </p>

                  <div className="mt-5 pb-5 border-b border-slate-200">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      {t('b2b.packs.setup_label')}
                    </div>
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <span className="font-mono text-3xl font-extrabold text-[#17324d] tabular-nums">
                        {setup.toLocaleString(localeStr)} {unit}
                      </span>
                      <span className="text-xs text-slate-500">{t('b2b.packs.ht_once')}</span>
                    </div>
                    <div className="mt-2 text-sm text-slate-700 font-medium">
                      +{' '}
                      <span className="font-mono font-bold tabular-nums text-[#17324d]">
                        {annual.toLocaleString(localeStr)} {unit}
                      </span>{' '}
                      <span className="text-xs text-slate-500">{t('b2b.packs.annual_suffix')}</span>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 text-center bg-[#f7fafd] border border-slate-200/80 rounded-lg p-2.5">
                    <div>
                      <div className="font-mono text-sm font-bold text-[#17324d] tabular-nums">
                        {pack.max_vehicles >= 900 ? t('b2b.packs.unlimited') : pack.max_vehicles}
                      </div>
                      <div className="text-[11px] text-slate-500">{t('b2b.packs.vehicles')}</div>
                    </div>
                    <div>
                      <div className="font-mono text-sm font-bold text-[#17324d] tabular-nums">
                        {pack.max_users >= 900 ? t('b2b.packs.unlimited') : pack.max_users}
                      </div>
                      <div className="text-[11px] text-slate-500">{t('b2b.packs.accounts')}</div>
                    </div>
                    <div>
                      <div className="font-mono text-sm font-bold text-[#17324d]">
                        {pack.gps_enabled ? t('b2b.packs.included') : t('b2b.packs.option')}
                      </div>
                      <div className="text-[11px] text-slate-500">{t('b2b.packs.gps')}</div>
                    </div>
                  </div>

                  <ul className="mt-5 space-y-2.5 text-sm text-slate-700">
                    {loc.deliverables.map((item) => (
                      <li key={item} className="flex items-start gap-2.5">
                        <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        <span className="leading-snug">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={() => scrollToForm(pack.id)}
                  className={`mt-6 w-full py-2.5 px-4 rounded-lg text-sm font-bold transition-colors ${
                    featured
                      ? 'bg-[#2367a5] hover:bg-[#1c5589] text-white'
                      : 'bg-[#f3f6f9] hover:bg-[#e5edf5] text-[#17324d] border border-slate-300'
                  }`}
                >
                  {t('b2b.packs.choose', { name: loc.name })}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* 4-Step Deployment Process */}
      <section className="bg-white border-y border-slate-200">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-12">
          <h2 className="text-2xl font-extrabold text-[#17324d]">{t('b2b.steps.title')}</h2>
          <p className="text-sm text-slate-600 mt-1">{t('b2b.steps.sub')}</p>

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {turnkeySteps.map((step) => (
              <div key={step.num} className="border-t-2 border-[#17324d] pt-4">
                <div className="font-mono text-sm font-bold text-[#2367a5]">{step.num}</div>
                <h3 className="text-base font-bold text-[#17324d] mt-1">{step.title}</h3>
                <p className="text-sm text-slate-600 mt-2 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Lead Capture / Deployment Request Form */}
      <section ref={formRef} className="max-w-6xl mx-auto px-5 sm:px-8 py-14">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-5 space-y-4">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-[#17324d] tracking-tight">
              {t('b2b.form.title')}
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">{t('b2b.form.sub')}</p>

            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <Truck className="w-5 h-5 text-[#2367a5] shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-[#17324d]">{t('b2b.form.feat1_title')}</div>
                  <div className="text-xs text-slate-600 mt-0.5">{t('b2b.form.feat1_desc')}</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-[#17324d]">{t('b2b.form.feat2_title')}</div>
                  <div className="text-xs text-slate-600 mt-0.5">{t('b2b.form.feat2_desc')}</div>
                </div>
              </div>
            </div>

            <div className="pt-2 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onOpenAuth('register')}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-[#17324d] transition-colors"
              >
                {t('b2b.form.btn_trial')}
              </button>
              <button
                type="button"
                disabled={demoLoading}
                onClick={onStartDemo}
                className="px-4 py-2 rounded-lg bg-[#17324d] hover:bg-[#22476b] text-white text-xs font-bold transition-colors disabled:opacity-50"
              >
                {demoLoading ? t('b2b.hero.cta_opening') : t('b2b.form.btn_demo')}
              </button>
            </div>
          </div>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 sm:p-7 shadow-sm">
            {submittedRequest ? (
              <div className="space-y-4">
                <div className="text-lg font-extrabold text-emerald-800">{t('b2b.form.success_title')}</div>
                <p className="text-sm text-slate-700 leading-relaxed">
                  <strong>{submittedRequest.contact_name}</strong> —{' '}
                  <strong>{submittedRequest.company_name}</strong> (
                  {packNameById(submittedRequest.pack)})
                </p>
                <div className="bg-[#f7fafd] border border-slate-200 rounded-lg p-4 text-xs text-slate-700 space-y-1">
                  <div>
                    {t('b2b.form.success_ref')}{' '}
                    <span className="font-mono font-bold">{submittedRequest.id}</span>
                  </div>
                  <div>
                    {t('b2b.form.success_fleet')}{' '}
                    <span className="font-mono font-bold">{submittedRequest.fleet_size}</span>
                  </div>
                  <div>
                    {t('b2b.form.success_curr')}{' '}
                    <span className="font-mono font-bold">{submittedRequest.currency}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 pt-2">
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
                    className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-[#17324d] hover:bg-slate-50"
                  >
                    {t('b2b.form.another')}
                  </button>
                  <button
                    type="button"
                    disabled={demoLoading}
                    onClick={onStartDemo}
                    className="px-4 py-2 rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white text-sm font-bold disabled:opacity-50"
                  >
                    {demoLoading ? t('b2b.hero.cta_opening') : t('b2b.form.test_while')}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label htmlFor="b2b-company" className="block text-xs font-bold text-slate-700 mb-1.5">
                      {t('b2b.form.company')}
                    </label>
                    <input
                      id="b2b-company"
                      type="text"
                      required
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Atlas Sud SARL"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                    />
                  </div>
                  <div>
                    <label htmlFor="b2b-contact" className="block text-xs font-bold text-slate-700 mb-1.5">
                      {t('b2b.form.contact')}
                    </label>
                    <input
                      id="b2b-contact"
                      type="text"
                      required
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label htmlFor="b2b-phone" className="block text-xs font-bold text-slate-700 mb-1.5">
                      {t('b2b.form.phone')}
                    </label>
                    <input
                      id="b2b-phone"
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+212 6 00 00 00 00"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                    />
                  </div>
                  <div>
                    <label htmlFor="b2b-email" className="block text-xs font-bold text-slate-700 mb-1.5">
                      {t('b2b.form.email')}
                    </label>
                    <input
                      id="b2b-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="direction@entreprise.ma"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <div>
                    <label htmlFor="b2b-pack" className="block text-xs font-bold text-slate-700 mb-1.5">
                      {t('b2b.form.pack')}
                    </label>
                    <select
                      id="b2b-pack"
                      value={selectedPack}
                      onChange={(e) => setSelectedPack(e.target.value as B2BPackId)}
                      className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#2367a5]"
                    >
                      {packs.map((p) => (
                        <option key={p.id} value={p.id}>
                          {packNameById(p.id, p.name)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="b2b-fleet" className="block text-xs font-bold text-slate-700 mb-1.5">
                      {t('b2b.form.fleet')}
                    </label>
                    <input
                      id="b2b-fleet"
                      type="number"
                      min={1}
                      max={500}
                      value={fleetSize}
                      onChange={(e) => setFleetSize(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                    />
                  </div>

                  <div>
                    <label htmlFor="b2b-currency" className="block text-xs font-bold text-slate-700 mb-1.5">
                      {t('b2b.form.currency')}
                    </label>
                    <select
                      id="b2b-currency"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value as Currency)}
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#2367a5]"
                    >
                      <option value="MAD">MAD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="b2b-notes" className="block text-xs font-bold text-slate-700 mb-1.5">
                    {t('b2b.form.notes')}
                  </label>
                  <textarea
                    id="b2b-notes"
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t('b2b.form.notes_ph')}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2367a5]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 px-5 rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  {submitting ? t('b2b.form.submitting') : t('b2b.form.submit')}
                </button>
              </form>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
