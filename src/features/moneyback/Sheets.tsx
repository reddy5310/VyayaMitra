import { useMemo, useState } from 'react';
import { allocateCredit, closeRefundCase, createRefundCase, reopenRefundCase, updateRefundCase } from '@/db/moneyback';
import type { RefundCase, Transaction } from '@/domain/types';
import type { MoneyBack, MoneyBackCase } from '@/engine/analytics';
import { formatDate } from '@/lib/dates';
import { formatINR, paiseToRupees } from '@/lib/money';
import { Badge, Button, Field, Input, Money, Notice, ProgressBar, Select, Sheet, Textarea, useToast } from '@/ui';
import { amountToPaise } from '../activity/useActivityFilters';
import { STATUS_INFO, agingText, copyText, followUpText } from './helpers';

const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Nothing was changed.');

// ─── Case sheet ──────────────────────────────────────────────────────────────

const CLOSE_REASONS: { value: NonNullable<RefundCase['closedReason']>; label: string }[] = [
  { value: 'received', label: 'Received in full' },
  { value: 'written_off', label: 'Giving up on it' },
  { value: 'not_expected', label: 'No refund is due after all' },
];

export function CaseSheet({
  data,
  onClose,
  onMatch,
  transactions,
}: {
  data: MoneyBackCase | null;
  onClose: () => void;
  /** Open "Match this credit" for this case. */
  onMatch: (caseId: string) => void;
  transactions: readonly Transaction[];
}) {
  const { toast } = useToast();
  const [amountText, setAmountText] = useState('');
  const [dateText, setDateText] = useState('');
  const [noteText, setNoteText] = useState('');
  const [closeReason, setCloseReason] = useState<NonNullable<RefundCase['closedReason']>>('received');
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast(ok, { tone: 'success' });
    } catch (e) {
      toast(msg(e), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const c = data;
  const status = c ? STATUS_INFO[c.status] : null;
  const references = useMemo(() => Object.fromEntries(transactions.map((t) => [t.id, t.reference])), [transactions]);
  const aging = c ? agingText(c) : null;
  const newExpected = amountToPaise(amountText);

  return (
    <Sheet open={c !== null} onClose={onClose} title={c ? c.case.merchant : 'Refund'} description={status?.label} size="lg">
      {c && status && (
        <div className="space-y-5 text-sm">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-fg-muted">Purchase</dt>
              <dd className="font-medium">
                <Money value={c.purchaseTotal} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Expected back</dt>
              <dd className="font-medium">{c.expected !== undefined ? <Money value={c.expected} /> : 'Amount to confirm'}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Received</dt>
              <dd className="font-medium">
                <Money value={c.received} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Still to come</dt>
              <dd className="font-medium">{c.outstanding !== undefined ? <Money value={c.outstanding} /> : 'Needs confirmation'}</dd>
            </div>
          </dl>
          {c.expected !== undefined && c.expected > 0 && <ProgressBar value={c.received / c.expected} label="Refund received so far" tone="positive" />}
          {aging && <p className={c.overdue ? 'text-warning' : 'text-fg-muted'}>{aging}</p>}
          {c.received === 0 && c.status !== 'closed' && <p className="text-fg-muted">No matching credit found in these statements.</p>}

          <section aria-label="Timeline">
            <h3 className="mb-1 font-semibold text-fg">Timeline</h3>
            <ol className="space-y-1.5 border-l border-border pl-4">
              {c.timeline.map((t, i) => (
                <li key={`${t.kind}-${i}`} className="text-fg">
                  <span className="text-xs text-fg-muted">{formatDate(t.date)}</span>
                  <br />
                  {t.text}
                  {t.amount !== undefined && (
                    <>
                      {' '}
                      <Money value={t.amount} className="font-medium" />
                    </>
                  )}
                </li>
              ))}
            </ol>
          </section>

          {c.case.state === 'open' ? (
            <>
              <section aria-label="Correct what is expected" className="space-y-2">
                <Field label="Correct the expected amount (₹)" hint="Leave blank if you do not know it yet.">
                  {({ id, describedBy }) => (
                    <div className="flex gap-2">
                      <Input id={id} aria-describedby={describedBy} inputMode="decimal" value={amountText} placeholder={c.expected !== undefined ? String(paiseToRupees(c.expected)) : 'e.g. 1,250'} onChange={(e) => setAmountText(e.target.value)} />
                      <Button
                        variant="outline"
                        disabled={busy || newExpected === null}
                        onClick={() => run(() => updateRefundCase(c.case.id, { expectedAmount: newExpected ?? undefined, expectedSource: 'user' }), 'Expected amount updated')}
                      >
                        Save
                      </Button>
                    </div>
                  )}
                </Field>
                <Field label="Date they promised the refund">
                  {({ id }) => (
                    <div className="flex gap-2">
                      <Input id={id} type="date" value={dateText} onChange={(e) => setDateText(e.target.value)} />
                      <Button variant="outline" disabled={busy || !dateText} onClick={() => run(() => updateRefundCase(c.case.id, { promisedDate: dateText }), 'Promised date saved')}>
                        Save
                      </Button>
                    </div>
                  )}
                </Field>
                <Field label="Add a note">
                  {({ id }) => (
                    <div className="space-y-2">
                      <Textarea id={id} rows={2} value={noteText} maxLength={500} onChange={(e) => setNoteText(e.target.value)} />
                      <Button
                        variant="outline"
                        disabled={busy || !noteText.trim()}
                        onClick={() => run(() => updateRefundCase(c.case.id, { notes: [c.case.notes, noteText.trim()].filter(Boolean).join('\n') }), 'Note added')}
                      >
                        Add note
                      </Button>
                    </div>
                  )}
                </Field>
              </section>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => onMatch(c.case.id)}>
                  Match a credit
                </Button>
                <Button variant="outline" onClick={() => setFollowUp(followUpText(c, references))}>
                  Prepare follow-up details
                </Button>
              </div>

              <section aria-label="Close this case" className="space-y-2">
                <Field label="Close this case">
                  {({ id }) => (
                    <div className="flex gap-2">
                      <Select id={id} value={closeReason} onChange={(e) => setCloseReason(e.target.value as typeof closeReason)}>
                        {CLOSE_REASONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </Select>
                      <Button variant="outline" disabled={busy} onClick={() => run(() => closeRefundCase(c.case.id, closeReason), 'Case closed')}>
                        Close case
                      </Button>
                    </div>
                  )}
                </Field>
              </section>
            </>
          ) : (
            <Button variant="outline" disabled={busy} onClick={() => run(() => reopenRefundCase(c.case.id), 'Case reopened')}>
              Reopen this case
            </Button>
          )}

          {followUp !== null && <FollowUp text={followUp} />}
        </div>
      )}
    </Sheet>
  );
}

function FollowUp({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  return (
    <section aria-label="Follow-up details" className="space-y-2 rounded-xl bg-surface-2 p-3">
      <h3 className="font-semibold text-fg">Follow-up details</h3>
      <Textarea readOnly rows={9} value={text} aria-label="Follow-up text" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={async () => setState((await copyText(text)) ? 'copied' : 'manual')}
        >
          Copy
        </Button>
        <span role="status" className="text-xs text-fg-muted">
          {state === 'copied' ? 'Copied.' : state === 'manual' ? 'Copying is blocked here. Select the text above and copy it.' : ''}
        </span>
      </div>
    </section>
  );
}

// ─── Track an expected refund ────────────────────────────────────────────────

export function TrackSheet({
  open,
  onClose,
  transactions,
  initialTxnId,
}: {
  open: boolean;
  onClose: () => void;
  transactions: readonly Transaction[];
  initialTxnId?: string;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(initialTxnId ?? null);
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const [promised, setPromised] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = transactions.find((t) => t.id === picked);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions
      .filter((t) => t.direction === 'debit' && (!q || t.merchant.toLowerCase().includes(q) || t.rawDescription.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [transactions, query]);
  const expected = amountToPaise(amountText);

  async function save() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await createRefundCase({
        purchaseTxnIds: [chosen.id],
        expectedAmount: expected ?? undefined,
        reason: reason.trim() || undefined,
        promisedDate: promised || undefined,
      });
      toast(`Tracking the refund for ${chosen.merchant}`, { tone: 'success' });
      onClose();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Track an expected refund" description="VyayaMitra looks for the matching credit in your statements and keeps count.">
      <div className="space-y-4 text-sm">
        {chosen ? (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 p-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-fg">{chosen.merchant}</p>
              <p className="text-xs text-fg-muted">{formatDate(chosen.date)}</p>
            </div>
            <Money value={chosen.amount} className="font-semibold" />
            <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
              Change
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Field label="Which purchase?">
              {({ id }) => <Input id={id} type="search" autoComplete="off" placeholder="Search by merchant" value={query} onChange={(e) => setQuery(e.target.value)} />}
            </Field>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {matches.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => setPicked(t.id)} className="flex min-h-touch w-full items-center justify-between gap-3 px-3 text-left hover:bg-surface-2">
                    <span className="min-w-0 truncate">
                      {formatDate(t.date, { short: true })} · {t.merchant}
                    </span>
                    <Money value={t.amount} />
                  </button>
                </li>
              ))}
              {matches.length === 0 && <li className="px-3 py-3 text-fg-muted">No purchases match.</li>}
            </ul>
          </div>
        )}
        <Field label="How much do you expect back (₹)?" hint="Leave blank if you are not sure. It will show as “Amount to confirm” instead of guessing.">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />}
        </Field>
        <Field label="Why? (optional)">{({ id }) => <Input id={id} value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} />}</Field>
        <Field label="Date they promised it (optional)">{({ id }) => <Input id={id} type="date" value={promised} onChange={(e) => setPromised(e.target.value)} />}</Field>
        {error && <Notice tone="negative">{error}</Notice>}
        <div className="flex gap-2">
          <Button disabled={!chosen} loading={busy} onClick={() => void save()}>
            Track this refund
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

