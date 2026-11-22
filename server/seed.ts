import crypto from 'node:crypto';
import type {
  B2BDeploymentRequest,
  B2BLicense,
  B2BPackCatalogItem,
  B2BPackId,
  Currency,
  VendorAccount,
  WorkspaceData,
  WorkspaceUser,
} from '../src/types.ts';

export const B2B_PACKS: B2BPackCatalogItem[] = [
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
    logistics_benefit:
      'Structuration des ordres de mission, bons de livraison POD, suivi entretien & facturation TVA MAD/EUR.',
    deliverables: [
      'Déploiement dédié avec votre code entreprise & logo',
      'Import initial de votre parc véhicules, conducteurs et clients (ICE)',
      'Paramétrage numérotation factures (modèle standard & en-tête)',
      'Formation à distance 2h pour direction, logistique et conducteurs',
    ],
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
    logistics_benefit:
      'Suivi GPS temps réel des camions, alertes de zone, contrôle carburant/péages et paie chauffeurs ventilée par trajet.',
    deliverables: [
      'Tout le Pack Essentiel + module Suivi GPS & zones géographiques',
      'Configuration des boîtiers GPS et alertes d’entrée/sortie de zone',
      'Paramétrage paie conducteurs & ventilation rentabilité MAD / EUR',
      'Formation complète sur site ou visio (4h) + support prioritaire WhatsApp/Tél',
    ],
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
    logistics_benefit:
      'Pilotage multi-dépôts illimité, intégration boîtiers GPS sur-mesure, migration historique et exports comptables.',
    deliverables: [
      'Véhicules, utilisateurs et missions illimités',
      'Raccordement sur-mesure prestataires GPS & exports comptables personnalisés',
      'Accompagnement dédié à la migration des données historiques',
      'Formation multi-équipes & contrat de maintenance annuel inclus',
    ],
  },
];

export function createDefaultLicense(
  pack: B2BPackId = 'demo_gratuit',
  currency: Currency = 'MAD',
  status: B2BLicense['status'] = 'essai_gratuit',
  catalogOverride?: B2BPackCatalogItem[],
): B2BLicense {
  const source = catalogOverride && catalogOverride.length > 0 ? catalogOverride : B2B_PACKS;
  const catalog = source.find((p) => p.id === pack);
  const validDate = new Date();
  validDate.setDate(validDate.getDate() + (status === 'actif' ? 365 : 14));
  return {
    pack,
    status,
    setup_fee: catalog ? (currency === 'EUR' ? catalog.setup_fee_eur : catalog.setup_fee_mad) : 0,
    annual_fee: catalog ? (currency === 'EUR' ? catalog.annual_fee_eur : catalog.annual_fee_mad) : 0,
    currency,
    max_vehicles: catalog ? catalog.max_vehicles : 25,
    max_users: catalog ? catalog.max_users : 25,
    gps_enabled: catalog ? catalog.gps_enabled : true,
    valid_until: validDate.toISOString().slice(0, 10),
    onboarding_checklist: [
      { id: 'chk_company', label: 'Paramétrage raison sociale, ICE, RIB et logo facture', done: pack === 'demo_gratuit' },
      { id: 'chk_fleet', label: 'Import du parc véhicules et dossiers conducteurs', done: pack === 'demo_gratuit' },
      { id: 'chk_clients', label: 'Import du répertoire clients et catalogues villes', done: pack === 'demo_gratuit' },
      { id: 'chk_training', label: 'Session de formation prise en main (Admin, Logistique, Conducteurs)', done: false },
      { id: 'chk_prod', label: 'Validation mise en production et premier cycle de facturation', done: false },
    ],
    notes:
      pack === 'demo_gratuit'
        ? 'Espace de démonstration ouvert pour présentation commerciale B2B.'
        : 'Déploiement Pack Clé en main B2B.',
  };
}

export function createInitialB2BRequests(): B2BDeploymentRequest[] {
  return [
    {
      id: 'req_souss',
      company_name: 'Transports Souss Frigo SARL',
      contact_name: 'Hassan Ouali',
      phone: '+212 6 61 88 20 14',
      email: 'direction@soussfrigo.ma',
      fleet_size: 16,
      pack: 'pack_flotte_gps',
      currency: 'MAD',
      notes: 'Flotte frigorifique Agadir - Madrid. Souhaite import des 45 clients et formation équipe.',
      status: 'nouvelle',
      provisioned_workspace_code: null,
      created_at: new Date(Date.now() - 1000 * 3600 * 6).toISOString(),
    },
    {
      id: 'req_casa',
      company_name: 'Casablanca Fret Express',
      contact_name: 'Imane Benjelloun',
      phone: '+212 6 64 12 90 33',
      email: 'i.benjelloun@casafret.ma',
      fleet_size: 6,
      pack: 'pack_essentiel',
      currency: 'MAD',
      notes: 'Besoin rapide pour la facturation ICE/TVA et les signatures sur mobile.',
      status: 'contactee',
      provisioned_workspace_code: null,
      created_at: new Date(Date.now() - 1000 * 3600 * 28).toISOString(),
    },
  ];
}

