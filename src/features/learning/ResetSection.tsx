import { useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { resetLearning } from '@/db/learning';
import { Button, Card, CardHeader, ConfirmDialog, useToast } from '@/ui';

type What = 'model' | 'templates' | 'all';

const OPTIONS: { what: What; button: string; title: string; confirm: string; explain: ReactNode; requireText?: string }[] = [
  {
    what: 'model',
    button: 'Forget what I taught it',
    title: 'Forget your corrections?',
    confirm: 'Forget corrections',
    explain: (
      <>
        <p>
          Clears your correction history and the guesses VyayaMitra learned from it. It goes back to its built-in knowledge, so some transactions may need review again.
        </p>
        <p>Your transactions, imported statements, remembered rules and learned formats are not touched.</p>
      </>
    ),
  },
  {
    what: 'templates',
    button: 'Forget learned formats',
    title: 'Forget automatically learned formats?',
    confirm: 'Forget formats',
    explain: (
      <>
        <p>Removes the statement layouts VyayaMitra learned by itself. The next statement is read from scratch and its layout is learned again if the numbers add up.</p>
        <p>Formats you taught or imported yourself are kept. Statements you already imported are not touched.</p>
      </>
    ),
  },
  {
    what: 'all',
    button: 'Reset all learning',
    title: 'Reset everything it has learned?',
    confirm: 'Reset all learning',
    requireText: 'RESET',
    explain: (
      <>
        <p>Clears your correction history, the learned guesses and the learned formats in one go. This cannot be undone.</p>
        <p>Your transactions and imported statements stay. Back up first if you may want this learning later.</p>
      </>
    ),
  },
];

export function ResetSection() {
  const { toast } = useToast();
  const [what, setWhat] = useState<What | null>(null);
  const option = OPTIONS.find((o) => o.what === what);

  return (
    <Card>
      <CardHeader title="Reset learning" subtitle="Start fresh without losing any of your transactions." />
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => (
          <Button key={o.what} variant="outline" icon={<RotateCcw className="h-4 w-4" aria-hidden />} onClick={() => setWhat(o.what)}>
            {o.button}
          </Button>
        ))}
      </div>
      <ConfirmDialog
        open={Boolean(option)}
        onClose={() => setWhat(null)}
        title={option?.title ?? ''}
        confirmLabel={option?.confirm}
        requireText={option?.requireText}
        tone="danger"
        onConfirm={async () => {
          if (!what) return;
          await resetLearning(what);
          toast('Learning reset.', { tone: 'success' });
        }}
      >
        {option?.explain}
      </ConfirmDialog>
    </Card>
  );
}
