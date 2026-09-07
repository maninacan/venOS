import { describe, it, expect } from 'vitest';
import { computeProfit, resolveFeeAmount, shiftPayExact, type LaborRow } from './profit.js';

const round2 = (x: number) => Math.round(x * 100) / 100;
const laborOf = (rows: LaborRow[]) => computeProfit(null, null, rows, [], 0, false).laborFees;

/**
 * Labor pay used to be rounded four times between Square and the event total:
 * hours quantized to 0.01 (36s) in the Square adapter, stored at numeric(6,2),
 * rounded again by the generated `total` column, then Math.ceil'd per shift before
 * summing. Only the last conversion to dollars is actually required.
 *
 * These tests pin the single-rounding rule. The event total must equal what Square
 * itself would compute from exact durations.
 */
describe('shiftPayExact', () => {
  it('prefers a flat rate over everything else', () => {
    expect(shiftPayExact({ flatRate: 250, durationSeconds: 3600, hours: 99, wage: 18 })).toBe(250);
  });

  // `!= null`, not truthiness — a confirmed unpaid shift is a real value.
  it('honors a flat rate of zero instead of falling through', () => {
    expect(shiftPayExact({ flatRate: 0, hours: 5, wage: 20 })).toBe(0);
  });

  it('prefers the exact duration over the rounded hours figure', () => {
    expect(shiftPayExact({ durationSeconds: 1800, wage: 20, hours: 99 })).toBeCloseTo(10, 10);
  });

  it('honors a zero duration rather than falling back to hours', () => {
    // pullLabor writes durationSeconds: 0 for unparseable timestamps; it must not
    // then be paid from a stale hours value.
    expect(shiftPayExact({ durationSeconds: 0, wage: 20, hours: 5 })).toBe(0);
  });

  it('falls back to hours x wage for manual and pre-migration rows', () => {
    expect(shiftPayExact({ hours: 3, wage: 18 })).toBe(54);
  });

  it('treats an empty row as zero', () => {
    expect(shiftPayExact({})).toBe(0);
  });

  it('does not round — precision is preserved for the caller to sum', () => {
    // 22381s at $18/hr = $111.905, which must survive as-is.
    expect(shiftPayExact({ durationSeconds: 22381, wage: 18 })).toBeCloseTo(111.905, 10);
  });
});

describe('labor total', () => {
  // Realistic Square timecards — clock-ins are never round numbers.
  const shifts = [
    { sec: 6 * 3600 + 13 * 60 + 22, wage: 18.0 },
    { sec: 5 * 3600 + 47 * 60 + 9, wage: 16.5 },
    { sec: 8 * 3600 + 2 * 60 + 41, wage: 22.0 },
    { sec: 7 * 3600 + 31 * 60 + 55, wage: 19.25 },
    { sec: 4 * 3600 + 58 * 60 + 33, wage: 17.75 },
    { sec: 3 * 3600 + 41 * 60 + 12, wage: 20.0 },
  ];
  const squareExact = round2(shifts.reduce((s, r) => s + (r.sec / 3600) * r.wage, 0));

  it('matches what Square computes from exact durations', () => {
    const rows: LaborRow[] = shifts.map(r => ({
      durationSeconds: r.sec,
      wage: r.wage,
      hours: Math.round((r.sec / 3600) * 100) / 100,
      total: round2((r.sec / 3600) * r.wage),
    }));
    expect(laborOf(rows)).toBe(squareExact);
  });

  it('beats the old quantize-then-ceil pipeline, which drifted', () => {
    // Reproduce the old path: hours quantized to 0.01, DB rounds, ceil per shift.
    const old = round2(shifts.reduce((s, r) => {
      const hours = Math.round((r.sec * 1000) / 36000) / 100;
      return s + Math.ceil(round2(hours * r.wage) * 100) / 100;
    }, 0));
    expect(old).not.toBe(squareExact);
    expect(Math.abs(old - squareExact)).toBeGreaterThan(0);
  });

  // Math.ceil(x * 100) / 100 is not a no-op on exact cent values: 1.1 * 100 is
  // 110.00000000000001 in binary floating point, so ceil pushed it to 1.11. It hit
  // ~4.6% of cent values, once per shift.
  it('does not invent pennies from float representation', () => {
    const rows: LaborRow[] = [
      { hours: 0.55, wage: 1, total: 0.55 },
      { hours: 1.1, wage: 1, total: 1.1 },
      { hours: 0.07, wage: 1, total: 0.07 },
    ];
    expect(laborOf(rows)).toBe(1.72);
    // What the old rule produced, for the record.
    const oldRule = round2(rows.reduce((s, r) => s + Math.ceil((r.total as number) * 100) / 100, 0));
    expect(oldRule).toBe(1.75);
  });

  it('rounds once at the end, not per shift', () => {
    // Three shifts of $0.005 each: rounding per shift gives 0.00 or 0.03; summing
    // first gives 0.015 -> 0.02.
    const rows: LaborRow[] = Array.from({ length: 3 }, () => ({ durationSeconds: 18, wage: 1 }));
    expect(laborOf(rows)).toBe(0.02);
  });

  it('mixes flat-rate, POS-duration and legacy rows correctly', () => {
    const rows: LaborRow[] = [
      { flatRate: 120 },
      { durationSeconds: 6 * 3600 + 13 * 60 + 22, wage: 18 },
      { hours: 4, wage: 15 },
    ];
    const expected = round2(120 + ((6 * 3600 + 13 * 60 + 22) / 3600) * 18 + 60);
    expect(laborOf(rows)).toBe(expected);
  });

  it('is zero when no shifts exist', () => {
    expect(laborOf([])).toBe(0);
  });

  it('flows into totalExpenses and reduces net profit', () => {
    const r = computeProfit({ netSales: 1000 }, null, [{ durationSeconds: 3600, wage: 20 }], [], 0, false);
    expect(r.laborFees).toBe(20);
    expect(r.totalExpenses).toBe(20);
    expect(r.netProfit).toBe(980);
  });
});

