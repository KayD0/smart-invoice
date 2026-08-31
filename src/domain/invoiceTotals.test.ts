import { describe, expect, it } from "vitest";
import { calculateInvoiceTotals, calculateLineAmounts } from "./invoiceTotals";

describe("calculateInvoiceTotals", () => {
  it("外税10%を入力額へ加算する", () => {
    expect(calculateInvoiceTotals([{ quantity: 1, unitPrice: 12_000, taxRate: 10, taxMode: "exclusive" }]))
      .toEqual({ subtotal: 12_000, tax8: 0, tax10: 1_200, total: 13_200 });
  });

  it("内税10%は入力額を合計として税額を逆算する", () => {
    expect(calculateInvoiceTotals([{ quantity: 1, unitPrice: 12_000, taxRate: 10, taxMode: "inclusive" }]))
      .toEqual({ subtotal: 10_910, tax8: 0, tax10: 1_090, total: 12_000 });
  });

  it("内税入力の明細を税抜表示用に分解する", () => {
    expect(calculateLineAmounts({ quantity: 1, unitPrice: 12_000, taxRate: 10, taxMode: "inclusive" }))
      .toEqual({ net: 10_910, tax: 1_090, gross: 12_000 });
  });

  it("内税8%を逆算する", () => {
    expect(calculateInvoiceTotals([{ quantity: 1, unitPrice: 10_800, taxRate: 8, taxMode: "inclusive" }]))
      .toEqual({ subtotal: 10_000, tax8: 800, tax10: 0, total: 10_800 });
  });

  it("内税・外税・非課税の混在を集計する", () => {
    expect(calculateInvoiceTotals([
      { quantity: 1, unitPrice: 11_000, taxRate: 10, taxMode: "inclusive" },
      { quantity: 2, unitPrice: 5_000, taxRate: 10, taxMode: "exclusive" },
      { quantity: 1, unitPrice: 3_000, taxRate: 0, taxMode: "inclusive" },
    ])).toEqual({ subtotal: 23_000, tax8: 0, tax10: 2_000, total: 25_000 });
  });

  it("旧データの税方式未設定は外税として扱う", () => {
    expect(calculateInvoiceTotals([{ quantity: 1, unitPrice: 1_000, taxRate: 10 }]).total).toBe(1_100);
  });
});
