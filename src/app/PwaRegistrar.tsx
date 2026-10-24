import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import type { RegistrarReport } from './pwa';

const HOUR = 60 * 60 * 1000;

/** Registers the service worker and reports its state upward. Loaded lazily, production only. */
export default function PwaRegistrar({ onReport }: { onReport: (r: RegistrarReport) => void }) {
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Check for a new version hourly while the app stays open.
      if (registration) setInterval(() => void registration.update().catch(() => {}), HOUR);
    },
    onRegisterError() {
      /* offline-only features simply stay unavailable */
    },
  });

  useEffect(() => {
    onReport({ needRefresh, offlineReady, update: () => void updateServiceWorker(true) });
  }, [needRefresh, offlineReady, updateServiceWorker, onReport]);

  return null;
}
