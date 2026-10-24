/* eslint-disable react-refresh/only-export-components -- hooks/helpers intentionally live beside their components */
import {
  ArrowLeftRight,
  Banknote,
  BriefcaseBusiness,
  Car,
  CircleHelp,
  Clapperboard,
  Coins,
  CreditCard,
  Dumbbell,
  FileText,
  Gift,
  GraduationCap,
  HandCoins,
  HeartPulse,
  Home,
  Landmark,
  Percent,
  Plane,
  Plug,
  Receipt,
  Repeat,
  RotateCcw,
  Send,
  ShieldCheck,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  Tag,
  TrendingUp,
  Undo2,
  Users,
  UtensilsCrossed,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import { categoryById } from '@/domain/categories';
import type { CustomCategory } from '@/domain/types';
import { cn } from './primitives';

/** Every icon name used by the category catalogue (explicit so the bundle stays small). */
const ICONS: Record<string, LucideIcon> = {
  ArrowLeftRight,
  Banknote,
  BriefcaseBusiness,
  Car,
  CircleHelp,
  Clapperboard,
  Coins,
  CreditCard,
  Dumbbell,
  FileText,
  Gift,
  GraduationCap,
  HandCoins,
  HeartPulse,
  Home,
  Landmark,
  Percent,
  Plane,
  Plug,
  Receipt,
  Repeat,
  RotateCcw,
  Send,
  ShieldCheck,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  Tag,
  TrendingUp,
  Undo2,
  Users,
  UtensilsCrossed,
  Wifi,
};

/** CSS colour for chart palette slot 1..10, theme-aware via tokens. */
export function chartColor(index: number): string {
  const slot = ((Math.max(1, index) - 1) % 10) + 1;
  return `rgb(var(--chart-${slot}))`;
}

/** Round icon chip for a category, coloured from the chart palette. */
export function CategoryIcon({
  category,
  custom,
  size = 'md',
  className,
}: {
  category: string;
  custom?: readonly CustomCategory[];
  size?: 'sm' | 'md';
  className?: string;
}) {
  const def = categoryById(category, custom);
  const Icon = ICONS[def.icon] ?? Tag;
  const color = chartColor(def.colorIndex);
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-xl', size === 'sm' ? 'h-8 w-8' : 'h-10 w-10', className)}
      style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
    >
      <Icon className={size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'} />
    </span>
  );
}
