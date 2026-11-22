export type Role = 'admin' | 'logistique' | 'comptable' | 'conducteur';

export type Currency = 'MAD' | 'EUR';

export type TripStatus = 'À planifier' | 'En cours' | 'Terminée' | 'Annulée';

export interface WorkspaceUser {
  id: string;
  workspace_id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: Role;
  driver_id: string | null;
  active: boolean;
  created_at: string;
}

export interface PublicProfile {
  id: string;
  workspace_id: string;
  workspace_code: string;
  workspace_name: string;
  email: string;
  full_name: string;
  role: Role;
  driver_id: string | null;
  active: boolean;
  created_at: string;
}

export type FleetCategory = 'tracteur' | 'remorque' | 'frigo' | 'plateau' | 'porteur' | 'autre';

export interface Vehicle {
  id: string;
  registration: string;
  vehicle_type: string | null;
  fleet_category?: FleetCategory | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  status: 'actif' | 'en_maintenance' | 'inactif';
  insurance_expiry?: string | null;
  technical_inspection_expiry?: string | null;
  vignette_expiry?: string | null;
  created_at: string;
}

export interface Driver {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  license_number: string | null;
  license_expiry?: string | null;
  medical_visit_expiry?: string | null;
  status: 'actif' | 'inactif';
  created_at: string;
}

export interface Client {
  id: string;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  ice: string | null;
  client_type: string | null;
  active: boolean;
  created_at: string;
}

export interface Country {
  id: string;
  name: string;
  iso_code: string | null;
  is_active: boolean;
}

export interface City {
  id: string;
  name: string;
  country_id: string;
  is_active: boolean;
  country_name?: string;
  country_iso?: string | null;
}

