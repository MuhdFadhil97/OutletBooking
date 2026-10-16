/** Integer sen → "RM 49" / "RM 12.50" / "RM 1,188". */
export function formatRm(sen: number): string {
  const rm = sen / 100;
  return `RM ${rm.toLocaleString('en-MY', {
    minimumFractionDigits: Number.isInteger(rm) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Integer sen → "RM 99.00" (receipts and payment pages always show sen). */
export function formatRmFull(sen: number): string {
  return `RM ${(sen / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
