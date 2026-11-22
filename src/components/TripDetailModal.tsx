import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DocumentItem,
  Expense,
  LookupsData,
  PayrollAllocation,
  PublicProfile,
  Trip,
} from '../types.ts';
import { api, getAuthenticatedFileUrl, readFileAsBase64 } from '../lib/api.ts';
import { getTripTractorIds, inferFleetCategory } from '../lib/fleet.ts';
import { dateText, money } from '../lib/format.ts';
import { useI18n } from '../lib/i18n.tsx';
import { ConfirmDialog, type ConfirmState, Modal, StatusText } from './UI.tsx';
import { SignaturePad } from './SignaturePad.tsx';

interface TripDetailResponse {
  trip: Trip;
  expenses: Expense[];
  driverExpenses?: Expense[];
  documents: DocumentItem[];
  payrollAllocations: PayrollAllocation[];
}

export function TripDetailModal({
  tripId,
  profile,
  lookups,
  onClose,
  onCreateInvoice,
  onAddExpense,
  notify,
}: {
  tripId: string | null;
  profile: PublicProfile;
  lookups: LookupsData;
  onClose: () => void;
  onCreateInvoice?: (tripId: string) => void;
  onAddExpense?: (tripId: string) => void;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t, lang, tripStatusLabel } = useI18n();
  const [data, setData] = useState<TripDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadKind, setUploadKind] = useState<'document' | 'photo'>('document');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savingSig, setSavingSig] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<DocumentItem | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const docFileInputRef = useRef<HTMLInputElement | null>(null);
  const drvExpFileInputRef = useRef<HTMLInputElement | null>(null);
  const syncedTripRef = useRef<string | null>(null);

  // Driver road-expense declaration state
  const [drvExpType, setDrvExpType] = useState('');
  const [drvExpAmount, setDrvExpAmount] = useState('');
  const [drvExpCurrency, setDrvExpCurrency] = useState<'MAD' | 'EUR'>('MAD');
  const [drvExpDate, setDrvExpDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [drvExpDesc, setDrvExpDesc] = useState('');
  const [drvExpFile, setDrvExpFile] = useState<File | null>(null);
  const [drvExpSaving, setDrvExpSaving] = useState(false);

  const isDriver = profile.role === 'conducteur';
  const canViewFinancials = ['admin', 'comptable'].includes(profile.role);
  const canManageFiles = ['admin', 'logistique', 'conducteur'].includes(profile.role);
  const canFinance = ['admin', 'comptable'].includes(profile.role);

  const openPreview = (doc: DocumentItem) => {
    setPreviewError(false);
    setPreviewDoc(doc);
  };

  const inferClientMimeType = (file: File): string | null => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    const raw = (file.type || '').toLowerCase().trim();
    if (raw === 'image/jpg') return 'image/jpeg';
    if (allowed.includes(raw)) return raw;
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) return 'application/pdf';
    if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.webp')) return 'image/webp';
    return null;
  };

  const loadDetail = useCallback(async () => {
    if (!tripId) return;
    setLoading(true);
    try {
      const res = await api<TripDetailResponse>(`/api/trips/${tripId}/detail`);
      setData(res);
      if (syncedTripRef.current !== res.trip.id) {
        syncedTripRef.current = res.trip.id;
        setDrvExpCurrency(res.trip.currency === 'EUR' ? 'EUR' : 'MAD');
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur chargement détail.', 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  }, [tripId, notify, onClose]);

  useEffect(() => {
    syncedTripRef.current = null;
    loadDetail();
  }, [loadDetail]);

  if (!tripId) return null;

  const clientName =
    lookups.clients.find((c) => c.id === data?.trip.client_id)?.company_name || '—';
  const tractorRegs = data
    ? getTripTractorIds(data.trip)
        .map((id) => lookups.vehicles.find((v) => v.id === id)?.registration || id)
        .filter(Boolean)
    : [];
  const vehicleReg = tractorRegs.length > 0 ? tractorRegs.join(' · ') : '—';
  const trailerObj = data?.trip.trailer_id
    ? lookups.vehicles.find((v) => v.id === data.trip.trailer_id)
    : undefined;
  const trailerLabel = trailerObj
    ? `${t(`veh.cat.${inferFleetCategory(trailerObj)}`)} · ${trailerObj.registration}`
    : '—';
  const driverName =
    lookups.drivers.find((d) => d.id === data?.trip.driver_id)?.full_name || '—';

  const tripCurrency = data?.trip.currency || 'MAD';
  const activeExpenses = (data?.expenses || []).filter((e) => e.approval_status !== 'refusee');
  const expenseTotalSame = activeExpenses
    .filter((e) => e.currency === tripCurrency)
    .reduce((acc, e) => acc + Number(e.amount || 0), 0);
  const otherCurrencies: Record<string, number> = {};
  activeExpenses
    .filter((e) => e.currency !== tripCurrency)
    .forEach((e) => {
      otherCurrencies[e.currency] = (otherCurrencies[e.currency] || 0) + Number(e.amount || 0);
    });
  const otherCurText = Object.entries(otherCurrencies)
    .map(([c, v]) => money(v, c, lang))
    .join(' + ');

  async function handleUpload() {
    if (!selectedFile || !data) {
      notify('Choisissez un document ou une photo.', 'error');
      return;
    }
    const resolvedMime = inferClientMimeType(selectedFile);
    if (!resolvedMime) {
      notify('Format refusé. Formats acceptés : PDF, JPEG, PNG, WebP.', 'error');
      return;
    }
    if (selectedFile.size > 25 * 1024 * 1024) {
      notify('Fichier trop volumineux : limite 25 Mo.', 'error');
      return;
    }
    setUploading(true);
    try {
      const b64 = await readFileAsBase64(selectedFile);
      await api(`/api/trips/${data.trip.id}/files`, {
        method: 'POST',
        body: JSON.stringify({
          file_name: selectedFile.name,
          mime_type: resolvedMime,
          data_base64: b64,
          media_kind: uploadKind,
          document_name: selectedFile.name,
        }),
      });
      setSelectedFile(null);
      if (docFileInputRef.current) docFileInputRef.current.value = '';
      notify('Document ajouté à la mission.', 'success');
      await loadDetail();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur téléversement.', 'error');
    } finally {
      setUploading(false);
    }
  }

  async function handleReplace(doc: DocumentItem, file: File) {
    const resolvedMime = inferClientMimeType(file);
    if (!resolvedMime) {
      notify('Format refusé. Formats acceptés : PDF, JPEG, PNG, WebP.', 'error');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      notify('Fichier trop volumineux : limite 25 Mo.', 'error');
      return;
    }
    setConfirm({
      open: true,
      title: t('tdetail.replace_title'),
      message: t('tdetail.replace_msg', { old: doc.document_name, next: file.name }),
      confirmLabel: t('common.replace'),
      onConfirm: async () => {
        try {
          const b64 = await readFileAsBase64(file);
          await api(`/api/documents/${doc.id}/replace`, {
            method: 'PUT',
            body: JSON.stringify({
              file_name: file.name,
              mime_type: resolvedMime,
              data_base64: b64,
            }),
          });
          notify('Fichier remplacé avec succès.', 'success');
          await loadDetail();
        } catch (err) {
          notify(err instanceof Error ? err.message : 'Erreur de remplacement.', 'error');
        }
      },
    });
  }

  function handleDeleteDoc(doc: DocumentItem) {
    setConfirm({
      open: true,
      title: t('tdetail.del_doc_title'),
      message: t('tdetail.del_doc_msg', { name: doc.document_name }),
      confirmLabel: t('common.delete'),
      danger: true,
      onConfirm: async () => {
        try {
          await api(`/api/documents/${doc.id}`, { method: 'DELETE' });
          notify('Document supprimé.', 'success');
          await loadDetail();
        } catch (err) {
          notify(err instanceof Error ? err.message : 'Suppression refusée.', 'error');
        }
      },
    });
  }

  async function handleSaveSignature(dataUrl: string) {
    if (!data) return;
    setSavingSig(true);
    try {
      await api(`/api/trips/${data.trip.id}/files`, {
        method: 'POST',
        body: JSON.stringify({
          file_name: `signature_client_${data.trip.reference}.png`,
          mime_type: 'image/png',
          data_base64: dataUrl,
          media_kind: 'signature',
          document_name: `Signature client - ${data.trip.reference}.png`,
        }),
      });
      notify('Signature du client enregistrée.', 'success');
      await loadDetail();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur signature.', 'error');
    } finally {
      setSavingSig(false);
    }
  }

  async function handleSubmitDriverExpense(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    const amt = Number(drvExpAmount);
    if (!drvExpType.trim() || !Number.isFinite(amt) || amt <= 0) {
      notify('Nature de dépense et montant positif obligatoires.', 'error');
      return;
    }
    let resolvedReceiptMime: string | null = null;
    if (drvExpFile) {
      resolvedReceiptMime = inferClientMimeType(drvExpFile);
      if (!resolvedReceiptMime) {
        notify('Format justificatif refusé. Formats acceptés : PDF, JPEG, PNG, WebP.', 'error');
        return;
      }
      if (drvExpFile.size > 25 * 1024 * 1024) {
        notify('Justificatif trop volumineux : limite 25 Mo.', 'error');
        return;
      }
    }
    setDrvExpSaving(true);
    try {
      let receipt: {
        file_name: string;
        mime_type: string;
        data_base64: string;
        media_kind: 'document' | 'photo';
      } | null = null;
      if (drvExpFile && resolvedReceiptMime) {
        const b64 = await readFileAsBase64(drvExpFile);
        receipt = {
          file_name: drvExpFile.name,
          mime_type: resolvedReceiptMime,
          data_base64: b64,
          media_kind: resolvedReceiptMime === 'application/pdf' ? 'document' : 'photo',
        };
      }
      await api(`/api/trips/${data.trip.id}/driver-expenses`, {
        method: 'POST',
        body: JSON.stringify({
          expense_type: drvExpType.trim(),
          amount: amt,
          currency: drvExpCurrency,
          expense_date: drvExpDate || null,
          description: drvExpDesc.trim() || null,
          receipt,
        }),
      });
      setDrvExpType('');
      setDrvExpAmount('');
      setDrvExpDesc('');
      setDrvExpFile(null);
      if (drvExpFileInputRef.current) drvExpFileInputRef.current.value = '';
      notify(t('exp.status.pending'), 'success');
      await loadDetail();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur déclaration dépense.', 'error');
    } finally {
      setDrvExpSaving(false);
    }
  }

  function handleDeleteDriverExpense(exp: Expense) {
    setConfirm({
      open: true,
      title: t('tdetail.drv_exp_del_title'),
      message: t('tdetail.drv_exp_del_msg'),
      confirmLabel: t('common.delete'),
      danger: true,
      onConfirm: async () => {
        try {
          await api(`/api/driver-expenses/${exp.id}`, { method: 'DELETE' });
          notify('OK', 'success');
          await loadDetail();
        } catch (err) {
          notify(err instanceof Error ? err.message : 'Suppression impossible.', 'error');
        }
      },
    });
  }

  async function handleReviewExpense(exp: Expense, decision: 'validee' | 'refusee') {
    try {
      await api(`/api/expenses/${exp.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      notify(decision === 'validee' ? t('exp.status.approved') : t('exp.status.rejected'), 'success');
      await loadDetail();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Action impossible.', 'error');
    }
  }

  function expenseApprovalBadge(status?: Expense['approval_status']) {
    if (status === 'refusee') return { label: t('exp.status.rejected'), tone: 'red' as const };
    if (status === 'en_attente') return { label: t('exp.status.pending'), tone: 'amber' as const };
    return { label: t('exp.status.approved'), tone: 'green' as const };
  }

  return (
    <>
      <Modal
        open={!!tripId}
        title={data ? t('tdetail.title', { ref: data.trip.reference }) : t('tdetail.loading')}
        onClose={onClose}
        maxWidth="max-w-4xl"
      >
        {loading || !data ? (
          <div className="py-10 text-center text-sm text-slate-500">{t('common.loading')}</div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {[
                [t('trips.col.ref'), data.trip.reference],
                [t('trips.col.client'), clientName],
                [t('trips.col.vehicle'), vehicleReg],
                [t('trips.col.trailer'), trailerLabel],
                [t('trips.col.driver'), driverName],
                [t('driver.dep'), data.trip.departure],
                [t('driver.dst'), data.trip.destination],
                [t('driver.dep_date'), dateText(data.trip.departure_date, lang)],
                [t('driver.arr_date'), dateText(data.trip.arrival_date, lang)],
                [t('common.status'), tripStatusLabel(data.trip.status)],
                ...(canViewFinancials
                  ? [
                      [t('trips.col.rev'), money(data.trip.revenue, tripCurrency, lang)],
                      [
                        t('tdetail.exp_same', { cur: tripCurrency }),
                        money(expenseTotalSame, tripCurrency, lang),
                      ],
                      [
                        t('tdetail.prov_result'),
                        money(Number(data.trip.revenue || 0) - expenseTotalSame, tripCurrency, lang),
                      ],
                    ]
                  : []),
              ].map(([k, v]) => (
                <div key={k} className="bg-slate-50 border border-slate-200/70 rounded-lg p-3">
                  <div className="text-[11px] font-semibold text-slate-500">{k}</div>
                  <div className="text-sm font-bold text-[#17324d] mt-0.5 break-words">{v}</div>
                </div>
              ))}
              {canViewFinancials && otherCurText && (
                <div className="bg-slate-50 border border-slate-200/70 rounded-lg p-3">
                  <div className="text-[11px] font-semibold text-slate-500">
                    {t('tdetail.exp_other')}
                  </div>
                  <div className="text-sm font-bold text-[#17324d] mt-0.5">{otherCurText}</div>
                </div>
              )}
            </div>

            {/* Documents & photos */}
            <div className="border-t border-slate-200 pt-5 space-y-3">
              <h3 className="text-base font-bold text-[#17324d]">{t('tdetail.docs_title')}</h3>

              {data.documents.length === 0 ? (
                <p className="text-sm text-slate-500">{t('tdetail.docs_empty')}</p>
              ) : (
                <div className="space-y-2">
                  {data.documents.map((doc) => {
                    const linkedExp =
                      doc.document_type === 'Justificatif dépense'
                        ? (data.driverExpenses || []).find((e) => e.document_id === doc.id) ||
                          data.expenses.find((e) => e.document_id === doc.id)
                        : undefined;
                    const lockedReceiptForDriver =
                      profile.role === 'conducteur' &&
                      doc.document_type === 'Justificatif dépense' &&
                      Boolean(linkedExp && (linkedExp.approval_status || 'en_attente') !== 'en_attente');
                    const manageable =
                      ['admin', 'logistique'].includes(profile.role) ||
                      (profile.role === 'conducteur' &&
                        doc.uploaded_by === profile.id &&
                        !lockedReceiptForDriver);
                    return (
                      <div
                        key={doc.id}
                        className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200/70 rounded-lg px-3.5 py-2.5"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[#17324d] truncate">
                            {doc.document_name}
                          </div>
                          <div className="text-xs text-slate-500">
                            {doc.media_kind || doc.document_type} · {dateText(doc.created_at, lang)}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {doc.file_path && (
                            <button
                              type="button"
                              onClick={() => openPreview(doc)}
                              className="px-2.5 py-1.5 text-xs font-semibold rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-slate-100"
                            >
                              {t('common.open')}
                            </button>
                          )}
                          {manageable && (
                            <>
                              <label className="px-2.5 py-1.5 text-xs font-semibold rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 cursor-pointer">
                                {t('common.replace')}
                                <input
                                  type="file"
                                  accept="application/pdf,image/jpeg,image/png,image/webp"
                                  className="hidden"
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) handleReplace(doc, f);
                                    e.target.value = '';
                                  }}
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => handleDeleteDoc(doc)}
                                className="px-2.5 py-1.5 text-xs font-semibold rounded-md bg-red-50 text-red-700 hover:bg-red-100"
                              >
                                {t('common.delete')}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {canManageFiles && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3 mt-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        {t('tdetail.file_type')}
                      </label>
                      <select
                        value={uploadKind}
                        onChange={(e) => setUploadKind(e.target.value as 'document' | 'photo')}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="document">{t('tdetail.doc_pdf')}</option>
                        <option value="photo">{t('tdetail.photo')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        {t('tdetail.choose_file')}
                      </label>
                      <input
                        ref={docFileInputRef}
                        type="file"
                        accept="application/pdf,image/jpeg,image/png,image/webp"
                        capture="environment"
                        onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                        className="w-full text-xs text-slate-600 file:me-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-[#eef4f8] file:text-[#17324d] file:font-semibold"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={handleUpload}
                    className="px-4 py-2 text-xs font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white transition-colors disabled:opacity-50"
                  >
                    {uploading ? t('tdetail.uploading') : t('tdetail.upload_btn')}
                  </button>

                  <div className="pt-4 border-t border-slate-200">
                    <h4 className="text-sm font-bold text-[#17324d] mb-2">{t('tdetail.sign_title')}</h4>
                    <SignaturePad
                      onSave={handleSaveSignature}
                      saving={savingSig}
                      notify={notify}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Driver's own road expenses declaration (only visible to the assigned driver) */}
            {isDriver && (
              <div className="border-t border-slate-200 pt-5 space-y-4">
                <div>
                  <h3 className="text-base font-bold text-[#17324d]">{t('tdetail.drv_exp_title')}</h3>
                  <p className="text-xs text-slate-500 mt-1">{t('tdetail.drv_exp_hint')}</p>
                </div>

                {data.trip.driver_response === 'refused' ? null : (
                <form
                  onSubmit={handleSubmitDriverExpense}
                  className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        {t('exp.type_req')}
                      </label>
                      <input
                        required
                        value={drvExpType}
                        onChange={(e) => setDrvExpType(e.target.value)}
                        placeholder={t('exp.type_ph')}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
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
                        value={drvExpAmount}
                        onChange={(e) => setDrvExpAmount(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        {t('common.currency')}
                      </label>
                      <select
                        value={drvExpCurrency}
                        onChange={(e) => setDrvExpCurrency(e.target.value as 'MAD' | 'EUR')}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="MAD">MAD</option>
                        <option value="EUR">EUR</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        {t('common.date')}
                      </label>
                      <input
                        type="date"
                        value={drvExpDate}
                        onChange={(e) => setDrvExpDate(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        {t('tdetail.drv_exp_receipt')}
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          ref={drvExpFileInputRef}
                          type="file"
                          accept="application/pdf,image/jpeg,image/png,image/webp"
                          capture="environment"
                          onChange={(e) => setDrvExpFile(e.target.files?.[0] || null)}
                          className="w-full text-xs text-slate-600 file:me-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-[#eef4f8] file:text-[#17324d] file:font-semibold"
                        />
                        {drvExpFile && (
                          <button
                            type="button"
                            onClick={() => {
                              setDrvExpFile(null);
                              if (drvExpFileInputRef.current) drvExpFileInputRef.current.value = '';
                            }}
                            className="px-2 py-1 text-xs font-semibold rounded bg-slate-200 hover:bg-slate-300 text-slate-700 shrink-0"
                            aria-label={t('common.cancel')}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        {t('common.description')}
                      </label>
                      <input
                        value={drvExpDesc}
                        onChange={(e) => setDrvExpDesc(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={drvExpSaving}
                    className="px-4 py-2 text-xs font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white transition-colors disabled:opacity-50"
                  >
                    {drvExpSaving ? t('tdetail.drv_exp_submitting') : t('tdetail.drv_exp_submit')}
                  </button>
                </form>
                )}

                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    {t('tdetail.drv_exp_list')}
                  </h4>
                  {(data.driverExpenses || []).length === 0 ? (
                    <p className="text-sm text-slate-500">{t('tdetail.drv_exp_empty')}</p>
                  ) : (
                    <div className="space-y-1.5">
                      {(data.driverExpenses || []).map((exp) => {
                        const badge = expenseApprovalBadge(exp.approval_status || 'en_attente');
                        const receiptDoc = exp.document_id
                          ? data.documents.find((d) => d.id === exp.document_id)
                          : undefined;
                        return (
                          <div
                            key={exp.id}
                            className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200/70 rounded-lg px-3.5 py-2.5 text-xs"
                          >
                            <div className="space-y-0.5 min-w-0">
                              <div className="flex flex-wrap items-center gap-2 font-semibold text-[#17324d]">
                                <span>{exp.expense_type}</span>
                                <span className="font-mono">{money(exp.amount, exp.currency, lang)}</span>
                                <span className="font-mono text-slate-500">{dateText(exp.expense_date, lang)}</span>
                                <StatusText label={badge.label} tone={badge.tone} />
                              </div>
                              {exp.description && <div className="text-slate-500">{exp.description}</div>}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {receiptDoc && receiptDoc.file_path && (
                                <button
                                  type="button"
                                  onClick={() => openPreview(receiptDoc)}
                                  className="px-2.5 py-1 rounded-md bg-white border border-slate-300 text-slate-700 font-semibold hover:bg-slate-100"
                                >
                                  {t('tdetail.view_receipt')}
                                </button>
                              )}
                              {(exp.approval_status || 'en_attente') === 'en_attente' && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteDriverExpense(exp)}
                                  className="px-2.5 py-1 rounded-md bg-red-50 text-red-700 font-semibold hover:bg-red-100"
                                >
                                  {t('common.delete')}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Expenses (hidden from drivers & logistics) */}
            {canViewFinancials && (
              <div className="border-t border-slate-200 pt-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-bold text-[#17324d]">{t('tdetail.exp_title')}</h3>
                  {canFinance && onAddExpense && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onAddExpense(data.trip.id);
                      }}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-[#2367a5] text-white hover:bg-[#1b5386]"
                    >
                      {t('tdetail.add_exp')}
                    </button>
                  )}
                </div>
                {data.expenses.length === 0 ? (
                  <p className="text-sm text-slate-500">{t('tdetail.exp_empty')}</p>
                ) : (
                  <div className="space-y-1.5">
                    {data.expenses.map((exp) => {
                      const badge = expenseApprovalBadge(exp.approval_status);
                      const receiptDoc = exp.document_id
                        ? data.documents.find((d) => d.id === exp.document_id)
                        : undefined;
                      return (
                        <div
                          key={exp.id}
                          className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 rounded-lg px-3.5 py-2 text-xs"
                        >
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 font-semibold text-[#17324d]">
                              <span>{exp.expense_type}</span>
                              <span className="font-mono">{money(exp.amount, exp.currency, lang)}</span>
                              <span className="font-mono text-slate-500">{dateText(exp.expense_date, lang)}</span>
                              {exp.submitted_by_role === 'conducteur' && (
                                <span className="text-slate-500">· {t('exp.src.driver')}</span>
                              )}
                              {(exp.submitted_by_role === 'conducteur' || exp.approval_status) && (
                                <StatusText label={badge.label} tone={badge.tone} />
                              )}
                            </div>
                            {exp.description && <div className="text-slate-500">{exp.description}</div>}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            {receiptDoc && receiptDoc.file_path && (
                              <button
                                type="button"
                                onClick={() => openPreview(receiptDoc)}
                                className="px-2.5 py-1 rounded-md bg-white border border-slate-300 text-slate-700 font-semibold hover:bg-slate-100"
                              >
                                {t('tdetail.view_receipt')}
                              </button>
                            )}
                            {canFinance && exp.approval_status === 'en_attente' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleReviewExpense(exp, 'validee')}
                                  className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                                >
                                  {t('exp.approve')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleReviewExpense(exp, 'refusee')}
                                  className="px-2.5 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-700 font-semibold"
                                >
                                  {t('exp.reject')}
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap justify-between gap-2 pt-3 border-t border-slate-200">
              <div>
                {canFinance && onCreateInvoice && (
                  <button
                    type="button"
                    onClick={() => {
                      const tid = data.trip.id;
                      onClose();
                      onCreateInvoice(tid);
                    }}
                    className="px-4 py-2 text-xs font-bold rounded-lg bg-[#17324d] hover:bg-[#11253a] text-white"
                  >
                    {t('tdetail.create_inv')}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* File Preview Modal */}
      <Modal
        open={!!previewDoc}
        title={previewDoc?.document_name || t('tdetail.preview_title')}
        onClose={() => setPreviewDoc(null)}
        maxWidth="max-w-3xl"
      >
        {previewDoc && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <StatusText label={previewDoc.media_kind || previewDoc.document_type} tone="blue" />
              <a
                href={getAuthenticatedFileUrl(previewDoc.id)}
                download={previewDoc.document_name}
                className="px-3 py-1.5 rounded-lg bg-[#2367a5] text-white font-semibold hover:bg-[#1b5386]"
              >
                {t('tdetail.download_file')}
              </a>
            </div>
            {previewDoc.mime_type === 'application/pdf' ? (
              <iframe
                title={previewDoc.document_name}
                src={getAuthenticatedFileUrl(previewDoc.id)}
                className="w-full h-[65vh] border border-slate-200 rounded-lg"
              />
            ) : previewError ? (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 text-center text-sm text-slate-600">
                {t('tdetail.preview_error')}
              </div>
            ) : (
              <div className="flex justify-center bg-slate-50 border border-slate-200 rounded-lg p-4">
                <img
                  src={getAuthenticatedFileUrl(previewDoc.id)}
                  alt={previewDoc.document_name}
                  onError={() => setPreviewError(true)}
                  className="max-h-[65vh] object-contain rounded"
                />
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
