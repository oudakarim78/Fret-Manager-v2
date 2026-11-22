import React, { useEffect, useState } from 'react';
import { Check, Copy, Share2, Users } from 'lucide-react';
import type { PublicProfile } from '../types.ts';
import { api } from '../lib/api.ts';
import { useI18n } from '../lib/i18n.tsx';
import { InfoBanner, Modal } from './UI.tsx';

export function ShareModal({
  open,
  onClose,
  profile,
  notify,
}: {
  open: boolean;
  onClose: () => void;
  profile: PublicProfile;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t, lang } = useI18n();
  const [usersCount, setUsersCount] = useState<number | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    if (!open) return;
    api<{ users_count: number }>('/api/workspace/share')
      .then((res) => setUsersCount(res.users_count))
      .catch(() => setUsersCount(null));
  }, [open]);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const shareUrl = `${baseUrl}/erp?workspace=${encodeURIComponent(profile.workspace_code)}&lang=${lang}`;

  async function copyText(text: string, which: 'url' | 'code') {
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'url') {
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2000);
      } else {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      }
      notify(t('common.copied'), 'success');
    } catch {
      notify(t('common.copy_manual'), 'info');
    }
  }

  return (
    <Modal open={open} title={t('share.title')} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4">
        <InfoBanner>{t('share.banner', { name: profile.workspace_name })}</InfoBanner>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
          <div>
            <div className="text-xs font-bold text-slate-600 mb-1">{t('share.link_label')}</div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                dir="ltr"
                value={shareUrl}
                onFocus={(e) => e.target.select()}
                className="flex-1 px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg text-slate-800"
              />
              <button
                type="button"
                onClick={() => copyText(shareUrl, 'url')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white transition-colors whitespace-nowrap shrink-0"
              >
                {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedUrl ? t('share.copied_btn') : t('share.copy_link')}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-200">
            <div>
              <div className="text-xs font-bold text-slate-600">{t('share.code_label')}</div>
              <div className="text-lg font-extrabold font-mono text-[#17324d] tracking-wider">
                {profile.workspace_code}
              </div>
            </div>
            <button
              type="button"
              onClick={() => copyText(profile.workspace_code, 'code')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors"
            >
              {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {t('share.copy_code')}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500 px-1">
          <span className="inline-flex items-center gap-1.5">
            <Users className="w-4 h-4 text-slate-400" />
            {usersCount !== null
              ? t('share.users_count', { count: usersCount })
              : t('share.collab_active')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Share2 className="w-3.5 h-3.5 text-slate-400" />
            {t('share.free_access')}
          </span>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
