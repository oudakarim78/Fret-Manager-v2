import React from 'react';
import type { CompanySettings } from '../types.ts';

const STAMP_COLORS = ['#17365d', '#1d4ed8', '#0f766e', '#991b1b'] as const;

export function resolveStampColor(color?: string | null): string {
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) return color;
  return STAMP_COLORS[0];
}

export function CompanyStamp({
  company,
  compact = false,
}: {
  company: Partial<CompanySettings> | null | undefined;
  compact?: boolean;
}) {
  if (!company || company.stamp_enabled === false) return null;

  const ink = resolveStampColor(company.stamp_color);
  const style = company.stamp_style === 'round' ? 'round' : 'rectangular';
  const companyName = (company.company_name || 'ENTREPRISE DE TRANSPORT').trim();
  const activity = (company.activity || '').trim();
  const addressLine = [company.address, company.city].filter(Boolean).join(' · ');
  const contactLine = [
    company.phone ? `Tél: ${company.phone}` : '',
    company.email ? company.email : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const legalParts = [
    company.ice ? `ICE: ${company.ice}` : '',
    company.tax_id ? `IF: ${company.tax_id}` : '',
    company.rc ? `RC: ${company.rc}` : '',
    company.tp ? `TP: ${company.tp}` : '',
  ].filter(Boolean);

  const signatoryName = (company.stamp_signatory_name || '').trim();
  const signatoryTitle = (company.stamp_signatory_title || 'Direction Générale').trim();
  const signatureUrl = (company.stamp_signature_url || '').trim();

  return (
    <div
      className={`inline-flex flex-col items-center select-none ${
        compact ? 'scale-95 origin-top-right' : ''
      }`}
    >
      <div className="relative inline-flex items-center justify-center p-1">
        {style === 'round' ? (
          <div
            className="relative w-44 h-44 rounded-full flex flex-col items-center justify-center text-center px-3 py-2"
            style={{
              border: `2.5px solid ${ink}`,
              color: ink,
              boxShadow: `inset 0 0 0 2px #ffffff, inset 0 0 0 3.5px ${ink}`,
              background: 'rgba(255,255,255,0.92)',
              transform: 'rotate(-2deg)',
            }}
          >
            <div className="text-[9.5px] font-extrabold uppercase tracking-wider leading-tight line-clamp-2 max-w-[130px]">
              {companyName}
            </div>
            {activity && (
              <div className="text-[7.5px] font-semibold uppercase tracking-wide opacity-85 mt-0.5 line-clamp-1 max-w-[125px]">
                {activity}
              </div>
            )}
            <div
              className="w-24 my-1.5"
              style={{ borderTop: `1px solid ${ink}`, opacity: 0.45 }}
            />
            {company.city && (
              <div className="text-[8.5px] font-bold uppercase tracking-widest">
                ★ {company.city} ★
              </div>
            )}
            {legalParts.length > 0 && (
              <div className="text-[7.5px] font-mono font-semibold leading-tight mt-1 max-w-[128px]">
                {legalParts.slice(0, 2).join(' · ')}
                {legalParts.length > 2 ? (
                  <>
                    <br />
                    {legalParts.slice(2).join(' · ')}
                  </>
                ) : null}
              </div>
            )}
            {company.phone && (
              <div className="text-[7.5px] font-mono mt-1 opacity-90">{company.phone}</div>
            )}
          </div>
        ) : (
          <div
            className="relative min-w-[235px] max-w-[275px] rounded-md px-3.5 py-2.5 text-center"
            style={{
              border: `2.5px solid ${ink}`,
              color: ink,
              boxShadow: `inset 0 0 0 2px #ffffff, inset 0 0 0 3.5px ${ink}`,
              background: 'rgba(255,255,255,0.92)',
              transform: 'rotate(-1.2deg)',
            }}
          >
            <div className="text-[11px] font-extrabold uppercase tracking-wider leading-tight">
              {companyName}
            </div>
            {activity && (
              <div className="text-[8.5px] font-semibold uppercase tracking-wide opacity-85 mt-0.5 leading-tight">
                {activity}
              </div>
            )}
            {addressLine && (
              <div className="text-[8.5px] mt-1 leading-tight opacity-90">{addressLine}</div>
            )}
            {contactLine && (
              <div className="text-[8px] font-mono mt-0.5 leading-tight opacity-90">
                {contactLine}
              </div>
            )}
            {legalParts.length > 0 && (
              <div
                className="text-[8px] font-mono font-bold mt-1.5 pt-1 leading-tight"
                style={{ borderTop: `1px dashed ${ink}` }}
              >
                {legalParts.join(' · ')}
              </div>
            )}
          </div>
        )}

        {/* Signature layer */}
        {signatureUrl ? (
          <img
            src={signatureUrl}
            alt="Signature"
            className="pointer-events-none max-w-[155px] max-h-[68px] object-contain -mt-6 absolute -bottom-3 right-1 mix-blend-multiply drop-shadow-xs"
          />
        ) : (
          <svg
            viewBox="0 0 180 54"
            className="pointer-events-none w-32 h-11 absolute -bottom-3 right-1 opacity-85"
            aria-hidden="true"
          >
            <path
              d="M12 38 C 28 12, 42 46, 58 24 C 70 10, 78 40, 94 28 C 108 18, 122 36, 146 22 C 154 18, 162 24, 168 20"
              fill="none"
              stroke={ink}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M18 44 Q 88 34, 162 42"
              fill="none"
              stroke={ink}
              strokeWidth="1.4"
              strokeLinecap="round"
              opacity="0.7"
            />
          </svg>
        )}
      </div>

      {(signatoryName || signatoryTitle) && (
        <div className="mt-3 text-center leading-tight" style={{ color: ink }}>
          {signatoryName && (
            <div className="text-[11px] font-bold">{signatoryName}</div>
          )}
          {signatoryTitle && (
            <div className="text-[10px] font-medium opacity-80">{signatoryTitle}</div>
          )}
        </div>
      )}
    </div>
  );
}
