'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { label, money, monthLabel, todayIso } from '@/lib/format';
import { useSession } from '@/lib/session';
import { BarChart, Donut } from '@/components/charts';
import { Button, Card, CardHeader, ErrorNote, Field, Notice, PageHeader, Spinner, Stat } from '@/components/ui';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function ReportsPage() {
  const session = useSession();
  const fmt = (n: number) => money(n, session.currency);
  const year = new Date().getUTCFullYear();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(todayIso());
  const finance = session.can('finance');
  const spending = useQuery({ queryKey: ['report-spending', session.household?.id, from, to], enabled: finance && Boolean(from && to), queryFn: () => api.get('/reports/spending', { from, to }) });
  const annual = useQuery({ queryKey: ['report-annual', session.household?.id, year], enabled: finance, queryFn: () => api.get('/reports/annual', { year }) });
  const worth = useQuery({ queryKey: ['report-worth', session.household?.id], queryFn: () => api.get('/reports/net-worth') });

  async function download() {
    const res = await api.raw('GET', '/reports/statement.csv', { query: { from, to } });
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `homeos-statement-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const s = spending.data;
  const a = annual.data;
  const w = worth.data;

  return (
    <div>
      <PageHeader title="Reports" description="Spending by category, month, person, property and payment method; year-on-year comparison; and what the household owns and owes." />

      {w ? (
        <Card className="mb-6">
          <CardHeader title="Assets and liabilities" description="Based on the values you have entered. Vehicles are counted at purchase price." />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted">Assets</p>
              <p className="tabular mt-1 text-xl font-semibold">{fmt(w.totalAssets)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Liabilities</p>
              <p className="tabular mt-1 text-xl font-semibold">{fmt(w.totalLiabilities)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Net</p>
              <p className="tabular mt-1 text-xl font-semibold">{fmt(w.netWorth)}</p>
            </div>
          </div>
          <div className="relative mt-5 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="py-2 font-medium">Group</th>
                <th className="py-2 text-right font-medium">Count</th>
                <th className="py-2 text-right font-medium">Value</th>
                <th className="py-2 text-right font-medium">Owed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {w.sections.map((x: any) => (
                <tr key={x.key}>
                  <td className="py-2">{x.label}</td>
                  <td className="tabular py-2 text-right">{x.count}</td>
                  <td className="tabular py-2 text-right">{fmt(x.value)}</td>
                  <td className="tabular py-2 text-right">{fmt(x.liabilities)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
      ) : worth.error ? (
        <div className="mb-6">
          <Notice>Your role does not include access to household reports.</Notice>
        </div>
      ) : null}

      {!finance ? (
        <Notice>Spending reports need finance access.</Notice>
      ) : (
        <>
          <Card className="mb-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="From">
                <input className="field" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="To">
                <input className="field" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
              </Field>
              <Button onClick={() => { setFrom(`${year}-01-01`); setTo(todayIso()); }}>This year</Button>
              <Button onClick={() => { setFrom(`${year - 1}-01-01`); setTo(`${year - 1}-12-31`); }}>Last year</Button>
              <Button onClick={() => { setFrom(`${todayIso().slice(0, 7)}-01`); setTo(todayIso()); }}>This month</Button>
              <span className="flex-1" />
              <Button icon={<Download className="h-4 w-4" />} onClick={download}>
                Expense statement (CSV)
              </Button>
            </div>
          </Card>
          <ErrorNote error={spending.error} />
          {spending.isLoading ? <Spinner /> : null}
          {s ? (
            <>
              <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label="Total spent" value={fmt(s.spent)} hint={`${s.count} entries · refunds deducted`} />
                <Stat label="Refunds" value={fmt(s.refunds)} />
                <Stat label="Income recorded" value={fmt(s.income)} />
                <Stat label="Average per month" value={fmt(s.byMonth.length ? s.spent / s.byMonth.length : 0)} hint={`${s.byMonth.length} month${s.byMonth.length === 1 ? '' : 's'} with entries`} />
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card className="lg:col-span-2">
                  <CardHeader title="Spending by month" />
                  <BarChart data={s.byMonth.map((m: any) => ({ label: monthLabel(m.month), value: m.amount }))} format={fmt} />
                </Card>
                <Card>
                  <CardHeader title="By category" />
                  <Donut data={s.byCategory.map((c: any) => ({ label: label(c.category), value: c.amount }))} format={fmt} />
                </Card>
                <Card>
                  <CardHeader title="By family member" />
                  <Donut data={s.byMember.map((c: any) => ({ label: c.name, value: c.amount }))} format={fmt} />
                </Card>
                <Card>
                  <CardHeader title="By property" />
                  <Donut data={s.byProperty.map((c: any) => ({ label: c.name, value: c.amount }))} format={fmt} />
                </Card>
                <Card>
                  <CardHeader title="By payment method" />
                  <Donut data={s.byPaymentMethod.map((c: any) => ({ label: c.paymentMethod === 'UNSPECIFIED' ? 'Not specified' : label(c.paymentMethod), value: c.amount }))} format={fmt} />
                </Card>
              </div>
            </>
          ) : null}
          {a ? (
            <Card className="mt-4">
              <CardHeader title={`${a.year} compared with ${a.year - 1}`} description={`${fmt(a.currentTotal)} this year · ${fmt(a.previousTotal)} last year. Grey bars are last year.`} />
              <BarChart data={a.months.map((m: any) => ({ label: MONTHS[m.month - 1], value: m.current, secondary: m.previous }))} format={fmt} />
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
