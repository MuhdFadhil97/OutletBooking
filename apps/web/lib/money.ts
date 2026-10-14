/** Integer sen → "RM 49" / "RM 12.50". */
export function formatRm(sen: number): string {
  const rm = sen / 100;
  return `RM ${Number.isInteger(rm) ? rm : rm.toFixed(2)}`;
}
