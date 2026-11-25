'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { date, money } from '@/lib/format';
import { useSession } from '@/lib/session';
import { ResourceView, useRefOptions, type Row } from '@/components/resource';
import { Badge, Button, ErrorNote, Field, Modal, Notice, PageHeader } from '@/components/ui';
import { BackLink } from '@/components/widgets';

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const accounts = useRefOptions('bank-accounts', open);
  const [accountId, setAccountId] = useState('');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const run = useMutation({
    mutationFn: () => api.post('/transactions/import', { bankAccountId: accountId, csv }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const result = run.data;
  return (
    <Modal open={open} onClose={onClose} title="Import a bank statement" description="Upload the CSV file exported from your bank's website." wide>
      <div className="space-y-4">
        <Notice>
          The file is read in your browser and its rows are sent to HomeOS. Rows that were imported before are skipped. HomeOS does not connect to your bank.
        </Notice>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Account" required>
            <select className="field" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">{accounts.isLoading ? 'Loading…' : 'Select…'}</option>
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Statement file (CSV)" required help={fileName || 'Columns such as date, narration, withdrawal, deposit and balance are detected automatically.'}>
            <input
              className="field"
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setFileName(`${f.name} · ${Math.round(f.size / 1024)} KB`);
                setCsv(await f.text());
              }}
            />
          </Field>
        </div>
        {accounts.data && accounts.data.length === 0 ? <Notice tone="warn">Add a bank account on the Finance page first.</Notice> : null}
        <ErrorNote error={run.error} />
        {result ? (
          <Notice tone="ok" title={`Imported ${result.imported} transaction${result.imported === 1 ? '' : 's'}`}>
            {result.skippedAsDuplicates} already present and skipped.
            {result.errors.length ? (
              <ul className="mt-1 list-disc pl-5">
                {result.errors.slice(0, 8).map((er: any) => (
                  <li key={er.line}>
                    Line {er.line}: {er.message}
                  </li>
                ))}
                {result.errors.length > 8 ? <li>…and {result.errors.length - 8} more</li> : null}
              </ul>
            ) : null}
          </Notice>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" loading={run.isPending} disabled={!accountId || !csv} onClick={() => run.mutate()}>
            Import
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function MatchDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const session = useSession();
  const qc = useQueryClient();
  const suggestions = useQuery({ queryKey: ['txn-suggestions', row?.id], enabled: Boolean(row), queryFn: () => api.post(`/transactions/${row!.id}/suggestions`, {}) });
  const done = () => {
    qc.invalidateQueries();
    onClose();
  };
  const match = useMutation({ mutationFn: (expenseId: string | null) => api.post(`/transactions/${row!.id}/match`, { expenseId }), onSuccess: done });
  const create = useMutation({ mutationFn: () => api.post(`/transactions/${row!.id}/create-expense`, {}), onSuccess: done });
  if (!row) return null;
  return (
    <Modal open onClose={onClose} title="Reconcile transaction" description={`${date(row.date)} · ${row.description} · ${money(row.amount, session.currency)}`}>
      <div className="space-y-4">
        {row.matchedExpenseId ? (
          <Notice tone="ok" title="Matched">
            Linked to: {row._refs?.matchedExpenseId?.label ?? 'an expense'}.
            <div className="mt-2">
              <Button size="sm" loading={match.isPending} onClick={() => match.mutate(null)}>
                Unlink
              </Button>
            </div>
          </Notice>
        ) : (
          <>
            <div>
              <p className="mb-2 text-sm font-medium">Expenses with the same amount around this date</p>
              {suggestions.isLoading ? (
                <p className="text-sm text-muted">Looking…</p>
              ) : (suggestions.data ?? []).length === 0 ? (
                <p className="text-sm text-muted">No matching expense found.</p>
              ) : (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {suggestions.data.map((e: any) => (
                    <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">
                        {date(e.date)} · {e.description}
                      </span>
                      <Button size="sm" loading={match.isPending} onClick={() => match.mutate(e.id)}>
                        Match
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-lg border border-line p-3">
              <p className="text-sm">
                No match? Create {row.direction === 'DEBIT' ? 'an expense' : 'an income entry'} from this transaction.
              </p>
              <Button className="mt-2" size="sm" variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
                Create {row.direction === 'DEBIT' ? 'expense' : 'income entry'}
              </Button>
            </div>
          </>
        )}
        <ErrorNote error={match.error ?? create.error} />
      </div>
    </Modal>
  );
}

export default function TransactionsPage() {
  const session = useSession();
  const [importing, setImporting] = useState(false);
  const [matching, setMatching] = useState<Row | null>(null);
  return (
    <div>
      <BackLink href="/finance">Finance</BackLink>
      <PageHeader title="Bank transactions" description="Statement lines from your accounts and cards. Import a statement, then match each line to an expense so nothing is counted twice or missed." />
      <ResourceView
        resource="transactions"
        columns={['date', 'description', 'bankAccountId', 'direction', 'amount', 'reconciled']}
        actions={
          session.can('finance', 'write') ? (
            <Button icon={<Upload className="h-4 w-4" />} onClick={() => setImporting(true)}>
              Import CSV
            </Button>
          ) : null
        }
        rowActions={(row) => (
          <>
            {row.duplicateSuspect ? <Badge tone="warn">Possible duplicate</Badge> : null}
            {session.can('finance', 'write') ? (
              <Button size="sm" variant={row.reconciled ? 'ghost' : 'secondary'} icon={<Link2 className="h-3.5 w-3.5" />} onClick={() => setMatching(row)}>
                {row.reconciled ? 'Matched' : 'Reconcile'}
              </Button>
            ) : null}
          </>
        )}
        emptyHint="Import a CSV statement or add transactions by hand."
      />
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
      <MatchDialog row={matching} onClose={() => setMatching(null)} />
    </div>
  );
}
