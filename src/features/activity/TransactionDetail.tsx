import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Link2, RotateCcw, X } from 'lucide-react';
import { markReviewed, resetTransaction, setTransactionNote } from '@/db/actions';
import { useLedger, useTransaction } from '@/db/hooks';
import { CATEGORY_GROUP_LABELS, allCategories, categoryName } from '@/domain/categories';
import { KIND_LABELS, USER_SELECTABLE_KINDS } from '@/domain/kinds';
import type { CategoryGroup, Transaction, TxnKind } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { Badge, Button, CategoryIcon, Field, IconButton, Input, Money, Notice, Select, Sheet, Spinner, Textarea, useToast } from '@/ui';
import { CorrectionPrompt } from './CorrectionPrompt';
import { COUNTERPARTY_LABELS, categorySourceLabel, kindSourceLabel, linkExplanation } from './labels';
import { errorMessage, useCorrection } from './useCorrection';

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right text-fg">{children}</dd>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-1 mt-5 text-xs font-semibold uppercase tracking-wide text-fg-muted">{children}</h3>;
}

/**
 * Detail sheet for `?txn=<id>`. The sheet stays mounted while data reloads, and the body is keyed by
 * transaction id only, so open editors keep their text when the ledger updates underneath.
 */
export function TransactionDetail({
  txnId,
  onClose,
  onOpenTxn,
  pane = false,
}: {
  txnId: string | undefined;
  onClose: () => void;
  onOpenTxn: (id: string) => void;
  /** Wide screens: render beside the list instead of as a bottom sheet. */
  pane?: boolean;
}) {
  const txn = useTransaction(txnId);
  const content =
    txn === undefined ? (
      <Spinner label="Loading transaction" />
    ) : txn === null ? (
      <Notice tone="warning" title="Transaction not found">
        It may have been removed with its statement.
      </Notice>
    ) : (
      <DetailBody key={txn.id} txn={txn} onOpenTxn={onOpenTxn} />
    );

  if (pane) {
    return (
      <aside
        aria-label="Transaction details"
        className="sticky top-[calc(var(--vm-header-h,0px)+1rem)] max-h-[calc(100dvh-var(--vm-header-h,0px)-2rem)] overflow-y-auto rounded-2xl border border-border bg-surface p-4 shadow-card"
      >
        {txnId ? (
          <>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="truncate text-base font-semibold text-fg">{txn ? txn.merchant : 'Transaction'}</h2>
              <IconButton label="Close details" aria-keyshortcuts="Escape" onClick={onClose}>
                <X className="h-5 w-5" aria-hidden />
              </IconButton>
            </div>
            {content}
          </>
        ) : (
          <p className="py-10 text-center text-sm text-fg-muted">Select a transaction to see how it was read and to correct it.</p>
        )}
      </aside>
    );
  }

  return (
    <Sheet open={Boolean(txnId)} onClose={onClose} title={txn ? txn.merchant : 'Transaction'} size="md">
      {content}
    </Sheet>
  );
}

