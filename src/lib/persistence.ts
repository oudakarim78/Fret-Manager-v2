import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type FieldValue,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import type {
  B2BDeploymentRequest,
  B2BPackCatalogItem,
  B2BLicense,
  OnboardingChecklistItem,
  VendorAccount,
  VendorBillingDoc,
  VendorBillingDocItem,
  VendorSettings,
  WorkspaceData,
} from '../types.ts';
import {
  OperationType,
  auth,
  db,
  handleFirestoreError,
  isFirebaseBootstrappedAdmin,
  type User,
} from '../firebase.ts';
import { api, getStoredToken, getVendorToken, vendorApi } from './api.ts';

const IDB_NAME = 'fret_manager_persistence';
const IDB_VERSION = 1;
const IDB_STORE = 'snapshots';
const IDB_KEY = 'main';

export interface LocalPersistenceSnapshot {
  workspaces: WorkspaceData[];
  b2b_requests: B2BDeploymentRequest[];
  b2b_packs: B2BPackCatalogItem[];
  vendor_settings?: VendorSettings;
  vendor_billing_docs?: VendorBillingDoc[];
  vendor_accounts?: VendorAccount[];
  deleted_workspace_ids: string[];
  deleted_request_ids: string[];
  deleted_billing_doc_ids?: string[];
  has_vendor_snapshot?: boolean;
  updated_at: string;
}

const EMPTY_SNAPSHOT: LocalPersistenceSnapshot = {
  workspaces: [],
  b2b_requests: [],
  b2b_packs: [],
  vendor_billing_docs: [],
  vendor_accounts: [],
  deleted_workspace_ids: [],
  deleted_request_ids: [],
  deleted_billing_doc_ids: [],
  has_vendor_snapshot: false,
  updated_at: '',
};

function parseIsoMs(val?: string): number {
  if (!val) return 0;
  const ms = Date.parse(val);
  return Number.isNaN(ms) ? 0 : ms;
}

function firestoreTimestampToIso(val: unknown): string | undefined {
  if (!val) return undefined;
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as { toDate: unknown }).toDate === 'function') {
    try {
      return (val as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, ms);
    promise
      .then((val) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(val);
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      });
  });
}

function openPersistenceDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return withTimeout(
    new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
          const database = req.result;
          if (!database.objectStoreNames.contains(IDB_STORE)) {
            database.createObjectStore(IDB_STORE);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    }),
    1500,
    null,
  );
}

export async function loadLocalSnapshot(): Promise<LocalPersistenceSnapshot> {
  const idb = await openPersistenceDb();
  if (!idb) return { ...EMPTY_SNAPSHOT };
  return withTimeout(
    new Promise<LocalPersistenceSnapshot>((resolve) => {
      try {
        const tx = idb.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const req = store.get(IDB_KEY);
        req.onsuccess = () => {
          const val = req.result as Partial<LocalPersistenceSnapshot> | undefined;
          resolve({
            workspaces: Array.isArray(val?.workspaces) ? val.workspaces : [],
            b2b_requests: Array.isArray(val?.b2b_requests) ? val.b2b_requests : [],
            b2b_packs: Array.isArray(val?.b2b_packs) ? val.b2b_packs : [],
            vendor_settings:
              val?.vendor_settings && typeof val.vendor_settings === 'object'
                ? val.vendor_settings
                : undefined,
            vendor_billing_docs: Array.isArray(val?.vendor_billing_docs)
              ? val.vendor_billing_docs
              : [],
            vendor_accounts: Array.isArray(val?.vendor_accounts) ? val.vendor_accounts : [],
            deleted_workspace_ids: Array.isArray(val?.deleted_workspace_ids)
              ? val.deleted_workspace_ids
              : [],
            deleted_request_ids: Array.isArray(val?.deleted_request_ids)
              ? val.deleted_request_ids
              : [],
            deleted_billing_doc_ids: Array.isArray(val?.deleted_billing_doc_ids)
              ? val.deleted_billing_doc_ids
              : [],
            has_vendor_snapshot: Boolean(val?.has_vendor_snapshot),
            updated_at: typeof val?.updated_at === 'string' ? val.updated_at : '',
          });
        };
        req.onerror = () => resolve({ ...EMPTY_SNAPSHOT });
        tx.onabort = () => resolve({ ...EMPTY_SNAPSHOT });
      } catch {
        resolve({ ...EMPTY_SNAPSHOT });
      }
    }),
    1500,
    { ...EMPTY_SNAPSHOT },
  );
}

