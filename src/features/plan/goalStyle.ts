import {
  Car,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  PiggyBank,
  Plane,
  ShieldCheck,
  Smartphone,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { chartColor } from '@/ui';

/** Icons a goal can wear. The stored value is the lucide name. */
export const GOAL_ICONS: { name: string; label: string; Icon: LucideIcon }[] = [
  { name: 'Target', label: 'Target', Icon: Target },
  { name: 'PiggyBank', label: 'Savings', Icon: PiggyBank },
  { name: 'ShieldCheck', label: 'Emergency fund', Icon: ShieldCheck },
  { name: 'Home', label: 'Home', Icon: Home },
  { name: 'Car', label: 'Vehicle', Icon: Car },
  { name: 'Plane', label: 'Travel', Icon: Plane },
  { name: 'GraduationCap', label: 'Education', Icon: GraduationCap },
  { name: 'Gift', label: 'Celebration', Icon: Gift },
  { name: 'Smartphone', label: 'Gadget', Icon: Smartphone },
  { name: 'HeartPulse', label: 'Health', Icon: HeartPulse },
];

/** Theme-aware colours from the chart palette, stored as CSS values (`rgb(var(--chart-N))`). */
export const GOAL_COLORS: { value: string; label: string }[] = [
  { value: chartColor(1), label: 'Teal' },
  { value: chartColor(2), label: 'Blue' },
  { value: chartColor(3), label: 'Amber' },
  { value: chartColor(4), label: 'Pink' },
  { value: chartColor(5), label: 'Purple' },
  { value: chartColor(6), label: 'Green' },
];

export const DEFAULT_GOAL_ICON = 'Target';
export const DEFAULT_GOAL_COLOR = GOAL_COLORS[0].value;

export function goalIcon(name: string): LucideIcon {
  return GOAL_ICONS.find((i) => i.name === name)?.Icon ?? Target;
}
