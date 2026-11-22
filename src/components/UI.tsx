import React, { useEffect } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useI18n } from '../lib/i18n.tsx';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (!toasts.length) return null;
  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md w-full px-4 sm:px-0 pointer-events-none no-print"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const Icon =
          t.type === 'error' ? AlertCircle : t.type === 'success' ? CheckCircle2 : Info;
        const styles =
          t.type === 'error'
            ? 'bg-red-50 border-red-200 text-red-900'
            : t.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
              : 'bg-white border-slate-200 text-slate-900';
        const iconColor =
          t.type === 'error'
            ? 'text-red-600'
            : t.type === 'success'
              ? 'text-emerald-600'
              : 'text-[#2367a5]';
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg ${styles}`}
          >
            <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${iconColor}`} />
            <div className="text-sm leading-snug flex-1 whitespace-pre-line">{t.message}</div>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Fermer la notification"
              className="p-1 rounded-md hover:bg-black/5 text-slate-500 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  maxWidth = 'max-w-4xl',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[#10243a]/60 p-3 sm:p-5 overflow-y-auto no-print"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`bg-white border border-slate-200 rounded-xl w-full ${maxWidth} max-h-[92vh] flex flex-col shadow-xl`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold text-[#17324d] truncate">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors shrink-0"
          >
            {t('common.close')}
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

export interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  state,
  onClose,
}: {
  state: ConfirmState | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  if (!state?.open) return null;
  return (
    <Modal open={state.open} title={state.title} onClose={onClose} maxWidth="max-w-md">
      <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{state.message}</p>
      <div className="flex justify-end gap-2.5 mt-6">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={async () => {
            onClose();
            await state.onConfirm();
          }}
          className={`px-4 py-2 text-sm font-semibold rounded-lg text-white transition-colors ${
            state.danger ? 'bg-red-700 hover:bg-red-800' : 'bg-[#2367a5] hover:bg-[#1b5386]'
          }`}
        >
          {state.confirmLabel || t('common.confirm')}
        </button>
      </div>
    </Modal>
  );
}

export function StatusText({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'green' | 'amber' | 'red' | 'blue' | 'neutral';
}) {
  const toneClasses: Record<typeof tone, string> = {
    green: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    red: 'bg-red-50 text-red-800 border-red-200',
    blue: 'bg-sky-50 text-[#17324d] border-sky-200',
    neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-md border text-xs font-semibold whitespace-nowrap ${toneClasses[tone]}`}
    >
      {label}
    </span>
  );
}

export function InfoBanner({
  children,
  tone = 'info',
}: {
  children: React.ReactNode;
  tone?: 'info' | 'warning' | 'error';
}) {
  const styles =
    tone === 'error'
      ? 'bg-red-50 border-red-200 text-red-900'
      : tone === 'warning'
        ? 'bg-amber-50 border-amber-200 text-amber-950'
        : 'bg-[#eef4f8] border-[#c8daea] text-[#17324d]';
  return <div className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${styles}`}>{children}</div>;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
      <p className="text-base font-semibold text-[#17324d]">{title}</p>
      {description && <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