export async function saveLocalSnapshot(snapshot: LocalPersistenceSnapshot): Promise<void> {
  const idb = await openPersistenceDb();
  if (!idb) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(snapshot, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function mergeIntoLocalSnapshot(patch: {
  workspaces?: WorkspaceData[];
  replaceWorkspaces?: boolean;
  b2b_requests?: B2BDeploymentRequest[];
  replaceRequests?: boolean;
  b2b_packs?: B2BPackCatalogItem[];
  vendor_settings?: VendorSettings;
  vendor_billing_docs?: VendorBillingDoc[];
  replaceBillingDocs?: boolean;
  vendor_accounts?: VendorAccount[];
  deleted_workspace_ids?: string[];
  deleted_request_ids?: string[];
  deleted_billing_doc_ids?: string[];
  has_vendor_snapshot?: boolean;
  forceOverwrite?: boolean;
}): Promise<LocalPersistenceSnapshot> {
  const current = await loadLocalSnapshot();
  const deletedSet = new Set([
    ...current.deleted_workspace_ids,
    ...(patch.deleted_workspace_ids || []),
  ]);
  const deletedReqSet = new Set([
    ...current.deleted_request_ids,
    ...(patch.deleted_request_ids || []),
  ]);
  const deletedBillingSet = new Set([
    ...(current.deleted_billing_doc_ids || []),
    ...(patch.deleted_billing_doc_ids || []),
  ]);

  let nextWorkspaces = patch.replaceWorkspaces
    ? [...(patch.workspaces || [])]
    : [...current.workspaces];
  if (!patch.replaceWorkspaces && patch.workspaces) {
    for (const ws of patch.workspaces) {
      if (!ws?.id) continue;
      deletedSet.delete(ws.id);
      const idx = nextWorkspaces.findIndex((x) => x.id === ws.id);
      if (idx >= 0) {
        if (patch.forceOverwrite) {
          nextWorkspaces[idx] = ws;
        } else {
          const curTime = parseIsoMs(nextWorkspaces[idx].updated_at);
          const incTime = parseIsoMs(ws.updated_at);
          if (incTime >= curTime) {
            nextWorkspaces[idx] = ws;
          }
        }
      } else {
        nextWorkspaces.push(ws);
      }
    }
  }
  nextWorkspaces = nextWorkspaces.filter((w) => !deletedSet.has(w.id));

  let nextRequests = patch.replaceRequests
    ? [...(patch.b2b_requests || [])]
    : [...current.b2b_requests];
  if (!patch.replaceRequests && patch.b2b_requests) {
    for (const r of patch.b2b_requests) {
      if (!r?.id || deletedReqSet.has(r.id)) continue;
      const idx = nextRequests.findIndex((x) => x.id === r.id);
      if (idx >= 0) {
        if (patch.forceOverwrite) {
          nextRequests[idx] = r;
        } else {
          const curTime = parseIsoMs(nextRequests[idx].updated_at || nextRequests[idx].created_at);
          const incTime = parseIsoMs(r.updated_at || r.created_at);
          if (incTime >= curTime) {
            nextRequests[idx] = r;
          }
        }
      } else {
        nextRequests.unshift(r);
      }
    }
  }
  nextRequests = nextRequests.filter((r) => !deletedReqSet.has(r.id));

  const nextPacks =
    patch.b2b_packs && patch.b2b_packs.length > 0 ? patch.b2b_packs : current.b2b_packs;

  let nextVendorSettings = current.vendor_settings;
  if (patch.vendor_settings) {
    if (
      patch.forceOverwrite ||
      !nextVendorSettings ||
      parseIsoMs(patch.vendor_settings.updated_at) >= parseIsoMs(nextVendorSettings.updated_at)
    ) {
      nextVendorSettings = patch.vendor_settings;
    }
  }

  let nextBillingDocs = patch.replaceBillingDocs
    ? [...(patch.vendor_billing_docs || [])]
    : [...(current.vendor_billing_docs || [])];
  if (!patch.replaceBillingDocs && patch.vendor_billing_docs) {
    for (const docItem of patch.vendor_billing_docs) {
      if (!docItem?.id || deletedBillingSet.has(docItem.id)) continue;
      const idx = nextBillingDocs.findIndex((x) => x.id === docItem.id);
      if (idx >= 0) {
        if (
          patch.forceOverwrite ||
          parseIsoMs(docItem.updated_at || docItem.created_at) >=
            parseIsoMs(nextBillingDocs[idx].updated_at || nextBillingDocs[idx].created_at)
        ) {
          nextBillingDocs[idx] = docItem;
        }
      } else {
        nextBillingDocs.unshift(docItem);
      }
    }
  }
  nextBillingDocs = nextBillingDocs.filter((d) => !deletedBillingSet.has(d.id));

  const nextVendorAccounts = [...(current.vendor_accounts || [])];
  if (patch.vendor_accounts) {
    for (const acc of patch.vendor_accounts) {
      if (!acc?.id) continue;
      const idx = nextVendorAccounts.findIndex((x) => x.id === acc.id);
      if (idx >= 0) {
        if (
          patch.forceOverwrite ||
          parseIsoMs(acc.updated_at) >= parseIsoMs(nextVendorAccounts[idx].updated_at)
        ) {
          nextVendorAccounts[idx] = acc;
        }
      } else {
        nextVendorAccounts.push(acc);
      }
    }
  }

  const updated: LocalPersistenceSnapshot = {
    workspaces: nextWorkspaces,
    b2b_requests: nextRequests,
    b2b_packs: nextPacks,
    vendor_settings: nextVendorSettings,
    vendor_billing_docs: nextBillingDocs,
    vendor_accounts: nextVendorAccounts,
    deleted_workspace_ids: [...deletedSet],
    deleted_request_ids: [...deletedReqSet],
    deleted_billing_doc_ids: [...deletedBillingSet],
    has_vendor_snapshot: Boolean(current.has_vendor_snapshot || patch.has_vendor_snapshot),
    updated_at: new Date().toISOString(),
  };
  await saveLocalSnapshot(updated);
  return updated;
}

export async function hydrateServerFromSnapshot(
  snapshot: Partial<LocalPersistenceSnapshot>,
): Promise<void> {
  if (
    !snapshot.workspaces?.length &&
    !snapshot.b2b_requests?.length &&
    !snapshot.b2b_packs?.length &&
    !snapshot.vendor_settings &&
    !snapshot.vendor_billing_docs?.length &&
    !snapshot.vendor_accounts?.length &&
    !snapshot.deleted_workspace_ids?.length &&
    !snapshot.deleted_request_ids?.length &&
    !snapshot.deleted_billing_doc_ids?.length
  ) {
    return;
  }
  await withTimeout(
    api('/api/sync/hydrate', {
      method: 'POST',
      body: JSON.stringify(snapshot),
    }).then(() => undefined),
    3500,
    undefined,
  );
}

export async function hydrateServerOnBoot(): Promise<LocalPersistenceSnapshot> {
  const local = await loadLocalSnapshot();
  await hydrateServerFromSnapshot(local).catch(() => {
    // Ignore transient network errors during boot
  });
  return local;
}

// ---------------- FIRESTORE DATA NORMALIZATION ----------------

function sanitizeId(raw: string): string {
  const clean = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  return clean.slice(0, 120) || 'item';
}

function encodeArrayElementForFirestore(el: unknown): unknown {
  if (el === undefined) return null;
  if (Array.isArray(el)) {
    // Firestore forbids nested arrays (Array<Array<...>>). Wrap nested arrays as native Maps.
    return {
      __fsNestedArray: true,
      items: el.map((inner) => encodeArrayElementForFirestore(inner)),
    };
  }
  return stripUndefined(el);
}

function stripUndefined<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => encodeArrayElementForFirestore(v)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      if (k === 'file_data' && typeof v === 'string' && v.length > 180000) {
        out[k] = '';
        continue;
      }
      if (k === 'logo_url' && typeof v === 'string' && v.length > 180000) {
        out[k] = '';
        continue;
      }
      out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

function decodeFromFirestore<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => decodeFromFirestore(v)) as unknown as T;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj.__fsNestedArray === true && Array.isArray(obj.items)) {
      return obj.items.map((inner) => decodeFromFirestore(inner)) as unknown as T;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = decodeFromFirestore(v);
    }
    return out as T;
  }
  return value;
}

const RECORD_COLLECTIONS: Array<{
  field: keyof WorkspaceData;
  recordType: string;
}> = [
  { field: 'users', recordType: 'user' },
  { field: 'vehicles', recordType: 'vehicle' },
  { field: 'drivers', recordType: 'driver' },
  { field: 'clients', recordType: 'client' },
  { field: 'countries', recordType: 'country' },
  { field: 'cities', recordType: 'city' },
  { field: 'trips', recordType: 'trip' },
  { field: 'expenses', recordType: 'expense' },
  { field: 'maintenance', recordType: 'maintenance' },
  { field: 'documents', recordType: 'document' },
  { field: 'employees', recordType: 'employee' },
  { field: 'payroll', recordType: 'payroll' },
  { field: 'payroll_allocations', recordType: 'payroll_allocation' },
  { field: 'client_proposals', recordType: 'client_proposal' },
  { field: 'invoices', recordType: 'invoice' },
  { field: 'invoice_payments', recordType: 'invoice_payment' },
  { field: 'gps_devices', recordType: 'gps_device' },
  { field: 'gps_positions', recordType: 'gps_position' },
  { field: 'gps_alerts', recordType: 'gps_alert' },
  { field: 'gps_trip_summaries', recordType: 'gps_trip_summary' },
  { field: 'gps_geofences', recordType: 'gps_geofence' },
  { field: 'gps_device_events', recordType: 'gps_device_event' },
  { field: 'audit_logs', recordType: 'audit_log' },
];

