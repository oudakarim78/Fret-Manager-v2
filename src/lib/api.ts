const TOKEN_KEY = 'fret_manager_token';
const VENDOR_TOKEN_KEY = 'fret_vendor_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore storage errors
  }
}

export function getVendorToken(): string | null {
  try {
    return localStorage.getItem(VENDOR_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setVendorToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(VENDOR_TOKEN_KEY, token);
    else localStorage.removeItem(VENDOR_TOKEN_KEY);
  } catch {
    // ignore storage errors
  }
}

async function requestJson<T>(
  path: string,
  token: string | null,
  options: RequestInit = {},
  scope: 'client' | 'vendor' = 'client',
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const isUpload = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const timeoutMs = isUpload ? 45000 : 15000;
  const controller = !options.signal && typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  let res: Response;
  try {
    res = await fetch(path, {
      ...options,
      signal: options.signal ?? controller?.signal,
      cache: options.cache ?? 'no-store',
      headers,
    });
  } finally {
    if (timer !== null) clearTimeout(timer);
  }

  if (!res.ok) {
    let msg = `Erreur HTTP ${res.status}`;
    let accessBlocked = false;
    try {
      const data = (await res.json()) as { error?: string; access_blocked?: boolean };
      if (data.error) msg = data.error;
      if (data.access_blocked) accessBlocked = true;
    } catch {
      // ignore json parse error
    }
    if (res.status === 403 && accessBlocked && token && token === getStoredToken()) {
      setStoredToken(null);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('fret:workspace-blocked', { detail: msg }));
      }
    }
    throw new Error(msg);
  }

  const result = res.status === 204 ? (undefined as T) : ((await res.json()) as T);

  const method = String(options.method || 'GET').toUpperCase();
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const isExcluded =
    path.startsWith('/api/sync/') ||
    path.startsWith('/api/auth/login') ||
    path.startsWith('/api/auth/demo') ||
    path.startsWith('/api/vendor/login') ||
    path.startsWith('/api/vendor/demo') ||
    path === '/api/b2b/requests';

  if (isMutation && !isExcluded && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('fret:mutated', { detail: { scope, path } }));
  }

  return result;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  return requestJson<T>(path, getStoredToken(), options, 'client');
}

export async function vendorApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  return requestJson<T>(path, getVendorToken(), options, 'vendor');
}

export function getAuthenticatedFileUrl(docId: string): string {
  const token = getStoredToken();
  return `/api/files/${encodeURIComponent(docId)}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Impossible de lire le fichier.'));
    reader.readAsDataURL(file);
  });
}
