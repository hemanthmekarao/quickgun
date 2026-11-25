'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Plus, Send, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cx, dateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Button, Card, ErrorNote, Notice, PageHeader } from '@/components/ui';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  mode?: string;
  links?: { title: string; href: string }[];
}

export default function AssistantPage() {
  const session = useSession();
  const qc = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const caps = useQuery({ queryKey: ['assistant-caps', session.household?.id], queryFn: () => api.get('/assistant/capabilities') });
  const history = useQuery({ queryKey: ['assistant-conversations', session.household?.id], queryFn: () => api.get<any[]>('/assistant/conversations') });

  const ask = useMutation({
    mutationFn: (q: string) => api.post('/assistant/ask', { question: q, ...(conversationId ? { conversationId } : {}) }),
    onSuccess: (res: any) => {
      setConversationId(res.conversationId);
      const links = res.tool === 'search_documents' && res.data?.documents ? res.data.documents.map((d: any) => ({ title: d.title, href: d.href })) : undefined;
      setMessages((m) => [...m, { role: 'assistant', content: res.answer, mode: res.mode, links }]);
      qc.invalidateQueries({ queryKey: ['assistant-conversations'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/assistant/conversations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assistant-conversations'] }),
  });

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages, ask.isPending]);

  function send(q: string) {
    const text = q.trim();
    if (!text || ask.isPending) return;
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setQuestion('');
    ask.mutate(text);
  }

  async function openConversation(id: string) {
    const c = await api.get(`/assistant/conversations/${id}`);
    setConversationId(c.id);
    setMessages((c.messages ?? []).map((m: any) => ({ role: m.role, content: m.content, mode: m.mode })));
  }

  const c = caps.data;

  return (
    <div>
      <PageHeader
        title="Assistant"
        description="Ask about your household in plain language. Answers come only from records you are allowed to see."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => { setConversationId(null); setMessages([]); }}>
            New conversation
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Card className="flex min-h-[520px] flex-col lg:col-span-3" padded={false}>
          <div className="flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
            {messages.length === 0 ? (
              <div className="mx-auto max-w-xl py-6 text-center">
                <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-subtle text-muted">
                  <Bot className="h-5 w-5" aria-hidden />
                </span>
                <p className="text-sm font-medium">What would you like to know?</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {(c?.examples ?? []).map((ex: string) => (
                    <button key={ex} type="button" onClick={() => send(ex)} className="rounded-full border border-line px-3 py-1.5 text-left text-xs text-muted hover:bg-subtle hover:text-ink">
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={cx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cx('max-w-[85%] rounded-2xl px-4 py-2.5 text-sm', m.role === 'user' ? 'bg-ink text-bg' : 'bg-subtle text-ink')}>
                    <p className="whitespace-pre-wrap">{m.content}</p>
                    {m.links?.length ? (
                      <ul className="mt-2 space-y-1">
                        {m.links.map((l) => (
                          <li key={l.href}>
                            <Link href={l.href} className="underline underline-offset-2">
                              {l.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              ))
            )}
            {ask.isPending ? <p className="text-sm text-muted">Looking that up…</p> : null}
            <ErrorNote error={ask.error} />
            <div ref={end} />
          </div>
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              send(question);
            }}
            className="flex gap-2 border-t border-line p-3"
          >
            <input className="field" placeholder="Ask a question…" value={question} maxLength={1000} onChange={(e) => setQuestion(e.target.value)} aria-label="Your question" />
            <Button type="submit" variant="primary" loading={ask.isPending} disabled={!question.trim()} icon={<Send className="h-4 w-4" />}>
              Ask
            </Button>
          </form>
        </Card>

        <div className="space-y-4">
          {c ? (
            <Notice title={c.mode === 'llm' ? 'AI model connected' : 'Built-in answers'}>
              {c.note}
              <span className="mt-2 block">It cannot {c.cannot.join(', ')}.</span>
            </Notice>
          ) : null}
          <Card>
            <p className="mb-2 text-sm font-semibold">Earlier conversations</p>
            {(history.data ?? []).length === 0 ? (
              <p className="text-sm text-muted">None yet. Only you can see your conversations.</p>
            ) : (
              <ul className="space-y-1">
                {history.data!.slice(0, 15).map((h) => (
                  <li key={h.id} className="group flex items-center gap-1">
                    <button type="button" onClick={() => openConversation(h.id)} className={cx('min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-sm hover:bg-subtle', conversationId === h.id && 'bg-subtle')}>
                      <span className="block truncate">{h.title}</span>
                      <span className="block text-xs text-muted">{dateTime(h.updatedAt)}</span>
                    </button>
                    <button type="button" className="rounded-md p-1.5 text-muted hover:bg-danger/10 hover:text-danger" onClick={() => remove.mutate(h.id)} aria-label="Delete conversation">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
