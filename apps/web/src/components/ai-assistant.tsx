'use client';

import type {
  OrganizationSummary,
  ReportDefinition,
  ReportKey,
  ReportResult,
} from '@valuebooks/contracts';
import {
  Badge,
  Button,
  Dialog,
  DrawerContent,
  Input,
  Label,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@valuebooks/ui';
import { Bot, Check, ExternalLink, RefreshCw, Send, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission } from '../lib/workspace';

interface AiCitation {
  sourceType: string;
  sourceId: string;
  href: string | null;
}

interface AskAnswer {
  summary: string;
  abstained: boolean;
  citations: AiCitation[];
}

interface AskResponse {
  answer: AskAnswer;
  report: ReportResult['data'];
}

interface AiSuggestion {
  id: string;
  capability: string;
  entityType: string | null;
  entityId: string | null;
  payload: Record<string, unknown>;
  reason: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'DISMISSED';
  createdAt: string;
}

const SUGGESTED_QUESTIONS = [
  'What was my sales today?',
  'How many invoices are overdue right now?',
  'Summarize my expenses this month.',
  "What's driving my profit this year?",
];

/** Words too common to say anything about report intent -- excluded so they never inflate a match. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'did', 'do', 'does', 'i', 'my', 'me', 'of', 'for',
  'to', 'in', 'on', 'at', 'this', 'that', 'get', 'got', 'how', 'what', 'many', 'much', 'today',
  'yesterday', 'week', 'month', 'year', 'quarter', 'last', 'new', 'and', 'any', 'right', 'now',
]);

/** A small set of seed words for the reports people actually ask about in everyday language --
 * scored alongside plain word-overlap against each report's own name/description/family so a
 * question never needs a report picked for it up front. */
const INTENT_BOOST: Partial<Record<string, ReportKey[]>> = {
  sale: ['sales.by-period', 'sales.by-customer'],
  sales: ['sales.by-period', 'sales.by-customer'],
  sold: ['sales.by-period', 'sales.by-item'],
  revenue: ['financial.profit-loss', 'sales.by-period'],
  customer: ['sales.by-customer', 'receivables.customer-balances'],
  customers: ['sales.by-customer', 'receivables.customer-balances'],
  invoice: ['receivables.invoice-details'],
  invoices: ['receivables.invoice-details'],
  overdue: ['receivables.aging-summary'],
  aging: ['receivables.aging-summary'],
  expense: ['purchases.by-category', 'purchases.by-vendor'],
  expenses: ['purchases.by-category', 'purchases.by-vendor'],
  vendor: ['payables.vendor-balances'],
  vendors: ['payables.vendor-balances'],
  bill: ['payables.bill-details'],
  bills: ['payables.bill-details'],
  cash: ['financial.cash-flow'],
  profit: ['financial.profit-loss'],
  loss: ['financial.profit-loss'],
  income: ['financial.profit-loss'],
  tax: ['tax.summary'],
  inventory: ['inventory.stock-on-hand'],
  stock: ['inventory.stock-on-hand'],
  item: ['sales.by-item'],
  items: ['sales.by-item'],
  paid: ['receivables.payments-received'],
  payment: ['receivables.payments-received'],
  payments: ['receivables.payments-received'],
  balance: ['financial.balance-sheet'],
  assets: ['financial.balance-sheet'],
  liabilities: ['financial.balance-sheet'],
};

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]+/g) ?? []).filter(
    (word) => word.length > 2 && !STOPWORDS.has(word),
  );
}

/** Best-effort report match from free text: word overlap against each report's own name,
 * description, and family, boosted by a small everyday-language seed list. Never blocks asking --
 * an unmatched question just falls back to the first report the caller can see. */
