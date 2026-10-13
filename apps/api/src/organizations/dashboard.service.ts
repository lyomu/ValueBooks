import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerAccountType, Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';
import type { PermissionKey } from './permission-catalog.js';

const incomeTypes: LedgerAccountType[] = [
  LedgerAccountType.REVENUE,
  LedgerAccountType.OTHER_INCOME,
];
const expenseTypes: LedgerAccountType[] = [
  LedgerAccountType.EXPENSE,
  LedgerAccountType.COST_OF_SALES,
  LedgerAccountType.OTHER_EXPENSE,
];

type AggregatedLedgerRow = {
  accountId: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  normalBalance: 'DEBIT' | 'CREDIT';
  systemKey: string | null;
  month: string;
  sourceType: string | null;
  debitMinor: string;
  creditMinor: string;
};
type OpenItemRow = { dueDate: Date | null; currency: string; balanceMinor: string; count: number };

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async get(
    organizationId: string,
    fromInput?: string,
    toInput?: string,
    permissions: ReadonlySet<PermissionKey> = new Set(),
  ) {
    const today = new Date().toISOString().slice(0, 10);
    const from = fromInput ?? `${today.slice(0, 4)}-01-01`;
    const to = toInput ?? today;
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
      throw new BadRequestException('Provide a valid date range with from on or before to.');
    }
    const startDate = new Date(`${from}T00:00:00.000Z`);
    const endDate = new Date(`${to}T00:00:00.000Z`);
    const monthSpan =
      (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
      endDate.getUTCMonth() -
      startDate.getUTCMonth();
    if (monthSpan > 120)
      throw new BadRequestException('Dashboard date ranges cannot exceed ten years.');
    const [
      organization,
      ledgerRows,
      cashAccounts,
      defaultCash,
      recent,
      invoices,
      bills,
      drafts,
      unresolved,
      fiscalYears,
      taxCodes,
    ] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { baseCurrency: true },
      }),
      this.prisma.$queryRaw<AggregatedLedgerRow[]>(Prisma.sql`
        SELECT jl.account_id::text AS "accountId", a.code, a.name, a.type::text AS type,
          a.normal_balance::text AS "normalBalance", a.system_key AS "systemKey",
          to_char(j.journal_date, 'YYYY-MM') AS month, j.source_type AS "sourceType",
          SUM(jl.debit_minor)::text AS "debitMinor", SUM(jl.credit_minor)::text AS "creditMinor"
        FROM journal_lines jl
        JOIN journals j ON j.id = jl.journal_id AND j.organization_id = jl.organization_id
        JOIN ledger_accounts a ON a.id = jl.account_id AND a.organization_id = jl.organization_id
        WHERE jl.organization_id = ${organizationId}::uuid
          AND j.status::text = 'POSTED'
          AND j.journal_date >= ${startDate}::date AND j.journal_date <= ${endDate}::date
        GROUP BY jl.account_id, a.code, a.name, a.type, a.normal_balance, a.system_key,
          to_char(j.journal_date, 'YYYY-MM'), j.source_type
      `),
      this.prisma.financialAccount.findMany({
        where: { organizationId, active: true },
        select: { glAccountId: true },
      }),
      this.prisma.ledgerAccount.findMany({
        where: { organizationId, systemKey: 'bank_default' },
        select: { id: true },
      }),
      this.prisma.journal.findMany({
        where: { organizationId, status: 'POSTED' },
        orderBy: [{ journalDate: 'desc' }, { createdAt: 'desc' }],
        take: 12,
        select: {
          id: true,
          journalDate: true,
          sourceType: true,
          reference: true,
          description: true,
          lines: { select: { debitMinor: true, creditMinor: true } },
        },
      }),
      this.prisma.$queryRaw<OpenItemRow[]>(Prisma.sql`
        SELECT due_date AS "dueDate", currency, SUM(balance_minor)::text AS "balanceMinor",
          COUNT(*)::int AS count
        FROM invoices
        WHERE organization_id = ${organizationId}::uuid
          AND status::text IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') AND voided_at IS NULL
          AND issue_date <= ${endDate}::date AND balance_minor > 0
        GROUP BY due_date, currency
      `),
      this.prisma.$queryRaw<OpenItemRow[]>(Prisma.sql`
        SELECT due_date AS "dueDate", currency, SUM(balance_minor)::text AS "balanceMinor",
          COUNT(*)::int AS count
        FROM bills
        WHERE organization_id = ${organizationId}::uuid
          AND status::text IN ('ISSUED', 'PARTIALLY_PAID') AND voided_at IS NULL
          AND issue_date <= ${endDate}::date AND balance_minor > 0
        GROUP BY due_date, currency
      `),
      this.prisma.journal.count({ where: { organizationId, status: 'DRAFT' } }),
      this.prisma.bankTransaction.count({ where: { organizationId, disposition: 'UNRESOLVED' } }),
      this.prisma.fiscalYear.count({ where: { organizationId } }),
      this.prisma.taxCode.count({ where: { organizationId, archivedAt: null } }),
    ]);
    if (!organization) throw new NotFoundException('Organization not found.');

    const base = organization.baseCurrency;
    const months = monthBuckets(from, to);
    const quarterly = months.some((month) => month.key.includes('-Q'));
    const monthIndex = new Map(months.map((month) => [month.key, month]));
    const expenseByAccount = new Map<string, { name: string; amount: bigint }>();
    let income = 0n;
    let expenses = 0n;
    let cashMovement = 0n;
    let cashIn = 0n;
    let cashOut = 0n;
    let cashAdjustments = 0n;
    const cashIds = new Set([
      ...cashAccounts.map((account) => account.glAccountId),
      ...defaultCash.map((account) => account.id),
    ]);
    for (const line of ledgerRows) {
      const debit = BigInt(line.debitMinor);
      const credit = BigInt(line.creditMinor);
      const month = monthIndex.get(bucketKey(line.month, quarterly));
      if (incomeTypes.includes(line.type)) {
        const amount = line.normalBalance === 'CREDIT' ? credit - debit : debit - credit;
        income += amount;
        if (month) month.income += Number(amount) / minorDivisor(base);
      } else if (expenseTypes.includes(line.type)) {
        const amount = line.normalBalance === 'DEBIT' ? debit - credit : credit - debit;
        expenses += amount;
        if (month) month.expenses += Number(amount) / minorDivisor(base);
        const item = expenseByAccount.get(line.accountId) ?? {
          name: `${line.code} · ${line.name}`,
          amount: 0n,
        };
        item.amount += amount;
        expenseByAccount.set(line.accountId, item);
      }
      if (cashIds.has(line.accountId) || line.systemKey === 'bank_default') {
        const amount = line.normalBalance === 'DEBIT' ? debit - credit : credit - debit;
        cashMovement += amount;
        if (month) month.cashMovement += Number(amount) / minorDivisor(base);
        if (line.sourceType === 'FX_REVALUATION' || line.sourceType === 'OPENING_BALANCE') {
          cashAdjustments += amount;
        } else if (line.sourceType !== 'TRANSFER') {
          if (amount > 0n) cashIn += amount;
          else cashOut += -amount;
        }
      }
    }

    const currentAgingAvailable = to === today;
    const receivables = currentAgingAvailable ? age(invoices, to, base) : null;
    const payables = currentAgingAvailable ? age(bills, to, base) : null;
    const cashIdsList = [...cashIds];
    const cashBalanceRows = cashIdsList.length
      ? await this.prisma.journalLine.aggregate({
          where: {
            organizationId,
            accountId: { in: cashIdsList },
            journal: { organizationId, status: 'POSTED', journalDate: { lte: endDate } },
          },
          _sum: { debitMinor: true, creditMinor: true },
        })
      : null;
    const cashBalance = cashBalanceRows
      ? BigInt(cashBalanceRows._sum.debitMinor ?? 0n) -
        BigInt(cashBalanceRows._sum.creditMinor ?? 0n)
      : null;

    return {
      currency: base,
      period: { from, to },
      capabilities: {
        receivables: permissions.has('sales.invoices.view'),
        payables: permissions.has('purchases.bills.view'),
        journals: permissions.has('journals.view'),
      },
      summary: {
        income: income.toString(),
        expenses: expenses.toString(),
        netProfit: (income - expenses).toString(),
      },
      incomeExpenses: months,
      grouping: quarterly ? 'quarterly' : 'monthly',
      topExpenses: topExpenseGroups(expenseByAccount, permissions.has('accounts.view')),
      receivables,
      payables,
      agingUnavailableReason: currentAgingAvailable
        ? null
        : 'Open-item balances are current-state values; historical aging is unavailable for this cutoff.',
      cashFlow: {
        openingBalance: cashBalance === null ? null : (cashBalance - cashMovement).toString(),
        inflows: cashIn.toString(),
        outflows: cashOut.toString(),
        adjustments: cashAdjustments.toString(),
        closingBalance: cashBalance?.toString() ?? null,
        movement: cashMovement.toString(),
        series: months.map((month) => ({ key: month.key, movement: month.cashMovement })),
      },
      recentTransactions: recent.map((journal) => ({
        id: journal.id,
        href: permissions.has('journals.view') ? `/journals/${journal.id}` : null,
        date: journal.journalDate.toISOString().slice(0, 10),
        type: transactionType(journal.sourceType),
        reference: journal.reference ?? '—',
        description: journal.description,
        amount: journal.lines.reduce((total, line) => total + line.debitMinor, 0n).toString(),
        status: 'POSTED',
      })),
      actions: [
        ...(permissions.has('periods.view') && !fiscalYears
          ? [
              {
                title: 'Set up a fiscal year',
                count: 1,
                href: '/settings/fiscal-periods',
                severity: 'warning',
              },
            ]
          : []),
        ...(permissions.has('tax.codes.view') && !taxCodes
          ? [
              {
                title: 'Configure tax codes',
                count: 1,
                href: '/settings/taxes',
                severity: 'warning',
              },
            ]
          : []),
        ...(permissions.has('sales.invoices.view') &&
        to === today &&
        overdueCount(invoices, endDate)
          ? [
              {
                title: 'Overdue customer invoices',
                count: overdueCount(invoices, endDate),
                href: '/invoices',
                severity: 'warning',
              },
            ]
          : []),
        ...(permissions.has('purchases.bills.view') && to === today && overdueCount(bills, endDate)
          ? [
              {
                title: 'Overdue vendor bills',
                count: overdueCount(bills, endDate),
                href: '/bills',
                severity: 'warning',
              },
            ]
          : []),
        ...(permissions.has('journals.view') && drafts
          ? [
              {
                title: 'Draft journals awaiting posting',
                count: drafts,
                href: '/journals',
                severity: 'info',
              },
            ]
          : []),
        ...(permissions.has('banking.transactions.view') && unresolved
          ? [
              {
                title: 'Unmatched bank transactions',
                count: unresolved,
                href: '/banking',
                severity: 'warning',
              },
            ]
          : []),
      ],
    };
  }
}

