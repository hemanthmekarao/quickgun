import { Injectable } from '@nestjs/common';
import { ASSISTANT_EXAMPLES, ASSISTANT_TOOLS, MODULE_LABELS, can, formatMoney, isUuid, parseIntent, type AssistantTool } from '@homeos/shared';
import { need, type Ctx } from '../common/context';
import { notFound, validationFailed } from '../common/errors';
import { DocumentsService } from '../documents/documents.service';
import { InsightsService } from '../insights/insights.service';
import { PrismaService } from '../prisma.service';
import { chatCompletion, llmConfigured, type ChatMessage } from './llm';

const SYSTEM_PROMPT = `You are the HomeOS household assistant.
- Answer only from the results of the tools provided. Never state a figure, date or name that is not in a tool result.
- If the tools return nothing relevant, say that the information is not recorded in HomeOS.
- If a tool result says access is not permitted, tell the user they do not have access to that information.
- You can only read information. You cannot make payments, delete or change records, share documents or make commitments. If asked to, explain that the user must do it themselves in the app.
- Amounts are in the household currency given in the tool results. Be concise.`;

function label(v: string): string {
  return v.replace(/_/g, ' ').toLowerCase();
}

/**
 * Conversational assistant. It has no data access of its own: every answer comes from the
 * read-only tools below, each of which runs with the caller's own permissions.
 */