function inferReportKey(question: string, definitions: readonly ReportDefinition[]): ReportKey | null {
  if (definitions.length === 0) return null;
  const words = tokenize(question);
  if (words.length === 0) return null;

  const scores = new Map<ReportKey, number>();
  for (const definition of definitions) {
    const haystack = tokenize(`${definition.name} ${definition.description} ${definition.family}`);
    const overlap = words.filter((word) => haystack.includes(word)).length;
    scores.set(definition.key, overlap);
  }
  for (const word of words) {
    for (const key of INTENT_BOOST[word] ?? []) {
      if (scores.has(key)) scores.set(key, (scores.get(key) ?? 0) + 3);
    }
  }

  let best: ReportKey | null = null;
  let bestScore = 0;
  for (const [key, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return bestScore > 0 ? best : null;
}

interface InferredDateRange {
  from?: string;
  to?: string;
  label: string | null;
}

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfWeek(date: Date): Date {
  const copy = new Date(date);
  const day = copy.getDay();
  copy.setDate(copy.getDate() - (day === 0 ? 6 : day - 1));
  return copy;
}

/** Reads a handful of common time phrases out of a free-text question so "today" / "this month" /
 * etc. become real filters without the caller ever touching a date picker. No match means no
 * inferred range -- the backend's own year-to-date default takes over, exactly as before. */
function inferDateRange(question: string): InferredDateRange {
  const q = question.toLowerCase();
  const today = new Date();

  if (/\btoday\b/.test(q)) return { from: localDate(today), to: localDate(today), label: 'today' };
  if (/\byesterday\b/.test(q)) {
    const day = new Date(today);
    day.setDate(day.getDate() - 1);
    return { from: localDate(day), to: localDate(day), label: 'yesterday' };
  }
  if (/\bthis week\b/.test(q)) {
    return { from: localDate(startOfWeek(today)), to: localDate(today), label: 'this week' };
  }
  if (/\blast week\b/.test(q)) {
    const end = startOfWeek(today);
    end.setDate(end.getDate() - 1);
    const start = startOfWeek(end);
    return { from: localDate(start), to: localDate(end), label: 'last week' };
  }
  if (/\bthis month\b/.test(q)) {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: localDate(start), to: localDate(today), label: 'this month' };
  }
  if (/\blast month\b/.test(q)) {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: localDate(start), to: localDate(end), label: 'last month' };
  }
  if (/\bthis year\b/.test(q)) {
    const start = new Date(today.getFullYear(), 0, 1);
    return { from: localDate(start), to: localDate(today), label: 'this year' };
  }
  if (/\blast year\b/.test(q)) {
    const start = new Date(today.getFullYear() - 1, 0, 1);
    const end = new Date(today.getFullYear() - 1, 11, 31);
    return { from: localDate(start), to: localDate(end), label: 'last year' };
  }
  const lastNDays = /\blast (\d+) days?\b/.exec(q);
  if (lastNDays) {
    const start = new Date(today);
    start.setDate(start.getDate() - Number(lastNDays[1]));
    return { from: localDate(start), to: localDate(today), label: `last ${lastNDays[1]} days` };
  }
  return { label: null };
}

function formatRangeLabel(label: string | null, from: string, to: string): string | null {
  if (label) return label;
  if (from && to) return from === to ? from : `${from} to ${to}`;
  return from || to || null;
}

const CAPABILITY_LABELS: Record<string, string> = {
  EXPENSE_CATEGORIZATION: 'Expense categorization',
  VARIANCE_INSIGHT: 'Spend variance',
  DRAFT_NOTE: 'Draft note',
};

/**
 * Global entry point to the AI functionality built in Phase 13: "Ask your books" (evidence-backed
 * Q&A over a report, `/ai/ask`) and pending AI suggestions review (`/ai/suggestions`). Every other
 * AI surface in the app is buried inside a specific report/expense/insights page; this floating
 * widget is the one place a user can find and use all of it regardless of which page they're on.
 */
