import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Une erreur inattendue est survenue.',
    };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Application ErrorBoundary caught error:', error, info);
  }

  override render() {
    if (this.state.hasError) {
      let friendly = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message) as { error?: string; path?: string };
        if (parsed?.error) {
          friendly = `Synchronisation Firestore (${parsed.path || 'cloud'}): ${parsed.error}`;
        }
      } catch {
        // Keep original message
      }

      return (
        <div className="min-h-screen bg-[#f3f6f9] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h1 className="text-lg font-extrabold text-[#17324d]">
              FRET MANAGER — Incident d’affichage
            </h1>
            <p className="text-xs text-slate-600 leading-relaxed break-words">{friendly}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-[#2367a5] hover:bg-[#1c5589] text-white text-xs font-bold"
            >
              Recharger l’application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
