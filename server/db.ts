import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  B2BDeploymentRequest,
  B2BPackCatalogItem,
  B2BPackId,
  Currency,
  PublicProfile,
  Role,
  VendorAccount,
  VendorBillingDoc,
  VendorSettings,
  WorkspaceData,
  WorkspaceUser,
} from '../src/types.ts';
import {
  B2B_PACKS,
  createDefaultLicense,
  createDefaultVendorAccounts,
  createDemoWorkspace,
  createInitialB2BRequests,
  createSampleB2BWorkspaces,
  hashPassword,
} from './seed.ts';

interface DatabaseFile {
  workspaces: WorkspaceData[];
  b2b_requests: B2BDeploymentRequest[];
  vendor_accounts: VendorAccount[];
  vendor_settings?: VendorSettings;
  vendor_billing_docs?: VendorBillingDoc[];
  b2b_packs?: B2BPackCatalogItem[];
  deleted_workspace_ids?: string[];
  deleted_request_ids?: string[];
  deleted_billing_doc_ids?: string[];
  updated_at?: string;
  boot_seeded?: boolean;
}

export function createDefaultVendorSettings(): VendorSettings {
  return {
    company_name: 'FRET MANAGER B2B',
    legal_form: 'SARL',
    activity: 'Édition logicielle & Solutions Transport / Logistique',
    ice: '',
    if_number: '',
    rc: '',
    patente: '',
    bank: '',
    rib: '',
    address: '',
    city: 'Casablanca',
    phone: '',
    email: 'editeur@fretmanager.ma',
    website: '',
    logo_url: '',
    quote_prefix: 'DEV-B2B',
    invoice_prefix: 'FAC-B2B',
    default_tax_rate: 20,
    payment_terms: 'Validité du devis : 30 jours. Règlement par virement bancaire à la commande.',
    updated_at: '',
  };
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const FIREBASE_CFG_PATH = path.resolve(process.cwd(), 'firebase-applet-config.json');

function ensureDirs(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function getSessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    if (fs.existsSync(FIREBASE_CFG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(FIREBASE_CFG_PATH, 'utf8')) as {
        projectId?: string;
        firestoreDatabaseId?: string;
      };
      if (cfg.projectId && cfg.firestoreDatabaseId) {
        return crypto
          .createHash('sha256')
          .update(`fret_manager:${cfg.projectId}:${cfg.firestoreDatabaseId}:session_v1`)
          .digest('hex');
      }
    }
  } catch {
    // fallback below
  }
  return crypto.createHash('sha256').update('fret_manager:default_persistent_session_v1').digest('hex');
}

const SESSION_SECRET = getSessionSecret();

let cachedDb: DatabaseFile | null = null;

