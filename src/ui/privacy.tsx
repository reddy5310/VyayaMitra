import { createContext, useContext } from 'react';

export interface PrivacyState {
  hideAmounts: boolean;
}

/** Provided by the app shell from AppSettings.hideAmounts. */
export const PrivacyContext = createContext<PrivacyState>({ hideAmounts: false });

export function usePrivacy(): PrivacyState {
  return useContext(PrivacyContext);
}

export const HIDDEN_AMOUNT = '••••';

/** Replaces an amount string with bullets when amounts are hidden. */
export function maskAmount(text: string, hide = true): string {
  return hide ? HIDDEN_AMOUNT : text;
}

/**
 * For places that cannot render <Money/>: chart ticks, tooltips, SVG labels.
 *   const fmt = useAmountFormatter();  ...  fmt(formatINR(v, { compact: true }))
 */
export function useAmountFormatter(): (text: string) => string {
  const { hideAmounts } = usePrivacy();
  return (text: string) => maskAmount(text, hideAmounts);
}