function DetailBody({ txn, onOpenTxn }: { txn: Transaction; onOpenTxn: (id: string) => void }) {
  const ledger = useLedger();
  const linked = useTransaction(txn.linkedTxnId);
  const { toast } = useToast();
  const correction = useCorrection(txn, ledger.transactions);

  const [merchantDraft, setMerchantDraft] = useState(txn.merchant);
  const [noteDraft, setNoteDraft] = useState(txn.note ?? '');
  const [busyAction, setBusyAction] = useState<null | 'reviewed' | 'reset' | 'note'>(null);

  useEffect(() => setMerchantDraft(txn.merchant), [txn.merchant]);
  useEffect(() => setNoteDraft(txn.note ?? ''), [txn.note]);

  const accountName = (id: string) => ledger.accounts.find((a) => a.id === id)?.name ?? 'Account';
  const statement = ledger.statements.find((s) => s.id === txn.statementId);

  const categoryGroups = useMemo(() => {
    const groups = new Map<CategoryGroup, { id: string; name: string }[]>();
    for (const c of allCategories(ledger.customCategories)) {
      const list = groups.get(c.group) ?? [];
      list.push({ id: c.id, name: c.name });
      groups.set(c.group, list);
    }
    return [...groups.entries()];
  }, [ledger.customCategories]);

  const kinds: TxnKind[] = USER_SELECTABLE_KINDS.includes(txn.kind) ? USER_SELECTABLE_KINDS : [txn.kind, ...USER_SELECTABLE_KINDS];

  async function run(kind: 'reviewed' | 'reset' | 'note', fn: () => Promise<void>, ok: string) {
    setBusyAction(kind);
    try {
      await fn();
      toast(ok, { tone: 'success' });
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' });
    } finally {
      setBusyAction(null);
    }
  }

  const trimmedMerchant = merchantDraft.trim();
  const merchantChanged = trimmedMerchant !== '' && trimmedMerchant !== txn.merchant;
  const noteDirty = noteDraft !== (txn.note ?? '');
  const canReset = txn.categorySource === 'user_txn' || txn.kindSource === 'user';

  return (
    <div>
      {/* Amount and basics */}
      <div className="flex items-center gap-3">
        <CategoryIcon category={txn.category} custom={ledger.customCategories} />
        <div className="min-w-0">
          <Money value={txn.amount} direction={txn.direction} tone="direction" className="text-2xl font-semibold" />
          <p className="text-sm text-fg-muted">
            {txn.direction === 'debit' ? 'Money out' : 'Money in'} · {formatDate(txn.date)}
            {txn.valueDate && txn.valueDate !== txn.date ? ` (value date ${formatDate(txn.valueDate)})` : ''}
          </p>
        </div>
      </div>

      {txn.needsReview && (
        <Notice
          tone="warning"
          title="Needs review"
          className="mt-4"
          action={
            <Button
              size="sm"
              variant="outline"
              loading={busyAction === 'reviewed'}
              icon={<CheckCircle2 className="h-4 w-4" aria-hidden />}
              onClick={() => run('reviewed', () => markReviewed([txn.id]), 'Marked as reviewed')}
            >
              Looks right
            </Button>
          }
        >
          {txn.reviewReasons.length > 0 ? (
            <ul className="list-disc pl-4">
              {txn.reviewReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : (
            'VyayaMitra is not sure about this one.'
          )}
        </Notice>
      )}

      <dl className="mt-4 divide-y divide-border">
        <InfoRow label="Account">{accountName(txn.accountId)}</InfoRow>
        <InfoRow label="Statement">
          {statement ? statement.fileName : 'Imported statement'} · page {txn.source.page}
        </InfoRow>
      </dl>

      {/* Merchant */}
      <SectionTitle>Merchant</SectionTitle>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (merchantChanged) correction.request({ type: 'merchant', value: trimmedMerchant, label: `Rename to “${trimmedMerchant}”` });
        }}
      >
        <Field label={<span className="sr-only">Merchant name</span>} className="flex-1">
          {({ id, describedBy }) => (
            <Input id={id} aria-describedby={describedBy} value={merchantDraft} maxLength={80} onChange={(e) => setMerchantDraft(e.target.value)} />
          )}
        </Field>
        <Button type="submit" variant="outline" disabled={!merchantChanged}>
          Rename
        </Button>
      </form>
      {correction.pending?.type === 'merchant' && <CorrectionPromptFor correction={correction} merchant={txn.merchant} />}

      {/* What VyayaMitra understood */}
      <SectionTitle>What VyayaMitra understood</SectionTitle>
      <dl className="divide-y divide-border">
        <InfoRow label="Channel">{txn.channel}</InfoRow>
        <InfoRow label="Counterparty">
          {txn.counterparty.name ?? 'Not printed'} <Badge className="ml-1">{COUNTERPARTY_LABELS[txn.counterparty.type]}</Badge>
        </InfoRow>
        {txn.counterparty.vpa && <InfoRow label="UPI ID">{txn.counterparty.vpa}</InfoRow>}
        {txn.counterparty.bank && <InfoRow label="Bank">{txn.counterparty.bank}</InfoRow>}
        {txn.reference && <InfoRow label="Reference">{txn.reference}</InfoRow>}
      </dl>

      {/* Kind and category: each with its own source and confidence */}
      <SectionTitle>Type and category</SectionTitle>
      <div className="space-y-4">
        <div>
          <Field label="Type" hint={kindSourceLabel(txn.kindSource, txn.confidence)}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={txn.kind}
                onChange={(e) => {
                  const value = e.target.value as TxnKind;
                  if (value !== txn.kind) correction.request({ type: 'kind', value, label: `Change type to “${KIND_LABELS[value]}”` });
                }}
              >
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {correction.pending?.type === 'kind' && <CorrectionPromptFor correction={correction} merchant={txn.merchant} />}
        </div>
        <div>
          <Field label="Category" hint={categorySourceLabel(txn.categorySource, txn.confidence)}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={txn.category}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value !== txn.category)
                    correction.request({
                      type: 'category',
                      value,
                      label: `Change category to “${categoryName(value, ledger.customCategories)}”`,
                    });
                }}
              >
                {categoryGroups.map(([group, list]) => (
                  <optgroup key={group} label={CATEGORY_GROUP_LABELS[group]}>
                    {list.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            )}
          </Field>
          {correction.pending?.type === 'category' && <CorrectionPromptFor correction={correction} merchant={txn.merchant} />}
        </div>
      </div>

      {txn.reasons.length > 0 && (
        <>
          <SectionTitle>Why</SectionTitle>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-fg">
            {txn.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
      )}

      {/* Linked transaction */}
      {txn.linkedTxnId && (
        <>
          <SectionTitle>Linked transaction</SectionTitle>
          <div className="flex items-start gap-3 rounded-xl bg-surface-2 p-3 text-sm">
            <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
            <div className="min-w-0 flex-1">
              <p>{linkExplanation(txn, linked, accountName)}</p>
              {linked && (
                <Button size="sm" variant="outline" className="mt-2" onClick={() => onOpenTxn(linked.id)}>
                  Open {linked.merchant}
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Source */}
      <SectionTitle>Source (as printed on the statement)</SectionTitle>
      <pre
        tabIndex={0}
        aria-label="Raw statement lines"
        className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-surface-2 p-3 font-mono text-xs text-fg"
      >
        {txn.source.rawLines.join('\n') || txn.rawDescription}
      </pre>

      {/* Note */}
      <SectionTitle>Note</SectionTitle>
      <Field label={<span className="sr-only">Note</span>}>
        {({ id }) => (
          <Textarea id={id} rows={2} maxLength={500} placeholder="Add a note for yourself" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} />
        )}
      </Field>
      {noteDirty && (
        <Button
          size="sm"
          className="mt-2"
          loading={busyAction === 'note'}
          onClick={() => run('note', () => setTransactionNote(txn.id, noteDraft.trim()), 'Note saved')}
        >
          Save note
        </Button>
      )}

      {canReset && (
        <div className="mt-6">
          <Button
            variant="ghost"
            loading={busyAction === 'reset'}
            icon={<RotateCcw className="h-4 w-4" aria-hidden />}
            onClick={() => run('reset', () => resetTransaction(txn.id), 'Back to automatic')}
          >
            Reset to automatic
          </Button>
        </div>
      )}
    </div>
  );
}

function CorrectionPromptFor({ correction, merchant }: { correction: ReturnType<typeof useCorrection>; merchant: string }) {
  if (!correction.pending) return null;
  return (
    <div className="mt-2">
      <CorrectionPrompt
        change={correction.pending.label}
        merchant={merchant}
        merchantRows={correction.merchantRows}
        busy={correction.busy}
        error={correction.error}
        onChoose={correction.apply}
        onCancel={correction.cancel}
      />
    </div>
  );
}
