export type TaxRate = 0 | 8 | 10;
export type TaxMode = "exclusive" | "inclusive";

export type TaxableItem = {
  quantity: number;
  unitPrice: number;
  taxRate: TaxRate;
  taxMode?: TaxMode;
};

export type InvoiceTotals = {
  subtotal: number;
  tax8: number;
  tax10: number;
  total: number;
};

export function calculateLineAmounts(item: TaxableItem) {
  const enteredAmount = item.quantity * item.unitPrice;
  const rate = item.taxRate;
  const isInclusive = (item.taxMode ?? "exclusive") === "inclusive" && rate > 0;
  const tax = rate === 0
    ? 0
    : Math.floor(isInclusive ? enteredAmount * rate / (100 + rate) : enteredAmount * rate / 100);
  const net = isInclusive ? enteredAmount - tax : enteredAmount;
  const gross = isInclusive ? enteredAmount : enteredAmount + tax;
  return { net, tax, gross };
}

export function calculateInvoiceTotals(items: TaxableItem[]): InvoiceTotals {
  return items.reduce<InvoiceTotals>((result, item) => {
    const { net, tax, gross } = calculateLineAmounts(item);

    result.subtotal += net;
    result.total += gross;
    if (item.taxRate === 8) result.tax8 += tax;
    if (item.taxRate === 10) result.tax10 += tax;
    return result;
  }, { subtotal: 0, tax8: 0, tax10: 0, total: 0 });
}
