'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Download, X } from 'lucide-react';
import { api } from '@/lib/api';
import { label, money, monthLabel, todayIso } from '@/lib/format';
import { useQueryParams, useTab } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { BarChart, Donut } from '@/components/charts';
import { RecordForm, ResourceView, type Row } from '@/components/resource';
import { Badge, Button, Card, CardHeader, LinkButton, Modal, Notice, PageHeader, Stat, Tabs } from '@/components/ui';

function ApprovalActions({ row }: { row: Row }) {
  const session = useSession();
  const qc = useQueryClient();
  const decide = useMutation({
    mutationFn: (approve: boolean) => api.post(`/expenses/${row.id}/${approve ? 'approve' : 'reject'}`, {}),
    onSuccess: () => qc.invalidateQueries(),
  });
  if (row.approvalStatus !== 'PENDING' || !session.can('finance', 'approve')) return row.duplicateSuspect ? <Badge tone="warn">Possible duplicate</Badge> : null;
  return (
    <>
      <Button size="sm" loading={decide.isPending} icon={<Check className="h-3.5 w-3.5" />} onClick={() => decide.mutate(true)} title={decide.error ? String((decide.error as any).message) : undefined}>
        Approve
      </Button>
      <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => decide.mutate(false)}>
        Reject
      </Button>
    </>
  );
}

export default function FinancePage() {
  const session = useSession();
  const params = useQueryParams();
  const [tab, setTab] = useTab('expenses', ['expenses', 'pending', 'accounts'] as const);
  const [adding, setAdding] = useState(false);
  const fmt = (n: number) => money(n, session.currency);
  const year = new Date().getUTCFullYear();
  const report = useQuery({ queryKey: ['spending', session.household?.id, year], queryFn: () => api.get('/reports/spending', { from: `${year}-01-01`, to: todayIso() }) });
  const month = todayIso().slice(0, 7);

  useEffect(() => {
    if (params?.get('add') === '1') setAdding(true);
  }, [params]);

  const r = report.data;
  const thisMonth = r?.byMonth.find((m: any) => m.month === month)?.amount ?? 0;

  async function downloadStatement() {
    const res = await api.raw('GET', '/reports/statement.csv', { query: { from: `${year}-01-01`, to: todayIso() } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `homeos-statement-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        title="Finance"
        description="Every household expense in one ledger. Paid bills, salaries, fuel, repairs, purchases and travel are added here automatically."
        actions={
          <>
            <LinkButton href="/finance/transactions">Bank transactions</LinkButton>
            <LinkButton href="/finance/budgets">Budgets</LinkButton>
            <Button icon={<Download className="h-4 w-4" />} onClick={downloadStatement}>
              Statement
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Spent this month" value={fmt(thisMonth)} />
        <Stat label={`Spent in ${year}`} value={r ? fmt(r.spent) : '—'} hint={r ? `${r.count} entries` : undefined} />
        <Stat label="Refunds received" value={r ? fmt(r.refunds) : '—'} />
        <Stat label="Income recorded" value={r ? fmt(r.income) : '—'} hint="e.g. rent received" />
      </div>

      {r ? (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title={`Monthly spending, ${year}`} />
            <BarChart data={r.byMonth.map((m: any) => ({ label: monthLabel(m.month), value: m.amount }))} format={fmt} highlightLast />
          </Card>
          <Card>
            <CardHeader title="By category" description={`${year} to date`} />
            <Donut data={r.byCategory.map((c: any) => ({ label: label(c.category), value: c.amount }))} format={fmt} />
          </Card>
          <Card>
            <CardHeader title="By family member" />
            <Donut data={r.byMember.map((c: any) => ({ label: c.name, value: c.amount }))} format={fmt} />
          </Card>
          <Card>
            <CardHeader title="By payment method" />
            <Donut data={r.byPaymentMethod.map((c: any) => ({ label: c.paymentMethod === 'UNSPECIFIED' ? 'Not specified' : label(c.paymentMethod), value: c.amount }))} format={fmt} />
          </Card>
        </div>
      ) : null}

      <div className="mt-8">
        <Tabs
          tabs={[
            { key: 'expenses', label: 'Expenses' },
            { key: 'pending', label: 'Awaiting approval' },
            { key: 'accounts', label: 'Accounts & cards' },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === 'expenses' ? (
          <ResourceView
            resource="expenses"
            columns={['date', 'description', 'category', 'merchant', 'memberId', 'kind', 'amount', 'approvalStatus']}
            rowActions={(row) => <ApprovalActions row={row} />}
            emptyHint="Add your first expense. Leave the category empty to have it categorised automatically."
          />
        ) : null}
        {tab === 'pending' ? (
          <>
            <div className="mb-3">
              <Notice>Expenses above the household approval limit, entered by members who cannot approve, wait here. They are not counted in totals until approved. Set the limit in Settings.</Notice>
            </div>
            <ResourceView resource="expenses" filter={{ approvalStatus: 'PENDING' }} canCreate={false} columns={['date', 'description', 'category', 'memberId', 'amount']} rowActions={(row) => <ApprovalActions row={row} />} />
          </>
        ) : null}
        {tab === 'accounts' ? <ResourceView resource="bank-accounts" emptyHint="Add the bank accounts, cards and wallets you pay from. Only the last four digits are stored." /> : null}
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add expense" wide>
        {adding ? <RecordForm resource="expenses" defaults={{ date: todayIso() }} onSaved={() => setAdding(false)} onCancel={() => setAdding(false)} /> : null}
      </Modal>
    </div>
  );
}
