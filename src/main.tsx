import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { I18nProvider } from './lib/i18n.tsx';
import { initPersistenceListeners } from './lib/persistence.ts';
import './index.css';

initPersistenceListeners();
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <I18nProvider>
      <App />
    </I18nProvider>
  </ErrorBoundary>,
);