export async function ensureFirebaseUserRecord(user: User): Promise<void> {
  if (!user.emailVerified) return;
  const userPath = `users/${user.uid}`;
  const privatePath = `users/${user.uid}/private/profile`;
  const userRef = doc(db, 'users', user.uid);
  const privRef = doc(db, 'users', user.uid, 'private', 'profile');

  try {
    const existingSnap = await getDoc(userRef);
    if (!existingSnap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        displayName: (user.displayName || user.email || 'Utilisateur').slice(0, 120),
        role: isFirebaseBootstrappedAdmin(user) ? 'admin' : 'owner',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const data = existingSnap.data();
      await setDoc(userRef, {
        uid: data.uid,
        displayName: (user.displayName || data.displayName || 'Utilisateur').slice(0, 120),
        role: data.role || 'owner',
        createdAt: data.createdAt,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, userPath);
  }

  try {
    await setDoc(privRef, {
      email: (user.email || '').slice(0, 160),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, privatePath);
  }
}

export async function pushWorkspaceToFirestore(
  ws: WorkspaceData,
  user: User,
): Promise<void> {
  if (!user.emailVerified) return;
  const wsId = sanitizeId(ws.id);
  const wsPath = `workspaces/${wsId}`;
  const wsRef = doc(db, 'workspaces', wsId);

  let ownerUid = user.uid;
  let createdAtValue: unknown = serverTimestamp();

  try {
    const existingSnap = await getDoc(wsRef);
    if (existingSnap.exists()) {
      const existingData = existingSnap.data();
      ownerUid = existingData.ownerUid || user.uid;
      createdAtValue = existingData.createdAt || serverTimestamp();
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, wsPath);
  }

  const lic = ws.b2b_license;
  const wsUpdatedAt = ws.updated_at || new Date().toISOString();
  const wsDocPayload = {
    id: wsId,
    ownerUid,
    code: String(ws.code || 'FRET').slice(0, 32),
    name: String(ws.name || 'Entreprise').slice(0, 160),
    pack: String(lic?.pack || 'demo_gratuit').slice(0, 64),
    licenseStatus: lic?.status || 'essai_gratuit',
    validUntil: String(lic?.valid_until || new Date().toISOString().slice(0, 10)).slice(0, 32),
    currency: lic?.currency === 'EUR' ? 'EUR' : 'MAD',
    setupFee: Math.max(0, Number(lic?.setup_fee) || 0),
    annualFee: Math.max(0, Number(lic?.annual_fee) || 0),
    maxVehicles: Math.max(1, Number(lic?.max_vehicles) || 25),
    maxUsers: Math.max(1, Number(lic?.max_users) || 25),
    gpsEnabled: Boolean(lic?.gps_enabled ?? true),
    notes: String(lic?.notes || '').slice(0, 2000),
    companySettings: stripUndefined({
      ...ws.company_settings,
      workspace_created_at: ws.created_at,
      workspace_updated_at: wsUpdatedAt,
    }) as Record<string, unknown>,
    invoiceSettings: stripUndefined(ws.invoice_settings || {
      id: 1,
      prefix: 'FAC',
      separator: '-',
      padding_length: 4,
      next_number: 1,
    }) as unknown as Record<string, unknown>,
    createdAt: createdAtValue as FieldValue,
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(wsRef, wsDocPayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, wsPath);
  }

  // Read existing record docs so we preserve createdAt and prune deleted records
  const recordsColRef = collection(db, 'workspaces', wsId, 'records');
  const existingRecordMeta = new Map<string, { createdAt: unknown; ownerUid: string }>();
  try {
    const recQuery = isFirebaseBootstrappedAdmin(user)
      ? recordsColRef
      : query(recordsColRef, where('ownerUid', '==', ownerUid));
    const snap = await getDocs(recQuery);
    for (const d of snap.docs) {
      const data = d.data();
      existingRecordMeta.set(d.id, {
        createdAt: data.createdAt,
        ownerUid: data.ownerUid || ownerUid,
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `${wsPath}/records`);
  }

  const targetRecords: Array<{ recId: string; recordType: string; payload: Record<string, unknown> }> = [];
  for (const { field, recordType } of RECORD_COLLECTIONS) {
    const arr = ws[field];
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i += 1) {
      const item = arr[i] as { id?: string } | null;
      if (!item || typeof item !== 'object') continue;
      const itemId = sanitizeId(String(item.id || `${i}`));
      const recId = sanitizeId(`${recordType}__${itemId}`);
      targetRecords.push({
        recId,
        recordType,
        payload: stripUndefined(item) as Record<string, unknown>,
      });
    }
  }

  if (Array.isArray(lic?.onboarding_checklist)) {
    for (let i = 0; i < lic.onboarding_checklist.length; i += 1) {
      const chk = lic.onboarding_checklist[i];
      const recId = sanitizeId(`checklist__${chk.id || i}`);
      targetRecords.push({
        recId,
        recordType: 'checklist',
        payload: stripUndefined(chk) as unknown as Record<string, unknown>,
      });
    }
  }

  const targetIds = new Set(targetRecords.map((r) => r.recId));
  const ops: Array<{ kind: 'set' | 'delete'; recId: string; docData?: Record<string, unknown> }> = [];

  for (const rec of targetRecords) {
    const prev = existingRecordMeta.get(rec.recId);
    ops.push({
      kind: 'set',
      recId: rec.recId,
      docData: {
        id: rec.recId,
        workspaceId: wsId,
        ownerUid: prev?.ownerUid || ownerUid,
        recordType: rec.recordType,
        payload: rec.payload,
        createdAt: prev?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    });
  }

  for (const oldId of existingRecordMeta.keys()) {
    if (!targetIds.has(oldId)) {
      ops.push({ kind: 'delete', recId: oldId });
    }
  }

  // Commit in batches of 400
  for (let i = 0; i < ops.length; i += 400) {
    const chunk = ops.slice(i, i + 400);
    const batch = writeBatch(db);
    for (const op of chunk) {
      const ref = doc(db, 'workspaces', wsId, 'records', op.recId);
      if (op.kind === 'set' && op.docData) {
        batch.set(ref, op.docData);
      } else if (op.kind === 'delete') {
        batch.delete(ref);
      }
    }
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `${wsPath}/records`);
    }
  }
}

export async function pullWorkspacesFromFirestore(user: User): Promise<WorkspaceData[]> {
  if (!user.emailVerified) return [];
  const wsCol = collection(db, 'workspaces');
  const wsQuery = isFirebaseBootstrappedAdmin(user)
    ? wsCol
    : query(wsCol, where('ownerUid', '==', user.uid));

  let wsSnap;
  try {
    wsSnap = await getDocs(wsQuery);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'workspaces');
  }

  const results: WorkspaceData[] = [];
  for (const wsDoc of wsSnap.docs) {
    const data = wsDoc.data();
    const recCol = collection(db, 'workspaces', wsDoc.id, 'records');
    const recQuery = isFirebaseBootstrappedAdmin(user)
      ? recCol
      : query(recCol, where('ownerUid', '==', data.ownerUid || user.uid));

    let recSnap;
    try {
      recSnap = await getDocs(recQuery);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, `workspaces/${wsDoc.id}/records`);
    }

    const buckets: Record<string, unknown[]> = {};
    for (const rDoc of recSnap.docs) {
      const rData = rDoc.data();
      const rType = String(rData.recordType || '');
      if (!buckets[rType]) buckets[rType] = [];
      buckets[rType].push(decodeFromFirestore(rData.payload));
    }

    const compSettings = decodeFromFirestore({ ...(data.companySettings || {}) }) as WorkspaceData['company_settings'] & {
      workspace_created_at?: string;
      workspace_updated_at?: string;
    };
    const wsCreatedAt =
      typeof compSettings.workspace_created_at === 'string'
        ? compSettings.workspace_created_at
        : firestoreTimestampToIso(data.createdAt) || new Date().toISOString();
    const wsUpdatedAt =
      typeof compSettings.workspace_updated_at === 'string'
        ? compSettings.workspace_updated_at
        : firestoreTimestampToIso(data.updatedAt) || wsCreatedAt;
    delete compSettings.workspace_created_at;
    delete compSettings.workspace_updated_at;

    const license: B2BLicense = {
      pack: String(data.pack || 'demo_gratuit'),
      status: (data.licenseStatus || 'essai_gratuit') as B2BLicense['status'],
      setup_fee: Number(data.setupFee) || 0,
      annual_fee: Number(data.annualFee) || 0,
      currency: data.currency === 'EUR' ? 'EUR' : 'MAD',
      max_vehicles: Number(data.maxVehicles) || 25,
      max_users: Number(data.maxUsers) || 25,
      gps_enabled: Boolean(data.gpsEnabled ?? true),
      valid_until: String(data.validUntil || new Date().toISOString().slice(0, 10)),
      onboarding_checklist: (buckets.checklist || []) as OnboardingChecklistItem[],
      notes: String(data.notes || ''),
    };

    const reconstructed: WorkspaceData = {
      id: String(data.id || wsDoc.id),
      code: String(data.code || 'FRET'),
      name: String(data.name || 'Entreprise'),
      created_at: wsCreatedAt,
      updated_at: wsUpdatedAt,
      b2b_license: license,
      users: (buckets.user || []) as WorkspaceData['users'],
      vehicles: (buckets.vehicle || []) as WorkspaceData['vehicles'],
      drivers: (buckets.driver || []) as WorkspaceData['drivers'],
      clients: (buckets.client || []) as WorkspaceData['clients'],
      countries: (buckets.country || []) as WorkspaceData['countries'],
      cities: (buckets.city || []) as WorkspaceData['cities'],
      trips: (buckets.trip || []) as WorkspaceData['trips'],
      expenses: (buckets.expense || []) as WorkspaceData['expenses'],
      maintenance: (buckets.maintenance || []) as WorkspaceData['maintenance'],
      documents: (buckets.document || []) as WorkspaceData['documents'],
      employees: (buckets.employee || []) as WorkspaceData['employees'],
      payroll: (buckets.payroll || []) as WorkspaceData['payroll'],
      payroll_allocations: (buckets.payroll_allocation || []) as WorkspaceData['payroll_allocations'],
      client_proposals: (buckets.client_proposal || []) as WorkspaceData['client_proposals'],
      audit_logs: (buckets.audit_log || []) as WorkspaceData['audit_logs'],
      company_settings: compSettings,
      invoice_settings: (data.invoiceSettings || {
        id: 1,
        prefix: 'FAC',
        separator: '-',
        padding_length: 4,
        next_number: 1,
      }) as WorkspaceData['invoice_settings'],
      invoices: (buckets.invoice || []) as WorkspaceData['invoices'],
      invoice_payments: (buckets.invoice_payment || []) as WorkspaceData['invoice_payments'],
      gps_devices: (buckets.gps_device || []) as WorkspaceData['gps_devices'],
      gps_positions: (buckets.gps_position || []) as WorkspaceData['gps_positions'],
      gps_alerts: (buckets.gps_alert || []) as WorkspaceData['gps_alerts'],
      gps_trip_summaries: (buckets.gps_trip_summary || []) as WorkspaceData['gps_trip_summaries'],
      gps_geofences: (buckets.gps_geofence || []) as WorkspaceData['gps_geofences'],
      gps_device_events: (buckets.gps_device_event || []) as WorkspaceData['gps_device_events'],
    };

    results.push(reconstructed);
  }
  return results;
}

export async function deleteWorkspaceFromFirestore(
  workspaceId: string,
  user: User,
): Promise<void> {
  if (!user.emailVerified) return;
  const wsId = sanitizeId(workspaceId);
  try {
    const recCol = collection(db, 'workspaces', wsId, 'records');
    const recSnap = await getDocs(
      isFirebaseBootstrappedAdmin(user)
        ? recCol
        : query(recCol, where('ownerUid', '==', user.uid)),
    );
    const docs = recSnap.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = writeBatch(db);
      for (const d of docs.slice(i, i + 400)) {
        batch.delete(d.ref);
      }
      await batch.commit();
    }
    await deleteDoc(doc(db, 'workspaces', wsId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `workspaces/${wsId}`);
  }
}

export async function pushB2BPacksToFirestore(
  packs: B2BPackCatalogItem[],
  user: User,
): Promise<void> {
  if (!isFirebaseBootstrappedAdmin(user)) return;
  const colRef = collection(db, 'b2b_packs');
  const existingMap = new Map<string, { createdAt: unknown; ownerUid: string }>();
  try {
    const snap = await getDocs(colRef);
    for (const d of snap.docs) {
      const data = d.data();
      existingMap.set(d.id, { createdAt: data.createdAt, ownerUid: data.ownerUid || user.uid });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'b2b_packs');
  }

  const nextIds = new Set<string>();
  for (const pack of packs) {
    const packId = sanitizeId(pack.id);
    nextIds.add(packId);
    const prev = existingMap.get(packId);
    const deliverables = (pack.deliverables || [])
      .map((d) => String(d).trim())
      .filter(Boolean)
      .slice(0, 20);
    try {
      await setDoc(doc(db, 'b2b_packs', packId), {
        id: packId,
        ownerUid: prev?.ownerUid || user.uid,
        name: String(pack.name || '').slice(0, 160),
        audience: String(pack.audience || '').slice(0, 400),
        setupFeeMad: Math.max(0, Number(pack.setup_fee_mad) || 0),
        annualFeeMad: Math.max(0, Number(pack.annual_fee_mad) || 0),
        setupFeeEur: Math.max(0, Number(pack.setup_fee_eur) || 0),
        annualFeeEur: Math.max(0, Number(pack.annual_fee_eur) || 0),
        maxVehicles: Math.max(1, Number(pack.max_vehicles) || 1),
        maxUsers: Math.max(1, Number(pack.max_users) || 1),
        gpsEnabled: Boolean(pack.gps_enabled),
        isFeatured: Boolean(pack.is_featured),
        customized: Boolean(pack.customized),
        logisticsBenefit: String(pack.logistics_benefit || '').slice(0, 600),
        deliverables,
        createdAt: prev?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `b2b_packs/${packId}`);
    }
  }

  for (const oldId of existingMap.keys()) {
    if (!nextIds.has(oldId)) {
      try {
        await deleteDoc(doc(db, 'b2b_packs', oldId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `b2b_packs/${oldId}`);
      }
    }
  }
}

const STANDARD_B2B_PACK_IDS = ['pack_essentiel', 'pack_flotte_gps', 'pack_entreprise'] as const;

function mapB2BPackDoc(docId: string, data: Record<string, unknown>): B2BPackCatalogItem {
  return {
    id: String(data.id || docId),
    name: String(data.name || ''),
    audience: String(data.audience || ''),
    setup_fee_mad: Number(data.setupFeeMad) || 0,
    annual_fee_mad: Number(data.annualFeeMad) || 0,
    setup_fee_eur: Number(data.setupFeeEur) || 0,
    annual_fee_eur: Number(data.annualFeeEur) || 0,
    max_vehicles: Number(data.maxVehicles) || 10,
    max_users: Number(data.maxUsers) || 10,
    gps_enabled: Boolean(data.gpsEnabled),
    is_featured: Boolean(data.isFeatured),
    customized: Boolean(data.customized),
    logistics_benefit: String(data.logisticsBenefit || '') || undefined,
    deliverables: Array.isArray(data.deliverables) ? data.deliverables.map(String) : [],
  };
}

export async function pullB2BPacksFromFirestore(user: User): Promise<B2BPackCatalogItem[]> {
  if (!user.emailVerified) return [];

  if (isFirebaseBootstrappedAdmin(user)) {
    try {
      const snap = await getDocs(collection(db, 'b2b_packs'));
      return snap.docs.map((d) => mapB2BPackDoc(d.id, d.data()));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'b2b_packs');
    }
  }

  const results = await Promise.all(
    STANDARD_B2B_PACK_IDS.map(async (packId) => {
      try {
        const snap = await getDoc(doc(db, 'b2b_packs', packId));
        if (!snap.exists()) return null;
        return mapB2BPackDoc(snap.id, snap.data());
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `b2b_packs/${packId}`);
      }
    }),
  );

  return results.filter((item): item is B2BPackCatalogItem => item !== null);
}

export async function pushB2BRequestsToFirestore(
  requests: B2BDeploymentRequest[],
  user: User,
): Promise<void> {
  if (!user.emailVerified) return;
  const isAdmin = isFirebaseBootstrappedAdmin(user);
  for (const r of requests) {
    const reqId = sanitizeId(r.id);
    const reqRef = doc(db, 'b2b_requests', reqId);
    let existingData: Record<string, unknown> | undefined;
    try {
      const snap = await getDoc(reqRef);
      if (snap.exists()) existingData = snap.data();
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `b2b_requests/${reqId}`);
    }

    // Terminal state lock: non-admin cannot overwrite a converted request
    if (existingData && existingData.status === 'convertie' && !isAdmin) {
      continue;
    }
    if (existingData && existingData.ownerUid !== user.uid && !isAdmin) {
      continue;
    }

    try {
      await setDoc(reqRef, {
        id: reqId,
        ownerUid: (existingData?.ownerUid as string) || user.uid,
        companyName: String(r.company_name || '').slice(0, 160),
        contactName: String(r.contact_name || '').slice(0, 120),
        phone: String(r.phone || '').slice(0, 40),
        email: String(r.email || '').slice(0, 160),
        fleetSize: Math.max(1, Number(r.fleet_size) || 1),
        pack: String(r.pack || 'pack_flotte_gps').slice(0, 64),
        currency: r.currency === 'EUR' ? 'EUR' : 'MAD',
        notes: String(r.notes || '').slice(0, 1000),
        status: r.status || 'nouvelle',
        provisionedWorkspaceCode: String(r.provisioned_workspace_code || '').slice(0, 32),
        createdAt: existingData?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `b2b_requests/${reqId}`);
    }
  }
}

export async function pullB2BRequestsFromFirestore(
  user: User,
): Promise<B2BDeploymentRequest[]> {
  if (!user.emailVerified) return [];
  const colRef = collection(db, 'b2b_requests');
  const q = isFirebaseBootstrappedAdmin(user)
    ? colRef
    : query(colRef, where('ownerUid', '==', user.uid));
  try {
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      const createdIso = firestoreTimestampToIso(data.createdAt) || new Date().toISOString();
      const updatedIso = firestoreTimestampToIso(data.updatedAt) || createdIso;
      return {
        id: String(data.id || d.id),
        company_name: String(data.companyName || ''),
        contact_name: String(data.contactName || ''),
        phone: String(data.phone || ''),
        email: String(data.email || ''),
        fleet_size: Number(data.fleetSize) || 5,
        pack: String(data.pack || 'pack_flotte_gps'),
        currency: data.currency === 'EUR' ? 'EUR' : 'MAD',
        notes: String(data.notes || '') || null,
        status: (data.status || 'nouvelle') as B2BDeploymentRequest['status'],
        provisioned_workspace_code: String(data.provisionedWorkspaceCode || '') || null,
        created_at: createdIso,
        updated_at: updatedIso,
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'b2b_requests');
  }
}

// ---------------- ADMIN-ONLY VENDOR SETTINGS, BILLING DOCS & ACCOUNTS ----------------

const KNOWN_VENDOR_ACCOUNT_IDS = ['vnd_primary', 'vnd_owner'] as const;

export async function pushVendorSettingsToFirestore(
  settings: VendorSettings,
  user: User,
): Promise<void> {
  if (!user.emailVerified || !isFirebaseBootstrappedAdmin(user)) return;
  const settingsRef = doc(db, 'vendor_portal', 'settings');
  let prev: Record<string, unknown> | undefined;
  try {
    const snap = await getDoc(settingsRef);
    if (snap.exists()) prev = snap.data();
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'vendor_portal/settings');
  }

  const safeLogo =
    typeof settings.logo_url === 'string' && settings.logo_url.length <= 240000
      ? settings.logo_url
      : '';

  try {
    await setDoc(settingsRef, {
      id: 'settings',
      ownerUid: (prev?.ownerUid as string) || user.uid,
      companyName: String(settings.company_name || 'FRET MANAGER B2B').slice(0, 160),
      legalForm: String(settings.legal_form || '').slice(0, 80),
      activity: String(settings.activity || '').slice(0, 200),
      ice: String(settings.ice || '').slice(0, 60),
      ifNumber: String(settings.if_number || '').slice(0, 60),
      rc: String(settings.rc || '').slice(0, 60),
      patente: String(settings.patente || '').slice(0, 60),
      bank: String(settings.bank || '').slice(0, 120),
      rib: String(settings.rib || '').slice(0, 80),
      address: String(settings.address || '').slice(0, 300),
      city: String(settings.city || '').slice(0, 100),
      phone: String(settings.phone || '').slice(0, 40),
      email: String(settings.email || '').slice(0, 160),
      website: String(settings.website || '').slice(0, 200),
      logoUrl: safeLogo,
      quotePrefix: String(settings.quote_prefix || 'DEV-B2B').slice(0, 32) || 'DEV-B2B',
      invoicePrefix: String(settings.invoice_prefix || 'FAC-B2B').slice(0, 32) || 'FAC-B2B',
      defaultTaxRate: Math.min(100, Math.max(0, Number(settings.default_tax_rate) || 0)),
      paymentTerms: String(settings.payment_terms || '').slice(0, 1000),
      createdAt: prev?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'vendor_portal/settings');
  }
}

export async function pullVendorSettingsFromFirestore(
  user: User,
): Promise<VendorSettings | undefined> {
  if (!user.emailVerified || !isFirebaseBootstrappedAdmin(user)) return undefined;
  try {
    const snap = await getDoc(doc(db, 'vendor_portal', 'settings'));
    if (!snap.exists()) return undefined;
    const d = snap.data();
    return {
      company_name: String(d.companyName || 'FRET MANAGER B2B'),
      legal_form: String(d.legalForm || ''),
      activity: String(d.activity || ''),
      ice: String(d.ice || ''),
      if_number: String(d.ifNumber || ''),
      rc: String(d.rc || ''),
      patente: String(d.patente || ''),
      bank: String(d.bank || ''),
      rib: String(d.rib || ''),
      address: String(d.address || ''),
      city: String(d.city || ''),
      phone: String(d.phone || ''),
      email: String(d.email || ''),
      website: String(d.website || ''),
      logo_url: String(d.logoUrl || ''),
      quote_prefix: String(d.quotePrefix || 'DEV-B2B'),
      invoice_prefix: String(d.invoicePrefix || 'FAC-B2B'),
      default_tax_rate: Number(d.defaultTaxRate) || 20,
      payment_terms: String(d.paymentTerms || ''),
      updated_at: firestoreTimestampToIso(d.updatedAt) || new Date().toISOString(),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'vendor_portal/settings');
  }
}

export async function pushVendorBillingDocsToFirestore(
  docs: VendorBillingDoc[],
  deletedIds: string[],
  user: User,
): Promise<void> {
  if (!user.emailVerified || !isFirebaseBootstrappedAdmin(user)) return;
  const colRef = collection(db, 'vendor_billing_docs');
  const existingMap = new Map<string, Record<string, unknown>>();
  try {
    const snap = await getDocs(query(colRef, where('ownerUid', '==', user.uid)));
    for (const d of snap.docs) {
      existingMap.set(d.id, d.data());
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'vendor_billing_docs');
  }

  for (const item of docs) {
    const docId = sanitizeId(item.id);
    const prev = existingMap.get(docId);
    const safeItems: VendorBillingDocItem[] = (Array.isArray(item.items) ? item.items : [])
      .slice(0, 50)
      .map((it) => ({
        id: String(it.id || 'item').slice(0, 64),
        description: String(it.description || '').slice(0, 240),
        details: String(it.details || '').slice(0, 400),
        quantity: Math.max(0, Number(it.quantity) || 0),
        unit_price: Math.max(0, Number(it.unit_price) || 0),
        total_ht: Math.max(0, Number(it.total_ht) || 0),
      }));

    try {
      await setDoc(doc(db, 'vendor_billing_docs', docId), {
        id: docId,
        ownerUid: (prev?.ownerUid as string) || user.uid,
        docType: item.doc_type === 'facture' ? 'facture' : 'devis',
        docNumber: String(item.doc_number || 'DOC').slice(0, 64),
        workspaceId: String(item.workspace_id || '').slice(0, 128),
        requestId: String(item.request_id || '').slice(0, 128),
        sourceQuoteId: String(item.source_quote_id || '').slice(0, 128),
        clientName: String(item.client_name || 'Client').slice(0, 160),
        clientContact: String(item.client_contact || '').slice(0, 120),
        clientIce: String(item.client_ice || '').slice(0, 60),
        clientPhone: String(item.client_phone || '').slice(0, 40),
        clientEmail: String(item.client_email || '').slice(0, 160),
        clientAddress: String(item.client_address || '').slice(0, 300),
        currency: item.currency === 'EUR' ? 'EUR' : 'MAD',
        issueDate: String(item.issue_date || '').slice(0, 32),
        dueDate: String(item.due_date || '').slice(0, 32),
        status: item.status || 'brouillon',
        taxRate: Math.min(100, Math.max(0, Number(item.tax_rate) || 0)),
        items: safeItems,
        subtotalHt: Math.max(0, Number(item.subtotal_ht) || 0),
        taxAmount: Math.max(0, Number(item.tax_amount) || 0),
        totalTtc: Math.max(0, Number(item.total_ttc) || 0),
        notes: String(item.notes || '').slice(0, 2000),
        createdAt: prev?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `vendor_billing_docs/${docId}`);
    }
  }

  for (const delId of deletedIds) {
    const cleanId = sanitizeId(delId);
    if (existingMap.has(cleanId)) {
      try {
        await deleteDoc(doc(db, 'vendor_billing_docs', cleanId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `vendor_billing_docs/${cleanId}`);
      }
    }
  }
}

export async function pullVendorBillingDocsFromFirestore(user: User): Promise<VendorBillingDoc[]> {
  if (!user.emailVerified || !isFirebaseBootstrappedAdmin(user)) return [];
  try {
    const snap = await getDocs(
      query(collection(db, 'vendor_billing_docs'), where('ownerUid', '==', user.uid)),
    );
    return snap.docs.map((d) => {
      const data = d.data();
      const createdIso = firestoreTimestampToIso(data.createdAt) || new Date().toISOString();
      const updatedIso = firestoreTimestampToIso(data.updatedAt) || createdIso;
      return {
        id: String(data.id || d.id),
        doc_type: data.docType === 'facture' ? 'facture' : 'devis',
        doc_number: String(data.docNumber || ''),
        workspace_id: String(data.workspaceId || '') || null,
        request_id: String(data.requestId || '') || null,
        source_quote_id: String(data.sourceQuoteId || '') || null,
        client_name: String(data.clientName || ''),
        client_contact: String(data.clientContact || ''),
        client_ice: String(data.clientIce || ''),
        client_phone: String(data.clientPhone || ''),
        client_email: String(data.clientEmail || ''),
        client_address: String(data.clientAddress || ''),
        currency: data.currency === 'EUR' ? 'EUR' : 'MAD',
        issue_date: String(data.issueDate || ''),
        due_date: String(data.dueDate || ''),
        status: (data.status || 'brouillon') as VendorBillingDoc['status'],
        tax_rate: Number(data.taxRate) || 0,
        items: Array.isArray(data.items)
          ? (data.items as VendorBillingDocItem[])
          : [],
        subtotal_ht: Number(data.subtotalHt) || 0,
        tax_amount: Number(data.taxAmount) || 0,
        total_ttc: Number(data.totalTtc) || 0,
        notes: String(data.notes || ''),
        created_at: createdIso,
        updated_at: updatedIso,
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'vendor_billing_docs');
  }
}

export async function pushVendorAccountsToFirestore(
  accounts: VendorAccount[],
  user: User,
): Promise<void> {
  if (!user.emailVerified || !isFirebaseBootstrappedAdmin(user)) return;
  for (const acc of accounts) {
    const accId = sanitizeId(acc.id);
    const ref = doc(db, 'vendor_accounts', accId);
    let prev: Record<string, unknown> | undefined;
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) prev = snap.data();
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `vendor_accounts/${accId}`);
    }
    try {
      await setDoc(ref, {
        id: accId,
        ownerUid: (prev?.ownerUid as string) || user.uid,
        email: String(prev?.email || acc.email).slice(0, 160),
        passwordHash: String(acc.password_hash || '').slice(0, 512),
        fullName: String(acc.full_name || 'Owner').slice(0, 120),
        companyRole: String(acc.company_role || '').slice(0, 160),
        active: Boolean(acc.active),
        createdAt: prev?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `vendor_accounts/${accId}`);
    }
  }
}

export async function pullVendorAccountsFromFirestore(user: User): Promise<VendorAccount[]> {
  if (!user.emailVerified || !isFirebaseBootstrappedAdmin(user)) return [];
  const results = await Promise.all(
    KNOWN_VENDOR_ACCOUNT_IDS.map(async (accId) => {
      try {
        const snap = await getDoc(doc(db, 'vendor_accounts', accId));
        if (!snap.exists()) return null;
        const data = snap.data();
        return {
          id: String(data.id || snap.id),
          email: String(data.email || ''),
          password_hash: String(data.passwordHash || ''),
          full_name: String(data.fullName || ''),
          company_role: String(data.companyRole || ''),
          active: Boolean(data.active),
          created_at: firestoreTimestampToIso(data.createdAt) || new Date().toISOString(),
          updated_at: firestoreTimestampToIso(data.updatedAt),
        } as VendorAccount;
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `vendor_accounts/${accId}`);
      }
    }),
  );
  return results.filter((a): a is VendorAccount => a !== null);
}

// ---------------- HIGH-LEVEL ORCHESTRATORS ----------------

export async function syncFromCloudAndHydrate(user: User): Promise<void> {
  if (!user.emailVerified) return;
  await ensureFirebaseUserRecord(user);

  const isAdmin = isFirebaseBootstrappedAdmin(user);

  const [
    cloudWorkspaces,
    cloudRequests,
    cloudPacks,
    local,
    cloudVendorSettings,
    cloudVendorBillingDocs,
    cloudVendorAccounts,
  ] = await Promise.all([
    pullWorkspacesFromFirestore(user),
    pullB2BRequestsFromFirestore(user),
    pullB2BPacksFromFirestore(user),
    loadLocalSnapshot(),
    isAdmin ? pullVendorSettingsFromFirestore(user) : Promise.resolve(undefined),
    isAdmin ? pullVendorBillingDocsFromFirestore(user) : Promise.resolve([]),
    isAdmin ? pullVendorAccountsFromFirestore(user) : Promise.resolve([]),
  ]);

  const mergedSnapshot = await mergeIntoLocalSnapshot({
    workspaces: cloudWorkspaces,
    b2b_requests: cloudRequests,
    b2b_packs: cloudPacks.length > 0 ? cloudPacks : undefined,
    vendor_settings: cloudVendorSettings,
    vendor_billing_docs: cloudVendorBillingDocs.length > 0 ? cloudVendorBillingDocs : undefined,
    vendor_accounts: cloudVendorAccounts.length > 0 ? cloudVendorAccounts : undefined,
    forceOverwrite: false,
  });

  await hydrateServerFromSnapshot(mergedSnapshot);

  // Backfill or push newer local workspaces to Firestore
  const cloudWsById = new Map(cloudWorkspaces.map((w) => [w.id, w]));
  for (const ws of local.workspaces) {
    if (mergedSnapshot.deleted_workspace_ids.includes(ws.id)) continue;
    const cloudWs = cloudWsById.get(ws.id);
    if (!cloudWs || parseIsoMs(ws.updated_at) > parseIsoMs(cloudWs.updated_at)) {
      await pushWorkspaceToFirestore(ws, user);
    }
  }
  const cloudReqIds = new Set(cloudRequests.map((r) => r.id));
  const missingReqs = local.b2b_requests.filter(
    (r) => !cloudReqIds.has(r.id) && !mergedSnapshot.deleted_request_ids.includes(r.id),
  );
  if (missingReqs.length > 0) {
    await pushB2BRequestsToFirestore(missingReqs, user);
  }
  if (isAdmin) {
    if (
      local.vendor_settings &&
      (!cloudVendorSettings ||
        parseIsoMs(local.vendor_settings.updated_at) > parseIsoMs(cloudVendorSettings.updated_at))
    ) {
      await pushVendorSettingsToFirestore(local.vendor_settings, user);
    }
    if ((local.vendor_billing_docs || []).length > 0) {
      await pushVendorBillingDocsToFirestore(
        local.vendor_billing_docs || [],
        mergedSnapshot.deleted_billing_doc_ids || [],
        user,
      );
    }
  }
}

export async function syncCurrentClientWorkspace(user: User | null): Promise<void> {
  if (!getStoredToken()) return;
  try {
    const bundle = await api<{
      workspace: WorkspaceData;
      b2b_requests: B2BDeploymentRequest[];
      b2b_packs: B2BPackCatalogItem[];
    }>('/api/sync/workspace-bundle');

    const wsWithTimestamp: WorkspaceData = {
      ...bundle.workspace,
      updated_at: bundle.workspace.updated_at || new Date().toISOString(),
    };

    await mergeIntoLocalSnapshot({
      workspaces: [wsWithTimestamp],
      b2b_requests: bundle.b2b_requests,
      b2b_packs: bundle.b2b_packs,
      forceOverwrite: true,
    });

    if (user?.emailVerified) {
      await ensureFirebaseUserRecord(user);
      await pushWorkspaceToFirestore(wsWithTimestamp, user);
      if (bundle.b2b_requests.length > 0) {
        await pushB2BRequestsToFirestore(bundle.b2b_requests, user);
      }
      if (isFirebaseBootstrappedAdmin(user) && bundle.b2b_packs.some((p) => p.customized)) {
        await pushB2BPacksToFirestore(bundle.b2b_packs, user);
      }
    }
  } catch (err) {
    console.warn('Client persistence sync warning:', err);
  }
}

export async function syncVendorPortfolio(user: User | null): Promise<void> {
  if (!getVendorToken()) return;
  try {
    const bundle = await vendorApi<{
      workspaces: WorkspaceData[];
      b2b_requests: B2BDeploymentRequest[];
      b2b_packs: B2BPackCatalogItem[];
      vendor_settings?: VendorSettings;
      vendor_billing_docs?: VendorBillingDoc[];
      vendor_accounts?: VendorAccount[];
      deleted_workspace_ids: string[];
      deleted_request_ids?: string[];
      deleted_billing_doc_ids?: string[];
    }>('/api/sync/vendor-bundle');

    const now = new Date().toISOString();
    const stampedWorkspaces = bundle.workspaces.map((ws) => ({
      ...ws,
      updated_at: ws.updated_at || now,
    }));

    await mergeIntoLocalSnapshot({
      workspaces: stampedWorkspaces,
      replaceWorkspaces: true,
      b2b_requests: bundle.b2b_requests,
      replaceRequests: true,
      b2b_packs: bundle.b2b_packs,
      vendor_settings: bundle.vendor_settings,
      vendor_billing_docs: bundle.vendor_billing_docs || [],
      replaceBillingDocs: true,
      vendor_accounts: bundle.vendor_accounts || [],
      deleted_workspace_ids: bundle.deleted_workspace_ids,
      deleted_request_ids: bundle.deleted_request_ids || [],
      deleted_billing_doc_ids: bundle.deleted_billing_doc_ids || [],
      has_vendor_snapshot: true,
      forceOverwrite: true,
    });

    if (user?.emailVerified) {
      await ensureFirebaseUserRecord(user);
      for (const ws of stampedWorkspaces) {
        await pushWorkspaceToFirestore(ws, user);
      }
      for (const delId of bundle.deleted_workspace_ids) {
        await deleteWorkspaceFromFirestore(delId, user).catch(() => {});
      }
      if (bundle.b2b_requests.length > 0) {
        await pushB2BRequestsToFirestore(bundle.b2b_requests, user);
      }
      if (isFirebaseBootstrappedAdmin(user)) {
        await pushB2BPacksToFirestore(bundle.b2b_packs, user);
        if (bundle.vendor_settings) {
          await pushVendorSettingsToFirestore(bundle.vendor_settings, user);
        }
        await pushVendorBillingDocsToFirestore(
          bundle.vendor_billing_docs || [],
          bundle.deleted_billing_doc_ids || [],
          user,
        );
        if (bundle.vendor_accounts && bundle.vendor_accounts.length > 0) {
          await pushVendorAccountsToFirestore(bundle.vendor_accounts, user);
        }
      }
    }
  } catch (err) {
    console.warn('Vendor persistence sync warning:', err);
  }
}

export async function persistB2BRequest(
  reqItem: B2BDeploymentRequest,
  user: User | null = auth.currentUser,
): Promise<void> {
  const stamped: B2BDeploymentRequest = {
    ...reqItem,
    updated_at: reqItem.updated_at || new Date().toISOString(),
  };
  await mergeIntoLocalSnapshot({
    b2b_requests: [stamped],
    forceOverwrite: true,
  });
  if (user?.emailVerified) {
    await ensureFirebaseUserRecord(user);
    await pushB2BRequestsToFirestore([stamped], user);
  }
}

// ---------------- BOOT HYDRATION & LIFECYCLE SYNC ----------------

function waitForInitialFirebaseUser(timeoutMs = 2500): Promise<User | null> {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        unsub();
        resolve(auth.currentUser);
      }
    }, timeoutMs);
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        unsub();
        resolve(u);
      }
    });
  });
}

