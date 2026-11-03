import './styles/main.css';
import { mountApp } from './ui/app.ts';
import { t } from './i18n/index.ts';
import { toast } from './ui/widgets.ts';

declare const __PWA__: boolean;

mountApp(document.getElementById('app') as HTMLElement);

if (__PWA__ && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const firstInstall = !navigator.serviceWorker.controller;
    navigator.serviceWorker
      .register('./sw.js')
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          registration.installing?.addEventListener('statechange', (event) => {
            const worker = event.target as ServiceWorker;
            if (worker.state === 'activated' && firstInstall) toast(t('toast.offline'));
          });
        });
      })
      .catch(() => undefined);
  });
}
