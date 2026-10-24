import { useRef, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePageChrome } from '@/app/chrome';
import { cn } from '@/ui';
import { ActionsTab } from './ActionsTab';
import { BudgetsTab } from './BudgetsTab';
import { GoalsTab } from './GoalsTab';
import { RecurringTab } from './RecurringTab';

const TABS = [
  { id: 'budgets', label: 'Budgets', Panel: BudgetsTab },
  { id: 'recurring', label: 'Recurring', Panel: RecurringTab },
  { id: 'goals', label: 'Goals', Panel: GoalsTab },
  { id: 'actions', label: 'Actions', Panel: ActionsTab },
] as const;

type TabId = (typeof TABS)[number]['id'];

function isTab(v: string | null): v is TabId {
  return TABS.some((t) => t.id === v);
}

export default function PlanPage() {
  usePageChrome({ title: 'Plan', subtitle: 'Budgets, recurring payments, goals and the saving actions you have started.' });
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const current: TabId = isTab(raw) ? raw : 'budgets';
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function select(id: TabId) {
    setParams({ tab: id }, { replace: true });
  }

  function onKeyDown(e: KeyboardEvent, index: number) {
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = TABS[next].id;
    select(id);
    refs.current[id]?.focus();
  }

  const active = TABS.find((t) => t.id === current) ?? TABS[0];
  const Panel = active.Panel;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-4 sm:px-6">
      <div role="tablist" aria-label="Plan sections" className="flex rounded-xl bg-surface-2 p-1">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`plan-tab-${t.id}`}
            aria-selected={current === t.id}
            aria-controls={`plan-panel-${t.id}`}
            tabIndex={current === t.id ? 0 : -1}
            onClick={() => select(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'min-h-touch flex-1 rounded-lg px-2 text-sm font-medium transition-colors',
              current === t.id ? 'bg-surface text-fg shadow-card' : 'text-fg-muted hover:text-fg',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`plan-panel-${active.id}`} aria-labelledby={`plan-tab-${active.id}`}>
        <Panel />
      </div>
    </div>
  );
}
