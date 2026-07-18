// 請求書の印刷用HTMLを生成する(依存パッケージなし)。
// このシステムでは消費税を加算せず、各項目の金額をそのまま請求する運用のため、
// 税率・税額の表示は行わない(適格請求書としての消費税額表示要件は満たさない点に注意)。
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function yen(n) {
  return (n || 0).toLocaleString('ja-JP');
}

function renderInvoiceHtml({ invoice, driver, company, salesLines, incentiveLines, expenseLines, deductionLines, nonTaxedAdditionLines = [] }) {
  const isQualified = !!driver.is_qualified_invoice_issuer;

  const itemRows = [
    ...salesLines.map((l) => ({ label: '稼働費', l })),
    ...nonTaxedAdditionLines.map((l) => ({ label: l.category, l })),
    ...incentiveLines.map((l) => ({ label: 'インセンティブ', l })),
    ...expenseLines.map((l) => ({ label: '経費', l }))
  ];

  const itemRowsHtml = itemRows.length
    ? itemRows.map(({ label, l }) => `
      <tr>
        <td>${esc(label)}</td>
        <td>${esc(l.category)}${l.description && l.description !== l.category ? '(' + esc(l.description) + ')' : ''}</td>
        <td class="num">${esc(l.quantity)}</td>
        <td class="num">¥${yen(l.unit_price)}</td>
        <td class="num">¥${yen(l.amount)}</td>
      </tr>`).join('')
    : `<tr><td colspan="5" style="text-align:center;color:#888;">請求項目はありません</td></tr>`;

  const deductionSection = deductionLines.length ? `
    <div class="section-title">控除項目(内部精算)</div>
    <table>
      <thead><tr><th>項目</th><th>内容</th><th class="num">金額</th></tr></thead>
      <tbody>
        ${deductionLines.map((l) => `
          <tr><td>${esc(l.category)}</td><td>${l.description && l.description !== l.category ? esc(l.description) : ''}</td><td class="num">−¥${yen(l.amount)}</td></tr>
        `).join('')}
      </tbody>
    </table>
    <table class="totals">
      <tr><td>控除合計</td><td class="num">−¥${yen(invoice.deductions_total)}</td></tr>
    </table>` : '';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${esc(invoice.invoice_number)} - 請求書</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif;
    color: #1a1a1a;
    max-width: 800px;
    margin: 0 auto;
    padding: 32px;
    background: #fff;
  }
  .no-print { text-align: right; margin-bottom: 16px; }
  .no-print button {
    padding: 8px 20px; font-size: 14px; cursor: pointer;
    background: #2b6cb0; color: #fff; border: none; border-radius: 4px;
  }
  h1.doc-title { text-align: center; font-size: 26px; letter-spacing: 0.3em; margin: 0 0 24px; }
  .top-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
  .to-block { font-size: 16px; }
  .to-block .company { font-size: 20px; font-weight: bold; border-bottom: 2px solid #1a1a1a; padding-bottom: 4px; display: inline-block; }
  .meta-block { text-align: right; font-size: 13px; line-height: 1.8; }
  .issuer-block { text-align: right; font-size: 13px; line-height: 1.7; margin-bottom: 20px; }
  .issuer-block .name { font-size: 15px; font-weight: bold; }
  .amount-banner {
    background: #f4f7fb; border: 1px solid #cbd5e0; border-radius: 6px;
    padding: 14px 20px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: baseline;
  }
  .amount-banner .label { font-size: 15px; }
  .amount-banner .value { font-size: 26px; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 13px; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; }
  th { background: #eef2f7; text-align: left; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .section-title { font-weight: bold; font-size: 14px; margin: 18px 0 6px; }
  .totals { width: 320px; margin-left: auto; font-size: 13px; }
  .totals td { border: none; padding: 3px 4px; }
  .totals tr.grand td { border-top: 2px solid #1a1a1a; font-weight: bold; font-size: 15px; }
  .note { font-size: 11px; color: #555; margin-top: 20px; line-height: 1.7; border-top: 1px solid #ddd; padding-top: 10px; }
  .bank-block { font-size: 13px; margin-top: 16px; }
  .badge { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 10px; margin-left: 8px; }
  .badge.qualified { background: #e6fffa; color: #234e52; border: 1px solid #38b2ac; }
  .badge.unqualified { background: #fff5f5; color: #742a2a; border: 1px solid #fc8181; }
  @media print {
    .no-print { display: none; }
    body { padding: 0; }
  }
</style>
</head>
<body>
  <div class="no-print"><button onclick="window.print()">この画面を印刷 / PDF保存</button></div>

  <h1 class="doc-title">請求書</h1>

  <div class="top-row">
    <div class="to-block">
      <span class="company">${esc(company.company_name)}</span> 御中
    </div>
    <div class="meta-block">
      請求書番号: ${esc(invoice.invoice_number)}<br>
      発行日: ${esc(invoice.issue_date)}<br>
      対象月: ${esc(invoice.period)}
    </div>
  </div>

  <div class="issuer-block">
    <div class="name">${esc(driver.name)}</div>
    <div>${driver.postal_code ? '〒' + esc(driver.postal_code) : ''} ${esc(driver.address)}</div>
    <div>${esc(driver.phone)}</div>
    ${isQualified
      ? `<div>登録番号: ${esc(driver.invoice_registration_number)} <span class="badge qualified">適格請求書発行事業者</span></div>`
      : ''}
  </div>

  <div class="amount-banner">
    <span class="label">ご請求金額(お支払金額)</span>
    <span class="value">¥${yen(invoice.net_payment)}</span>
  </div>

  <div class="section-title">請求項目</div>
  <table>
    <thead>
      <tr><th>区分</th><th>内容</th><th class="num">数量</th><th class="num">単価</th><th class="num">金額</th></tr>
    </thead>
    <tbody>
      ${itemRowsHtml}
    </tbody>
  </table>

  <table class="totals">
    <tr><td>請求項目合計</td><td class="num">¥${yen(invoice.gross_total)}</td></tr>
  </table>

  ${deductionSection}

  <table class="totals">
    <tr class="grand"><td>お支払金額</td><td class="num">¥${yen(invoice.net_payment)}</td></tr>
  </table>

  <div class="bank-block">
    <strong>お振込先</strong><br>
    ${esc(driver.bank_name)} ${esc(driver.bank_branch)} ${esc(driver.bank_account_type)} ${esc(driver.bank_account_number)}<br>
    口座名義: ${esc(driver.bank_account_holder)}
  </div>

  <div class="note">
    ※ 本請求書は消費税を加算せず、各項目の金額をそのまま合算して請求しています。<br>
    ※ 控除項目(車両代・事務手数料・車両修繕代・前借り分返済)は内部精算項目として、合計から差し引いています。<br>
    ※ 消費税の取り扱い(課税・非課税・免税事業者の経過措置等)については、実際の運用に応じて税理士にご確認ください。<br>
  </div>
</body>
</html>`;
}

module.exports = { renderInvoiceHtml };
