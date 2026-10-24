import type { ActionTotals } from '@/engine/analytics';
import { MaskedText } from '@/features/overview/InsightText';
import { Card, CardHeader, Money } from '@/ui';

function Figure({ label, value, note }: { label: string; value: React.ReactNode; note: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2.5">
      <dt className="text-sm font-medium text-fg-muted">{label}</dt>
      <dd className="text-xl font-semibold text-fg">{value}</dd>
      <dd className="text-xs text-fg-muted">{note}</dd>
    </div>
  );
}

/**
 * Four measures that mean different things, shown apart and never added into one "You saved".
 * Planned figures are intentions; observed ones come from complete months.
 */
export function ActionTotalsCard({ totals }: { totals: ActionTotals }) {
  const { purchaseReduction: pr, goalContributions: gc } = totals;
  return (
    <Card>
      <CardHeader title="What your actions add up to" subtitle="Four separate measures. They are not added together." />
      <dl className="grid gap-3 sm:grid-cols-2">
        <Figure
          label="Purchase spending reduced"
          value={pr.observed === null ? '—' : <Money value={pr.observed} whole />}
          note={
            <>
              Planned <Money value={pr.planned} whole /> a month. {pr.observed === null ? 'Waiting for a full month of data.' : 'Observed in complete months.'}
            </>
          }
        />
        <Figure label="Refunds received" value={<Money value={totals.refundsReceived} whole />} note="Money returned for purchases, matched to your cases." />
        <Figure label="Fees reversed" value={<Money value={totals.feesReversed} whole />} note="Charges the bank took back." />
        <Figure
          label="Contributed to goals"
          value={gc.observed === null ? '—' : <Money value={gc.observed} whole />}
          note={
            <>
              Planned <Money value={gc.planned} whole /> a month.
            </>
          }
        />
      </dl>
      <p className="mt-3 text-xs text-fg-muted">
        <MaskedText text={totals.definition} />
      </p>
      {pr.overlappingActionIds.length > 0 && (
        <p className="mt-1 text-xs text-warning">
          {pr.overlappingActionIds.length} {pr.overlappingActionIds.length === 1 ? 'group of actions covers' : 'groups of actions cover'} the same spending, so their effects are not added together.
        </p>
      )}
    </Card>
  );
}