let bootPromise: Promise<void> | null = null;

export function ensureBootHydrated(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    await withTimeout(hydrateServerOnBoot().then(() => undefined), 3500, undefined);
    const fbUser = await waitForInitialFirebaseUser(1500);
    if (fbUser?.emailVerified) {
      const cloudSyncTask = syncFromCloudAndHydrate(fbUser)
        .then(() => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('fret:cloud-hydrated'));
          }
        })
        .catch((err) => {
          console.warn('Initial cloud hydration skipped:', err);
        });
      await withTimeout(cloudSyncTask, 3500, undefined);
    }
  })().catch(() => {
    // Never block app boot
  });
  return bootPromise;
}

let pendingClientSync = false;
let pendingVendorSync = false;
let syncTimer: number | null = null;
let listenersAttached = false;

export async function flushPendingPersistenceSync(): Promise<void> {
  if (syncTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(syncTimer);
    syncTimer = null;
  }
  const runClient = pendingClientSync;
  const runVendor = pendingVendorSync;
  pendingClientSync = false;
  pendingVendorSync = false;

  const currentUser = auth.currentUser;
  if (runClient && getStoredToken()) {
    await syncCurrentClientWorkspace(currentUser);
  }
  if (runVendor && getVendorToken()) {
    await syncVendorPortfolio(currentUser);
  }
}

export function schedulePersistenceSync(scope: 'client' | 'vendor'): void {
  if (scope === 'vendor') pendingVendorSync = true;
  else pendingClientSync = true;

  if (typeof window === 'undefined') return;
  if (syncTimer !== null) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    void flushPendingPersistenceSync();
  }, 150);
}

export function initPersistenceListeners(): void {
  if (typeof window === 'undefined' || listenersAttached) return;
  listenersAttached = true;

  window.addEventListener('fret:mutated', (ev: Event) => {
    const detail = (ev as CustomEvent<{ scope?: 'client' | 'vendor' }>).detail;
    schedulePersistenceSync(detail?.scope === 'vendor' ? 'vendor' : 'client');
  });

  const onExitOrHide = () => {
    if (getStoredToken()) pendingClientSync = true;
    if (getVendorToken()) pendingVendorSync = true;
    void flushPendingPersistenceSync();
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      onExitOrHide();
    }
  });

  window.addEventListener('pagehide', onExitOrHide);
}