function monthBuckets(from: string, to: string) {
  const first = new Date(`${from.slice(0, 7)}-01T00:00:00.000Z`);
  const end = new Date(`${to.slice(0, 7)}-01T00:00:00.000Z`);
  const monthSpan =
    (end.getUTCFullYear() - first.getUTCFullYear()) * 12 + end.getUTCMonth() - first.getUTCMonth();
  const quarterly = monthSpan > 36;
  const start = new Date(
    Date.UTC(
      first.getUTCFullYear(),
      quarterly ? Math.floor(first.getUTCMonth() / 3) * 3 : first.getUTCMonth(),
      1,
    ),
  );
  const result: {
    key: string;
    label: string;
    income: number;
    expenses: number;
    cashMovement: number;
  }[] = [];
  for (
    const date = start;
    date <= end;
    date.setUTCMonth(date.getUTCMonth() + (quarterly ? 3 : 1))
  ) {
    const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
    result.push({
      key: quarterly ? `${date.getUTCFullYear()}-Q${quarter}` : date.toISOString().slice(0, 7),
      label: quarterly
        ? `Q${quarter} '${String(date.getUTCFullYear()).slice(-2)}`
        : date.toLocaleString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
      income: 0,
      expenses: 0,
      cashMovement: 0,
    });
  }
  return result;
}

