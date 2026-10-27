const idrFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat('id-ID');

/** Formats rupiah for the top-up UI, e.g. 50000 -> "Rp50.000". */
export function formatIdr(amount: number): string {
  return idrFormatter.format(amount);
}

/** Formats a credit amount, e.g. 5 -> "5 Kredit". */
export function formatCredits(credits: number): string {
  return `${numberFormatter.format(credits)} Kredit`;
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

/** Formats an ISO timestamp in the Asia/Jakarta timezone for UI display. */
export function formatDateTimeId(iso: string, timeZone = 'Asia/Jakarta'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(date);
}

export function formatPercent(value: number, fractionDigits = 0): string {
  return `${value.toFixed(fractionDigits)}%`;
}
