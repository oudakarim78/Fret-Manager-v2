import React, { useEffect, useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { useI18n } from '../lib/i18n.tsx';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));
    setIsAndroid(/android/.test(ua));

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    isAndroid,
    install,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

export function PWAInstallButton({
  variant = 'dark',
  appLabel,
}: {
  variant?: 'dark' | 'light';
  appLabel?: string;
}) {
  const { t } = useI18n();
  const { isInstallable, isInstalled, isIOS, isAndroid, install } = usePWAInstall();
  const [guideMode, setGuideMode] = useState<'ios' | 'android' | 'desktop' | null>(null);

  if (isInstalled) {
    return null;
  }

  const btnCls =
    variant === 'dark'
      ? 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition-colors whitespace-nowrap shrink-0'
      : 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-600 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold transition-colors whitespace-nowrap shrink-0';

  if (isInstallable) {
    return (
      <button type="button" onClick={install} className={btnCls}>
        <Download className="w-3.5 h-3.5" />
        <span>{appLabel ? `${t('pwa.install_btn')} (${appLabel})` : t('pwa.install_btn')}</span>
      </button>
    );
  }

  const targetGuide: 'ios' | 'android' | 'desktop' = isIOS ? 'ios' : isAndroid ? 'android' : 'desktop';
  const label =
    isIOS || isAndroid
      ? appLabel
        ? `${t('pwa.install_mobile_btn')} (${appLabel})`
        : t('pwa.install_mobile_btn')
      : appLabel
        ? `${t('pwa.install_btn')} (${appLabel})`
        : t('pwa.install_btn');

  return (
    <>
      <button
        type="button"
        onClick={() => setGuideMode(targetGuide)}
        className={btnCls}
      >
        <Smartphone className="w-3.5 h-3.5" />
        <span>{label}</span>
      </button>

      {guideMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white border border-slate-200 p-6 shadow-xl text-slate-800 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-extrabold text-[#17324d]">
                {guideMode === 'ios'
                  ? t('pwa.ios.title')
                  : guideMode === 'android'
                    ? t('pwa.android.title')
                    : t('pwa.desktop.title')}
                {appLabel ? ` · ${appLabel}` : ''}
              </h3>
              <button
                type="button"
                onClick={() => setGuideMode(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                aria-label={t('common.close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ol className="space-y-2 text-xs text-slate-600 list-decimal ps-4 leading-relaxed">
              <li>
                {guideMode === 'ios'
                  ? t('pwa.ios.step1')
                  : guideMode === 'android'
                    ? t('pwa.android.step1')
                    : t('pwa.desktop.step1')}
              </li>
              <li>
                {guideMode === 'ios'
                  ? t('pwa.ios.step2')
                  : guideMode === 'android'
                    ? t('pwa.android.step2')
                    : t('pwa.desktop.step2')}
              </li>
              <li>
                {guideMode === 'ios'
                  ? t('pwa.ios.step3')
                  : guideMode === 'android'
                    ? t('pwa.android.step3')
                    : t('pwa.desktop.step3')}
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setGuideMode(null)}
              className="w-full rounded-lg bg-[#17324d] hover:bg-[#1e4266] py-2 text-xs font-bold text-white transition-colors"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function OfflineIndicator() {
  const { t } = useI18n();
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 start-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-bold text-white shadow-lg no-print">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>{t('pwa.offline_banner')}</span>
    </div>
  );
}
