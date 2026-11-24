---
title: Catalog, Crates & Automatic Stock Costing
description: Set up departments, bulk purchase packs, single-unit issuing, and automatic average stock valuation in Hosila IMS.
---

Hotel stores and central kitchens rarely buy and issue supplies in the same unit. You might purchase basmati rice in **50 kg bags** and issue in **kilograms**, or buy beer in **24-bottle crates** and issue in **single bottles**. Hosila IMS handles every conversion cleanly with zero rounding errors.

## Bulk Purchasing & Single-Unit Issuing

Every item in your catalog defines:

1. **Base Stocking Unit** (such as `KG`, `Litre`, `Piece`, or `Bottle`) — so balances never show confusing decimals like `0.33 crate`.
2. **Purchase &amp; Market Units** with exact pack sizes, for example:
   - `1 Bag` = `50 KG`
   - `1 Crate` = `24 Bottles`
   - `1 Carton` = `12 Pieces`
3. **Reorder Alerts** — automatically highlights Low Stock and Out-of-Stock items on the daily Store Overview so buyers never miss critical items.

## Automatic Average Stock Costing

Whenever a delivery arrives at a new market price, Hosila IMS recalculates the item&rsquo;s running average cost automatically:

```text
New Average Cost = (Current Stock Value + Newly Received Value) / (Current Quantity + Received Quantity)
```

Every department **Stock Collection** and **Weekly Stock Sheet** immediately reflects accurate cost of goods issued—eliminating manual spreadsheet formulas.

## Instant Catalog Search

Press `Ctrl + K` or type in the catalog search bar to find any item instantly by name, item code, department, store section, or local market nickname.
