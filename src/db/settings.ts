import type { AppSettings } from '@/domain/types';

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  hideAmounts: false,
  p2pReviewThreshold: 500_000,
  onboardingDone: false,
};