export function loadDb(): DatabaseFile {
  if (cachedDb) return cachedDb;
  ensureDirs();
  if (!fs.existsSync(DB_PATH)) {
    const initial: DatabaseFile = {
      workspaces: [createDemoWorkspace(), ...createSampleB2BWorkspaces()],
      b2b_requests: createInitialB2BRequests(),
      vendor_accounts: createDefaultVendorAccounts(),
      b2b_packs: structuredClone(B2B_PACKS),
      deleted_workspace_ids: [],
      deleted_request_ids: [],
      updated_at: '',
      boot_seeded: true,
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), 'utf8');
    cachedDb = initial;
    return cachedDb;
  }
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DatabaseFile>;
    if (!parsed.workspaces || !Array.isArray(parsed.workspaces)) {
      cachedDb = {
        workspaces: [createDemoWorkspace(), ...createSampleB2BWorkspaces()],
        b2b_requests: createInitialB2BRequests(),
        vendor_accounts: createDefaultVendorAccounts(),
        b2b_packs: structuredClone(B2B_PACKS),
        deleted_workspace_ids: [],
        deleted_request_ids: [],
        updated_at: '',
        boot_seeded: true,
      };
      saveDb(false);
    } else {
      let dirty = false;
      for (const ws of parsed.workspaces) {
        if (!ws.b2b_license) {
          ws.b2b_license = createDefaultLicense(ws.code === 'DEMO' ? 'demo_gratuit' : 'pack_essentiel', 'MAD', 'essai_gratuit');
          dirty = true;
        }
      }
      const reqs = Array.isArray(parsed.b2b_requests) ? parsed.b2b_requests : createInitialB2BRequests();
      if (!Array.isArray(parsed.b2b_requests)) dirty = true;

      let vendors = Array.isArray(parsed.vendor_accounts) ? parsed.vendor_accounts : [];
      if (!Array.isArray(parsed.vendor_accounts)) {
        vendors = createDefaultVendorAccounts();
        for (const sampleWs of createSampleB2BWorkspaces()) {
          if (!parsed.workspaces.some((w) => w.code === sampleWs.code)) {
            parsed.workspaces.push(sampleWs);
          }
        }
        dirty = true;
      }

      const packs =
        Array.isArray(parsed.b2b_packs) && parsed.b2b_packs.length > 0
          ? parsed.b2b_packs
          : structuredClone(B2B_PACKS);
      if (!Array.isArray(parsed.b2b_packs) || parsed.b2b_packs.length === 0) {
        dirty = true;
      }

      const deletedIds = Array.isArray(parsed.deleted_workspace_ids)
        ? parsed.deleted_workspace_ids.filter((id): id is string => typeof id === 'string')
        : [];
      const deletedReqIds = Array.isArray(parsed.deleted_request_ids)
        ? parsed.deleted_request_ids.filter((id): id is string => typeof id === 'string')
        : [];
      const deletedBillingIds = Array.isArray(parsed.deleted_billing_doc_ids)
        ? parsed.deleted_billing_doc_ids.filter((id): id is string => typeof id === 'string')
        : [];

      const vendorSettings =
        parsed.vendor_settings && typeof parsed.vendor_settings === 'object'
          ? { ...createDefaultVendorSettings(), ...parsed.vendor_settings }
          : createDefaultVendorSettings();

      const vendorBillingDocs = Array.isArray(parsed.vendor_billing_docs)
        ? parsed.vendor_billing_docs
        : [];

      cachedDb = {
        workspaces: parsed.workspaces,
        b2b_requests: reqs,
        vendor_accounts: vendors,
        vendor_settings: vendorSettings,
        vendor_billing_docs: vendorBillingDocs,
        b2b_packs: packs,
        deleted_workspace_ids: deletedIds,
        deleted_request_ids: deletedReqIds,
        deleted_billing_doc_ids: deletedBillingIds,
        updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : '',
        boot_seeded: parsed.boot_seeded ?? !parsed.updated_at,
      };
      if (dirty) saveDb(false);
    }
  } catch {
    cachedDb = {
      workspaces: [createDemoWorkspace(), ...createSampleB2BWorkspaces()],
      b2b_requests: createInitialB2BRequests(),
      vendor_accounts: createDefaultVendorAccounts(),
      vendor_settings: createDefaultVendorSettings(),
      vendor_billing_docs: [],
      b2b_packs: structuredClone(B2B_PACKS),
      deleted_workspace_ids: [],
      deleted_request_ids: [],
      deleted_billing_doc_ids: [],
      updated_at: '',
      boot_seeded: true,
    };
    saveDb(false);
  }
  return cachedDb;
}

function workspaceActivityScore(ws: WorkspaceData): number {
  return (
    ws.users.length * 10 +
    ws.vehicles.length +
    ws.drivers.length +
    ws.clients.length +
    ws.trips.length * 2 +
    ws.expenses.length +
    ws.invoices.length * 2 +
    ws.audit_logs.length
  );
}

function parseIsoTime(val?: string): number {
  if (!val) return 0;
  const ms = Date.parse(val);
  return Number.isNaN(ms) ? 0 : ms;
}

