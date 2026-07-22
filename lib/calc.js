// 指定ドライバー・期間(YYYY-MM)の請求内容を集計する。
// 本システムでは消費税は加算せず、各項目の金額をそのまま合算・差引して支払金額を算出する。
//
// 稼働費の計算方法(2026-07改訂):
//   全日勤務: 全日勤務日数 × 日当(ドライバーが入力する単価)
//   半日勤務: 半日勤務日数 × 半日固定単価(lib/constants.js の HALF_DAY_RATE)
//   その他稼働(自転車など): その他稼働日数 × その他稼働単価(ドライバーが別途入力)
//   ガソリン代は廃止(会社側で別途計算するため、本システムでは扱いません)
const { HALF_DAY_RATE } = require('./constants');

function buildInvoicePreview(data, driverId, period) {
  const driverRecord = data.drivers.find((d) => d.id === driverId);
  if (!driverRecord) throw new Error('driver not found');
  // password_hash を含む生のドライバーレコードをAPIレスポンスに漏らさないよう除外する
  const { password_hash, ...driver } = driverRecord;

  const workEntry = data.work_entries.find((w) => w.driver_id === driverId && w.period === period) || null;

  const unitPrice = workEntry ? Number(workEntry.unit_price || 0) : 0;
  // 旧データ(full_days未入力・working_daysのみ)との互換のため、full_daysが無ければworking_daysを全日勤務日数とみなす
  const fullDays = workEntry
    ? Number(workEntry.full_days != null ? workEntry.full_days : (workEntry.working_days || 0))
    : 0;
  const halfDays = workEntry ? Number(workEntry.half_days || 0) : 0;
  const fullDayAmount = Math.round(fullDays * unitPrice);
  const halfDayAmount = Math.round(halfDays * HALF_DAY_RATE);
  const salesAmount = fullDayAmount + halfDayAmount;

  // その他稼働(自転車など)は別途の出勤日数(other_work_days)と単価を使用する
  const otherWorkUnitPrice = workEntry ? Number(workEntry.other_work_unit_price || 0) : 0;
  const otherWorkDays = workEntry ? Number(workEntry.other_work_days || 0) : 0;
  const otherWorkAmount = Math.round(otherWorkDays * otherWorkUnitPrice);

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

  const grossTotal = salesAmount + otherWorkAmount + incentivesTotal + expensesTotal;
  const netPayment = grossTotal - deductionsTotal;

  return {
    driver,
    period,
    workEntry,
    unitPrice,
    fullDays,
    halfDays,
    fullDayAmount,
    halfDayAmount,
    salesAmount,
    otherWorkUnitPrice,
    otherWorkDays,
    otherWorkAmount,
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
