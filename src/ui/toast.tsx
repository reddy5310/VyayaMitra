/* eslint-disable react-refresh/only-export-components -- hooks/helpers intentionally live beside their components */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from './primitives';

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: ReactNode;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  /** Show a short message. Errors stay until dismissed; others auto-dismiss after 5s. */
  toast: (message: ReactNode, opts?: { tone?: ToastTone; action?: { label: string; onClick: () => void } }) => void;
}

const ToastContext = createContext<ToastApi>({ toast: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback<ToastApi['toast']>(
    (message, opts = {}) => {
      const id = nextId++;
      const tone = opts.tone ?? 'info';
      setItems((xs) => [...xs.slice(-2), { id, tone, message, action: opts.action }]);
      if (tone !== 'error') setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 md:bottom-6"
        data-print-hide
      >
        {items.map((t) => {
          const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? AlertTriangle : Info;
          return (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              className={cn(
                'pointer-events-auto flex w-full max-w-md animate-toast-in items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-fg shadow-raised',
              )}
            >
              <Icon
                className={cn('h-5 w-5 shrink-0', t.tone === 'success' ? 'text-positive' : t.tone === 'error' ? 'text-negative' : 'text-info')}
                aria-hidden
              />
              <div className="min-w-0 flex-1">{t.message}</div>
              {t.action && (
                <button
                  type="button"
                  className="min-h-touch rounded-lg px-3 font-medium text-primary hover:bg-surface-2"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
              <button
                type="button"
                aria-label="Dismiss"
                className="min-h-touch min-w-touch rounded-lg text-fg-muted hover:bg-surface-2"
                onClick={() => dismiss(t.id)}
              >
                <X className="mx-auto h-4 w-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
