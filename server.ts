import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import nodemailer from 'nodemailer';
import { createServer as createViteServer } from 'vite';
import type {
  B2BDeploymentRequest,
  B2BLicense,
  B2BPackCatalogItem,
  B2BPackId,
  CompanySettings,
  Currency,
  DocumentItem,
  FleetCategory,
  Invoice,
  InvoicePayment,
  LookupsData,
  OnboardingChecklistItem,
  Role,
  Trip,
  TripAlert,
  VendorAccount,
  VendorAccountPublic,
  VendorBillingDoc,
  VendorBillingDocItem,
  VendorBillingDocStatus,
  VendorBillingDocType,
  VendorPortfolioMetrics,
  VendorProfile,
  VendorSettings,
  VendorWorkspaceSummary,
  WorkspaceData,
  WorkspaceUser,
} from './src/types.ts';
import {
  addAuditLog,
  addUserToWorkspace,
  createDefaultVendorSettings,
  createEmptyWorkspace,
  ensureDemoWorkspaceReady,
  ensureDriverLinkForUser,
  findWorkspaceByCode,
  findWorkspaceById,
  getCatalogPacks,
  getUploadDir,
  getVendorBillingDocs,
  getVendorSettings,
  hydrateDatabaseSnapshot,
  loadDb,
  newId,
  resolveUploadPath,
  saveDb,
  signToken,
  signVendorToken,
  toPublicProfile,
  verifyToken,
  verifyVendorToken,
} from './server/db.ts';
import { B2B_PACKS, createDefaultLicense, createDemoWorkspace, hashPassword, verifyPassword } from './server/seed.ts';
import { getTripTractorIds, inferFleetCategory } from './src/lib/fleet.ts';
import { findTripAssignmentConflict } from './src/lib/tripConflicts.ts';

function sanitizeFleetCategory(raw: unknown, vehicleType?: string | null): FleetCategory {
  if (
    typeof raw === 'string' &&
    ['tracteur', 'remorque', 'frigo', 'plateau', 'porteur', 'autre'].includes(raw)
  ) {
    return raw as FleetCategory;
  }
  return inferFleetCategory({ vehicle_type: vehicleType || null });
}

function normalizeTripTractorIds(
  ws: WorkspaceData,
  rawTractorIds: unknown,
  rawVehicleId: unknown,
): string[] {
  const validIds = new Set(ws.vehicles.map((v) => v.id));
  const out: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(rawTractorIds)) {
    for (const id of rawTractorIds) {
      if (typeof id === 'string' && validIds.has(id) && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  if (typeof rawVehicleId === 'string' && validIds.has(rawVehicleId) && !seen.has(rawVehicleId)) {
    out.unshift(rawVehicleId);
  }
  return out;
}

interface AuthedRequest extends Request {
  authUser?: WorkspaceUser;
  workspace?: WorkspaceData;
}

interface VendorAuthedRequest extends Request {
  vendorAccount?: VendorAccount;
}

const PORT = Number(process.env.PORT || 3000);

function getBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  const qToken = req.query.token;
  if (typeof qToken === 'string' && qToken.trim()) {
    return qToken.trim();
  }
  return null;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentification requise.' });
    return;
  }
  const parsed = verifyToken(token);
  if (!parsed) {
    res.status(401).json({ error: 'Session expirée ou invalide.' });
    return;
  }
  const ws = findWorkspaceById(parsed.wid);
  if (!ws) {
    res.status(401).json({ error: 'Espace de travail introuvable.' });
    return;
  }
  const user = ws.users.find((u) => u.id === parsed.uid);
  if (!user || !user.active) {
    res.status(403).json({ error: 'Compte inactif ou introuvable.' });
    return;
  }
  const access = checkWorkspaceAccess(ws);
  if (!access.allowed) {
    res.status(403).json({
      error: access.message,
      access_blocked: true,
      block_reason: access.reason,
    });
    return;
  }
  if (req.method !== 'GET') {
    ws.updated_at = new Date().toISOString();
  }
  req.authUser = user;
  req.workspace = ws;
  next();
}

function requireRoles(...roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser || !roles.includes(req.authUser.role)) {
      res.status(403).json({ error: 'Droits insuffisants pour cette opération.' });
      return;
    }
    next();
  };
}

function toPublicDocument(doc: DocumentItem): DocumentItem {
  const { file_data: _ignored, ...rest } = doc;
  return rest;
}

const ALLOWED_FILE_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

function inferAllowedMimeType(mimeType?: string, fileName?: string): string | null {
  const raw = String(mimeType || '').toLowerCase().trim();
  if (raw === 'image/jpg') return 'image/jpeg';
  if (ALLOWED_FILE_MIMES.includes(raw)) return raw;
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return null;
}

function buildFileDataUri(mimeType: string, buf: Buffer): string | null {
  if (buf.length > 2 * 1024 * 1024) return null;
  return `data:${mimeType};base64,${buf.toString('base64')}`;
}

function toVendorProfile(v: VendorAccount): VendorProfile {
  return {
    id: v.id,
    email: v.email,
    full_name: v.full_name,
    company_role: v.company_role,
  };
}

function toVendorAccountPublic(v: VendorAccount): VendorAccountPublic {
  return {
    id: v.id,
    email: v.email,
    full_name: v.full_name,
    company_role: v.company_role,
    active: v.active,
    created_at: v.created_at,
    updated_at: v.updated_at,
  };
}

