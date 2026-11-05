import { ADMIN_REPORT_MAX_MONTHS } from '@aseb/shared';

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1_000;
const DEFAULT_REPORT_MONTHS = 6;

function partsOfMonth(value: string): { year: number; month: number } {
  const [yearText = '1970', monthText = '1'] = value.split('-');
  return { year: Number(yearText), month: Number(monthText) };
}

function monthKeyFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function monthIndexFromKey(value: string): number {
  const { year, month } = partsOfMonth(value);
  return year * 12 + month - 1;
}

/** Calendar month in Asia/Jakarta. The zone has a fixed UTC+7 offset. */
export function jakartaMonthKey(date: Date): string {
  const local = new Date(date.getTime() + JAKARTA_OFFSET_MS);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function reportMonthStart(value: string): Date {
  const { year, month } = partsOfMonth(value);
  return new Date(Date.UTC(year, month - 1, 1) - JAKARTA_OFFSET_MS);
}

export function reportRangeBounds(
  input: { from?: string | undefined; to?: string | undefined },
  now = new Date(),
): { from: string; to: string; start: Date; end: Date; months: string[] } {
  const currentMonth = jakartaMonthKey(now);
  const to = input.to ?? currentMonth;
  const from = input.from ?? monthKeyFromIndex(monthIndexFromKey(to) - (DEFAULT_REPORT_MONTHS - 1));

  const fromIndex = monthIndexFromKey(from);
  const toIndex = monthIndexFromKey(to);
  const monthCount = toIndex - fromIndex + 1;
  if (monthCount < 1 || monthCount > ADMIN_REPORT_MAX_MONTHS) {
    throw new RangeError('Report range must be between 1 and 36 months.');
  }
  const months = Array.from({ length: toIndex - fromIndex + 1 }, (_, offset) =>
    monthKeyFromIndex(fromIndex + offset),
  );

  return {
    from,
    to,
    start: reportMonthStart(from),
    end: reportMonthStart(monthKeyFromIndex(toIndex + 1)),
    months,
  };
}