function bucketKey(month: string, quarterly: boolean) {
  if (!quarterly) return month;
  const [year = 0, monthNumber = 1] = month.split('-').map(Number);
  return `${year}-Q${Math.floor((monthNumber - 1) / 3) + 1}`;
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function age<T extends OpenItemRow>(rows: T[], cutoff: string, base: string) {
  if (rows.some((row) => BigInt(row.balanceMinor) > 0n && row.currency !== base))
    return { available: false, total: '0', buckets: [] as { label: string; amount: string }[] };
  const totals: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
  const cutoffDate = new Date(`${cutoff}T00:00:00.000Z`);
  for (const row of rows) {
    const balance = BigInt(row.balanceMinor);
    if (balance <= 0n) continue;
    const days = row.dueDate
      ? Math.floor((cutoffDate.getTime() - row.dueDate.getTime()) / 86400000)
      : 0;
    const bucket = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
    totals[bucket] += balance;
  }
  return {
    available: true,
    total: totals.reduce((sum, amount) => sum + amount, 0n).toString(),
    buckets: ['Current', '1–30 days', '31–60 days', '61–90 days', 'Over 90 days'].map(
      (label, index) => ({ label, amount: totals[index]!.toString() }),
    ),
  };
}

function overdueCount(rows: OpenItemRow[], cutoff: Date) {
  return rows.reduce(
    (total, row) => total + (row.dueDate && row.dueDate < cutoff ? row.count : 0),
    0,
  );
}

function transactionType(source: string | null) {
  const types: Record<string, string> = {
    SALES_INVOICE: 'Invoice',
    BILL: 'Bill',
    EXPENSE: 'Expense',
    PAYMENT_RECEIVED: 'Customer payment',
    PAYMENT_MADE: 'Vendor payment',
    CREDIT_NOTE: 'Credit note',
    JOURNAL: 'Journal entry',
    BANK_TRANSACTION: 'Bank transaction',
  };
  return source ? (types[source] ?? source.replaceAll('_', ' ').toLowerCase()) : 'Journal entry';
}

function minorDivisor(currency: string): number {
  return (
    10 **
    (new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2)
  );
}

function topExpenseGroups(
  accounts: Map<string, { name: string; amount: bigint }>,
  canViewAccounts: boolean,
) {
  const sorted = [...accounts.entries()]
    .map(([id, item]) => ({ id, ...item }))
    .filter((item) => item.amount > 0n)
    .sort((a, b) => (a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0));
  const top: { id: string | null; href: string | null; name: string; amount: string }[] = sorted
    .slice(0, 5)
    .map((item) => ({
      id: item.id,
      href: canViewAccounts ? `/accounts/${item.id}/ledger` : null,
      name: item.name,
      amount: item.amount.toString(),
    }));
  const other = sorted.slice(5).reduce((total, item) => total + item.amount, 0n);
  if (other > 0n)
    top.push({ id: null, href: null, name: 'Other expenses', amount: other.toString() });
  return top;
}
