'use client';

import type {
  ExplainNumberExplanation,
  ExplainNumberResponse,
  ReportColumn,
  ReportDefinition,
  ReportDefinitionsResponse,
  ReportDrillDownData,
  ReportDrillDownResult,
  ReportFilters,
  ReportKey,
  ReportResult,
  ReportRow,
  SavedReport,
  SavedReportResponse,
  SavedReportsResponse,
} from '@valuebooks/contracts';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DrawerContent,
  ErrorState,
  ForbiddenState,
  Input,
  Label,
  PageHeader,
  Select,
  Skeleton,
} from '@valuebooks/ui';
import { ArrowUpRight, Bookmark, Download, Search, Save, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiDownloadUrl, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';

type ReportData = ReportResult['data'];

export function ReportLibraryPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'reports.view');
  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState<string>('All');
  const [recentKeys, setRecentKeys] = useState<ReportKey[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId || !canView) return;
    apiRequest<ReportDefinitionsResponse>(`/organizations/${organizationId}/reports/definitions`)
      .then((response) => {
        setDefinitions(response.data);
        setError(null);
      })
      .catch((caught: unknown) =>
        setError(message(caught, 'The report library could not be loaded.')),
      );
  }, [canView, organizationId]);

  useEffect(() => {
    if (!organizationId) return;
    setRecentKeys(readRecentReportKeys(organizationId));
  }, [organizationId]);

  const families = useMemo(
    () => [...new Set(definitions.map((definition) => definition.family))],
    [definitions],
  );
  const groups = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return Map.groupBy(
      definitions.filter((definition) => {
        const matchesFamily = family === 'All' || definition.family === family;
        const matchesQuery =
          !normalizedQuery ||
          [definition.name, definition.description, definition.family].some((value) =>
            value.toLocaleLowerCase().includes(normalizedQuery),
          );
        return matchesFamily && matchesQuery;
      }),
      (definition) => definition.family,
    );
  }, [definitions, family, query]);
  const recentReports = useMemo(
    () =>
      recentKeys
        .map((key) => definitions.find((definition) => definition.key === key))
        .filter(Boolean) as ReportDefinition[],
    [definitions, recentKeys],
  );

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for report access to open the report library." />;
  }

  return (
    <>
      <PageHeader
        title="Report library"
        description="Financial and operational reports with explicit sources, reconciliation rules, and drill-down."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/reports/saved">Saved reports</Link>
          </Button>
        }
      />
      <div className="rb-ledger-stack rb-report-library">
        <Messages error={error} />
        {definitions.length === 0 && !error ? <Skeleton /> : null}
        {definitions.length > 0 ? (
          <div className="rb-report-library__controls">
            <div className="rb-report-library__search">
              <Search aria-hidden="true" />
              <label className="rb-visually-hidden" htmlFor="report-search">
                Search reports
              </label>
              <Input
                id="report-search"
                type="search"
                placeholder="Search reports"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="rb-report-library__filters" aria-label="Report categories">
              {['All', ...families].map((item) => (
                <Button
                  key={item}
                  size="sm"
                  variant={family === item ? 'primary' : 'outline'}
                  aria-pressed={family === item}
                  onClick={() => setFamily(item)}
                >
                  {item}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {recentReports.length > 0 ? (
          <section className="rb-report-shortcuts" aria-labelledby="frequently-used-reports">
            <div className="rb-report-section-heading">
              <div>
                <span className="rb-report-section-heading__eyebrow">
                  <Bookmark aria-hidden="true" /> Your shortcuts
                </span>
                <h2 id="frequently-used-reports">Frequently used</h2>
              </div>
              <span>{recentReports.length} reports</span>
            </div>
            <div className="rb-report-library-grid rb-report-library-grid--shortcuts">
              {recentReports.map((report) => (
                <ReportLibraryCard key={report.key} report={report} compact />
              ))}
            </div>
          </section>
        ) : null}
        {[...groups.entries()].map(([family, reports]) => (
          <section
            key={family}
            className="rb-report-family"
            aria-labelledby={`report-family-${family}`}
          >
            <div className="rb-report-section-heading">
              <div>
                <h2 id={`report-family-${family}`}>{family}</h2>
              </div>
              <Badge tone="neutral">{reports.length} reports</Badge>
            </div>
            <div className="rb-report-library-grid">
              {reports.map((report) => (
                <ReportLibraryCard key={report.key} report={report} />
              ))}
            </div>
          </section>
        ))}
        {definitions.length > 0 && groups.size === 0 ? (
          <Card className="rb-report-library__empty">
            <Search aria-hidden="true" />
            <strong>No reports match that search</strong>
            <span>Try a report name, a category, or a shorter phrase.</span>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function ReportLibraryCard({
  report,
  compact = false,
}: {
  report: ReportDefinition;
  compact?: boolean;
}) {
  return (
    <Link
      className="rb-report-library-card"
      href={`/reports/${report.key}`}
      data-compact={compact || undefined}
    >
      <strong>{report.name}</strong>
      <span className="rb-report-library-card__description">{report.description}</span>
      <span className="rb-report-library-card__action">
        Open report <ArrowUpRight aria-hidden="true" />
      </span>
    </Link>
  );
}

export function ReportRunnerPage({
  reportKey,
  initialFilters,
}: {
  reportKey: string;
  initialFilters?: Partial<ReportFilters>;
}) {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'reports.view');
  const canManage = hasPermission(organization, 'reports.manage');
  const [definition, setDefinition] = useState<ReportDefinition | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([]);
  const [filters, setFilters] = useState<Partial<ReportFilters>>({
    from: yearStart(),
    to: today(),
    ...initialFilters,
  });
  const [saveName, setSaveName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [explainTarget, setExplainTarget] = useState<{ row: ReportRow; label: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    if (!organizationId || !canView) return;
    setLoading(true);
    try {
      const query = filterParams(filters);
      const response = await apiRequest<ReportResult>(
        `/organizations/${organizationId}/reports/${encodeURIComponent(reportKey)}?${query}`,
      );
      setReport(response.data);
      setDefinition(response.data.definition);
      setError(null);
    } catch (caught) {
      setError(message(caught, 'The report could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [canView, filters, organizationId, reportKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (organizationId && definition) recordRecentReport(organizationId, definition.key);
  }, [definition, organizationId]);

  useEffect(() => {
    if (!organizationId || !definition || (!definition.supportsProject && !definition.supportsTag))
      return;
    void apiRequest<{
      data: {
        projects: Array<{ id: string; name: string }>;
        tags: Array<{ id: string; name: string }>;
      };
    }>(`/organizations/${organizationId}/reports/filter-options`).then((response) => {
      setProjects(response.data.projects);
      setTags(response.data.tags);
    });
  }, [definition, organizationId]);

  async function saveReport() {
    if (!organizationId || !definition || !saveName.trim()) return;
    try {
      await apiRequest<SavedReportResponse>(`/organizations/${organizationId}/reports/saved`, {
        method: 'POST',
        body: JSON.stringify({ name: saveName.trim(), reportKey: definition.key, filters }),
      });
      setSaveName('');
      setNotice('Report saved.');
      setError(null);
    } catch (caught) {
      setError(message(caught, 'The report could not be saved.'));
    }
  }

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for report access to run this report." />;
  }

  const currency = report?.baseCurrency ?? organization?.baseCurrency ?? 'USD';
  return (
    <>
      <PageHeader
        title={definition?.name ?? 'Report'}
        description={definition?.description ?? 'Loading report definition…'}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/reports">Report library</Link>
          </Button>
        }
      />
      <div className="rb-ledger-stack">
        <Messages error={error} notice={notice} />
        <Card className="rb-report-filters">
          <Field label="From">
            <Input
              type="date"
              value={filters.from ?? ''}
              onChange={(event) => setFilters({ ...filters, from: event.target.value })}
            />
          </Field>
          <Field label="To">
            <Input
              type="date"
              value={filters.to ?? ''}
              onChange={(event) => setFilters({ ...filters, to: event.target.value })}
            />
          </Field>
          {definition && definition.supportedBasis.length > 1 ? (
            <Field label="Basis">
              <Select
                value={filters.basis ?? definition.supportedBasis[0]}
                onChange={(event) =>
                  setFilters({ ...filters, basis: event.target.value as ReportFilters['basis'] })
                }
              >
                {definition.supportedBasis.map((basis) => (
                  <option key={basis}>{basis}</option>
                ))}
              </Select>
            </Field>
          ) : null}
          {definition?.supportsProject ? (
            <Field label="Project">
              <Select
                value={filters.projectId ?? ''}
                onChange={(event) =>
                  setFilters({ ...filters, projectId: event.target.value || undefined })
                }
              >
                <option value="">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {definition?.supportsTag ? (
            <Field label="Tag">
              <Select
                value={filters.tagId ?? ''}
                onChange={(event) =>
                  setFilters({ ...filters, tagId: event.target.value || undefined })
                }
              >
                <option value="">All tags</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Compare from">
            <Input
              type="date"
              value={filters.comparisonFrom ?? ''}
              onChange={(event) =>
                setFilters({ ...filters, comparisonFrom: event.target.value || undefined })
              }
            />
          </Field>
          <Field label="Compare to">
            <Input
              type="date"
              value={filters.comparisonTo ?? ''}
              onChange={(event) =>
                setFilters({ ...filters, comparisonTo: event.target.value || undefined })
              }
            />
          </Field>
          <Button onClick={() => void load()} disabled={loading}>
            Run report
          </Button>
        </Card>

        {definition ? (
          <Card className="rb-report-actions">
            <div className="rb-report-export-actions">
              {(['csv', 'xlsx', 'pdf'] as const).map((format) => (
                <Button key={format} variant="outline" size="sm" asChild>
                  <a href={exportHref(organizationId, definition.key, filters, format)}>
                    <Download aria-hidden="true" /> {format.toUpperCase()}
                  </a>
                </Button>
              ))}
            </div>
            {canManage ? (
              <div className="rb-report-save-actions">
                <Input
                  aria-label="Saved report name"
                  placeholder="Saved report name"
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                />
                <Button size="sm" onClick={() => void saveReport()} disabled={!saveName.trim()}>
                  <Save aria-hidden="true" /> Save
                </Button>
              </div>
            ) : null}
          </Card>
        ) : null}

        {loading && !report ? <Skeleton /> : null}
        {report ? (
          <ReportTable
            report={report}
            currency={currency}
            onExplain={(row, label) => setExplainTarget({ row, label })}
          />
        ) : null}
        {explainTarget && organizationId && report ? (
          <NumberExplanationPanel
            organizationId={organizationId}
            reportKey={report.definition.key}
            filters={filters}
            row={explainTarget.row}
            label={explainTarget.label}
            currency={currency}
            canAskAi={hasPermission(organization, 'ai.assistant.ask')}
            onClose={() => setExplainTarget(null)}
          />
        ) : null}
        {definition ? (
          <Card className="rb-report-provenance">
            <div>
              <strong>Source of truth</strong>
              <p>{definition.sourceOfTruth}</p>
            </div>
            <div>
              <strong>Reconciliation</strong>
              <p>{definition.reconciliation}</p>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}

export function SavedReportsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'reports.view');
  const canManage = hasPermission(organization, 'reports.manage');
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId || !canView) return;
    try {
      const response = await apiRequest<SavedReportsResponse>(
        `/organizations/${organizationId}/reports/saved`,
      );
      setReports(response.data);
      setError(null);
    } catch (caught) {
      setError(message(caught, 'Saved reports could not be loaded.'));
    }
  }, [canView, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string) {
    if (!organizationId) return;
    try {
      await apiRequest(`/organizations/${organizationId}/reports/saved/${id}`, {
        method: 'DELETE',
      });
      await load();
    } catch (caught) {
      setError(message(caught, 'The saved report could not be deleted.'));
    }
  }

  if (!workspace.loading && organization && !canView)
    return <ForbiddenState description="Ask for report access to see saved reports." />;
  return (
    <>
      <PageHeader
        title="Saved reports"
        description="Reusable report filters. Report logic remains tied to the current verified definition."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/reports">Report library</Link>
          </Button>
        }
      />
      <div className="rb-ledger-stack">
        <Messages error={error} />
        <Card>
          {reports.length === 0 ? (
            <p className="rb-muted">No saved reports yet.</p>
          ) : (
            <div className="rb-saved-report-list">
              {reports.map((report) => (
                <div key={report.id} className="rb-saved-report-row">
                  <div>
                    <strong>{report.name}</strong>
                    <span>{report.reportKey}</span>
                  </div>
                  <div className="rb-report-export-actions">
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/reports/${report.reportKey}?${filterParams(report.filters)}`}>
                        Open
                      </Link>
                    </Button>
                    {canManage ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Delete ${report.name}`}
                        onClick={() => void remove(report.id)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function ReportTable({
  report,
  currency,
  onExplain,
}: {
  report: ReportData;
  currency: string;
  onExplain?: (row: ReportRow, label: string) => void;
}) {
  const canExplain = Boolean(onExplain) && report.definition.supportsDrillDown;
  const labelColumn = report.definition.columns[0];
  const totals = report.definition.columns.filter(
    (column) =>
      (column.type === 'money' || column.type === 'number') &&
      report.totals[column.key] !== undefined,
  );
  return (
    <section className="rb-report-results" aria-label={`${report.definition.name} results`}>
      {totals.length > 0 ? (
        <div className="rb-report-totals" aria-label="Report totals">
          {totals.map((column) => (
            <div key={column.key}>
              <span>{column.label}</span>
              <strong className="rb-num">
                {formatCell(report.totals[column.key], column, currency)}
              </strong>
            </div>
          ))}
          <div>
            <span>Rows</span>
            <strong className="rb-num">{report.pagination.totalRows}</strong>
          </div>
        </div>
      ) : null}
      <div className="rb-table-scroll">
        <table className="rb-table rb-report-table">
          <caption className="rb-visually-hidden">{report.definition.name}</caption>
          <thead>
            <tr>
              {report.definition.columns.map((column) => (
                <th
                  key={column.key}
                  className={
                    column.type === 'money' || column.type === 'number'
                      ? 'rb-table--right'
                      : undefined
                  }
                >
                  {column.label}
                </th>
              ))}
              <th>Source</th>
              {canExplain ? <th>Explain</th> : null}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.id}>
                {report.definition.columns.map((column) => (
                  <td
                    key={column.key}
                    className={
                      column.type === 'money' || column.type === 'number'
                        ? 'rb-table--right rb-num'
                        : undefined
                    }
                  >
                    {formatCell(
                      row.cells[column.key],
                      column,
                      String(row.cells.currency ?? currency),
                    )}
                  </td>
                ))}
                <td>{row.source ? <Link href={row.source.href}>View source</Link> : '—'}</td>
                {canExplain ? (
                  <td>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        onExplain?.(
                          row,
                          labelColumn
                            ? formatCell(row.cells[labelColumn.key], labelColumn, currency)
                            : row.id,
                        )
                      }
                    >
                      Explain
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
            {report.rows.length === 0 ? (
              <tr>
                <td colSpan={report.definition.columns.length + 1 + (canExplain ? 1 : 0)}>
                  No activity for these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <div className="rb-report-pagination">
          Showing {report.rows.length} of {report.pagination.totalRows} rows.
        </div>
      </div>
    </section>
  );
}

function pickDrillDownFilters(filters: Partial<ReportFilters>): Partial<ReportFilters> {
  const { from, to, basis, currencyMode, projectId, tagId } = filters;
  return { from, to, basis, currencyMode, projectId, tagId };
}

function NumberExplanationPanel({
  organizationId,
  reportKey,
  filters,
  row,
  label,
  currency,
  canAskAi,
  onClose,
}: {
  organizationId: string;
  reportKey: ReportKey;
  filters: Partial<ReportFilters>;
  row: ReportRow;
  label: string;
  currency: string;
  canAskAi: boolean;
  onClose: () => void;
}) {
  const [drillDown, setDrillDown] = useState<ReportDrillDownData | null>(null);
  const [explanation, setExplanation] = useState<ExplainNumberExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drillDownFilters = pickDrillDownFilters(filters);

  useEffect(() => {
    let cancelled = false;
    setDrillDown(null);
    setExplanation(null);
    setError(null);

    async function load() {
      try {
        if (canAskAi) {
          const response = await apiRequest<ExplainNumberResponse>(
            `/organizations/${organizationId}/ai/explain-number`,
            {
              method: 'POST',
              body: JSON.stringify({ reportKey, rowId: row.id, ...drillDownFilters }),
            },
          );
          if (cancelled) return;
          setDrillDown(response.data.drillDown);
          setExplanation(response.data.explanation);
        } else {
          const query = filterParams(drillDownFilters);
          const response = await apiRequest<ReportDrillDownResult>(
            `/organizations/${organizationId}/reports/${encodeURIComponent(reportKey)}/rows/${row.id}/drill-down?${query}`,
          );
          if (cancelled) return;
          setDrillDown(response.data);
          setExplanation({ state: 'unavailable', reason: 'AI_NOT_PERMITTED' });
        }
      } catch (caught) {
        if (!cancelled) setError(message(caught, 'This number could not be explained.'));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // drillDownFilters is derived fresh from filters every render; depend on its fields directly
    // rather than the object reference so a same-value refresh doesn't re-fetch.
  }, [
    organizationId,
    reportKey,
    row.id,
    canAskAi,
    drillDownFilters.from,
    drillDownFilters.to,
    drillDownFilters.basis,
    drillDownFilters.currencyMode,
    drillDownFilters.projectId,
    drillDownFilters.tagId,
  ]);

  const labelColumn = drillDown?.definition.columns[0];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent
        side="right"
        title={`Explain ${label}`}
        description="Deterministic breakdown and, if available, an AI interpretation."
      >
        <div className="rb-explain-panel rb-explain-panel--surface">
          {error ? (
            <ErrorState title="This number could not be explained" description={error} />
          ) : null}
          {!drillDown && !error ? <Skeleton /> : null}
          {drillDown ? (
            <>
              <div className="rb-explain-summary-row">
                <strong>{label}</strong>
                {drillDown.definition.columns
                  .filter((column) => column.key !== labelColumn?.key)
                  .map((column) => (
                    <span key={column.key}>
                      {column.label}:{' '}
                      {formatCell(drillDown.row.cells[column.key], column, currency)}
                    </span>
                  ))}
              </div>
              <p className="rb-muted">Lines reconcile exactly to the reported total.</p>
              <div className="rb-table-scroll">
                <table className="rb-table">
                  <caption className="rb-visually-hidden">Contributing entries for {label}</caption>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Reference</th>
                      <th>Description</th>
                      <th className="rb-table--right">Debit</th>
                      <th className="rb-table--right">Credit</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillDown.lines.map((line) => (
                      <tr key={line.id}>
                        <td>{String(line.cells.date ?? '—')}</td>
                        <td>{String(line.cells.reference ?? '—')}</td>
                        <td>{String(line.cells.description ?? '—')}</td>
                        <td className="rb-table--right rb-num">
                          {formatMinor(String(line.cells.debitMinor ?? '0'), currency)}
                        </td>
                        <td className="rb-table--right rb-num">
                          {formatMinor(String(line.cells.creditMinor ?? '0'), currency)}
                        </td>
                        <td>
                          {line.source ? <Link href={line.source.href}>View source</Link> : '—'}
                        </td>
                      </tr>
                    ))}
                    {drillDown.lines.length === 0 ? (
                      <tr>
                        <td colSpan={6}>No contributing entries.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div className="rb-explain-ai" aria-live="polite">
                {renderExplanation(explanation, canAskAi)}
              </div>
            </>
          ) : null}
        </div>
      </DrawerContent>
    </Dialog>
  );
}

function renderExplanation(
  explanation: ExplainNumberExplanation | null,
  canAskAi: boolean,
): React.ReactNode {
  if (!canAskAi) {
    return (
      <Badge tone="neutral">
        Your role can view the breakdown above; AI explanations need the assistant permission.
      </Badge>
    );
  }
  if (!explanation) return <Skeleton />;
  if (explanation.state === 'unavailable') {
    return (
      <div className="rb-explain-unavailable">
        <Badge tone="warning">AI explanation unavailable</Badge>
        <p className="rb-muted">{unavailableReasonCopy(explanation.reason)}</p>
      </div>
    );
  }
  if (explanation.abstained) {
    return (
      <p className="rb-muted">
        The assistant couldn’t confirm an explanation from the available evidence.
      </p>
    );
  }
  return (
    <div className="rb-explain-ready">
      <p>{explanation.summary}</p>
      {explanation.citations.length > 0 ? (
        <ul className="rb-explain-citations">
          {explanation.citations.map((citation) => (
            <li key={citation.sourceId}>
              {citation.href ? <Link href={citation.href}>View source</Link> : citation.sourceType}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="rb-muted rb-explain-caption">
        AI-written interpretation of the evidence above. It is not verified fact and never changes
        the reported amount.
      </p>
    </div>
  );
}

function unavailableReasonCopy(reason: string): string {
  if (reason === 'MODEL_DISABLED') return 'AI is turned off for this workspace.';
  if (reason === 'AI_NOT_PERMITTED') return 'Your role does not have the AI assistant permission.';
  if (reason === 'MODEL_EVIDENCE_STALE')
    return 'The underlying data changed while preparing this explanation.';
  return 'The AI explanation service is temporarily unavailable.';
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rb-field">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Messages({ error, notice }: { error?: string | null; notice?: string | null }) {
  return (
    <>
      {error ? (
        <div className="rb-auth-error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rb-auth-success" role="status">
          {notice}
        </div>
      ) : null}
    </>
  );
}

function filterParams(filters: Partial<ReportFilters>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value !== undefined && value !== '') params.set(key, String(value));
  return params.toString();
}

function exportHref(
  organizationId: string | null,
  key: ReportKey,
  filters: Partial<ReportFilters>,
  format: string,
) {
  return apiDownloadUrl(
    `/organizations/${organizationId}/reports/${key}/export?${filterParams({ ...filters })}&format=${format}`,
  );
}

function formatCell(
  value: string | number | boolean | null | undefined,
  column: ReportColumn,
  currency: string,
): string {
  if (value === null || value === undefined || value === '') return '—';
  const text = value.toString();
  if (column.type === 'money') return formatMinor(text, currency);
  if (column.type === 'percent') return `${text}%`;
  return text.replaceAll('_', ' ');
}

function formatMinor(value: string, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(
      Number(BigInt(value)) / 100,
    );
  } catch {
    return `${currency} ${value}`;
  }
}

function message(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function yearStart(): string {
  return `${today().slice(0, 4)}-01-01`;
}

const recentReportsKey = (organizationId: string) => `rb-recent-reports:${organizationId}`;

function readRecentReportKeys(organizationId: string): ReportKey[] {
  try {
    const stored = window.localStorage.getItem(recentReportsKey(organizationId));
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is ReportKey => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

function recordRecentReport(organizationId: string, reportKey: ReportKey): void {
  try {
    const updated = [
      reportKey,
      ...readRecentReportKeys(organizationId).filter((key) => key !== reportKey),
    ].slice(0, 4);
    window.localStorage.setItem(recentReportsKey(organizationId), JSON.stringify(updated));
  } catch {
    // Storage can be unavailable in privacy-restricted browsing; report access must still work.
  }
}