export interface Trip {
  id: string;
  reference: string;
  client_id: string | null;
  vehicle_id: string | null;
  tractor_ids?: string[];
  trailer_id?: string | null;
  driver_id: string | null;
  departure: string;
  destination: string;
  departure_city_id: string | null;
  destination_city_id: string | null;
  departure_date: string | null;
  arrival_date: string | null;
  status: TripStatus;
  revenue: number;
  currency: Currency;
  driver_response: 'pending' | 'accepted' | 'refused';
  driver_notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Expense {
  id: string;
  trip_id: string;
  expense_type: string;
  amount: number;
  currency: Currency;
  expense_date: string | null;
  description: string | null;
  document_id?: string | null;
  submitted_by_role?: Role | null;
  approval_status?: 'en_attente' | 'validee' | 'refusee';
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Maintenance {
  id: string;
  vehicle_id: string | null;
  maintenance_type: string;
  description: string | null;
  maintenance_date: string | null;
  cost: number | null;
  currency: Currency;
  next_maintenance_date: string | null;
  created_at: string;
}

export interface DocumentItem {
  id: string;
  trip_id: string;
  driver_id: string | null;
  document_type: string;
  document_name: string;
  media_kind: 'document' | 'photo' | 'signature';
  file_path: string | null;
  file_data?: string | null;
  mime_type: string | null;
  expiry_date: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface Employee {
  id: string;
  full_name: string;
  job_title: string | null;
  phone: string | null;
  email: string | null;
  hire_date: string | null;
  end_date: string | null;
  status: 'actif' | 'inactif' | 'sorti';
  driver_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Payroll {
  id: string;
  employee_id: string;
  period_start: string;
  period_end: string;
  salary_amount: number;
  employer_charges: number;
  total_cost: number;
  currency: Currency;
  payment_status: 'a_payer' | 'partiellement_paye' | 'paye';
  payment_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PayrollAllocation {
  id: string;
  payroll_id: string;
  trip_id: string;
  amount: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ClientProposal {
  id: string;
  driver_id: string;
  company_name: string;
  contact_name: string | null;
  phone: string;
  email: string;
  address: string;
  ice: string;
  status: 'en_attente' | 'approuvee' | 'refusee';
  admin_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  user_name?: string;
  action: string;
  table_name: string;
  record_id: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface CompanySettings {
  id: number;
  company_name: string;
  activity: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  ice: string;
  tax_id: string;
  rc: string;
  tp: string;
  bank: string;
  rib: string;
  logo_url: string;
  payment_terms: string;
  stamp_enabled?: boolean;
  stamp_style?: 'rectangular' | 'round';
  stamp_color?: string;
  stamp_signatory_name?: string;
  stamp_signatory_title?: string;
  stamp_signature_url?: string;
  updated_at: string;
}

export interface InvoiceSettings {
  id: number;
  prefix: string;
  separator: string;
  padding_length: number;
  next_number: number;
}

export interface Invoice {
  id: string;
  trip_id: string;
  invoice_number: string;
  mission_reference: string;
  client_id: string | null;
  client_name: string;
  client_ice: string;
  client_address: string;
  client_email: string;
  service_description: string;
  amount_basis: 'HT' | 'TTC';
  entered_amount: number;
  tax_rate: number;
  subtotal_ht: number;
  tax_amount: number;
  total_ttc: number;
  currency: Currency;
  issue_date: string;
  due_date: string | null;
  status: 'draft' | 'validated' | 'cancelled';
  notes: string | null;
  last_emailed_at?: string | null;
  last_emailed_to?: string | null;
  email_sent_count?: number;
  last_whatsapp_at?: string | null;
  last_whatsapp_to?: string | null;
  whatsapp_sent_count?: number;
  created_by: string | null;
  created_at: string;
}

export interface InvoicePayment {
  id: string;
  invoice_id: string;
  payment_date: string;
  amount: number;
  currency: Currency;
  payment_method: string | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
}

export interface GpsDevice {
  id: string;
  vehicle_id: string;
  device_name: string | null;
  provider: string | null;
  imei: string | null;
  provider_device_id: string | null;
  status: 'inactive' | 'active' | 'maintenance' | 'offline';
  installed_at: string | null;
  last_seen_at: string | null;
  created_at: string;
}

export interface GpsPosition {
  id: string;
  vehicle_id: string;
  trip_id: string | null;
  latitude: number;
  longitude: number;
  speed_kmh: number | null;
  heading: number | null;
  recorded_at: string;
}

export interface GpsAlert {
  id: string;
  vehicle_id: string;
  alert_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string | null;
  occurred_at: string;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
}

export interface GpsTripSummary {
  id: string;
  trip_id: string;
  vehicle_id: string;
  distance_km: number;
  driving_duration_minutes: number;
  stopped_duration_minutes: number;
  stop_count: number;
  started_at: string | null;
  ended_at: string | null;
  updated_at: string;
}

export interface GpsGeofence {
  id: string;
  name: string;
  description: string | null;
  geometry_json: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: unknown;
  };
  is_active: boolean;
  alert_on_entry: boolean;
  alert_on_exit: boolean;
  created_by: string | null;
  created_at: string;
}

export interface GpsDeviceEvent {
  id: string;
  vehicle_id: string | null;
  event_type: string;
  details: string | null;
  occurred_at: string;
}

export type B2BPackId =
  | 'demo_gratuit'
  | 'pack_essentiel'
  | 'pack_flotte_gps'
  | 'pack_entreprise'
  | (string & {});

export interface B2BPackCatalogItem {
  id: B2BPackId;
  name: string;
  audience: string;
  setup_fee_mad: number;
  annual_fee_mad: number;
  setup_fee_eur: number;
  annual_fee_eur: number;
  max_vehicles: number;
  max_users: number;
  gps_enabled: boolean;
  deliverables: string[];
  logistics_benefit?: string;
  is_featured?: boolean;
  customized?: boolean;
}

export interface OnboardingChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface B2BLicense {
  pack: B2BPackId;
  status: 'essai_gratuit' | 'en_attente_activation' | 'actif' | 'suspendu';
  setup_fee: number;
  annual_fee: number;
  currency: Currency;
  max_vehicles: number;
  max_users: number;
  gps_enabled: boolean;
  valid_until: string;
  onboarding_checklist: OnboardingChecklistItem[];
  notes: string;
}

export interface B2BDeploymentRequest {
  id: string;
  company_name: string;
  contact_name: string;
  phone: string;
  email: string;
  fleet_size: number;
  pack: B2BPackId;
  currency: Currency;
  notes: string | null;
  status: 'nouvelle' | 'contactee' | 'en_deploiement' | 'convertie' | 'archivee';
  provisioned_workspace_code: string | null;
  created_at: string;
  updated_at?: string;
}

export interface WorkspaceData {
  id: string;
  code: string;
  name: string;
  created_at: string;
  updated_at?: string;
  b2b_license?: B2BLicense;
  users: WorkspaceUser[];
  vehicles: Vehicle[];
  drivers: Driver[];
  clients: Client[];
  countries: Country[];
  cities: City[];
  trips: Trip[];
  expenses: Expense[];
  maintenance: Maintenance[];
  documents: DocumentItem[];
  employees: Employee[];
  payroll: Payroll[];
  payroll_allocations: PayrollAllocation[];
  client_proposals: ClientProposal[];
  audit_logs: AuditLog[];
  company_settings: CompanySettings;
  invoice_settings: InvoiceSettings;
  invoices: Invoice[];
  invoice_payments: InvoicePayment[];
  gps_devices: GpsDevice[];
  gps_positions: GpsPosition[];
  gps_alerts: GpsAlert[];
  gps_trip_summaries: GpsTripSummary[];
  gps_geofences: GpsGeofence[];
  gps_device_events: GpsDeviceEvent[];
}

export interface LookupsData {
  vehicles: Array<{
    id: string;
    registration: string;
    vehicle_type?: string | null;
    fleet_category?: FleetCategory | null;
    brand: string | null;
    model: string | null;
    status: string;
  }>;
  drivers: Array<{ id: string; full_name: string; status: string }>;
  clients: Array<{ id: string; company_name: string; ice: string | null; active: boolean }>;
  trips: Array<{ id: string; reference: string; departure: string; destination: string; status: TripStatus; currency: Currency }>;
  cities: City[];
  countries: Country[];
}

export interface TripAlert {
  id: string;
  reference: string;
  type: string;
  detail: string;
  level: 'Urgent' | 'À traiter';
  target_page?: 'trips' | 'vehicles' | 'drivers' | 'documents';
}

export interface VendorAccount {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  company_role: string;
  active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface VendorAccountPublic {
  id: string;
  email: string;
  full_name: string;
  company_role: string;
  active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface VendorProfile {
  id: string;
  email: string;
  full_name: string;
  company_role: string;
}

export interface VendorSettings {
  company_name: string;
  legal_form: string;
  activity: string;
  ice: string;
  if_number: string;
  rc: string;
  patente: string;
  bank: string;
  rib: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  website: string;
  logo_url: string;
  quote_prefix: string;
  invoice_prefix: string;
  default_tax_rate: number;
  payment_terms: string;
  updated_at: string;
}

export interface VendorBillingDocItem {
  id: string;
  description: string;
  details?: string;
  quantity: number;
  unit_price: number;
  total_ht: number;
}

export type VendorBillingDocType = 'devis' | 'facture';
export type VendorBillingDocStatus = 'brouillon' | 'envoye' | 'paye' | 'annule';

export interface VendorBillingDoc {
  id: string;
  doc_type: VendorBillingDocType;
  doc_number: string;
  workspace_id?: string | null;
  request_id?: string | null;
  source_quote_id?: string | null;
  client_name: string;
  client_contact: string;
  client_ice: string;
  client_phone: string;
  client_email: string;
  client_address: string;
  currency: Currency;
  issue_date: string;
  due_date: string;
  status: VendorBillingDocStatus;
  tax_rate: number;
  items: VendorBillingDocItem[];
  subtotal_ht: number;
  tax_amount: number;
  total_ttc: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface VendorWorkspaceSummary {
  id: string;
  code: string;
  name: string;
  created_at: string;
  admin_email: string;
  admin_name: string;
  company_phone: string;
  member_emails?: string[];
  members?: Array<{
    full_name: string;
    email: string;
    role: Role;
    created_at: string;
  }>;
  b2b_license: B2BLicense;
  days_remaining: number;
  renewal_state: 'ok' | 'due_soon' | 'expired' | 'trial';
  usage: {
    vehicles: number;
    users: number;
    trips: number;
    clients: number;
    invoices: number;
  };
}

export interface VendorPortfolioMetrics {
  total_workspaces: number;
  trials_count: number;
  active_paid_count: number;
  pending_activation_count: number;
  suspended_count: number;
  renewals_due_soon_count: number;
  expired_count: number;
  open_requests_count: number;
  total_requests_count: number;
  arr_mad: number;
  arr_eur: number;
  setup_mad: number;
  setup_eur: number;
}

export type PageId =
  | 'dashboard'
  | 'trips'
  | 'vehicles'
  | 'drivers'
  | 'clients'
  | 'employees'
  | 'payroll'
  | 'expenses'
  | 'maintenance'
  | 'documents'
  | 'driver'
  | 'proposal'
  | 'invoices'
  | 'gps'
  | 'proposals'
  | 'users'
  | 'audit'
  | 'company'
  | 'cities'
  | 'alerts';


