import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { categoryName } from '@/domain/categories';
import type { Budget, MonthKey } from '@/domain/types';
import { deleteBudget } from '@/db/actions';
import { useBudgets, useLedger } from '@/db/hooks';
import { usePeriod } from '@/app/period';
import { activityLink } from '@/app/routes';
import { budgetStatuses, categoryBaselines, dataRange, type BudgetStatus } from '@/engine/analytics';
import { addMonths, formatMonth, monthKey, todayIso } from '@/lib/dates';
import { Badge, Button, Card, CategoryIcon, EmptyState, IconButton, Money, Notice, ProgressBar, useToast, type Tone } from '@/ui';
import { BudgetSheet } from './BudgetSheet';
import { ConfirmSheet, ListSkeleton } from './planUi';

const STATE_LABEL: Record<BudgetStatus['state'], { label: string; tone: Tone }> = {
  ok: { label: 'On track', tone: 'positive' },
  watch: { label: 'Watch', tone: 'warning' },
  over: { label: 'Over budget', tone: 'negative' },
};

export function BudgetsTab() {
  const { ready, accounts, statements, transactions, customCategories } = useLedger();
  const budgets = useBudgets();
  const { period } = usePeriod();
  const { toast } = useToast();
  const today = useMemo(() => todayIso(), []);
  const thisMonth = monthKey(today);

  const range = useMemo(() => (ready ? dataRange(transactions) : null), [ready, transactions]);
  const latestDataMonth = range ? monthKey(range.max) : thisMonth;
  const firstMonth = range ? monthKey(range.min) : thisMonth;
  const lastMonth = latestDataMonth > thisMonth ? latestDataMonth : thisMonth;

  const periodMonth = monthKey(period.start) === monthKey(period.end) ? monthKey(period.start) : null;
  const [picked, setPicked] = useState<MonthKey | null>(null);
  const month = picked ?? periodMonth ?? latestDataMonth;
  const isCurrent = month === thisMonth;

  const statuses = useMemo(
    () => (ready && budgets ? budgetStatuses(budgets, transactions, { month, today, accounts, statements }) : []),
    [ready, budgets, transactions, month, today, accounts, statements],
  );
  const sorted = useMemo(() => [...statuses].sort((a, b) => b.usage - a.usage), [statuses]);
  const baselines = useMemo(
    () => (ready ? categoryBaselines(transactions, { accounts, statements, today, months: 3 }) : []),
    [ready, transactions, accounts, statements, today],
  );

  const [sheet, setSheet] = useState<{ editing: Budget | null } | null>(null);
  const [deleting, setDeleting] = useState<Budget | null>(null);

  const totalLimit = sorted.reduce((s, x) => s + x.budget.monthlyLimit, 0);
  const totalSpent = sorted.reduce((s, x) => s + x.spent, 0);
  const takenCategories = useMemo(() => new Set((budgets ?? []).map((b) => b.category)), [budgets]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1" role="group" aria-label="Budget month">
          <IconButton label="Previous month" disabled={month <= firstMonth} onClick={() => setPicked(addMonths(month, -1))}>
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </IconButton>
          <p className="min-w-36 text-center text-base font-semibold text-fg" aria-live="polite">
            {formatMonth(month)}
          </p>
          <IconButton label="Next month" disabled={month >= lastMonth} onClick={() => setPicked(addMonths(month, 1))}>
            <ChevronRight className="h-5 w-5" aria-hidden />
          </IconButton>
        </div>
        <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setSheet({ editing: null })} disabled={!ready || budgets === undefined}>
          Add budget
        </Button>
      </div>

      {!ready || budgets === undefined ? (
        <ListSkeleton />
      ) : sorted.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet className="h-6 w-6" aria-hidden />}
            title="No budgets yet"
            body="Set a monthly limit for a category you want to keep an eye on. We will show how you are pacing against it as the month goes."
            action={<Button onClick={() => setSheet({ editing: null })}>Add your first budget</Button>}
          />
        </Card>
      ) : (
        <>
          <Card>
            <p className="text-sm text-fg-muted">
              {formatMonth(month)} across {sorted.length} {sorted.length === 1 ? 'budget' : 'budgets'}
            </p>
            <p className="mt-1 text-lg font-semibold text-fg">
              <Money value={totalSpent} whole /> <span className="font-normal text-fg-muted">spent of</span> <Money value={totalLimit} whole />
            </p>
          </Card>
          <ul className="grid gap-3 lg:grid-cols-2">
            {sorted.map((s) => (
              <BudgetRow
                key={s.budget.id}
                status={s}
                isCurrent={isCurrent}
                customCategories={customCategories}
                onEdit={() => setSheet({ editing: s.budget })}
                onDelete={() => setDeleting(s.budget)}
              />
            ))}
          </ul>
        </>
      )}

      {sheet && (
        <BudgetSheet
          editing={sheet.editing}
          takenCategories={takenCategories}
          baselines={baselines}
          customCategories={customCategories}
          onClose={() => setSheet(null)}
        />
      )}
      {deleting && (
        <ConfirmSheet
          title="Delete this budget?"
          body={
            <>
              The {categoryName(deleting.category, customCategories)} budget will be removed. Your transactions are not affected.
            </>
          }
          confirmLabel="Delete budget"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteBudget(deleting.id);
            toast('Budget deleted.', { tone: 'success' });
          }}
        />
      )}
    </div>
  );
}