export function AiAssistantWidget({ organization }: { organization: OrganizationSummary | null }) {
  const organizationId = organization?.id ?? null;
  const canAsk =
    hasPermission(organization, 'ai.assistant.ask') && hasPermission(organization, 'reports.view');
  const canViewSuggestions = hasPermission(organization, 'ai.suggestions.view');
  const canManageSuggestions = hasPermission(organization, 'ai.suggestions.manage');

  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<AiSuggestion[] | null>(null);
  const [suggestionsError, setSuggestionsError] = useState(false);

  const loadSuggestions = useCallback(() => {
    if (!organizationId || !canViewSuggestions) return;
    apiRequest<{ data: AiSuggestion[] }>(`/organizations/${organizationId}/ai/suggestions`)
      .then((response) => {
        setSuggestions(response.data);
        setSuggestionsError(false);
      })
      .catch(() => {
        setSuggestions([]);
        setSuggestionsError(true);
      });
  }, [organizationId, canViewSuggestions]);

  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  const pendingCount = useMemo(
    () => (suggestions ?? []).filter((item) => item.status === 'PENDING').length,
    [suggestions],
  );

  if (!organizationId || (!canAsk && !canViewSuggestions)) return null;

  return (
    <>
      <button
        type="button"
        className="rb-ai-fab"
        onClick={() => setOpen(true)}
        aria-label={
          pendingCount > 0 ? `Open AI assistant, ${pendingCount} pending suggestions` : 'Open AI assistant'
        }
      >
        <Bot aria-hidden="true" />
        {pendingCount > 0 ? <span className="rb-ai-fab__badge">{pendingCount}</span> : null}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DrawerContent
          side="right"
          className="rb-ai-drawer"
          title="AI assistant"
          description="Ask your books a question, or review pending AI suggestions."
        >
          <div className="rb-ai-panel">
            <div className="rb-ai-panel__header">
              <div className="rb-ai-panel__heading">
                <Sparkles aria-hidden="true" />
                <div>
                  <strong>AI assistant</strong>
                  <span className="rb-muted">Evidence-backed answers from your own records</span>
                </div>
              </div>
              <button
                type="button"
                className="rb-icon-button"
                onClick={() => setOpen(false)}
                aria-label="Close AI assistant"
              >
                <X aria-hidden="true" />
              </button>
            </div>

            <Tabs defaultValue="ask" className="rb-ai-tabs">
              <TabsList aria-label="AI assistant sections">
                <TabsTrigger value="ask">Ask</TabsTrigger>
                <TabsTrigger value="suggestions">
                  Suggestions{pendingCount > 0 ? ` (${pendingCount})` : ''}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="ask">
                <AskPanel organizationId={organizationId} canAsk={canAsk} />
              </TabsContent>
              <TabsContent value="suggestions">
                <SuggestionsPanel
                  organizationId={organizationId}
                  canView={canViewSuggestions}
                  canManage={canManageSuggestions}
                  suggestions={suggestions}
                  error={suggestionsError}
                  onRefresh={loadSuggestions}
                  onChange={setSuggestions}
                />
              </TabsContent>
            </Tabs>
          </div>
        </DrawerContent>
      </Dialog>
    </>
  );
}