export function createDefaultVendorAccounts(): VendorAccount[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'vnd_primary',
      email: 'editeur@fretmanager.ma',
      password_hash: hashPassword('vendor2026'),
      full_name: 'Karim Ouda',
      company_role: 'Direction Commerciale & Déploiement B2B',
      active: true,
      created_at: now,
    },
    {
      id: 'vnd_owner',
      email: 'oudakarim.lunacerame@gmail.com',
      password_hash: hashPassword('vendor2026'),
      full_name: 'Ouda Karim',
      company_role: 'Fondateur · Éditeur FRET MANAGER',
      active: true,
      created_at: now,
    },
  ];
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

function isoDaysOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoTimestampOffset(hoursOffset: number): string {
  const d = new Date(Date.now() + hoursOffset * 3600 * 1000);
  return d.toISOString();
}

export function createDemoWorkspace(): WorkspaceData {
  const wsId = 'ws_demo';
  const now = new Date().toISOString();

  const uAdminId = 'usr_admin_demo';
  const uLogistiqueId = 'usr_logistique_demo';
  const uComptableId = 'usr_comptable_demo';
  const uDriverId = 'usr_driver_demo';

  const drv1 = 'drv_karim';
  const drv2 = 'drv_youssef';
  const drv3 = 'drv_rachid';

  const veh1 = 'veh_fh16';
  const veh2 = 'veh_actros';
  const veh3 = 'veh_renault';
  const veh4 = 'veh_iveco';
  const veh5 = 'veh_daf_relay';
  const remFrigo = 'veh_rem_frigo';
  const remPlateau = 'veh_rem_plateau';

  const cli1 = 'cli_medlog';
  const cli2 = 'cli_agrisud';
  const cli3 = 'cli_iberia';

  const cMa = 'cnt_ma';
  const cFr = 'cnt_fr';
  const cEs = 'cnt_es';

  const cityCasa = 'cty_casa';
  const cityTanger = 'cty_tanger';
  const cityAgadir = 'cty_agadir';
  const cityMarrakech = 'cty_marrakech';
  const cityFes = 'cty_fes';
  const cityMarseille = 'cty_marseille';
  const cityMadrid = 'cty_madrid';

  const trp1 = 'trp_001';
  const trp2 = 'trp_002';
  const trp3 = 'trp_003';
  const trp4 = 'trp_004';
  const trp5 = 'trp_005';

  const emp1 = 'emp_1';
  const emp2 = 'emp_2';
  const emp3 = 'emp_3';

  const pay1 = 'pay_1';
  const pay2 = 'pay_2';

  const inv1 = 'inv_1';
  const inv2 = 'inv_2';

  const users: WorkspaceUser[] = [
    {
      id: uAdminId,
      workspace_id: wsId,
      email: 'admin@fretmanager.ma',
      password_hash: hashPassword('demo1234'),
      full_name: 'Nadia Benali',
      role: 'admin',
      driver_id: null,
      active: true,
      created_at: isoTimestampOffset(-240),
    },
    {
      id: uLogistiqueId,
      workspace_id: wsId,
      email: 'logistique@fretmanager.ma',
      password_hash: hashPassword('demo1234'),
      full_name: 'Omar Tazi',
      role: 'logistique',
      driver_id: null,
      active: true,
      created_at: isoTimestampOffset(-200),
    },
    {
      id: uComptableId,
      workspace_id: wsId,
      email: 'compta@fretmanager.ma',
      password_hash: hashPassword('demo1234'),
      full_name: 'Salma El Idrissi',
      role: 'comptable',
      driver_id: null,
      active: true,
      created_at: isoTimestampOffset(-180),
    },
    {
      id: uDriverId,
      workspace_id: wsId,
      email: 'conducteur@fretmanager.ma',
      password_hash: hashPassword('demo1234'),
      full_name: 'Karim Mansouri',
      role: 'conducteur',
      driver_id: drv1,
      active: true,
      created_at: isoTimestampOffset(-160),
    },
  ];

  return {
    id: wsId,
    code: 'DEMO',
    name: 'Atlas Fret Maroc',
    created_at: now,
    b2b_license: createDefaultLicense('demo_gratuit', 'MAD', 'essai_gratuit'),
    users,
    vehicles: [
      {
        id: veh1,
        registration: '14820-A-26',
        vehicle_type: 'Tracteur routier 40T',
        fleet_category: 'tracteur',
        brand: 'Volvo',
        model: 'FH16 540',
        year: 2023,
        status: 'actif',
        created_at: isoTimestampOffset(-500),
      },
      {
        id: veh2,
        registration: '89214-B-1',
        vehicle_type: 'Tracteur routier 40T',
        fleet_category: 'tracteur',
        brand: 'Mercedes-Benz',
        model: 'Actros 1848',
        year: 2022,
        status: 'actif',
        created_at: isoTimestampOffset(-480),
      },
      {
        id: veh5,
        registration: '62310-T-6',
        vehicle_type: 'Tracteur routier relais 44T',
        fleet_category: 'tracteur',
        brand: 'DAF',
        model: 'XF 480',
        year: 2023,
        status: 'actif',
        created_at: isoTimestampOffset(-450),
      },
      {
        id: veh3,
        registration: '45019-D-40',
        vehicle_type: 'Porteur bâché 19T',
        fleet_category: 'porteur',
        brand: 'Renault Trucks',
        model: 'T-High 480',
        year: 2021,
        status: 'actif',
        created_at: isoTimestampOffset(-420),
      },
      {
        id: remFrigo,
        registration: '90124-R-26',
        vehicle_type: 'Semi-remorque frigorifique',
        fleet_category: 'frigo',
        brand: 'Schmitz Cargobull',
        model: 'S.KO COOL',
        year: 2023,
        status: 'actif',
        created_at: isoTimestampOffset(-410),
      },
      {
        id: remPlateau,
        registration: '77412-P-1',
        vehicle_type: 'Semi-remorque plateau 40T',
        fleet_category: 'plateau',
        brand: 'Krone',
        model: 'Profi Liner Plateau',
        year: 2022,
        status: 'actif',
        created_at: isoTimestampOffset(-390),
      },
      {
        id: veh4,
        registration: '33108-E-7',
        vehicle_type: 'Fourgon messagerie',
        fleet_category: 'porteur',
        brand: 'Iveco',
        model: 'S-Way',
        year: 2020,
        status: 'en_maintenance',
        created_at: isoTimestampOffset(-360),
      },
    ],
    drivers: [
      {
        id: drv1,
        full_name: 'Karim Mansouri',
        phone: '+212 6 61 42 18 90',
        email: 'conducteur@fretmanager.ma',
        license_number: 'EC-884120',
        status: 'actif',
        created_at: isoTimestampOffset(-450),
      },
      {
        id: drv2,
        full_name: 'Youssef Berrada',
        phone: '+212 6 63 11 54 02',
        email: 'y.berrada@fretmanager.ma',
        license_number: 'EC-772940',
        status: 'actif',
        created_at: isoTimestampOffset(-430),
      },
      {
        id: drv3,
        full_name: 'Rachid Amrani',
        phone: '+212 6 67 89 30 14',
        email: 'r.amrani@fretmanager.ma',
        license_number: 'C-510394',
        status: 'actif',
        created_at: isoTimestampOffset(-400),
      },
    ],
    clients: [
      {
        id: cli1,
        company_name: 'MedLog Tanger Med SA',
        contact_name: 'Hicham Chraïbi',
        phone: '+212 5 39 94 22 10',
        email: 'logistique@medlog.ma',
        address: 'Zone Franche Logistique, Lot 14, Tanger Med',
        ice: '001584920000048',
        client_type: 'Industriel & Conteneurs',
        active: true,
        created_at: isoTimestampOffset(-450),
      },
      {
        id: cli2,
        company_name: 'AgriSud Primeurs Export',
        contact_name: 'Khadija Alaoui',
        phone: '+212 5 28 24 81 00',
        email: 'export@agrisud.ma',
        address: 'Parc Agro-Industriel Ait Melloul, Agadir',
        ice: '002193847000019',
        client_type: 'Agroalimentaire Frigo',
        active: true,
        created_at: isoTimestampOffset(-410),
      },
      {
        id: cli3,
        company_name: 'Iberia Cargo Solutions SL',
        contact_name: 'Carlos Mendoza',
        phone: '+34 91 482 30 11',
        email: 'dispatch@iberiacargo.es',
        address: 'Calle de la Logística 42, 28042 Madrid',
        ice: 'ESB84920144',
        client_type: 'International Europe',
        active: true,
        created_at: isoTimestampOffset(-380),
      },
    ],
    countries: [
      { id: cMa, name: 'Maroc', iso_code: 'MA', is_active: true },
      { id: cFr, name: 'France', iso_code: 'FR', is_active: true },
      { id: cEs, name: 'Espagne', iso_code: 'ES', is_active: true },
    ],
    cities: [
      { id: cityCasa, name: 'Casablanca', country_id: cMa, is_active: true },
      { id: cityTanger, name: 'Tanger Med', country_id: cMa, is_active: true },
      { id: cityAgadir, name: 'Agadir', country_id: cMa, is_active: true },
      { id: cityMarrakech, name: 'Marrakech', country_id: cMa, is_active: true },
      { id: cityFes, name: 'Fès', country_id: cMa, is_active: true },
      { id: cityMarseille, name: 'Marseille', country_id: cFr, is_active: true },
      { id: cityMadrid, name: 'Madrid', country_id: cEs, is_active: true },
    ],
    trips: [
      {
        id: trp1,
        reference: 'MS-2026-041',
        client_id: cli1,
        vehicle_id: veh1,
        tractor_ids: [veh1],
        trailer_id: remPlateau,
        driver_id: drv1,
        departure: 'Casablanca',
        destination: 'Tanger Med',
        departure_city_id: cityCasa,
        destination_city_id: cityTanger,
        departure_date: isoDaysOffset(-2),
        arrival_date: isoDaysOffset(1),
        status: 'En cours',
        revenue: 14500,
        currency: 'MAD',
        driver_response: 'accepted',
        driver_notes: 'Chargement scellé quai 4.',
        created_by: uAdminId,
        created_at: isoTimestampOffset(-72),
      },
      {
        id: trp2,
        reference: 'MS-2026-042',
        client_id: cli2,
        vehicle_id: veh2,
        tractor_ids: [veh2, veh5],
        trailer_id: remFrigo,
        driver_id: drv2,
        departure: 'Agadir',
        destination: 'Madrid',
        departure_city_id: cityAgadir,
        destination_city_id: cityMadrid,
        departure_date: isoDaysOffset(-1),
        arrival_date: isoDaysOffset(2),
        status: 'En cours',
        revenue: 3400,
        currency: 'EUR',
        driver_response: 'accepted',
        driver_notes: 'Température dirigée +4°C vérifiée.',
        created_by: uLogistiqueId,
        created_at: isoTimestampOffset(-48),
      },
      {
        id: trp3,
        reference: 'MS-2026-043',
        client_id: cli1,
        vehicle_id: veh3,
        driver_id: drv1,
        departure: 'Tanger Med',
        destination: 'Fès',
        departure_city_id: cityTanger,
        destination_city_id: cityFes,
        departure_date: isoDaysOffset(2),
        arrival_date: isoDaysOffset(3),
        status: 'À planifier',
        revenue: 8200,
        currency: 'MAD',
        driver_response: 'pending',
        driver_notes: null,
        created_by: uLogistiqueId,
        created_at: isoTimestampOffset(-24),
      },
      {
        id: trp4,
        reference: 'MS-2026-038',
        client_id: cli3,
        vehicle_id: veh1,
        driver_id: drv1,
        departure: 'Casablanca',
        destination: 'Marseille',
        departure_city_id: cityCasa,
        destination_city_id: cityMarseille,
        departure_date: isoDaysOffset(-12),
        arrival_date: isoDaysOffset(-8),
        status: 'Terminée',
        revenue: 4250,
        currency: 'EUR',
        driver_response: 'accepted',
        driver_notes: 'BL signé par le destinataire.',
        created_by: uAdminId,
        created_at: isoTimestampOffset(-288),
      },
      {
        id: trp5,
        reference: 'MS-2026-044',
        client_id: cli2,
        vehicle_id: null,
        driver_id: drv3,
        departure: 'Marrakech',
        destination: 'Casablanca',
        departure_city_id: cityMarrakech,
        destination_city_id: cityCasa,
        departure_date: isoDaysOffset(-3),
        arrival_date: isoDaysOffset(-1),
        status: 'À planifier',
        revenue: 6400,
        currency: 'MAD',
        driver_response: 'pending',
        driver_notes: null,
        created_by: uLogistiqueId,
        created_at: isoTimestampOffset(-96),
      },
    ],
    expenses: [
      {
        id: 'exp_1',
        trip_id: trp1,
        expense_type: 'Carburant gasoil',
        amount: 3250,
        currency: 'MAD',
        expense_date: isoDaysOffset(-2),
        description: 'Plein station Afriquia autoroute Rabat',
        created_by: uComptableId,
        created_at: isoTimestampOffset(-40),
      },
      {
        id: 'exp_2',
        trip_id: trp1,
        expense_type: 'Péage autoroute',
        amount: 420,
        currency: 'MAD',
        expense_date: isoDaysOffset(-1),
        description: 'Badge Jawaz Casablanca - Tanger',
        created_by: uComptableId,
        created_at: isoTimestampOffset(-30),
      },
      {
        id: 'exp_3',
        trip_id: trp2,
        expense_type: 'Ferry & Passage portuaire',
        amount: 680,
        currency: 'EUR',
        expense_date: isoDaysOffset(-1),
        description: 'Traversée Tanger Med - Algésiras',
        created_by: uComptableId,
        created_at: isoTimestampOffset(-20),
      },
      {
        id: 'exp_4',
        trip_id: trp4,
        expense_type: 'Carburant & péages Europe',
        amount: 1120,
        currency: 'EUR',
        expense_date: isoDaysOffset(-10),
        description: 'Gasoil Espagne / France + autoroute A7',
        created_by: uComptableId,
        created_at: isoTimestampOffset(-240),
      },
    ],
    maintenance: [
      {
        id: 'mnt_1',
        vehicle_id: veh4,
        maintenance_type: 'Révision freinage & pneumatiques',
        description: 'Remplacement plaquettes avant et équilibrage train arrière.',
        maintenance_date: isoDaysOffset(-3),
        cost: 6850,
        currency: 'MAD',
        next_maintenance_date: isoDaysOffset(90),
        created_at: isoTimestampOffset(-72),
      },
      {
        id: 'mnt_2',
        vehicle_id: veh1,
        maintenance_type: 'Vidange complète + filtres',
        description: 'Huile 10W40 synthétique, filtre gasoil et filtre à air.',
        maintenance_date: isoDaysOffset(-20),
        cost: 4200,
        currency: 'MAD',
        next_maintenance_date: isoDaysOffset(40),
        created_at: isoTimestampOffset(-480),
      },
    ],
    documents: [],
    employees: [
      {
        id: emp1,
        full_name: 'Karim Mansouri',
        job_title: 'Conducteur grand routier',
        phone: '+212 6 61 42 18 90',
        email: 'conducteur@fretmanager.ma',
        hire_date: '2022-03-01',
        end_date: null,
        status: 'actif',
        driver_id: drv1,
        notes: 'Permis EC + ADR.',
        created_by: uAdminId,
        created_at: isoTimestampOffset(-500),
      },
      {
        id: emp2,
        full_name: 'Youssef Berrada',
        job_title: 'Conducteur international frigo',
        phone: '+212 6 63 11 54 02',
        email: 'y.berrada@fretmanager.ma',
        hire_date: '2023-01-15',
        end_date: null,
        status: 'actif',
        driver_id: drv2,
        notes: 'Ligne Maroc - Espagne.',
        created_by: uAdminId,
        created_at: isoTimestampOffset(-450),
      },
      {
        id: emp3,
        full_name: 'Omar Tazi',
        job_title: 'Responsable exploitation logistique',
        phone: '+212 6 60 19 88 33',
        email: 'logistique@fretmanager.ma',
        hire_date: '2021-06-01',
        end_date: null,
        status: 'actif',
        driver_id: null,
        notes: null,
        created_by: uAdminId,
        created_at: isoTimestampOffset(-500),
      },
    ],
    payroll: [
      {
        id: pay1,
        employee_id: emp1,
        period_start: isoDaysOffset(-30),
        period_end: isoDaysOffset(-1),
        salary_amount: 7500,
        employer_charges: 1650,
        total_cost: 9150,
        currency: 'MAD',
        payment_status: 'paye',
        payment_date: isoDaysOffset(-1),
        notes: 'Paie mensuelle + prime trajet Tanger Med.',
        created_by: uComptableId,
        created_at: isoTimestampOffset(-36),
      },
      {
        id: pay2,
        employee_id: emp2,
        period_start: isoDaysOffset(-30),
        period_end: isoDaysOffset(-1),
        salary_amount: 850,
        employer_charges: 190,
        total_cost: 1040,
        currency: 'EUR',
        payment_status: 'partiellement_paye',
        payment_date: isoDaysOffset(-2),
        notes: 'Prime internationale EUR.',
        created_by: uComptableId,
        created_at: isoTimestampOffset(-24),
      },
    ],
    payroll_allocations: [
      {
        id: 'pal_1',
        payroll_id: pay1,
        trip_id: trp1,
        amount: 3000,
        notes: 'Quote-part mission MS-2026-041',
        created_by: uComptableId,
        created_at: isoTimestampOffset(-20),
      },
      {
        id: 'pal_2',
        payroll_id: pay2,
        trip_id: trp2,
        amount: 650,
        notes: 'Quote-part trajet Agadir - Madrid',
        created_by: uComptableId,
        created_at: isoTimestampOffset(-18),
      },
    ],
    client_proposals: [
      {
        id: 'prp_1',
        driver_id: drv1,
        company_name: 'Souss Textile Logistics SARL',
        contact_name: 'Mounir Bennani',
        phone: '+212 6 62 77 10 45',
        email: 'contact@sousstextile.ma',
        address: 'Zone Industrielle Tassila, Lot 88, Agadir',
        ice: '002948120000073',
        status: 'en_attente',
        admin_notes: null,
        reviewed_by: null,
        reviewed_at: null,
        created_at: isoTimestampOffset(-10),
      },
    ],
    audit_logs: [
      {
        id: 'aud_1',
        user_id: uAdminId,
        user_name: 'Nadia Benali',
        action: 'VALIDATE_INVOICE',
        table_name: 'invoices',
        record_id: inv1,
        details: { invoice_number: 'FAC-0001', total_ttc: 17400, currency: 'MAD' },
        created_at: isoTimestampOffset(-50),
      },
      {
        id: 'aud_2',
        user_id: uDriverId,
        user_name: 'Karim Mansouri',
        action: 'RESPOND_TRIP',
        table_name: 'trips',
        record_id: trp1,
        details: { reference: 'MS-2026-041', response: 'accepted' },
        created_at: isoTimestampOffset(-48),
      },
    ],
    company_settings: {
      id: 1,
      company_name: 'ATLAS FRET MAROC SARL',
      activity: 'Transport National & International de Marchandises',
      phone: '+212 5 22 48 90 10',
      email: 'facturation@atlasfret.ma',
      address: 'Bd Chefchaouni, Km 9, Ain Sebaâ',
      city: 'Casablanca',
      ice: '001847291000052',
      tax_id: '40291844',
      rc: '394812 Casablanca',
      tp: '32409811',
      bank: 'Attijariwafa Bank — Centre Entreprises',
      rib: '007 780 0004918200001948 32',
      logo_url: '',
      payment_terms: 'Règlement par virement bancaire à 30 jours date de facture.',
      updated_at: now,
    },
    invoice_settings: {
      id: 1,
      prefix: 'FAC',
      separator: '-',
      padding_length: 4,
      next_number: 3,
    },
    invoices: [
      {
        id: inv1,
        trip_id: trp1,
        invoice_number: 'FAC-0001',
        mission_reference: 'MS-2026-041',
        client_id: cli1,
        client_name: 'MedLog Tanger Med SA',
        client_ice: '001584920000048',
        client_address: 'Zone Franche Logistique, Lot 14, Tanger Med',
        client_email: 'logistique@medlog.ma',
        service_description: 'Transport Casablanca - Tanger Med · Mission MS-2026-041',
        amount_basis: 'HT',
        entered_amount: 14500,
        tax_rate: 14,
        subtotal_ht: 14500,
        tax_amount: 2030,
        total_ttc: 16530,
        currency: 'MAD',
        issue_date: isoDaysOffset(-1),
        due_date: isoDaysOffset(29),
        status: 'validated',
        notes: 'Conteneur 40 pieds · BL N° TM-99142',
        created_by: uComptableId,
        created_at: isoTimestampOffset(-52),
      },
      {
        id: inv2,
        trip_id: trp4,
        invoice_number: 'FAC-0002',
        mission_reference: 'MS-2026-038',
        client_id: cli3,
        client_name: 'Iberia Cargo Solutions SL',
        client_ice: 'ESB84920144',
        client_address: 'Calle de la Logística 42, 28042 Madrid',
        client_email: 'dispatch@iberiacargo.es',
        service_description: 'Transport International Casablanca - Marseille · Mission MS-2026-038',
        amount_basis: 'HT',
        entered_amount: 4250,
        tax_rate: 0,
        subtotal_ht: 4250,
        tax_amount: 0,
        total_ttc: 4250,
        currency: 'EUR',
        issue_date: isoDaysOffset(-7),
        due_date: isoDaysOffset(23),
        status: 'validated',
        notes: 'Transport international exonéré de TVA (Art. 92 CGI).',
        created_by: uAdminId,
        created_at: isoTimestampOffset(-168),
      },
    ],
    invoice_payments: [
      {
        id: 'paym_1',
        invoice_id: inv1,
        payment_date: isoDaysOffset(0),
        amount: 8000,
        currency: 'MAD',
        payment_method: 'Virement',
        reference: 'VIR-2026-881',
        notes: 'Acompte 50% réceptionné',
        created_at: isoTimestampOffset(-12),
      },
      {
        id: 'paym_2',
        invoice_id: inv2,
        payment_date: isoDaysOffset(-3),
        amount: 4250,
        currency: 'EUR',
        payment_method: 'Virement',
        reference: 'SEPA-IB-402',
        notes: 'Règlement intégral reçu',
        created_at: isoTimestampOffset(-72),
      },
    ],
    gps_devices: [
      {
        id: 'gdev_1',
        vehicle_id: veh1,
        device_name: 'Teltonika FMC920 #01',
        provider: 'AtlasTrack Telemetry',
        imei: '352093081140291',
        provider_device_id: 'AT-14820',
        status: 'active',
        installed_at: '2024-01-12',
        last_seen_at: isoTimestampOffset(-0.03),
        created_at: isoTimestampOffset(-500),
      },
      {
        id: 'gdev_2',
        vehicle_id: veh2,
        device_name: 'Teltonika FMC130 #02',
        provider: 'AtlasTrack Telemetry',
        imei: '352093081140388',
        provider_device_id: 'AT-89214',
        status: 'active',
        installed_at: '2024-02-20',
        last_seen_at: isoTimestampOffset(-0.05),
        created_at: isoTimestampOffset(-480),
      },
      {
        id: 'gdev_3',
        vehicle_id: veh3,
        device_name: 'Queclink GV300 #03',
        provider: 'AtlasTrack Telemetry',
        imei: '864291042219014',
        provider_device_id: 'AT-45019',
        status: 'active',
        installed_at: '2024-05-04',
        last_seen_at: isoTimestampOffset(-2.5),
        created_at: isoTimestampOffset(-400),
      },
    ],
    gps_positions: [
      {
        id: 'gpos_1',
        vehicle_id: veh1,
        trip_id: trp1,
        latitude: 34.9182,
        longitude: -6.0825,
        speed_kmh: 82,
        heading: 18,
        recorded_at: isoTimestampOffset(-0.03),
      },
      {
        id: 'gpos_2',
        vehicle_id: veh2,
        trip_id: trp2,
        latitude: 37.3891,
        longitude: -5.9845,
        speed_kmh: 86,
        heading: 24,
        recorded_at: isoTimestampOffset(-0.05),
      },
      {
        id: 'gpos_3',
        vehicle_id: veh3,
        trip_id: trp3,
        latitude: 35.8842,
        longitude: -5.5019,
        speed_kmh: 0,
        heading: 0,
        recorded_at: isoTimestampOffset(-2.5),
      },
    ],
    gps_alerts: [
      {
        id: 'galr_1',
        vehicle_id: veh2,
        alert_type: 'temperature_warning',
        severity: 'high',
        title: 'Variation température caisson (+5.8°C)',
        description: 'Seuil consigne +4.0°C dépassé brièvement lors du contrôle douanier.',
        occurred_at: isoTimestampOffset(-4),
        acknowledged: false,
        acknowledged_by: null,
        acknowledged_at: null,
      },
      {
        id: 'galr_2',
        vehicle_id: veh1,
        alert_type: 'geofence_exit',
        severity: 'medium',
        title: 'Sortie de zone : Hub Casablanca Ain Sebaâ',
        description: 'Le véhicule 14820-A-26 a quitté la plateforme logistique à 07:42.',
        occurred_at: isoTimestampOffset(-14),
        acknowledged: true,
        acknowledged_by: uLogistiqueId,
        acknowledged_at: isoTimestampOffset(-13),
      },
    ],
    gps_trip_summaries: [
      {
        id: 'gsum_1',
        trip_id: trp1,
        vehicle_id: veh1,
        distance_km: 268,
        driving_duration_minutes: 215,
        stopped_duration_minutes: 34,
        stop_count: 2,
        started_at: isoTimestampOffset(-5),
        ended_at: null,
        updated_at: isoTimestampOffset(-0.03),
      },
      {
        id: 'gsum_2',
        trip_id: trp4,
        vehicle_id: veh1,
        distance_km: 1840,
        driving_duration_minutes: 1410,
        stopped_duration_minutes: 620,
        stop_count: 9,
        started_at: isoTimestampOffset(-288),
        ended_at: isoTimestampOffset(-192),
        updated_at: isoTimestampOffset(-192),
      },
    ],
    gps_geofences: [
      {
        id: 'ggeo_1',
        name: 'Plateforme Casablanca Ain Sebaâ',
        description: 'Dépôt principal & atelier flotte Atlas Fret',
        geometry_json: {
          type: 'Polygon',
          coordinates: [
            [
              [-7.555, 33.605],
              [-7.515, 33.605],
              [-7.515, 33.635],
              [-7.555, 33.635],
              [-7.555, 33.605],
            ],
          ],
        },
        is_active: true,
        alert_on_entry: true,
        alert_on_exit: true,
        created_by: uAdminId,
        created_at: isoTimestampOffset(-400),
      },
      {
        id: 'ggeo_2',
        name: 'Terminal Portuaire Tanger Med',
        description: 'Zone d’accès fret et embarquement Ro-Ro',
        geometry_json: {
          type: 'Polygon',
          coordinates: [
            [
              [-5.535, 35.870],
              [-5.485, 35.870],
              [-5.485, 35.905],
              [-5.535, 35.905],
              [-5.535, 35.870],
            ],
          ],
        },
        is_active: true,
        alert_on_entry: true,
        alert_on_exit: false,
        created_by: uAdminId,
        created_at: isoTimestampOffset(-390),
      },
    ],
    gps_device_events: [
      {
        id: 'gevt_1',
        vehicle_id: veh1,
        event_type: 'ignition_on',
        details: 'Contact mis — départ mission MS-2026-041',
        occurred_at: isoTimestampOffset(-5),
      },
      {
        id: 'gevt_2',
        vehicle_id: veh2,
        event_type: 'border_crossing',
        details: 'Entrée Espagne — Port d’Algésiras',
        occurred_at: isoTimestampOffset(-6),
      },
      {
        id: 'gevt_3',
        vehicle_id: veh3,
        event_type: 'ignition_off',
        details: 'Stationnement sécurisé Tanger Med',
        occurred_at: isoTimestampOffset(-2.5),
      },
    ],
  };
}