function BudgetRow({
  status,
  isCurrent,
  customCategories,
  onEdit,
  onDelete,
}: {
  status: BudgetStatus;
  isCurrent: boolean;
  customCategories: Parameters<typeof categoryName>[1];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { budget, spent, remaining, usage, expectedByToday, state, coverageComplete, txnIds } = status;
  const name = categoryName(budget.category, customCategories);
  const badge = STATE_LABEL[state];
  const paceFraction = isCurrent && expectedByToday !== undefined && budget.monthlyLimit > 0 ? Math.min(1, expectedByToday / budget.monthlyLimit) : null;
  return (
    <li>
      <Card className="h-full">
        <div className="flex items-start gap-3">
          <CategoryIcon category={budget.category} custom={customCategories} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-base font-semibold text-fg">{name}</h3>
              <Badge tone={badge.tone}>{badge.label}</Badge>
            </div>
            <p className="text-sm text-fg-muted">
              <Money value={spent} whole className="font-medium text-fg" /> of <Money value={budget.monthlyLimit} whole /> ·{' '}
              {remaining >= 0 ? (
                <>
                  <Money value={remaining} whole /> left
                </>
              ) : (
                <span className="text-negative">
                  <Money value={-remaining} whole /> over
                </span>
              )}
            </p>
          </div>
          <div className="-mr-2 -mt-1 flex shrink-0">
            <IconButton label={`Edit ${name} budget`} onClick={onEdit}>
              <Pencil className="h-4 w-4" aria-hidden />
            </IconButton>
            <IconButton label={`Delete ${name} budget`} onClick={onDelete}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </IconButton>
          </div>
        </div>

        <div className="relative mt-3">
          <ProgressBar value={usage} tone={badge.tone} label={`${name} budget used`} />
          {paceFraction !== null && (
            <span
              aria-hidden
              className="absolute -top-1 bottom-[-4px] w-0.5 rounded bg-fg"
              style={{ left: `${paceFraction * 100}%` }}
            />
          )}
        </div>
        {paceFraction !== null && expectedByToday !== undefined && (
          <p className="mt-1.5 text-xs text-fg-muted">
            Pace marker: spending evenly, you would be at <Money value={expectedByToday} whole /> by today.
          </p>
        )}

        {!coverageComplete && (
          <Notice tone="warning" className="mt-3">
            Your statements do not fully cover this month, so real spending may be higher than shown.
          </Notice>
        )}

        {txnIds.length > 0 && (
          <Link
            to={activityLink({ ids: txnIds })}
            className="mt-2 inline-flex min-h-touch items-center rounded-xl px-1 text-sm font-medium text-primary hover:underline"
          >
            See {txnIds.length} {txnIds.length === 1 ? 'transaction' : 'transactions'}
          </Link>
        )}
      </Card>
    </li>
  );
}
