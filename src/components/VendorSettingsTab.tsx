import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Building2,
  Check,
  Copy,
  FilePlus2,
  FileText,
  KeyRound,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Shield,
  Trash2,
} from 'lucide-react';
import type {
  B2BDeploymentRequest,
  B2BPackCatalogItem,
  Currency,
  VendorAccountPublic,
  VendorBillingDoc,
  VendorBillingDocItem,
  VendorBillingDocStatus,
  VendorBillingDocType,
  VendorProfile,
  VendorSettings,
  VendorWorkspaceSummary,
} from '../types.ts';
import { readFileAsBase64, vendorApi } from '../lib/api.ts';
import { dateText, money } from '../lib/format.ts';
import { ConfirmDialog, InfoBanner, Modal, StatusText, type ConfirmState } from './UI.tsx';

type SettingsSection = 'company' | 'security' | 'billing';
type BillingFilter = 'all' | 'devis' | 'facture';

export function VendorSettingsTab({
  vendor,
  onVendorUpdated,
  settings,
  onSettingsUpdated,
  accounts,
  onAccountsUpdated,
  billingDocs,
  onBillingDocsUpdated,
  workspaces,
  requests,
  packs,
  initialSubSection,
  initialDraftFromRequest,
  onClearInitialDraft,
  notify,
}: {
  vendor: VendorProfile;
  onVendorUpdated: (v: VendorProfile) => void;
  settings: VendorSettings;
  onSettingsUpdated: (s: VendorSettings) => void;
  accounts: VendorAccountPublic[];
  onAccountsUpdated: (a: VendorAccountPublic[]) => void;
  billingDocs: VendorBillingDoc[];
  onBillingDocsUpdated: (docs: VendorBillingDoc[]) => void;
  workspaces: VendorWorkspaceSummary[];
  requests: B2BDeploymentRequest[];
  packs: B2BPackCatalogItem[];
  initialSubSection?: SettingsSection;
  initialDraftFromRequest?: B2BDeploymentRequest | null;
  onClearInitialDraft?: () => void;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [section, setSection] = useState<SettingsSection>(initialSubSection || 'company');

  // Company Settings Form
  const [companyForm, setCompanyForm] = useState<VendorSettings>(settings);
  const [savingCompany, setSavingCompany] = useState(false);

  // Logged-in Vendor Password & Profile Form
  const [profileFullName, setProfileFullName] = useState(vendor.full_name);
  const [profileRole, setProfileRole] = useState(vendor.company_role);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Account Reset Modal / Inline State
  const [resetTarget, setResetTarget] = useState<VendorAccountPublic | null>(null);
  const [resetPasswordInput, setResetPasswordInput] = useState('');
  const [resettingAccount, setResettingAccount] = useState(false);
  const [lastResetCredential, setLastResetCredential] = useState<{
    email: string;
    password: string;
  } | null>(null);

  // Billing Docs State
  const [billingFilter, setBillingFilter] = useState<BillingFilter>('all');
  const [editingDoc, setEditingDoc] = useState<Partial<VendorBillingDoc> | null>(null);
  const [savingDoc, setSavingDoc] = useState(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<VendorBillingDoc | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  useEffect(() => {
    setCompanyForm(settings);
  }, [settings]);

  useEffect(() => {
    setProfileFullName(vendor.full_name);
    setProfileRole(vendor.company_role);
  }, [vendor.full_name, vendor.company_role]);

  useEffect(() => {
    if (initialSubSection) {
      setSection(initialSubSection);
    }
  }, [initialSubSection]);

  const buildBlankDraft = (
    docType: VendorBillingDocType,
    fromReq?: B2BDeploymentRequest | null,
  ): Partial<VendorBillingDoc> => {
    const today = new Date().toISOString().slice(0, 10);
    const due = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    if (fromReq) {
      const cat = packs.find((p) => p.id === fromReq.pack) || packs[0];
      const cur: Currency = fromReq.currency === 'EUR' ? 'EUR' : 'MAD';
      const setup = cat ? (cur === 'EUR' ? cat.setup_fee_eur : cat.setup_fee_mad) : 0;
      const annual = cat ? (cur === 'EUR' ? cat.annual_fee_eur : cat.annual_fee_mad) : 0;
      const packName = cat?.name || fromReq.pack;
      const items: VendorBillingDocItem[] = [
        {
          id: `vbi_${Date.now()}_1`,
          description: `Déploiement & paramétrage initial — ${packName}`,
          details: `Configuration espace dédié, import flotte (${fromReq.fleet_size} véhicules) et formation`,
          quantity: 1,
          unit_price: setup,
          total_ht: setup,
        },
        {
          id: `vbi_${Date.now()}_2`,
          description: `Licence annuelle SaaS FRET MANAGER — ${packName}`,
          details: cat
            ? `Jusqu'à ${cat.max_vehicles >= 900 ? 'flotte illimitée' : `${cat.max_vehicles} véhicules`} · ${cat.max_users >= 900 ? 'utilisateurs illimités' : `${cat.max_users} comptes`}`
            : 'Abonnement annuel 12 mois',
          quantity: 1,
          unit_price: annual,
          total_ht: annual,
        },
      ];
      return {
        doc_type: docType,
        doc_number: '',
        request_id: fromReq.id,
        workspace_id:
          workspaces.find((w) => w.code === fromReq.provisioned_workspace_code)?.id || null,
        client_name: fromReq.company_name,
        client_contact: fromReq.contact_name,
        client_ice: '',
        client_phone: fromReq.phone,
        client_email: fromReq.email,
        client_address: '',
        currency: cur,
        issue_date: today,
        due_date: due,
        status: 'brouillon',
        tax_rate: companyForm.default_tax_rate ?? 20,
        items,
        notes: fromReq.notes || companyForm.payment_terms || '',
      };
    }

    return {
      doc_type: docType,
      doc_number: '',
      workspace_id: null,
      request_id: null,
      client_name: '',
      client_contact: '',
      client_ice: '',
      client_phone: '',
      client_email: '',
      client_address: '',
      currency: 'MAD',
      issue_date: today,
      due_date: due,
      status: 'brouillon',
      tax_rate: companyForm.default_tax_rate ?? 20,
      items: [
        {
          id: `vbi_${Date.now()}_1`,
          description: 'Abonnement annuel FRET MANAGER B2B',
          details: 'Licence 12 mois · Support & mises à jour inclus',
          quantity: 1,
          unit_price: 6900,
          total_ht: 6900,
        },
      ],
      notes: companyForm.payment_terms || '',
    };
  };

  useEffect(() => {
    if (initialDraftFromRequest) {
      setSection('billing');
      setEditingDoc(buildBlankDraft('devis', initialDraftFromRequest));
      onClearInitialDraft?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDraftFromRequest]);

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notify('Formats autorisés : PNG, JPG ou WEBP.', 'error');
      return;
    }
    if (file.size > 1024 * 1024) {
      notify('Logo trop volumineux (max 1 Mo).', 'error');
      return;
    }
    const b64 = await readFileAsBase64(file);
    setCompanyForm((prev) => ({ ...prev, logo_url: b64 }));
    notify('Logo chargé. Cliquez sur Enregistrer pour sauvegarder.', 'info');
  }

  async function handleSaveCompany(e: React.FormEvent) {
    e.preventDefault();
    setSavingCompany(true);
    try {
      const updated = await vendorApi<VendorSettings>('/api/vendor/settings', {
        method: 'PUT',
        body: JSON.stringify(companyForm),
      });
      setCompanyForm(updated);
      onSettingsUpdated(updated);
      notify('Informations société et paramètres de facturation enregistrés.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde.', 'error');
    } finally {
      setSavingCompany(false);
    }
  }

  async function handleSaveOwnPassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword || confirmPassword || currentPassword) {
      if (!currentPassword) {
        notify('Veuillez saisir votre mot de passe actuel.', 'error');
        return;
      }
      if (newPassword.trim().length < 6) {
        notify('Le nouveau mot de passe doit contenir au moins 6 caractères.', 'error');
        return;
      }
      if (newPassword !== confirmPassword) {
        notify('La confirmation du nouveau mot de passe ne correspond pas.', 'error');
        return;
      }
    }
    setSavingPassword(true);
    try {
      const res = await vendorApi<{
        ok: boolean;
        vendor: VendorProfile;
        accounts: VendorAccountPublic[];
      }>('/api/vendor/account/password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: currentPassword || undefined,
          new_password: newPassword.trim() || undefined,
          full_name: profileFullName.trim(),
          company_role: profileRole.trim(),
        }),
      });
      onVendorUpdated(res.vendor);
      onAccountsUpdated(res.accounts);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      notify(
        newPassword.trim()
          ? 'Mot de passe et profil mis à jour avec succès.'
          : 'Profil mis à jour.',
        'success',
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Modification impossible.', 'error');
    } finally {
      setSavingPassword(false);
    }
  }

  function generateStrongTempPassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let out = 'Fret';
    for (let i = 0; i < 6; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return `${out}!`;
  }

  async function handleResetAccountPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;
    const clean = resetPasswordInput.trim();
    if (clean.length < 6) {
      notify('Le mot de passe doit contenir au moins 6 caractères.', 'error');
      return;
    }
    setResettingAccount(true);
    try {
      const res = await vendorApi<{
        ok: boolean;
        account: VendorAccountPublic;
        accounts: VendorAccountPublic[];
      }>(`/api/vendor/accounts/${encodeURIComponent(resetTarget.id)}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ new_password: clean }),
      });
      onAccountsUpdated(res.accounts);
      setLastResetCredential({ email: resetTarget.email, password: clean });
      setResetTarget(null);
      setResetPasswordInput('');
      notify(`Mot de passe réinitialisé pour ${resetTarget.email}.`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Réinitialisation impossible.', 'error');
    } finally {
      setResettingAccount(false);
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify('Copié dans le presse-papiers.', 'success');
    } catch {
      notify('Copie manuelle requise.', 'info');
    }
  }

  const filteredBillingDocs = useMemo(() => {
    if (billingFilter === 'all') return billingDocs;
    return billingDocs.filter((d) => d.doc_type === billingFilter);
  }, [billingDocs, billingFilter]);

  const billingCounts = useMemo(
    () => ({
      all: billingDocs.length,
      devis: billingDocs.filter((d) => d.doc_type === 'devis').length,
      facture: billingDocs.filter((d) => d.doc_type === 'facture').length,
    }),
    [billingDocs],
  );

  const editorTotals = useMemo(() => {
    if (!editingDoc) return { subtotal: 0, tax: 0, total: 0 };
    const subtotal = (editingDoc.items || []).reduce(
      (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
      0,
    );
    const rate = Number(editingDoc.tax_rate) || 0;
    const tax = Math.round(subtotal * rate) / 100;
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      total: Math.round((subtotal + tax) * 100) / 100,
    };
  }, [editingDoc]);

  async function handleSaveBillingDoc(e: React.FormEvent) {
    e.preventDefault();
    if (!editingDoc) return;
    setSavingDoc(true);
    try {
      const isEdit = Boolean(editingDoc.id);
      const url = isEdit
        ? `/api/vendor/billing-docs/${encodeURIComponent(editingDoc.id!)}`
        : '/api/vendor/billing-docs';
      const res = await vendorApi<{ doc: VendorBillingDoc; billing_docs: VendorBillingDoc[] }>(
        url,
        {
          method: isEdit ? 'PUT' : 'POST',
          body: JSON.stringify(editingDoc),
        },
      );
      onBillingDocsUpdated(res.billing_docs);
      setEditingDoc(null);
      notify(
        `${res.doc.doc_type === 'facture' ? 'Facture' : 'Devis'} ${res.doc.doc_number} enregistré.`,
        'success',
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur enregistrement document.', 'error');
    } finally {
      setSavingDoc(false);
    }
  }

  async function handleConvertQuoteToInvoice(docItem: VendorBillingDoc) {
    setConvertingId(docItem.id);
    try {
      const res = await vendorApi<{
        invoice: VendorBillingDoc;
        billing_docs: VendorBillingDoc[];
      }>(`/api/vendor/billing-docs/${encodeURIComponent(docItem.id)}/convert-invoice`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      onBillingDocsUpdated(res.billing_docs);
      notify(`Facture ${res.invoice.doc_number} créée depuis le devis ${docItem.doc_number}.`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Conversion impossible.', 'error');
    } finally {
      setConvertingId(null);
    }
  }

  async function handleQuickStatusChange(docItem: VendorBillingDoc, nextStatus: VendorBillingDocStatus) {
    try {
      const res = await vendorApi<{ doc: VendorBillingDoc; billing_docs: VendorBillingDoc[] }>(
        `/api/vendor/billing-docs/${encodeURIComponent(docItem.id)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      onBillingDocsUpdated(res.billing_docs);
      notify(`Statut mis à jour (${docItem.doc_number}).`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Mise à jour impossible.', 'error');
    }
  }

  function askDeleteBillingDoc(docItem: VendorBillingDoc) {
    setConfirmState({
      open: true,
      title: 'Supprimer ce document ?',
      message: `Confirmez-vous la suppression définitive de ${docItem.doc_number} (${docItem.client_name}) ?`,
      confirmLabel: 'Supprimer',
      danger: true,
      onConfirm: async () => {
        try {
          const res = await vendorApi<{ ok: boolean; billing_docs: VendorBillingDoc[] }>(
            `/api/vendor/billing-docs/${encodeURIComponent(docItem.id)}`,
            { method: 'DELETE' },
          );
          onBillingDocsUpdated(res.billing_docs);
          notify('Document supprimé.', 'success');
        } catch (err) {
          notify(err instanceof Error ? err.message : 'Suppression impossible.', 'error');
        }
      },
    });
  }

  function applyWorkspaceToEditor(wsId: string) {
    if (!editingDoc) return;
    const ws = workspaces.find((w) => w.id === wsId);
    if (!ws) return;
    const cat = packs.find((p) => p.id === ws.b2b_license.pack);
    setEditingDoc({
      ...editingDoc,
      workspace_id: ws.id,
      client_name: ws.name,
      client_contact: ws.admin_name || '',
      client_phone: ws.company_phone || '',
      client_email: ws.admin_email || '',
      currency: ws.b2b_license.currency,
      items: [
        {
          id: `vbi_${Date.now()}`,
          description: `Renouvellement / Abonnement annuel — ${cat?.name || ws.b2b_license.pack}`,
          details: `Espace client ${ws.code}`,
          quantity: 1,
          unit_price: ws.b2b_license.annual_fee || 0,
          total_ht: ws.b2b_license.annual_fee || 0,
        },
      ],
    });
  }

  function applyRequestToEditor(reqId: string) {
    if (!editingDoc) return;
    const reqItem = requests.find((r) => r.id === reqId);
    if (!reqItem) return;
    const next = buildBlankDraft(editingDoc.doc_type || 'devis', reqItem);
    setEditingDoc({
      ...editingDoc,
      ...next,
      id: editingDoc.id,
      doc_number: editingDoc.doc_number || '',
    });
  }

  return (
    <div className="space-y-5">
      {/* Sub-navigation bar inside Paramétrage */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl p-2 no-print">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSection('company')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors ${
              section === 'company'
                ? 'bg-[#2367a5] text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-[#17324d]'
            }`}
          >
            <Building2 className="w-4 h-4" />
            Informations société & Facturation
          </button>
          <button
            type="button"
            onClick={() => setSection('security')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors ${
              section === 'security'
                ? 'bg-[#2367a5] text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-[#17324d]'
            }`}
          >
            <KeyRound className="w-4 h-4" />
            Mot de passe & Accès Owner
          </button>
          <button
            type="button"
            onClick={() => setSection('billing')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors ${
              section === 'billing'
                ? 'bg-[#2367a5] text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-[#17324d]'
            }`}
          >
            <FileText className="w-4 h-4" />
            Édition Devis & Factures ({billingDocs.length})
          </button>
        </div>
      </div>

      {/* SECTION 1: COMPANY INFO & BILLING DEFAULTS */}
      {section === 'company' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5 no-print">
          <div>
            <h2 className="text-base font-extrabold text-[#17324d]">
              Informations de votre société (Éditeur / Owner)
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Ces coordonnées, identifiants fiscaux, RIB et logo apparaissent automatiquement sur vos
              devis B2B et factures clients.
            </p>
          </div>

          <form onSubmit={handleSaveCompany} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Raison sociale / Nom société *
                </label>
                <input
                  type="text"
                  required
                  value={companyForm.company_name}
                  onChange={(e) =>
                    setCompanyForm({ ...companyForm, company_name: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Forme juridique
                </label>
                <input
                  type="text"
                  placeholder="SARL, SAS, Auto-entrepreneur…"
                  value={companyForm.legal_form}
                  onChange={(e) => setCompanyForm({ ...companyForm, legal_form: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Activité</label>
                <input
                  type="text"
                  value={companyForm.activity}
                  onChange={(e) => setCompanyForm({ ...companyForm, activity: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ICE</label>
                <input
                  type="text"
                  value={companyForm.ice}
                  onChange={(e) => setCompanyForm({ ...companyForm, ice: e.target.value })}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Identifiant Fiscal (IF)
                </label>
                <input
                  type="text"
                  value={companyForm.if_number}
                  onChange={(e) => setCompanyForm({ ...companyForm, if_number: e.target.value })}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Registre de Commerce (RC)
                </label>
                <input
                  type="text"
                  value={companyForm.rc}
                  onChange={(e) => setCompanyForm({ ...companyForm, rc: e.target.value })}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Patente / Taxe Pro (TP)
                </label>
                <input
                  type="text"
                  value={companyForm.patente}
                  onChange={(e) => setCompanyForm({ ...companyForm, patente: e.target.value })}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Téléphone</label>
                <input
                  type="text"
                  value={companyForm.phone}
                  onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  E-mail professionnel
                </label>
                <input
                  type="email"
                  value={companyForm.email}
                  onChange={(e) => setCompanyForm({ ...companyForm, email: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Adresse</label>
                <input
                  type="text"
                  value={companyForm.address}
                  onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Ville</label>
                <input
                  type="text"
                  value={companyForm.city}
                  onChange={(e) => setCompanyForm({ ...companyForm, city: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Site web</label>
                <input
                  type="text"
                  placeholder="https://..."
                  value={companyForm.website}
                  onChange={(e) => setCompanyForm({ ...companyForm, website: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Banque</label>
                <input
                  type="text"
                  value={companyForm.bank}
                  onChange={(e) => setCompanyForm({ ...companyForm, bank: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  RIB / IBAN bancaire
                </label>
                <input
                  type="text"
                  value={companyForm.rib}
                  onChange={(e) => setCompanyForm({ ...companyForm, rib: e.target.value })}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            {/* Numérotation & TVA */}
            <div className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Préfixe Devis
                </label>
                <input
                  type="text"
                  value={companyForm.quote_prefix}
                  onChange={(e) =>
                    setCompanyForm({ ...companyForm, quote_prefix: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Préfixe Factures
                </label>
                <input
                  type="text"
                  value={companyForm.invoice_prefix}
                  onChange={(e) =>
                    setCompanyForm({ ...companyForm, invoice_prefix: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Taux TVA par défaut (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={companyForm.default_tax_rate}
                  onChange={(e) =>
                    setCompanyForm({
                      ...companyForm,
                      default_tax_rate: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            {/* Logo & Mentions */}
            <div className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Logo société (PNG / JPG / WEBP, max 1 Mo)
                </label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleLogoUpload}
                  className="w-full text-xs text-slate-600 file:me-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-[#eef4f8] file:text-[#17324d] file:font-semibold"
                />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-700 mb-1">Aperçu du logo</div>
                {companyForm.logo_url ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={companyForm.logo_url}
                      alt="Logo société"
                      className="max-w-[180px] max-h-[80px] object-contain border border-slate-200 rounded-lg p-1.5 bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => setCompanyForm({ ...companyForm, logo_url: '' })}
                      className="px-2.5 py-1 text-xs font-semibold rounded bg-red-50 text-red-700 hover:bg-red-100"
                    >
                      Retirer
                    </button>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400">Aucun logo enregistré</div>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Conditions de paiement & mentions légales par défaut
                </label>
                <textarea
                  rows={3}
                  value={companyForm.payment_terms}
                  onChange={(e) =>
                    setCompanyForm({ ...companyForm, payment_terms: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingCompany}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                {savingCompany ? 'Enregistrement…' : 'Enregistrer les paramètres société'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SECTION 2: OWNER PASSWORD & VENDOR ACCOUNTS SECURITY */}
      {section === 'security' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 no-print">
          {/* Card A: Change own password & profile */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-sky-50 text-[#2367a5]">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-extrabold text-[#17324d]">
                  Mon compte connecté ({vendor.email})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Modifiez votre nom, fonction et votre mot de passe d’accès au portail Éditeur.
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveOwnPassword} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Nom complet</label>
                <input
                  type="text"
                  required
                  value={profileFullName}
                  onChange={(e) => setProfileFullName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Fonction / Titre
                </label>
                <input
                  type="text"
                  value={profileRole}
                  onChange={(e) => setProfileRole(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 space-y-3">
                <div className="text-xs font-extrabold text-[#17324d] uppercase tracking-wide">
                  Changer le mot de passe
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Mot de passe actuel
                  </label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Mot de passe actuel"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Nouveau mot de passe (min. 6 caractères)
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Confirmer le nouveau mot de passe
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={savingPassword}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white text-sm font-bold disabled:opacity-50"
              >
                <KeyRound className="w-4 h-4" />
                {savingPassword
                  ? 'Enregistrement…'
                  : 'Mettre à jour mon mot de passe & profil'}
              </button>
            </form>
          </div>

          {/* Card B: Reset password for Owner / Editor accounts */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div>
              <h2 className="text-base font-extrabold text-[#17324d]">
                Réinitialisation des comptes Owner & Éditeur
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Réinitialisez directement le mot de passe d’un compte Owner ou Éditeur (utile en cas
                d’oubli ou après connexion via l’accès démo).
              </p>
            </div>

            {lastResetCredential && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-950 space-y-1.5">
                <div className="font-bold">Nouveau mot de passe enregistré :</div>
                <div className="font-mono">
                  Compte : <strong>{lastResetCredential.email}</strong>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono">
                    Mot de passe : <strong>{lastResetCredential.password}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        `Portail FRET ÉDITEUR\nE-mail : ${lastResetCredential.email}\nMot de passe : ${lastResetCredential.password}`,
                      )
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white border border-emerald-300 text-emerald-900 font-bold"
                  >
                    <Copy className="w-3 h-3" />
                    Copier
                  </button>
                </div>
              </div>
            )}

            <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
              {accounts.map((acc) => (
                <div
                  key={acc.id}
                  className="p-4 flex flex-wrap items-center justify-between gap-3 bg-white hover:bg-slate-50/70"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-[#17324d]">{acc.full_name}</span>
                      {acc.id === 'vnd_owner' && (
                        <span className="px-2 py-0.5 rounded bg-sky-50 border border-sky-200 text-[10px] font-bold text-[#2367a5]">
                          OWNER
                        </span>
                      )}
                      {acc.id === vendor.id && (
                        <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-700">
                          Connecté
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-mono text-slate-600 mt-0.5">{acc.email}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{acc.company_role}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setResetTarget(acc);
                      setResetPasswordInput('');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-[#17324d]"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-[#2367a5]" />
                    Réinitialiser
                  </button>
                </div>
              ))}
            </div>

            <InfoBanner>
              La sauvegarde Cloud Google synchronise automatiquement les modifications de mots de
              passe, coordonnées société et factures sur votre compte administrateur vérifié.
            </InfoBanner>
          </div>
        </div>
      )}

      {/* SECTION 3: QUOTES & INVOICES EDITOR */}
      {section === 'billing' && (
        <div className="space-y-4 no-print">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5 bg-white border border-slate-200 p-1 rounded-lg">
              {(
                [
                  ['all', `Tous (${billingCounts.all})`],
                  ['devis', `Devis (${billingCounts.devis})`],
                  ['facture', `Factures (${billingCounts.facture})`],
                ] as Array<[BillingFilter, string]>
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setBillingFilter(id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                    billingFilter === id
                      ? 'bg-[#2367a5] text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-[#17324d]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setEditingDoc(buildBlankDraft('devis'))}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white text-xs font-bold"
              >
                <FilePlus2 className="w-4 h-4" />
                Nouveau Devis
              </button>
              <button
                type="button"
                onClick={() => setEditingDoc(buildBlankDraft('facture'))}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#17324d] hover:bg-[#1f4469] text-white text-xs font-bold"
              >
                <Plus className="w-4 h-4" />
                Nouvelle Facture
              </button>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-start border-collapse text-sm">
                <thead>
                  <tr className="bg-[#f8fafc] border-b border-slate-200 text-xs font-bold text-slate-600 uppercase">
                    <th className="px-4 py-3">Document</th>
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Dates</th>
                    <th className="px-4 py-3">Montant TTC</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3 text-end">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredBillingDocs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                        Aucun devis ou facture éditeur enregistré. Cliquez sur « Nouveau Devis » ou
                        « Nouvelle Facture » pour créer votre premier document.
                      </td>
                    </tr>
                  ) : (
                    filteredBillingDocs.map((docItem) => {
                      const statusTone =
                        docItem.status === 'paye'
                          ? 'green'
                          : docItem.status === 'envoye'
                            ? 'blue'
                            : docItem.status === 'annule'
                              ? 'red'
                              : 'amber';
                      const statusLabel =
                        docItem.status === 'paye'
                          ? 'Payé'
                          : docItem.status === 'envoye'
                            ? 'Envoyé'
                            : docItem.status === 'annule'
                              ? 'Annulé'
                              : 'Brouillon';

                      return (
                        <tr key={docItem.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-3.5 align-top">
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                                  docItem.doc_type === 'facture'
                                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                    : 'bg-sky-50 text-[#2367a5] border border-sky-200'
                                }`}
                              >
                                {docItem.doc_type === 'facture' ? 'Facture' : 'Devis'}
                              </span>
                              <span className="font-mono font-bold text-[#17324d]">
                                {docItem.doc_number}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 mt-1">
                              {docItem.items.length} ligne(s) · TVA {docItem.tax_rate}%
                            </div>
                          </td>

                          <td className="px-4 py-3.5 align-top">
                            <div className="font-bold text-[#17324d]">{docItem.client_name}</div>
                            <div className="text-xs text-slate-600">
                              {[docItem.client_contact, docItem.client_phone]
                                .filter(Boolean)
                                .join(' · ') || '—'}
                            </div>
                            {docItem.client_ice && (
                              <div className="text-[11px] font-mono text-slate-400">
                                ICE : {docItem.client_ice}
                              </div>
                            )}
                          </td>

                          <td className="px-4 py-3.5 align-top text-xs font-mono text-slate-700">
                            <div>Émis : {dateText(docItem.issue_date)}</div>
                            <div className="text-slate-500 mt-0.5">
                              Échéance : {dateText(docItem.due_date)}
                            </div>
                          </td>

                          <td className="px-4 py-3.5 align-top font-mono tabular-nums">
                            <div className="font-extrabold text-[#17324d]">
                              {money(docItem.total_ttc, docItem.currency)}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              HT : {money(docItem.subtotal_ht, docItem.currency)}
                            </div>
                          </td>

                          <td className="px-4 py-3.5 align-top space-y-1.5">
                            <StatusText label={statusLabel} tone={statusTone} />
                            <select
                              aria-label={`Statut ${docItem.doc_number}`}
                              value={docItem.status}
                              onChange={(e) =>
                                handleQuickStatusChange(
                                  docItem,
                                  e.target.value as VendorBillingDocStatus,
                                )
                              }
                              className="block text-xs border border-slate-300 rounded-md px-2 py-1 bg-white"
                            >
                              <option value="brouillon">Brouillon</option>
                              <option value="envoye">Envoyé</option>
                              <option value="paye">Payé</option>
                              <option value="annule">Annulé</option>
                            </select>
                          </td>

                          <td className="px-4 py-3.5 align-top text-end whitespace-nowrap">
                            <div className="flex flex-wrap justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setPreviewDoc(docItem)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-[#17324d]"
                              >
                                <Printer className="w-3.5 h-3.5" />
                                Aperçu A4
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setEditingDoc({
                                    ...docItem,
                                    items: docItem.items.map((it) => ({ ...it })),
                                  })
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white text-xs font-bold"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                Modifier
                              </button>
                              {docItem.doc_type === 'devis' && (
                                <button
                                  type="button"
                                  disabled={convertingId === docItem.id}
                                  onClick={() => handleConvertQuoteToInvoice(docItem)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold disabled:opacity-50"
                                >
                                  <ArrowRightLeft className="w-3.5 h-3.5" />
                                  {convertingId === docItem.id ? 'Conversion…' : '→ Facture'}
                                </button>
                              )}
                              <button
                                type="button"
                                title="Supprimer"
                                onClick={() => askDeleteBillingDoc(docItem)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 bg-white hover:bg-red-50 text-xs font-semibold text-red-700"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Reset Account Password */}
      <Modal
        open={Boolean(resetTarget)}
        title={`Réinitialiser le mot de passe — ${resetTarget?.email || ''}`}
        onClose={() => setResetTarget(null)}
        maxWidth="max-w-md"
      >
        {resetTarget && (
          <form onSubmit={handleResetAccountPassword} className="space-y-4">
            <div className="text-xs text-slate-600">
              Compte : <strong className="text-[#17324d]">{resetTarget.full_name}</strong> (
              <span className="font-mono">{resetTarget.email}</span>)
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Nouveau mot de passe (min. 6 caractères)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  minLength={6}
                  value={resetPasswordInput}
                  onChange={(e) => setResetPasswordInput(e.target.value)}
                  placeholder="Saisir ou générer…"
                  className="flex-1 px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => setResetPasswordInput(generateStrongTempPassword())}
                  className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold text-[#17324d]"
                >
                  Générer
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="px-4 py-2 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={resettingAccount}
                className="px-4 py-2 rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white text-xs font-bold disabled:opacity-50"
              >
                {resettingAccount ? 'Validation…' : 'Confirmer la réinitialisation'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal: Create / Edit B2B Quote or Invoice */}
      <Modal
        open={Boolean(editingDoc)}
        title={
          editingDoc?.id
            ? `Modifier ${editingDoc.doc_type === 'facture' ? 'Facture' : 'Devis'} ${editingDoc.doc_number || ''}`
            : `Nouveau ${editingDoc?.doc_type === 'facture' ? 'Facture B2B' : 'Devis B2B'}`
        }
        onClose={() => setEditingDoc(null)}
        maxWidth="max-w-4xl"
      >
        {editingDoc && (
          <form onSubmit={handleSaveBillingDoc} className="space-y-4">
            {/* Quick prefill bar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#f8fafc] border border-slate-200 rounded-lg p-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Pré-remplir depuis un compte client abonné
                </label>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) applyWorkspaceToEditor(e.target.value);
                  }}
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                >
                  <option value="">— Choisir un client abonné —</option>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} · {w.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Pré-remplir depuis une demande B2B
                </label>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) applyRequestToEditor(e.target.value);
                  }}
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                >
                  <option value="">— Choisir une demande B2B —</option>
                  {requests.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.company_name} ({r.contact_name})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Header fields */}
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Type</label>
                <select
                  value={editingDoc.doc_type || 'devis'}
                  onChange={(e) =>
                    setEditingDoc({
                      ...editingDoc,
                      doc_type: e.target.value as VendorBillingDocType,
                    })
                  }
                  className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white font-bold"
                >
                  <option value="devis">Devis</option>
                  <option value="facture">Facture</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Numéro (auto si vide)
                </label>
                <input
                  type="text"
                  placeholder="Auto"
                  value={editingDoc.doc_number || ''}
                  onChange={(e) => setEditingDoc({ ...editingDoc, doc_number: e.target.value })}
                  className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Statut</label>
                <select
                  value={editingDoc.status || 'brouillon'}
                  onChange={(e) =>
                    setEditingDoc({
                      ...editingDoc,
                      status: e.target.value as VendorBillingDocStatus,
                    })
                  }
                  className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="brouillon">Brouillon</option>
                  <option value="envoye">Envoyé</option>
                  <option value="paye">Payé</option>
                  <option value="annule">Annulé</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Devise</label>
                <select
                  value={editingDoc.currency || 'MAD'}
                  onChange={(e) =>
                    setEditingDoc({ ...editingDoc, currency: e.target.value as Currency })
                  }
                  className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="MAD">MAD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Émission</label>
                <input
                  type="date"
                  value={editingDoc.issue_date || ''}
                  onChange={(e) => setEditingDoc({ ...editingDoc, issue_date: e.target.value })}
                  className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Échéance</label>
                <input
                  type="date"
                  value={editingDoc.due_date || ''}
                  onChange={(e) => setEditingDoc({ ...editingDoc, due_date: e.target.value })}
                  className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            {/* Client fields */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Raison sociale client *
                </label>
                <input
                  type="text"
                  required
                  value={editingDoc.client_name || ''}
                  onChange={(e) => setEditingDoc({ ...editingDoc, client_name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Contact / Interlocuteur
                </label>
                <input
                  type="text"
                  value={editingDoc.client_contact || ''}
                  onChange={(e) =>
                    setEditingDoc({ ...editingDoc, client_contact: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ICE client</label>
                <input
                  type="text"
                  value={editingDoc.client_ice || ''}
                  onChange={(e) => setEditingDoc({ ...editingDoc, client_ice: e.target.value })}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Téléphone</label>
                <input
                  type="text"
                  value={editingDoc.client_phone || ''}
                  onChange={(e) => setEditingDoc({ ...editingDoc, client_phone: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">E-mail</label>
                <input
                  type="email"
                  value={editingDoc.client_email || ''}
                  onChange={(e) => setEditingDoc({ ...editingDoc, client_email: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Adresse</label>
                <input
                  type="text"
                  value={editingDoc.client_address || ''}
                  onChange={(e) =>
                    setEditingDoc({ ...editingDoc, client_address: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            {/* Line Items */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-[#17324d] uppercase">
                  Lignes de facturation
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setEditingDoc({
                      ...editingDoc,
                      items: [
                        ...(editingDoc.items || []),
                        {
                          id: `vbi_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
                          description: '',
                          details: '',
                          quantity: 1,
                          unit_price: 0,
                          total_ht: 0,
                        },
                      ],
                    })
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-sky-50 hover:bg-sky-100 text-[#2367a5] text-xs font-bold border border-sky-200"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Ajouter une ligne
                </button>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {(editingDoc.items || []).map((item, idx) => (
                  <div
                    key={item.id || idx}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start bg-[#f8fafc] border border-slate-200 rounded-lg p-2.5"
                  >
                    <div className="sm:col-span-6 space-y-1">
                      <input
                        type="text"
                        required
                        placeholder="Désignation de la prestation *"
                        value={item.description}
                        onChange={(e) => {
                          const next = [...(editingDoc.items || [])];
                          next[idx] = { ...item, description: e.target.value };
                          setEditingDoc({ ...editingDoc, items: next });
                        }}
                        className="w-full px-2.5 py-1.5 text-xs font-semibold border border-slate-300 rounded bg-white"
                      />
                      <input
                        type="text"
                        placeholder="Détails complémentaires (optionnel)"
                        value={item.details || ''}
                        onChange={(e) => {
                          const next = [...(editingDoc.items || [])];
                          next[idx] = { ...item, details: e.target.value };
                          setEditingDoc({ ...editingDoc, items: next });
                        }}
                        className="w-full px-2.5 py-1 text-[11px] border border-slate-200 rounded bg-white"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[10px] font-bold text-slate-500">Qté</label>
                      <input
                        type="number"
                        min={0}
                        step="0.5"
                        value={item.quantity}
                        onChange={(e) => {
                          const next = [...(editingDoc.items || [])];
                          const qty = Number(e.target.value) || 0;
                          next[idx] = {
                            ...item,
                            quantity: qty,
                            total_ht: Math.round(qty * item.unit_price * 100) / 100,
                          };
                          setEditingDoc({ ...editingDoc, items: next });
                        }}
                        className="w-full px-2 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[10px] font-bold text-slate-500">
                        PU HT ({editingDoc.currency || 'MAD'})
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.unit_price}
                        onChange={(e) => {
                          const next = [...(editingDoc.items || [])];
                          const price = Number(e.target.value) || 0;
                          next[idx] = {
                            ...item,
                            unit_price: price,
                            total_ht: Math.round(item.quantity * price * 100) / 100,
                          };
                          setEditingDoc({ ...editingDoc, items: next });
                        }}
                        className="w-full px-2 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white"
                      />
                    </div>
                    <div className="sm:col-span-2 flex items-center justify-between sm:justify-end gap-2 pt-4">
                      <span className="font-mono text-xs font-bold text-[#17324d] tabular-nums">
                        {money(
                          (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
                          (editingDoc.currency || 'MAD') as Currency,
                        )}
                      </span>
                      {(editingDoc.items || []).length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const next = (editingDoc.items || []).filter((_, i) => i !== idx);
                            setEditingDoc({ ...editingDoc, items: next });
                          }}
                          className="p-1 text-red-600 hover:bg-red-50 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tax + Totals + Notes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-200">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Notes / Conditions spécifiques
                </label>
                <textarea
                  rows={3}
                  value={editingDoc.notes || ''}
                  onChange={(e) => setEditingDoc({ ...editingDoc, notes: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>

              <div className="bg-[#f8fafc] border border-slate-200 rounded-lg p-3.5 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 font-semibold">Total HT</span>
                  <span className="font-mono font-bold text-[#17324d] tabular-nums">
                    {money(editorTotals.subtotal, (editingDoc.currency || 'MAD') as Currency)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-600 font-semibold flex items-center gap-1.5">
                    TVA (%)
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.5"
                      value={editingDoc.tax_rate ?? 20}
                      onChange={(e) =>
                        setEditingDoc({ ...editingDoc, tax_rate: Number(e.target.value) })
                      }
                      className="w-16 px-2 py-0.5 text-xs font-mono border border-slate-300 rounded bg-white"
                    />
                  </span>
                  <span className="font-mono font-bold text-[#17324d] tabular-nums">
                    {money(editorTotals.tax, (editingDoc.currency || 'MAD') as Currency)}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-300 text-sm font-extrabold text-[#17324d]">
                  <span>Total TTC</span>
                  <span className="font-mono tabular-nums">
                    {money(editorTotals.total, (editingDoc.currency || 'MAD') as Currency)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingDoc(null)}
                className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={savingDoc}
                className="px-5 py-2 rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white text-xs font-bold disabled:opacity-50"
              >
                {savingDoc ? 'Enregistrement…' : 'Enregistrer le document'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Printable A4 Preview Modal for Edited Quotes & Invoices */}
      {previewDoc && (
        <VendorBillingPrintModal
          docItem={previewDoc}
          settings={settings}
          onClose={() => setPreviewDoc(null)}
        />
      )}

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}

export function VendorBillingPrintModal({
  docItem,
  settings,
  onClose,
}: {
  docItem: VendorBillingDoc;
  settings: VendorSettings;
  onClose: () => void;
}) {
  const isInvoice = docItem.doc_type === 'facture';
  const titleLabel = isInvoice ? 'FACTURE B2B' : 'DEVIS B2B';

  return (
    <div className="fixed inset-0 z-50 bg-[#10243a]/70 flex items-center justify-center p-4 overflow-y-auto print:static print:bg-white print:p-0">
      <div className="bg-white rounded-xl max-w-3xl w-full shadow-2xl overflow-hidden print:shadow-none print:rounded-none">
        <div className="flex items-center justify-between px-6 py-3 bg-slate-100 border-b border-slate-200 no-print">
          <span className="text-sm font-bold text-[#17324d]">
            Aperçu A4 — {titleLabel} N° {docItem.doc_number}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white text-xs font-bold"
            >
              <Printer className="w-3.5 h-3.5" />
              Imprimer / PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-slate-700"
            >
              Fermer
            </button>
          </div>
        </div>

        <div className="p-8 sm:p-10 text-[#17324d] space-y-6">
          {/* Header with Company Logo & Details */}
          <div className="flex justify-between items-start gap-6 border-b-2 border-[#17324d] pb-5">
            <div className="flex items-start gap-4">
              {settings.logo_url && (
                <img
                  src={settings.logo_url}
                  alt={settings.company_name}
                  className="max-w-[120px] max-h-[64px] object-contain"
                />
              )}
              <div>
                <div className="text-xl font-extrabold tracking-tight">
                  {settings.company_name || 'FRET MANAGER B2B'}
                  {settings.legal_form ? ` ${settings.legal_form}` : ''}
                </div>
                {settings.activity && (
                  <div className="text-xs text-slate-600 mt-0.5">{settings.activity}</div>
                )}
                {(settings.address || settings.city) && (
                  <div className="text-xs text-slate-600 mt-0.5">
                    {[settings.address, settings.city].filter(Boolean).join(' · ')}
                  </div>
                )}
                {(settings.phone || settings.email) && (
                  <div className="text-xs text-slate-600">
                    {[settings.phone, settings.email].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
            </div>

            <div className="text-end shrink-0">
              <div className="text-lg font-extrabold text-[#2367a5]">{titleLabel}</div>
              <div className="font-mono text-xs font-bold mt-1">N° {docItem.doc_number}</div>
              <div className="text-xs text-slate-600 mt-0.5">
                Date : {dateText(docItem.issue_date)}
              </div>
              <div className="text-xs text-slate-600">
                {isInvoice ? 'Échéance' : 'Validité'} : {dateText(docItem.due_date)}
              </div>
            </div>
          </div>

          {/* Client & Legal Info */}
          <div className="grid grid-cols-2 gap-6 text-sm bg-[#f8fafc] border border-slate-200 rounded-lg p-4">
            <div>
              <div className="text-xs font-bold uppercase text-slate-500">Client</div>
              <div className="font-bold mt-1">{docItem.client_name}</div>
              {docItem.client_contact && (
                <div className="text-xs text-slate-600 mt-0.5">
                  À l’attention de : {docItem.client_contact}
                </div>
              )}
              {docItem.client_ice && (
                <div className="text-xs font-mono text-slate-600">ICE : {docItem.client_ice}</div>
              )}
              {(docItem.client_phone || docItem.client_email) && (
                <div className="text-xs text-slate-600">
                  {[docItem.client_phone, docItem.client_email].filter(Boolean).join(' · ')}
                </div>
              )}
              {docItem.client_address && (
                <div className="text-xs text-slate-600">{docItem.client_address}</div>
              )}
            </div>

            <div>
              <div className="text-xs font-bold uppercase text-slate-500">Références légales</div>
              <div className="text-xs text-slate-700 mt-1 space-y-0.5 font-mono">
                {settings.ice && <div>ICE : {settings.ice}</div>}
                {settings.if_number && <div>IF : {settings.if_number}</div>}
                {settings.rc && <div>RC : {settings.rc}</div>}
                {settings.patente && <div>TP : {settings.patente}</div>}
                {settings.bank && <div>Banque : {settings.bank}</div>}
                {settings.rib && <div>RIB : {settings.rib}</div>}
                {!settings.ice && !settings.rc && !settings.rib && (
                  <div className="text-slate-400 font-sans">
                    Complétez vos identifiants dans Paramétrage → Société.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Items Table */}
          <table className="w-full text-start border-collapse text-sm">
            <thead>
              <tr className="bg-[#17324d] text-white text-xs uppercase">
                <th className="px-4 py-2.5">Prestation / Désignation</th>
                <th className="px-3 py-2.5 text-end">Qté</th>
                <th className="px-3 py-2.5 text-end">PU HT</th>
                <th className="px-4 py-2.5 text-end">Total HT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 border border-slate-200">
              {docItem.items.map((it) => (
                <tr key={it.id}>
                  <td className="px-4 py-3">
                    <div className="font-bold">{it.description}</div>
                    {it.details && <div className="text-xs text-slate-600 mt-0.5">{it.details}</div>}
                  </td>
                  <td className="px-3 py-3 text-end font-mono tabular-nums">{it.quantity}</td>
                  <td className="px-3 py-3 text-end font-mono tabular-nums">
                    {money(it.unit_price, docItem.currency)}
                  </td>
                  <td className="px-4 py-3 text-end font-mono font-bold tabular-nums">
                    {money(it.total_ht, docItem.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-72 border border-slate-200 rounded-lg p-4 space-y-1.5 text-sm bg-[#f8fafc]">
              <div className="flex justify-between">
                <span className="text-slate-600">Total HT</span>
                <span className="font-mono font-bold tabular-nums">
                  {money(docItem.subtotal_ht, docItem.currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">TVA ({docItem.tax_rate}%)</span>
                <span className="font-mono font-bold tabular-nums">
                  {money(docItem.tax_amount, docItem.currency)}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-300 pt-2 text-base font-extrabold text-[#17324d]">
                <span>Total TTC</span>
                <span className="font-mono tabular-nums">
                  {money(docItem.total_ttc, docItem.currency)}
                </span>
              </div>
            </div>
          </div>

          {/* Notes & Signature */}
          <div className="grid grid-cols-2 gap-8 pt-6 border-t border-slate-200 text-xs text-slate-600">
            <div className="whitespace-pre-line">
              {docItem.notes || settings.payment_terms}
            </div>
            <div className="text-end">
              <div className="font-bold text-[#17324d] mb-8">Cachet & Signature</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
