import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { categoryName } from '@/domain/categories';
import type { CustomCategory, InsightFeedback, IsoDate, Paise, SavingAction } from '@/domain/types';
import type { Insight, InsightSeverity } from '@/engine/analytics';
import { createSavingAction, upsertBudget } from '@/db/actions';
import { clearInsightFeedback, recordInsightFeedback } from '@/db/review';
import { ROUTES, activityLink } from '@/app/routes';
import { addMonths, formatMonth, monthKey } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { Badge, Button, Card, CardHeader, Money, Notice, Sheet, cn, useToast } from '@/ui';
import { InsightTextView, MaskedText } from './InsightText';
import { rich, useMask } from './mask';
import { LinkButton } from './LinkButton';

const SEVERITY: Record<InsightSeverity, { icon: typeof Info; chip: string; iconClass: string; label: string }> = {
  critical: { icon: AlertOctagon, chip: 'bg-negative-soft', iconClass: 'text-negative', label: 'Needs attention' },
  warning: { icon: AlertTriangle, chip: 'bg-warning-soft', iconClass: 'text-warning', label: 'Worth a look' },
  info: { icon: Info, chip: 'bg-info-soft', iconClass: 'text-info', label: 'For your information' },
  positive: { icon: CheckCircle2, chip: 'bg-positive-soft', iconClass: 'text-positive', label: 'Good news' },
};

const COLLAPSED_COUNT = 4;

/** Where the insight's single action leads when it does not create anything. */
function actionTarget(insight: Insight): string | null {
  const a = insight.action;
  if (!a) return null;
  switch (a.type) {
    case 'review_recurring':
      return `${ROUTES.plan}?tab=recurring`;
    case 'review_transactions':
      return activityLink({ review: true });
    case 'import_statement':
      return ROUTES.import;
    case 'goal_contribution':
      return `${ROUTES.plan}?tab=goals`;
    case 'custom':
      return `${ROUTES.plan}?tab=actions`;
    case 'category_limit':
      return `${ROUTES.plan}?tab=budgets`;
  }
}

interface Props {
  insights: Insight[];
  actions: readonly SavingAction[];
  /** Average monthly spend per category over recent complete months (the "before" figure for a limit). */
  baselines: { category: string; monthlyAverage: Paise }[];
  customCategories: readonly CustomCategory[];
  today: IsoDate;
  title?: string;
  subtitle?: string;
  /** Saved dismiss / expected / not-relevant marks, so "Undo" can find the one it just made. */
  feedback?: readonly InsightFeedback[];
}

export function InsightsSection({ insights, actions, baselines, customCategories, today, title = 'Insights', subtitle = 'What changed, and what you can do about it', feedback = [] }: Props) {
  const { toast } = useToast();
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;

  async function mark(insight: Insight, action: InsightFeedback['action']) {
    const key = insight.key ?? insight.id;
    try {
      await recordInsightFeedback({ key, insightId: insight.id, action });
      toast(action === 'dismissed' ? 'Insight dismissed.' : action === 'expected' ? 'Marked as expected.' : 'We will not show this kind of insight again.', {
        tone: 'success',
        action: {
          label: 'Undo',
          onClick: () => {
            const entry = feedbackRef.current.find((f) => f.key === key && f.action === action);
            if (entry) clearInsightFeedback(entry.id).catch((e) => toast(e instanceof Error ? e.message : 'Could not undo.', { tone: 'error' }));
          },
        },
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save that.', { tone: 'error' });
    }
  }
  const [showAll, setShowAll] = useState(false);
  const [limitFor, setLimitFor] = useState<Insight | null>(null);
  const visible = showAll ? insights : insights.slice(0, COLLAPSED_COUNT);

  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      {insights.length === 0 ? (
        <p className="py-2 text-sm text-fg-muted">Nothing stands out for this period. Insights appear as more data comes in.</p>
      ) : (
        <ul className="space-y-3">
          {visible.map((insight) => (
            <InsightItem
              key={insight.id}
              insight={insight}
              started={actions.some((a) => a.insightId === insight.id && a.status !== 'dropped')}
              canSetLimit={limitBaseline(insight, baselines) !== null}
              onSetLimit={() => setLimitFor(insight)}
              onMark={(a) => mark(insight, a)}
            />
          ))}
        </ul>
      )}
      {insights.length > COLLAPSED_COUNT && (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll((s) => !s)}
          className="mt-2 min-h-touch w-full rounded-xl text-sm font-medium text-primary hover:bg-surface-2"
        >
          {showAll ? 'Show fewer insights' : `Show all ${insights.length} insights`}
        </button>
      )}
      <SetLimitSheet
        key={limitFor?.id ?? 'none'}
        insight={limitFor}
        baseline={limitFor ? limitBaseline(limitFor, baselines) : null}
        customCategories={customCategories}
        today={today}
        onClose={() => setLimitFor(null)}
      />
    </Card>
  );
}

/** Monthly spend before the action: the category's recent average, else implied by target + estimated saving. */
function limitBaseline(insight: Insight, baselines: Props['baselines']): Paise | null {
  const a = insight.action;
  if (!a || a.type !== 'category_limit' || a.suggestedTarget === undefined || a.suggestedTarget <= 0) return null;
  const known = baselines.find((b) => b.category === a.category)?.monthlyAverage;
  if (known !== undefined && known > 0) return known;
  if (insight.estimatedMonthlySaving !== undefined) return a.suggestedTarget + insight.estimatedMonthlySaving;
  return null;
}