/**
 * Guards for the rest of computeProfit, which the labor change must not disturb.
 * Several of these pin behavior that is arguably surprising; they are deliberate.
 */
describe('computeProfit — non-labor behavior unchanged', () => {
  it('returns all zeros for a completely empty event', () => {
    expect(computeProfit(null, null, [], [], 0, false)).toEqual({
      posFees: 0, cogs: 0, grossProfit: 0, totalExpenses: 0, netProfit: 0,
      tips: 0, stateFoodTax: 0, laborFees: 0, additionalFeesTotal: 0,
      mileageReimbursement: 0,
    });
  });

  it('reports netProfit === netSales when only revenue is configured', () => {
    const r = computeProfit({ netSales: 4820 }, null, [], [], 0, false);
    expect(r.netProfit).toBe(4820);
  });

  it('subtracts cogs from netSales for gross profit', () => {
    const r = computeProfit({ netSales: 1000 }, null, [], [], 300, false);
    expect(r.grossProfit).toBe(700);
  });

  it('uses squareFees only for POS-linked events', () => {
    const sales = { netSales: 1000, squareFees: 29 };
    expect(computeProfit(sales, null, [], [], 0, true).posFees).toBe(29);
    expect(computeProfit(sales, null, [], [], 0, false).posFees).toBe(0);
  });

  // The override is `> 0`, so an explicit zero does not suppress Square's fees.
  it('does not treat a zero manual posFee as an override', () => {
    const r = computeProfit({ netSales: 1000, squareFees: 29 }, { posFee: 0 }, [], [], 0, true);
    expect(r.posFees).toBe(29);
  });

  it('defaults the mileage rate to 0.67 but honors an explicit zero', () => {
    expect(computeProfit(null, { mileage: 100 }, [], [], 0, false).mileageReimbursement).toBeCloseTo(67, 6);
    expect(computeProfit(null, { mileage: 100, mileageRate: 0 }, [], [], 0, false).mileageReimbursement).toBe(0);
  });

  it('applies percentage fees to netSales, or grossSales when asked', () => {
    const sales = { grossSales: 2000, netSales: 1000 };
    expect(computeProfit(sales, null, [], [{ amount: 30, isDiscount: false, calcType: 'percentage' }], 0, false).additionalFeesTotal).toBe(300);
    expect(computeProfit(sales, null, [], [{ amount: 30, isDiscount: false, calcType: 'percentage', pctBase: 'gross' }], 0, false).additionalFeesTotal).toBe(600);
  });

  it('treats an absent calcType as flat', () => {
    expect(resolveFeeAmount({ amount: 50, isDiscount: false }, { netSales: 1000 }, 10)).toBe(50);
  });

  it('keeps sales tax informational — never deducted from profit', () => {
    const withTax = computeProfit({ netSales: 1000, totalCollected: 1080 }, null, [], [], 0, false, 0.08);
    const without = computeProfit({ netSales: 1000, totalCollected: 1080 }, null, [], [], 0, false, 0);
    expect(withTax.stateFoodTax).toBeCloseTo(86.4, 6);
    expect(withTax.netProfit).toBe(without.netProfit);
  });
});
