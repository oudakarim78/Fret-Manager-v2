import React, { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import type {
  Currency,
  DocumentItem,
  Employee,
  Expense,
  LookupsData,
  Payroll,
  PayrollAllocation,
  Trip,
} from '../types.ts';
import { api, getAuthenticatedFileUrl } from '../lib/api.ts';
import { downloadExcelCsv } from '../lib/exportCsv.ts';
import { dateText, getActiveLocale, money } from '../lib/format.ts';
import {
  ConfirmDialog,
  type ConfirmState,
  EmptyState,
  InfoBanner,
  Modal,
  StatusText,
} from './UI.tsx';
import { useI18n } from '../lib/i18n.tsx';

// ======================== PERSONNEL ========================
export function EmployeesView({
  lookups,
  notify,
}: {
  lookups: LookupsData;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t, entityStatusLabel } = useI18n();
  const [rows, setRows] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const [fullName, setFullName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [hireDate, setHireDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState<Employee['status']>('actif');
  const [driverId, setDriverId] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api<Employee[]>('/api/employees'));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur chargement salariés.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  function openForm(e: Employee | null = null) {
    setEditing(e);
    setFullName(e?.full_name || '');
    setJobTitle(e?.job_title || '');
    setPhone(e?.phone || '');
    setEmail(e?.email || '');
    setHireDate(e?.hire_date || '');
    setEndDate(e?.end_date || '');
    setStatus(e?.status || 'actif');
    setDriverId(e?.driver_id || '');
    setNotes(e?.notes || '');
    setOpen(true);
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    try {
      const payload = {
        full_name: fullName.trim(),
        job_title: jobTitle.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        hire_date: hireDate || null,
        end_date: endDate || null,
        status,
        driver_id: driverId || null,
        notes: notes.trim() || null,
      };
      if (editing) {
        await api(`/api/employees/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        notify('Salarié mis à jour.', 'success');
      } else {
        await api('/api/employees', { method: 'POST', body: JSON.stringify(payload) });
        notify('Salarié ajouté.', 'success');
      }
      setOpen(false);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur salarié.', 'error');
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <button
          type="button"
          onClick={() => openForm(null)}
          className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white"
        >
          {t('emp.add')}
        </button>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">{t('common.loading')}</div>
      ) : rows.length === 0 ? (
        <EmptyState title={t('emp.empty_title')} description={t('emp.empty_desc')} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[740px] text-start border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <th className="px-4 py-3">{t('emp.col.fullname')}</th>
                <th className="px-4 py-3">{t('emp.col.role')}</th>
                <th className="px-4 py-3">{t('common.phone')}</th>
                <th className="px-4 py-3">{t('emp.col.hire')}</th>
                <th className="px-4 py-3">{t('common.status')}</th>
                <th className="px-4 py-3">{t('emp.col.driver')}</th>
                <th className="px-4 py-3">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {rows.map((e) => {
                const drv = lookups.drivers.find((d) => d.id === e.driver_id)?.full_name || '—';
                return (
                  <tr key={e.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-bold text-[#17324d]">{e.full_name}</td>
                    <td className="px-4 py-3 text-slate-700">{e.job_title || '—'}</td>
                    <td className="px-4 py-3 font-mono text-slate-600">{e.phone || '—'}</td>
                    <td className="px-4 py-3 font-mono text-slate-600">{dateText(e.hire_date)}</td>
                    <td className="px-4 py-3">
                      <StatusText
                        label={entityStatusLabel(e.status)}
                        tone={e.status === 'actif' ? 'green' : e.status === 'sorti' ? 'red' : 'amber'}
                      />
                    </td>
                    <td className="px-4 py-3 text-slate-700">{drv}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        <button type="button" onClick={() => openForm(e)} className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold">{t('common.edit')}</button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirm({
                              open: true,
                              title: t('emp.del_title'),
                              message: t('emp.del_msg'),
                              confirmLabel: t('common.delete'),
                              danger: true,
                              onConfirm: async () => {
                                try {
                                  await api(`/api/employees/${e.id}`, { method: 'DELETE' });
                                  notify('OK', 'success');
                                  await load();
                                } catch (err) {
                                  notify(err instanceof Error ? err.message : 'Error', 'error');
                                }
                              },
                            })
                          }
                          className="px-2.5 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-700 font-semibold"
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} title={editing ? t('emp.modal.edit') : t('emp.modal.add')} onClose={() => setOpen(false)} maxWidth="max-w-2xl">
        <form onSubmit={save} className="space-y-4">
          <InfoBanner>{t('emp.modal.hint')}</InfoBanner>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('auth.reg.fullname')}</label>
              <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('emp.col.role')}</label>
              <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.phone')}</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.email')}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('emp.col.hire')}</label>
              <input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('emp.col.end')}</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.status')}</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as Employee['status'])} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="actif">{entityStatusLabel('actif')}</option>
                <option value="inactif">{entityStatusLabel('inactif')}</option>
                <option value="sorti">{entityStatusLabel('sorti')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('emp.col.driver')}</label>
              <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="">{t('common.none')}</option>
                {lookups.drivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.full_name}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.notes')}</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700">{t('common.cancel')}</button>
            <button type="submit" className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] text-white">{t('common.save')}</button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

// ======================== PAIE & AFFECTATIONS ========================
export function PayrollView({
  lookups,
  notify,
}: {
  lookups: LookupsData;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t, payrollStatusLabel, entityStatusLabel } = useI18n();
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [allocations, setAllocations] = useState<PayrollAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // Payroll form modal
  const [payModal, setPayModal] = useState(false);
  const [editingPay, setEditingPay] = useState<Payroll | null>(null);
  const [empId, setEmpId] = useState('');
  const [pStart, setPStart] = useState('');
  const [pEnd, setPEnd] = useState('');
  const [salary, setSalary] = useState('');
  const [charges, setCharges] = useState('0');
  const [pCurrency, setPCurrency] = useState<Currency>('MAD');
  const [pStatus, setPStatus] = useState<Payroll['payment_status']>('a_payer');
  const [pDate, setPDate] = useState('');
  const [pNotes, setPNotes] = useState('');

  // Allocation modal
  const [allocPayId, setAllocPayId] = useState<string | null>(null);
  const [editingAlloc, setEditingAlloc] = useState<PayrollAllocation | null>(null);
  const [allocTripId, setAllocTripId] = useState('');
  const [allocAmount, setAllocAmount] = useState('');
  const [allocNotes, setAllocNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{
        payroll: Payroll[];
        employees: Employee[];
        allocations: PayrollAllocation[];
      }>('/api/payroll');
      setPayroll(res.payroll);
      setEmployees(res.employees);
      setAllocations(res.allocations);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur chargement paie.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  function openPayForm(p: Payroll | null = null) {
    if (!employees.length) {
      notify('Ajoutez d’abord un salarié dans la rubrique Personnel.', 'error');
      return;
    }
    setEditingPay(p);
    setEmpId(p?.employee_id || employees[0]?.id || '');
    setPStart(p?.period_start || '');
    setPEnd(p?.period_end || '');
    setSalary(p ? String(p.salary_amount) : '');
    setCharges(p ? String(p.employer_charges) : '0');
    setPCurrency(p?.currency || 'MAD');
    setPStatus(p?.payment_status || 'a_payer');
    setPDate(p?.payment_date || '');
    setPNotes(p?.notes || '');
    setPayModal(true);
  }

  async function savePayroll(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        employee_id: empId,
        period_start: pStart,
        period_end: pEnd,
        salary_amount: Number(salary),
        employer_charges: Number(charges || 0),
        currency: pCurrency,
        payment_status: pStatus,
        payment_date: pDate || null,
        notes: pNotes.trim() || null,
      };
      if (editingPay) {
        await api(`/api/payroll/${editingPay.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        notify('Paie mise à jour.', 'success');
      } else {
        await api('/api/payroll', { method: 'POST', body: JSON.stringify(payload) });
        notify('Paie enregistrée.', 'success');
      }
      setPayModal(false);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur paie.', 'error');
    }
  }

  const allocatedByPayroll = new Map<string, number>();
  allocations.forEach((a) => {
    allocatedByPayroll.set(a.payroll_id, (allocatedByPayroll.get(a.payroll_id) || 0) + Number(a.amount || 0));
  });

  const totals: Record<string, { cost: number; allocated: number }> = {};
  payroll.forEach((p) => {
    const c = p.currency || 'MAD';
    if (!totals[c]) totals[c] = { cost: 0, allocated: 0 };
    totals[c].cost += Number(p.total_cost || 0);
    totals[c].allocated += allocatedByPayroll.get(p.id) || 0;
  });

  const activePay = payroll.find((p) => p.id === allocPayId) || null;
  const activePayAllocs = allocations.filter((a) => a.payroll_id === allocPayId);
  const activeAllocated = activePayAllocs.reduce((acc, a) => acc + Number(a.amount || 0), 0);
  const activeRemaining = activePay ? Math.max(0, Number(activePay.total_cost) - activeAllocated) : 0;

  async function saveAllocation(e: React.FormEvent) {
    e.preventDefault();
    if (!activePay) return;
    try {
      if (editingAlloc) {
        await api(`/api/payroll-allocations/${editingAlloc.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            trip_id: allocTripId,
            amount: Number(allocAmount),
            notes: allocNotes.trim() || null,
          }),
        });
        notify('Affectation modifiée.', 'success');
      } else {
        await api('/api/payroll-allocations', {
          method: 'POST',
          body: JSON.stringify({
            payroll_id: activePay.id,
            trip_id: allocTripId,
            amount: Number(allocAmount),
            notes: allocNotes.trim() || null,
          }),
        });
        notify('Affectation enregistrée.', 'success');
      }
      setEditingAlloc(null);
      setAllocTripId('');
      setAllocAmount('');
      setAllocNotes('');
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Affectation refusée.', 'error');
    }
  }

  const exportPayrollCsv = () => {
    const today = new Date().toISOString().slice(0, 10);
    downloadExcelCsv(
      `paie-${today}.csv`,
      [
        t('pay.col.emp'),
        t('pay.pstart').replace(' *', ''),
        t('pay.pend').replace(' *', ''),
        t('pay.col.salary'),
        t('pay.col.charges'),
        t('pay.col.total'),
        t('pay.csv.currency'),
        t('pay.col.alloc'),
        t('pay.col.rem'),
        t('pay.csv.status'),
        t('pay.csv.date'),
        t('common.notes'),
      ],
      payroll.map((p) => {
        const empName = employees.find((e) => e.id === p.employee_id)?.full_name || '';
        const alloc = allocatedByPayroll.get(p.id) || 0;
        const remain = Math.max(0, Number(p.total_cost || 0) - alloc);
        return [
          empName,
          p.period_start,
          p.period_end,
          Number(p.salary_amount || 0).toFixed(2),
          Number(p.employer_charges || 0).toFixed(2),
          Number(p.total_cost || 0).toFixed(2),
          p.currency,
          alloc.toFixed(2),
          remain.toFixed(2),
          payrollStatusLabel(p.payment_status),
          p.payment_date || '',
          p.notes || '',
        ];
      }),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => openPayForm(null)}
          className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white"
        >
          {t('pay.add')}
        </button>
        {payroll.length > 0 && (
          <button
            type="button"
            onClick={exportPayrollCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-[#17324d]"
          >
            <Download className="w-4 h-4" />
            {t('pay.export_csv')}
          </button>
        )}
      </div>

      <InfoBanner>{t('pay.banner')}</InfoBanner>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Object.entries(totals)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([c, v]) => (
            <div key={c} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-semibold text-slate-500">{t('pay.card.title', { cur: c })}</div>
              <div className="text-2xl font-extrabold font-mono text-[#17324d] mt-1">{money(v.cost, c)}</div>
              <div className="text-xs text-slate-500 mt-2 space-y-0.5 font-mono">
                <div>{t('pay.card.alloc')} {money(v.allocated, c)}</div>
                <div>{t('pay.card.unalloc')} {money(Math.max(0, v.cost - v.allocated), c)}</div>
              </div>
            </div>
          ))}
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">{t('common.loading')}</div>
      ) : payroll.length === 0 ? (
        <EmptyState title={t('pay.empty_title')} description={t('pay.empty_desc')} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[920px] text-start border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <th className="px-3.5 py-3">{t('pay.col.emp')}</th>
                <th className="px-3.5 py-3">{t('pay.col.period')}</th>
                <th className="px-3.5 py-3 text-end">{t('pay.col.salary')}</th>
                <th className="px-3.5 py-3 text-end">{t('pay.col.charges')}</th>
                <th className="px-3.5 py-3 text-end">{t('pay.col.total')}</th>
                <th className="px-3.5 py-3">{t('pay.col.pay')}</th>
                <th className="px-3.5 py-3 text-end">{t('pay.col.alloc')}</th>
                <th className="px-3.5 py-3 text-end">{t('pay.col.rem')}</th>
                <th className="px-3.5 py-3">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {payroll.map((p) => {
                const empName = employees.find((e) => e.id === p.employee_id)?.full_name || '—';
                const alloc = allocatedByPayroll.get(p.id) || 0;
                const remain = Math.max(0, Number(p.total_cost || 0) - alloc);
                const statusLabel = payrollStatusLabel(p.payment_status);
                return (
                  <tr key={p.id} className="hover:bg-slate-50/70">
                    <td className="px-3.5 py-2.5 font-bold text-[#17324d]">{empName}</td>
                    <td className="px-3.5 py-2.5 font-mono text-slate-600 whitespace-nowrap">
                      {dateText(p.period_start)} → {dateText(p.period_end)}
                    </td>
                    <td className="px-3.5 py-2.5 text-end font-mono">{money(p.salary_amount, p.currency)}</td>
                    <td className="px-3.5 py-2.5 text-end font-mono">{money(p.employer_charges, p.currency)}</td>
                    <td className="px-3.5 py-2.5 text-end font-mono font-bold text-[#17324d]">
                      {money(p.total_cost, p.currency)}
                    </td>
                    <td className="px-3.5 py-2.5">
                      <StatusText
                        label={statusLabel}
                        tone={p.payment_status === 'paye' ? 'green' : p.payment_status === 'partiellement_paye' ? 'amber' : 'red'}
                      />
                      {p.payment_date && <div className="text-[11px] font-mono text-slate-400 mt-0.5">{dateText(p.payment_date)}</div>}
                    </td>
                    <td className="px-3.5 py-2.5 text-end font-mono">{money(alloc, p.currency)}</td>
                    <td className="px-3.5 py-2.5 text-end font-mono">{money(remain, p.currency)}</td>
                    <td className="px-3.5 py-2.5">
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setAllocPayId(p.id);
                            setEditingAlloc(null);
                            setAllocTripId('');
                            setAllocAmount('');
                            setAllocNotes('');
                          }}
                          className="px-2.5 py-1 rounded-md bg-[#eef4f8] hover:bg-[#dce8f3] text-[#17324d] font-semibold"
                        >
                          {t('pay.btn_alloc')}
                        </button>
                        <button type="button" onClick={() => openPayForm(p)} className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold">{t('common.edit')}</button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirm({
                              open: true,
                              title: t('pay.del_title'),
                              message: t('pay.del_msg'),
                              confirmLabel: t('common.delete'),
                              danger: true,
                              onConfirm: async () => {
                                try {
                                  await api(`/api/payroll/${p.id}`, { method: 'DELETE' });
                                  notify('OK', 'success');
                                  await load();
                                } catch (err) {
                                  notify(err instanceof Error ? err.message : 'Erreur suppression.', 'error');
                                }
                              },
                            })
                          }
                          className="px-2.5 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-700 font-semibold"
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Payroll Form Modal */}
      <Modal open={payModal} title={editingPay ? t('pay.modal.edit') : t('pay.modal.add')} onClose={() => setPayModal(false)} maxWidth="max-w-2xl">
        <form onSubmit={savePayroll} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('pay.col.emp')} *</label>
              <select required value={empId} onChange={(e) => setEmpId(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}{e.status !== 'actif' ? ` · ${entityStatusLabel(e.status)}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('pay.pstart')}</label>
              <input type="date" required value={pStart} onChange={(e) => setPStart(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('pay.pend')}</label>
              <input type="date" required value={pEnd} onChange={(e) => setPEnd(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('pay.col.salary')} *</label>
              <input type="number" min="0" step="0.01" required value={salary} onChange={(e) => setSalary(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('pay.charges')}</label>
              <input type="number" min="0" step="0.01" value={charges} onChange={(e) => setCharges(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.currency')}</label>
              <select value={pCurrency} onChange={(e) => setPCurrency(e.target.value as Currency)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="MAD">MAD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('pay.status_label')}</label>
              <select value={pStatus} onChange={(e) => setPStatus(e.target.value as Payroll['payment_status'])} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="a_payer">{payrollStatusLabel('a_payer')}</option>
                <option value="partiellement_paye">{payrollStatusLabel('partiellement_paye')}</option>
                <option value="paye">{payrollStatusLabel('paye')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('pay.pay_date')}</label>
              <input type="date" value={pDate} onChange={(e) => setPDate(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.notes')}</label>
              <textarea value={pNotes} onChange={(e) => setPNotes(e.target.value)} rows={2} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setPayModal(false)} className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700">{t('common.cancel')}</button>
            <button type="submit" className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] text-white">{t('common.save')}</button>
          </div>
        </form>
      </Modal>

      {/* Allocations Modal */}
      <Modal
        open={!!activePay}
        title={activePay ? t('pay.alloc_title', { start: activePay.period_start, end: activePay.period_end }) : ''}
        onClose={() => setAllocPayId(null)}
        maxWidth="max-w-3xl"
      >
        {activePay && (
          <div className="space-y-4">
            <InfoBanner>
              {t('pay.col.emp')}: <strong>{employees.find((e) => e.id === activePay.employee_id)?.full_name || '—'}</strong> ·{' '}
              {t('pay.col.total')}: <strong className="font-mono">{money(activePay.total_cost, activePay.currency)}</strong> ·{' '}
              {t('pay.col.alloc')}: <strong className="font-mono">{money(activeAllocated, activePay.currency)}</strong> ·{' '}
              {t('pay.col.rem')}: <strong className="font-mono">{money(activeRemaining, activePay.currency)}</strong>.
            </InfoBanner>

            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-start border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                    <th className="px-3.5 py-2.5">{t('driver.mission_label')}</th>
                    <th className="px-3.5 py-2.5">{t('trips.col.route')}</th>
                    <th className="px-3.5 py-2.5 text-end">{t('pay.col.alloc')}</th>
                    <th className="px-3.5 py-2.5">{t('common.notes')}</th>
                    <th className="px-3.5 py-2.5">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activePayAllocs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3.5 py-4 text-center text-slate-500">
                        {t('pay.alloc_empty')}
                      </td>
                    </tr>
                  ) : (
                    activePayAllocs.map((a) => {
                      const tr = lookups.trips.find((x) => x.id === a.trip_id);
                      return (
                        <tr key={a.id}>
                          <td className="px-3.5 py-2 font-mono font-bold">{tr?.reference || a.trip_id}</td>
                          <td className="px-3.5 py-2">{tr ? `${tr.departure} → ${tr.destination}` : '—'}</td>
                          <td className="px-3.5 py-2 text-end font-mono font-semibold">{money(a.amount, activePay.currency)}</td>
                          <td className="px-3.5 py-2 text-slate-500">{a.notes || '—'}</td>
                          <td className="px-3.5 py-2">
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingAlloc(a);
                                  setAllocTripId(a.trip_id);
                                  setAllocAmount(String(a.amount));
                                  setAllocNotes(a.notes || '');
                                }}
                                className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 font-semibold"
                              >
                                {t('common.edit')}
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await api(`/api/payroll-allocations/${a.id}`, { method: 'DELETE' });
                                    notify('OK', 'success');
                                    await load();
                                  } catch (err) {
                                    notify(err instanceof Error ? err.message : 'Erreur suppression.', 'error');
                                  }
                                }}
                                className="px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 font-semibold"
                              >
                                {t('common.delete')}
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

            <form onSubmit={saveAllocation} className="border-t border-slate-200 pt-4 space-y-3">
              <h3 className="text-sm font-bold text-[#17324d]">
                {editingAlloc ? t('pay.alloc_edit') : t('pay.alloc_add')}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">{t('pay.alloc_trip', { cur: activePay.currency })}</label>
                  <select required value={allocTripId} onChange={(e) => setAllocTripId(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                    <option value="">{t('common.choose')}</option>
                    {lookups.trips
                      .filter((tr) => (tr.currency || 'MAD') === (activePay.currency || 'MAD'))
                      .map((tr) => (
                        <option key={tr.id} value={tr.id}>
                          {tr.reference} · {tr.departure} → {tr.destination} · {tr.currency}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">{t('pay.alloc_amt')}</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={allocAmount}
                    onChange={(e) => setAllocAmount(e.target.value)}
                    placeholder={activeRemaining.toFixed(2)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.notes')}</label>
                  <input value={allocNotes} onChange={(e) => setAllocNotes(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" className="px-4 py-2 text-xs font-bold rounded-lg bg-[#2367a5] text-white">
                  {editingAlloc ? t('pay.alloc_save_edit') : t('pay.alloc_save_new')}
                </button>
                {editingAlloc && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingAlloc(null);
                      setAllocTripId('');
                      setAllocAmount('');
                      setAllocNotes('');
                    }}
                    className="px-3 py-2 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700"
                  >
                    {t('pay.alloc_cancel')}
                  </button>
                )}
              </div>
            </form>
          </div>
        )}
      </Modal>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

// ======================== DÉPENSES & RENTABILITÉ ========================
interface ProfitabilityData {
  totals: Record<string, { revenue: number; expenses: number; payroll: number }>;
  unallocatedByCurrency: Record<string, number>;
  byTrip: Array<{
    trip: Trip;
    currency: Currency;
    revenue: number;
    expenses: number;
    payroll: number;
    result: number;
  }>;
  expenses: Expense[];
}

export function ExpensesView({
  lookups,
  presetTripId,
  onClearPreset,
  notify,
}: {
  lookups: LookupsData;
  presetTripId: string | null;
  onClearPreset: () => void;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t, lang, tripStatusLabel } = useI18n();
  const [data, setData] = useState<ProfitabilityData | null>(null);
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [previewDoc, setPreviewDoc] = useState<DocumentItem | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const [tripId, setTripId] = useState('');
  const [expType, setExpType] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('MAD');
  const [expDate, setExpDate] = useState('');
  const [desc, setDesc] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profRes, docsRes] = await Promise.all([
        api<ProfitabilityData>('/api/profitability'),
        api<DocumentItem[]>('/api/documents'),
      ]);
      setData(profRes);
      setDocs(docsRes);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur rentabilité.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  async function reviewDriverExpense(exp: Expense, decision: 'validee' | 'refusee') {
    try {
      await api(`/api/expenses/${exp.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      notify(decision === 'validee' ? t('exp.status.approved') : t('exp.status.rejected'), 'success');
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Action impossible.', 'error');
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  const openForm = useCallback(
    (exp: Expense | null = null, forceTripId?: string) => {
      setEditing(exp);
      setTripId(forceTripId || exp?.trip_id || lookups.trips[0]?.id || '');
      setExpType(exp?.expense_type || '');
      setAmount(exp ? String(exp.amount) : '');
      setCurrency(exp?.currency || 'MAD');
      setExpDate(exp?.expense_date || new Date().toISOString().slice(0, 10));
      setDesc(exp?.description || '');
      setOpen(true);
    },
    [lookups.trips],
  );

  useEffect(() => {
    if (presetTripId) {
      openForm(null, presetTripId);
      onClearPreset();
    }
  }, [presetTripId, openForm, onClearPreset]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        trip_id: tripId,
        expense_type: expType.trim(),
        amount: Number(amount),
        currency,
        expense_date: expDate || null,
        description: desc.trim() || null,
      };
      if (editing) {
        await api(`/api/expenses/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        notify('Dépense mise à jour.', 'success');
      } else {
        await api('/api/expenses', { method: 'POST', body: JSON.stringify(payload) });
        notify('Dépense ajoutée.', 'success');
      }
      setOpen(false);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur dépense.', 'error');
    }
  }

  if (loading || !data) {
    return <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">{t('common.loading')}</div>;
  }

  const currencies = Object.keys(data.totals).sort();
  const pendingDriverCount = data.expenses.filter((e) => e.approval_status === 'en_attente').length;

  const exportExpensesCsv = () => {
    const today = new Date().toISOString().slice(0, 10);
    downloadExcelCsv(
      `depenses-${today}.csv`,
      [
        t('driver.mission_label'),
        t('common.type'),
        t('common.date'),
        t('common.amount'),
        t('common.currency'),
        t('exp.csv.source'),
        t('exp.csv.validation'),
        t('common.description'),
      ],
      data.expenses.map((r) => {
        const tRef = lookups.trips.find((tr) => tr.id === r.trip_id)?.reference || r.trip_id;
        const sourceLabel = r.submitted_by_role === 'conducteur' ? t('exp.src.driver') : t('exp.src.office');
        const approvalLabel =
          r.approval_status === 'refusee'
            ? t('exp.status.rejected')
            : r.approval_status === 'en_attente'
              ? t('exp.status.pending')
              : t('exp.status.approved');
        return [
          tRef,
          r.expense_type,
          r.expense_date || '',
          Number(r.amount || 0).toFixed(2),
          r.currency,
          sourceLabel,
          approvalLabel,
          r.description || '',
        ];
      }),
    );
  };

  const exportProfitabilityCsv = () => {
    const today = new Date().toISOString().slice(0, 10);
    downloadExcelCsv(
      `rentabilite-missions-${today}.csv`,
      [
        t('driver.mission_label'),
        t('trips.col.route'),
        t('common.status'),
        t('common.currency'),
        t('exp.col.rev'),
        t('exp.col.direct'),
        t('exp.col.payroll'),
        t('exp.col.result'),
      ],
      data.byTrip.map((row) => [
        row.trip.reference,
        `${row.trip.departure} -> ${row.trip.destination}`,
        tripStatusLabel(row.trip.status),
        row.currency,
        Number(row.revenue || 0).toFixed(2),
        Number(row.expenses || 0).toFixed(2),
        Number(row.payroll || 0).toFixed(2),
        Number(row.result || 0).toFixed(2),
      ]),
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => openForm(null)}
          className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white"
        >
          {t('exp.add')}
        </button>
        {data.expenses.length > 0 && (
          <button
            type="button"
            onClick={exportExpensesCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-[#17324d]"
          >
            <Download className="w-4 h-4" />
            {t('exp.export_expenses')}
          </button>
        )}
        {data.byTrip.length > 0 && (
          <button
            type="button"
            onClick={exportProfitabilityCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-[#17324d]"
          >
            <Download className="w-4 h-4" />
            {t('exp.export_profitability')}
          </button>
        )}
      </div>

      <InfoBanner>{t('exp.banner')}</InfoBanner>
      {pendingDriverCount > 0 && (
        <InfoBanner tone="warning">
          {t('exp.pending_alert', { count: pendingDriverCount })}
        </InfoBanner>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {currencies.map((c) => {
          const v = data.totals[c];
          const result = v.revenue - v.expenses - v.payroll;
          const margin = v.revenue ? (result / v.revenue) * 100 : null;
          return (
            <div key={c} className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wide">{t('exp.synth', { cur: c })}</div>
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div>
                  <div className="text-xs text-slate-500">{t('exp.rev')}</div>
                  <div className="text-base font-extrabold font-mono text-[#17324d]">{money(v.revenue, c)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">{t('exp.exp')}</div>
                  <div className="text-base font-bold font-mono text-slate-800">{money(v.expenses, c)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">{t('exp.sal')}</div>
                  <div className="text-base font-bold font-mono text-slate-800">{money(v.payroll, c)}</div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-200 flex items-end justify-between gap-2">
                <div>
                  <div className="text-xs text-slate-500">{t('exp.net')}</div>
                  <div className={`text-2xl font-extrabold font-mono ${result < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {money(result, c)}
                  </div>
                </div>
                <div className="text-end text-xs text-slate-500 font-mono">
                  <div>{t('exp.margin')} {margin === null ? '—' : `${margin.toLocaleString(getActiveLocale(lang), { maximumFractionDigits: 2 })} %`}</div>
                  <div>{t('exp.unalloc')} {money(data.unallocatedByCurrency[c] || 0, c)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Mission Profitability Table */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div>
          <h2 className="text-base font-bold text-[#17324d]">{t('exp.by_trip')}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{t('exp.by_trip_sub')}</p>
        </div>
        {data.byTrip.length === 0 ? (
          <p className="text-sm text-slate-500 py-4 text-center">{t('exp.by_trip_empty')}</p>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full min-w-[780px] text-start border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                  <th className="px-3.5 py-2.5">{t('driver.mission_label')}</th>
                  <th className="px-3.5 py-2.5">{t('trips.col.route')}</th>
                  <th className="px-3.5 py-2.5">{t('common.status')}</th>
                  <th className="px-3.5 py-2.5">{t('common.currency')}</th>
                  <th className="px-3.5 py-2.5 text-end">{t('exp.col.rev')}</th>
                  <th className="px-3.5 py-2.5 text-end">{t('exp.col.direct')}</th>
                  <th className="px-3.5 py-2.5 text-end">{t('exp.col.payroll')}</th>
                  <th className="px-3.5 py-2.5 text-end">{t('exp.col.result')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.byTrip.map((row) => (
                  <tr key={row.trip.id} className="hover:bg-slate-50/70">
                    <td className="px-3.5 py-2.5 font-mono font-bold text-[#17324d]">{row.trip.reference}</td>
                    <td className="px-3.5 py-2.5">{row.trip.departure} → {row.trip.destination}</td>
                    <td className="px-3.5 py-2.5">{tripStatusLabel(row.trip.status)}</td>
                    <td className="px-3.5 py-2.5 font-mono">{row.currency}</td>
                    <td className="px-3.5 py-2.5 text-end font-mono">{money(row.revenue, row.currency)}</td>
                    <td className="px-3.5 py-2.5 text-end font-mono">{money(row.expenses, row.currency)}</td>
                    <td className="px-3.5 py-2.5 text-end font-mono">{money(row.payroll, row.currency)}</td>
                    <td className={`px-3.5 py-2.5 text-end font-mono font-bold ${row.result < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                      {money(row.result, row.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Expense Lines Table */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <h2 className="text-base font-bold text-[#17324d]">{t('exp.lines_title')}</h2>
        {data.expenses.length === 0 ? (
          <p className="text-sm text-slate-500 py-4 text-center">{t('exp.lines_empty')}</p>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full min-w-[760px] text-start border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                  <th className="px-3.5 py-2.5">{t('driver.mission_label')}</th>
                  <th className="px-3.5 py-2.5">{t('common.type')}</th>
                  <th className="px-3.5 py-2.5">{t('common.date')}</th>
                  <th className="px-3.5 py-2.5 text-end">{t('common.amount')}</th>
                  <th className="px-3.5 py-2.5">{t('exp.col.source')}</th>
                  <th className="px-3.5 py-2.5">{t('common.description')}</th>
                  <th className="px-3.5 py-2.5">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.expenses.map((r) => {
                  const tRef = lookups.trips.find((tr) => tr.id === r.trip_id)?.reference || '—';
                  const receiptDoc = r.document_id ? docs.find((d) => d.id === r.document_id) : undefined;
                  const statusTone =
                    r.approval_status === 'refusee'
                      ? 'red'
                      : r.approval_status === 'en_attente'
                        ? 'amber'
                        : 'green';
                  const statusLabel =
                    r.approval_status === 'refusee'
                      ? t('exp.status.rejected')
                      : r.approval_status === 'en_attente'
                        ? t('exp.status.pending')
                        : t('exp.status.approved');
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/70">
                      <td className="px-3.5 py-2.5 font-mono font-bold text-[#17324d]">{tRef}</td>
                      <td className="px-3.5 py-2.5 font-medium">{r.expense_type}</td>
                      <td className="px-3.5 py-2.5 font-mono text-slate-600">{dateText(r.expense_date, lang)}</td>
                      <td className="px-3.5 py-2.5 text-end font-mono font-semibold">{money(r.amount, r.currency, lang)}</td>
                      <td className="px-3.5 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-slate-600">
                            {r.submitted_by_role === 'conducteur' ? t('exp.src.driver') : t('exp.src.office')}
                          </span>
                          <StatusText label={statusLabel} tone={statusTone} />
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5 text-slate-600">{r.description || '—'}</td>
                      <td className="px-3.5 py-2.5">
                        <div className="flex flex-wrap gap-1.5">
                          {receiptDoc && receiptDoc.file_path && (
                            <button
                              type="button"
                              onClick={() => {
                                setPreviewError(false);
                                setPreviewDoc(receiptDoc);
                              }}
                              className="px-2.5 py-1 rounded-md bg-white border border-slate-300 text-slate-700 font-semibold hover:bg-slate-100"
                            >
                              {t('exp.receipt_btn')}
                            </button>
                          )}
                          {r.approval_status === 'en_attente' && (
                            <>
                              <button
                                type="button"
                                onClick={() => reviewDriverExpense(r, 'validee')}
                                className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                              >
                                {t('exp.approve')}
                              </button>
                              <button
                                type="button"
                                onClick={() => reviewDriverExpense(r, 'refusee')}
                                className="px-2.5 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-700 font-semibold"
                              >
                                {t('exp.reject')}
                              </button>
                            </>
                          )}
                          <button type="button" onClick={() => openForm(r)} className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold">{t('common.edit')}</button>
                          <button
                            type="button"
                            onClick={() =>
                              setConfirm({
                                open: true,
                                title: t('exp.del_title'),
                                message: t('exp.del_msg'),
                                confirmLabel: t('common.delete'),
                                danger: true,
                                onConfirm: async () => {
                                  try {
                                    await api(`/api/expenses/${r.id}`, { method: 'DELETE' });
                                    notify('OK', 'success');
                                    await load();
                                  } catch (err) {
                                    notify(err instanceof Error ? err.message : 'Erreur suppression.', 'error');
                                  }
                                },
                              })
                            }
                            className="px-2.5 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-700 font-semibold"
                          >
                            {t('common.delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={open} title={editing ? t('exp.modal.edit') : t('exp.modal.add')} onClose={() => setOpen(false)} maxWidth="max-w-lg">
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('driver.mission_label')} *</label>
              <select required value={tripId} onChange={(e) => setTripId(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="">{t('common.choose')}</option>
                {lookups.trips.map((tr) => (
                  <option key={tr.id} value={tr.id}>{tr.reference} · {tr.departure} → {tr.destination}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('exp.type_req')}</label>
              <input required value={expType} onChange={(e) => setExpType(e.target.value)} placeholder={t('exp.type_ph')} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.amount')} *</label>
              <input type="number" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.currency')}</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="MAD">MAD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.date')}</label>
              <input type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">{t('common.description')}</label>
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700">{t('common.cancel')}</button>
            <button type="submit" className="px-4 py-2 text-sm font-bold rounded-lg bg-[#2367a5] text-white">{t('common.save')}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!previewDoc} title={previewDoc?.document_name || t('tdetail.preview_title')} onClose={() => setPreviewDoc(null)} maxWidth="max-w-3xl">
        {previewDoc && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <a
                href={getAuthenticatedFileUrl(previewDoc.id)}
                download={previewDoc.document_name}
                className="px-3 py-1.5 rounded-lg bg-[#2367a5] text-white text-xs font-semibold"
              >
                {t('common.download')}
              </a>
            </div>
            {previewDoc.mime_type === 'application/pdf' ? (
              <iframe title={previewDoc.document_name} src={getAuthenticatedFileUrl(previewDoc.id)} className="w-full h-[65vh] border border-slate-200 rounded-lg" />
            ) : previewError ? (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 text-center text-sm text-slate-600">
                {t('tdetail.preview_error')}
              </div>
            ) : (
              <img
                src={getAuthenticatedFileUrl(previewDoc.id)}
                alt={previewDoc.document_name}
                onError={() => setPreviewError(true)}
                className="max-h-[65vh] mx-auto object-contain rounded"
              />
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
