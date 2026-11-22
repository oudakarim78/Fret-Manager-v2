import type { Invoice, InvoicePayment, Role } from '../types.ts';

export type SupportedLanguage = 'fr' | 'en' | 'es' | 'ar';

export const ROLE_NAMES: Record<Role, string> = {
  admin: 'Administration',
  logistique: 'Logistique',
  comptable: 'Comptabilité',
  conducteur: 'Conducteur',
};

export const TRIP_STATUSES = ['À planifier', 'En cours', 'Terminée', 'Annulée'] as const;

export function getActiveLocale(lang?: SupportedLanguage): string {
  const active =
    lang ||
    (typeof window !== 'undefined'
      ? (window.localStorage.getItem('fret_lang') as SupportedLanguage | null) || 'fr'
      : 'fr');
  if (active === 'en') return 'en-GB';
  if (active === 'es') return 'es-ES';
  if (active === 'ar') return 'ar-MA-u-nu-latn';
  return 'fr-FR';
}

export function dateText(v: string | null | undefined, lang?: SupportedLanguage): string {
  if (!v) return '—';
  try {
    const iso = v.includes('T') ? v : `${v}T00:00:00`;
    return new Date(iso).toLocaleDateString(getActiveLocale(lang));
  } catch {
    return v;
  }
}

export function dateTimeText(v: string | null | undefined, lang?: SupportedLanguage): string {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString(getActiveLocale(lang));
  } catch {
    return v;
  }
}

export function money(
  v: number | string | null | undefined,
  currency = 'MAD',
  lang?: SupportedLanguage,
): string {
  const num = Number(v || 0);
  return `${num.toLocaleString(getActiveLocale(lang), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

export function invoicePaymentState(inv: Invoice, payments: InvoicePayment[]) {
  const paid = payments
    .filter((p) => p.invoice_id === inv.id)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const total = Number(inv.total_ttc || 0);
  const remaining = Math.max(0, total - paid);
  const state =
    paid <= 0
      ? 'Non réglée'
      : paid + 0.005 >= total
        ? 'Payée'
        : 'Partiellement réglée';
  return { paid, remaining, state };
}

export function invoiceStatusLabel(inv: Invoice, payments: InvoicePayment[]): string {
  if (inv.status === 'draft') return 'Brouillon';
  if (inv.status === 'cancelled') return 'Annulée';
  return invoicePaymentState(inv, payments).state;
}

export function proposalStatusLabel(status: string): string {
  if (status === 'en_attente') return 'En attente de validation';
  if (status === 'approuvee') return 'Approuvée';
  if (status === 'refusee') return 'Refusée';
  return status || '—';
}
