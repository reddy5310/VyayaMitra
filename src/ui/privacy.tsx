import { createContext, useContext } from 'react';

export interface PrivacyState {
  hideAmounts: boolean;
}

/** Provided by the app shell from AppSettings.hideAmounts. */
export const PrivacyContext = createContext<PrivacyState>({ hideAmounts: false });

export function usePrivacy(): PrivacyState {
  return useContext(PrivacyContext);
}
