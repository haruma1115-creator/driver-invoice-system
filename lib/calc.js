const { TAX_RATE } = require('./constants');

// 指定ドライバー・期間(YYYY-MM)の請求内容を集計する。
// 適格請求書の端数処理ルール(税率ごとに1回だけ端数処理する)に合わせ、
// 課税対象額(稼働費+インセンティブ+経費)を合算してから消費税額を1回だけ計算する。
// 端数処理は「切り捨て」を採用(必要に応じて変更してください)。
function buildInvoicePreview(data, driverId, period) {
  const driverRecord = data.drivers.find((d) => d.id === driverId);
  if (!driverRecord) throw new Error('driver not found');
  // password_hash を含む生のドライバーレコードをAPIレスポンスに漏らさないよう除外する
  const { password_hash, ...driver } = driverRecord;

  const workEntry = data.work_entries.find((w) => w.driver_id === driverId && w.period === period) || null;
  const salesAmount = workEntry ? Math.round(workEntry.working_days * workEntry.unit_price) : 0;
  // ガソリン代・その他稼働は「勤務日数 × 日額単価」で計算するが、消費税は加算せず金額をそのまま合計に反映する
  const gasolineUnitPrice = workEntry ? Number(workEntry.gasoline_unit_price || 0) : 0;
  const otherWorkUnitPrice = workEntry ? Number(workEntry.other_work_unit_price || 0) : 0;
  const gasolineAmount = workEntry ? Math.round(workEntry.working_days * gasolineUnitPrice) : 0;
  const otherWorkAmount = workEntry ? Math.round(workEntry.working_days * otherWorkUnitPrice) : 0;

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

  const taxableBase = salesAmount + incentivesTotal + expensesTotal;
  const taxAmount = Math.floor(taxableBase * TAX_RATE);
  const taxableTotal = taxableBase + taxAmount;
  // ガソリン代・その他稼働は非課税加算(税額計算に含めず、金額をそのまま合計に足す)
  const nonTaxedAdditionsTotal = gasolineAmount + otherWorkAmount;
  const netPayment = taxableTotal + nonTaxedAdditionsTotal - deductionsTotal;

  return {
    driver,
    period,
    workEntry,
    salesAmount,
    gasolineUnitPrice,
    otherWorkUnitPrice,
    gasolineAmount,
    otherWorkAmount,
    nonTaxedAdditionsTotal,
    incentiveLines,
    incentivesTotal,
    expenseLines,
    expensesTotal,
    deductionLines,
    deductionsTotal,
    taxableBase,
    taxRate: TAX_RATE,
    taxAmount,
    taxableTotal,
    netPayment
  };
}

module.exports = { buildInvoicePreview };