export function hydrateDatabaseSnapshot(payload: {
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
}): { restored_workspaces: number; restored_requests: number; restored_packs: boolean } {
  const db = loadDb();
  const isFreshBootSeed = db.boot_seeded === true || !db.updated_at;
  let restoredWorkspaces = 0;
  let restoredRequests = 0;
  let restoredPacks = false;
  let dirty = false;

  if (Array.isArray(payload.deleted_workspace_ids) && payload.deleted_workspace_ids.length > 0) {
    const existingSet = new Set(db.deleted_workspace_ids || []);
    const currentDemo = db.workspaces.find((w) => w.id === 'ws_demo' || w.code.toUpperCase() === 'DEMO');
    const payloadUpdatedMs = parseIsoTime(payload.updated_at);
    for (const delId of payload.deleted_workspace_ids) {
      if (typeof delId !== 'string') continue;
      if (
        delId === 'ws_demo' &&
        currentDemo &&
        parseIsoTime(currentDemo.updated_at) >= payloadUpdatedMs
      ) {
        continue;
      }
      if (!existingSet.has(delId)) {
        existingSet.add(delId);
        dirty = true;
      }
    }
    db.deleted_workspace_ids = [...existingSet];
    const beforeLen = db.workspaces.length;
    db.workspaces = db.workspaces.filter((w) => !existingSet.has(w.id));
    if (db.workspaces.length !== beforeLen) dirty = true;
  }

  if (Array.isArray(payload.deleted_request_ids) && payload.deleted_request_ids.length > 0) {
    const existingReqSet = new Set(db.deleted_request_ids || []);
    for (const delId of payload.deleted_request_ids) {
      if (typeof delId === 'string' && !existingReqSet.has(delId)) {
        existingReqSet.add(delId);
        dirty = true;
      }
    }
    db.deleted_request_ids = [...existingReqSet];
    const beforeReqLen = db.b2b_requests.length;
    db.b2b_requests = db.b2b_requests.filter((r) => !existingReqSet.has(r.id));
    if (db.b2b_requests.length !== beforeReqLen) dirty = true;
  }

  const deletedSet = new Set(db.deleted_workspace_ids || []);
  const deletedReqSet = new Set(db.deleted_request_ids || []);

  if (Array.isArray(payload.workspaces)) {
    for (const incomingWs of payload.workspaces) {
      if (!incomingWs || !incomingWs.id || !incomingWs.code || !Array.isArray(incomingWs.users)) {
        continue;
      }
      if (deletedSet.has(incomingWs.id)) continue;

      const idx = db.workspaces.findIndex(
        (w) => w.id === incomingWs.id || w.code.toUpperCase() === incomingWs.code.toUpperCase(),
      );
      if (idx === -1) {
        db.workspaces.push(incomingWs);
        restoredWorkspaces += 1;
        dirty = true;
      } else {
        const current = db.workspaces[idx];
        const incTime = parseIsoTime(incomingWs.updated_at);
        const curTime = parseIsoTime(current.updated_at);
        const incScore = workspaceActivityScore(incomingWs);
        const curScore = workspaceActivityScore(current);
        const incAuditTime = incomingWs.audit_logs?.[0]?.created_at
          ? parseIsoTime(incomingWs.audit_logs[0].created_at)
          : 0;
        const curAuditTime = current.audit_logs?.[0]?.created_at
          ? parseIsoTime(current.audit_logs[0].created_at)
          : 0;

        const shouldRestore = isFreshBootSeed
          ? incTime > 0 || incScore !== curScore || incAuditTime >= curAuditTime
          : incTime > curTime ||
            (incTime === curTime && (incScore > curScore || (incScore === curScore && incAuditTime > curAuditTime)));

        if (shouldRestore) {
          db.workspaces[idx] = incomingWs;
          restoredWorkspaces += 1;
          dirty = true;
        }
      }
    }
  }

  if (Array.isArray(payload.b2b_requests)) {
    for (const reqItem of payload.b2b_requests) {
      if (!reqItem || !reqItem.id || deletedReqSet.has(reqItem.id)) continue;
      const existingIdx = db.b2b_requests.findIndex((r) => r.id === reqItem.id);
      if (existingIdx === -1) {
        db.b2b_requests.unshift(reqItem);
        restoredRequests += 1;
        dirty = true;
      } else {
        const curReq = db.b2b_requests[existingIdx];
        const incReqTime = parseIsoTime(reqItem.updated_at || reqItem.created_at);
        const curReqTime = parseIsoTime(curReq.updated_at || curReq.created_at);
        if (isFreshBootSeed || incReqTime > curReqTime) {
          db.b2b_requests[existingIdx] = reqItem;
          restoredRequests += 1;
          dirty = true;
        }
      }
    }
  }

  if (Array.isArray(payload.b2b_packs) && payload.b2b_packs.length > 0) {
    const currentPacks = getCatalogPacks(db);
    const currentCustomized = currentPacks.some((p) => p.customized);
    const incomingCustomized =
      payload.b2b_packs.some((p) => p.customized) || payload.b2b_packs.length !== B2B_PACKS.length;
    if ((incomingCustomized && (!currentCustomized || isFreshBootSeed)) || (isFreshBootSeed && payload.has_vendor_snapshot)) {
      db.b2b_packs = payload.b2b_packs;
      restoredPacks = true;
      dirty = true;
    }
  }

  if (Array.isArray(payload.deleted_billing_doc_ids) && payload.deleted_billing_doc_ids.length > 0) {
    const existingBillingDelSet = new Set(db.deleted_billing_doc_ids || []);
    for (const delId of payload.deleted_billing_doc_ids) {
      if (typeof delId === 'string' && !existingBillingDelSet.has(delId)) {
        existingBillingDelSet.add(delId);
        dirty = true;
      }
    }
    db.deleted_billing_doc_ids = [...existingBillingDelSet];
    const docs = getVendorBillingDocs(db);
    const filteredDocs = docs.filter((d) => !existingBillingDelSet.has(d.id));
    if (filteredDocs.length !== docs.length) {
      db.vendor_billing_docs = filteredDocs;
      dirty = true;
    }
  }

  const deletedBillingSet = new Set(db.deleted_billing_doc_ids || []);

  if (payload.vendor_settings && typeof payload.vendor_settings === 'object') {
    const curSettings = getVendorSettings(db);
    const incTime = parseIsoTime(payload.vendor_settings.updated_at);
    const curTime = parseIsoTime(curSettings.updated_at);
    if ((isFreshBootSeed && incTime > 0) || incTime > curTime) {
      db.vendor_settings = { ...createDefaultVendorSettings(), ...payload.vendor_settings };
      dirty = true;
    }
  }

  if (Array.isArray(payload.vendor_billing_docs)) {
    const docs = getVendorBillingDocs(db);
    for (const incDoc of payload.vendor_billing_docs) {
      if (!incDoc || !incDoc.id || deletedBillingSet.has(incDoc.id)) continue;
      const existingIdx = docs.findIndex((d) => d.id === incDoc.id);
      if (existingIdx === -1) {
        docs.unshift(incDoc);
        dirty = true;
      } else {
        const curDoc = docs[existingIdx];
        const incDocTime = parseIsoTime(incDoc.updated_at || incDoc.created_at);
        const curDocTime = parseIsoTime(curDoc.updated_at || curDoc.created_at);
        if (isFreshBootSeed || incDocTime > curDocTime) {
          docs[existingIdx] = incDoc;
          dirty = true;
        }
      }
    }
    db.vendor_billing_docs = docs;
  }

  if (Array.isArray(payload.vendor_accounts)) {
    for (const incAcc of payload.vendor_accounts) {
      if (!incAcc || !incAcc.id || !incAcc.email || !incAcc.password_hash) continue;
      const idx = db.vendor_accounts.findIndex(
        (v) => v.id === incAcc.id || v.email.toLowerCase() === incAcc.email.toLowerCase(),
      );
      if (idx === -1) {
        db.vendor_accounts.push(incAcc);
        dirty = true;
      } else {
        const curAcc = db.vendor_accounts[idx];
        const incAccTime = parseIsoTime(incAcc.updated_at);
        const curAccTime = parseIsoTime(curAcc.updated_at);
        if ((isFreshBootSeed && incAccTime > 0) || incAccTime > curAccTime) {
          db.vendor_accounts[idx] = { ...curAcc, ...incAcc };
          dirty = true;
        }
      }
    }
  }

  if (dirty) {
    if (payload.updated_at) {
      db.updated_at = payload.updated_at;
    }
    db.boot_seeded = false;
    saveDb(false);
  }
  return {
    restored_workspaces: restoredWorkspaces,
    restored_requests: restoredRequests,
    restored_packs: restoredPacks,
  };
}

