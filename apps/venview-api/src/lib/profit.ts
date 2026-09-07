// Shared profit calculation logic — ported from old buildPostEventReport()

export interface SalesSummaryRow {
  grossSales?: number | null;
  netSales?: number | null;
  discounts?: number | null;
  refunds?: number | null;
  tax?: number | null;
  tips?: number | null;
  squareFees?: number | null;
  posFees?: number | null;
  taxRate?: number | null;
  taxOverride?: boolean | null;
  totalCollected?: number | null;
}

export interface ExpensesRow {
  healthDeptFee?: number | null;
  eventFee?: number | null;
  mileage?: number | null;
  mileageRate?: number | null;
  coordinatorFee?: number | null;
  posFee?: number | null;
  employeeBonus?: number | null;
  eventRunnerFees?: number | null;
}

export interface LaborRow {
  hours?: number | null;
  wage?: number | null;
  total?: number | null;
  /** Exact shift length from the POS timecard. Authoritative over `hours`. */
  durationSeconds?: number | null;
  /** Fixed amount for the shift; already an exact cent figure. */
  flatRate?: number | null;
}

/** A shift's pay at full precision — no rounding. Prefers a flat rate, then the
 *  exact duration, then the 2-decimal hours figure (manual entry / legacy rows). */
export function shiftPayExact(r: LaborRow): number {
  const n = (v: number | null | undefined) => Number(v ?? 0);
  if (r.flatRate != null) return n(r.flatRate);
  if (r.durationSeconds != null) return (n(r.durationSeconds) / 3600) * n(r.wage);
  return n(r.hours) * n(r.wage);
}

export type FeeCalcType = 'flat' | 'per_unit' | 'percentage';
export type FeePctBase = 'gross' | 'net';

export interface AdditionalFeeRow {
  amount: number;
  isDiscount: boolean;
  // How `amount` is interpreted: flat dollars, dollars-per-unit, or a percentage.
  // Absent/unknown → 'flat' (preserves legacy rows).
  calcType?: FeeCalcType | null;
  // For percentage rows: which sales figure the percent applies to.
  pctBase?: FeePctBase | null;
}

// Resolve a fee/expense row to its effective (signed) dollar amount.
// `unitsSold` is total items sold for the event; `sales` supplies the gross/net base.
export function resolveFeeAmount(
  fee: AdditionalFeeRow,
  sales: SalesSummaryRow | null,
  unitsSold: number
): number {
  const n = (v: number | null | undefined) => Number(v ?? 0);
  const rate = n(fee.amount);
  let value: number;
  switch (fee.calcType) {
    case 'per_unit':
      value = rate * n(unitsSold);
      break;
    case 'percentage':
      value = (rate / 100) * n(fee.pctBase === 'gross' ? sales?.grossSales : sales?.netSales);
      break;
    default: // 'flat'
      value = rate;
  }
  return fee.isDiscount ? -value : value;
}

export interface ProfitSummary {
  posFees: number;
  cogs: number;
  grossProfit: number;
  totalExpenses: number;
  netProfit: number;
  tips: number;
  stateFoodTax: number;
  laborFees: number;
  additionalFeesTotal: number;
  mileageReimbursement: number;
}

export function computeProfit(
  sales: SalesSummaryRow | null,
  expenses: ExpensesRow | null,
  laborRows: LaborRow[],
  additionalFees: AdditionalFeeRow[],
  cogsSalesFees: number,
  hasSquare: boolean,
  taxRate = 0,
  unitsSold = 0
): ProfitSummary {
  const n = (v: number | null | undefined) => Number(v ?? 0);

  const netSales = n(sales?.netSales);
  const squareTips = n(sales?.tips);
  const tips = squareTips;

  // Labor: sum every shift at full precision, then round to cents ONCE. Rounding
  // per shift (the old Math.ceil) both compounded drift and, because x*100 is not
  // exact in binary floating point, added a phantom penny to ~4.6% of exact cent
  // values — $1.10 became $1.11.
  const laborFees = Math.round(laborRows.reduce((sum, r) => sum + shiftPayExact(r), 0) * 100) / 100;

  // Additional fees / custom expenses (flat, per-unit, or percentage-based; discounts subtract)
  const additionalFeesTotal = additionalFees.reduce(
    (sum, f) => sum + resolveFeeAmount(f, sales, unitsSold),
    0
  );

  const mileageReimbursement = n(expenses?.mileage) * n(expenses?.mileageRate ?? 0.67);

  // POS fees: manual override wins, then Square fees for Square-linked events
  const manualPosFee = n(expenses?.posFee);
  const posFees = manualPosFee > 0
    ? manualPosFee
    : (hasSquare ? n(sales?.squareFees) : 0);

  const totalExpenses =
    n(expenses?.healthDeptFee) +
    n(expenses?.eventFee) +
    additionalFeesTotal +
    mileageReimbursement +
    n(expenses?.employeeBonus) +
    n(expenses?.eventRunnerFees) +
    laborFees +
    n(expenses?.coordinatorFee) +
    posFees;

  const cogs = cogsSalesFees;
  const grossProfit = netSales - cogs;
  const netProfit = grossProfit - totalExpenses;

  // Sales tax: informational only, never deducted from profit
  const taxBase = n(sales?.totalCollected) || netSales;
  const stateFoodTax = taxBase * taxRate;

  return {
    posFees,
    cogs,
    grossProfit,
    totalExpenses,
    netProfit,
    tips,
    stateFoodTax,
    laborFees,
    additionalFeesTotal,
    mileageReimbursement,
  };
}
