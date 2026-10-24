import { FileText, LineChart, Lock, PiggyBank, ShieldCheck } from 'lucide-react';
import { Card } from '@/ui';
import { ROUTES } from '@/app/routes';
import { LinkButton } from './LinkButton';

const POINTS = [
  { icon: LineChart, title: 'See where your money goes', body: 'Every statement row is sorted into clear categories, so spending stops being a guess.' },
  { icon: ShieldCheck, title: 'Trust every number', body: 'Transfers between your accounts and card bill payments are never counted twice.' },
  { icon: PiggyBank, title: 'Save more, on purpose', body: 'Set budgets, spot subscriptions you forgot and track goals with real figures.' },
];

/** Dedicated, balance-verified parsers. */
const BANKS = ['ICICI savings', 'ICICI credit card', 'DBS savings'];

/** Shown until the first statement is imported. */
export function FirstRun() {
  return (
    <div className="space-y-4">
      <Card className="text-center sm:py-8">
        <span className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <Lock className="h-6 w-6" aria-hidden />
        </span>
        <h2 className="text-xl font-semibold text-fg">Welcome to VyayaMitra</h2>
        <p className="mx-auto mt-2 max-w-md text-base text-fg-muted">
          Your statements are read on this device. Nothing is uploaded.
        </p>
        <div className="mt-5">
          <LinkButton to={ROUTES.import} variant="primary" icon={<FileText className="h-4 w-4" aria-hidden />}>
            Import your first statement
          </LinkButton>
        </div>
      </Card>

      <section aria-labelledby="what-it-does">
        <h2 id="what-it-does" className="sr-only">
          What VyayaMitra does
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {POINTS.map(({ icon: Icon, title, body }) => (
            <li key={title}>
              <Card className="h-full">
                <Icon className="h-5 w-5 text-primary" aria-hidden />
                <h3 className="mt-2 text-sm font-semibold text-fg">{title}</h3>
                <p className="mt-1 text-sm text-fg-muted">{body}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <Card>
        <h2 className="text-base font-semibold text-fg">Supported statements</h2>
        <p className="mt-1 text-sm text-fg-muted">Dedicated readers for:</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {BANKS.map((b) => (
            <li key={b} className="rounded-full bg-surface-2 px-3 py-1 text-sm font-medium text-fg">
              {b}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-fg-muted">
          Other banks (HDFC, SBI, Axis, Kotak…) are read by the general table reader and checked against running
          balances. You can also import a CSV export.
        </p>
      </Card>
    </div>
  );
}
