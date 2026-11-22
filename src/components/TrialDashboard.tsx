import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Clock, Lock, ShieldAlert } from 'lucide-react';
import type { B2BLicense, PublicProfile } from '../types.ts';
import { api, setStoredToken } from '../lib/api.ts';
import { dateText } from '../lib/format.ts';
import { useI18n } from '../lib/i18n.tsx';
import { B2BSubscribeModal } from './B2BSubscribeModal.tsx';

interface MyLicenseResponse {
  license: B2BLicense;
}

function getExpiryTimestamp(validUntilIso: string): number {
  const parsed = new Date(`${validUntilIso}T23:59:59.999`);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function splitCountdown(ms: number) {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function TrialDashboard({
  profile,
  notify,
}: {
  profile: PublicProfile;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t } = useI18n();
  const [license, setLicense] = useState<B2BLicense | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const triggeredLockRef = useRef(false);

  const isAdmin = profile.role === 'admin';

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    api<MyLicenseResponse>('/api/b2b/my-license')
      .then((res) => {
        if (active && res?.license) {
          setLicense(res.license);
          setNowMs(Date.now());
        }
      })
      .catch(() => {
        // Blocking 403 responses are automatically handled by api.ts workspace-blocked listener
      });
    return () => {
      active = false;
    };
  }, [isAdmin, profile.workspace_id]);

  const expiryMs = useMemo(() => {
    if (!license) return null;
    return getExpiryTimestamp(license.valid_until);
  }, [license]);

  const remainingMs = expiryMs !== null ? Math.max(0, expiryMs - nowMs) : null;

  // Live 1-second countdown timer while in free trial
  useEffect(() => {
    if (!isAdmin || !license || license.status !== 'essai_gratuit') return;
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isAdmin, license]);

  // Trigger server-verified workspace blocking logic as soon as the timer reaches zero
  useEffect(() => {
    if (
      !isAdmin ||
      !license ||
      license.status !== 'essai_gratuit' ||
      remainingMs === null ||
      remainingMs > 0 ||
      triggeredLockRef.current
    ) {
      return;
    }

    triggeredLockRef.current = true;

    const enforceLock = async () => {
      try {
        await api<{ profile: PublicProfile }>('/api/auth/me');
        // If server clock hasn't crossed midnight by milliseconds, enforce immediate client-side lockout as well
        setStoredToken(null);
        window.dispatchEvent(
          new CustomEvent('fret:workspace-blocked', {
            detail: t('trial.expired_lock_msg'),
          }),
        );
      } catch {
        // api.ts already dispatches 'fret:workspace-blocked' on 403 access_blocked
      }
    };

    void enforceLock();
  }, [isAdmin, license, remainingMs, t]);

  if (!isAdmin || !license || license.status !== 'essai_gratuit' || remainingMs === null) {
    return null;
  }

  const { days, hours, minutes, seconds } = splitCountdown(remainingMs);
  const totalTrialDays = 14;
  const elapsedFraction = Math.min(1, Math.max(0, 1 - remainingMs / (totalTrialDays * 86400 * 1000)));
  const remainingPct = Math.max(0, Math.min(100, Math.round((1 - elapsedFraction) * 100)));

  const isExpired = remainingMs <= 0;
  const isUrgent = days <= 3;

  const borderTone = isExpired
    ? 'border-red-300 bg-red-50/60'
    : isUrgent
      ? 'border-amber-300 bg-amber-50/50'
      : 'border-[#bdd3e8] bg-[#f4f8fc]';

  const badgeTone = isExpired
    ? 'bg-red-100 text-red-800'
    : isUrgent
      ? 'bg-amber-100 text-amber-800'
      : 'bg-[#dce9f6] text-[#17324d]';

  const barTone = isExpired
    ? 'bg-red-600'
    : isUrgent
      ? 'bg-amber-500'
      : 'bg-[#2367a5]';

  return (
    <section
      aria-label={t('trial.title')}
      className={`rounded-xl border p-5 space-y-4 ${borderTone}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className={`p-2.5 rounded-lg shrink-0 ${
              isExpired
                ? 'bg-red-600 text-white'
                : isUrgent
                  ? 'bg-amber-500 text-white'
                  : 'bg-[#17324d] text-white'
            }`}
          >
            {isExpired ? (
              <Lock className="w-5 h-5" />
            ) : isUrgent ? (
              <ShieldAlert className="w-5 h-5" />
            ) : (
              <Clock className="w-5 h-5" />
            )}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-extrabold text-[#17324d]">{t('trial.title')}</h2>
              <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${badgeTone}`}>
                {isExpired
                  ? t('trial.expired')
                  : days === 0
                    ? t('trial.last_day')
                    : t('trial.days_left', { days })}
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-1">
              {t('trial.subtitle', { date: dateText(license.valid_until) })} · {t('trial.admin_only')}
            </p>
          </div>
        </div>

        {/* Countdown Blocks */}
        <div className="flex items-center gap-2" dir="ltr">
          {[
            { val: pad2(days), label: t('trial.unit.days') },
            { val: pad2(hours), label: t('trial.unit.hours') },
            { val: pad2(minutes), label: t('trial.unit.mins') },
            { val: pad2(seconds), label: t('trial.unit.secs') },
          ].map((unit) => (
            <div
              key={unit.label}
              className="min-w-[54px] rounded-lg bg-white border border-slate-200 px-2.5 py-1.5 text-center shadow-2xs"
            >
              <div
                className={`font-mono text-lg font-extrabold tabular-nums leading-tight ${
                  isExpired ? 'text-red-700' : isUrgent ? 'text-amber-700' : 'text-[#17324d]'
                }`}
              >
                {unit.val}
              </div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {unit.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Progress & Auto-lock notice + Subscribe CTA */}
      <div className="space-y-3">
        <div className="h-2 w-full rounded-full bg-white/80 border border-slate-200 overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${barTone}`}
            style={{ width: `${remainingPct}%` }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-600">{t('trial.lock_notice')}</p>
          <button
            type="button"
            onClick={() => setSubscribeOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white text-xs font-bold transition-colors whitespace-nowrap shrink-0"
          >
            <span>{t('sub.cta_btn')}</span>
            <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
          </button>
        </div>
      </div>

      <B2BSubscribeModal
        open={subscribeOpen}
        onClose={() => setSubscribeOpen(false)}
        profile={profile}
        notify={notify}
      />
    </section>
  );
}
