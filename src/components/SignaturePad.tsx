import React, { useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.tsx';

export function SignaturePad({
  onSave,
  saving,
  notify,
}: {
  onSave: (dataUrl: string) => Promise<void>;
  saving: boolean;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * canvas.width) / rect.width,
      y: ((e.clientY - rect.top) * canvas.height) / rect.height,
    };
  }

  function handleDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.setPointerCapture(e.pointerId);
    const p = getPoint(e);
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#17324d';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    setDrawing(true);
    setHasInk(true);
  }

  function handleMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const p = getPoint(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function handleUp() {
    setDrawing(false);
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  }

  async function save() {
    if (!hasInk) {
      notify(t('sig.help'), 'error');
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    await onSave(dataUrl);
    clear();
  }

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-slate-500">{t('sig.help')}</p>
      <canvas
        ref={canvasRef}
        width={1000}
        height={320}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        aria-label={t('sig.help')}
        className="block w-full max-w-2xl h-44 border-2 border-dashed border-slate-300 rounded-xl bg-white touch-none cursor-crosshair"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={clear}
          disabled={saving}
          className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
        >
          {t('sig.clear')}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-4 py-2 text-xs font-bold rounded-lg bg-[#2367a5] hover:bg-[#1b5386] text-white transition-colors disabled:opacity-50"
        >
          {saving ? t('sig.saving') : t('sig.save')}
        </button>
      </div>
      <p className="text-[11px] text-slate-400">{t('sig.footer')}</p>
    </div>
  );
}