@Injectable()
export class AssistantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly insights: InsightsService,
    private readonly documents: DocumentsService,
  ) {}

  private toolsFor(ctx: Ctx): AssistantTool[] {
    return ASSISTANT_TOOLS.filter((t) => can(ctx.perms, t.module, 'read'));
  }

  /** Execute one tool with the caller's permissions. Unknown or forbidden tools return an explanatory object, never data. */
  async runTool(ctx: Ctx, name: string, args: Record<string, any>): Promise<any> {
    const tool = ASSISTANT_TOOLS.find((t) => t.name === name);
    if (!tool) return { error: 'UNKNOWN_TOOL' };
    if (!can(ctx.perms, tool.module, 'read')) return { error: 'NOT_PERMITTED', module: MODULE_LABELS[tool.module] };
    switch (name) {
      case 'spending_summary': {
        const r = await this.insights.spendingSummary(ctx, String(args.period ?? 'THIS_MONTH'));
        return { period: r.label, from: r.from, to: r.to, currency: r.currency, totalSpent: r.spent, income: r.income, refunds: r.refunds, expenseCount: r.count, byCategory: r.byCategory.slice(0, 8) };
      }
      case 'bills_due':
        return this.insights.billsDue(ctx, Number(args.days ?? 7));
      case 'search_documents': {
        const r = await this.documents.search(ctx, String(args.query ?? ''), 8);
        return {
          query: String(args.query ?? ''),
          total: r.total,
          documents: r.items.map((d: any) => ({ id: d.id, title: d.title, category: d._refs?.categoryId?.label ?? null, fileName: d.fileName, expiryDate: d.expiryDate, href: `/documents/${d.id}` })),
        };
      }
      case 'vehicle_service_status':
        return { vehicles: await this.insights.vehicleServiceStatus(ctx) };
      case 'appliances_under_warranty':
        return this.insights.appliancesUnderWarranty(ctx);
      case 'insurance_expiring':
        return this.insights.insuranceExpiring(ctx, Number(args.days ?? 90));
      case 'staff_salary_summary':
        return this.insights.staffSalarySummary(ctx);
      case 'subscriptions_summary': {
        const r = await this.insights.subscriptionsSummary(ctx);
        return { ...r, items: r.items.slice(0, 30) };
      }
      case 'maintenance_cost':
        return this.insights.maintenanceCost(ctx, String(args.period ?? 'THIS_YEAR'));
      case 'budget_status':
        return { budgets: await this.insights.budgetStatus(ctx), currency: ctx.currency };
      default:
        return { error: 'UNKNOWN_TOOL' };
    }
  }

  /** Deterministic wording of a tool result (used when no LLM is configured, and as the fallback). */
  describe(ctx: Ctx, name: string, data: any): string {
    const money = (n: number) => formatMoney(n, ctx.currency);
    if (data?.error === 'NOT_PERMITTED') return `Your role does not have access to ${String(data.module).toLowerCase()}, so I can't answer that.`;
    switch (name) {
      case 'spending_summary': {
        if (data.expenseCount === 0) return `No expenses are recorded for ${data.period} (${data.from} to ${data.to}).`;
        const top = data.byCategory.filter((c: any) => c.amount > 0).slice(0, 3).map((c: any) => `${label(c.category)} ${money(c.amount)}`).join(', ');
        return `You spent ${money(data.totalSpent)} ${data.period} (${data.from} to ${data.to}) across ${data.expenseCount} entries.${top ? ` Largest categories: ${top}.` : ''}${data.income > 0 ? ` Income recorded: ${money(data.income)}.` : ''}`;
      }
      case 'bills_due': {
        const parts: string[] = [];
        if (data.due.length === 0) parts.push(`No unpaid bills are due in the next ${data.days} day${data.days === 1 ? '' : 's'}.`);
        else parts.push(`${data.due.length} bill${data.due.length === 1 ? ' is' : 's are'} due in the next ${data.days} days, totalling ${money(data.dueTotal)}: ${data.due.slice(0, 6).map((e: any) => `${e.title.replace(/ bill due$/, '')} ${e.amount !== undefined ? money(e.amount) : ''} on ${e.date}`).join('; ')}.`);
        if (data.overdue.length) parts.push(`${data.overdue.length} bill${data.overdue.length === 1 ? ' is' : 's are'} overdue (${money(data.overdueTotal)}).`);
        return parts.join(' ');
      }
      case 'search_documents':
        return data.total === 0
          ? `I couldn't find a document matching "${data.query}" among the documents you can access.`
          : `I found ${data.total} document${data.total === 1 ? '' : 's'} matching "${data.query}": ${data.documents.map((d: any) => d.title).join('; ')}.`;
      case 'vehicle_service_status': {
        if (!data.vehicles.length) return 'No vehicles are registered.';
        return data.vehicles
          .map((v: any) => {
            if (!v.nextService) return `${v.name}: no next service date is recorded.`;
            const d = v.nextService.daysUntil;
            return `${v.name}: next service ${d < 0 ? `was due on ${v.nextService.date} (${-d} days ago)` : d === 0 ? 'is due today' : `is due on ${v.nextService.date} (in ${d} days)`}.`;
          })
          .join(' ');
      }
      case 'appliances_under_warranty': {
        const n = data.underWarranty.length;
        if (n === 0) return `No appliances have a warranty end date in the future.${data.unknown.length ? ` ${data.unknown.length} appliance(s) have no warranty date recorded.` : ''}`;
        return `${n} appliance${n === 1 ? ' is' : 's are'} under warranty: ${data.underWarranty.map((a: any) => `${a.name} (until ${a.warrantyEnd})`).join('; ')}.${data.unknown.length ? ` ${data.unknown.length} appliance(s) have no warranty date recorded.` : ''}`;
      }
      case 'insurance_expiring': {
        if (!data.policies.length) return `No active insurance policies expire in the next ${data.days} days.`;
        return `${data.policies.length} polic${data.policies.length === 1 ? 'y expires' : 'ies expire'} within ${data.days} days: ${data.policies.map((p: any) => `${p.name} (${p.insurer}) on ${p.expiryDate}${p.daysUntil < 0 ? ' — already expired' : ''}`).join('; ')}.`;
      }
      case 'staff_salary_summary':
        return data.staffCount === 0
          ? 'No household staff are recorded.'
          : `You have ${data.staffCount} staff member${data.staffCount === 1 ? '' : 's'} with a monthly salary commitment of ${money(data.monthlyCommitment)} (${money(data.annualCommitment)} a year). Salaries paid so far this year: ${money(data.paidThisYear)}.${data.pendingCount ? ` ${data.pendingCount} salary payment(s) are pending.` : ''}`;
      case 'subscriptions_summary':
        return data.activeCount === 0
          ? 'No active subscriptions are recorded.'
          : `You have ${data.activeCount} recurring subscription${data.activeCount === 1 ? '' : 's'} costing ${money(data.monthlyCost)} a month (${money(data.annualCost)} a year): ${data.items.slice(0, 8).map((s: any) => `${s.name} ${money(s.amount)}/${label(s.billingCycle)}`).join('; ')}.${data.possiblyUnused.length ? ` Not used in over 60 days according to your records: ${data.possiblyUnused.map((s: any) => s.name).join(', ')}.` : ''}`;
      case 'maintenance_cost':
        return `Home maintenance cost ${data.label}: ${money(data.total)} (${data.completedTasks} completed task${data.completedTasks === 1 ? '' : 's'}, ${data.paidWorkOrders} paid work order${data.paidWorkOrders === 1 ? '' : 's'}). ${data.openTasks} task${data.openTasks === 1 ? ' is' : 's are'} still open.`;
      case 'budget_status':
        return data.budgets.length === 0
          ? 'No budgets are set up.'
          : data.budgets.map((b: any) => `${b.name}: ${money(b.used)} of ${money(b.amount)} used (${b.percentUsed}%)${b.state === 'OVER' ? ' — over budget' : ''}.`).join(' ');
      default:
        return "I couldn't answer that.";
    }
  }

  private async answerWithLlm(ctx: Ctx, question: string, history: { role: string; content: string }[]): Promise<{ answer: string; tool?: string; data?: any } | null> {
    const tools = this.toolsFor(ctx).map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(Object.entries(t.parameters).map(([k, v]) => [k, { type: v.type, description: v.description, ...(v.enum ? { enum: v.enum } : {}) }])),
          additionalProperties: false,
        },
      },
    }));
    const messages: ChatMessage[] = [
      { role: 'system', content: `${SYSTEM_PROMPT}\nToday is ${new Date().toISOString().slice(0, 10)}.` },
      ...history.slice(-8).map((m) => ({ role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: String(m.content).slice(0, 2000) })),
      { role: 'user', content: question },
    ];
    let lastTool: string | undefined;
    let lastData: any;
    for (let round = 0; round < 4; round++) {
      const res = await chatCompletion(messages, { tools, maxTokens: 700 });
      if (!res) return null;
      const msg = res.message;
      if (msg.tool_calls?.length) {
        messages.push(msg);
        for (const call of msg.tool_calls.slice(0, 4)) {
          let args: Record<string, any> = {};
          try {
            args = JSON.parse(call.function?.arguments || '{}');
          } catch {
            args = {};
          }
          lastTool = call.function?.name;
          lastData = await this.runTool(ctx, String(lastTool), args);
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(lastData).slice(0, 12_000) });
        }
        continue;
      }
      if (typeof msg.content === 'string' && msg.content.trim()) return { answer: msg.content.trim(), tool: lastTool, data: lastData };
      return null;
    }
    return null;
  }

  async ask(ctx: Ctx, body: any) {
    need(ctx, 'assistant', 'read');
    const question = String(body?.question ?? '').trim();
    if (!question) throw validationFailed([{ field: 'question', message: 'is required' }]);
    if (question.length > 1000) throw validationFailed([{ field: 'question', message: 'must be at most 1000 characters' }]);

    let conversation: any = null;
    if (body?.conversationId) {
      if (!isUuid(body.conversationId)) throw notFound('Conversation');
      conversation = await this.prisma.aIConversation.findFirst({ where: { id: body.conversationId, householdId: ctx.householdId, userId: ctx.userId, deletedAt: null } });
      if (!conversation) throw notFound('Conversation');
    }
    const history: any[] = Array.isArray(conversation?.messages) ? conversation.messages : [];

    let mode: 'llm' | 'rules' = 'rules';
    let answer = '';
    let tool: string | undefined;
    let data: any;

    if (llmConfigured()) {
      const res = await this.answerWithLlm(ctx, question, history);
      if (res) {
        mode = 'llm';
        ({ answer, tool, data } = res);
      }
    }
    if (mode === 'rules') {
      const intent = parseIntent(question);
      if (!intent) {
        answer = `I can answer questions about spending, bills, documents, vehicles, appliances, insurance, staff salaries, subscriptions, maintenance and budgets. For example: "${ASSISTANT_EXAMPLES[0]}" or "${ASSISTANT_EXAMPLES[1]}"`;
      } else {
        tool = intent.tool;
        data = await this.runTool(ctx, intent.tool, intent.args);
        answer = this.describe(ctx, intent.tool, data);
      }
    }

    const now = new Date().toISOString();
    const messages = [...history, { role: 'user', content: question, at: now }, { role: 'assistant', content: answer, at: now, mode, ...(tool ? { tool } : {}) }].slice(-100);
    if (conversation) {
      await this.prisma.aIConversation.update({ where: { id: conversation.id }, data: { messages: messages as any } });
    } else {
      conversation = await this.prisma.aIConversation.create({
        data: { householdId: ctx.householdId, userId: ctx.userId, title: question.slice(0, 80), messages: messages as any },
      });
    }
    return { conversationId: conversation.id, answer, mode, tool: tool ?? null, data: data ?? null };
  }

  capabilities(ctx: Ctx) {
    return {
      mode: llmConfigured() ? 'llm' : 'rules',
      note: llmConfigured()
        ? 'Answers are written by a language model from HomeOS data it retrieves with your permissions.'
        : 'No language model is configured, so answers come from a fixed set of question types.',
      tools: this.toolsFor(ctx).map((t) => ({ name: t.name, description: t.description })),
      examples: ASSISTANT_EXAMPLES,
      cannot: ['make or schedule payments', 'delete or change records', 'share documents', 'make financial commitments'],
    };
  }

  async conversations(ctx: Ctx) {
    need(ctx, 'assistant', 'read');
    const rows: any[] = await this.prisma.aIConversation.findMany({
      where: { householdId: ctx.householdId, userId: ctx.userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, title: true, updatedAt: true },
    });
    return rows;
  }

  async conversation(ctx: Ctx, id: string) {
    need(ctx, 'assistant', 'read');
    if (!isUuid(id)) throw notFound('Conversation');
    const row = await this.prisma.aIConversation.findFirst({ where: { id, householdId: ctx.householdId, userId: ctx.userId, deletedAt: null } });
    if (!row) throw notFound('Conversation');
    return { id: row.id, title: row.title, messages: row.messages, updatedAt: row.updatedAt };
  }

  async removeConversation(ctx: Ctx, id: string) {
    need(ctx, 'assistant', 'read');
    if (!isUuid(id)) throw notFound('Conversation');
    const res = await this.prisma.aIConversation.updateMany({ where: { id, householdId: ctx.householdId, userId: ctx.userId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (res.count === 0) throw notFound('Conversation');
  }
}
