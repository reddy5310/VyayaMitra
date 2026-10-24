import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, Sankey, Tooltip } from 'recharts';
import { Info } from 'lucide-react';
import { activityLink } from '@/app/routes';
import { moneyFlow, type FlowNode } from '@/engine/analytics';
import { formatINR } from '@/lib/money';
import { ChartFrame, Money, SegmentedControl, chartColor, cn } from '@/ui';
import { tableCell, tableHead, tableNum } from './shared';
import { useExploreData } from './useExploreData';

export const FLOW_DISCLAIMER = 'Flows show where recorded money went. They do not prove which rupee paid for which purchase.';

const KIND_COLOR: Record<FlowNode['kind'], number> = {
  income: 4,
  people_in: 6,
  account: 1,
  spending_group: 9,
  saving: 7,
  people_out: 8,
  card: 10,
  unexplained: 0,
};
const KIND_LINK: Partial<Record<FlowNode['kind'], Parameters<typeof activityLink>[0]>> = {
  income: { kind: 'income' },
  people_in: { kind: 'p2p_in' },
  saving: { kind: 'investment' },
  people_out: { kind: 'p2p_out' },
  card: { kind: 'card_payment' },
};

/** Custom Sankey node: coloured by kind with a readable label. */
function SankeyNode(props: { x?: number; y?: number; width?: number; height?: number; payload?: { name: string; color: string } }) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  const right = x > 200;
  return (
    <g>
      <rect x={x} y={y} width={width} height={Math.max(height, 2)} fill={payload?.color} rx={2} />
      <text x={right ? x - 6 : x + width + 6} y={y + height / 2} textAnchor={right ? 'end' : 'start'} dominantBaseline="middle" fontSize={11} fill="rgb(var(--fg))">
        {payload?.name}
      </text>
    </g>
  );
}

export default function FlowView() {
  const { accounts, periodTxns, period, scope } = useExploreData();
  const [view, setView] = useState<'spending' | 'transfers'>('spending');

  const flow = useMemo(() => moneyFlow(periodTxns, { accounts, start: period.start, end: period.end, view }), [periodTxns, accounts, period.start, period.end, view]);
  const byId = useMemo(() => new Map(flow.nodes.map((n) => [n.id, n])), [flow.nodes]);
  const links = useMemo(() => flow.links.filter((l) => l.amount > 0 && byId.has(l.from) && byId.has(l.to)).sort((a, b) => b.amount - a.amount), [flow.links, byId]);

  const sankey = useMemo(() => {
    const used = [...new Set(links.flatMap((l) => [l.from, l.to]))];
    const index = new Map(used.map((id, i) => [id, i]));
    return {
      nodes: used.map((id) => ({ name: byId.get(id)!.label, color: chartColor(KIND_COLOR[byId.get(id)!.kind]) })),
      links: links.map((l) => ({ source: index.get(l.from)!, target: index.get(l.to)!, value: l.amount })),
    };
  }, [links, byId]);

  const biggest = links[0];
  const takeaway = biggest
    ? `The largest recorded flow is ${byId.get(biggest.from)!.label} → ${byId.get(biggest.to)!.label}: ${formatINR(biggest.amount, { whole: true })}.`
    : undefined;
  const hasUnexplained = flow.nodes.some((n) => n.kind === 'unexplained');

  const rowLink = (to: FlowNode) => {
    const params = KIND_LINK[to.kind];
    return params ? activityLink(params) : activityLink({});
  };

  return (
    <ChartFrame
      question={view === 'spending' ? 'Where did the money that came in go?' : 'How did money move between your own accounts and card bills?'}
      scope={scope}
      takeaway={takeaway}
      status={hasUnexplained ? 'estimate' : 'complete'}
      statusNote={hasUnexplained ? 'An “unexplained” node holds amounts the statements do not account for.' : undefined}
      empty={links.length === 0 ? 'No flows recorded in this period.' : undefined}
      actions={
        <SegmentedControl
          label="Flow view"
          value={view}
          onChange={setView}
          options={[
            { value: 'spending', label: 'Spending' },
            { value: 'transfers', label: 'Transfers' },
          ]}
        />
      }
      table={
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={tableHead}>From</th>
              <th className={tableHead}>To</th>
              <th className={cn(tableHead, 'text-right')}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {links.map((l) => (
              <tr key={`${l.from}>${l.to}`}>
                <td className={tableCell}>{byId.get(l.from)!.label}</td>
                <td className={tableCell}>
                  <Link className="text-primary hover:underline" to={rowLink(byId.get(l.to)!)}>
                    {byId.get(l.to)!.label}
                  </Link>
                </td>
                <td className={tableNum}>{formatINR(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <p role="note" className="mb-3 flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-fg-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          {flow.note} {FLOW_DISCLAIMER}
        </span>
      </p>

      {/* Phones get the ranked list first; the Sankey needs width. */}
      <ol aria-label="Flows, largest first" className="divide-y divide-border sm:hidden">
        {links.map((l) => {
          const to = byId.get(l.to)!;
          return (
            <li key={`${l.from}>${l.to}`}>
              <Link to={rowLink(to)} className="flex min-h-touch items-center justify-between gap-3 py-2 hover:bg-surface-2">
                <span className="min-w-0 text-sm">
                  <span className="block truncate text-fg-muted">{byId.get(l.from)!.label} →</span>
                  <span className="block truncate font-medium text-fg">{to.label}</span>
                </span>
                <span className="shrink-0 text-sm tabular-nums">
                  <Money value={l.amount} whole />
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      <div role="img" aria-label={`Sankey diagram of ${links.length} flows. The same data is in the table below.`} className="hidden h-96 w-full sm:block">
        <ResponsiveContainer width="100%" height="100%">
          <Sankey data={sankey} node={<SankeyNode />} nodePadding={18} margin={{ left: 8, right: 120, top: 8, bottom: 8 }} link={{ stroke: 'rgb(var(--border-strong))', strokeOpacity: 0.5 }}>
            <Tooltip formatter={(v: number) => formatINR(v)} />
          </Sankey>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
