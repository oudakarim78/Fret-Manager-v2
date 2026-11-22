import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, Layers, RotateCcw, Server, ShieldCheck, TrendingUp } from 'lucide-react';
import type { B2BPackCatalogItem, B2BPackId, Currency } from '../types.ts';
import { api } from '../lib/api.ts';
import { getActiveLocale, money } from '../lib/format.ts';
import { useI18n } from '../lib/i18n.tsx';
import { InfoBanner } from './UI.tsx';

const DEFAULT_PACKS: B2BPackCatalogItem[] = [
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
    audience: 'Flottes actives de 9 à 30 camions',
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
    audience: 'Groupes logistiques à fort volume (flotte illimitée)',
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

// Coûts fixes mensuels par défaut exprimés en MAD (taux indicatif 1 EUR = 10 MAD)
const DEFAULT_FIXED_COSTS_MAD = {
  servers: 1200, // Hébergement cloud, base de données managée, sauvegardes & stockage justificatifs
  maintenance: 3500, // Correctifs, sécurité, mises à jour réglementaires & évolutions produit
  support: 2500, // Assistance WhatsApp/Tél, onboarding essais & relances renouvellements
  tools: 800, // API cartographie GPS, e-mails transactionnels, monitoring & gestion éditeur
};

const PACK_UNIT_BENCHMARKS: Record<
  B2BPackId,
  {
    onboardingHours: number;
    hourlyCostMad: number;
    annualVariableCostMad: number;
    referenceVehicles: number;
  }
> = {
  demo_gratuit: { onboardingHours: 0, hourlyCostMad: 0, annualVariableCostMad: 150, referenceVehicles: 5 },
  pack_essentiel: { onboardingHours: 6, hourlyCostMad: 300, annualVariableCostMad: 900, referenceVehicles: 8 },
  pack_flotte_gps: { onboardingHours: 12, hourlyCostMad: 300, annualVariableCostMad: 1600, referenceVehicles: 30 },
  pack_entreprise: { onboardingHours: 22, hourlyCostMad: 300, annualVariableCostMad: 2800, referenceVehicles: 60 },
};

export function SaasEconomicsView({
  packs: propPacks,
  livePortfolioCounts,
}: {
  packs?: B2BPackCatalogItem[];
  livePortfolioCounts?: { essentiel: number; flotte: number; entreprise: number };
}) {
  const { t, lang, packNameById } = useI18n();
  const [packs, setPacks] = useState<B2BPackCatalogItem[]>(
    propPacks && propPacks.length > 0 ? propPacks : DEFAULT_PACKS,
  );
  const [currency, setCurrency] = useState<Currency>('MAD');

  // Fixed monthly costs stored in MAD so switching MAD <-> EUR keeps parity (1 EUR = 10 MAD)
  const [fixedMad, setFixedMad] = useState(DEFAULT_FIXED_COSTS_MAD);

  // Portfolio simulator client counts
  const [simCounts, setSimCounts] = useState<{ essentiel: number; flotte: number; entreprise: number }>({
    essentiel: 6,
    flotte: 11,
    entreprise: 3,
  });

  useEffect(() => {
    if (propPacks && propPacks.length > 0) {
      setPacks(propPacks);
      return;
    }
    let active = true;
    api<B2BPackCatalogItem[]>('/api/b2b/packs')
      .then((res) => {
        if (active && Array.isArray(res) && res.length > 0) setPacks(res);
      })
      .catch(() => {
        // Keep fallback catalog silently
      });
    return () => {
      active = false;
    };
  }, [propPacks]);

  const factor = currency === 'EUR' ? 0.1 : 1;
  const toDisplay = (madVal: number) => Math.round(madVal * factor);

  const updateCostField = (key: keyof typeof DEFAULT_FIXED_COSTS_MAD, displayVal: number) => {
    const clean = Number.isFinite(displayVal) && displayVal >= 0 ? displayVal : 0;
    const asMad = currency === 'EUR' ? clean * 10 : clean;
    setFixedMad((prev) => ({ ...prev, [key]: asMad }));
  };

  const resetAll = () => {
    setFixedMad(DEFAULT_FIXED_COSTS_MAD);
    setSimCounts({ essentiel: 6, flotte: 11, entreprise: 3 });
  };

  const fixedItems = useMemo(
    () => [
      {
        key: 'servers' as const,
        title: t('econ.cost.servers.title'),
        desc: t('econ.cost.servers.desc'),
        monthlyMad: fixedMad.servers,
      },
      {
        key: 'maintenance' as const,
        title: t('econ.cost.maint.title'),
        desc: t('econ.cost.maint.desc'),
        monthlyMad: fixedMad.maintenance,
      },
      {
        key: 'support' as const,
        title: t('econ.cost.support.title'),
        desc: t('econ.cost.support.desc'),
        monthlyMad: fixedMad.support,
      },
      {
        key: 'tools' as const,
        title: t('econ.cost.tools.title'),
        desc: t('econ.cost.tools.desc'),
        monthlyMad: fixedMad.tools,
      },
    ],
    [fixedMad, t],
  );

  const totalMonthlyFixedMad = fixedItems.reduce((acc, item) => acc + item.monthlyMad, 0);
  const totalAnnualFixedMad = totalMonthlyFixedMad * 12;

  const packAnalysis = useMemo(() => {
    return packs.map((p) => {
      const bench = PACK_UNIT_BENCHMARKS[p.id] || PACK_UNIT_BENCHMARKS.pack_essentiel;
      const setupFee = currency === 'EUR' ? p.setup_fee_eur : p.setup_fee_mad;
      const annualFee = currency === 'EUR' ? p.annual_fee_eur : p.annual_fee_mad;
      const onboardingCost = toDisplay(bench.onboardingHours * bench.hourlyCostMad);
      const setupMargin = setupFee - onboardingCost;
      const variableAnnualCost = toDisplay(bench.annualVariableCostMad);
      const unitContribution = Math.max(1, annualFee - variableAnnualCost);
      const annualFixedDisplay = toDisplay(totalAnnualFixedMad);
      const breakEvenClients =
        annualFixedDisplay > 0 ? Math.ceil(annualFixedDisplay / unitContribution) : 0;
      const monthlyPerVehicle =
        bench.referenceVehicles > 0 ? annualFee / 12 / bench.referenceVehicles : 0;
      return {
        pack: p,
        setupFee,
        annualFee,
        monthlyFee: annualFee / 12,
        onboardingHours: bench.onboardingHours,
        onboardingCost,
        setupMargin,
        variableAnnualCost,
        unitContribution,
        breakEvenClients,
        monthlyPerVehicle,
        referenceVehicles: bench.referenceVehicles,
      };
    });
  }, [packs, currency, totalAnnualFixedMad]);

  const simulation = useMemo(() => {
    const pEss = packs.find((p) => p.id === 'pack_essentiel') || DEFAULT_PACKS[0];
    const pFlotte = packs.find((p) => p.id === 'pack_flotte_gps') || DEFAULT_PACKS[1];
    const pEnt = packs.find((p) => p.id === 'pack_entreprise') || DEFAULT_PACKS[2];

    const getAnnual = (p: B2BPackCatalogItem) => (currency === 'EUR' ? p.annual_fee_eur : p.annual_fee_mad);
    const getSetup = (p: B2BPackCatalogItem) => (currency === 'EUR' ? p.setup_fee_eur : p.setup_fee_mad);

    const totalClients = simCounts.essentiel + simCounts.flotte + simCounts.entreprise;
    const arr =
      simCounts.essentiel * getAnnual(pEss) +
      simCounts.flotte * getAnnual(pFlotte) +
      simCounts.entreprise * getAnnual(pEnt);
    const setupRevenue =
      simCounts.essentiel * getSetup(pEss) +
      simCounts.flotte * getSetup(pFlotte) +
      simCounts.entreprise * getSetup(pEnt);
    const setupDirectCost =
      simCounts.essentiel *
        toDisplay(PACK_UNIT_BENCHMARKS.pack_essentiel.onboardingHours * PACK_UNIT_BENCHMARKS.pack_essentiel.hourlyCostMad) +
      simCounts.flotte *
        toDisplay(PACK_UNIT_BENCHMARKS.pack_flotte_gps.onboardingHours * PACK_UNIT_BENCHMARKS.pack_flotte_gps.hourlyCostMad) +
      simCounts.entreprise *
        toDisplay(PACK_UNIT_BENCHMARKS.pack_entreprise.onboardingHours * PACK_UNIT_BENCHMARKS.pack_entreprise.hourlyCostMad);

    const variableAnnual =
      simCounts.essentiel * toDisplay(PACK_UNIT_BENCHMARKS.pack_essentiel.annualVariableCostMad) +
      simCounts.flotte * toDisplay(PACK_UNIT_BENCHMARKS.pack_flotte_gps.annualVariableCostMad) +
      simCounts.entreprise * toDisplay(PACK_UNIT_BENCHMARKS.pack_entreprise.annualVariableCostMad);

    const fixedAnnual = toDisplay(totalAnnualFixedMad);
    const recurringNet = arr - variableAnnual - fixedAnnual;
    const recurringMarginPct = arr > 0 ? (recurringNet / arr) * 100 : 0;
    const year1TotalRevenue = arr + setupRevenue;
    const year1Net = year1TotalRevenue - setupDirectCost - variableAnnual - fixedAnnual;

    const avgUnitContribution = totalClients > 0 ? (arr - variableAnnual) / totalClients : 0;
    const weightedBreakEven =
      avgUnitContribution > 0 ? Math.ceil(fixedAnnual / avgUnitContribution) : 0;

    return {
      totalClients,
      arr,
      setupRevenue,
      setupDirectCost,
      variableAnnual,
      fixedAnnual,
      recurringNet,
      recurringMarginPct,
      year1TotalRevenue,
      year1Net,
      weightedBreakEven,
    };
  }, [packs, simCounts, currency, totalAnnualFixedMad]);

  const locale = getActiveLocale(lang);

  return (
    <div className="space-y-5">
      {/* Top Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold text-[#17324d] flex items-center gap-2">
            <Calculator className="w-4 h-4 text-[#2367a5]" />
            {t('econ.header.title')}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">{t('econ.header.sub')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setCurrency('MAD')}
              className={`px-3 py-1.5 text-xs font-bold rounded-md ${
                currency === 'MAD' ? 'bg-[#17324d] text-white' : 'text-slate-600'
              }`}
            >
              MAD
            </button>
            <button
              type="button"
              onClick={() => setCurrency('EUR')}
              className={`px-3 py-1.5 text-xs font-bold rounded-md ${
                currency === 'EUR' ? 'bg-[#17324d] text-white' : 'text-slate-600'
              }`}
            >
              EUR
            </button>
          </div>
          <button
            type="button"
            onClick={resetAll}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {t('econ.reset')}
          </button>
        </div>
      </div>

      <InfoBanner>{t('econ.banner')}</InfoBanner>

      {/* 3 Executive Summary KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-semibold text-slate-500">{t('econ.kpi.fixed')}</div>
          <div className="font-mono text-2xl font-extrabold text-[#17324d] mt-1 tabular-nums">
            {money(toDisplay(totalMonthlyFixedMad), currency, lang)} <span className="text-xs font-semibold text-slate-500">/ {t('econ.month')}</span>
          </div>
          <div className="text-xs font-mono text-slate-500 mt-1 tabular-nums">
            {money(toDisplay(totalAnnualFixedMad), currency, lang)} / {t('econ.year')}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-semibold text-slate-500">{t('econ.kpi.breakeven')}</div>
          <div className="font-mono text-2xl font-extrabold text-[#2367a5] mt-1 tabular-nums">
            {simulation.weightedBreakEven} {t('econ.clients_unit')}
          </div>
          <div className="text-xs text-slate-500 mt-1">{t('econ.kpi.breakeven_sub')}</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-semibold text-slate-500">
            {t('econ.kpi.net_sim', { count: simulation.totalClients })}
          </div>
          <div
            className={`font-mono text-2xl font-extrabold mt-1 tabular-nums ${
              simulation.recurringNet >= 0 ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {money(simulation.recurringNet, currency, lang)}
          </div>
          <div className="text-xs font-mono text-slate-500 mt-1 tabular-nums">
            {t('econ.kpi.margin')} {simulation.recurringMarginPct.toLocaleString(locale, { maximumFractionDigits: 1 })} % · {t('econ.kpi.y1')} {money(simulation.year1Net, currency, lang)}
          </div>
        </div>
      </div>

      {/* Section 1: Fixed Project Costs Breakdown */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-extrabold text-[#17324d] flex items-center gap-2">
              <Server className="w-4 h-4 text-[#2367a5]" />
              {t('econ.sec1.title')}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">{t('econ.sec1.sub')}</p>
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full min-w-[740px] text-start border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                <th className="px-4 py-3">{t('econ.col.category')}</th>
                <th className="px-4 py-3">{t('econ.col.detail')}</th>
                <th className="px-4 py-3 text-end">{t('econ.col.share')}</th>
                <th className="px-4 py-3 text-end">{t('econ.col.monthly')} ({currency})</th>
                <th className="px-4 py-3 text-end">{t('econ.col.annual')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fixedItems.map((item) => {
                const share =
                  totalMonthlyFixedMad > 0 ? (item.monthlyMad / totalMonthlyFixedMad) * 100 : 0;
                const displayMonthly = toDisplay(item.monthlyMad);
                return (
                  <tr key={item.key} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-bold text-[#17324d] whitespace-nowrap">
                      {item.title}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{item.desc}</td>
                    <td className="px-4 py-3 text-end font-mono text-slate-600 tabular-nums">
                      {share.toLocaleString(locale, { maximumFractionDigits: 1 })} %
                    </td>
                    <td className="px-4 py-3 text-end">
                      <input
                        type="number"
                        min={0}
                        step={currency === 'EUR' ? 10 : 100}
                        aria-label={item.title}
                        value={displayMonthly}
                        onChange={(e) => updateCostField(item.key, Number(e.target.value))}
                        className="w-28 px-2.5 py-1.5 text-end font-mono font-semibold text-[#17324d] border border-slate-300 rounded-md bg-white"
                      />
                    </td>
                    <td className="px-4 py-3 text-end font-mono font-bold text-[#17324d] tabular-nums whitespace-nowrap">
                      {money(displayMonthly * 12, currency, lang)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-[#f8fafc] border-t border-slate-200 font-extrabold text-[#17324d]">
                <td colSpan={2} className="px-4 py-3">{t('econ.total_fixed')}</td>
                <td className="px-4 py-3 text-end font-mono">100 %</td>
                <td className="px-4 py-3 text-end font-mono tabular-nums whitespace-nowrap">
                  {money(toDisplay(totalMonthlyFixedMad), currency, lang)}
                </td>
                <td className="px-4 py-3 text-end font-mono tabular-nums whitespace-nowrap">
                  {money(toDisplay(totalAnnualFixedMad), currency, lang)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Section 2: Pricing Logic (Setup + Subscription Calculation Basis) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-extrabold text-[#17324d] flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#2367a5]" />
            {t('econ.sec2.title')}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">{t('econ.sec2.sub')}</p>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full min-w-[860px] text-start border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                <th className="px-3.5 py-3">{t('econ.col.pack')}</th>
                <th className="px-3.5 py-3 text-end">{t('econ.col.setup')}</th>
                <th className="px-3.5 py-3 text-end">{t('econ.col.onb_cost')}</th>
                <th className="px-3.5 py-3 text-end">{t('econ.col.annual_sub')}</th>
                <th className="px-3.5 py-3 text-end">{t('econ.col.per_truck')}</th>
                <th className="px-3.5 py-3 text-end">{t('econ.col.var_cost')}</th>
                <th className="px-3.5 py-3 text-end">{t('econ.col.unit_margin')}</th>
                <th className="px-3.5 py-3 text-end">{t('econ.col.breakeven_pack')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {packAnalysis.map((row) => (
                <tr key={row.pack.id} className="hover:bg-slate-50/70">
                  <td className="px-3.5 py-3">
                    <div className="font-bold text-[#17324d]">{packNameById(row.pack.id, row.pack.name)}</div>
                    <div className="text-[11px] text-slate-500">
                      {row.pack.max_vehicles >= 900 ? '∞' : `≤ ${row.pack.max_vehicles}`} {t('b2b.packs.vehicles')} · {row.onboardingHours}h {t('econ.onboarding')}
                    </div>
                  </td>
                  <td className="px-3.5 py-3 text-end font-mono font-bold text-[#17324d] tabular-nums">
                    {money(row.setupFee, currency, lang)}
                  </td>
                  <td className="px-3.5 py-3 text-end font-mono text-slate-600 tabular-nums">
                    <div>{money(row.onboardingCost, currency, lang)}</div>
                    <div className="text-[11px] text-emerald-700">+{money(row.setupMargin, currency, lang)}</div>
                  </td>
                  <td className="px-3.5 py-3 text-end font-mono font-bold text-[#2367a5] tabular-nums">
                    <div>{money(row.annualFee, currency, lang)}</div>
                    <div className="text-[11px] text-slate-500">({money(row.monthlyFee, currency, lang)}/{t('econ.month')})</div>
                  </td>
                  <td className="px-3.5 py-3 text-end font-mono text-slate-700 tabular-nums">
                    {money(row.monthlyPerVehicle, currency, lang)}
                  </td>
                  <td className="px-3.5 py-3 text-end font-mono text-slate-600 tabular-nums">
                    {money(row.variableAnnualCost, currency, lang)}
                  </td>
                  <td className="px-3.5 py-3 text-end font-mono font-bold text-emerald-700 tabular-nums">
                    {money(row.unitContribution, currency, lang)}
                  </td>
                  <td className="px-3.5 py-3 text-end font-mono font-bold text-[#17324d] tabular-nums">
                    {row.breakEvenClients} {t('econ.clients_unit')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 3 Methodological Rationale Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
          <div className="bg-[#f8fafc] border border-slate-200 rounded-lg p-4 space-y-1.5">
            <div className="text-xs font-extrabold text-[#17324d] flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#2367a5] shrink-0" />
              {t('econ.cause1.title')}
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">{t('econ.cause1.body')}</p>
          </div>
          <div className="bg-[#f8fafc] border border-slate-200 rounded-lg p-4 space-y-1.5">
            <div className="text-xs font-extrabold text-[#17324d] flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-[#2367a5] shrink-0" />
              {t('econ.cause2.title')}
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">{t('econ.cause2.body')}</p>
          </div>
          <div className="bg-[#f8fafc] border border-slate-200 rounded-lg p-4 space-y-1.5">
            <div className="text-xs font-extrabold text-[#17324d] flex items-center gap-1.5">
              <Calculator className="w-3.5 h-3.5 text-[#2367a5] shrink-0" />
              {t('econ.cause3.title')}
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">{t('econ.cause3.body')}</p>
          </div>
        </div>
      </div>

      {/* Section 3: Interactive Client Portfolio Profitability Simulator */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-extrabold text-[#17324d]">{t('econ.sec3.title')}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{t('econ.sec3.sub')}</p>
          </div>
          {livePortfolioCounts && (
            <button
              type="button"
              onClick={() => setSimCounts(livePortfolioCounts)}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-[#eef4f8] hover:bg-[#dce8f3] text-[#17324d]"
            >
              {t('econ.load_live')}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {(
            [
              ['essentiel', 'pack_essentiel'],
              ['flotte', 'pack_flotte_gps'],
              ['entreprise', 'pack_entreprise'],
            ] as Array<[keyof typeof simCounts, B2BPackId]>
          ).map(([key, packId]) => (
            <div key={key} className="border border-slate-200 rounded-lg p-4 bg-[#f8fafc] space-y-2">
              <label htmlFor={`sim-${key}`} className="block text-xs font-bold text-[#17324d]">
                {packNameById(packId)}
              </label>
              <div className="flex items-center gap-3">
                <input
                  id={`sim-${key}`}
                  type="range"
                  min={0}
                  max={50}
                  value={simCounts[key]}
                  onChange={(e) =>
                    setSimCounts((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                  }
                  className="flex-1 accent-[#2367a5]"
                />
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={simCounts[key]}
                  onChange={(e) =>
                    setSimCounts((prev) => ({ ...prev, [key]: Math.max(0, Number(e.target.value) || 0) }))
                  }
                  className="w-16 px-2 py-1 text-center font-mono font-bold text-sm border border-slate-300 rounded-md bg-white"
                />
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1 text-xs">
          <div className="border border-slate-200 rounded-lg p-3.5">
            <div className="text-slate-500">{t('econ.sim.arr')}</div>
            <div className="font-mono text-lg font-extrabold text-[#17324d] mt-1 tabular-nums">
              {money(simulation.arr, currency, lang)}
            </div>
          </div>
          <div className="border border-slate-200 rounded-lg p-3.5">
            <div className="text-slate-500">{t('econ.sim.setup')}</div>
            <div className="font-mono text-lg font-extrabold text-[#2367a5] mt-1 tabular-nums">
              {money(simulation.setupRevenue, currency, lang)}
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5 tabular-nums">
              {t('econ.sim.onb_deduct')} -{money(simulation.setupDirectCost, currency, lang)}
            </div>
          </div>
          <div className="border border-slate-200 rounded-lg p-3.5">
            <div className="text-slate-500">{t('econ.sim.costs')}</div>
            <div className="font-mono text-lg font-extrabold text-slate-800 mt-1 tabular-nums">
              {money(simulation.fixedAnnual + simulation.variableAnnual, currency, lang)}
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5 tabular-nums">
              {money(simulation.fixedAnnual, currency, lang)} + {money(simulation.variableAnnual, currency, lang)}
            </div>
          </div>
          <div className="border border-emerald-200 bg-emerald-50/40 rounded-lg p-3.5">
            <div className="text-emerald-900 font-semibold">{t('econ.sim.net_y2')}</div>
            <div
              className={`font-mono text-lg font-extrabold mt-1 tabular-nums ${
                simulation.recurringNet >= 0 ? 'text-emerald-700' : 'text-red-700'
              }`}
            >
              {money(simulation.recurringNet, currency, lang)}
            </div>
            <div className="text-[11px] font-mono text-slate-600 mt-0.5 tabular-nums">
              {t('econ.sim.net_y1')} {money(simulation.year1Net, currency, lang)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