export function getCatalogPacks(dbArg?: DatabaseFile): B2BPackCatalogItem[] {
  const db = dbArg ?? loadDb();
  if (!Array.isArray(db.b2b_packs) || db.b2b_packs.length === 0) {
    db.b2b_packs = structuredClone(B2B_PACKS);
    saveDb(false);
  }
  return db.b2b_packs;
}

export function getVendorSettings(dbArg?: DatabaseFile): VendorSettings {
  const db = dbArg ?? loadDb();
  if (!db.vendor_settings || typeof db.vendor_settings !== 'object') {
    db.vendor_settings = createDefaultVendorSettings();
    saveDb(false);
  }
  return db.vendor_settings;
}

export function getVendorBillingDocs(dbArg?: DatabaseFile): VendorBillingDoc[] {
  const db = dbArg ?? loadDb();
  if (!Array.isArray(db.vendor_billing_docs)) {
    db.vendor_billing_docs = [];
    saveDb(false);
  }
  return db.vendor_billing_docs;
}

export function saveDb(markUserMutation = true): void {
  ensureDirs();
  if (!cachedDb) return;
  if (markUserMutation) {
    cachedDb.boot_seeded = false;
    cachedDb.updated_at = new Date().toISOString();
  }
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(cachedDb, null, 2), 'utf8');
  fs.renameSync(tmpPath, DB_PATH);
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
}