function AskPanel({ organizationId, canAsk }: { organizationId: string; canAsk: boolean }) {
  const [definitions, setDefinitions] = useState<ReportDefinition[] | null>(null);
  const [question, setQuestion] = useState('');
  const [manualReportKey, setManualReportKey] = useState<ReportKey | ''>('');
  const [manualFrom, setManualFrom] = useState('');
  const [manualTo, setManualTo] = useState('');
  // Set for one retry after a zero-row date range -- see retryWithoutDateFilter. Reset whenever the
  // question changes so a fresh question re-infers its own range instead of inheriting this one.
  const [forceNoDateRange, setForceNoDateRange] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noDataHint, setNoDataHint] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [askedWith, setAskedWith] = useState<{
    reportKey: ReportKey;
    from: string;
    to: string;
    label: string | null;
  } | null>(null);

  useEffect(() => {
    if (!canAsk) return;
    apiRequest<{ data: ReportDefinition[] }>(`/organizations/${organizationId}/reports/definitions`)
      .then((response) => setDefinitions(response.data))
      .catch(() => setDefinitions([]));
  }, [organizationId, canAsk]);

  if (!canAsk) {
    return (
      <p className="rb-muted rb-ai-empty">
        Asking your books needs the AI assistant permission and report access for your role.
      </p>
    );
  }

  const inferredReportKey = inferReportKey(question, definitions ?? []);
  const inferredDates = inferDateRange(question);
  const effectiveReportKey = manualReportKey || inferredReportKey || definitions?.[0]?.key || '';
  const effectiveFrom = forceNoDateRange ? '' : manualFrom || inferredDates.from || '';
  const effectiveTo = forceNoDateRange ? '' : manualTo || inferredDates.to || '';
  const effectiveLabel = forceNoDateRange
    ? null
    : manualFrom || manualTo
      ? null
      : inferredDates.label;

  async function runAsk(
    targetReportKey: ReportKey,
    targetFrom: string,
    targetTo: string,
    targetLabel: string | null,
  ) {
    setBusy(true);
    setError(null);
    setNoDataHint(false);
    setResult(null);
    try {
      const response = await apiRequest<{ data: AskResponse }>(
        `/organizations/${organizationId}/ai/ask`,
        {
          method: 'POST',
          body: JSON.stringify({
            reportKey: targetReportKey,
            question: question.trim(),
            from: targetFrom || undefined,
            to: targetTo || undefined,
          }),
        },
      );
      setResult(response.data);
      setAskedWith({ reportKey: targetReportKey, from: targetFrom, to: targetTo, label: targetLabel });
    } catch (caught) {
      // A zero-row date range is common for a narrow inferred window (e.g. "this month" when
      // nothing posted yet this month) -- offer the obvious next step instead of a dead end.
      if (
        caught instanceof ApiError &&
        caught.status === 400 &&
        caught.message.includes('no source rows') &&
        (targetFrom || targetTo)
      ) {
        setNoDataHint(true);
      }
      setError(describeAskError(caught));
    } finally {
      setBusy(false);
    }
  }

  function ask() {
    if (!effectiveReportKey || question.trim().length < 3) return;
    void runAsk(effectiveReportKey, effectiveFrom, effectiveTo, effectiveLabel);
  }

  function retryWithoutDateFilter() {
    if (!effectiveReportKey) return;
    setForceNoDateRange(true);
    void runAsk(effectiveReportKey, '', '', null);
  }

  const askedReportName = askedWith
    ? (definitions?.find((definition) => definition.key === askedWith.reportKey)?.name ?? null)
    : null;
  const liveReportName =
    definitions?.find((definition) => definition.key === effectiveReportKey)?.name ?? null;
  const liveRangeLabel = formatRangeLabel(effectiveLabel, effectiveFrom, effectiveTo);

  return (
    <div className="rb-ai-ask">
      <div className="rb-ai-suggested-questions">
        {SUGGESTED_QUESTIONS.map((prompt) => (
          <button key={prompt} type="button" className="rb-ai-chip" onClick={() => setQuestion(prompt)}>
            {prompt}
          </button>
        ))}
      </div>

      <div className="rb-field">
        <Label htmlFor="ai-ask-question">Ask anything about your books</Label>
        <Textarea
          id="ai-ask-question"
          rows={3}
          value={question}
          onChange={(event) => {
            setQuestion(event.target.value);
            setForceNoDateRange(false);
          }}
          placeholder="e.g. What was my sales today?"
        />
      </div>

      {question.trim().length >= 3 && liveReportName ? (
        <p className="rb-muted rb-ai-interpreted">
          I&apos;ll check <strong>{liveReportName}</strong>
          {liveRangeLabel ? ` · ${liveRangeLabel}` : ''}
        </p>
      ) : null}

      <Button onClick={ask} loading={busy} disabled={!effectiveReportKey || question.trim().length < 3}>
        <Send aria-hidden="true" /> Ask
      </Button>

      {definitions === null ? (
        <Skeleton />
      ) : definitions.length > 0 ? (
        <details className="rb-ai-advanced">
          <summary>Advanced: report &amp; date range</summary>
          <div className="rb-field">
            <Label htmlFor="ai-ask-report">Report</Label>
            <Select
              id="ai-ask-report"
              value={effectiveReportKey}
              onChange={(event) => setManualReportKey(event.target.value as ReportKey)}
            >
              {definitions.map((definition) => (
                <option key={definition.key} value={definition.key}>
                  {definition.family} — {definition.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field-grid">
            <div className="rb-field">
              <Label htmlFor="ai-ask-from">From</Label>
              <Input
                id="ai-ask-from"
                type="date"
                value={effectiveFrom}
                onChange={(event) => setManualFrom(event.target.value)}
              />
            </div>
            <div className="rb-field">
              <Label htmlFor="ai-ask-to">To</Label>
              <Input
                id="ai-ask-to"
                type="date"
                value={effectiveTo}
                onChange={(event) => setManualTo(event.target.value)}
              />
            </div>
          </div>
          <p className="rb-muted rb-explain-caption">
            Left as-is, the report and date range are guessed from your question.
          </p>
        </details>
      ) : null}

      {error ? (
        <div className="rb-ai-error">
          <p className="rb-auth-error" role="alert">
            {error}
          </p>
          {noDataHint ? (
            <Button size="sm" variant="outline" loading={busy} onClick={retryWithoutDateFilter}>
              Try without a date filter
            </Button>
          ) : null}
        </div>
      ) : null}

      {result && askedWith ? (
        <AskResult
          reportKey={askedWith.reportKey}
          reportName={askedReportName}
          from={askedWith.from}
          to={askedWith.to}
          dateLabel={askedWith.label}
          result={result}
        />
      ) : null}
    </div>
  );
}

function AskResult({
  reportKey,
  reportName,
  from,
  to,
  dateLabel,
  result,
}: {
  reportKey: ReportKey;
  reportName: string | null;
  from: string;
  to: string;
  dateLabel: string | null;
  result: AskResponse;
}) {
  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const suffix = query.toString();
  const reportHref = `/reports/${reportKey}${suffix ? `?${suffix}` : ''}`;
  const rangeLabel = formatRangeLabel(dateLabel, from, to);

  return (
    <div className="rb-explain-panel rb-ai-result">
      {reportName ? (
        <p className="rb-muted rb-ai-interpreted">
          Interpreted as <strong>{reportName}</strong>
          {rangeLabel ? ` · ${rangeLabel}` : ''}
        </p>
      ) : null}
      <p className="rb-muted rb-ai-row-count">
        <strong>{result.report.pagination.totalRows}</strong>{' '}
        {result.report.pagination.totalRows === 1 ? 'row' : 'rows'} in this report
        {rangeLabel ? ` for ${rangeLabel}` : ''} -- the exact count behind the summary below, not an
        AI estimate.
      </p>
      {result.answer.abstained ? (
        <div className="rb-explain-unavailable">
          <Badge tone="neutral">The assistant couldn&apos;t confirm an answer</Badge>
          <p className="rb-muted">{result.answer.summary}</p>
        </div>
      ) : (
        <div className="rb-explain-ready">
          <p>{result.answer.summary}</p>
          {result.answer.citations.length > 0 ? (
            <ul className="rb-explain-citations">
              {result.answer.citations.map((citation) => (
                <li key={citation.sourceId}>
                  {citation.href ? (
                    <Link href={citation.href}>View source</Link>
                  ) : (
                    <span>{citation.sourceType}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="rb-muted rb-explain-caption">
            AI-written interpretation of your report evidence. It is not verified fact and never
            changes a posted figure.
          </p>
        </div>
      )}
      <Link href={reportHref} className="rb-ai-open-report">
        <ExternalLink aria-hidden="true" /> Open full report
      </Link>
    </div>
  );
}

function describeAskError(caught: unknown): string {
  if (caught instanceof ApiError) {
    if (caught.status >= 500) {
      return "The AI assistant is temporarily unavailable -- it may not be configured for this workspace yet.";
    }
    return caught.message;
  }
  return 'This question could not be answered.';
}

function SuggestionsPanel({
  organizationId,
  canView,
  canManage,
  suggestions,
  error,
  onRefresh,
  onChange,
}: {
  organizationId: string;
  canView: boolean;
  canManage: boolean;
  suggestions: AiSuggestion[] | null;
  error: boolean;
  onRefresh: () => void;
  onChange: (updater: (current: AiSuggestion[] | null) => AiSuggestion[] | null) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!canView) {
    return (
      <p className="rb-muted rb-ai-empty">
        Suggestions need the AI suggestions permission for your role.
      </p>
    );
  }

  async function decide(id: string, action: 'accept' | 'dismiss') {
    setBusyId(id);
    try {
      await apiRequest(`/organizations/${organizationId}/ai/suggestions/${id}/${action}`, {
        method: 'POST',
      });
      onChange((current) => current?.filter((item) => item.id !== id) ?? current);
    } catch {
      // Non-fatal: the item stays in the list so the user can retry.
    } finally {
      setBusyId(null);
    }
  }

  const pending = (suggestions ?? []).filter((item) => item.status === 'PENDING');

  return (
    <div className="rb-ai-suggestions">
      <div className="rb-ai-suggestions__toolbar">
        <span className="rb-muted">{suggestions === null ? 'Loading…' : `${pending.length} pending`}</span>
        <Button size="sm" variant="ghost" onClick={onRefresh}>
          <RefreshCw aria-hidden="true" /> Refresh
        </Button>
      </div>

      {suggestions === null && !error ? <Skeleton /> : null}

      {error ? (
        <p className="rb-muted rb-ai-empty">
          Suggestions aren&apos;t available right now -- they may be turned off for this workspace.
        </p>
      ) : null}

      {suggestions && pending.length === 0 && !error ? (
        <p className="rb-muted rb-ai-empty">Nothing pending review right now.</p>
      ) : null}

      {pending.length > 0 ? (
        <p className="rb-muted rb-explain-caption">
          Accepting or dismissing here records your review. A category match still needs to be
          applied from its own record.
        </p>
      ) : null}

      {pending.map((suggestion) => (
        <div key={suggestion.id} className="rb-ai-suggestion">
          <div>
            <Badge tone="info">{capabilityLabel(suggestion.capability)}</Badge>
            <p>{suggestionText(suggestion)}</p>
          </div>
          <div className="rb-ai-suggestion__actions">
            {suggestionHref(suggestion) ? <Link href={suggestionHref(suggestion)!}>View</Link> : null}
            {canManage ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  loading={busyId === suggestion.id}
                  onClick={() => void decide(suggestion.id, 'accept')}
                >
                  <Check aria-hidden="true" /> Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busyId === suggestion.id}
                  onClick={() => void decide(suggestion.id, 'dismiss')}
                >
                  Dismiss
                </Button>
              </>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function capabilityLabel(capability: string): string {
  return CAPABILITY_LABELS[capability] ?? humanizeCapability(capability);
}

function humanizeCapability(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function suggestionText(suggestion: AiSuggestion): string {
  if (suggestion.capability === 'DRAFT_NOTE') {
    const payload = suggestion.payload as { text?: string };
    if (payload.text) return payload.text;
  }
  return suggestion.reason ?? 'No further detail provided.';
}

function suggestionHref(suggestion: AiSuggestion): string | null {
  if (suggestion.capability === 'DRAFT_NOTE' && suggestion.entityType === 'EXPENSE' && suggestion.entityId) {
    return `/expenses/${suggestion.entityId}`;
  }
  if (suggestion.capability === 'EXPENSE_CATEGORIZATION') return '/expenses';
  if (suggestion.capability === 'VARIANCE_INSIGHT') return '/insights';
  return null;
}
