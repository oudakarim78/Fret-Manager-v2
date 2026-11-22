import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Copy, Download, ExternalLink, Mail, MessageCircle, Printer, Send } from 'lucide-react';
import type {
  Client,
  CompanySettings,
  Invoice,
  InvoicePayment,
  InvoiceSettings,
  PublicProfile,
  Trip,
} from '../types.ts';
import { api } from '../lib/api.ts';
import { downloadExcelCsv } from '../lib/exportCsv.ts';
import {
  dateText,
  invoicePaymentState,
  invoiceStatusLabel,
  money,
} from '../lib/format.ts';
import { useI18n } from '../lib/i18n.tsx';
import {
  ConfirmDialog,
  type ConfirmState,
  EmptyState,
  InfoBanner,
  Modal,
  StatusText,
} from './UI.tsx';
import { CompanyStamp } from './CompanyStamp.tsx';

export function InvoicesView({
  profile,
  presetTripId,
  onClearPreset,
  notify,
}: {
  profile: PublicProfile;
  presetTripId: string | null;
  onClearPreset: () => void;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t, lang, invoiceStatusText } = useI18n();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<InvoicePayment[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // Create/Edit Draft Invoice Modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingInv, setEditingInv] = useState<Invoice | null>(null);
  const [fTripId, setFTripId] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fBasis, setFBasis] = useState<'HT' | 'TTC' | ''>('');
  const [fAmount, setFAmount] = useState('');
  const [fTax, setFTax] = useState('');
  const [fIssue, setFIssue] = useState(new Date().toISOString().slice(0, 10));
  const [fDue, setFDue] = useState('');
  const [fNotes, setFNotes] = useState('');

  // Invoice Detail Modal
  const [detailId, setDetailId] = useState<string | null>(null);

  // Payment Modal
  const [payModalInv, setPayModalInv] = useState<Invoice | null>(null);
  const [editingPayment, setEditingPayment] = useState<InvoicePayment | null>(null);
  const [pDate, setPDate] = useState('');
  const [pAmount, setPAmount] = useState('');
  const [pMethod, setPMethod] = useState('');
  const [pRef, setPRef] = useState('');
  const [pNotes, setPNotes] = useState('');

  // Notes Modal
  const [notesInv, setNotesInv] = useState<Invoice | null>(null);
  const [notesDraft, setNotesDraft] = useState('');

  // Settings Modal
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [iset, setIset] = useState<InvoiceSettings>({
    id: 1,
    prefix: 'FAC',
    separator: '-',
    padding_length: 4,
    next_number: 1,
  });

  // Print Preview Modal (Invoice Model 1/2 or Payment Receipt)
  const [printInvoiceModal, setPrintInvoiceModal] = useState<{
    inv: Invoice;
    model: 1 | 2;
  } | null>(null);
  const [printReceiptModal, setPrintReceiptModal] = useState<{
    inv: Invoice;
    payment: InvoicePayment;
  } | null>(null);

  // Email & WhatsApp Invoice Send Modal
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [emailModalInv, setEmailModalInv] = useState<Invoice | null>(null);
  const [sendChannel, setSendChannel] = useState<'email' | 'whatsapp'>('email');
  const [eTo, setETo] = useState('');
  const [eCc, setECc] = useState('');
  const [eSubject, setESubject] = useState('');
  const [eMessage, setEMessage] = useState('');
  const [eSending, setESending] = useState(false);
  const [wPhone, setWPhone] = useState('');
  const [wMessage, setWMessage] = useState('');
  const [wSending, setWSending] = useState(false);

  const canManage = ['admin', 'comptable'].includes(profile.role);
  const isAdmin = profile.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [invRes, tripsRes, clientsRes, compRes, emailStatusRes] = await Promise.all([
        api<{ invoices: Invoice[]; payments: InvoicePayment[] }>('/api/invoices'),
        api<Trip[]>('/api/trips'),
        api<Client[]>('/api/clients').catch(() => [] as Client[]),
        api<CompanySettings>('/api/company-settings'),
        api<{ smtpConfigured: boolean }>('/api/invoices/email-status').catch(() => ({
          smtpConfigured: false,
        })),
      ]);
      setInvoices(invRes.invoices);
      setPayments(invRes.payments);
      setTrips(tripsRes);
      setClients(clientsRes);
      setCompany(compRes);
      setSmtpConfigured(Boolean(emailStatusRes?.smtpConfigured));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur chargement facturation.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const isSimpleEmailValid = (val: string) =>
    /^[^\s@<>(),;:"\\/\[\]]+@[^\s@<>(),;:"\\/\[\]]+\.[^\s@<>(),;:"\\/\[\]]+$/.test(val.trim());

  const normalizeWhatsAppNumber = (raw: string): { valid: boolean; digits: string } => {
    const trimmed = raw.trim();
    if (!trimmed) return { valid: true, digits: '' };
    let digits = trimmed.replace(/[^\d+]/g, '');
    if (digits.startsWith('+')) digits = digits.slice(1);
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0') && (digits.length === 9 || digits.length === 10)) {
      digits = `212${digits.slice(1)}`;
    }
    digits = digits.replace(/\D/g, '');
    return { valid: digits.length >= 8 && digits.length <= 16, digits };
  };

  const openSendModal = useCallback(
    (inv: Invoice, channel: 'email' | 'whatsapp' = 'email') => {
      const st = invoicePaymentState(inv, payments);
      const cleanClientEmail =
        inv.client_email && inv.client_email !== '—' && inv.client_email.includes('@')
          ? inv.client_email.trim()
          : '';
      const matchedClient = clients.find((c) => c.id === inv.client_id);
      const clientPhone =
        matchedClient?.phone && matchedClient.phone !== '—' ? matchedClient.phone.trim() : '';

      const companyTitle = company?.company_name ? ` (${company.company_name})` : '';
      const subject = `${t('inv.doc_title')} ${inv.invoice_number} — ${inv.mission_reference}${companyTitle}`;
      const lines = [
        `Bonjour ${inv.client_name || ''},`.trim(),
        '',
        `Veuillez trouver ci-dessous le récapitulatif de votre facture ${inv.invoice_number} relative à la mission ${inv.mission_reference} :`,
        `• Prestation : ${inv.service_description}`,
        `• Date d'émission : ${dateText(inv.issue_date, lang)}`,
        inv.due_date ? `• Date d'échéance : ${dateText(inv.due_date, lang)}` : null,
        `• Total HT : ${money(inv.subtotal_ht, inv.currency, lang)}`,
        `• TVA (${inv.tax_rate} %) : ${money(inv.tax_amount, inv.currency, lang)}`,
        `• Total TTC : ${money(inv.total_ttc, inv.currency, lang)}`,
        st.paid > 0 ? `• Déjà réglé : ${money(st.paid, inv.currency, lang)}` : null,
        `• Reste à payer : ${money(st.remaining, inv.currency, lang)}`,
        '',
        company?.bank || company?.rib
          ? `Coordonnées bancaires : ${company?.bank || '—'} · RIB / IBAN : ${company?.rib || '—'}`
          : null,
        company?.payment_terms ? `Conditions de règlement : ${company.payment_terms}` : null,
        '',
        'Cordialement,',
        company?.company_name || 'Service Facturation',
        company?.phone ? `Tél : ${company.phone}` : null,
        company?.email ? `E-mail : ${company.email}` : null,
      ].filter((line): line is string => line !== null);

      const waLines = [
        `Bonjour *${inv.client_name || ''}*,`.trim(),
        '',
        `Voici le récapitulatif de votre facture *${inv.invoice_number}* (Mission *${inv.mission_reference}*) :`,
        `• Prestation : ${inv.service_description}`,
        `• Date d'émission : ${dateText(inv.issue_date, lang)}`,
        inv.due_date ? `• Échéance : ${dateText(inv.due_date, lang)}` : null,
        `• Total HT : ${money(inv.subtotal_ht, inv.currency, lang)}`,
        `• TVA (${inv.tax_rate}%) : ${money(inv.tax_amount, inv.currency, lang)}`,
        `• *Total TTC : ${money(inv.total_ttc, inv.currency, lang)}*`,
        st.paid > 0 ? `• Déjà réglé : ${money(st.paid, inv.currency, lang)}` : null,
        `• *Reste à payer : ${money(st.remaining, inv.currency, lang)}*`,
        '',
        company?.bank || company?.rib
          ? `RIB / IBAN : ${company?.bank || '—'} · ${company?.rib || '—'}`
          : null,
        company?.company_name ? `— ${company.company_name}` : null,
      ].filter((line): line is string => line !== null);

      setEmailModalInv(inv);
      setSendChannel(channel);
      setETo(cleanClientEmail);
      setECc('');
      setESubject(subject);
      setEMessage(lines.join('\n'));
      setWPhone(clientPhone);
      setWMessage(waLines.join('\n'));
    },
    [payments, clients, company, lang, t],
  );

  async function recordOrSendEmail(mode: 'smtp' | 'client_handoff', closeOnDone = true) {
    if (!emailModalInv) return;
    if (!isSimpleEmailValid(eTo)) {
      notify(t('inv.email.invalid_to'), 'error');
      return;
    }
    setESending(true);
    try {
      const res = await api<{ ok: boolean; mode: string; invoice: Invoice }>(
        `/api/invoices/${emailModalInv.id}/send-email`,
        {
          method: 'POST',
          body: JSON.stringify({
            to: eTo.trim(),
            cc: eCc.trim(),
            subject: eSubject.trim(),
            message: eMessage,
            mode,
          }),
        },
      );
      if (res.invoice) {
        setInvoices((prev) => prev.map((x) => (x.id === res.invoice.id ? res.invoice : x)));
        setEmailModalInv(res.invoice);
      }
      notify(
        mode === 'smtp'
          ? t('inv.email.sent_ok', { to: eTo.trim() })
          : t('inv.email.marked_ok', { to: eTo.trim() }),
        'success',
      );
      if (closeOnDone) {
        setEmailModalInv(null);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur envoi e-mail.', 'error');
    } finally {
      setESending(false);
    }
  }

  async function recordWhatsAppSend(closeOnDone = true) {
    if (!emailModalInv) return;
    const norm = normalizeWhatsAppNumber(wPhone);
    if (wPhone.trim() && !norm.valid) {
      notify(t('inv.wa.invalid_phone'), 'error');
      return;
    }
    setWSending(true);
    try {
      const res = await api<{ ok: boolean; invoice: Invoice }>(
        `/api/invoices/${emailModalInv.id}/send-whatsapp`,
        {
          method: 'POST',
          body: JSON.stringify({
            phone: norm.digits || wPhone.trim(),
            message: wMessage,
          }),
        },
      );
      if (res.invoice) {
        setInvoices((prev) => prev.map((x) => (x.id === res.invoice.id ? res.invoice : x)));
        setEmailModalInv(res.invoice);
      }
      notify(t('inv.wa.marked_ok'), 'success');
      if (closeOnDone) {
        setEmailModalInv(null);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur envoi WhatsApp.', 'error');
    } finally {
      setWSending(false);
    }
  }

  const openInvoiceForm = useCallback(
    (inv: Invoice | null = null, forceTripId?: string) => {
      if (!canManage) return;
      const usedTrips = new Set(invoices.map((i) => i.trip_id));
      const available = trips.filter((tr) => !usedTrips.has(tr.id));
      if (!inv && available.length === 0) {
        notify('Aucune mission disponible sans facture.', 'info');
        return;
      }
      if (forceTripId && !available.some((tr) => tr.id === forceTripId)) {
        notify('Cette mission possède déjà une facture.', 'info');
        return;
      }
      setEditingInv(inv);
      const selectedTrip = forceTripId
        ? trips.find((tr) => tr.id === forceTripId)
        : undefined;
      setFTripId(inv?.trip_id || forceTripId || '');
      setFDesc(
        inv?.service_description ||
          (selectedTrip
            ? `Transport ${selectedTrip.departure} - ${selectedTrip.destination} · ${selectedTrip.reference}`
            : ''),
      );
      setFBasis(inv?.amount_basis || '');
      setFAmount(
        inv
          ? String(inv.entered_amount)
          : selectedTrip
            ? String(selectedTrip.revenue || '')
            : '',
      );
      setFTax(inv ? String(inv.tax_rate) : '14');
      setFIssue(inv?.issue_date || new Date().toISOString().slice(0, 10));
      setFDue(inv?.due_date || '');
      setFNotes(inv?.notes || '');
      setFormOpen(true);
    },
    [canManage, invoices, trips, notify],
  );

  useEffect(() => {
    if (presetTripId && !loading) {
      openInvoiceForm(null, presetTripId);
      onClearPreset();
    }
  }, [presetTripId, loading, openInvoiceForm, onClearPreset]);

  async function saveInvoice(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        trip_id: fTripId,
        service_description: fDesc.trim(),
        amount_basis: fBasis,
        entered_amount: Number(fAmount),
        tax_rate: Number(fTax),
        issue_date: fIssue,
        due_date: fDue || null,
        notes: fNotes.trim() || null,
      };
      let saved: Invoice;
      if (editingInv) {
        saved = await api<Invoice>(`/api/invoices/${editingInv.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        notify(t('common.save'), 'success');
      } else {
        saved = await api<Invoice>('/api/invoices', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        notify(t('common.save'), 'success');
      }
      setFormOpen(false);
      await load();
      setDetailId(saved.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur facture.', 'error');
    }
  }

  function openPaymentModal(inv: Invoice, remaining: number, existing: InvoicePayment | null = null) {
    const avail = remaining + (existing ? Number(existing.amount) : 0);
    setPayModalInv(inv);
    setEditingPayment(existing);
    setPDate(existing?.payment_date || new Date().toISOString().slice(0, 10));
    setPAmount(existing ? String(existing.amount) : avail.toFixed(2));
    setPMethod(existing?.payment_method || '');
    setPRef(existing?.reference || '');
    setPNotes(existing?.notes || '');
  }

  async function savePayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payModalInv) return;
    try {
      const payload = {
        payment_date: pDate,
        amount: Number(pAmount),
        payment_method: pMethod || null,
        reference: pRef.trim() || null,
        notes: pNotes.trim() || null,
      };
      if (editingPayment) {
        await api(`/api/invoice-payments/${editingPayment.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await api(`/api/invoices/${payModalInv.id}/payments`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      notify(t('common.save'), 'success');
      setPayModalInv(null);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur règlement.', 'error');
    }
  }

  async function openSettingsModal() {
    try {
      const res = await api<InvoiceSettings>('/api/invoice-settings');
      setIset(res);
      setSettingsOpen(true);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur paramètres.', 'error');
    }
  }

  const sumsByCurrency: Record<string, { total: number; paid: number; left: number }> = {};
  invoices.forEach((x) => {
    const c = x.currency || 'MAD';
    if (!sumsByCurrency[c]) sumsByCurrency[c] = { total: 0, paid: 0, left: 0 };
    const st = invoicePaymentState(x, payments);
    sumsByCurrency[c].total += Number(x.total_ttc || 0);
    sumsByCurrency[c].paid += st.paid;
    sumsByCurrency[c].left += st.remaining;
  });

  const usedTripIds = new Set(invoices.map((i) => i.trip_id));
  const availableTrips = trips.filter((tr) => !usedTripIds.has(tr.id));

  const detailInv = invoices.find((i) => i.id === detailId) || null;
  const detailPayments = detailInv ? payments.filter((p) => p.invoice_id === detailInv.id) : [];
  const detailState = detailInv ? invoicePaymentState(detailInv, detailPayments) : null;

  const statusTone = (rawLabel: string) =>
    rawLabel === 'Payée'
      ? 'green'
      : rawLabel === 'Annulée'
        ? 'red'
        : rawLabel === 'Brouillon' || rawLabel === 'Non réglée'
          ? 'amber'
          : 'blue';

  const translatePaymentMethod = (method: string | null) => {
    if (!method) return t('inv.rec.not_spec');
    if (method === 'Virement') return t('inv.pay.m.transfer');
    if (method === 'Espèces') return t('inv.pay.m.cash');
    if (method === 'Chèque') return t('inv.pay.m.check');
    if (method === 'Carte') return t('inv.pay.m.card');
    if (method === 'Autre') return t('inv.pay.m.other');
    return method;
  };

  const exportInvoicesCsv = () => {
    const today = new Date().toISOString().slice(0, 10);
    downloadExcelCsv(
      `factures-${today}.csv`,
      [
        t('inv.col.no'),
        t('driver.mission_label'),
        t('trips.col.client'),
        t('inv.csv.ice'),
        t('common.date'),
        t('inv.csv.due'),
        t('common.currency'),
        t('inv.csv.ht'),
        t('inv.csv.tva'),
        t('inv.col.ttc'),
        t('inv.col.paid'),
        t('inv.col.bal'),
        t('common.status'),
      ],
      invoices.map((x) => {
        const st = invoicePaymentState(x, payments);
        const rawLabel = invoiceStatusLabel(x, payments);
        return [
          x.invoice_number,
          x.mission_reference,
          x.client_name,
          x.client_ice || '',
          x.issue_date,
          x.due_date || '',
          x.currency,
          Number(x.subtotal_ht || 0).toFixed(2),
          Number(x.tax_amount || 0).toFixed(2),
          Number(x.total_ttc || 0).toFixed(2),
          Number(st.paid || 0).toFixed(2),
          Number(st.remaining || 0).toFixed(2),
          invoiceStatusText(rawLabel),
        ];
      }),
    );
  };

  const exportPaymentsCsv = () => {
    const today = new Date().toISOString().slice(0, 10);
    downloadExcelCsv(
      `reglements-${today}.csv`,
      [
        t('inv.col.no'),
        t('trips.col.client'),
        t('inv.pay.date'),
        t('common.amount'),
        t('common.currency'),
        t('inv.pay_method'),
        t('common.ref'),
        t('common.notes'),
      ],
      payments.map((p) => {
        const inv = invoices.find((i) => i.id === p.invoice_id);
        return [
          inv?.invoice_number || p.invoice_id,
          inv?.client_name || '',
          p.payment_date,
          Number(p.amount || 0).toFixed(2),
          p.currency || inv?.currency || 'MAD',
          translatePaymentMethod(p.payment_method),
          p.reference || '',
          p.notes || '',
        ];
      }),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 no-print">
        {canManage && (
          <button
            type="button"
            onClick={() => openInvoiceForm(null)}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white"
          >
            {t('inv.new')}
          </button>
        )}
        {isAdmin && (
          <button
            type="button"
            onClick={openSettingsModal}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800"
          >
            {t('inv.num_settings')}
          </button>
        )}
        {invoices.length > 0 && (
          <button
            type="button"
            onClick={exportInvoicesCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-[#17324d]"
          >
            <Download className="w-4 h-4" />
            {t('inv.export_invoices')}
          </button>
        )}
        {payments.length > 0 && (
          <button
            type="button"
            onClick={exportPaymentsCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-[#17324d]"
          >
            <Download className="w-4 h-4" />
            {t('inv.export_payments')}
          </button>
        )}
      </div>

      <div className="no-print">
        <InfoBanner>{t('inv.banner')}</InfoBanner>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 no-print">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-semibold text-slate-500">{t('inv.kpi.count')}</div>
          <div className="text-2xl font-extrabold font-mono text-[#17324d] mt-1 tabular-nums">
            {invoices.length}
          </div>
        </div>
        {Object.entries(sumsByCurrency).map(([c, v]) => (
          <div key={c} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-semibold text-slate-500">
              {t('inv.kpi.billed', { cur: c })}
            </div>
            <div className="text-2xl font-extrabold font-mono text-[#17324d] mt-1 tabular-nums">
              {money(v.total, c, lang)}
            </div>
            <div className="text-xs text-slate-500 font-mono mt-1.5 tabular-nums">
              {t('inv.kpi.paid')} {money(v.paid, c, lang)} · {t('inv.kpi.bal')} {money(v.left, c, lang)}
            </div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500 no-print">
          {t('common.loading')}
        </div>
      ) : invoices.length === 0 ? (
        <div className="no-print">
          <EmptyState title={t('inv.empty_title')} description={t('inv.empty_desc')} />
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto no-print">
          <table className="w-full min-w-[860px] text-start border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                <th className="px-3.5 py-3">{t('inv.col.no')}</th>
                <th className="px-3.5 py-3">{t('driver.mission_label')}</th>
                <th className="px-3.5 py-3">{t('trips.col.client')}</th>
                <th className="px-3.5 py-3">{t('common.date')}</th>
                <th className="px-3.5 py-3 text-end">{t('inv.col.ttc')}</th>
                <th className="px-3.5 py-3 text-end">{t('inv.col.paid')}</th>
                <th className="px-3.5 py-3 text-end">{t('inv.col.bal')}</th>
                <th className="px-3.5 py-3">{t('common.status')}</th>
                <th className="px-3.5 py-3">{t('common.action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((x) => {
                const s = invoicePaymentState(x, payments);
                const rawLabel = invoiceStatusLabel(x, payments);
                return (
                  <tr key={x.id} className="hover:bg-slate-50/70">
                    <td className="px-3.5 py-2.5 font-mono font-bold text-[#17324d]">
                      {x.invoice_number}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-slate-700">{x.mission_reference}</td>
                    <td className="px-3.5 py-2.5 text-slate-800">{x.client_name}</td>
                    <td className="px-3.5 py-2.5 font-mono text-slate-600">
                      {dateText(x.issue_date, lang)}
                    </td>
                    <td className="px-3.5 py-2.5 text-end font-mono font-semibold tabular-nums">
                      {money(x.total_ttc, x.currency, lang)}
                    </td>
                    <td className="px-3.5 py-2.5 text-end font-mono tabular-nums">
                      {money(s.paid, x.currency, lang)}
                    </td>
                    <td className="px-3.5 py-2.5 text-end font-mono font-semibold tabular-nums">
                      {money(s.remaining, x.currency, lang)}
                    </td>
                    <td className="px-3.5 py-2.5">
                      <div className="space-y-1">
                        <StatusText label={invoiceStatusText(rawLabel)} tone={statusTone(rawLabel)} />
                        {x.last_emailed_at && (
                          <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                            <CheckCircle2 className="w-2.5 h-2.5" />
                            <span>{t('inv.email.sent_badge', { date: dateText(x.last_emailed_at.slice(0, 10), lang) })}</span>
                          </div>
                        )}
                        {x.last_whatsapp_at && (
                          <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded">
                            <MessageCircle className="w-2.5 h-2.5" />
                            <span>{t('inv.wa.sent_badge', { date: dateText(x.last_whatsapp_at.slice(0, 10), lang) })}</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3.5 py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => setDetailId(x.id)}
                          className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                        >
                          {t('trips.detail_btn')}
                        </button>
                        {canManage && (
                          <>
                            <button
                              type="button"
                              onClick={() => openSendModal(x, 'email')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 font-semibold"
                            >
                              <Mail className="w-3 h-3" />
                              {t('inv.email.btn')}
                            </button>
                            <button
                              type="button"
                              onClick={() => openSendModal(x, 'whatsapp')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-green-50 hover:bg-green-100 text-green-800 border border-green-200 font-semibold"
                            >
                              <MessageCircle className="w-3 h-3" />
                              {t('inv.wa.btn')}
                            </button>
                          </>
                        )}
                        {x.status === 'validated' && canManage && s.remaining > 0 && (
                          <button
                            type="button"
                            onClick={() => openPaymentModal(x, s.remaining)}
                            className="px-2.5 py-1 rounded-md bg-[#2367a5] text-white font-semibold"
                          >
                            {t('inv.btn_pay')}
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() =>
                              setConfirm({
                                open: true,
                                title: t('inv.del_title'),
                                message: t('inv.del_msg', { no: x.invoice_number }),
                                confirmLabel: t('common.delete'),
                                danger: true,
                                onConfirm: async () => {
                                  try {
                                    await api(`/api/invoices/${x.id}`, { method: 'DELETE' });
                                    notify(t('common.delete'), 'success');
                                    setDetailId(null);
                                    await load();
                                  } catch (err) {
                                    notify(
                                      err instanceof Error ? err.message : 'Suppression refusée.',
                                      'error',
                                    );
                                  }
                                },
                              })
                            }
                            className="px-2.5 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-700 font-semibold"
                          >
                            {t('common.delete')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Invoice Form Modal */}
      <Modal
        open={formOpen}
        title={editingInv ? t('inv.form.edit', { no: editingInv.invoice_number }) : t('inv.form.new')}
        onClose={() => setFormOpen(false)}
        maxWidth="max-w-2xl"
      >
        <form onSubmit={saveInvoice} className="space-y-4">
          <InfoBanner>{t('inv.form.banner')}</InfoBanner>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('driver.mission_label')} *
              </label>
              {editingInv ? (
                <input
                  disabled
                  value={editingInv.mission_reference}
                  className="w-full px-3 py-2 text-sm border border-slate-200 bg-slate-100 rounded-lg"
                />
              ) : (
                <select
                  required
                  value={fTripId}
                  onChange={(e) => {
                    const tid = e.target.value;
                    setFTripId(tid);
                    const tr = availableTrips.find((x) => x.id === tid);
                    if (tr) {
                      setFAmount(String(tr.revenue || ''));
                      setFDesc(`Transport ${tr.departure} - ${tr.destination} · ${tr.reference}`);
                    }
                  }}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">{t('inv.form.select_trip')}</option>
                  {availableTrips.map((tr) => (
                    <option key={tr.id} value={tr.id}>
                      {tr.reference} · {tr.departure} → {tr.destination}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('inv.form.service')}
              </label>
              <textarea
                required
                value={fDesc}
                onChange={(e) => setFDesc(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('inv.form.basis')}
              </label>
              <select
                required
                value={fBasis}
                onChange={(e) => setFBasis(e.target.value as 'HT' | 'TTC')}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="">{t('inv.form.basis_ph')}</option>
                <option value="HT">HT</option>
                <option value="TTC">TTC</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('inv.form.amt')}
                {(() => {
                  const cur = editingInv?.currency || availableTrips.find((tr) => tr.id === fTripId)?.currency;
                  return cur ? ` (${cur})` : '';
                })()}
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={fAmount}
                onChange={(e) => setFAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('inv.form.tax')}
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                required
                value={fTax}
                onChange={(e) => setFTax(e.target.value)}
                placeholder="14 / 20"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('inv.form.issue')}
              </label>
              <input
                type="date"
                required
                value={fIssue}
                onChange={(e) => setFIssue(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('inv.form.due')}
              </label>
              <input
                type="date"
                value={fDue}
                onChange={(e) => setFDue(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('inv.form.notes')}
              </label>
              <textarea
                value={fNotes}
                onChange={(e) => setFNotes(e.target.value)}
                rows={2}
                placeholder={t('inv.form.notes_ph')}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700"
            >
              {t('common.cancel')}
            </button>
            <button type="submit" className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] text-white">
              {t('common.save')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Invoice Detail Modal */}
      <Modal
        open={!!detailInv}
        title={detailInv ? `${t('inv.doc_title')} ${detailInv.invoice_number}` : ''}
        onClose={() => setDetailId(null)}
        maxWidth="max-w-4xl"
      >
        {detailInv && detailState && (
          <div className="space-y-5">
            <div className="border border-slate-200 rounded-xl p-5 bg-white space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-extrabold text-[#17324d]">{t('inv.doc_title')}</h3>
                  <p className="text-xs text-slate-500">{t('inv.doc_sub')}</p>
                </div>
                <div className="text-end">
                  <div className="text-lg font-extrabold font-mono text-[#17324d]">
                    {detailInv.invoice_number}
                  </div>
                  <StatusText
                    label={invoiceStatusText(invoiceStatusLabel(detailInv, detailPayments))}
                    tone={statusTone(invoiceStatusLabel(detailInv, detailPayments))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                {[
                  [t('trips.col.client'), detailInv.client_name],
                  [t('common.ice'), detailInv.client_ice],
                  [t('common.address'), detailInv.client_address],
                  [t('common.email'), detailInv.client_email],
                  [t('driver.mission_label'), detailInv.mission_reference],
                  [t('common.date'), dateText(detailInv.issue_date, lang)],
                  [t('inv.form.due'), dateText(detailInv.due_date, lang)],
                  [t('common.currency'), detailInv.currency],
                ].map(([k, v]) => (
                  <div key={k} className="bg-slate-50 rounded-lg p-2.5">
                    <div className="text-[11px] font-semibold text-slate-500">{k}</div>
                    <div className="font-bold text-[#17324d] mt-0.5 break-words">{v}</div>
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-200 pt-3">
                <div className="text-xs font-bold text-slate-500 mb-1">{t('inv.service')}</div>
                <p className="text-sm text-slate-800">{detailInv.service_description}</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 border-t border-slate-200 pt-3 text-xs">
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <div className="text-[11px] text-slate-500">{t('inv.base_ht')}</div>
                  <div className="font-mono font-bold text-sm text-[#17324d] tabular-nums">
                    {money(detailInv.subtotal_ht, detailInv.currency, lang)}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <div className="text-[11px] text-slate-500">
                    {t('inv.tva', { rate: detailInv.tax_rate })}
                  </div>
                  <div className="font-mono font-bold text-sm text-[#17324d] tabular-nums">
                    {money(detailInv.tax_amount, detailInv.currency, lang)}
                  </div>
                </div>
                <div className="bg-[#eef4f8] rounded-lg p-2.5">
                  <div className="text-[11px] text-[#17324d]">{t('inv.col.ttc')}</div>
                  <div className="font-mono font-extrabold text-base text-[#17324d] tabular-nums">
                    {money(detailInv.total_ttc, detailInv.currency, lang)}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <div className="text-[11px] text-slate-500">{t('inv.remaining')}</div>
                  <div className="font-mono font-extrabold text-base text-[#17324d] tabular-nums">
                    {money(detailState.remaining, detailInv.currency, lang)}
                  </div>
                </div>
              </div>

              {detailInv.notes && (
                <div className="border-t border-slate-200 pt-3 text-xs">
                  <div className="font-bold text-slate-600 mb-1">{t('inv.form.notes')} :</div>
                  <p className="text-slate-700 whitespace-pre-wrap">{detailInv.notes}</p>
                </div>
              )}

              {company && company.stamp_enabled !== false && (
                <div className="border-t border-slate-200 pt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs font-semibold text-slate-500">
                    {t('inv.stamp.title')}
                  </div>
                  <div className="flex justify-end">
                    <CompanyStamp company={company} compact />
                  </div>
                </div>
              )}
            </div>

            {/* Payments History */}
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-[#17324d]">{t('inv.pay_history')}</h3>
              <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full text-start border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                      <th className="px-3 py-2">{t('common.date')}</th>
                      <th className="px-3 py-2 text-end">{t('common.amount')}</th>
                      <th className="px-3 py-2">{t('inv.pay_method')}</th>
                      <th className="px-3 py-2">{t('common.ref')}</th>
                      <th className="px-3 py-2">{t('common.notes')}</th>
                      <th className="px-3 py-2">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detailPayments.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                          {t('inv.pay_none')}
                        </td>
                      </tr>
                    ) : (
                      detailPayments.map((p) => (
                        <tr key={p.id}>
                          <td className="px-3 py-2 font-mono">{dateText(p.payment_date, lang)}</td>
                          <td className="px-3 py-2 text-end font-mono font-semibold tabular-nums">
                            {money(p.amount, p.currency || detailInv.currency, lang)}
                          </td>
                          <td className="px-3 py-2">{translatePaymentMethod(p.payment_method)}</td>
                          <td className="px-3 py-2 font-mono">{p.reference || '—'}</td>
                          <td className="px-3 py-2 text-slate-600">{p.notes || '—'}</td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => setPrintReceiptModal({ inv: detailInv, payment: p })}
                                className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 font-semibold"
                              >
                                {t('inv.receipt')}
                              </button>
                              {canManage && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openPaymentModal(detailInv, detailState.remaining, p)}
                                    className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 font-semibold"
                                  >
                                    {t('common.edit')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setConfirm({
                                        open: true,
                                        title: t('inv.pay.del_title'),
                                        message: t('inv.pay.del_msg', {
                                          amt: money(p.amount, detailInv.currency, lang),
                                          date: dateText(p.payment_date, lang),
                                        }),
                                        confirmLabel: t('common.delete'),
                                        danger: true,
                                        onConfirm: async () => {
                                          await api(`/api/invoice-payments/${p.id}`, { method: 'DELETE' });
                                          notify(t('common.delete'), 'success');
                                          await load();
                                        },
                                      })
                                    }
                                    className="px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 font-semibold"
                                  >
                                    {t('common.delete')}
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
              <div className="flex flex-wrap gap-2">
                {detailInv.status === 'draft' && canManage && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setDetailId(null);
                        openInvoiceForm(detailInv);
                      }}
                      className="px-3.5 py-2 text-xs font-bold rounded-lg bg-slate-200 text-slate-800 hover:bg-slate-300"
                    >
                      {t('inv.edit_draft')}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirm({
                          open: true,
                          title: t('inv.validate'),
                          message: t('inv.validate_msg'),
                          confirmLabel: t('common.confirm'),
                          onConfirm: async () => {
                            await api(`/api/invoices/${detailInv.id}/validate`, { method: 'POST' });
                            notify(t('inv.validate'), 'success');
                            await load();
                          },
                        })
                      }
                      className="px-3.5 py-2 text-xs font-bold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white"
                    >
                      {t('inv.validate')}
                    </button>
                  </>
                )}
                {canManage && (
                  <button
                    type="button"
                    onClick={() => {
                      setNotesInv(detailInv);
                      setNotesDraft(detailInv.notes || '');
                    }}
                    className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"
                  >
                    {t('inv.form.notes')}
                  </button>
                )}
                {detailInv.status === 'validated' && canManage && detailState.remaining > 0 && (
                  <button
                    type="button"
                    onClick={() => openPaymentModal(detailInv, detailState.remaining)}
                    className="px-3.5 py-2 text-xs font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white"
                  >
                    {t('inv.add_payment')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPrintInvoiceModal({ inv: detailInv, model: 1 })}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#17324d] text-white hover:bg-[#11253a]"
                >
                  <Printer className="w-3.5 h-3.5" />
                  {t('inv.preview_pdf')}
                </button>
                {canManage && (
                  <>
                    <button
                      type="button"
                      onClick={() => openSendModal(detailInv, 'email')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      {t('inv.email.btn_long')}
                    </button>
                    <button
                      type="button"
                      onClick={() => openSendModal(detailInv, 'whatsapp')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-green-50 hover:bg-green-100 text-green-800 border border-green-200"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      {t('inv.wa.btn_long')}
                    </button>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDetailId(null)}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Payment Form Modal */}
      <Modal
        open={!!payModalInv}
        title={
          payModalInv
            ? `${editingPayment ? t('inv.pay.edit') : t('inv.pay.new')} · ${payModalInv.invoice_number}`
            : ''
        }
        onClose={() => setPayModalInv(null)}
        maxWidth="max-w-lg"
      >
        <form onSubmit={savePayment} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('inv.pay.date')}
              </label>
              <input
                type="date"
                required
                value={pDate}
                onChange={(e) => setPDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('common.amount')} *
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={pAmount}
                onChange={(e) => setPAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('inv.pay_method')}
              </label>
              <select
                value={pMethod}
                onChange={(e) => setPMethod(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="">{t('common.choose')}</option>
                <option value="Virement">{t('inv.pay.m.transfer')}</option>
                <option value="Espèces">{t('inv.pay.m.cash')}</option>
                <option value="Chèque">{t('inv.pay.m.check')}</option>
                <option value="Carte">{t('inv.pay.m.card')}</option>
                <option value="Autre">{t('inv.pay.m.other')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.ref')}</label>
              <input
                value={pRef}
                onChange={(e) => setPRef(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.notes')}</label>
              <textarea
                value={pNotes}
                onChange={(e) => setPNotes(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPayModalInv(null)}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700"
            >
              {t('common.cancel')}
            </button>
            <button type="submit" className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] text-white">
              {t('common.save')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Complementary Notes Modal */}
      <Modal
        open={!!notesInv}
        title={notesInv ? `${t('inv.form.notes')} · ${notesInv.invoice_number}` : ''}
        onClose={() => setNotesInv(null)}
        maxWidth="max-w-lg"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!notesInv) return;
            await api(`/api/invoices/${notesInv.id}/notes`, {
              method: 'PUT',
              body: JSON.stringify({ notes: notesDraft.trim() || null }),
            });
            notify(t('common.save'), 'success');
            setNotesInv(null);
            await load();
          }}
          className="space-y-4"
        >
          <InfoBanner>{t('inv.notes.banner')}</InfoBanner>
          <textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            rows={5}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setNotesInv(null)}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700"
            >
              {t('common.cancel')}
            </button>
            <button type="submit" className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] text-white">
              {t('common.save')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Numbering Settings Modal */}
      <Modal
        open={settingsOpen}
        title={t('inv.num_settings')}
        onClose={() => setSettingsOpen(false)}
        maxWidth="max-w-md"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await api('/api/invoice-settings', { method: 'PUT', body: JSON.stringify(iset) });
            notify(t('common.save'), 'success');
            setSettingsOpen(false);
          }}
          className="space-y-4"
        >
          <InfoBanner>{t('inv.set.banner')}</InfoBanner>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('inv.set.prefix')}
              </label>
              <input
                value={iset.prefix}
                onChange={(e) => setIset({ ...iset, prefix: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('inv.set.sep')}
              </label>
              <input
                value={iset.separator}
                onChange={(e) => setIset({ ...iset, separator: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('inv.set.pad')}
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={iset.padding_length}
                onChange={(e) => setIset({ ...iset, padding_length: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t('inv.set.next')}
              </label>
              <input
                type="number"
                min={1}
                value={iset.next_number}
                onChange={(e) => setIset({ ...iset, next_number: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700"
            >
              {t('common.cancel')}
            </button>
            <button type="submit" className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] text-white">
              {t('common.save')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Printable Invoice Modal (Model 1 vs Model 2) */}
      {printInvoiceModal && (
        <div className="fixed inset-0 z-50 bg-[#10243a]/70 overflow-y-auto p-4 flex flex-col items-center">
          <div className="w-full max-w-[210mm] bg-white rounded-xl p-4 mb-4 flex flex-wrap items-center justify-between gap-3 no-print shadow">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-600">{t('inv.print.model')}</span>
              <button
                type="button"
                onClick={() => setPrintInvoiceModal({ ...printInvoiceModal, model: 1 })}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${
                  printInvoiceModal.model === 1 ? 'bg-[#17324d] text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                {t('inv.print.m1')}
              </button>
              <button
                type="button"
                onClick={() => setPrintInvoiceModal({ ...printInvoiceModal, model: 2 })}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${
                  printInvoiceModal.model === 2 ? 'bg-[#17324d] text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                {t('inv.print.m2')}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {canManage && (
                <>
                  <button
                    type="button"
                    onClick={() => openSendModal(printInvoiceModal.inv, 'email')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    {t('inv.email.btn_long')}
                  </button>
                  <button
                    type="button"
                    onClick={() => openSendModal(printInvoiceModal.inv, 'whatsapp')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-green-50 hover:bg-green-100 text-green-800 border border-green-200"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    {t('inv.wa.btn_long')}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-[#2367a5] text-white"
              >
                <Printer className="w-3.5 h-3.5" />
                {t('common.print_pdf')}
              </button>
              <button
                type="button"
                onClick={() => setPrintInvoiceModal(null)}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700"
              >
                {t('common.close')}
              </button>
            </div>
          </div>

          <div
            className={`print-only-sheet bg-white w-full max-w-[210mm] min-h-[297mm] shadow-2xl text-[#263445] text-xs ${
              printInvoiceModal.model === 2 ? 'pt-[45mm] px-[12mm] pb-[12mm]' : 'p-[12mm]'
            }`}
          >
            {(() => {
              const inv = printInvoiceModal.inv;
              const invPays = payments.filter((p) => p.invoice_id === inv.id);
              const st = invoicePaymentState(inv, invPays);
              return (
                <div>
                  <div className="flex justify-between items-start border-b-4 border-[#17365d] pb-4">
                    {printInvoiceModal.model === 1 ? (
                      <div className="flex gap-3.5">
                        {company?.logo_url ? (
                          <img
                            src={company.logo_url}
                            alt="Logo"
                            className="max-w-[90px] max-h-[75px] object-contain"
                          />
                        ) : (
                          <div className="w-[75px] h-[65px] bg-[#edf2f7] text-[#17365d] grid place-items-center font-bold">
                            LOGO
                          </div>
                        )}
                        <div className="space-y-0.5 leading-snug">
                          <h2 className="text-[#17365d] text-base font-extrabold">{company?.company_name}</h2>
                          <p className="font-bold">{company?.activity}</p>
                          <p>
                            {company?.address} {company?.city ? `· ${company.city}` : ''}
                          </p>
                          <p>
                            {t('common.phone')} : {company?.phone} · {t('common.email')} : {company?.email}
                          </p>
                          <p>
                            {t('common.ice')} : {company?.ice} · IF : {company?.tax_id} · RC : {company?.rc} · TP :{' '}
                            {company?.tp}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div />
                    )}
                    <div className="text-end">
                      <h1 className="text-[#17365d] text-2xl font-extrabold">{t('inv.doc_title')}</h1>
                      <div className="text-sm font-bold font-mono text-[#b17b25] mt-1">
                        {inv.invoice_number}
                      </div>
                      <div className="inline-block mt-2 px-2.5 py-1 bg-[#edf2f7] rounded text-[11px] font-semibold">
                        {invoiceStatusText(invoiceStatusLabel(inv, invPays))}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-5">
                    <div>
                      <div className="text-[#17365d] font-bold uppercase border-b border-[#d7e0e8] pb-1 mb-2">
                        {t('inv.print.billed_to')}
                      </div>
                      <div className="bg-[#f5f7fa] border border-[#e1e7ed] rounded p-3 leading-relaxed">
                        <strong className="text-[#17365d]">{inv.client_name}</strong>
                        <br />
                        {t('common.ice')} : {inv.client_ice}
                        <br />
                        {inv.client_address}
                        <br />
                        {inv.client_email}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#17365d] font-bold uppercase border-b border-[#d7e0e8] pb-1 mb-2">
                        {t('inv.print.info')}
                      </div>
                      <div className="bg-[#f5f7fa] border border-[#e1e7ed] rounded p-3 leading-relaxed">
                        {t('inv.col.no')} : <strong>{inv.invoice_number}</strong>
                        <br />
                        {t('inv.print.issued')} {dateText(inv.issue_date, lang)}
                        <br />
                        {t('inv.print.due')} {dateText(inv.due_date, lang)}
                        <br />
                        {t('inv.print.trip_ref')} <strong>{inv.mission_reference}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="text-[#17365d] font-bold uppercase border-b border-[#d7e0e8] pb-1 mt-6 mb-2">
                    {t('inv.print.lines')}
                  </div>
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-[#17365d] text-white">
                        <th className="p-2.5 text-start">{t('inv.print.desc')}</th>
                        <th className="p-2.5 text-start">{t('inv.print.basis')}</th>
                        <th className="p-2.5 text-end">{t('inv.print.ht')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-[#e0e5ea]">
                        <td className="p-3">{inv.service_description}</td>
                        <td className="p-3">{inv.amount_basis}</td>
                        <td className="p-3 text-end font-mono tabular-nums">
                          {money(inv.subtotal_ht, inv.currency, lang)}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <table className="w-1/2 ms-auto mt-4 border-collapse">
                    <tbody>
                      <tr className="border-b border-[#e0e5ea]">
                        <td className="p-2">{t('inv.print.total_ht')}</td>
                        <td className="p-2 text-end font-mono tabular-nums">
                          {money(inv.subtotal_ht, inv.currency, lang)}
                        </td>
                      </tr>
                      <tr className="border-b border-[#e0e5ea]">
                        <td className="p-2">{t('inv.tva', { rate: inv.tax_rate })}</td>
                        <td className="p-2 text-end font-mono tabular-nums">
                          {money(inv.tax_amount, inv.currency, lang)}
                        </td>
                      </tr>
                      <tr className="bg-[#17365d] text-white font-bold text-sm">
                        <td className="p-2.5">{t('inv.print.total_ttc')}</td>
                        <td className="p-2.5 text-end font-mono tabular-nums">
                          {money(inv.total_ttc, inv.currency, lang)}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <div className="mt-4 p-3 bg-[#edf2f7] border border-[#d7e0e8] rounded">
                    <strong>{t('inv.print.pay_state')}</strong>
                    <br />
                    {t('inv.print.total_amt')} {money(inv.total_ttc, inv.currency, lang)} ·{' '}
                    {t('inv.print.paid_amt')} {money(st.paid, inv.currency, lang)} ·{' '}
                    <strong>
                      {t('inv.print.left_amt')} {money(st.remaining, inv.currency, lang)}
                    </strong>
                  </div>

                  {inv.notes && (
                    <div className="mt-4">
                      <div className="text-[#17365d] font-bold uppercase border-b border-[#d7e0e8] pb-1 mb-1.5">
                        {t('inv.form.notes')}
                      </div>
                      <p className="whitespace-pre-wrap">{inv.notes}</p>
                    </div>
                  )}

                  <div className="text-[#17365d] font-bold uppercase border-b border-[#d7e0e8] pb-1 mt-5 mb-2">
                    {t('inv.print.bank_title')}
                  </div>
                  <div className="bg-[#f5f7fa] p-3 rounded leading-relaxed">
                    {t('inv.print.bank')} {company?.bank || '—'}
                    <br />
                    RIB / IBAN : <span className="font-mono">{company?.rib || '—'}</span>
                    <br />
                    {t('inv.print.terms')} {company?.payment_terms || '—'}
                  </div>

                  {company && company.stamp_enabled !== false && (
                    <div className="mt-7 flex justify-end">
                      <div className="flex flex-col items-center">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[#17365d] mb-1.5">
                          {t('inv.stamp.title')}
                        </div>
                        <CompanyStamp company={company} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Printable Payment Receipt Modal */}
      {printReceiptModal && (
        <div className="fixed inset-0 z-50 bg-[#10243a]/70 overflow-y-auto p-4 flex flex-col items-center">
          <div className="w-full max-w-[190mm] bg-white rounded-xl p-4 mb-4 flex items-center justify-between no-print shadow">
            <span className="text-sm font-bold text-[#17324d]">{t('inv.rec.preview')}</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-[#2367a5] text-white"
              >
                <Printer className="w-3.5 h-3.5" />
                {t('common.print_pdf_short')}
              </button>
              <button
                type="button"
                onClick={() => setPrintReceiptModal(null)}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700"
              >
                {t('common.close')}
              </button>
            </div>
          </div>

          <div className="print-only-sheet bg-white w-full max-w-[190mm] p-8 shadow-2xl text-[#243342] text-sm">
            {(() => {
              const { inv, payment } = printReceiptModal;
              const invPays = payments.filter((p) => p.invoice_id === inv.id);
              const totalPaid = invPays.reduce((a, x) => a + Number(x.amount || 0), 0);
              const remaining = Math.max(0, Number(inv.total_ttc || 0) - totalPaid);
              const receiptNo = payment.reference || payment.id.slice(0, 8).toUpperCase();
              return (
                <div className="space-y-5">
                  <div className="flex justify-between items-start">
                    <div>
                      <h1 className="text-2xl font-extrabold text-[#17324d]">{t('inv.rec.title')}</h1>
                      <div className="text-slate-500">FRET MANAGER · {company?.company_name}</div>
                    </div>
                    <div className="text-end font-mono text-xs">
                      <div>
                        <strong>
                          {t('inv.doc_title')} : {inv.invoice_number}
                        </strong>
                      </div>
                      <div>
                        {t('inv.receipt')} : {receiptNo}
                      </div>
                      <div>
                        {t('common.date')} : {dateText(payment.payment_date, lang)}
                      </div>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-lg p-4">
                    <div className="font-bold text-[#17324d]">{t('inv.rec.from')}</div>
                    <div>{inv.client_name}</div>
                    <div>{inv.client_address}</div>
                    <div className="font-mono text-xs">
                      {t('common.ice')} : {inv.client_ice}
                    </div>
                  </div>

                  <div className="divide-y divide-slate-200 border-y border-slate-200">
                    <div className="py-2 flex justify-between">
                      <span>{t('inv.rec.inv')}</span>
                      <strong>{inv.invoice_number}</strong>
                    </div>
                    <div className="py-2 flex justify-between">
                      <span>{t('driver.mission_label')}</span>
                      <strong>{inv.mission_reference}</strong>
                    </div>
                    <div className="py-2 flex justify-between">
                      <span>{t('inv.rec.mode')}</span>
                      <strong>{translatePaymentMethod(payment.payment_method)}</strong>
                    </div>
                    <div className="py-2 flex justify-between">
                      <span>{t('inv.rec.pay_ref')}</span>
                      <strong>{payment.reference || '—'}</strong>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                    <div className="text-xs text-slate-500">{t('inv.rec.amt_rec')}</div>
                    <div className="text-2xl font-extrabold font-mono text-[#17324d] tabular-nums">
                      {money(payment.amount, inv.currency, lang)}
                    </div>
                  </div>

                  <div className="divide-y divide-slate-200 border-y border-slate-200">
                    <div className="py-2 flex justify-between">
                      <span>{t('inv.rec.total_inv')}</span>
                      <strong className="font-mono tabular-nums">
                        {money(inv.total_ttc, inv.currency, lang)}
                      </strong>
                    </div>
                    <div className="py-2 flex justify-between">
                      <span>{t('inv.rec.total_paid')}</span>
                      <strong className="font-mono tabular-nums">
                        {money(totalPaid, inv.currency, lang)}
                      </strong>
                    </div>
                    <div className="py-2 flex justify-between">
                      <span>{t('inv.remaining')}</span>
                      <strong className="font-mono tabular-nums">
                        {money(remaining, inv.currency, lang)}
                      </strong>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-12 pt-10">
                    <div className="border-t border-slate-400 pt-2 text-xs text-slate-600">
                      {t('inv.rec.comp_sig')}
                    </div>
                    <div className="border-t border-slate-400 pt-2 text-xs text-slate-600">
                      {t('inv.rec.cli_sig')}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Send Invoice By Email or WhatsApp Modal */}
      <Modal
        open={!!emailModalInv}
        title={emailModalInv ? t('inv.wa.modal_title', { no: emailModalInv.invoice_number }) : ''}
        onClose={() => setEmailModalInv(null)}
        maxWidth="max-w-2xl"
      >
        {emailModalInv && (() => {
          const mailtoHref = `mailto:${encodeURIComponent(eTo.trim())}?subject=${encodeURIComponent(eSubject)}&body=${encodeURIComponent(eMessage)}${eCc.trim() ? `&cc=${encodeURIComponent(eCc.trim())}` : ''}`;
          const gmailHref = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(eTo.trim())}&su=${encodeURIComponent(eSubject)}&body=${encodeURIComponent(eMessage)}${eCc.trim() ? `&cc=${encodeURIComponent(eCc.trim())}` : ''}`;
          const waNorm = normalizeWhatsAppNumber(wPhone);
          const waHref = waNorm.digits
            ? `https://wa.me/${waNorm.digits}?text=${encodeURIComponent(wMessage)}`
            : `https://api.whatsapp.com/send?text=${encodeURIComponent(wMessage)}`;

          return (
            <div className="space-y-4">
              {/* Channel switcher tabs */}
              <div className="flex gap-1.5 p-1 bg-slate-100 rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => setSendChannel('email')}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition ${
                    sendChannel === 'email'
                      ? 'bg-white text-[#17324d] shadow-xs'
                      : 'text-slate-600 hover:text-[#17324d]'
                  }`}
                >
                  <Mail className="w-3.5 h-3.5" />
                  {t('inv.wa.tab_email')}
                </button>
                <button
                  type="button"
                  onClick={() => setSendChannel('whatsapp')}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition ${
                    sendChannel === 'whatsapp'
                      ? 'bg-green-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-green-800'
                  }`}
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  {t('inv.wa.tab_whatsapp')}
                </button>
              </div>

              {sendChannel === 'email' ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (smtpConfigured) {
                      void recordOrSendEmail('smtp', true);
                    } else {
                      void recordOrSendEmail('client_handoff', true);
                    }
                  }}
                  className="space-y-4"
                >
                  <InfoBanner tone={smtpConfigured ? 'info' : 'info'}>
                    {smtpConfigured ? t('inv.email.smtp_ready') : t('inv.email.smtp_fallback')}
                  </InfoBanner>

                  {emailModalInv.last_emailed_at && (
                    <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        {t('inv.email.last_sent_info', {
                          date: dateText(emailModalInv.last_emailed_at.slice(0, 10), lang),
                          to: emailModalInv.last_emailed_to || '—',
                          count: emailModalInv.email_sent_count || 1,
                        })}
                      </span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        {t('inv.email.to')}
                      </label>
                      <input
                        type="email"
                        required
                        value={eTo}
                        onChange={(e) => setETo(e.target.value)}
                        placeholder="client@entreprise.com"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        {t('inv.email.cc')}
                      </label>
                      <input
                        type="text"
                        value={eCc}
                        onChange={(e) => setECc(e.target.value)}
                        placeholder={t('inv.email.cc_ph')}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        {t('inv.email.subject')}
                      </label>
                      <input
                        type="text"
                        required
                        value={eSubject}
                        onChange={(e) => setESubject(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        {t('inv.email.message')}
                      </label>
                      <textarea
                        required
                        rows={9}
                        value={eMessage}
                        onChange={(e) => setEMessage(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono leading-relaxed border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    <span>{t('inv.email.pdf_tip')}</span>
                    <button
                      type="button"
                      onClick={() => setPrintInvoiceModal({ inv: emailModalInv, model: 1 })}
                      className="inline-flex items-center gap-1 font-semibold text-[#2367a5] hover:underline"
                    >
                      <Printer className="w-3 h-3" />
                      {t('inv.preview_pdf')}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={mailtoHref}
                        onClick={(e) => {
                          if (!isSimpleEmailValid(eTo)) {
                            e.preventDefault();
                            notify(t('inv.email.invalid_to'), 'error');
                            return;
                          }
                          void recordOrSendEmail('client_handoff', false);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        {t('inv.email.open_mail_app')}
                      </a>
                      <a
                        href={gmailHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          if (!isSimpleEmailValid(eTo)) {
                            e.preventDefault();
                            notify(t('inv.email.invalid_to'), 'error');
                            return;
                          }
                          void recordOrSendEmail('client_handoff', false);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-[#17324d]"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        {t('inv.email.open_gmail')}
                      </a>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(`${eSubject}\n\n${eMessage}`);
                            notify(t('inv.email.copied'), 'success');
                          } catch {
                            notify('Impossible de copier automatiquement.', 'error');
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        {t('inv.email.copy_msg')}
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setEmailModalInv(null)}
                        className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700"
                      >
                        {t('common.close')}
                      </button>
                      <button
                        type="submit"
                        disabled={eSending}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white disabled:opacity-50"
                      >
                        <Send className="w-3.5 h-3.5" />
                        {eSending
                          ? t('inv.email.sending')
                          : smtpConfigured
                            ? t('inv.email.send_smtp')
                            : t('inv.email.mark_sent')}
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <InfoBanner tone="info">{t('inv.wa.info_banner')}</InfoBanner>

                  {emailModalInv.last_whatsapp_at && (
                    <div className="flex items-center gap-2 text-xs font-semibold text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        {t('inv.wa.last_sent_info', {
                          date: dateText(emailModalInv.last_whatsapp_at.slice(0, 10), lang),
                          to: emailModalInv.last_whatsapp_to || 'WhatsApp',
                          count: emailModalInv.whatsapp_sent_count || 1,
                        })}
                      </span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {t('inv.wa.phone')}
                    </label>
                    <input
                      type="tel"
                      value={wPhone}
                      onChange={(e) => setWPhone(e.target.value)}
                      placeholder="+212 6 12 34 56 78"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">{t('inv.wa.phone_hint')}</p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {t('inv.wa.message')}
                    </label>
                    <textarea
                      required
                      rows={9}
                      value={wMessage}
                      onChange={(e) => setWMessage(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono leading-relaxed border border-slate-300 rounded-lg"
                    />
                  </div>

                  <div className="text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    <span>{t('inv.email.pdf_tip')}</span>
                    <button
                      type="button"
                      onClick={() => setPrintInvoiceModal({ inv: emailModalInv, model: 1 })}
                      className="inline-flex items-center gap-1 font-semibold text-[#2367a5] hover:underline"
                    >
                      <Printer className="w-3 h-3" />
                      {t('inv.preview_pdf')}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={waHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          if (wPhone.trim() && !waNorm.valid) {
                            e.preventDefault();
                            notify(t('inv.wa.invalid_phone'), 'error');
                            return;
                          }
                          void recordWhatsAppSend(false);
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-green-600 hover:bg-green-700 text-white"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        {t('inv.wa.open_btn')}
                      </a>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(wMessage);
                            notify(t('inv.wa.copied'), 'success');
                          } catch {
                            notify('Impossible de copier automatiquement.', 'error');
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        {t('inv.wa.copy_btn')}
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setEmailModalInv(null)}
                        className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700"
                      >
                        {t('common.close')}
                      </button>
                      <button
                        type="button"
                        disabled={wSending}
                        onClick={() => void recordWhatsAppSend(true)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {t('inv.wa.mark_btn')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
