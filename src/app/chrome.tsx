/**
 * PAGE CHROME — how a screen talks to the app shell's header.
 *
 * The shell owns the header (top app bar on phones, page heading on desktop), the hide-amounts
 * toggle and the bottom tabs / sidebar. A page only declares what it wants in the header:
 *
 *   import { usePageChrome } from '@/app/chrome';
 *
 *   export default function ActivityPage() {
 *     usePageChrome({
 *       title: 'Activity',                       // <h1>; defaults to the route name
 *       showPeriod: true,                        // shows the shared <PeriodPicker/> in the header
 *       actions: <Button size="sm">Export</Button>, // optional extra controls, right side of the header
 *     });
 *     return ...;
 *   }
 *
 * Declarative alternative (renders nothing, same effect):
 *
 *   <PageHeader title="Plan" showPeriod actions={<Button>Add</Button>} />
 *
 * Do not render your own <h1> or <PeriodPicker/> once you adopt this; the shell does it for you.
 * Settings are cleared automatically when the page unmounts.
 */
/* eslint-disable react-refresh/only-export-components -- hook + provider + component share one context */
import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

export interface PageChromeConfig {
  /** Page heading (also sets document.title). Defaults to the route's name. */
  title?: string;
  /** Short line under the title on desktop. */
  subtitle?: ReactNode;
  /** Show the shared period picker in the header. Default false. */
  showPeriod?: boolean;
  /** Extra header controls (buttons, menus). */
  actions?: ReactNode;
}

type Setter = (config: PageChromeConfig | null) => void;

const ChromeValueContext = createContext<PageChromeConfig | null>(null);
const ChromeSetterContext = createContext<Setter>(() => {});

/** Owned by the shell. Pages never render this. */
export function PageChromeProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PageChromeConfig | null>(null);
  return (
    <ChromeSetterContext.Provider value={setConfig}>
      <ChromeValueContext.Provider value={config}>{children}</ChromeValueContext.Provider>
    </ChromeSetterContext.Provider>
  );
}

/** What the page asked for (null when it asked for nothing). Used by the shell. */
export function useChromeConfig(): PageChromeConfig | null {
  return useContext(ChromeValueContext);
}

export function usePageChrome(config: PageChromeConfig): void {
  const set = useContext(ChromeSetterContext);
  const { title, subtitle, showPeriod, actions } = config;
  const value = useMemo<PageChromeConfig>(() => ({ title, subtitle, showPeriod, actions }), [title, subtitle, showPeriod, actions]);
  useLayoutEffect(() => {
    set(value);
  }, [set, value]);
  useLayoutEffect(() => () => set(null), [set]);
}

/** Component form of usePageChrome; renders nothing. */
export function PageHeader(props: PageChromeConfig): null {
  usePageChrome(props);
  return null;
}
