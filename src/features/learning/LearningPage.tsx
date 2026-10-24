import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import type { Transaction } from '@/domain/types';
import { useLedger, useRules } from '@/db/hooks';
import { useFeedback, useTemplates } from '@/db/learning';
import { usePageChrome } from '@/app/chrome';
import { ROUTES } from '@/app/routes';
import { learningStats, type LearningStats } from '@/engine/analytics';
import { reviewPriority } from '@/engine/understand';
import { todayIso } from '@/lib/dates';
import { Card, CardHeader, EmptyState, Notice, Skeleton } from '@/ui';
import { AccuracyTrend } from './AccuracyTrend';
import { FormatsSection } from './FormatsSection';
import { ResetSection } from './ResetSection';
import { TeachNext } from './TeachNext';

export default function LearningPage() {
  usePageChrome({ title: 'What VyayaMitra has learned', subtitle: 'Everything it knows about your statements, and how it learned it.' });

  const { ready, transactions } = useLedger();
  const templates = useTemplates();
  const feedback = useFeedback();
  const rules = useRules();
  const today = useMemo(() => todayIso(), []);

  const loaded = ready && templates !== undefined && feedback !== undefined && rules !== undefined;

  const stats = useMemo(
    () => (loaded ? learningStats(transactions, { feedback: feedback ?? [], rules: rules ?? [], templates: templates ?? [], today }) : null),
    [loaded, transactions, feedback, rules, templates, today],
  );

  const reviewTxns = useMemo(() => (ready ? transactions.filter((t) => t.needsReview) : []), [ready, transactions]);
  const priority = useMemo(() => (reviewTxns.length > 0 ? reviewPriority(reviewTxns) : []), [reviewTxns]);
  const txnById = useMemo(() => new Map<string, Transaction>(reviewTxns.map((t) => [t.id, t])), [reviewTxns]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-4 sm:px-6">
      {!stats ? (
        <div aria-busy="true" aria-label="Loading what has been learned" className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-56" />
        </div>
      ) : (
        <>
          <Hero stats={stats} />
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <div className="space-y-4">
              <AccuracyTrend trend={stats.accuracyTrend} />
              <MerchantsLearned stats={stats} />
              <TeachNext items={priority} txnById={txnById} totalNeedsReview={stats.needsReview} />
            </div>
            <div className="space-y-4">
              <FormatsSection templates={templates} />
              <ResetSection />
              <Notice tone="info" title="Private by design">
                A learned format keeps only header words, bank names and column positions. It never contains names, account numbers, amounts or descriptions. Everything
                stays on this device, and nothing is uploaded.
              </Notice>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Hero({ stats }: { stats: LearningStats }) {
  if (stats.totalTransactions === 0) {
    return (
      <Card>
        <EmptyState
          icon={<ShieldCheck className="h-6 w-6" aria-hidden />}
          title="Nothing to learn from yet"
          body="Import a statement. VyayaMitra reads it on this device, remembers its layout and gets better with every correction you make."
          className="py-6"
        />
      </Card>
    );
  }
  const percent = Math.round(stats.autoUnderstoodShare * 100);
  return (
    <Card>
      <p className="text-sm font-medium text-fg-muted">Understood automatically</p>
      <p className="mt-1 text-4xl font-semibold text-fg tabular">{percent}%</p>
      <p className="mt-1 text-sm text-fg-muted">
        of your {stats.totalTransactions.toLocaleString('en-IN')} transactions were understood without asking you.{' '}
        {stats.needsReview > 0
          ? `${stats.needsReview.toLocaleString('en-IN')} still ${stats.needsReview === 1 ? 'needs' : 'need'} your eyes.`
          : 'None need your review.'}
      </p>
      <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-3 text-sm">
        <div>
          <dt className="text-fg-muted">Corrections</dt>
          <dd className="text-lg font-semibold text-fg tabular">{stats.corrections}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Rules</dt>
          <dd className="text-lg font-semibold text-fg tabular">{stats.rules}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Formats</dt>
          <dd className="text-lg font-semibold text-fg tabular">{stats.templates.total}</dd>
        </div>
      </dl>
    </Card>
  );
}

function MerchantsLearned({ stats }: { stats: LearningStats }) {
  return (
    <Card>
      <CardHeader title="Merchants it learned" subtitle="Names you taught it once and that now apply on their own" />
      {stats.topTaught.length === 0 ? (
        <p className="text-sm text-fg-muted">No merchants taught yet. Fix a category and choose &ldquo;remember for this merchant&rdquo;.</p>
      ) : (
        <ul className="divide-y divide-border">
          {stats.topTaught.map((m) => (
            <li key={m.merchantKey} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0 text-sm">
              <span className="min-w-0 truncate font-medium text-fg">{m.merchant}</span>
              <span className="shrink-0 text-fg-muted">
                fixed {m.rows} {m.rows === 1 ? 'row' : 'rows'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm text-fg-muted">
        {stats.rules} {stats.rules === 1 ? 'rule is' : 'rules are'} remembered.{' '}
        <Link to={ROUTES.settings} className="inline-flex min-h-touch items-center font-medium text-primary hover:underline">
          Manage rules in Settings
        </Link>
      </p>
    </Card>
  );
}
