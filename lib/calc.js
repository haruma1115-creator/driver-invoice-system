// 指定ドライバー・期間(YYYY-MM)の請求内容を集計する。
// 本システムでは消費税は加算せず、各項目の金額をそのまま合算・差引して支払金額を算出する。
function buildInvoicePreview(data, driverId, period) {
  const driverRecord = data.drivers.find((d) => d.id === driverId);
  if (!driverRecord) throw new Error('driver not found');
  // password_hash を含む生のドライバーレコードをAPIレスポンスに漏らさないよう除外する
  const { password_hash, ...driver } = driverRecord;

  const workEntry = data.work_entries.find((w) => w.driver_id === driverId && w.period === period) || null;
  // 稼働費・ガソリン代は「勤務日数」を共通で使用する
  const salesAmount = workEntry ? Math.round(workEntry.working_days * workEntry.unit_price) : 0;
  const gasolineUnitPrice = workEntry ? Number(workEntry.gasoline_unit_price || 0) : 0;
  const gasolineAmount = workEntry ? Math.round(workEntry.working_days * gasolineUnitPrice) : 0;

  // その他稼働だけは別途の出勤日数(other_work_days)を使用する
  const otherWorkUnitPrice = workEntry ? Number(workEntry.other_work_unit_price || 0) : 0;
  const otherWorkDays = workEntry ? Number(workEntry.other_work_days || 0) : 0;
  const otherWorkAmount = workEntry ? Math.round(otherWorkDays * otherWorkUnitPrice) : 0;

  const incentiveLines = data.incentive_items
    .filter((x) => x.driver_id === driverId && x.period === period)
    .map((x) => ({ id: x.id, category: x.category, amount: x.amount, memo: x.memo || '' }));
  const incentivesTotal = incentiveLines.reduce((s, x) => s + x.amount, 0);

  const expenseLines = data.expense_items
    .filter((x) => x.driver_id === driverId && x.period === period)
    .map((x) => ({ id: x.id, category: x.category, amount: x.amount, memo: x.memo || '', source: x.source }));
  const expensesTotal = expenseLines.reduce((s, x) => s + x.amount, 0);

  const deductionLines = data.deduction_items
    .filter((x) => x.driver_id === driverId && x.period === period)
    .map((x) => ({ id: x.id, category: x.category, amount: x.amount, memo: x.memo || '', source: x.source }));
  const deductionsTotal = deductionLines.reduce((s, x) => s + x.amount, 0);

  // ガソリン代・その他稼働は表示上「非課税加算」の区分として分けて集計する(消費税は一切加算しない)
  const nonTaxedAdditionsTotal = gasolineAmount + otherWorkAmount;

  const grossTotal = salesAmount + incentivesTotal + expensesTotal + nonTaxedAdditionsTotal;
  const netPayment = grossTotal - deductionsTotal;

  return {
    driver,
    period,
    workEntry,
    salesAmount,
    gasolineUnitPrice,
    gasolineAmount,
    otherWorkUnitPrice,
    otherWorkDays,
    otherWorkAmount,
    nonTaxedAdditionsTotal,
    incentiveLines,
    incentivesTotal,
    expenseLines,
    expensesTotal,
    deductionLines,
    deductionsTotal,
    grossTotal,
    netPayment
  };
}

module.exports = { buildInvoicePreview };