function roundMoney2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function generateNextBillingDocNumber(
  docType: VendorBillingDocType,
  settings: VendorSettings,
  existingDocs: VendorBillingDoc[],
): string {
  const prefix =
    docType === 'facture'
      ? (settings.invoice_prefix || 'FAC-B2B').trim()
      : (settings.quote_prefix || 'DEV-B2B').trim();
  const year = new Date().getFullYear();
  let maxSeq = 0;
  for (const d of existingDocs) {
    if (d.doc_type !== docType) continue;
    const match = String(d.doc_number || '').match(/(\d+)$/);
    if (match) {
      const seq = parseInt(match[1], 10);
      if (!Number.isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }
  const nextSeq = String(maxSeq + 1).padStart(4, '0');
  return `${prefix}-${year}-${nextSeq}`;
}

function requireVendorAuth(req: VendorAuthedRequest, res: Response, next: NextFunction): void {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentification éditeur requise.' });
    return;
  }
  const parsed = verifyVendorToken(token);
  if (!parsed) {
    res.status(401).json({ error: 'Session éditeur expirée ou invalide.' });
    return;
  }
  const db = loadDb();
  const vendor = db.vendor_accounts.find((v) => v.id === parsed.vid);
  if (!vendor || !vendor.active) {
    res.status(403).json({ error: 'Compte éditeur inactif ou introuvable.' });
    return;
  }
  req.vendorAccount = vendor;
  next();
}

function daysBetweenToday(isoDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${isoDate}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function checkWorkspaceAccess(ws: WorkspaceData): {
  allowed: boolean;
  reason?: 'suspended' | 'pending' | 'trial_expired' | 'subscription_expired';
  message?: string;
} {
  const lic = ws.b2b_license;
  if (!lic) return { allowed: true };
  const days = daysBetweenToday(lic.valid_until);
  if (lic.status === 'suspendu') {
    return {
      allowed: false,
      reason: 'suspended',
      message:
        'Accès bloqué : cet espace a été suspendu par l’administrateur de la plateforme.',
    };
  }
  if (lic.status === 'en_attente_activation') {
    return {
      allowed: false,
      reason: 'pending',
      message:
        'Accès en attente : cet espace n’est pas encore activé.',
    };
  }
  if (lic.status === 'essai_gratuit' && days < 0) {
    return {
      allowed: false,
      reason: 'trial_expired',
      message:
        'Période d’essai de 14 jours terminée : l’accès à l’application est bloqué sans licence active.',
    };
  }
  if (lic.status === 'actif' && days < 0) {
    return {
      allowed: false,
      reason: 'subscription_expired',
      message:
        'Licence expirée : l’accès à l’application est bloqué jusqu’au renouvellement.',
    };
  }
  return { allowed: true };
}

function buildVendorWorkspaceSummary(w: WorkspaceData): VendorWorkspaceSummary {
  const lic =
    w.b2b_license ||
    createDefaultLicense(w.code === 'DEMO' ? 'demo_gratuit' : 'pack_essentiel', 'MAD', 'essai_gratuit');
  const daysRemaining = daysBetweenToday(lic.valid_until);
  let renewalState: VendorWorkspaceSummary['renewal_state'] = 'ok';
  if (lic.status === 'essai_gratuit') {
    renewalState = daysRemaining < 0 ? 'expired' : 'trial';
  } else if (daysRemaining < 0) {
    renewalState = 'expired';
  } else if (daysRemaining <= 30) {
    renewalState = 'due_soon';
  }

  const adminUser = w.users.find((u) => u.role === 'admin') || w.users[0];
  return {
    id: w.id,
    code: w.code,
    name: w.name,
    created_at: w.created_at,
    admin_email: adminUser?.email || w.company_settings.email || '',
    admin_name: adminUser?.full_name || '',
    company_phone: w.company_settings.phone || '',
    member_emails: w.users.map((u) => u.email),
    members: w.users.map((u) => ({
      full_name: u.full_name,
      email: u.email,
      role: u.role,
      created_at: u.created_at,
    })),
    b2b_license: lic,
    days_remaining: daysRemaining,
    renewal_state: renewalState,
    usage: {
      vehicles: w.vehicles.length,
      users: w.users.length,
      trips: w.trips.length,
      clients: w.clients.length,
      invoices: w.invoices.length,
    },
  };
}

function computeVendorMetrics(
  summaries: VendorWorkspaceSummary[],
  requests: B2BDeploymentRequest[],
): VendorPortfolioMetrics {
  const trials = summaries.filter((w) => w.b2b_license.status === 'essai_gratuit');
  const activePaid = summaries.filter((w) => w.b2b_license.status === 'actif');
  const pendingActivation = summaries.filter((w) => w.b2b_license.status === 'en_attente_activation');
  const suspended = summaries.filter((w) => w.b2b_license.status === 'suspendu');
  const renewalsDueSoon = summaries.filter(
    (w) => w.b2b_license.status === 'actif' && w.days_remaining >= 0 && w.days_remaining <= 30,
  );
  const expired = summaries.filter(
    (w) => w.b2b_license.status !== 'suspendu' && w.days_remaining < 0,
  );

  const sumBy = (list: VendorWorkspaceSummary[], curr: Currency, field: 'annual_fee' | 'setup_fee') =>
    list
      .filter((w) => w.b2b_license.currency === curr)
      .reduce((acc, w) => acc + Number(w.b2b_license[field] || 0), 0);

  return {
    total_workspaces: summaries.length,
    trials_count: trials.length,
    active_paid_count: activePaid.length,
    pending_activation_count: pendingActivation.length,
    suspended_count: suspended.length,
    renewals_due_soon_count: renewalsDueSoon.length,
    expired_count: expired.length,
    open_requests_count: requests.filter((r) => !['convertie', 'archivee'].includes(r.status)).length,
    total_requests_count: requests.length,
    arr_mad: sumBy(activePaid, 'MAD', 'annual_fee'),
    arr_eur: sumBy(activePaid, 'EUR', 'annual_fee'),
    setup_mad: sumBy(activePaid, 'MAD', 'setup_fee'),
    setup_eur: sumBy(activePaid, 'EUR', 'setup_fee'),
  };
}

function buildTripAlerts(ws: WorkspaceData): TripAlert[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const soonThreshold = new Date(today);
  soonThreshold.setDate(soonThreshold.getDate() + 30);

  const items: TripAlert[] = [];
  for (const t of ws.trips) {
    if (!['À planifier', 'En cours'].includes(t.status)) continue;
    const ref = `Mission ${t.reference || '—'}`;
    if (getTripTractorIds(t).length === 0) {
      items.push({
        id: t.id,
        reference: t.reference,
        type: 'Véhicule non attribué',
        detail: `${ref} : aucun véhicule attribué.`,
        level: 'À traiter',
        target_page: 'trips',
      });
    }
    if (!t.driver_id) {
      items.push({
        id: t.id,
        reference: t.reference,
        type: 'Conducteur non attribué',
        detail: `${ref} : aucun conducteur affecté.`,
        level: 'À traiter',
        target_page: 'trips',
      });
    }
    if (!t.departure_date || !t.arrival_date) {
      items.push({
        id: t.id,
        reference: t.reference,
        type: 'Dates incomplètes',
        detail: `${ref} : date de départ ou d’arrivée manquante.`,
        level: 'À traiter',
        target_page: 'trips',
      });
    }
    if (t.arrival_date) {
      const arrival = new Date(`${t.arrival_date}T00:00:00`);
      if (arrival < today) {
        items.push({
          id: t.id,
          reference: t.reference,
          type: 'Mission en retard',
          detail: `${ref} : date d’arrivée prévue dépassée, statut « ${t.status} ».`,
          level: 'Urgent',
          target_page: 'trips',
        });
      }
    }
    if (t.status === 'À planifier' && t.departure_date) {
      const departure = new Date(`${t.departure_date}T00:00:00`);
      if (departure < today) {
        items.push({
          id: t.id,
          reference: t.reference,
          type: 'Départ non confirmé',
          detail: `${ref} : date de départ dépassée mais mission toujours à planifier.`,
          level: 'Urgent',
          target_page: 'trips',
        });
      }
    }
    if (t.driver_response === 'refused') {
      items.push({
        id: t.id,
        reference: t.reference,
        type: 'Mission refusée par le conducteur',
        detail: `${ref} : refusée par le conducteur${t.driver_notes ? ` (${t.driver_notes})` : ''}. Veuillez réaffecter un conducteur.`,
        level: 'Urgent',
        target_page: 'trips',
      });
    }
  }

  const checkExpiry = (
    id: string,
    reference: string,
    label: string,
    dateStr: string | null | undefined,
    targetPage: 'vehicles' | 'drivers' | 'documents',
  ) => {
    if (!dateStr) return;
    const d = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(d.getTime())) return;
    if (d < today) {
      items.push({
        id,
        reference,
        type: `${label} expiré(e)`,
        detail: `${reference} — ${label} expiré(e) depuis le ${dateStr}.`,
        level: 'Urgent',
        target_page: targetPage,
      });
    } else if (d <= soonThreshold) {
      const days = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      items.push({
        id,
        reference,
        type: `${label} à renouveler`,
        detail: `${reference} — ${label} arrive à échéance dans ${days} j (${dateStr}).`,
        level: 'À traiter',
        target_page: targetPage,
      });
    }
  };

  for (const v of ws.vehicles) {
    if (v.status === 'inactif') continue;
    checkExpiry(v.id, v.registration, 'Assurance véhicule', v.insurance_expiry, 'vehicles');
    checkExpiry(v.id, v.registration, 'Visite technique', v.technical_inspection_expiry, 'vehicles');
    checkExpiry(v.id, v.registration, 'Vignette / Carte grise', v.vignette_expiry, 'vehicles');
  }

  for (const d of ws.drivers) {
    if (d.status === 'inactif') continue;
    checkExpiry(d.id, d.full_name, 'Permis de conduire', d.license_expiry, 'drivers');
    checkExpiry(d.id, d.full_name, 'Visite médicale / Carte pro', d.medical_visit_expiry, 'drivers');
  }

  for (const doc of ws.documents) {
    if (doc.expiry_date) {
      checkExpiry(doc.id, doc.document_name, 'Document mission', doc.expiry_date, 'documents');
    }
  }

  return items;
}

function formatInvoiceNumber(ws: WorkspaceData): string {
  const s = ws.invoice_settings;
  const numStr = String(s.next_number).padStart(s.padding_length || 4, '0');
  const code = `${s.prefix || 'FAC'}${s.separator ?? '-'}${numStr}`;
  s.next_number += 1;
  return code;
}

function computeInvoiceAmounts(
  basis: 'HT' | 'TTC',
  enteredAmount: number,
  taxRate: number,
): { subtotal_ht: number; tax_amount: number; total_ttc: number } {
  const rate = taxRate / 100;
  if (basis === 'HT') {
    const ht = Number(enteredAmount.toFixed(2));
    const tva = Number((ht * rate).toFixed(2));
    const ttc = Number((ht + tva).toFixed(2));
    return { subtotal_ht: ht, tax_amount: tva, total_ttc: ttc };
  }
  const ttc = Number(enteredAmount.toFixed(2));
  const ht = Number((ttc / (1 + rate)).toFixed(2));
  const tva = Number((ttc - ht).toFixed(2));
  return { subtotal_ht: ht, tax_amount: tva, total_ttc: ttc };
}

function getLookups(ws: WorkspaceData): LookupsData {
  const countryMap = new Map(ws.countries.map((c) => [c.id, c]));
  return {
    vehicles: ws.vehicles.map((v) => ({
      id: v.id,
      registration: v.registration,
      vehicle_type: v.vehicle_type || null,
      fleet_category: inferFleetCategory(v),
      brand: v.brand,
      model: v.model,
      status: v.status,
    })),
    drivers: ws.drivers.map((d) => ({
      id: d.id,
      full_name: d.full_name,
      status: d.status,
    })),
    clients: ws.clients.map((c) => ({
      id: c.id,
      company_name: c.company_name,
      ice: c.ice,
      active: c.active,
    })),
    trips: ws.trips.map((t) => ({
      id: t.id,
      reference: t.reference,
      departure: t.departure,
      destination: t.destination,
      status: t.status,
      currency: t.currency,
    })),
    cities: ws.cities.map((c) => {
      const country = countryMap.get(c.country_id);
      return {
        ...c,
        country_name: country?.name || '',
        country_iso: country?.iso_code || null,
      };
    }),
    countries: ws.countries,
  };
}

async function startServer(): Promise<void> {
  loadDb();
  const app = express();
  app.use(express.json({ limit: '36mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // ---------------- AUTH & WORKSPACE ----------------
  app.get('/api/auth/workspace-preview', (req, res) => {
    const code = typeof req.query.code === 'string' && req.query.code.trim() ? req.query.code.trim() : 'DEMO';
    const ws = code.toUpperCase() === 'DEMO' ? ensureDemoWorkspaceReady() : findWorkspaceByCode(code);
    if (!ws) {
      res.status(404).json({ error: `Code espace « ${code} » introuvable.` });
      return;
    }
    res.json({
      id: ws.id,
      code: ws.code,
      name: ws.name,
      is_demo: ws.code === 'DEMO',
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password, workspaceCode } = req.body as {
      email?: string;
      password?: string;
      workspaceCode?: string;
    };
    if (!email || !password) {
      res.status(400).json({ error: 'E-mail et mot de passe requis.' });
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    const db = loadDb();

    let ws: WorkspaceData | undefined;
    let user: WorkspaceUser | undefined;

    if (workspaceCode && workspaceCode.trim()) {
      ws = findWorkspaceByCode(workspaceCode);
      user = ws?.users.find((u) => u.email.toLowerCase() === normalizedEmail);
    } else {
      for (const candidateWs of db.workspaces) {
        const found = candidateWs.users.find((u) => u.email.toLowerCase() === normalizedEmail);
        if (found) {
          ws = candidateWs;
          user = found;
          break;
        }
      }
    }

    if (!ws || !user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: 'Identifiants incorrects.' });
      return;
    }
    if (!user.active) {
      res.status(403).json({ error: 'Votre compte est désactivé. Contactez un administrateur.' });
      return;
    }
    const access = checkWorkspaceAccess(ws);
    if (!access.allowed) {
      res.status(403).json({
        error: access.message,
        access_blocked: true,
        block_reason: access.reason,
      });
      return;
    }

    if (ensureDriverLinkForUser(ws, user)) {
      ws.updated_at = new Date().toISOString();
      saveDb();
    }
    const token = signToken(user.id, ws.id);
    res.json({ token, profile: toPublicProfile(user, ws) });
  });

  app.post('/api/auth/demo', (req, res) => {
    const { role } = req.body as { role?: Role };
    const targetRole: Role = role && ['admin', 'logistique', 'comptable', 'conducteur'].includes(role)
      ? role
      : 'admin';
    const ws = ensureDemoWorkspaceReady();
    const access = checkWorkspaceAccess(ws);
    if (!access.allowed) {
      res.status(403).json({
        error: access.message,
        access_blocked: true,
        block_reason: access.reason,
      });
      return;
    }
    const user =
      ws.users.find((u) => u.role === targetRole && u.active) ||
      ws.users.find((u) => u.active) ||
      ws.users[0];
    if (!user) {
      res.status(404).json({ error: 'Profil de démonstration introuvable.' });
      return;
    }
    if (ensureDriverLinkForUser(ws, user)) {
      ws.updated_at = new Date().toISOString();
      saveDb();
    }
    const token = signToken(user.id, ws.id);
    res.json({ token, profile: toPublicProfile(user, ws) });
  });

  app.post('/api/auth/register', (req, res) => {
    const { mode, full_name, email, password, role, company_name, workspace_code } = req.body as {
      mode?: 'create' | 'join';
      full_name?: string;
      email?: string;
      password?: string;
      role?: Role;
      company_name?: string;
      workspace_code?: string;
    };

    if (!full_name?.trim() || !email?.trim() || !password || password.length < 4) {
      res.status(400).json({ error: 'Nom complet, e-mail et mot de passe (min. 4 caractères) obligatoires.' });
      return;
    }

    try {
      if (mode === 'create') {
        const company = company_name?.trim() || `${full_name.trim()} Transport`;
        const { workspace, user } = createEmptyWorkspace(company, email, password, full_name);
        const token = signToken(user.id, workspace.id);
        res.status(201).json({ token, profile: toPublicProfile(user, workspace) });
        return;
      }

      const code = workspace_code?.trim() || 'DEMO';
      const ws = code.toUpperCase() === 'DEMO' ? ensureDemoWorkspaceReady() : findWorkspaceByCode(code);
      if (!ws) {
        res.status(404).json({ error: `Code d’espace « ${code} » introuvable.` });
        return;
      }
      const access = checkWorkspaceAccess(ws);
      if (!access.allowed) {
        res.status(403).json({
          error: access.message,
          access_blocked: true,
          block_reason: access.reason,
        });
        return;
      }
      const allowedJoinRoles: Role[] =
        ws.code.toUpperCase() === 'DEMO'
          ? ['admin', 'logistique', 'comptable', 'conducteur']
          : ['logistique', 'comptable', 'conducteur'];
      const assignedRole: Role = role && allowedJoinRoles.includes(role) ? role : 'logistique';

      const user = addUserToWorkspace(ws, {
        email,
        password,
        full_name,
        role: assignedRole,
        active: true,
      });
      addAuditLog(ws, user, 'REGISTER_FREE_USER', 'profiles', user.id, { role: assignedRole });
      saveDb();
      const token = signToken(user.id, ws.id);
      res.status(201).json({ token, profile: toPublicProfile(user, ws) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Erreur d’inscription.' });
    }
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const ws = req.workspace!;
    if (ensureDriverLinkForUser(ws, user)) {
      ws.updated_at = new Date().toISOString();
      saveDb();
    }
    res.json({ profile: toPublicProfile(user, ws) });
  });

  app.get('/api/workspace/share', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    res.json({
      workspace_id: ws.id,
      workspace_code: ws.code,
      workspace_name: ws.name,
      users_count: ws.users.length,
    });
  });

  app.get('/api/lookups', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const ws = req.workspace!;
    if (user.role === 'conducteur' && ensureDriverLinkForUser(ws, user)) {
      ws.updated_at = new Date().toISOString();
      saveDb();
    }
    const data = getLookups(ws);
    if (user.role === 'conducteur') {
      const myTrips = ws.trips.filter((t) => t.driver_id && t.driver_id === user.driver_id);
      const assignedIds = new Set(myTrips.map((t) => t.id));
      const myClientIds = new Set(myTrips.map((t) => t.client_id).filter(Boolean));
      const myVehicleIds = new Set<string>();
      for (const t of myTrips) {
        for (const tid of getTripTractorIds(t)) myVehicleIds.add(tid);
        if (t.trailer_id) myVehicleIds.add(t.trailer_id);
      }
      data.trips = data.trips.filter((t) => assignedIds.has(t.id));
      data.clients = data.clients.filter((c) => myClientIds.has(c.id));
      data.vehicles = data.vehicles.filter((v) => myVehicleIds.has(v.id));
      data.drivers = data.drivers.filter((d) => d.id === user.driver_id);
    }
    res.json(data);
  });

  // ---------------- DASHBOARD & ALERTS ----------------
  app.get('/api/dashboard', requireAuth, requireRoles('admin', 'logistique', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const alerts = buildTripAlerts(ws);
    res.json({
      counts: {
        vehicles: ws.vehicles.length,
        drivers: ws.drivers.length,
        clients: ws.clients.length,
        trips: ws.trips.length,
        activeTrips: ws.trips.filter((t) => t.status === 'En cours').length,
        doneTrips: ws.trips.filter((t) => t.status === 'Terminée').length,
        alerts: alerts.length,
      },
    });
  });

  app.get('/api/alerts', requireAuth, requireRoles('admin', 'logistique', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    res.json(buildTripAlerts(ws));
  });

  // ---------------- VEHICLES ----------------
  app.get('/api/vehicles', requireAuth, requireRoles('admin', 'logistique', 'comptable'), (req: AuthedRequest, res) => {
    res.json(req.workspace!.vehicles);
  });

  app.post('/api/vehicles', requireAuth, requireRoles('admin', 'logistique'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const {
      registration,
      vehicle_type,
      fleet_category,
      brand,
      model,
      year,
      status,
      insurance_expiry,
      technical_inspection_expiry,
      vignette_expiry,
    } = req.body;
    if (!String(registration || '').trim()) {
      res.status(400).json({ error: 'Immatriculation obligatoire.' });
      return;
    }
    const cleanType = vehicle_type ? String(vehicle_type).trim() : null;
    const item = {
      id: newId('veh'),
      registration: String(registration).trim(),
      vehicle_type: cleanType,
      fleet_category: sanitizeFleetCategory(fleet_category, cleanType),
      brand: brand ? String(brand).trim() : null,
      model: model ? String(model).trim() : null,
      year: year ? Number(year) : null,
      status: status || 'actif',
      insurance_expiry: insurance_expiry || null,
      technical_inspection_expiry: technical_inspection_expiry || null,
      vignette_expiry: vignette_expiry || null,
      created_at: new Date().toISOString(),
    };
    ws.vehicles.unshift(item);
    addAuditLog(ws, req.authUser!, 'CREATE_VEHICLE', 'vehicles', item.id, { registration: item.registration });
    saveDb();
    res.status(201).json(item);
  });

  app.put('/api/vehicles/:id', requireAuth, requireRoles('admin', 'logistique'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const item = ws.vehicles.find((v) => v.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Véhicule introuvable.' });
      return;
    }
    const {
      registration,
      vehicle_type,
      fleet_category,
      brand,
      model,
      year,
      status,
      insurance_expiry,
      technical_inspection_expiry,
      vignette_expiry,
    } = req.body;
    if (registration !== undefined) item.registration = String(registration).trim();
    if (vehicle_type !== undefined) item.vehicle_type = vehicle_type ? String(vehicle_type).trim() : null;
    if (fleet_category !== undefined) {
      item.fleet_category = sanitizeFleetCategory(fleet_category, item.vehicle_type);
    } else if (vehicle_type !== undefined && !item.fleet_category) {
      item.fleet_category = inferFleetCategory(item);
    }
    if (brand !== undefined) item.brand = brand ? String(brand).trim() : null;
    if (model !== undefined) item.model = model ? String(model).trim() : null;
    if (year !== undefined) item.year = year ? Number(year) : null;
    if (status !== undefined) item.status = status;
    if (insurance_expiry !== undefined) item.insurance_expiry = insurance_expiry || null;
    if (technical_inspection_expiry !== undefined) item.technical_inspection_expiry = technical_inspection_expiry || null;
    if (vignette_expiry !== undefined) item.vignette_expiry = vignette_expiry || null;
    saveDb();
    res.json(item);
  });

  app.delete('/api/vehicles/:id', requireAuth, requireRoles('admin', 'logistique'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const idx = ws.vehicles.findIndex((v) => v.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Véhicule introuvable.' });
      return;
    }
    if (
      ws.trips.some(
        (t) =>
          ['À planifier', 'En cours'].includes(t.status) &&
          (getTripTractorIds(t).includes(req.params.id) || t.trailer_id === req.params.id),
      )
    ) {
      res.status(400).json({ error: 'Suppression impossible : ce véhicule ou matériel est affecté à une mission active ou planifiée.' });
      return;
    }
    const [removed] = ws.vehicles.splice(idx, 1);
    ws.trips.forEach((t) => {
      if (Array.isArray(t.tractor_ids)) {
        t.tractor_ids = t.tractor_ids.filter((id) => id !== removed.id);
      }
      if (t.vehicle_id === removed.id) {
        t.vehicle_id = t.tractor_ids?.[0] || null;
      }
      if (t.trailer_id === removed.id) {
        t.trailer_id = null;
      }
    });
    ws.maintenance.forEach((m) => {
      if (m.vehicle_id === removed.id) m.vehicle_id = null;
    });
    ws.gps_devices = ws.gps_devices.filter((g) => g.vehicle_id !== removed.id);
    addAuditLog(ws, req.authUser!, 'DELETE_VEHICLE', 'vehicles', removed.id, { registration: removed.registration });
    saveDb();
    res.json({ ok: true });
  });

  // ---------------- DRIVERS ----------------
  app.get('/api/drivers', requireAuth, requireRoles('admin', 'logistique', 'comptable'), (req: AuthedRequest, res) => {
    res.json(req.workspace!.drivers);
  });

  app.post('/api/drivers', requireAuth, requireRoles('admin', 'logistique'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const { full_name, phone, email, license_number, license_expiry, medical_visit_expiry, status } = req.body;
    if (!String(full_name || '').trim()) {
      res.status(400).json({ error: 'Nom complet obligatoire.' });
      return;
    }
    const item = {
      id: newId('drv'),
      full_name: String(full_name).trim(),
      phone: phone ? String(phone).trim() : null,
      email: email ? String(email).trim() : null,
      license_number: license_number ? String(license_number).trim() : null,
      license_expiry: license_expiry || null,
      medical_visit_expiry: medical_visit_expiry || null,
      status: status || 'actif',
      created_at: new Date().toISOString(),
    };
    ws.drivers.unshift(item);
    saveDb();
    res.status(201).json(item);
  });

  app.put('/api/drivers/:id', requireAuth, requireRoles('admin', 'logistique'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const item = ws.drivers.find((d) => d.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Conducteur introuvable.' });
      return;
    }
    const { full_name, phone, email, license_number, license_expiry, medical_visit_expiry, status } = req.body;
    if (full_name !== undefined) item.full_name = String(full_name).trim();
    if (phone !== undefined) item.phone = phone ? String(phone).trim() : null;
    if (email !== undefined) item.email = email ? String(email).trim() : null;
    if (license_number !== undefined) item.license_number = license_number ? String(license_number).trim() : null;
    if (license_expiry !== undefined) item.license_expiry = license_expiry || null;
    if (medical_visit_expiry !== undefined) item.medical_visit_expiry = medical_visit_expiry || null;
    if (status !== undefined) item.status = status;
    saveDb();
    res.json(item);
  });

  app.delete('/api/drivers/:id', requireAuth, requireRoles('admin', 'logistique'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const idx = ws.drivers.findIndex((d) => d.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Conducteur introuvable.' });
      return;
    }
    if (ws.trips.some((t) => t.driver_id === req.params.id && ['À planifier', 'En cours'].includes(t.status))) {
      res.status(400).json({ error: 'Suppression impossible : ce conducteur est affecté à une mission active ou planifiée.' });
      return;
    }
    const [removed] = ws.drivers.splice(idx, 1);
    ws.users.forEach((u) => {
      if (u.driver_id === removed.id) u.driver_id = null;
    });
    ws.employees.forEach((e) => {
      if (e.driver_id === removed.id) e.driver_id = null;
    });
    ws.trips.forEach((t) => {
      if (t.driver_id === removed.id) t.driver_id = null;
    });
    addAuditLog(ws, req.authUser!, 'DELETE_DRIVER', 'drivers', removed.id, { full_name: removed.full_name });
    saveDb();
    res.json({ ok: true });
  });

  // ---------------- CLIENTS ----------------
  app.get('/api/clients', requireAuth, requireRoles('admin', 'logistique', 'comptable'), (req: AuthedRequest, res) => {
    res.json(req.workspace!.clients);
  });

  app.post('/api/clients', requireAuth, requireRoles('admin', 'logistique'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const { company_name, contact_name, phone, email, address, ice, client_type, active } = req.body;
    if (!String(company_name || '').trim()) {
      res.status(400).json({ error: 'Raison sociale obligatoire.' });
      return;
    }
    const item = {
      id: newId('cli'),
      company_name: String(company_name).trim(),
      contact_name: contact_name ? String(contact_name).trim() : null,
      phone: phone ? String(phone).trim() : null,
      email: email ? String(email).trim() : null,
      address: address ? String(address).trim() : null,
      ice: ice ? String(ice).trim() : null,
      client_type: client_type ? String(client_type).trim() : null,
      active: active !== false && active !== 'false',
      created_at: new Date().toISOString(),
    };
    ws.clients.unshift(item);
    saveDb();
    res.status(201).json(item);
  });

  app.put('/api/clients/:id', requireAuth, requireRoles('admin', 'logistique'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const item = ws.clients.find((c) => c.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Client introuvable.' });
      return;
    }
    const { company_name, contact_name, phone, email, address, ice, client_type, active } = req.body;
    if (company_name !== undefined) item.company_name = String(company_name).trim();
    if (contact_name !== undefined) item.contact_name = contact_name ? String(contact_name).trim() : null;
    if (phone !== undefined) item.phone = phone ? String(phone).trim() : null;
    if (email !== undefined) item.email = email ? String(email).trim() : null;
    if (address !== undefined) item.address = address ? String(address).trim() : null;
    if (ice !== undefined) item.ice = ice ? String(ice).trim() : null;
    if (client_type !== undefined) item.client_type = client_type ? String(client_type).trim() : null;
    if (active !== undefined) item.active = active !== false && active !== 'false';
    saveDb();
    res.json(item);
  });

  app.delete('/api/clients/:id', requireAuth, requireRoles('admin', 'logistique'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const idx = ws.clients.findIndex((c) => c.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Client introuvable.' });
      return;
    }
    if (ws.trips.some((t) => t.client_id === req.params.id && ['À planifier', 'En cours'].includes(t.status))) {
      res.status(400).json({ error: 'Suppression impossible : ce client est lié à une mission active ou planifiée.' });
      return;
    }
    const [removed] = ws.clients.splice(idx, 1);
    addAuditLog(ws, req.authUser!, 'DELETE_CLIENT', 'clients', removed.id, { company_name: removed.company_name });
    saveDb();
    res.json({ ok: true });
  });

  // ---------------- TRIPS / MISSIONS ----------------
  app.get('/api/trips', requireAuth, (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const user = req.authUser!;
    if (user.role === 'conducteur') {
      if (ensureDriverLinkForUser(ws, user)) {
        ws.updated_at = new Date().toISOString();
        saveDb();
      }
      res.json(
        ws.trips
          .filter((t) => t.driver_id && t.driver_id === user.driver_id)
          .map((t) => ({ ...t, revenue: 0 })),
      );
      return;
    }
    if (user.role === 'logistique') {
      res.json(ws.trips.map((t) => ({ ...t, revenue: 0 })));
      return;
    }
    res.json(ws.trips);
  });

  app.get('/api/trips/:id/detail', requireAuth, (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const user = req.authUser!;
    const trip = ws.trips.find((t) => t.id === req.params.id);
    if (!trip) {
      res.status(404).json({ error: 'Mission introuvable.' });
      return;
    }
    if (user.role === 'conducteur' && trip.driver_id !== user.driver_id) {
      res.status(403).json({ error: 'Accès refusé à cette mission.' });
      return;
    }
    const documents = ws.documents.filter((d) => d.trip_id === trip.id).map(toPublicDocument);
    if (user.role === 'conducteur') {
      const driverExpenses = ws.expenses.filter(
        (e) => e.trip_id === trip.id && e.created_by === user.id,
      );
      res.json({
        trip: { ...trip, revenue: 0 },
        expenses: [],
        driverExpenses,
        documents,
        payrollAllocations: [],
      });
      return;
    }
    if (user.role === 'logistique') {
      res.json({
        trip: { ...trip, revenue: 0 },
        expenses: [],
        driverExpenses: [],
        documents: documents.filter((d) => d.document_type !== 'Justificatif dépense'),
        payrollAllocations: [],
      });
      return;
    }
    const expenses = ws.expenses.filter((e) => e.trip_id === trip.id);
    const payrollAllocations = ws.payroll_allocations.filter((a) => a.trip_id === trip.id);
    res.json({ trip, expenses, documents, payrollAllocations });
  });

  app.post('/api/trips', requireAuth, requireRoles('admin', 'logistique'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const user = req.authUser!;
    const b = req.body;
    if (!b.reference?.trim() || !b.client_id || !b.driver_id || !b.departure?.trim() || !b.destination?.trim()) {
      res.status(400).json({ error: 'Référence, client, conducteur, départ et destination sont obligatoires.' });
      return;
    }
    const status = b.status || 'À planifier';
    if (['À planifier', 'En cours'].includes(status) && (!b.departure_date || !b.arrival_date)) {
      res.status(400).json({ error: 'Pour une mission « À planifier » ou « En cours », les dates sont obligatoires.' });
      return;
    }
    if (b.departure_date && b.arrival_date && b.departure_date > b.arrival_date) {
      res.status(400).json({ error: 'La date d’arrivée doit être égale ou postérieure à la date de départ.' });
      return;
    }

    const nextTractorIds =
      user.role === 'admin'
        ? normalizeTripTractorIds(ws, b.tractor_ids, b.vehicle_id)
        : [];
    const nextVehicleId = nextTractorIds[0] || null;
    const validVehIds = new Set(ws.vehicles.map((v) => v.id));
    const nextTrailerId =
      user.role === 'admin' && typeof b.trailer_id === 'string' && validVehIds.has(b.trailer_id)
        ? b.trailer_id
        : null;
    const nextDriverId = b.driver_id || null;
    const conflict = findTripAssignmentConflict(
      ws.trips,
      {
        vehicle_id: nextVehicleId,
        tractor_ids: nextTractorIds,
        trailer_id: nextTrailerId,
        driver_id: nextDriverId,
        departure_date: b.departure_date || null,
        arrival_date: b.arrival_date || null,
        status,
      },
      { vehicles: ws.vehicles, drivers: ws.drivers },
    );
    if (conflict.hasConflict) {
      res.status(409).json({ error: conflict.message });
      return;
    }

    const trip: Trip = {
      id: newId('trp'),
      reference: String(b.reference).trim(),
      client_id: b.client_id || null,
      vehicle_id: nextVehicleId,
      tractor_ids: nextTractorIds,
      trailer_id: nextTrailerId,
      driver_id: nextDriverId,
      departure: String(b.departure).trim(),
      destination: String(b.destination).trim(),
      departure_city_id: b.departure_city_id || null,
      destination_city_id: b.destination_city_id || null,
      departure_date: b.departure_date || null,
      arrival_date: b.arrival_date || null,
      status,
      revenue: user.role === 'admin' ? Number(b.revenue || 0) : 0,
      currency: user.role === 'admin' ? (b.currency === 'EUR' ? 'EUR' : 'MAD') : 'MAD',
      driver_response: 'pending',
      driver_notes: null,
      created_by: user.id,
      created_at: new Date().toISOString(),
    };
    ws.trips.unshift(trip);
    addAuditLog(ws, user, 'CREATE_TRIP', 'trips', trip.id, { reference: trip.reference });
    saveDb();
    res.status(201).json(trip);
  });

  app.put('/api/trips/:id', requireAuth, requireRoles('admin', 'logistique'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const user = req.authUser!;
    const trip = ws.trips.find((t) => t.id === req.params.id);
    if (!trip) {
      res.status(404).json({ error: 'Mission introuvable.' });
      return;
    }
    const b = req.body;
    const status = b.status || trip.status;
    const depDate = b.departure_date !== undefined ? b.departure_date || null : trip.departure_date;
    const arrDate = b.arrival_date !== undefined ? b.arrival_date || null : trip.arrival_date;

    if (['À planifier', 'En cours'].includes(status) && (!depDate || !arrDate)) {
      res.status(400).json({ error: 'Date de départ et date d’arrivée obligatoires pour ce statut.' });
      return;
    }
    if (depDate && arrDate && depDate > arrDate) {
      res.status(400).json({ error: 'La date d’arrivée doit être égale ou postérieure au départ.' });
      return;
    }

    const validVehIds = new Set(ws.vehicles.map((v) => v.id));
    const nextDriverId = b.driver_id !== undefined ? b.driver_id || null : trip.driver_id;
    let nextTractorIds = getTripTractorIds(trip);
    if (user.role === 'admin' && (b.tractor_ids !== undefined || b.vehicle_id !== undefined)) {
      nextTractorIds = normalizeTripTractorIds(
        ws,
        b.tractor_ids !== undefined ? b.tractor_ids : [],
        b.vehicle_id !== undefined ? b.vehicle_id : null,
      );
    }
    const nextVehicleId = nextTractorIds[0] || null;
    let nextTrailerId = trip.trailer_id || null;
    if (user.role === 'admin' && b.trailer_id !== undefined) {
      nextTrailerId =
        typeof b.trailer_id === 'string' && validVehIds.has(b.trailer_id) ? b.trailer_id : null;
    }

    const conflict = findTripAssignmentConflict(
      ws.trips,
      {
        id: trip.id,
        vehicle_id: nextVehicleId,
        tractor_ids: nextTractorIds,
        trailer_id: nextTrailerId,
        driver_id: nextDriverId,
        departure_date: depDate,
        arrival_date: arrDate,
        status,
      },
      { vehicles: ws.vehicles, drivers: ws.drivers },
    );
    if (conflict.hasConflict) {
      res.status(409).json({ error: conflict.message });
      return;
    }

    const prevDriverId = trip.driver_id;

    if (b.reference !== undefined) trip.reference = String(b.reference).trim();
    if (b.client_id !== undefined) trip.client_id = b.client_id || null;
    trip.driver_id = nextDriverId;
    if (nextDriverId !== prevDriverId) {
      trip.driver_response = 'pending';
      trip.driver_notes = null;
    }
    if (b.departure !== undefined) trip.departure = String(b.departure).trim();
    if (b.destination !== undefined) trip.destination = String(b.destination).trim();
    if (b.departure_city_id !== undefined) trip.departure_city_id = b.departure_city_id || null;
    if (b.destination_city_id !== undefined) trip.destination_city_id = b.destination_city_id || null;
    trip.departure_date = depDate;
    trip.arrival_date = arrDate;
    trip.status = status;

    if (user.role === 'admin') {
      trip.vehicle_id = nextVehicleId;
      trip.tractor_ids = nextTractorIds;
      trip.trailer_id = nextTrailerId;
      if (b.revenue !== undefined) trip.revenue = Number(b.revenue || 0);
      if (b.currency !== undefined) trip.currency = b.currency === 'EUR' ? 'EUR' : 'MAD';
    }

    addAuditLog(ws, user, 'UPDATE_TRIP', 'trips', trip.id, { reference: trip.reference, status: trip.status });
    saveDb();
    res.json(user.role === 'logistique' ? { ...trip, revenue: 0 } : trip);
  });

  app.delete('/api/trips/:id', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const idx = ws.trips.findIndex((t) => t.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Mission introuvable.' });
      return;
    }
    if (ws.invoices.some((inv) => inv.trip_id === req.params.id)) {
      res.status(400).json({ error: 'Suppression impossible : une facture est liée à cette mission.' });
      return;
    }
    const [removed] = ws.trips.splice(idx, 1);
    const removedDocs = ws.documents.filter((d) => d.trip_id === removed.id);
    for (const d of removedDocs) {
      if (d.file_path) {
        const abs = resolveUploadPath(d.file_path);
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      }
    }
    ws.expenses = ws.expenses.filter((e) => e.trip_id !== removed.id);
    ws.documents = ws.documents.filter((d) => d.trip_id !== removed.id);
    ws.payroll_allocations = ws.payroll_allocations.filter((a) => a.trip_id !== removed.id);
    ws.gps_trip_summaries = ws.gps_trip_summaries.filter((s) => s.trip_id !== removed.id);
    addAuditLog(ws, req.authUser!, 'DELETE_TRIP', 'trips', removed.id, { reference: removed.reference });
    saveDb();
    res.json({ ok: true });
  });

  app.post('/api/trips/:id/respond', requireAuth, requireRoles('conducteur'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const user = req.authUser!;
    const trip = ws.trips.find((t) => t.id === req.params.id);
    if (!trip) {
      res.status(404).json({ error: 'Mission introuvable.' });
      return;
    }
    if (trip.driver_id !== user.driver_id) {
      res.status(403).json({ error: 'Cette mission ne vous est pas attribuée.' });
      return;
    }
    const { response, notes } = req.body as { response?: 'accepted' | 'refused'; notes?: string | null };
    if (response !== 'accepted' && response !== 'refused') {
      res.status(400).json({ error: 'Réponse invalide.' });
      return;
    }
    if (response === 'accepted') {
      const driverConflict = findTripAssignmentConflict(
        ws.trips.filter((t) => t.status === 'En cours' || t.driver_response === 'accepted'),
        {
          id: trip.id,
          vehicle_id: null,
          driver_id: trip.driver_id,
          departure_date: trip.departure_date,
          arrival_date: trip.arrival_date,
          status: trip.status,
        },
        { vehicles: ws.vehicles, drivers: ws.drivers },
      );
      if (driverConflict.hasConflict) {
        res.status(409).json({ error: driverConflict.message });
        return;
      }
    }
    trip.driver_response = response;
    if (notes !== undefined) trip.driver_notes = notes || null;
    addAuditLog(ws, user, 'RESPOND_TRIP', 'trips', trip.id, { reference: trip.reference, response });
    saveDb();
    res.json({ ...trip, revenue: 0 });
  });

  // ---------------- FILES / DOCUMENTS ----------------
  app.post(
    '/api/trips/:id/files',
    requireAuth,
    requireRoles('admin', 'logistique', 'conducteur'),
    (req: AuthedRequest, res) => {
      const ws = req.workspace!;
      const user = req.authUser!;
      const trip = ws.trips.find((t) => t.id === req.params.id);
      if (!trip) {
        res.status(404).json({ error: 'Mission introuvable.' });
        return;
      }
      if (user.role === 'conducteur' && trip.driver_id !== user.driver_id) {
        res.status(403).json({ error: 'Vous ne pouvez téléverser que sur vos missions.' });
        return;
      }
      const { file_name, mime_type, data_base64, media_kind, document_name } = req.body as {
        file_name?: string;
        mime_type?: string;
        data_base64?: string;
        media_kind?: 'document' | 'photo' | 'signature';
        document_name?: string;
      };
      const resolvedMime = inferAllowedMimeType(mime_type, file_name || document_name);
      if (!resolvedMime) {
        res.status(400).json({ error: 'Format refusé. Formats acceptés : PDF, JPEG, PNG, WebP.' });
        return;
      }
      if (!data_base64) {
        res.status(400).json({ error: 'Contenu de fichier manquant.' });
        return;
      }
      const cleanB64 = data_base64.includes(',') ? data_base64.split(',')[1] : data_base64;
      const buf = Buffer.from(cleanB64, 'base64');
      if (buf.length > 25 * 1024 * 1024) {
        res.status(400).json({ error: 'Fichier trop volumineux : limite 25 Mo.' });
        return;
      }
      const kind: 'document' | 'photo' | 'signature' =
        media_kind === 'signature' || media_kind === 'photo' ? media_kind : 'document';
      const safeName = String(file_name || document_name || 'fichier')
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9._-]/g, '_');
      const dir = getUploadDir(ws.id, trip.id);
      const diskFilename = `${Date.now()}_${safeName}`;
      fs.writeFileSync(path.join(dir, diskFilename), buf);
      const relPath = `${ws.id}/${trip.id}/${diskFilename}`;

      const doc: DocumentItem = {
        id: newId('doc'),
        trip_id: trip.id,
        driver_id: user.driver_id || null,
        document_type: kind === 'signature' ? 'Signature' : kind === 'photo' ? 'Photo' : 'Document',
        document_name: document_name || file_name || diskFilename,
        media_kind: kind,
        file_path: relPath,
        file_data: buildFileDataUri(resolvedMime, buf),
        mime_type: resolvedMime,
        expiry_date: null,
        uploaded_by: user.id,
        created_at: new Date().toISOString(),
      };
      ws.documents.unshift(doc);
      addAuditLog(ws, user, 'UPLOAD_DOCUMENT', 'documents', doc.id, {
        trip_reference: trip.reference,
        media_kind: kind,
        document_name: doc.document_name,
      });
      saveDb();
      res.status(201).json(toPublicDocument(doc));
    },
  );

  app.put(
    '/api/documents/:id/replace',
    requireAuth,
    requireRoles('admin', 'logistique', 'conducteur'),
    (req: AuthedRequest, res) => {
      const ws = req.workspace!;
      const user = req.authUser!;
      const doc = ws.documents.find((d) => d.id === req.params.id);
      if (!doc) {
        res.status(404).json({ error: 'Document introuvable.' });
        return;
      }
      if (user.role === 'logistique' && doc.document_type === 'Justificatif dépense') {
        res.status(403).json({ error: 'Accès refusé aux justificatifs financiers.' });
        return;
      }
      if (user.role === 'conducteur') {
        if (doc.uploaded_by !== user.id) {
          res.status(403).json({ error: 'Vous ne pouvez remplacer que vos propres fichiers.' });
          return;
        }
        if (doc.document_type === 'Justificatif dépense') {
          const linkedExpense = ws.expenses.find((e) => e.document_id === doc.id);
          if (linkedExpense && (linkedExpense.approval_status || 'en_attente') !== 'en_attente') {
            res.status(400).json({
              error: 'Ce justificatif est lié à une dépense déjà traitée par la comptabilité et ne peut plus être modifié.',
            });
            return;
          }
        }
      }
      const { file_name, mime_type, data_base64 } = req.body as {
        file_name?: string;
        mime_type?: string;
        data_base64?: string;
      };
      const resolvedMime = inferAllowedMimeType(mime_type, file_name);
      if (!resolvedMime || !data_base64) {
        res.status(400).json({ error: 'Fichier ou format invalide. Formats acceptés : PDF, JPEG, PNG, WebP.' });
        return;
      }
      const cleanB64 = data_base64.includes(',') ? data_base64.split(',')[1] : data_base64;
      const buf = Buffer.from(cleanB64, 'base64');
      if (buf.length > 25 * 1024 * 1024) {
        res.status(400).json({ error: 'Fichier trop volumineux : limite 25 Mo.' });
        return;
      }

      const oldPath = doc.file_path;
      const safeName = String(file_name || 'fichier')
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9._-]/g, '_');
      const dir = getUploadDir(ws.id, doc.trip_id);
      const diskFilename = `${Date.now()}_${safeName}`;
      fs.writeFileSync(path.join(dir, diskFilename), buf);
      const relPath = `${ws.id}/${doc.trip_id}/${diskFilename}`;

      const kind = doc.media_kind === 'signature' ? 'signature' : resolvedMime === 'application/pdf' ? 'document' : 'photo';
      doc.file_path = relPath;
      doc.file_data = buildFileDataUri(resolvedMime, buf);
      doc.document_name = file_name || doc.document_name;
      doc.media_kind = kind;
      if (doc.document_type !== 'Justificatif dépense') {
        doc.document_type = kind === 'signature' ? 'Signature' : kind === 'photo' ? 'Photo' : 'Document';
      }
      doc.mime_type = resolvedMime;

      if (oldPath) {
        const absOld = resolveUploadPath(oldPath);
        if (fs.existsSync(absOld)) fs.unlinkSync(absOld);
      }
      saveDb();
      res.json(toPublicDocument(doc));
    },
  );

  app.get('/api/documents', requireAuth, (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const user = req.authUser!;
    if (user.role === 'conducteur') {
      const myTripIds = new Set(
        ws.trips
          .filter((t) => t.driver_id && t.driver_id === user.driver_id)
          .map((t) => t.id),
      );
      res.json(
        ws.documents
          .filter((d) => (d.trip_id && myTripIds.has(d.trip_id)) || d.uploaded_by === user.id)
          .map(toPublicDocument),
      );
      return;
    }
    if (user.role === 'logistique') {
      res.json(
        ws.documents
          .filter((d) => d.document_type !== 'Justificatif dépense')
          .map(toPublicDocument),
      );
      return;
    }
    res.json(ws.documents.map(toPublicDocument));
  });

  app.post('/api/documents', requireAuth, requireRoles('admin', 'logistique'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const { trip_id, document_type, document_name, expiry_date } = req.body;
    if (!trip_id || !String(document_name || '').trim()) {
      res.status(400).json({ error: 'Mission et nom du document obligatoires.' });
      return;
    }
    const kind =
      String(document_type).toLowerCase() === 'photo'
        ? 'photo'
        : String(document_type).toLowerCase() === 'signature'
          ? 'signature'
          : 'document';
    const doc = {
      id: newId('doc'),
      trip_id,
      driver_id: null,
      document_type: document_type || 'Document',
      document_name: String(document_name).trim(),
      media_kind: kind as 'document' | 'photo' | 'signature',
      file_path: null,
      mime_type: null,
      expiry_date: expiry_date || null,
      uploaded_by: req.authUser!.id,
      created_at: new Date().toISOString(),
    };
    ws.documents.unshift(doc);
    saveDb();
    res.status(201).json(doc);
  });

  app.put('/api/documents/:id', requireAuth, requireRoles('admin', 'logistique'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const doc = ws.documents.find((d) => d.id === req.params.id);
    if (!doc) {
      res.status(404).json({ error: 'Document introuvable.' });
      return;
    }
    const { trip_id, document_type, document_name, expiry_date } = req.body;
    if (trip_id !== undefined) doc.trip_id = trip_id;
    if (document_type !== undefined) {
      doc.document_type = document_type;
      doc.media_kind =
        String(document_type).toLowerCase() === 'photo'
          ? 'photo'
          : String(document_type).toLowerCase() === 'signature'
            ? 'signature'
            : 'document';
    }
    if (document_name !== undefined) doc.document_name = String(document_name).trim();
    if (expiry_date !== undefined) doc.expiry_date = expiry_date || null;
    saveDb();
    res.json(doc);
  });

  app.delete(
    '/api/documents/:id',
    requireAuth,
    requireRoles('admin', 'logistique', 'conducteur'),
    (req: AuthedRequest, res) => {
      const ws = req.workspace!;
      const user = req.authUser!;
      const idx = ws.documents.findIndex((d) => d.id === req.params.id);
      if (idx === -1) {
        res.status(404).json({ error: 'Document introuvable.' });
        return;
      }
      const doc = ws.documents[idx];
      if (user.role === 'logistique' && doc.document_type === 'Justificatif dépense') {
        res.status(403).json({ error: 'Accès refusé aux justificatifs financiers.' });
        return;
      }
      if (user.role === 'conducteur') {
        if (doc.uploaded_by !== user.id) {
          res.status(403).json({ error: 'Suppression non autorisée.' });
          return;
        }
        if (doc.document_type === 'Justificatif dépense') {
          const linkedExpense = ws.expenses.find((e) => e.document_id === doc.id);
          if (linkedExpense && (linkedExpense.approval_status || 'en_attente') !== 'en_attente') {
            res.status(400).json({
              error: 'Ce justificatif est lié à une dépense déjà traitée par la comptabilité et ne peut plus être supprimé.',
            });
            return;
          }
        }
      }
      ws.documents.splice(idx, 1);
      ws.expenses.forEach((e) => {
        if (e.document_id === doc.id) {
          e.document_id = null;
        }
      });
      if (doc.file_path) {
        const abs = resolveUploadPath(doc.file_path);
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      }
      saveDb();
      res.json({ ok: true });
    },
  );

  app.get('/api/files/:docId', requireAuth, (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const user = req.authUser!;
    const doc = ws.documents.find((d) => d.id === req.params.docId);
    if (!doc || (!doc.file_path && !doc.file_data)) {
      res.status(404).json({ error: 'Fichier introuvable.' });
      return;
    }
    if (user.role === 'conducteur') {
      const trip = doc.trip_id ? ws.trips.find((t) => t.id === doc.trip_id) : null;
      const allowed =
        doc.uploaded_by === user.id || (trip && trip.driver_id && trip.driver_id === user.driver_id);
      if (!allowed) {
        res.status(403).json({ error: 'Accès refusé à ce fichier.' });
        return;
      }
    }
    if (user.role === 'logistique' && doc.document_type === 'Justificatif dépense') {
      res.status(403).json({ error: 'Accès refusé aux justificatifs financiers.' });
      return;
    }
    if (doc.file_path) {
      const abs = resolveUploadPath(doc.file_path);
      if (fs.existsSync(abs)) {
        if (doc.mime_type) res.setHeader('Content-Type', doc.mime_type);
        res.sendFile(abs);
        return;
      }
    }
    if (doc.file_data) {
      const cleanB64 = doc.file_data.includes(',') ? doc.file_data.split(',')[1] : doc.file_data;
      const buf = Buffer.from(cleanB64, 'base64');
      if (doc.file_path) {
        try {
          const abs = resolveUploadPath(doc.file_path);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, buf);
        } catch {
          // Best-effort restore on disk
        }
      }
      if (doc.mime_type) res.setHeader('Content-Type', doc.mime_type);
      res.send(buf);
      return;
    }
    res.status(404).json({ error: 'Fichier manquant sur le disque.' });
  });

  // ---------------- EXPENSES & PROFITABILITY ----------------
  app.get('/api/expenses', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    res.json(req.workspace!.expenses);
  });

  app.get('/api/profitability', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const totals: Record<string, { revenue: number; expenses: number; payroll: number }> = {};
    const ensure = (c: string) => {
      if (!totals[c]) totals[c] = { revenue: 0, expenses: 0, payroll: 0 };
      return totals[c];
    };
    ws.trips.forEach((t) => {
      ensure(t.currency || 'MAD').revenue += Number(t.revenue || 0);
    });
    ws.expenses
      .filter((e) => e.approval_status !== 'refusee')
      .forEach((e) => {
        ensure(e.currency || 'MAD').expenses += Number(e.amount || 0);
      });
    ws.payroll.forEach((p) => {
      ensure(p.currency || 'MAD').payroll += Number(p.total_cost || 0);
    });

    const allocatedByPayroll = new Map<string, number>();
    ws.payroll_allocations.forEach((a) => {
      allocatedByPayroll.set(a.payroll_id, (allocatedByPayroll.get(a.payroll_id) || 0) + Number(a.amount || 0));
    });
    const unallocatedByCurrency: Record<string, number> = {};
    ws.payroll.forEach((p) => {
      const c = p.currency || 'MAD';
      unallocatedByCurrency[c] =
        (unallocatedByCurrency[c] || 0) + Math.max(0, Number(p.total_cost || 0) - (allocatedByPayroll.get(p.id) || 0));
    });

    const byTrip = ws.trips
      .map((t) => {
        const cur = t.currency || 'MAD';
        const directExp = ws.expenses
          .filter((e) => e.trip_id === t.id && e.approval_status !== 'refusee' && (e.currency || 'MAD') === cur)
          .reduce((acc, e) => acc + Number(e.amount || 0), 0);
        const allocPay = ws.payroll_allocations
          .filter((a) => a.trip_id === t.id)
          .reduce((acc, a) => acc + Number(a.amount || 0), 0);
        return {
          trip: t,
          currency: cur,
          revenue: Number(t.revenue || 0),
          expenses: directExp,
          payroll: allocPay,
          result: Number(t.revenue || 0) - directExp - allocPay,
        };
      })
      .filter((x) => x.revenue !== 0 || x.expenses !== 0 || x.payroll !== 0);

    res.json({
      totals,
      unallocatedByCurrency,
      byTrip,
      expenses: ws.expenses,
    });
  });

  app.post('/api/trips/:id/driver-expenses', requireAuth, requireRoles('conducteur'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const user = req.authUser!;
    const trip = ws.trips.find((t) => t.id === req.params.id);
    if (!trip) {
      res.status(404).json({ error: 'Mission introuvable.' });
      return;
    }
    if (trip.driver_id !== user.driver_id) {
      res.status(403).json({ error: 'Vous ne pouvez déclarer des dépenses que sur vos missions.' });
      return;
    }
    if (trip.driver_response === 'refused') {
      res.status(400).json({ error: 'Vous avez refusé cette mission ; vous ne pouvez pas y déclarer de dépenses.' });
      return;
    }
    const { expense_type, amount, currency, expense_date, description, receipt } = req.body as {
      expense_type?: string;
      amount?: number;
      currency?: Currency;
      expense_date?: string | null;
      description?: string | null;
      receipt?: {
        file_name?: string;
        mime_type?: string;
        data_base64?: string;
        media_kind?: 'document' | 'photo';
      } | null;
    };
    const amt = Number(amount);
    if (!String(expense_type || '').trim() || !Number.isFinite(amt) || amt <= 0) {
      res.status(400).json({ error: 'Nature de dépense et montant positif obligatoires.' });
      return;
    }

    let documentItem: DocumentItem | null = null;
    if (receipt && receipt.data_base64) {
      const resolvedMime = inferAllowedMimeType(receipt.mime_type, receipt.file_name);
      if (!resolvedMime) {
        res.status(400).json({ error: 'Format justificatif refusé. Formats acceptés : PDF, JPEG, PNG, WebP.' });
        return;
      }
      const cleanB64 = receipt.data_base64.includes(',') ? receipt.data_base64.split(',')[1] : receipt.data_base64;
      const buf = Buffer.from(cleanB64, 'base64');
      if (buf.length > 25 * 1024 * 1024) {
        res.status(400).json({ error: 'Justificatif trop volumineux : limite 25 Mo.' });
        return;
      }
      const kind: 'document' | 'photo' = resolvedMime === 'application/pdf' ? 'document' : 'photo';
      const safeName = String(receipt.file_name || 'justificatif')
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9._-]/g, '_');
      const dir = getUploadDir(ws.id, trip.id);
      const diskFilename = `${Date.now()}_${safeName}`;
      fs.writeFileSync(path.join(dir, diskFilename), buf);
      const relPath = `${ws.id}/${trip.id}/${diskFilename}`;
      documentItem = {
        id: newId('doc'),
        trip_id: trip.id,
        driver_id: user.driver_id || null,
        document_type: 'Justificatif dépense',
        document_name: `${String(expense_type).trim()} - ${receipt.file_name || diskFilename}`,
        media_kind: kind,
        file_path: relPath,
        file_data: buildFileDataUri(resolvedMime, buf),
        mime_type: resolvedMime,
        expiry_date: null,
        uploaded_by: user.id,
        created_at: new Date().toISOString(),
      };
      ws.documents.unshift(documentItem);
    }

    const item = {
      id: newId('exp'),
      trip_id: trip.id,
      expense_type: String(expense_type).trim(),
      amount: amt,
      currency: (currency === 'EUR' ? 'EUR' : 'MAD') as Currency,
      expense_date: expense_date || new Date().toISOString().slice(0, 10),
      description: description ? String(description).trim() : null,
      document_id: documentItem?.id || null,
      submitted_by_role: 'conducteur' as const,
      approval_status: 'en_attente' as const,
      reviewed_by: null,
      reviewed_at: null,
      created_by: user.id,
      created_at: new Date().toISOString(),
    };
    ws.expenses.unshift(item);
    addAuditLog(ws, user, 'DECLARE_DRIVER_EXPENSE', 'expenses', item.id, {
      trip_reference: trip.reference,
      expense_type: item.expense_type,
      amount: item.amount,
      currency: item.currency,
      has_receipt: Boolean(documentItem),
    });
    saveDb();
    res.status(201).json({ expense: item, document: documentItem ? toPublicDocument(documentItem) : null });
  });

  app.delete('/api/driver-expenses/:id', requireAuth, requireRoles('conducteur'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const user = req.authUser!;
    const idx = ws.expenses.findIndex((e) => e.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Dépense introuvable.' });
      return;
    }
    const exp = ws.expenses[idx];
    if (exp.created_by !== user.id) {
      res.status(403).json({ error: 'Suppression non autorisée.' });
      return;
    }
    if ((exp.approval_status || 'en_attente') !== 'en_attente') {
      res.status(400).json({ error: 'Une dépense déjà traitée par la comptabilité ne peut plus être supprimée.' });
      return;
    }
    ws.expenses.splice(idx, 1);
    if (exp.document_id) {
      const docIdx = ws.documents.findIndex((d) => d.id === exp.document_id);
      if (docIdx !== -1) {
        const [doc] = ws.documents.splice(docIdx, 1);
        if (doc.file_path) {
          const abs = resolveUploadPath(doc.file_path);
          if (fs.existsSync(abs)) fs.unlinkSync(abs);
        }
      }
    }
    addAuditLog(ws, user, 'DELETE_DRIVER_EXPENSE', 'expenses', exp.id, {
      expense_type: exp.expense_type,
      amount: exp.amount,
      currency: exp.currency,
    });
    saveDb();
    res.json({ ok: true });
  });

  app.post('/api/expenses/:id/review', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const item = ws.expenses.find((e) => e.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Dépense introuvable.' });
      return;
    }
    const { decision } = req.body as { decision?: 'validee' | 'refusee' };
    if (decision !== 'validee' && decision !== 'refusee') {
      res.status(400).json({ error: 'Décision invalide.' });
      return;
    }
    item.approval_status = decision;
    item.reviewed_by = req.authUser!.id;
    item.reviewed_at = new Date().toISOString();
    addAuditLog(ws, req.authUser!, 'REVIEW_DRIVER_EXPENSE', 'expenses', item.id, {
      decision,
      amount: item.amount,
      currency: item.currency,
    });
    saveDb();
    res.json(item);
  });

  app.post('/api/expenses', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const { trip_id, expense_type, amount, currency, expense_date, description } = req.body;
    if (!trip_id || !String(expense_type || '').trim() || !Number.isFinite(Number(amount))) {
      res.status(400).json({ error: 'Mission, type et montant obligatoires.' });
      return;
    }
    const item = {
      id: newId('exp'),
      trip_id,
      expense_type: String(expense_type).trim(),
      amount: Number(amount),
      currency: (currency === 'EUR' ? 'EUR' : 'MAD') as Currency,
      expense_date: expense_date || null,
      description: description ? String(description).trim() : null,
      document_id: null,
      submitted_by_role: req.authUser!.role,
      approval_status: 'validee' as const,
      reviewed_by: req.authUser!.id,
      reviewed_at: new Date().toISOString(),
      created_by: req.authUser!.id,
      created_at: new Date().toISOString(),
    };
    ws.expenses.unshift(item);
    saveDb();
    res.status(201).json(item);
  });

  app.put('/api/expenses/:id', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const item = ws.expenses.find((e) => e.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Dépense introuvable.' });
      return;
    }
    const { trip_id, expense_type, amount, currency, expense_date, description } = req.body;
    if (trip_id !== undefined) {
      if (!ws.trips.some((t) => t.id === trip_id)) {
        res.status(400).json({ error: 'Mission introuvable pour cette dépense.' });
        return;
      }
      item.trip_id = trip_id;
    }
    if (expense_type !== undefined) {
      const nextType = String(expense_type).trim();
      if (!nextType) {
        res.status(400).json({ error: 'Le type de dépense est obligatoire.' });
        return;
      }
      item.expense_type = nextType;
    }
    if (amount !== undefined) {
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        res.status(400).json({ error: 'Le montant doit être strictement positif.' });
        return;
      }
      item.amount = amt;
    }
    if (currency !== undefined) item.currency = currency === 'EUR' ? 'EUR' : 'MAD';
    if (expense_date !== undefined) item.expense_date = expense_date || null;
    if (description !== undefined) item.description = description ? String(description).trim() : null;
    saveDb();
    res.json(item);
  });

  app.delete('/api/expenses/:id', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const idx = ws.expenses.findIndex((e) => e.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Dépense introuvable.' });
      return;
    }
    const [removed] = ws.expenses.splice(idx, 1);
    if (removed.document_id) {
      const docIdx = ws.documents.findIndex((d) => d.id === removed.document_id);
      if (docIdx !== -1) {
        const [doc] = ws.documents.splice(docIdx, 1);
        if (doc.file_path) {
          const abs = resolveUploadPath(doc.file_path);
          if (fs.existsSync(abs)) fs.unlinkSync(abs);
        }
      }
    }
    saveDb();
    res.json({ ok: true });
  });

  // ---------------- MAINTENANCE ----------------
  app.get('/api/maintenance', requireAuth, requireRoles('admin', 'logistique', 'comptable'), (req: AuthedRequest, res) => {
    res.json(req.workspace!.maintenance);
  });

  app.post('/api/maintenance', requireAuth, requireRoles('admin', 'logistique'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const { vehicle_id, maintenance_type, description, maintenance_date, cost, currency, next_maintenance_date } =
      req.body;
    if (!String(maintenance_type || '').trim()) {
      res.status(400).json({ error: 'Type d’entretien obligatoire.' });
      return;
    }
    const item = {
      id: newId('mnt'),
      vehicle_id: vehicle_id || null,
      maintenance_type: String(maintenance_type).trim(),
      description: description ? String(description).trim() : null,
      maintenance_date: maintenance_date || null,
      cost: cost !== undefined && cost !== null && cost !== '' ? Number(cost) : null,
      currency: (currency === 'EUR' ? 'EUR' : 'MAD') as Currency,
      next_maintenance_date: next_maintenance_date || null,
      created_at: new Date().toISOString(),
    };
    ws.maintenance.unshift(item);
    saveDb();
    res.status(201).json(item);
  });

  app.put('/api/maintenance/:id', requireAuth, requireRoles('admin', 'logistique'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const item = ws.maintenance.find((m) => m.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Maintenance introuvable.' });
      return;
    }
    const { vehicle_id, maintenance_type, description, maintenance_date, cost, currency, next_maintenance_date } =
      req.body;
    if (vehicle_id !== undefined) item.vehicle_id = vehicle_id || null;
    if (maintenance_type !== undefined) item.maintenance_type = String(maintenance_type).trim();
    if (description !== undefined) item.description = description ? String(description).trim() : null;
    if (maintenance_date !== undefined) item.maintenance_date = maintenance_date || null;
    if (cost !== undefined) item.cost = cost !== null && cost !== '' ? Number(cost) : null;
    if (currency !== undefined) item.currency = currency === 'EUR' ? 'EUR' : 'MAD';
    if (next_maintenance_date !== undefined) item.next_maintenance_date = next_maintenance_date || null;
    saveDb();
    res.json(item);
  });

  app.delete('/api/maintenance/:id', requireAuth, requireRoles('admin', 'logistique'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const idx = ws.maintenance.findIndex((m) => m.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Maintenance introuvable.' });
      return;
    }
    ws.maintenance.splice(idx, 1);
    saveDb();
    res.json({ ok: true });
  });

  // ---------------- EMPLOYEES & PAYROLL ----------------
  app.get('/api/employees', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    res.json(req.workspace!.employees);
  });

  app.post('/api/employees', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const b = req.body;
    if (!String(b.full_name || '').trim()) {
      res.status(400).json({ error: 'Le nom du salarié est obligatoire.' });
      return;
    }
    const item = {
      id: newId('emp'),
      full_name: String(b.full_name).trim(),
      job_title: b.job_title ? String(b.job_title).trim() : null,
      phone: b.phone ? String(b.phone).trim() : null,
      email: b.email ? String(b.email).trim() : null,
      hire_date: b.hire_date || null,
      end_date: b.end_date || null,
      status: b.status || 'actif',
      driver_id: b.driver_id || null,
      notes: b.notes ? String(b.notes).trim() : null,
      created_by: req.authUser!.id,
      created_at: new Date().toISOString(),
    };
    ws.employees.unshift(item);
    saveDb();
    res.status(201).json(item);
  });

  app.put('/api/employees/:id', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const item = ws.employees.find((e) => e.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Salarié introuvable.' });
      return;
    }
    const b = req.body;
    if (b.full_name !== undefined) item.full_name = String(b.full_name).trim();
    if (b.job_title !== undefined) item.job_title = b.job_title ? String(b.job_title).trim() : null;
    if (b.phone !== undefined) item.phone = b.phone ? String(b.phone).trim() : null;
    if (b.email !== undefined) item.email = b.email ? String(b.email).trim() : null;
    if (b.hire_date !== undefined) item.hire_date = b.hire_date || null;
    if (b.end_date !== undefined) item.end_date = b.end_date || null;
    if (b.status !== undefined) item.status = b.status;
    if (b.driver_id !== undefined) item.driver_id = b.driver_id || null;
    if (b.notes !== undefined) item.notes = b.notes ? String(b.notes).trim() : null;
    saveDb();
    res.json(item);
  });

  app.delete('/api/employees/:id', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    if (ws.payroll.some((p) => p.employee_id === req.params.id)) {
      res.status(400).json({ error: 'Suppression impossible : une paie est déjà liée à ce salarié.' });
      return;
    }
    const idx = ws.employees.findIndex((e) => e.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Salarié introuvable.' });
      return;
    }
    ws.employees.splice(idx, 1);
    saveDb();
    res.json({ ok: true });
  });

  app.get('/api/payroll', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    res.json({
      payroll: ws.payroll,
      employees: ws.employees,
      allocations: ws.payroll_allocations,
    });
  });

  app.post('/api/payroll', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const b = req.body;
    const salary = Number(b.salary_amount);
    const charges = Number(b.employer_charges || 0);
    if (!b.employee_id || !b.period_start || !b.period_end || !Number.isFinite(salary) || salary < 0 || charges < 0) {
      res.status(400).json({ error: 'Données de paie invalides.' });
      return;
    }
    if (b.period_end < b.period_start) {
      res.status(400).json({ error: 'La fin de période doit être postérieure ou égale au début.' });
      return;
    }
    const item = {
      id: newId('pay'),
      employee_id: b.employee_id,
      period_start: b.period_start,
      period_end: b.period_end,
      salary_amount: salary,
      employer_charges: charges,
      total_cost: Number((salary + charges).toFixed(2)),
      currency: (b.currency === 'EUR' ? 'EUR' : 'MAD') as Currency,
      payment_status: b.payment_status || 'a_payer',
      payment_date: b.payment_date || null,
      notes: b.notes ? String(b.notes).trim() : null,
      created_by: req.authUser!.id,
      created_at: new Date().toISOString(),
    };
    ws.payroll.unshift(item);
    saveDb();
    res.status(201).json(item);
  });

  app.put('/api/payroll/:id', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const item = ws.payroll.find((p) => p.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Paie introuvable.' });
      return;
    }
    const b = req.body;
    const salary = b.salary_amount !== undefined ? Number(b.salary_amount) : item.salary_amount;
    const charges = b.employer_charges !== undefined ? Number(b.employer_charges) : item.employer_charges;
    if (!Number.isFinite(salary) || salary < 0 || !Number.isFinite(charges) || charges < 0) {
      res.status(400).json({ error: 'Les montants doivent être positifs ou nuls.' });
      return;
    }
    const total = Number((salary + charges).toFixed(2));
    const allocated = ws.payroll_allocations
      .filter((a) => a.payroll_id === item.id)
      .reduce((acc, a) => acc + Number(a.amount || 0), 0);
    if (total < allocated - 0.001) {
      res.status(400).json({ error: 'Le coût total ne peut pas être inférieur au montant déjà affecté aux missions.' });
      return;
    }
    if (b.employee_id !== undefined) item.employee_id = b.employee_id;
    if (b.period_start !== undefined) item.period_start = b.period_start;
    if (b.period_end !== undefined) item.period_end = b.period_end;
    item.salary_amount = salary;
    item.employer_charges = charges;
    item.total_cost = total;
    if (b.currency !== undefined) item.currency = b.currency === 'EUR' ? 'EUR' : 'MAD';
    if (b.payment_status !== undefined) item.payment_status = b.payment_status;
    if (b.payment_date !== undefined) item.payment_date = b.payment_date || null;
    if (b.notes !== undefined) item.notes = b.notes ? String(b.notes).trim() : null;
    saveDb();
    res.json(item);
  });

  app.delete('/api/payroll/:id', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const idx = ws.payroll.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Paie introuvable.' });
      return;
    }
    ws.payroll.splice(idx, 1);
    ws.payroll_allocations = ws.payroll_allocations.filter((a) => a.payroll_id !== req.params.id);
    saveDb();
    res.json({ ok: true });
  });

  app.post('/api/payroll-allocations', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const { payroll_id, trip_id, amount, notes } = req.body;
    const pay = ws.payroll.find((p) => p.id === payroll_id);
    const trip = ws.trips.find((t) => t.id === trip_id);
    const num = Number(amount);
    if (!pay || !trip || !Number.isFinite(num) || num <= 0) {
      res.status(400).json({ error: 'Paie, mission et montant positif obligatoires.' });
      return;
    }
    if ((trip.currency || 'MAD') !== (pay.currency || 'MAD')) {
      res.status(400).json({ error: 'La mission et la paie doivent avoir la même devise.' });
      return;
    }
    const already = ws.payroll_allocations
      .filter((a) => a.payroll_id === payroll_id)
      .reduce((acc, a) => acc + Number(a.amount || 0), 0);
    if (already + num > pay.total_cost + 0.001) {
      res.status(400).json({ error: 'Le montant dépasse le solde disponible de cette paie.' });
      return;
    }
    const alloc = {
      id: newId('pal'),
      payroll_id,
      trip_id,
      amount: Number(num.toFixed(2)),
      notes: notes ? String(notes).trim() : null,
      created_by: req.authUser!.id,
      created_at: new Date().toISOString(),
    };
    ws.payroll_allocations.push(alloc);
    saveDb();
    res.status(201).json(alloc);
  });

  app.put('/api/payroll-allocations/:id', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const alloc = ws.payroll_allocations.find((a) => a.id === req.params.id);
    if (!alloc) {
      res.status(404).json({ error: 'Affectation introuvable.' });
      return;
    }
    const pay = ws.payroll.find((p) => p.id === alloc.payroll_id);
    if (!pay) {
      res.status(404).json({ error: 'Paie introuvable.' });
      return;
    }
    const { trip_id, amount, notes } = req.body;
    const trip = ws.trips.find((t) => t.id === trip_id);
    const num = Number(amount);
    if (!trip || !Number.isFinite(num) || num <= 0) {
      res.status(400).json({ error: 'Mission et montant positif requis.' });
      return;
    }
    if ((trip.currency || 'MAD') !== (pay.currency || 'MAD')) {
      res.status(400).json({ error: 'La mission et la paie doivent avoir la même devise.' });
      return;
    }
    const otherAlloc = ws.payroll_allocations
      .filter((a) => a.payroll_id === pay.id && a.id !== alloc.id)
      .reduce((acc, a) => acc + Number(a.amount || 0), 0);
    if (otherAlloc + num > pay.total_cost + 0.001) {
      res.status(400).json({ error: 'Le montant dépasse le solde disponible de cette paie.' });
      return;
    }
    alloc.trip_id = trip_id;
    alloc.amount = Number(num.toFixed(2));
    alloc.notes = notes ? String(notes).trim() : null;
    saveDb();
    res.json(alloc);
  });

  app.delete('/api/payroll-allocations/:id', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const idx = ws.payroll_allocations.findIndex((a) => a.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Affectation introuvable.' });
      return;
    }
    ws.payroll_allocations.splice(idx, 1);
    saveDb();
    res.json({ ok: true });
  });

  // ---------------- CLIENT PROPOSALS ----------------
  app.get('/api/client-proposals', requireAuth, requireRoles('admin', 'conducteur'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const user = req.authUser!;
    if (user.role === 'conducteur') {
      res.json(ws.client_proposals.filter((p) => p.driver_id === user.driver_id));
      return;
    }
    res.json(ws.client_proposals);
  });

  app.post('/api/client-proposals', requireAuth, requireRoles('conducteur'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const user = req.authUser!;
    if (!user.driver_id) {
      res.status(400).json({ error: 'Aucun conducteur associé à votre compte.' });
      return;
    }
    const { company_name, contact_name, phone, email, address, ice } = req.body;
    if (!company_name?.trim() || !phone?.trim() || !email?.trim() || !address?.trim() || !ice?.trim()) {
      res.status(400).json({ error: 'Raison sociale, téléphone, e-mail, adresse et ICE sont obligatoires.' });
      return;
    }
    const prop = {
      id: newId('prp'),
      driver_id: user.driver_id,
      company_name: String(company_name).trim(),
      contact_name: contact_name ? String(contact_name).trim() : null,
      phone: String(phone).trim(),
      email: String(email).trim(),
      address: String(address).trim(),
      ice: String(ice).trim(),
      status: 'en_attente' as const,
      admin_notes: null,
      reviewed_by: null,
      reviewed_at: null,
      created_at: new Date().toISOString(),
    };
    ws.client_proposals.unshift(prop);
    saveDb();
    res.status(201).json(prop);
  });

  app.post('/api/client-proposals/:id/review', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const prop = ws.client_proposals.find((p) => p.id === req.params.id);
    if (!prop) {
      res.status(404).json({ error: 'Proposition introuvable.' });
      return;
    }
    if (prop.status !== 'en_attente') {
      res.status(400).json({ error: 'Cette proposition a déjà été traitée.' });
      return;
    }
    const { decision, admin_notes } = req.body as { decision?: 'approuvee' | 'refusee'; admin_notes?: string | null };
    if (decision !== 'approuvee' && decision !== 'refusee') {
      res.status(400).json({ error: 'Décision invalide.' });
      return;
    }
    prop.status = decision;
    prop.admin_notes = admin_notes ? String(admin_notes).trim() : null;
    prop.reviewed_by = req.authUser!.id;
    prop.reviewed_at = new Date().toISOString();

    if (decision === 'approuvee') {
      const client = {
        id: newId('cli'),
        company_name: prop.company_name,
        contact_name: prop.contact_name,
        phone: prop.phone,
        email: prop.email,
        address: prop.address,
        ice: prop.ice,
        client_type: 'Proposé par conducteur',
        active: true,
        created_at: new Date().toISOString(),
      };
      ws.clients.unshift(client);
      addAuditLog(ws, req.authUser!, 'APPROVE_CLIENT_PROPOSAL', 'clients', client.id, {
        company_name: client.company_name,
        ice: client.ice,
      });
    } else {
      addAuditLog(ws, req.authUser!, 'REFUSE_CLIENT_PROPOSAL', 'client_proposals', prop.id, {
        company_name: prop.company_name,
      });
    }
    saveDb();
    res.json(prop);
  });

  // ---------------- USERS & AUDIT & SETTINGS & CITIES ----------------
  app.get('/api/users', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    res.json(ws.users.map((u) => toPublicProfile(u, ws)));
  });

  app.post('/api/users', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const { email, password, full_name, role, driver_id, active } = req.body;
    if (!email?.trim() || !password || !full_name?.trim()) {
      res.status(400).json({ error: 'Nom, e-mail et mot de passe obligatoires.' });
      return;
    }
    try {
      const user = addUserToWorkspace(ws, {
        email,
        password,
        full_name,
        role: role || 'logistique',
        driver_id: driver_id || null,
        active: active !== false,
      });
      addAuditLog(ws, req.authUser!, 'CREATE_USER', 'profiles', user.id, { email: user.email, role: user.role });
      saveDb();
      res.status(201).json(toPublicProfile(user, ws));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Erreur création utilisateur.' });
    }
  });

  app.put('/api/users/:id', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const user = ws.users.find((u) => u.id === req.params.id);
    if (!user) {
      res.status(404).json({ error: 'Utilisateur introuvable.' });
      return;
    }
    const { full_name, role, driver_id, active, password } = req.body;
    if (full_name !== undefined) user.full_name = String(full_name).trim();
    if (role !== undefined) user.role = role;
    if (driver_id !== undefined) user.driver_id = driver_id || null;
    if (user.role === 'conducteur') {
      ensureDriverLinkForUser(ws, user);
    }
    if (active !== undefined) user.active = Boolean(active);
    if (password && String(password).length >= 4) user.password_hash = hashPassword(String(password));
    addAuditLog(ws, req.authUser!, 'UPDATE_USER', 'profiles', user.id, { role: user.role, active: user.active });
    saveDb();
    res.json(toPublicProfile(user, ws));
  });

  app.get('/api/audit-logs', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    res.json(req.workspace!.audit_logs);
  });

  app.get('/api/company-settings', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    res.json(req.workspace!.company_settings);
  });

  app.put('/api/company-settings', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const b = req.body;
    if (!String(b.company_name || '').trim()) {
      res.status(400).json({ error: 'Raison sociale obligatoire.' });
      return;
    }
    const rawSigUrl = String(b.stamp_signature_url || '').trim();
    const safeSigUrl =
      rawSigUrl && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(rawSigUrl) && rawSigUrl.length <= 700000
        ? rawSigUrl
        : '';
    const rawStampColor = String(b.stamp_color || '').trim();
    const safeStampColor = /^#[0-9a-fA-F]{6}$/.test(rawStampColor) ? rawStampColor : '#17365d';
    const rawStampStyle = b.stamp_style === 'round' ? 'round' : 'rectangular';

    ws.company_settings = {
      id: 1,
      company_name: String(b.company_name || '').trim(),
      activity: String(b.activity || ''),
      phone: String(b.phone || ''),
      email: String(b.email || ''),
      address: String(b.address || ''),
      city: String(b.city || ''),
      ice: String(b.ice || ''),
      tax_id: String(b.tax_id || ''),
      rc: String(b.rc || ''),
      tp: String(b.tp || ''),
      bank: String(b.bank || ''),
      rib: String(b.rib || ''),
      logo_url: String(b.logo_url || ''),
      payment_terms: String(b.payment_terms || ''),
      stamp_enabled: b.stamp_enabled !== false,
      stamp_style: rawStampStyle,
      stamp_color: safeStampColor,
      stamp_signatory_name: String(b.stamp_signatory_name || '').trim().slice(0, 120),
      stamp_signatory_title: String(b.stamp_signatory_title || '').trim().slice(0, 120),
      stamp_signature_url: safeSigUrl,
      updated_at: new Date().toISOString(),
    };
    addAuditLog(ws, req.authUser!, 'UPDATE_COMPANY', 'company_settings', '1', {
      company_name: ws.company_settings.company_name,
    });
    saveDb();
    res.json(ws.company_settings);
  });

  app.get('/api/countries', requireAuth, (req: AuthedRequest, res) => {
    res.json(req.workspace!.countries);
  });

  app.post('/api/countries', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const { name, iso_code } = req.body;
    if (!String(name || '').trim()) {
      res.status(400).json({ error: 'Nom du pays obligatoire.' });
      return;
    }
    const item = {
      id: newId('cnt'),
      name: String(name).trim(),
      iso_code: iso_code ? String(iso_code).trim().toUpperCase().slice(0, 2) : null,
      is_active: true,
    };
    ws.countries.push(item);
    saveDb();
    res.status(201).json(item);
  });

  app.put('/api/countries/:id', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const item = ws.countries.find((c) => c.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Pays introuvable.' });
      return;
    }
    const { name, iso_code, is_active } = req.body;
    if (name !== undefined) item.name = String(name).trim();
    if (iso_code !== undefined) item.iso_code = iso_code ? String(iso_code).trim().toUpperCase().slice(0, 2) : null;
    if (is_active !== undefined) item.is_active = Boolean(is_active);
    saveDb();
    res.json(item);
  });

  app.get('/api/cities', requireAuth, (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const countryMap = new Map(ws.countries.map((c) => [c.id, c]));
    res.json(
      ws.cities.map((c) => ({
        ...c,
        country_name: countryMap.get(c.country_id)?.name || '',
        country_iso: countryMap.get(c.country_id)?.iso_code || null,
      })),
    );
  });

  app.post('/api/cities', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const { name, country_id } = req.body;
    if (!String(name || '').trim() || !country_id) {
      res.status(400).json({ error: 'Nom de ville et pays obligatoires.' });
      return;
    }
    const item = {
      id: newId('cty'),
      name: String(name).trim(),
      country_id,
      is_active: true,
    };
    ws.cities.push(item);
    saveDb();
    res.status(201).json(item);
  });

  app.put('/api/cities/:id', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const item = ws.cities.find((c) => c.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Ville introuvable.' });
      return;
    }
    const { name, country_id, is_active } = req.body;
    if (name !== undefined) item.name = String(name).trim();
    if (country_id !== undefined) item.country_id = country_id;
    if (is_active !== undefined) item.is_active = Boolean(is_active);
    saveDb();
    res.json(item);
  });

  // ---------------- INVOICING ----------------
  function isValidEmailAddress(value: string): boolean {
    return /^[^\s@<>(),;:"\\/\[\]]+@[^\s@<>(),;:"\\/\[\]]+\.[^\s@<>(),;:"\\/\[\]]+$/.test(value);
  }

  function hasHeaderInjection(value: string): boolean {
    return /[\r\n]/.test(value);
  }

  function escapeHtmlText(value: string | number | null | undefined): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getSmtpConfig() {
    const host = (process.env.SMTP_HOST || '').trim();
    const user = (process.env.SMTP_USER || '').trim();
    const pass = process.env.SMTP_PASS || '';
    const port = Number(process.env.SMTP_PORT || '587');
    const secure =
      String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
    const from = (process.env.SMTP_FROM || user || '').trim();
    const configured = Boolean(host && user && pass && Number.isFinite(port) && port > 0);
    return { configured, host, port, secure, user, pass, from };
  }

  function buildInvoiceEmailHtml(
    inv: Invoice,
    company: CompanySettings,
    payments: InvoicePayment[],
    customMessage: string,
  ): string {
    const paid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const remaining = Math.max(0, Number(inv.total_ttc || 0) - paid);
    const fmt = (n: number) => `${Number(n || 0).toFixed(2)} ${escapeHtmlText(inv.currency || 'MAD')}`;
    const msgHtml = escapeHtmlText(customMessage).replace(/\n/g, '<br/>');
    return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>Facture ${escapeHtmlText(inv.invoice_number)}</title></head>
<body style="margin:0;padding:24px;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;color:#1e293b;">
  <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
    <div style="background:#17365d;color:#ffffff;padding:20px 24px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-size:18px;font-weight:700;">${escapeHtmlText(company.company_name || 'Fret Manager')}</div>
        <div style="font-size:12px;opacity:0.85;margin-top:4px;">${escapeHtmlText(company.activity || '')}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:12px;text-transform:uppercase;opacity:0.8;">Facture</div>
        <div style="font-size:18px;font-weight:700;font-family:monospace;">${escapeHtmlText(inv.invoice_number)}</div>
      </div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:14px;line-height:1.6;margin:0 0 20px 0;">${msgHtml}</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px;">
        <tr>
          <td style="padding:10px;background:#f8fafc;border:1px solid #e2e8f0;width:50%;vertical-align:top;">
            <strong style="color:#17365d;">Client</strong><br/>
            ${escapeHtmlText(inv.client_name)}<br/>
            ICE : ${escapeHtmlText(inv.client_ice)}<br/>
            ${escapeHtmlText(inv.client_address)}
          </td>
          <td style="padding:10px;background:#f8fafc;border:1px solid #e2e8f0;width:50%;vertical-align:top;">
            <strong style="color:#17365d;">Détails</strong><br/>
            Mission : ${escapeHtmlText(inv.mission_reference)}<br/>
            Date d'émission : ${escapeHtmlText(inv.issue_date)}<br/>
            Échéance : ${escapeHtmlText(inv.due_date || '—')}
          </td>
        </tr>
      </table>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px;">
        <thead>
          <tr style="background:#17365d;color:#ffffff;">
            <th style="padding:9px 10px;text-align:left;">Prestation</th>
            <th style="padding:9px 10px;text-align:left;">Base</th>
            <th style="padding:9px 10px;text-align:right;">Montant HT</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:10px;border:1px solid #e2e8f0;">${escapeHtmlText(inv.service_description)}</td>
            <td style="padding:10px;border:1px solid #e2e8f0;">${escapeHtmlText(inv.amount_basis)}</td>
            <td style="padding:10px;border:1px solid #e2e8f0;text-align:right;font-family:monospace;">${fmt(inv.subtotal_ht)}</td>
          </tr>
        </tbody>
      </table>
      <table style="width:280px;margin-left:auto;border-collapse:collapse;font-size:13px;margin-bottom:18px;">
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">Total HT</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-family:monospace;">${fmt(inv.subtotal_ht)}</td>
        </tr>
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">TVA (${escapeHtmlText(inv.tax_rate)} %)</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-family:monospace;">${fmt(inv.tax_amount)}</td>
        </tr>
        <tr style="background:#17365d;color:#ffffff;font-weight:700;">
          <td style="padding:8px 10px;">TOTAL TTC</td>
          <td style="padding:8px 10px;text-align:right;font-family:monospace;">${fmt(inv.total_ttc)}</td>
        </tr>
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">Déjà réglé</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-family:monospace;">${fmt(paid)}</td>
        </tr>
        <tr style="font-weight:700;color:#17365d;">
          <td style="padding:6px 10px;">Reste à payer</td>
          <td style="padding:6px 10px;text-align:right;font-family:monospace;">${fmt(remaining)}</td>
        </tr>
      </table>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px;font-size:12px;color:#475569;">
        <strong style="color:#17365d;">Coordonnées bancaires :</strong>
        Banque : ${escapeHtmlText(company.bank || '—')} · RIB / IBAN : ${escapeHtmlText(company.rib || '—')}<br/>
        Conditions : ${escapeHtmlText(company.payment_terms || '—')}<br/>
        ${company.ice ? `ICE : ${escapeHtmlText(company.ice)} · ` : ''}${company.phone ? `Tél : ${escapeHtmlText(company.phone)} · ` : ''}${company.email ? `E-mail : ${escapeHtmlText(company.email)}` : ''}
      </div>
      ${
        company.stamp_enabled !== false
          ? (() => {
              const ink = company.stamp_color && /^#[0-9a-fA-F]{6}$/.test(company.stamp_color) ? company.stamp_color : '#17365d';
              const legal = [
                company.ice ? `ICE: ${escapeHtmlText(company.ice)}` : '',
                company.tax_id ? `IF: ${escapeHtmlText(company.tax_id)}` : '',
                company.rc ? `RC: ${escapeHtmlText(company.rc)}` : '',
                company.tp ? `TP: ${escapeHtmlText(company.tp)}` : '',
              ]
                .filter(Boolean)
                .join(' · ');
              const addr = [company.address, company.city].filter(Boolean).map(escapeHtmlText).join(' · ');
              const sigImg =
                company.stamp_signature_url && /^data:image\/(png|jpeg|webp);base64,/.test(company.stamp_signature_url)
                  ? `<div style="margin-top:6px;"><img src="${company.stamp_signature_url}" alt="Signature" style="max-width:150px;max-height:60px;object-fit:contain;" /></div>`
                  : '';
              const sigName = company.stamp_signatory_name
                ? `<div style="font-size:11px;font-weight:700;color:${ink};margin-top:4px;">${escapeHtmlText(company.stamp_signatory_name)}</div>`
                : '';
              const sigTitle = company.stamp_signatory_title
                ? `<div style="font-size:10px;color:${ink};opacity:0.8;">${escapeHtmlText(company.stamp_signatory_title)}</div>`
                : '';
              return `<div style="margin-top:20px;text-align:right;">
                <div style="display:inline-block;border:2px solid ${ink};border-radius:${company.stamp_style === 'round' ? '999px' : '6px'};padding:10px 16px;text-align:center;color:${ink};background:#ffffff;">
                  <div style="font-size:12px;font-weight:800;text-transform:uppercase;">${escapeHtmlText(company.company_name || 'Fret Manager')}</div>
                  ${company.activity ? `<div style="font-size:9px;font-weight:600;margin-top:2px;">${escapeHtmlText(company.activity)}</div>` : ''}
                  ${addr ? `<div style="font-size:9px;margin-top:3px;">${addr}</div>` : ''}
                  ${legal ? `<div style="font-size:9px;font-family:monospace;font-weight:700;margin-top:5px;padding-top:4px;border-top:1px dashed ${ink};">${legal}</div>` : ''}
                  ${sigImg}${sigName}${sigTitle}
                </div>
              </div>`;
            })()
          : ''
      }
    </div>
  </div>
</body>
</html>`;
  }

  app.get('/api/invoices/email-status', requireAuth, requireRoles('admin', 'comptable'), (_req: AuthedRequest, res) => {
    const smtp = getSmtpConfig();
    res.json({
      smtpConfigured: smtp.configured,
      fromAddress: smtp.configured ? smtp.from : null,
    });
  });

  app.get('/api/invoices', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    res.json({
      invoices: ws.invoices,
      payments: ws.invoice_payments,
    });
  });

  app.get('/api/invoices/:id', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const inv = ws.invoices.find((i) => i.id === req.params.id);
    if (!inv) {
      res.status(404).json({ error: 'Facture introuvable.' });
      return;
    }
    const payments = ws.invoice_payments.filter((p) => p.invoice_id === inv.id);
    res.json({ invoice: inv, payments });
  });

  app.post('/api/invoices', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const { trip_id, service_description, amount_basis, entered_amount, tax_rate, issue_date, due_date, notes } =
      req.body;
    const trip = ws.trips.find((t) => t.id === trip_id);
    if (!trip) {
      res.status(404).json({ error: 'Mission introuvable.' });
      return;
    }
    if (ws.invoices.some((i) => i.trip_id === trip.id)) {
      res.status(400).json({ error: 'Cette mission possède déjà une facture.' });
      return;
    }
    const basis = amount_basis === 'TTC' ? 'TTC' : amount_basis === 'HT' ? 'HT' : null;
    const amt = Number(entered_amount);
    const tax = Number(tax_rate);
    if (!basis || !String(service_description || '').trim() || !Number.isFinite(amt) || amt <= 0 || !Number.isFinite(tax) || tax < 0 || tax > 100 || !issue_date) {
      res.status(400).json({ error: 'Données de facturation invalides.' });
      return;
    }
    const client = ws.clients.find((c) => c.id === trip.client_id);
    const calc = computeInvoiceAmounts(basis, amt, tax);
    const inv: Invoice = {
      id: newId('inv'),
      trip_id: trip.id,
      invoice_number: formatInvoiceNumber(ws),
      mission_reference: trip.reference,
      client_id: client?.id || null,
      client_name: client?.company_name || 'Client non renseigné',
      client_ice: client?.ice || '—',
      client_address: client?.address || '—',
      client_email: client?.email || '—',
      service_description: String(service_description).trim(),
      amount_basis: basis,
      entered_amount: amt,
      tax_rate: tax,
      subtotal_ht: calc.subtotal_ht,
      tax_amount: calc.tax_amount,
      total_ttc: calc.total_ttc,
      currency: trip.currency || 'MAD',
      issue_date,
      due_date: due_date || null,
      status: 'draft',
      notes: notes ? String(notes).trim() : null,
      created_by: req.authUser!.id,
      created_at: new Date().toISOString(),
    };
    ws.invoices.unshift(inv);
    addAuditLog(ws, req.authUser!, 'CREATE_INVOICE', 'invoices', inv.id, {
      invoice_number: inv.invoice_number,
      total_ttc: inv.total_ttc,
    });
    saveDb();
    res.status(201).json(inv);
  });

  app.put('/api/invoices/:id', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const inv = ws.invoices.find((i) => i.id === req.params.id);
    if (!inv) {
      res.status(404).json({ error: 'Facture introuvable.' });
      return;
    }
    if (inv.status !== 'draft') {
      res.status(400).json({ error: 'Une facture validée est verrouillée.' });
      return;
    }
    const { service_description, amount_basis, entered_amount, tax_rate, issue_date, due_date, notes } = req.body;
    const basis = amount_basis === 'TTC' ? 'TTC' : 'HT';
    const amt = Number(entered_amount);
    const tax = Number(tax_rate);
    if (!String(service_description || '').trim() || !Number.isFinite(amt) || amt <= 0 || !Number.isFinite(tax) || tax < 0 || tax > 100 || !issue_date) {
      res.status(400).json({ error: 'Données de facturation invalides.' });
      return;
    }
    const calc = computeInvoiceAmounts(basis, amt, tax);
    inv.service_description = String(service_description).trim();
    inv.amount_basis = basis;
    inv.entered_amount = amt;
    inv.tax_rate = tax;
    inv.subtotal_ht = calc.subtotal_ht;
    inv.tax_amount = calc.tax_amount;
    inv.total_ttc = calc.total_ttc;
    inv.issue_date = issue_date;
    inv.due_date = due_date || null;
    inv.notes = notes ? String(notes).trim() : null;
    saveDb();
    res.json(inv);
  });

  app.post('/api/invoices/:id/validate', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const inv = ws.invoices.find((i) => i.id === req.params.id);
    if (!inv) {
      res.status(404).json({ error: 'Facture introuvable.' });
      return;
    }
    inv.status = 'validated';
    addAuditLog(ws, req.authUser!, 'VALIDATE_INVOICE', 'invoices', inv.id, {
      invoice_number: inv.invoice_number,
      total_ttc: inv.total_ttc,
    });
    saveDb();
    res.json(inv);
  });

  app.put('/api/invoices/:id/notes', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const inv = ws.invoices.find((i) => i.id === req.params.id);
    if (!inv) {
      res.status(404).json({ error: 'Facture introuvable.' });
      return;
    }
    inv.notes = req.body.notes ? String(req.body.notes).trim() : null;
    saveDb();
    res.json(inv);
  });

  app.post('/api/invoices/:id/send-email', requireAuth, requireRoles('admin', 'comptable'), async (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const inv = ws.invoices.find((i) => i.id === req.params.id);
    if (!inv) {
      res.status(404).json({ error: 'Facture introuvable.' });
      return;
    }
    const { to, cc, subject, message, mode } = (req.body || {}) as {
      to?: string;
      cc?: string;
      subject?: string;
      message?: string;
      mode?: 'smtp' | 'client_handoff';
    };

    const toEmail = String(to || (inv.client_email !== '—' ? inv.client_email : '') || '').trim();
    if (!toEmail || hasHeaderInjection(toEmail) || !isValidEmailAddress(toEmail)) {
      res.status(400).json({ error: 'Adresse e-mail destinataire invalide.' });
      return;
    }

    const ccList = String(cc || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const entry of ccList) {
      if (hasHeaderInjection(entry) || !isValidEmailAddress(entry)) {
        res.status(400).json({ error: `Adresse e-mail en copie (Cc) invalide : ${entry}` });
        return;
      }
    }

    const finalSubject = String(
      subject || `Facture ${inv.invoice_number} — ${inv.mission_reference}`,
    )
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 200);
    const finalMessage = String(message || '').trim().slice(0, 8000);

    if (mode === 'client_handoff') {
      inv.last_emailed_at = new Date().toISOString();
      inv.last_emailed_to = toEmail;
      inv.email_sent_count = Number(inv.email_sent_count || 0) + 1;
      addAuditLog(ws, req.authUser!, 'SEND_INVOICE_EMAIL', 'invoices', inv.id, {
        invoice_number: inv.invoice_number,
        to: toEmail,
        cc: ccList,
        mode: 'client_handoff',
      });
      saveDb();
      res.json({ ok: true, mode: 'client_handoff', invoice: inv });
      return;
    }

    const smtp = getSmtpConfig();
    if (!smtp.configured) {
      res.status(400).json({
        error: 'Serveur SMTP non configuré. Utilisez votre messagerie locale ou Gmail Web pour envoyer la facture.',
        code: 'SMTP_NOT_CONFIGURED',
      });
      return;
    }

    try {
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: {
          user: smtp.user,
          pass: smtp.pass,
        },
      });
      const invPayments = ws.invoice_payments.filter((p) => p.invoice_id === inv.id);
      const html = buildInvoiceEmailHtml(inv, ws.company_settings, invPayments, finalMessage);
      const safeFileRef = inv.invoice_number.replace(/[^a-zA-Z0-9._-]/g, '_');

      const info = await transporter.sendMail({
        from: ws.company_settings.company_name
          ? `"${ws.company_settings.company_name.replace(/"/g, '')}" <${smtp.from}>`
          : smtp.from,
        replyTo:
          ws.company_settings.email && isValidEmailAddress(ws.company_settings.email)
            ? ws.company_settings.email
            : undefined,
        to: toEmail,
        cc: ccList.length > 0 ? ccList.join(', ') : undefined,
        subject: finalSubject,
        text: finalMessage,
        html,
        attachments: [
          {
            filename: `Facture-${safeFileRef}.html`,
            content: html,
            contentType: 'text/html; charset=utf-8',
          },
        ],
      });

      inv.last_emailed_at = new Date().toISOString();
      inv.last_emailed_to = toEmail;
      inv.email_sent_count = Number(inv.email_sent_count || 0) + 1;
      addAuditLog(ws, req.authUser!, 'SEND_INVOICE_EMAIL', 'invoices', inv.id, {
        invoice_number: inv.invoice_number,
        to: toEmail,
        cc: ccList,
        mode: 'smtp',
        messageId: info.messageId,
      });
      saveDb();
      res.json({ ok: true, mode: 'smtp', messageId: info.messageId, invoice: inv });
    } catch (err) {
      console.error('Invoice SMTP send failed:', err);
      res.status(502).json({
        error: err instanceof Error ? `Échec de l’envoi SMTP : ${err.message}` : 'Échec de l’envoi SMTP.',
      });
    }
  });

  app.post('/api/invoices/:id/send-whatsapp', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const inv = ws.invoices.find((i) => i.id === req.params.id);
    if (!inv) {
      res.status(404).json({ error: 'Facture introuvable.' });
      return;
    }
    const { phone } = (req.body || {}) as { phone?: string };
    const cleanPhone = String(phone || '').trim().slice(0, 40);
    if (cleanPhone && !/^[+\d\s().-]{6,40}$/.test(cleanPhone)) {
      res.status(400).json({ error: 'Numéro WhatsApp invalide.' });
      return;
    }

    inv.last_whatsapp_at = new Date().toISOString();
    inv.last_whatsapp_to = cleanPhone || inv.client_name || 'WhatsApp';
    inv.whatsapp_sent_count = Number(inv.whatsapp_sent_count || 0) + 1;
    addAuditLog(ws, req.authUser!, 'SEND_INVOICE_WHATSAPP', 'invoices', inv.id, {
      invoice_number: inv.invoice_number,
      to: inv.last_whatsapp_to,
    });
    saveDb();
    res.json({ ok: true, invoice: inv });
  });

  app.delete('/api/invoices/:id', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    if (ws.invoice_payments.some((p) => p.invoice_id === req.params.id)) {
      res.status(400).json({ error: 'Suppression bloquée : cette facture possède déjà des règlements.' });
      return;
    }
    const idx = ws.invoices.findIndex((i) => i.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Facture introuvable.' });
      return;
    }
    const [removed] = ws.invoices.splice(idx, 1);
    addAuditLog(ws, req.authUser!, 'DELETE_INVOICE', 'invoices', removed.id, {
      invoice_number: removed.invoice_number,
    });
    saveDb();
    res.json({ ok: true });
  });

  app.post('/api/invoices/:id/payments', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const inv = ws.invoices.find((i) => i.id === req.params.id);
    if (!inv) {
      res.status(404).json({ error: 'Facture introuvable.' });
      return;
    }
    if (inv.status !== 'validated') {
      res.status(400).json({ error: 'La facture doit être validée avant d’enregistrer un règlement.' });
      return;
    }
    const { payment_date, amount, payment_method, reference, notes } = req.body;
    const amt = Number(amount);
    const paid = ws.invoice_payments
      .filter((p) => p.invoice_id === inv.id)
      .reduce((acc, p) => acc + Number(p.amount || 0), 0);
    const remaining = Math.max(0, inv.total_ttc - paid);
    if (!payment_date || !Number.isFinite(amt) || amt <= 0 || amt > remaining + 0.005) {
      res.status(400).json({ error: 'Montant invalide ou supérieur au solde restant.' });
      return;
    }
    const p = {
      id: newId('paym'),
      invoice_id: inv.id,
      payment_date,
      amount: Number(amt.toFixed(2)),
      currency: inv.currency,
      payment_method: payment_method || null,
      reference: reference ? String(reference).trim() : null,
      notes: notes ? String(notes).trim() : null,
      created_at: new Date().toISOString(),
    };
    ws.invoice_payments.unshift(p);
    addAuditLog(ws, req.authUser!, 'ADD_PAYMENT', 'invoice_payments', p.id, {
      invoice_number: inv.invoice_number,
      amount: p.amount,
    });
    saveDb();
    res.status(201).json(p);
  });

  app.put('/api/invoice-payments/:id', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const p = ws.invoice_payments.find((x) => x.id === req.params.id);
    if (!p) {
      res.status(404).json({ error: 'Règlement introuvable.' });
      return;
    }
    const inv = ws.invoices.find((i) => i.id === p.invoice_id);
    if (!inv) {
      res.status(404).json({ error: 'Facture introuvable.' });
      return;
    }
    const { payment_date, amount, payment_method, reference, notes } = req.body;
    const amt = Number(amount);
    const otherPaid = ws.invoice_payments
      .filter((x) => x.invoice_id === inv.id && x.id !== p.id)
      .reduce((acc, x) => acc + Number(x.amount || 0), 0);
    const available = Math.max(0, inv.total_ttc - otherPaid);
    if (!payment_date || !Number.isFinite(amt) || amt <= 0 || amt > available + 0.005) {
      res.status(400).json({ error: 'Montant invalide ou supérieur au solde.' });
      return;
    }
    p.payment_date = payment_date;
    p.amount = Number(amt.toFixed(2));
    p.payment_method = payment_method || null;
    p.reference = reference ? String(reference).trim() : null;
    p.notes = notes ? String(notes).trim() : null;
    saveDb();
    res.json(p);
  });

  app.delete('/api/invoice-payments/:id', requireAuth, requireRoles('admin', 'comptable'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const idx = ws.invoice_payments.findIndex((x) => x.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Règlement introuvable.' });
      return;
    }
    const [removed] = ws.invoice_payments.splice(idx, 1);
    addAuditLog(ws, req.authUser!, 'DELETE_PAYMENT', 'invoice_payments', removed.id, { amount: removed.amount });
    saveDb();
    res.json({ ok: true });
  });

  app.get('/api/invoice-settings', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    res.json(req.workspace!.invoice_settings);
  });

  app.put('/api/invoice-settings', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const { prefix, separator, padding_length, next_number } = req.body;
    const pad = Number(padding_length);
    const nextNum = Number(next_number);
    if (!String(prefix || '').trim() || pad < 1 || pad > 10 || nextNum < 1) {
      res.status(400).json({ error: 'Paramètres de numérotation invalides.' });
      return;
    }
    ws.invoice_settings = {
      id: 1,
      prefix: String(prefix).trim(),
      separator: String(separator ?? '-'),
      padding_length: pad,
      next_number: nextNum,
    };
    saveDb();
    res.json(ws.invoice_settings);
  });

  // ---------------- GPS ----------------
  app.get('/api/gps/overview', requireAuth, requireRoles('admin', 'logistique'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    res.json({
      devices: ws.gps_devices,
      positions: ws.gps_positions,
      alerts: ws.gps_alerts,
      trip_summaries: ws.gps_trip_summaries,
      geofences: ws.gps_geofences,
      events: ws.gps_device_events,
    });
  });

  app.post('/api/gps/devices', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const b = req.body;
    if (!b.vehicle_id) {
      res.status(400).json({ error: 'Véhicule obligatoire.' });
      return;
    }
    const item = {
      id: newId('gdev'),
      vehicle_id: b.vehicle_id,
      device_name: b.device_name ? String(b.device_name).trim() : null,
      provider: b.provider ? String(b.provider).trim() : null,
      imei: b.imei ? String(b.imei).trim() : null,
      provider_device_id: b.provider_device_id ? String(b.provider_device_id).trim() : null,
      status: b.status || 'inactive',
      installed_at: b.installed_at || null,
      last_seen_at: b.status === 'active' ? new Date().toISOString() : null,
      created_at: new Date().toISOString(),
    };
    ws.gps_devices.unshift(item);
    saveDb();
    res.status(201).json(item);
  });

  app.put('/api/gps/devices/:id', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const item = ws.gps_devices.find((d) => d.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Boîtier GPS introuvable.' });
      return;
    }
    const b = req.body;
    if (b.vehicle_id !== undefined) item.vehicle_id = b.vehicle_id;
    if (b.device_name !== undefined) item.device_name = b.device_name ? String(b.device_name).trim() : null;
    if (b.provider !== undefined) item.provider = b.provider ? String(b.provider).trim() : null;
    if (b.imei !== undefined) item.imei = b.imei ? String(b.imei).trim() : null;
    if (b.provider_device_id !== undefined)
      item.provider_device_id = b.provider_device_id ? String(b.provider_device_id).trim() : null;
    if (b.status !== undefined) item.status = b.status;
    if (b.installed_at !== undefined) item.installed_at = b.installed_at || null;
    saveDb();
    res.json(item);
  });

  app.post('/api/gps/alerts/:id/acknowledge', requireAuth, requireRoles('admin', 'logistique'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const alert = ws.gps_alerts.find((a) => a.id === req.params.id);
    if (!alert) {
      res.status(404).json({ error: 'Alerte GPS introuvable.' });
      return;
    }
    alert.acknowledged = true;
    alert.acknowledged_by = req.authUser!.id;
    alert.acknowledged_at = new Date().toISOString();
    saveDb();
    res.json(alert);
  });

  app.post('/api/gps/geofences', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const { name, description, geometry_json, is_active, alert_on_entry, alert_on_exit } = req.body;
    if (!String(name || '').trim() || !geometry_json || !['Polygon', 'MultiPolygon'].includes(geometry_json.type)) {
      res.status(400).json({ error: 'Nom et GeoJSON Polygon/MultiPolygon obligatoires.' });
      return;
    }
    const item = {
      id: newId('ggeo'),
      name: String(name).trim(),
      description: description ? String(description).trim() : null,
      geometry_json,
      is_active: is_active !== false,
      alert_on_entry: Boolean(alert_on_entry),
      alert_on_exit: alert_on_exit !== false,
      created_by: req.authUser!.id,
      created_at: new Date().toISOString(),
    };
    ws.gps_geofences.unshift(item);
    saveDb();
    res.status(201).json(item);
  });

  app.put('/api/gps/geofences/:id', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const item = ws.gps_geofences.find((g) => g.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Zone géographique introuvable.' });
      return;
    }
    const { name, description, geometry_json, is_active, alert_on_entry, alert_on_exit } = req.body;
    if (name !== undefined) item.name = String(name).trim();
    if (description !== undefined) item.description = description ? String(description).trim() : null;
    if (geometry_json !== undefined) item.geometry_json = geometry_json;
    if (is_active !== undefined) item.is_active = Boolean(is_active);
    if (alert_on_entry !== undefined) item.alert_on_entry = Boolean(alert_on_entry);
    if (alert_on_exit !== undefined) item.alert_on_exit = Boolean(alert_on_exit);
    saveDb();
    res.json(item);
  });

  app.post('/api/gps/simulate', requireAuth, requireRoles('admin', 'logistique'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const now = new Date().toISOString();
    const activeDevices = ws.gps_devices.filter((d) => d.status === 'active');
    if (activeDevices.length === 0) {
      res.status(400).json({ error: 'Aucun boîtier GPS actif à actualiser.' });
      return;
    }
    for (const dev of activeDevices) {
      const prev = ws.gps_positions.find((p) => p.vehicle_id === dev.vehicle_id);
      const baseLat = prev ? prev.latitude : 33.5731;
      const baseLng = prev ? prev.longitude : -7.5898;
      const dLat = (Math.random() - 0.35) * 0.08;
      const dLng = (Math.random() - 0.35) * 0.08;
      const speed = Math.round(58 + Math.random() * 34);
      const activeTrip = ws.trips.find(
        (t) =>
          t.status === 'En cours' &&
          (getTripTractorIds(t).includes(dev.vehicle_id) || t.trailer_id === dev.vehicle_id),
      );
      ws.gps_positions.unshift({
        id: newId('gpos'),
        vehicle_id: dev.vehicle_id,
        trip_id: activeTrip?.id || prev?.trip_id || null,
        latitude: Number((baseLat + dLat).toFixed(5)),
        longitude: Number((baseLng + dLng).toFixed(5)),
        speed_kmh: speed,
        heading: Math.round(Math.random() * 359),
        recorded_at: now,
      });
      dev.last_seen_at = now;
    }
    ws.gps_positions = ws.gps_positions.slice(0, 300);
    saveDb();
    res.json({ ok: true, updated_at: now });
  });

  // ---------------- B2B TURNKEY PACKS & CONSOLE ----------------
  app.get('/api/b2b/packs', (_req, res) => {
    res.json(getCatalogPacks());
  });

  app.post('/api/b2b/requests', (req, res) => {
    const { company_name, contact_name, phone, email, fleet_size, pack, currency, notes } = req.body as {
      company_name?: string;
      contact_name?: string;
      phone?: string;
      email?: string;
      fleet_size?: number | string;
      pack?: B2BPackId;
      currency?: Currency;
      notes?: string;
    };

    if (!String(company_name || '').trim() || !String(contact_name || '').trim() || !String(phone || '').trim() || !String(email || '').trim()) {
      res.status(400).json({ error: 'Société, interlocuteur, téléphone et e-mail sont obligatoires.' });
      return;
    }

    const db = loadDb();
    const catalog = getCatalogPacks(db);
    const validPackIds = catalog.map((p) => p.id);
    const resolvedPack: B2BPackId =
      pack && validPackIds.includes(pack)
        ? pack
        : catalog.find((p) => p.is_featured)?.id || catalog[0]?.id || 'pack_flotte_gps';
    const resolvedCurrency: Currency = currency === 'EUR' ? 'EUR' : 'MAD';
    const parsedFleet = Math.max(1, Number(fleet_size || 5) || 5);
    const item: B2BDeploymentRequest = {
      id: newId('req'),
      company_name: String(company_name).trim(),
      contact_name: String(contact_name).trim(),
      phone: String(phone).trim(),
      email: String(email).trim().toLowerCase(),
      fleet_size: parsedFleet,
      pack: resolvedPack,
      currency: resolvedCurrency,
      notes: notes ? String(notes).trim() : null,
      status: 'nouvelle',
      provisioned_workspace_code: null,
      created_at: new Date().toISOString(),
    };
    db.b2b_requests.unshift(item);
    saveDb();
    res.status(201).json(item);
  });

  app.get('/api/b2b/my-license', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    if (!ws.b2b_license) {
      ws.b2b_license = createDefaultLicense(ws.code === 'DEMO' ? 'demo_gratuit' : 'pack_essentiel', 'MAD', 'essai_gratuit');
      saveDb();
    }
    res.json({
      license: ws.b2b_license,
      packCatalog: getCatalogPacks(),
      usage: {
        vehicles: ws.vehicles.length,
        users: ws.users.length,
        trips: ws.trips.length,
      },
    });
  });

  app.put('/api/b2b/my-license/checklist', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const { itemId, done } = req.body as { itemId?: string; done?: boolean };
    if (!ws.b2b_license) {
      ws.b2b_license = createDefaultLicense(ws.code === 'DEMO' ? 'demo_gratuit' : 'pack_essentiel', 'MAD', 'essai_gratuit');
    }
    const target = ws.b2b_license.onboarding_checklist.find((i) => i.id === itemId);
    if (!target) {
      res.status(404).json({ error: 'Étape de déploiement introuvable.' });
      return;
    }
    target.done = Boolean(done);
    saveDb();
    res.json(ws.b2b_license);
  });

  app.post('/api/b2b/my-license/upgrade-request', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const user = req.authUser!;
    const { pack, currency, fleet_size, phone, notes } = req.body as {
      pack?: B2BPackId;
      currency?: Currency;
      fleet_size?: number | string;
      phone?: string;
      notes?: string;
    };
    const db = loadDb();
    const catalog = getCatalogPacks(db);
    const validPackIds = catalog.map((p) => p.id);
    const resolvedPack: B2BPackId =
      pack && validPackIds.includes(pack)
        ? pack
        : catalog.find((p) => p.is_featured)?.id || catalog[0]?.id || 'pack_flotte_gps';
    const resolvedCurrency: Currency = currency === 'EUR' ? 'EUR' : 'MAD';
    const item: B2BDeploymentRequest = {
      id: newId('req'),
      company_name: ws.company_settings.company_name || ws.name,
      contact_name: user.full_name,
      phone: String(phone || ws.company_settings.phone || 'À préciser').trim(),
      email: user.email,
      fleet_size: Math.max(1, Number(fleet_size || ws.vehicles.length || 5) || 5),
      pack: resolvedPack,
      currency: resolvedCurrency,
      notes: notes
        ? String(notes).trim()
        : `Demande d’activation / évolution depuis l’espace ${ws.code} (${ws.name}).`,
      status: 'nouvelle',
      provisioned_workspace_code: ws.code === 'DEMO' ? null : ws.code,
      created_at: new Date().toISOString(),
    };
    db.b2b_requests.unshift(item);
    addAuditLog(ws, user, 'REQUEST_B2B_UPGRADE', 'b2b_requests', item.id, {
      pack: resolvedPack,
      currency: resolvedCurrency,
    });
    saveDb();
    res.status(201).json(item);
  });

  // ---------------- INDEPENDENT B2B VENDOR & ACCOUNT MANAGEMENT PORTAL ----------------
  app.post('/api/vendor/login', (req, res) => {
    const { email, password } = (req.body || {}) as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ error: 'E-mail et mot de passe requis.' });
      return;
    }
    const db = loadDb();
    const vendor = db.vendor_accounts.find(
      (v) => v.email.toLowerCase() === email.trim().toLowerCase(),
    );
    if (!vendor || !verifyPassword(password, vendor.password_hash)) {
      res.status(401).json({ error: 'Identifiants éditeur incorrects.' });
      return;
    }
    if (!vendor.active) {
      res.status(403).json({ error: 'Compte éditeur désactivé.' });
      return;
    }
    const token = signVendorToken(vendor.id);
    res.json({ token, vendor: toVendorProfile(vendor) });
  });

  app.post('/api/vendor/demo', (_req, res) => {
    const db = loadDb();
    const vendor = db.vendor_accounts.find((v) => v.active);
    if (!vendor) {
      res.status(404).json({ error: 'Aucun compte éditeur disponible.' });
      return;
    }
    const token = signVendorToken(vendor.id);
    res.json({ token, vendor: toVendorProfile(vendor) });
  });

  app.get('/api/vendor/me', requireVendorAuth, (req: VendorAuthedRequest, res) => {
    res.json({ vendor: toVendorProfile(req.vendorAccount!) });
  });

  app.get('/api/vendor/overview', requireVendorAuth, (_req: VendorAuthedRequest, res) => {
    const db = loadDb();
    const workspaces = [...db.workspaces]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map(buildVendorWorkspaceSummary);
    const metrics = computeVendorMetrics(workspaces, db.b2b_requests);
    const billingDocs = [...getVendorBillingDocs(db)].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    res.json({
      packs: getCatalogPacks(db),
      requests: db.b2b_requests,
      workspaces,
      metrics,
      vendor_settings: getVendorSettings(db),
      vendor_billing_docs: billingDocs,
      vendor_accounts: db.vendor_accounts.map(toVendorAccountPublic),
    });
  });

  // Vendor Company Settings
  app.get('/api/vendor/settings', requireVendorAuth, (_req: VendorAuthedRequest, res) => {
    const db = loadDb();
    res.json(getVendorSettings(db));
  });

  app.put('/api/vendor/settings', requireVendorAuth, (req: VendorAuthedRequest, res) => {
    const db = loadDb();
    const current = getVendorSettings(db);
    const body = (req.body || {}) as Partial<VendorSettings>;
    const companyName =
      body.company_name !== undefined ? String(body.company_name).trim() : current.company_name;
    if (!companyName) {
      res.status(400).json({ error: 'La raison sociale est obligatoire.' });
      return;
    }
    const logoUrl = body.logo_url !== undefined ? String(body.logo_url) : current.logo_url;
    if (logoUrl.length > 2_000_000) {
      res.status(400).json({ error: 'Logo trop volumineux (max 1.5 Mo).' });
      return;
    }
    const updated: VendorSettings = {
      ...createDefaultVendorSettings(),
      ...current,
      company_name: companyName.slice(0, 160),
      legal_form:
        body.legal_form !== undefined ? String(body.legal_form).trim().slice(0, 80) : current.legal_form,
      activity:
        body.activity !== undefined ? String(body.activity).trim().slice(0, 200) : current.activity,
      ice: body.ice !== undefined ? String(body.ice).trim().slice(0, 60) : current.ice,
      if_number:
        body.if_number !== undefined ? String(body.if_number).trim().slice(0, 60) : current.if_number,
      rc: body.rc !== undefined ? String(body.rc).trim().slice(0, 60) : current.rc,
      patente:
        body.patente !== undefined ? String(body.patente).trim().slice(0, 60) : current.patente,
      bank: body.bank !== undefined ? String(body.bank).trim().slice(0, 120) : current.bank,
      rib: body.rib !== undefined ? String(body.rib).trim().slice(0, 80) : current.rib,
      address:
        body.address !== undefined ? String(body.address).trim().slice(0, 300) : current.address,
      city: body.city !== undefined ? String(body.city).trim().slice(0, 100) : current.city,
      phone: body.phone !== undefined ? String(body.phone).trim().slice(0, 40) : current.phone,
      email: body.email !== undefined ? String(body.email).trim().slice(0, 160) : current.email,
      website:
        body.website !== undefined ? String(body.website).trim().slice(0, 200) : current.website,
      logo_url: logoUrl,
      quote_prefix:
        body.quote_prefix !== undefined
          ? (String(body.quote_prefix).trim().slice(0, 32) || 'DEV-B2B')
          : current.quote_prefix,
      invoice_prefix:
        body.invoice_prefix !== undefined
          ? (String(body.invoice_prefix).trim().slice(0, 32) || 'FAC-B2B')
          : current.invoice_prefix,
      default_tax_rate:
        body.default_tax_rate !== undefined
          ? Math.min(100, Math.max(0, Number(body.default_tax_rate) || 0))
          : current.default_tax_rate,
      payment_terms:
        body.payment_terms !== undefined
          ? String(body.payment_terms).trim().slice(0, 1000)
          : current.payment_terms,
      updated_at: new Date().toISOString(),
    };
    db.vendor_settings = updated;
    saveDb();
    res.json(updated);
  });

  // Vendor Accounts & Password Management
  app.get('/api/vendor/accounts', requireVendorAuth, (_req: VendorAuthedRequest, res) => {
    const db = loadDb();
    res.json({ accounts: db.vendor_accounts.map(toVendorAccountPublic) });
  });

  app.post('/api/vendor/account/password', requireVendorAuth, (req: VendorAuthedRequest, res) => {
    const db = loadDb();
    const vendor = db.vendor_accounts.find((v) => v.id === req.vendorAccount!.id);
    if (!vendor) {
      res.status(404).json({ error: 'Compte éditeur introuvable.' });
      return;
    }
    const body = (req.body || {}) as {
      current_password?: string;
      new_password?: string;
      full_name?: string;
      company_role?: string;
    };

    const nextFullName = body.full_name !== undefined ? String(body.full_name).trim() : vendor.full_name;
    const nextRole =
      body.company_role !== undefined ? String(body.company_role).trim() : vendor.company_role;

    if (body.new_password !== undefined && String(body.new_password).length > 0) {
      const currentPw = String(body.current_password || '');
      const newPw = String(body.new_password || '').trim();
      if (!currentPw || !verifyPassword(currentPw, vendor.password_hash)) {
        res.status(400).json({ error: 'Le mot de passe actuel est incorrect.' });
        return;
      }
      if (newPw.length < 6) {
        res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' });
        return;
      }
      vendor.password_hash = hashPassword(newPw);
    }

    if (nextFullName) vendor.full_name = nextFullName.slice(0, 120);
    if (nextRole) vendor.company_role = nextRole.slice(0, 160);
    vendor.updated_at = new Date().toISOString();
    saveDb();
    res.json({
      ok: true,
      vendor: toVendorProfile(vendor),
      accounts: db.vendor_accounts.map(toVendorAccountPublic),
    });
  });

  app.post('/api/vendor/accounts/:id/reset-password', requireVendorAuth, (req: VendorAuthedRequest, res) => {
    const db = loadDb();
    const target = db.vendor_accounts.find((v) => v.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Compte éditeur introuvable.' });
      return;
    }
    const { new_password } = (req.body || {}) as { new_password?: string };
    const cleanPw = String(new_password || '').trim();
    if (cleanPw.length < 6) {
      res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' });
      return;
    }
    target.password_hash = hashPassword(cleanPw);
    target.updated_at = new Date().toISOString();
    saveDb();
    res.json({
      ok: true,
      account: toVendorAccountPublic(target),
      accounts: db.vendor_accounts.map(toVendorAccountPublic),
    });
  });

  // Vendor B2B Quotes & Invoices Editor CRUD
  app.get('/api/vendor/billing-docs', requireVendorAuth, (_req: VendorAuthedRequest, res) => {
    const db = loadDb();
    const docs = [...getVendorBillingDocs(db)].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    res.json({ billing_docs: docs });
  });

  app.post('/api/vendor/billing-docs', requireVendorAuth, (req: VendorAuthedRequest, res) => {
    const db = loadDb();
    const settings = getVendorSettings(db);
    const docs = getVendorBillingDocs(db);
    const body = (req.body || {}) as Partial<VendorBillingDoc>;

    const docType: VendorBillingDocType = body.doc_type === 'facture' ? 'facture' : 'devis';
    const clientName = String(body.client_name || '').trim();
    if (!clientName) {
      res.status(400).json({ error: 'Le nom du client est obligatoire.' });
      return;
    }

    const rawItems = Array.isArray(body.items) ? body.items : [];
    const items: VendorBillingDocItem[] = rawItems
      .map((it) => {
        const qty = Math.max(0, Number(it.quantity) || 0);
        const price = Math.max(0, Number(it.unit_price) || 0);
        return {
          id: it.id ? String(it.id) : newId('vbi'),
          description: String(it.description || '').trim().slice(0, 240),
          details: it.details ? String(it.details).trim().slice(0, 400) : '',
          quantity: qty,
          unit_price: roundMoney2(price),
          total_ht: roundMoney2(qty * price),
        };
      })
      .filter((it) => it.description.length > 0);

    if (items.length === 0) {
      res.status(400).json({ error: 'Ajoutez au moins une ligne de prestation.' });
      return;
    }

    const taxRate = Math.min(
      100,
      Math.max(0, body.tax_rate !== undefined ? Number(body.tax_rate) : settings.default_tax_rate),
    );
    const subtotalHt = roundMoney2(items.reduce((sum, it) => sum + it.total_ht, 0));
    const taxAmount = roundMoney2((subtotalHt * taxRate) / 100);
    const totalTtc = roundMoney2(subtotalHt + taxAmount);

    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const dueDefault = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const allowedStatuses: VendorBillingDocStatus[] = ['brouillon', 'envoye', 'paye', 'annule'];
    const status: VendorBillingDocStatus =
      body.status && allowedStatuses.includes(body.status) ? body.status : 'brouillon';

    const created: VendorBillingDoc = {
      id: newId('vdoc'),
      doc_type: docType,
      doc_number:
        String(body.doc_number || '').trim().slice(0, 64) ||
        generateNextBillingDocNumber(docType, settings, docs),
      workspace_id: body.workspace_id ? String(body.workspace_id).trim() : null,
      request_id: body.request_id ? String(body.request_id).trim() : null,
      source_quote_id: body.source_quote_id ? String(body.source_quote_id).trim() : null,
      client_name: clientName.slice(0, 160),
      client_contact: String(body.client_contact || '').trim().slice(0, 120),
      client_ice: String(body.client_ice || '').trim().slice(0, 60),
      client_phone: String(body.client_phone || '').trim().slice(0, 40),
      client_email: String(body.client_email || '').trim().slice(0, 160),
      client_address: String(body.client_address || '').trim().slice(0, 300),
      currency: body.currency === 'EUR' ? 'EUR' : 'MAD',
      issue_date: String(body.issue_date || '').trim().slice(0, 32) || today,
      due_date: String(body.due_date || '').trim().slice(0, 32) || dueDefault,
      status,
      tax_rate: taxRate,
      items,
      subtotal_ht: subtotalHt,
      tax_amount: taxAmount,
      total_ttc: totalTtc,
      notes: String(body.notes || '').trim().slice(0, 2000),
      created_at: now,
      updated_at: now,
    };

    docs.unshift(created);
    db.vendor_billing_docs = docs;
    saveDb();
    res.status(201).json({ doc: created, billing_docs: docs });
  });

  app.put('/api/vendor/billing-docs/:id', requireVendorAuth, (req: VendorAuthedRequest, res) => {
    const db = loadDb();
    const settings = getVendorSettings(db);
    const docs = getVendorBillingDocs(db);
    const idx = docs.findIndex((d) => d.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Document introuvable.' });
      return;
    }

    const current = docs[idx];
    const body = (req.body || {}) as Partial<VendorBillingDoc>;
    const docType: VendorBillingDocType =
      body.doc_type === 'facture' ? 'facture' : body.doc_type === 'devis' ? 'devis' : current.doc_type;
    const clientName =
      body.client_name !== undefined ? String(body.client_name).trim() : current.client_name;
    if (!clientName) {
      res.status(400).json({ error: 'Le nom du client est obligatoire.' });
      return;
    }

    const rawItems = Array.isArray(body.items) ? body.items : current.items;
    const items: VendorBillingDocItem[] = rawItems
      .map((it) => {
        const qty = Math.max(0, Number(it.quantity) || 0);
        const price = Math.max(0, Number(it.unit_price) || 0);
        return {
          id: it.id ? String(it.id) : newId('vbi'),
          description: String(it.description || '').trim().slice(0, 240),
          details: it.details ? String(it.details).trim().slice(0, 400) : '',
          quantity: qty,
          unit_price: roundMoney2(price),
          total_ht: roundMoney2(qty * price),
        };
      })
      .filter((it) => it.description.length > 0);

    if (items.length === 0) {
      res.status(400).json({ error: 'Ajoutez au moins une ligne de prestation.' });
      return;
    }

    const taxRate = Math.min(
      100,
      Math.max(0, body.tax_rate !== undefined ? Number(body.tax_rate) : current.tax_rate),
    );
    const subtotalHt = roundMoney2(items.reduce((sum, it) => sum + it.total_ht, 0));
    const taxAmount = roundMoney2((subtotalHt * taxRate) / 100);
    const totalTtc = roundMoney2(subtotalHt + taxAmount);

    const allowedStatuses: VendorBillingDocStatus[] = ['brouillon', 'envoye', 'paye', 'annule'];
    const status: VendorBillingDocStatus =
      body.status && allowedStatuses.includes(body.status) ? body.status : current.status;

    const updated: VendorBillingDoc = {
      ...current,
      doc_type: docType,
      doc_number:
        body.doc_number !== undefined
          ? String(body.doc_number).trim().slice(0, 64) || current.doc_number
          : current.doc_number,
      workspace_id: body.workspace_id !== undefined ? body.workspace_id || null : current.workspace_id,
      request_id: body.request_id !== undefined ? body.request_id || null : current.request_id,
      source_quote_id:
        body.source_quote_id !== undefined ? body.source_quote_id || null : current.source_quote_id,
      client_name: clientName.slice(0, 160),
      client_contact:
        body.client_contact !== undefined
          ? String(body.client_contact).trim().slice(0, 120)
          : current.client_contact,
      client_ice:
        body.client_ice !== undefined ? String(body.client_ice).trim().slice(0, 60) : current.client_ice,
      client_phone:
        body.client_phone !== undefined
          ? String(body.client_phone).trim().slice(0, 40)
          : current.client_phone,
      client_email:
        body.client_email !== undefined
          ? String(body.client_email).trim().slice(0, 160)
          : current.client_email,
      client_address:
        body.client_address !== undefined
          ? String(body.client_address).trim().slice(0, 300)
          : current.client_address,
      currency: body.currency === 'EUR' ? 'EUR' : body.currency === 'MAD' ? 'MAD' : current.currency,
      issue_date:
        body.issue_date !== undefined
          ? String(body.issue_date).trim().slice(0, 32) || current.issue_date
          : current.issue_date,
      due_date:
        body.due_date !== undefined
          ? String(body.due_date).trim().slice(0, 32) || current.due_date
          : current.due_date,
      status,
      tax_rate: taxRate,
      items,
      subtotal_ht: subtotalHt,
      tax_amount: taxAmount,
      total_ttc: totalTtc,
      notes: body.notes !== undefined ? String(body.notes).trim().slice(0, 2000) : current.notes,
      updated_at: new Date().toISOString(),
    };

    if (!updated.doc_number) {
      updated.doc_number = generateNextBillingDocNumber(docType, settings, docs);
    }

    docs[idx] = updated;
    db.vendor_billing_docs = docs;
    saveDb();
    res.json({ doc: updated, billing_docs: docs });
  });

  app.post('/api/vendor/billing-docs/:id/convert-invoice', requireVendorAuth, (req: VendorAuthedRequest, res) => {
    const db = loadDb();
    const settings = getVendorSettings(db);
    const docs = getVendorBillingDocs(db);
    const quote = docs.find((d) => d.id === req.params.id);
    if (!quote) {
      res.status(404).json({ error: 'Devis introuvable.' });
      return;
    }

    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const dueDefault = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const invoice: VendorBillingDoc = {
      ...quote,
      id: newId('vdoc'),
      doc_type: 'facture',
      doc_number: generateNextBillingDocNumber('facture', settings, docs),
      source_quote_id: quote.id,
      issue_date: today,
      due_date: dueDefault,
      status: 'brouillon',
      items: quote.items.map((it) => ({ ...it, id: newId('vbi') })),
      created_at: now,
      updated_at: now,
    };

    if (quote.status === 'brouillon') {
      quote.status = 'envoye';
      quote.updated_at = now;
    }

    docs.unshift(invoice);
    db.vendor_billing_docs = docs;
    saveDb();
    res.status(201).json({ invoice, billing_docs: docs });
  });

  app.delete('/api/vendor/billing-docs/:id', requireVendorAuth, (req: VendorAuthedRequest, res) => {
    const db = loadDb();
    const docs = getVendorBillingDocs(db);
    const idx = docs.findIndex((d) => d.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Document introuvable.' });
      return;
    }
    const [removed] = docs.splice(idx, 1);
    db.vendor_billing_docs = docs;
    db.deleted_billing_doc_ids = [...new Set([...(db.deleted_billing_doc_ids || []), removed.id])];
    saveDb();
    res.json({ ok: true, id: removed.id, billing_docs: docs });
  });

  app.put('/api/vendor/requests/:id/status', requireVendorAuth, (req: VendorAuthedRequest, res) => {
    const db = loadDb();
    const reqItem = db.b2b_requests.find((r) => r.id === req.params.id);
    if (!reqItem) {
      res.status(404).json({ error: 'Demande B2B introuvable.' });
      return;
    }
    const { status } = req.body as { status?: B2BDeploymentRequest['status'] };
    const allowed: B2BDeploymentRequest['status'][] = [
      'nouvelle',
      'contactee',
      'en_deploiement',
      'convertie',
      'archivee',
    ];
    if (!status || !allowed.includes(status)) {
      res.status(400).json({ error: 'Statut invalide.' });
      return;
    }
    reqItem.status = status;
    reqItem.updated_at = new Date().toISOString();
    saveDb();
    res.json(reqItem);
  });

  app.post('/api/vendor/requests/:id/provision', requireVendorAuth, (req: VendorAuthedRequest, res) => {
    const db = loadDb();
    const reqItem = db.b2b_requests.find((r) => r.id === req.params.id);
    if (!reqItem) {
      res.status(404).json({ error: 'Demande B2B introuvable.' });
      return;
    }

    const { custom_password } = (req.body || {}) as { custom_password?: string };
    const tempPassword =
      custom_password && String(custom_password).trim().length >= 4
        ? String(custom_password).trim()
        : `Fret${Math.floor(1000 + Math.random() * 9000)}!`;

    const { workspace, user } = createEmptyWorkspace(
      reqItem.company_name,
      reqItem.email,
      tempPassword,
      reqItem.contact_name,
      {
        pack: reqItem.pack,
        currency: reqItem.currency,
        status: 'actif',
      },
    );

    workspace.company_settings.phone = reqItem.phone;
    if (workspace.b2b_license) {
      workspace.b2b_license.notes = `Provisionné suite à la demande B2B #${reqItem.id}. Flotte déclarée : ${reqItem.fleet_size} véhicules.`;
    }

    reqItem.status = 'convertie';
    reqItem.provisioned_workspace_code = workspace.code;
    reqItem.updated_at = new Date().toISOString();
    workspace.updated_at = new Date().toISOString();
    saveDb();

    res.status(201).json({
      workspace_code: workspace.code,
      workspace_name: workspace.name,
      admin_email: user.email,
      temp_password: tempPassword,
      request: reqItem,
    });
  });

  app.put('/api/vendor/workspaces/:id/license', requireVendorAuth, (req: VendorAuthedRequest, res) => {
    const ws = findWorkspaceById(req.params.id);
    if (!ws) {
      res.status(404).json({ error: 'Espace client introuvable.' });
      return;
    }

    const body = req.body as Partial<B2BLicense>;
    const current =
      ws.b2b_license ||
      createDefaultLicense(ws.code === 'DEMO' ? 'demo_gratuit' : 'pack_essentiel', 'MAD', 'essai_gratuit');

    const updated: B2BLicense = {
      pack: body.pack ?? current.pack,
      status: body.status ?? current.status,
      setup_fee: body.setup_fee !== undefined ? Number(body.setup_fee) : current.setup_fee,
      annual_fee: body.annual_fee !== undefined ? Number(body.annual_fee) : current.annual_fee,
      currency: body.currency ?? current.currency,
      max_vehicles: body.max_vehicles !== undefined ? Number(body.max_vehicles) : current.max_vehicles,
      max_users: body.max_users !== undefined ? Number(body.max_users) : current.max_users,
      gps_enabled: body.gps_enabled !== undefined ? Boolean(body.gps_enabled) : current.gps_enabled,
      valid_until: body.valid_until ?? current.valid_until,
      onboarding_checklist: Array.isArray(body.onboarding_checklist)
        ? (body.onboarding_checklist as OnboardingChecklistItem[])
        : current.onboarding_checklist,
      notes: body.notes !== undefined ? String(body.notes) : current.notes,
    };

    ws.b2b_license = updated;
    ws.updated_at = new Date().toISOString();
    saveDb();
    res.json(buildVendorWorkspaceSummary(ws));
  });

  app.post('/api/vendor/workspaces/:id/renew', requireVendorAuth, (req: VendorAuthedRequest, res) => {
    const ws = findWorkspaceById(req.params.id);
    if (!ws) {
      res.status(404).json({ error: 'Espace client introuvable.' });
      return;
    }
    const { years = 1, pack } = (req.body || {}) as { years?: number; pack?: B2BPackId };
    const current =
      ws.b2b_license ||
      createDefaultLicense(ws.code === 'DEMO' ? 'demo_gratuit' : 'pack_essentiel', 'MAD', 'essai_gratuit');

    const baseDate = new Date(`${current.valid_until}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startFrom = baseDate > today ? baseDate : today;
    startFrom.setFullYear(startFrom.getFullYear() + Math.max(1, Number(years) || 1));

    const resolvedPack = pack && pack !== 'demo_gratuit'
      ? pack
      : current.pack === 'demo_gratuit'
        ? 'pack_essentiel'
        : current.pack;
    const cat = getCatalogPacks().find((p) => p.id === resolvedPack);

    current.pack = resolvedPack;
    current.status = 'actif';
    current.valid_until = startFrom.toISOString().slice(0, 10);
    if (cat) {
      if (current.annual_fee <= 0) {
        current.annual_fee = current.currency === 'EUR' ? cat.annual_fee_eur : cat.annual_fee_mad;
      }
      if (current.setup_fee <= 0) {
        current.setup_fee = current.currency === 'EUR' ? cat.setup_fee_eur : cat.setup_fee_mad;
      }
      current.max_vehicles = Math.max(current.max_vehicles, cat.max_vehicles);
      current.max_users = Math.max(current.max_users, cat.max_users);
      current.gps_enabled = cat.gps_enabled || current.gps_enabled;
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    current.notes = `${current.notes ? `${current.notes}\n` : ''}Renouvellement validé le ${todayStr} jusqu'au ${current.valid_until}.`;
    ws.b2b_license = current;
    ws.updated_at = new Date().toISOString();
    saveDb();
    res.json(buildVendorWorkspaceSummary(ws));
  });

  app.delete('/api/vendor/workspaces/:id', requireVendorAuth, (req: VendorAuthedRequest, res) => {
    const db = loadDb();
    const idx = db.workspaces.findIndex((w) => w.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Espace client introuvable.' });
      return;
    }
    const [removed] = db.workspaces.splice(idx, 1);
    db.deleted_workspace_ids = [...new Set([...(db.deleted_workspace_ids || []), removed.id])];
    saveDb();
    res.json({ ok: true, id: removed.id, code: removed.code, name: removed.name });
  });

  app.delete('/api/vendor/requests/:id', requireVendorAuth, (req: VendorAuthedRequest, res) => {
    const db = loadDb();
    const idx = db.b2b_requests.findIndex((r) => r.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Demande introuvable.' });
      return;
    }
    const [removedReq] = db.b2b_requests.splice(idx, 1);
    db.deleted_request_ids = [...new Set([...(db.deleted_request_ids || []), removedReq.id])];
    saveDb();
    res.json({ ok: true });
  });

  app.post('/api/vendor/reset-demo', requireVendorAuth, (_req: VendorAuthedRequest, res) => {
    const db = loadDb();
    const freshDemo = createDemoWorkspace();
    freshDemo.updated_at = new Date().toISOString();
    const idx = db.workspaces.findIndex((w) => w.id === 'ws_demo' || w.code === 'DEMO');
    if (idx >= 0) {
      db.workspaces[idx] = freshDemo;
    } else {
      db.workspaces.unshift(freshDemo);
    }
    db.deleted_workspace_ids = (db.deleted_workspace_ids || []).filter((id) => id !== 'ws_demo');
    saveDb();
    res.json({ ok: true, workspace: buildVendorWorkspaceSummary(freshDemo) });
  });

  app.post('/api/vendor/purge-demo', requireVendorAuth, (_req: VendorAuthedRequest, res) => {
    const db = loadDb();
    const sampleWsIds = new Set([
      'ws_demo',
      'ws_atlantique',
      'ws_maghreb_nord',
      'ws_nord_exp',
      'ws_maroc_cargo',
      'ws_euromed',
      'ws_sahara_trial',
    ]);
    const sampleReqIds = new Set(['req_souss', 'req_casa', 'req_tanger']);
    const beforeWs = db.workspaces.length;
    const beforeReq = db.b2b_requests.length;
    db.workspaces = db.workspaces.filter((w) => !sampleWsIds.has(w.id));
    db.b2b_requests = db.b2b_requests.filter((r) => !sampleReqIds.has(r.id));
    db.deleted_workspace_ids = [...new Set([...(db.deleted_workspace_ids || []), ...sampleWsIds])];
    db.deleted_request_ids = [...new Set([...(db.deleted_request_ids || []), ...sampleReqIds])];
    saveDb();
    res.json({
      ok: true,
      removed_workspaces: beforeWs - db.workspaces.length,
      removed_requests: beforeReq - db.b2b_requests.length,
    });
  });

  // Vendor B2B Offer Catalog CRUD
  app.post('/api/vendor/packs', requireVendorAuth, (req: VendorAuthedRequest, res) => {
    const body = (req.body || {}) as Partial<B2BPackCatalogItem>;
    const name = String(body.name || '').trim();
    if (!name) {
      res.status(400).json({ error: 'Le nom du pack est obligatoire.' });
      return;
    }
    const db = loadDb();
    const packs = getCatalogPacks(db);

    const slugBase = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 28);
    let packId = body.id ? String(body.id).trim() : `pack_${slugBase || 'custom'}`;
    if (packs.some((p) => p.id === packId) || packId === 'demo_gratuit') {
      packId = `pack_${slugBase || 'custom'}_${Date.now().toString().slice(-4)}`;
    }

    const deliverables = Array.isArray(body.deliverables)
      ? body.deliverables.map((d) => String(d).trim()).filter(Boolean)
      : [];

    const created: B2BPackCatalogItem = {
      id: packId,
      name,
      audience: String(body.audience || '').trim() || 'Offre B2B sur mesure',
      setup_fee_mad: Math.max(0, Number(body.setup_fee_mad) || 0),
      annual_fee_mad: Math.max(0, Number(body.annual_fee_mad) || 0),
      setup_fee_eur: Math.max(0, Number(body.setup_fee_eur) || 0),
      annual_fee_eur: Math.max(0, Number(body.annual_fee_eur) || 0),
      max_vehicles: Math.max(1, Number(body.max_vehicles) || 10),
      max_users: Math.max(1, Number(body.max_users) || 10),
      gps_enabled: Boolean(body.gps_enabled),
      deliverables,
      logistics_benefit: String(body.logistics_benefit || '').trim() || undefined,
      is_featured: Boolean(body.is_featured),
      customized: true,
    };

    if (created.is_featured) {
      for (const p of packs) p.is_featured = false;
    }

    packs.push(created);
    db.b2b_packs = packs;
    saveDb();
    res.status(201).json({ pack: created, packs });
  });

  app.put('/api/vendor/packs/:id', requireVendorAuth, (req: VendorAuthedRequest, res) => {
    const db = loadDb();
    const packs = getCatalogPacks(db);
    const target = packs.find((p) => p.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Offre B2B introuvable.' });
      return;
    }

    const body = (req.body || {}) as Partial<B2BPackCatalogItem>;
    if (body.name !== undefined && !String(body.name).trim()) {
      res.status(400).json({ error: 'Le nom du pack est obligatoire.' });
      return;
    }

    if (body.is_featured === true) {
      for (const p of packs) p.is_featured = false;
    }

    if (body.name !== undefined) target.name = String(body.name).trim();
    if (body.audience !== undefined) target.audience = String(body.audience).trim();
    if (body.setup_fee_mad !== undefined) target.setup_fee_mad = Math.max(0, Number(body.setup_fee_mad) || 0);
    if (body.annual_fee_mad !== undefined) target.annual_fee_mad = Math.max(0, Number(body.annual_fee_mad) || 0);
    if (body.setup_fee_eur !== undefined) target.setup_fee_eur = Math.max(0, Number(body.setup_fee_eur) || 0);
    if (body.annual_fee_eur !== undefined) target.annual_fee_eur = Math.max(0, Number(body.annual_fee_eur) || 0);
    if (body.max_vehicles !== undefined) target.max_vehicles = Math.max(1, Number(body.max_vehicles) || 1);
    if (body.max_users !== undefined) target.max_users = Math.max(1, Number(body.max_users) || 1);
    if (body.gps_enabled !== undefined) target.gps_enabled = Boolean(body.gps_enabled);
    if (body.is_featured !== undefined) target.is_featured = Boolean(body.is_featured);
    if (body.logistics_benefit !== undefined) {
      target.logistics_benefit = String(body.logistics_benefit).trim() || undefined;
    }
    if (Array.isArray(body.deliverables)) {
      target.deliverables = body.deliverables.map((d) => String(d).trim()).filter(Boolean);
    }
    target.customized = true;

    db.b2b_packs = packs;
    saveDb();
    res.json({ pack: target, packs });
  });

  app.delete('/api/vendor/packs/:id', requireVendorAuth, (req: VendorAuthedRequest, res) => {
    const db = loadDb();
    const packs = getCatalogPacks(db);
    if (packs.length <= 1) {
      res.status(400).json({ error: 'Au moins une offre B2B doit rester active dans le catalogue.' });
      return;
    }
    const idx = packs.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Offre B2B introuvable.' });
      return;
    }
    packs.splice(idx, 1);
    db.b2b_packs = packs;
    saveDb();
    res.json({ ok: true, packs });
  });

  app.post('/api/vendor/packs/reset', requireVendorAuth, (_req: VendorAuthedRequest, res) => {
    const db = loadDb();
    db.b2b_packs = structuredClone(B2B_PACKS);
    saveDb();
    res.json({ ok: true, packs: db.b2b_packs });
  });

  // ---------------- CLOUD & LOCAL PERSISTENCE SYNC ----------------
  app.get('/api/sync/workspace-bundle', requireAuth, (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const db = loadDb();
    const relatedRequests = db.b2b_requests.filter(
      (r) =>
        r.provisioned_workspace_code === ws.code ||
        ws.users.some((u) => u.email.toLowerCase() === r.email.toLowerCase()),
    );
    res.json({
      workspace: ws,
      b2b_requests: relatedRequests,
      b2b_packs: getCatalogPacks(db),
    });
  });

  app.get('/api/sync/vendor-bundle', requireVendorAuth, (_req: VendorAuthedRequest, res) => {
    const db = loadDb();
    res.json({
      workspaces: db.workspaces,
      b2b_requests: db.b2b_requests,
      b2b_packs: getCatalogPacks(db),
      vendor_settings: getVendorSettings(db),
      vendor_billing_docs: getVendorBillingDocs(db),
      vendor_accounts: db.vendor_accounts,
      deleted_workspace_ids: db.deleted_workspace_ids || [],
      deleted_request_ids: db.deleted_request_ids || [],
      deleted_billing_doc_ids: db.deleted_billing_doc_ids || [],
    });
  });

  app.post('/api/sync/hydrate', (req, res) => {
    const body = (req.body || {}) as {
      workspaces?: WorkspaceData[];
      b2b_requests?: B2BDeploymentRequest[];
      b2b_packs?: B2BPackCatalogItem[];
      vendor_settings?: VendorSettings;
      vendor_billing_docs?: VendorBillingDoc[];
      vendor_accounts?: VendorAccount[];
      deleted_workspace_ids?: string[];
      deleted_request_ids?: string[];
      deleted_billing_doc_ids?: string[];
      has_vendor_snapshot?: boolean;
      updated_at?: string;
    };
    const result = hydrateDatabaseSnapshot(body);
    res.json({ ok: true, ...result });
  });

  // ---------------- VITE OR STATIC SERVING ----------------
  app.get('/', (req, res) => {
    const qs = new URLSearchParams(req.query as Record<string, string>);
    if (qs.get('portal') === 'vendor') {
      qs.delete('portal');
      const suffix = qs.toString();
      res.redirect(302, suffix ? `/vendor?${suffix}` : '/vendor');
      return;
    }
    if (qs.get('portal') === 'offres' || qs.get('portal') === 'pro') {
      const target = qs.get('portal') === 'pro' ? '/pro' : '/offres';
      qs.delete('portal');
      const suffix = qs.toString();
      res.redirect(302, suffix ? `${target}?${suffix}` : target);
      return;
    }
    const suffix = qs.toString();
    res.redirect(302, suffix ? `/erp?${suffix}` : '/erp');
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res) => {
      const indexPath = path.join(distDir, 'index.html');
      res.setHeader('Cache-Control', 'no-cache');
      const isVendor =
        req.path === '/vendor' ||
        req.path.startsWith('/vendor/') ||
        req.query.portal === 'vendor';
      const isOffers =
        req.path === '/offres' ||
        req.path.startsWith('/offres/') ||
        req.path === '/pro' ||
        req.path.startsWith('/pro/') ||
        req.path === '/abonnement' ||
        req.path.startsWith('/abonnement/') ||
        req.path === '/commercial' ||
        req.path.startsWith('/commercial/') ||
        req.query.portal === 'offres' ||
        req.query.portal === 'pro';

      if (!isVendor && !isOffers) {
        res.sendFile(indexPath);
        return;
      }
      try {
        const rawHtml = fs.readFileSync(indexPath, 'utf-8');
        if (isOffers) {
          const offersHtml = rawHtml
            .replace(
              /<title>[^<]*<\/title>/,
              '<title>FRET MANAGER — Offres & Abonnements Gestion Transport & Flotte</title>',
            )
            .replace(
              /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
              '<meta name="description" content="Déployez votre plateforme de gestion transport, flotte, GPS, paie et facturation en 72h. Essai gratuit 14 jours et packs clé en main pour sociétés et transporteurs." />',
            )
            .replace(
              /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
              '<meta property="og:title" content="FRET MANAGER — Offres & Abonnements Transport B2B" />',
            )
            .replace(
              /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
              '<meta property="og:description" content="Déployez votre plateforme de gestion transport, flotte, GPS, paie et facturation en 72h. Essai gratuit 14 jours ou demande de devis personnalisé." />',
            );
          res.type('html').send(offersHtml);
          return;
        }
        const html = rawHtml
          .replace(/href="\/manifest\.webmanifest"/g, 'href="/vendor.webmanifest"')
          .replace(
            /<title>[^<]*<\/title>/,
            '<title>FRET MANAGER — Gestion Compte Client Abonnés</title>',
          )
          .replace(
            /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
            '<meta name="description" content="Portail éditeur indépendant : gestion des comptes clients abonnés, essais gratuits 14 jours, packs B2B et rentabilité SaaS." />',
          )
          .replace(
            /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
            '<meta property="og:title" content="FRET MANAGER — Gestion Compte Client Abonnés" />',
          )
          .replace(
            /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
            '<meta property="og:description" content="Portail éditeur indépendant : gestion des comptes clients abonnés, essais gratuits 14 jours, packs B2B et rentabilité SaaS." />',
          )
          .replace(
            /<meta name="theme-color" content="[^"]*"\s*\/?>/,
            '<meta name="theme-color" content="#0f2438" />',
          )
          .replace(
            /<meta name="apple-mobile-web-app-title" content="[^"]*"\s*\/?>/,
            '<meta name="apple-mobile-web-app-title" content="FretÉditeur" />',
          )
          .replace(/href="\/apple-touch-icon\.png"/g, 'href="/vendor-apple-touch-icon.png"')
          .replace(/href="\/icon\.svg"/g, 'href="/vendor-icon.svg"');
        res.type('html').send(html);
      } catch {
        res.sendFile(indexPath);
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`FRET MANAGER server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