// ─── Match this credit ───────────────────────────────────────────────────────

export type CreditToMatch = { creditTxnId: string; date: string; amount: number; merchant: string; unallocated: number };

export function MatchSheet({
  credit,
  cases,
  initialCaseId,
  onClose,
}: {
  credit: CreditToMatch | null;
  cases: readonly MoneyBack['cases'][number][];
  initialCaseId?: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const open = cases.filter((c) => c.case.state === 'open');
  const [caseId, setCaseId] = useState(initialCaseId ?? '');
  const [purchaseId, setPurchaseId] = useState('');
  const [amountText, setAmountText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenCase = open.find((c) => c.case.id === caseId);
  const entered = amountText.trim() ? amountToPaise(amountText) : (credit?.unallocated ?? null);
  const tooMuch = credit !== null && entered !== null && entered > credit.unallocated;

  async function save() {
    if (!credit || !caseId || entered === null || entered <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await allocateCredit({ caseId, creditTxnId: credit.creditTxnId, amount: entered, purchaseTxnId: purchaseId || undefined });
      toast('Credit matched', { tone: 'success' });
      onClose();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={credit !== null}
      onClose={onClose}
      title="Match this credit"
      description={credit ? `${credit.merchant}, ${formatDate(credit.date)}: ${formatINR(credit.amount)} (${formatINR(credit.unallocated)} not matched yet)` : undefined}
    >
      {credit && (
        <div className="space-y-4 text-sm">
          {open.length === 0 ? (
            <Notice tone="info">There is no open refund to match this to. Track an expected refund first.</Notice>
          ) : (
            <>
              <Field label="Which refund is it for?">
                {({ id }) => (
                  <Select id={id} value={caseId} onChange={(e) => { setCaseId(e.target.value); setPurchaseId(''); }}>
                    <option value="">Choose a refund</option>
                    {open.map((c) => (
                      <option key={c.case.id} value={c.case.id}>
                        {c.case.merchant} · {formatINR(c.purchaseTotal)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {chosenCase && chosenCase.purchases.length > 1 && (
                <Field label="Which purchase?">
                  {({ id }) => (
                    <Select id={id} value={purchaseId} onChange={(e) => setPurchaseId(e.target.value)}>
                      <option value="">The whole case</option>
                      {chosenCase.purchases.map((p) => (
                        <option key={p.txnId} value={p.txnId}>
                          {formatDate(p.date, { short: true })} · {formatINR(p.amount)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              <Field
                label="How much of this credit (₹)?"
                hint={`Up to ${formatINR(credit.unallocated)}. A credit can be split between refunds.`}
                error={tooMuch ? `That is more than is left of this credit (${formatINR(credit.unallocated)}).` : undefined}
              >
                {({ id, describedBy, invalid }) => (
                  <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} inputMode="decimal" placeholder={String(paiseToRupees(credit.unallocated))} value={amountText} onChange={(e) => setAmountText(e.target.value)} />
                )}
              </Field>
              {error && <Notice tone="negative">{error}</Notice>}
              <div className="flex items-center gap-2">
                <Button disabled={!caseId || tooMuch || entered === null || entered <= 0} loading={busy} onClick={() => void save()}>
                  Match
                </Button>
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                {chosenCase && <Badge tone="info">Expected {chosenCase.expected !== undefined ? formatINR(chosenCase.expected) : 'to confirm'}</Badge>}
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
