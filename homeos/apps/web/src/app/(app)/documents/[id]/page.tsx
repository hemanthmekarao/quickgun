'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, Eye, Share2, Trash2, Upload } from 'lucide-react';
import { api, apiUrl } from '@/lib/api';
import { date, dateTime, fileSize, label } from '@/lib/format';
import { useSession } from '@/lib/session';
import { EditRecordButton, RecordFields, useRecord } from '@/components/resource';
import { Badge, Button, Card, CardHeader, ErrorNote, Field, Modal, Notice, PageHeader, Spinner } from '@/components/ui';
import { BackLink } from '@/components/widgets';

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const record = useRecord('documents', id);
  const versions = useQuery({ queryKey: ['doc-versions', session.household?.id, id], queryFn: () => api.get<any[]>(`/documents/${id}/versions`) });
  const shares = useQuery({ queryKey: ['doc-shares', session.household?.id, id], queryFn: () => api.get<any[]>(`/documents/${id}/shares`) });
  const canWrite = session.can('documents', 'write');
  const fileRef = useRef<HTMLInputElement>(null);
  const [sharing, setSharing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shareForm, setShareForm] = useState({ expiresInDays: '7', maxDownloads: '', confirmSensitive: false });
  const [link, setLink] = useState<string | null>(null);
  const [openError, setOpenError] = useState<unknown>(null);

  async function open(version?: number, download = false) {
    setOpenError(null);
    try {
      const res = await api.get(`/documents/${id}/download-url`, version ? { version } : undefined);
      window.open(apiUrl(res.path) + (download ? '?download=1' : ''), '_blank', 'noopener');
    } catch (err) {
      setOpenError(err);
    }
  }

  const addVersion = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.upload(`/documents/${id}/versions`, fd);
    },
    onSuccess: () => qc.invalidateQueries(),
  });
  const createShare = useMutation({
    mutationFn: () => api.post(`/documents/${id}/shares`, { expiresInDays: Number(shareForm.expiresInDays), ...(shareForm.maxDownloads ? { maxDownloads: Number(shareForm.maxDownloads) } : {}), confirmSensitive: shareForm.confirmSensitive }),
    onSuccess: (res: any) => {
      setLink(res.url);
      qc.invalidateQueries();
    },
  });
  const revoke = useMutation({ mutationFn: (shareId: string) => api.del(`/document-shares/${shareId}`), onSuccess: () => qc.invalidateQueries() });
  const remove = useMutation({ mutationFn: () => api.resource('documents').remove(id), onSuccess: () => router.replace('/documents') });

  if (record.isLoading) return <Spinner />;
  if (record.error) return <ErrorNote error={record.error} />;
  const d = record.data!;
  const x = d.extractedData;

  return (
    <div>
      <BackLink href="/documents">Documents</BackLink>
      <PageHeader
        title={d.title}
        description={`${d.fileName} · ${fileSize(d.sizeBytes)} · version ${d.currentVersion} · added ${date(d.createdAt)}`}
        actions={
          <>
            <Button variant="primary" icon={<Eye className="h-4 w-4" />} onClick={() => open()}>
              Open
            </Button>
            <Button icon={<Download className="h-4 w-4" />} onClick={() => open(undefined, true)}>
              Download
            </Button>
            {canWrite ? (
              <Button icon={<Share2 className="h-4 w-4" />} onClick={() => { setLink(null); setSharing(true); }}>
                Share
              </Button>
            ) : null}
            <EditRecordButton resource="documents" row={d} label="Edit details" />
            {session.can('documents', 'delete') ? (
              <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleting(true)}>
                Delete
              </Button>
            ) : null}
          </>
        }
      />
      {openError ? <div className="mb-4"><ErrorNote error={openError} /></div> : null}
      <div className="mb-4 flex flex-wrap gap-2">
        {d._refs?.categoryId ? <Badge>{d._refs.categoryId.label}</Badge> : null}
        <Badge tone={d.sensitivity === 'NORMAL' ? 'neutral' : 'warn'}>{d.sensitivity === 'NORMAL' ? 'Visible to everyone with document access' : `${label(d.sensitivity)} — restricted`}</Badge>
        {d.restrictedToMemberIds?.length ? <Badge tone="warn">Limited to {d.restrictedToMemberIds.length} member(s)</Badge> : null}
        <Badge tone={d.ocrStatus === 'DONE' ? 'ok' : 'neutral'}>{d.ocrStatus === 'DONE' ? 'Text is searchable' : d.ocrStatus === 'NOT_SUPPORTED' ? 'Text inside is not searchable' : d.ocrStatus === 'FAILED' ? 'Text could not be read' : 'Processing'}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Details" />
          <RecordFields resource="documents" row={d} exclude={['title', 'fileName', 'mimeType', 'sizeBytes', 'currentVersion', 'ocrStatus', 'checksum', 'restrictedToMemberIds', 'sensitivity']} />
          <p className="mt-4 break-all text-xs text-muted">SHA-256 of the stored original: {d.checksum}</p>
        </Card>

        <Card>
          <CardHeader
            title="Versions"
            description="Earlier versions are kept unchanged."
            action={
              canWrite ? (
                <>
                  <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) addVersion.mutate(f); e.target.value = ''; }} />
                  <Button size="sm" icon={<Upload className="h-3.5 w-3.5" />} loading={addVersion.isPending} onClick={() => fileRef.current?.click()}>
                    New version
                  </Button>
                </>
              ) : null
            }
          />
          <ErrorNote error={addVersion.error} />
          <ul className="divide-y divide-line">
            {(versions.data ?? []).map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">
                    v{v.version} {v.current ? <Badge tone="ok">Current</Badge> : null}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {dateTime(v.createdAt)} · {fileSize(v.sizeBytes)}
                  </span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => open(v.version)}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        </Card>

        {x && x.found?.length ? (
          <Card className="lg:col-span-2">
            <CardHeader title="Read from the document" description="Detected automatically from the text. Check against the original before relying on it." />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              {[
                ['Vendor', x.vendor],
                ['Invoice number', x.invoiceNumber],
                ['Invoice date', x.invoiceDate ? date(x.invoiceDate) : null],
                ['Due date', x.dueDate ? date(x.dueDate) : null],
                ['Amount', x.amount],
                ['GST', x.gstAmount],
                ['GSTIN', x.gstin],
                ['Consumer number', x.consumerNumber],
              ]
                .filter(([, v]) => v !== undefined && v !== null)
                .map(([k, v]) => (
                  <div key={String(k)}>
                    <dt className="text-xs text-muted">{k}</dt>
                    <dd className="mt-0.5 break-words">{String(v)}</dd>
                  </div>
                ))}
            </dl>
          </Card>
        ) : null}

        <Card className={x && x.found?.length ? '' : 'lg:col-span-3'}>
          <CardHeader title="Share links" description="Links for people outside the household. Each use is recorded." />
          {(shares.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">This document has not been shared.</p>
          ) : (
            <ul className="divide-y divide-line">
              {shares.data!.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block">
                      <Badge tone={s.active ? 'ok' : 'neutral'}>{s.active ? 'Active' : s.revokedAt ? 'Revoked' : 'Expired'}</Badge> until {date(s.expiresAt)}
                    </span>
                    <span className="block text-xs text-muted">
                      {s.downloadCount} download{s.downloadCount === 1 ? '' : 's'}
                      {s.maxDownloads ? ` of ${s.maxDownloads}` : ''} · created {date(s.createdAt)}
                    </span>
                  </span>
                  {s.active && canWrite ? (
                    <Button size="sm" variant="ghost" loading={revoke.isPending} onClick={() => revoke.mutate(s.id)}>
                      Revoke
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {d.extractedText ? (
          <Card className="lg:col-span-3">
            <CardHeader title="Text in this document" description="Used for search." />
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-subtle p-3 text-xs text-muted">{String(d.extractedText).slice(0, 6000)}</pre>
          </Card>
        ) : null}
      </div>

      <Modal open={sharing} onClose={() => setSharing(false)} title="Share this document" description="Creates a link that works without signing in.">
        {link ? (
          <div className="space-y-3">
            <Notice tone="ok" title="Link created">
              Copy it now — it is not shown again. You can revoke it at any time.
            </Notice>
            <div className="flex gap-2">
              <input className="field" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Share link" />
              <Button icon={<Copy className="h-4 w-4" />} onClick={() => navigator.clipboard?.writeText(link)}>
                Copy
              </Button>
            </div>
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => setSharing(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              createShare.mutate();
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <Field label="Valid for (days)" help="1 to 30.">
                <input className="field" type="number" min={1} max={30} value={shareForm.expiresInDays} onChange={(e) => setShareForm({ ...shareForm, expiresInDays: e.target.value })} />
              </Field>
              <Field label="Download limit" help="Optional.">
                <input className="field" type="number" min={1} value={shareForm.maxDownloads} onChange={(e) => setShareForm({ ...shareForm, maxDownloads: e.target.value })} />
              </Field>
            </div>
            {d.sensitivity !== 'NORMAL' ? (
              <label className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={shareForm.confirmSensitive} onChange={(e) => setShareForm({ ...shareForm, confirmSensitive: e.target.checked })} />
                <span>This is a {label(d.sensitivity).toLowerCase()} document. I understand anyone with the link will be able to open it.</span>
              </label>
            ) : null}
            <ErrorNote error={createShare.error} />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setSharing(false)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={createShare.isPending} disabled={d.sensitivity !== 'NORMAL' && !shareForm.confirmSensitive}>
                Create link
              </Button>
            </div>
          </form>
        )}
      </Modal>
      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete this document?"
        description="It is removed from the vault and from search. Share links stop working."
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>Cancel</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
              Delete
            </Button>
          </>
        }
      >
        {remove.error ? <ErrorNote error={remove.error} /> : <p className="text-sm text-muted">The deletion is recorded in the audit log.</p>}
      </Modal>
    </div>
  );
}