export function signToken(userId: string, workspaceId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, wid: workspaceId, exp: Date.now() + 1000 * 60 * 60 * 24 * 14 }),
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): { uid: string; wid: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      uid: string;
      wid: string;
      exp: number;
    };
    if (!parsed.uid || !parsed.wid || Date.now() > parsed.exp) return null;
    return { uid: parsed.uid, wid: parsed.wid };
  } catch {
    return null;
  }
}

export function signVendorToken(vendorId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ vid: vendorId, kind: 'vendor', exp: Date.now() + 1000 * 60 * 60 * 24 * 14 }),
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyVendorToken(token: string): { vid: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      vid?: string;
      kind?: string;
      exp?: number;
    };
    if (parsed.kind !== 'vendor' || !parsed.vid || !parsed.exp || Date.now() > parsed.exp) return null;
    return { vid: parsed.vid };
  } catch {
    return null;
  }
}

export function findWorkspaceByCode(code: string): WorkspaceData | undefined {
  const db = loadDb();
  const normalized = code.trim().toUpperCase();
  return db.workspaces.find((w) => w.code.toUpperCase() === normalized);
}

export function findWorkspaceById(id: string): WorkspaceData | undefined {
  const db = loadDb();
  return db.workspaces.find((w) => w.id === id);
}