function InsightItem({
  insight,
  started,
  canSetLimit,
  onSetLimit,
  onMark,
}: {
  insight: Insight;
  started: boolean;
  canSetLimit: boolean;
  onSetLimit: () => void;
  onMark: (a: InsightFeedback['action']) => void;
}) {
  const sev = SEVERITY[insight.severity];
  const Icon = sev.icon;
  const target = actionTarget(insight);
  const a = insight.action;
  const r = rich(insight);
  const mask = useMask();
  const txnCount = insight.evidence.txnIds.length;
  return (
    <li className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-start gap-2">
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', sev.chip)} aria-hidden>
          <Icon className={cn('h-4 w-4', sev.iconClass)} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-fg">
            <span className="sr-only">{sev.label}: </span>
            <InsightTextView parts={r.titleParts} fallback={insight.title} />
          </h3>
          <p className="mt-1 text-sm text-fg-muted">
            <InsightTextView parts={r.bodyParts} fallback={insight.body} />
          </p>
          {insight.basis && (
            <p className="mt-1 text-xs italic text-fg-subtle">
              Basis: <MaskedText text={insight.basis} />
            </p>
          )}

          {insight.evidence.figures.length > 0 && (
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              {r.evidence.figures.map((f) => (
                <div key={f.label} className="min-w-0">
                  <dt className="text-fg-subtle">{f.label}</dt>
                  <dd className="font-medium text-fg">{f.amount !== undefined ? <Money value={f.amount} whole /> : <MaskedText text={f.value} />}</dd>
                </div>
              ))}
            </dl>
          )}

          {insight.estimatedMonthlySaving !== undefined && insight.estimatedMonthlySaving > 0 && (
            <p className="mt-2 text-sm text-fg">
              <Badge tone="info" className="mr-1.5">
                Estimate
              </Badge>
              Could save about <Money value={insight.estimatedMonthlySaving} whole className="font-medium" /> a month. Not saved yet.
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {txnCount > 0 && (
              <Link
                to={activityLink({ ids: insight.evidence.txnIds })}
                className="inline-flex min-h-touch items-center rounded-xl px-2 text-sm font-medium text-primary hover:bg-surface-2"
              >
                See {txnCount} {txnCount === 1 ? 'transaction' : 'transactions'}
              </Link>
            )}
            {a &&
              (started ? (
                <Badge tone="positive">Action started</Badge>
              ) : a.type === 'category_limit' && canSetLimit ? (
                <Button size="md" variant="secondary" onClick={onSetLimit}>
                  {a.label}
                </Button>
              ) : target ? (
                <LinkButton to={target} variant="secondary">
                  {a.label}
                </LinkButton>
              ) : null)}
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label={`Feedback on ${mask(insight.title)}`}>
            {(
              [
                ['dismissed', 'Dismiss'],
                ['expected', 'Expected'],
                ['irrelevant', 'Not relevant'],
              ] as const
            ).map(([a, label]) => (
              <button
                key={a}
                type="button"
                onClick={() => onMark(a)}
                className="min-h-touch rounded-xl px-2 text-sm font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                {label}
                <span className="sr-only">: {mask(insight.title)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </li>
  );
}

function SetLimitSheet({
  insight,
  baseline,
  customCategories,
  today,
  onClose,
}: {
  insight: Insight | null;
  baseline: Paise | null;
  customCategories: readonly CustomCategory[];
  today: IsoDate;
  onClose: () => void;
}) {
  const [alsoBudget, setAlsoBudget] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  const a = insight?.action;
  const category = a?.category;
  const target = a?.suggestedTarget;
  const open = Boolean(insight && a && category && target && baseline !== null);
  const startMonth = addMonths(monthKey(today), 1);
  const name = category ? categoryName(category, customCategories) : '';

  async function confirm() {
    if (!insight || !category || !target || baseline === null) return;
    setBusy(true);
    setError(null);
    try {
      await createSavingAction({
        type: 'category_limit',
        title: `Keep ${name} near ${formatINR(target, { whole: true })} a month`,
        category,
        baselineMonthly: baseline,
        targetMonthly: target,
        startMonth,
        status: 'active',
        insightId: insight.id,
        scope: { categories: [category] },
        outcomeKind: 'purchase_reduction',
      });
      if (alsoBudget) await upsertBudget(category, target);
      toast(alsoBudget ? `Action started and ${name} budget set.` : 'Action started.', {
        tone: 'success',
        action: { label: 'View in Plan', onClick: () => navigate(`${ROUTES.plan}?tab=actions`) },
      });
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong. Nothing was changed.';
      setError(message);
      toast(message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Cut back on ${name}`}
      description="Start a saving action and track it against your next complete months."
      size="sm"
      footer={
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button onClick={confirm} loading={busy} className="flex-1">
            Start action
          </Button>
        </div>
      }
    >
      {insight && category && target !== undefined && baseline !== null && (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-fg-muted">Recent monthly spend</dt>
              <dd className="text-lg font-semibold text-fg">
                <Money value={baseline} whole />
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">Your target</dt>
              <dd className="text-lg font-semibold text-fg">
                <Money value={target} whole />
              </dd>
            </div>
          </dl>
          <p className="text-sm text-fg-muted">
            Tracking starts in {formatMonth(startMonth)}. Savings are counted only from months fully covered by your statements; until then it is an estimate.
          </p>
          <label className="flex min-h-touch items-center gap-3 text-sm text-fg">
            <input type="checkbox" className="h-5 w-5 accent-primary" checked={alsoBudget} onChange={(e) => setAlsoBudget(e.target.checked)} />
            <span>
              Also set a monthly budget for {name} at <Money value={target} whole />
            </span>
          </label>
          {error && (
            <Notice tone="negative" title="Could not start the action">
              {error}
            </Notice>
          )}
        </div>
      )}
    </Sheet>
  );
}