export function createSampleB2BWorkspaces(): WorkspaceData[] {
  const makeClientWs = (params: {
    id: string;
    code: string;
    name: string;
    adminName: string;
    adminEmail: string;
    phone: string;
    city: string;
    pack: B2BPackId;
    currency: Currency;
    status: B2BLicense['status'];
    daysOffset: number;
    vehicleCount: number;
    tripCount: number;
    notes: string;
  }): WorkspaceData => {
    const now = new Date().toISOString();
    const uid = `usr_${params.id}`;
    const cMa = `cnt_${params.id}_ma`;
    const lic = createDefaultLicense(params.pack, params.currency, params.status);
    lic.valid_until = isoDaysOffset(params.daysOffset);
    lic.notes = params.notes;
    lic.onboarding_checklist = lic.onboarding_checklist.map((c, idx) => ({
      ...c,
      done: params.status === 'actif' ? idx < 4 : idx < 2,
    }));

    const vehicles = Array.from({ length: params.vehicleCount }).map((_, idx) => ({
      id: `veh_${params.id}_${idx + 1}`,
      registration: `${21000 + idx * 137}-A-${(idx + 1) * 7}`,
      vehicle_type: idx % 2 === 0 ? 'Tracteur routier 40T' : 'Semi-remorque frigorifique',
      brand: idx % 2 === 0 ? 'Volvo' : 'Mercedes-Benz',
      model: idx % 2 === 0 ? 'FH16' : 'Actros',
      year: 2022 + (idx % 3),
      status: 'actif' as const,
      created_at: isoTimestampOffset(-120),
    }));

    const trips = Array.from({ length: params.tripCount }).map((_, idx) => ({
      id: `trp_${params.id}_${idx + 1}`,
      reference: `${params.code.slice(-4)}-2026-0${idx + 1}`,
      client_id: null,
      vehicle_id: vehicles[0]?.id || null,
      driver_id: null,
      departure: params.city,
      destination: idx % 2 === 0 ? 'Tanger Med' : 'Madrid',
      departure_city_id: null,
      destination_city_id: null,
      departure_date: isoDaysOffset(-idx - 1),
      arrival_date: isoDaysOffset(1),
      status: (idx === 0 ? 'En cours' : 'Terminée') as 'En cours' | 'Terminée',
      revenue: params.currency === 'EUR' ? 2800 : 12500,
      currency: params.currency,
      driver_response: 'accepted' as const,
      driver_notes: null,
      created_by: uid,
      created_at: isoTimestampOffset(-48),
    }));

    return {
      id: params.id,
      code: params.code,
      name: params.name,
      created_at: isoTimestampOffset(-300),
      b2b_license: lic,
      users: [
        {
          id: uid,
          workspace_id: params.id,
          email: params.adminEmail,
          password_hash: hashPassword('client2026'),
          full_name: params.adminName,
          role: 'admin',
          driver_id: null,
          active: true,
          created_at: isoTimestampOffset(-300),
        },
      ],
      vehicles,
      drivers: [],
      clients: [],
      countries: [{ id: cMa, name: 'Maroc', iso_code: 'MA', is_active: true }],
      cities: [{ id: `cty_${params.id}_1`, name: params.city, country_id: cMa, is_active: true }],
      trips,
      expenses: [],
      maintenance: [],
      documents: [],
      employees: [],
      payroll: [],
      payroll_allocations: [],
      client_proposals: [],
      audit_logs: [],
      company_settings: {
        id: 1,
        company_name: params.name.toUpperCase(),
        activity: 'Transport & Logistique',
        phone: params.phone,
        email: params.adminEmail,
        address: '',
        city: params.city,
        ice: '',
        tax_id: '',
        rc: '',
        tp: '',
        bank: '',
        rib: '',
        logo_url: '',
        payment_terms: 'Règlement à 30 jours date de facture.',
        updated_at: now,
      },
      invoice_settings: { id: 1, prefix: 'FAC', separator: '-', padding_length: 4, next_number: 1 },
      invoices: [],
      invoice_payments: [],
      gps_devices: [],
      gps_positions: [],
      gps_alerts: [],
      gps_trip_summaries: [],
      gps_geofences: [],
      gps_device_events: [],
    };
  };

  return [
    makeClientWs({
      id: 'ws_atlantique',
      code: 'FRET-2041',
      name: 'Transports Atlantique Sud',
      adminName: 'Mehdi Kettani',
      adminEmail: 'direction@atlantiquesud.ma',
      phone: '+212 6 61 30 44 12',
      city: 'Agadir',
      pack: 'pack_flotte_gps',
      currency: 'MAD',
      status: 'actif',
      daysOffset: 285,
      vehicleCount: 14,
      tripCount: 4,
      notes: 'Pack Flotte & GPS déployé · Formation équipe logistique validée.',
    }),
    makeClientWs({
      id: 'ws_maghreb_nord',
      code: 'FRET-1088',
      name: 'Maghreb Cargo Nord',
      adminName: 'Samira El Fassi',
      adminEmail: 's.elfassi@maghrebcargo.ma',
      phone: '+212 6 65 92 18 05',
      city: 'Tanger Med',
      pack: 'pack_essentiel',
      currency: 'MAD',
      status: 'actif',
      daysOffset: 12,
      vehicleCount: 6,
      tripCount: 3,
      notes: 'Échéance annuelle proche — relance renouvellement programmée.',
    }),
    makeClientWs({
      id: 'ws_euromed',
      code: 'FRET-3015',
      name: 'EuroMed Logistics SL',
      adminName: 'Javier Morales',
      adminEmail: 'ops@euromedlogistics.es',
      phone: '+34 91 540 82 19',
      city: 'Madrid',
      pack: 'pack_entreprise',
      currency: 'EUR',
      status: 'actif',
      daysOffset: 320,
      vehicleCount: 22,
      tripCount: 5,
      notes: 'Contrat Entreprise Multi-Sites EUR · Corridor Maroc - Espagne - France.',
    }),
    makeClientWs({
      id: 'ws_sahara_trial',
      code: 'FRET-4090',
      name: 'Sahara Fret Express',
      adminName: 'Tariq Benjelloun',
      adminEmail: 'contact@saharafret.ma',
      phone: '+212 6 70 11 29 88',
      city: 'Marrakech',
      pack: 'pack_essentiel',
      currency: 'MAD',
      status: 'essai_gratuit',
      daysOffset: 8,
      vehicleCount: 3,
      tripCount: 2,
      notes: 'Compte essai gratuit en phase de test avec 3 véhicules.',
    }),
  ];
}