export function ensureDemoWorkspaceReady(): WorkspaceData {
  const db = loadDb();
  const existing = db.workspaces.find(
    (w) => w.code.toUpperCase() === 'DEMO' || w.id === 'ws_demo',
  );
  const todayIso = new Date().toISOString().slice(0, 10);
  const extendedValidUntil = new Date(Date.now() + 14 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  if (!existing) {
    const freshDemo = createDemoWorkspace();
    freshDemo.updated_at = new Date().toISOString();
    db.workspaces.unshift(freshDemo);
    db.deleted_workspace_ids = (db.deleted_workspace_ids || []).filter((id) => id !== 'ws_demo');
    saveDb();
    return freshDemo;
  }

  let changed = false;
  if ((db.deleted_workspace_ids || []).includes(existing.id)) {
    db.deleted_workspace_ids = (db.deleted_workspace_ids || []).filter((id) => id !== existing.id);
    changed = true;
  }
  if (!existing.b2b_license) {
    existing.b2b_license = createDefaultLicense('demo_gratuit', 'MAD', 'essai_gratuit', getCatalogPacks(db));
    changed = true;
  } else if (existing.b2b_license.status === 'essai_gratuit' && existing.b2b_license.valid_until < todayIso) {
    existing.b2b_license.valid_until = extendedValidUntil;
    changed = true;
  }
  if (changed) {
    existing.updated_at = new Date().toISOString();
    saveDb();
  }
  return existing;
}

export function toPublicProfile(user: WorkspaceUser, ws: WorkspaceData): PublicProfile {
  return {
    id: user.id,
    workspace_id: ws.id,
    workspace_code: ws.code,
    workspace_name: ws.name,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    driver_id: user.driver_id,
    active: user.active,
    created_at: user.created_at,
  };
}

export function createEmptyWorkspace(
  companyName: string,
  adminEmail: string,
  adminPassword: string,
  adminName: string,
  options?: {
    pack?: B2BPackId;
    currency?: Currency;
    status?: 'essai_gratuit' | 'en_attente_activation' | 'actif' | 'suspendu';
  },
): { workspace: WorkspaceData; user: WorkspaceUser } {
  const db = loadDb();
  let code = '';
  for (let i = 0; i < 10; i++) {
    const candidate = `FRET-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!db.workspaces.some((w) => w.code === candidate)) {
      code = candidate;
      break;
    }
  }
  if (!code) code = `FRET-${Date.now().toString().slice(-5)}`;

  const wsId = newId('ws');
  const userId = newId('usr');
  const now = new Date().toISOString();

  const cMa = newId('cnt');
  const cFr = newId('cnt');
  const cEs = newId('cnt');

  const user: WorkspaceUser = {
    id: userId,
    workspace_id: wsId,
    email: adminEmail.trim().toLowerCase(),
    password_hash: hashPassword(adminPassword),
    full_name: adminName.trim(),
    role: 'admin',
    driver_id: null,
    active: true,
    created_at: now,
  };

  const workspace: WorkspaceData = {
    id: wsId,
    code,
    name: companyName.trim(),
    created_at: now,
    updated_at: now,
    b2b_license: createDefaultLicense(
      options?.pack || (options?.status === 'actif' ? 'pack_essentiel' : 'demo_gratuit'),
      options?.currency || 'MAD',
      options?.status || 'essai_gratuit',
      getCatalogPacks(db),
    ),
    users: [user],
    vehicles: [],
    drivers: [],
    clients: [],
    countries: [
      { id: cMa, name: 'Maroc', iso_code: 'MA', is_active: true },
      { id: cFr, name: 'France', iso_code: 'FR', is_active: true },
      { id: cEs, name: 'Espagne', iso_code: 'ES', is_active: true },
    ],
    cities: [
      { id: newId('cty'), name: 'Casablanca', country_id: cMa, is_active: true },
      { id: newId('cty'), name: 'Tanger Med', country_id: cMa, is_active: true },
      { id: newId('cty'), name: 'Agadir', country_id: cMa, is_active: true },
      { id: newId('cty'), name: 'Marrakech', country_id: cMa, is_active: true },
      { id: newId('cty'), name: 'Fès', country_id: cMa, is_active: true },
      { id: newId('cty'), name: 'Marseille', country_id: cFr, is_active: true },
      { id: newId('cty'), name: 'Madrid', country_id: cEs, is_active: true },
    ],
    trips: [],
    expenses: [],
    maintenance: [],
    documents: [],
    employees: [],
    payroll: [],
    payroll_allocations: [],
    client_proposals: [],
    audit_logs: [
      {
        id: newId('aud'),
        user_id: userId,
        user_name: user.full_name,
        action: 'CREATE_WORKSPACE',
        table_name: 'workspaces',
        record_id: wsId,
        details: { workspace_name: companyName.trim(), code },
        created_at: now,
      },
    ],
    company_settings: {
      id: 1,
      company_name: companyName.trim().toUpperCase(),
      activity: 'Transport & Logistique',
      phone: '',
      email: adminEmail.trim().toLowerCase(),
      address: '',
      city: '',
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
    invoice_settings: {
      id: 1,
      prefix: 'FAC',
      separator: '-',
      padding_length: 4,
      next_number: 1,
    },
    invoices: [],
    invoice_payments: [],
    gps_devices: [],
    gps_positions: [],
    gps_alerts: [],
    gps_trip_summaries: [],
    gps_geofences: [],
    gps_device_events: [],
  };

  db.workspaces.push(workspace);
  saveDb();
  return { workspace, user };
}

export function ensureDriverLinkForUser(ws: WorkspaceData, user: WorkspaceUser): boolean {
  if (user.role !== 'conducteur') return false;
  let changed = false;

  const normalizedEmail = user.email.trim().toLowerCase();
  const normalizedName = user.full_name.trim().toLowerCase();

  const currentDriver = user.driver_id
    ? ws.drivers.find((d) => d.id === user.driver_id)
    : undefined;

  const isDriverLinkedToOtherUser = (driverId: string) =>
    ws.users.some((u) => u.id !== user.id && u.driver_id === driverId);

  const driverHasReferences = (driverId: string) =>
    ws.trips.some((t) => t.driver_id === driverId) ||
    ws.documents.some((d) => d.driver_id === driverId) ||
    ws.client_proposals.some((p) => p.driver_id === driverId);

  // Heal auto-created empty duplicate drivers when a real matching driver exists
  if (currentDriver && !driverHasReferences(currentDriver.id)) {
    const betterMatch =
      ws.drivers.find(
        (d) =>
          d.id !== currentDriver.id &&
          !isDriverLinkedToOtherUser(d.id) &&
          d.email &&
          d.email.trim().toLowerCase() === normalizedEmail &&
          driverHasReferences(d.id),
      ) ||
      ws.drivers.find(
        (d) =>
          d.id !== currentDriver.id &&
          !isDriverLinkedToOtherUser(d.id) &&
          d.full_name.trim().toLowerCase() === normalizedName &&
          driverHasReferences(d.id),
      );

    if (betterMatch) {
      const oldId = currentDriver.id;
      user.driver_id = betterMatch.id;
      if (!betterMatch.email && normalizedEmail) {
        betterMatch.email = normalizedEmail;
      }
      ws.drivers = ws.drivers.filter((d) => d.id !== oldId);
      return true;
    }
  }

  if (!currentDriver) {
    const matched =
      ws.drivers.find(
        (d) =>
          !isDriverLinkedToOtherUser(d.id) &&
          d.email &&
          d.email.trim().toLowerCase() === normalizedEmail,
      ) ||
      ws.drivers.find(
        (d) =>
          !isDriverLinkedToOtherUser(d.id) &&
          d.full_name.trim().toLowerCase() === normalizedName,
      );

    if (matched) {
      user.driver_id = matched.id;
      if (!matched.email && normalizedEmail) {
        matched.email = normalizedEmail;
      }
      changed = true;
    } else {
      const newDriverId = newId('drv');
      ws.drivers.push({
        id: newDriverId,
        full_name: user.full_name.trim(),
        phone: null,
        email: normalizedEmail,
        license_number: null,
        status: 'actif',
        created_at: new Date().toISOString(),
      });
      user.driver_id = newDriverId;
      changed = true;
    }
  }

  return changed;
}

export function addUserToWorkspace(
  ws: WorkspaceData,
  params: {
    email: string;
    password: string;
    full_name: string;
    role: Role;
    driver_id?: string | null;
    active?: boolean;
  },
): WorkspaceUser {
  const email = params.email.trim().toLowerCase();
  if (ws.users.some((u) => u.email.toLowerCase() === email)) {
    throw new Error('Cet e-mail existe déjà dans cet espace de travail.');
  }

  const user: WorkspaceUser = {
    id: newId('usr'),
    workspace_id: ws.id,
    email,
    password_hash: hashPassword(params.password),
    full_name: params.full_name.trim(),
    role: params.role,
    driver_id: params.driver_id || null,
    active: params.active ?? true,
    created_at: new Date().toISOString(),
  };

  ws.users.push(user);
  ensureDriverLinkForUser(ws, user);
  ws.updated_at = new Date().toISOString();
  saveDb();
  return user;
}

export function addAuditLog(
  ws: WorkspaceData,
  user: WorkspaceUser,
  action: string,
  tableName: string,
  recordId: string,
  details: Record<string, unknown> = {},
): void {
  ws.audit_logs.unshift({
    id: newId('aud'),
    user_id: user.id,
    user_name: user.full_name,
    action,
    table_name: tableName,
    record_id: recordId,
    details,
    created_at: new Date().toISOString(),
  });
  if (ws.audit_logs.length > 500) {
    ws.audit_logs = ws.audit_logs.slice(0, 500);
  }
}

export function getUploadDir(workspaceId: string, tripId: string): string {
  const dir = path.join(UPLOADS_DIR, workspaceId, tripId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveUploadPath(relativePath: string): string {
  const safeRel = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
  return path.join(UPLOADS_DIR, safeRel);
}
