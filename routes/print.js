const db = require('../lib/db');
const { renderInvoiceHtml } = require('../lib/invoiceTemplate');

function register(app) {
  app.get('/print/invoice/:id', async (req, res) => {
    const data = await db.load();
    const invoice = data.invoices.find((i) => i.id === req.params.id);
    if (!invoice) return res.status(404).send('請求書が見つかりません');

    const isDriverOwner = req.session && req.session.driverId === invoice.driver_id;
    const isAdmin = req.session && req.session.adminId;
    if (!isDriverOwner && !isAdmin) {
      return res.status(401).send('この請求書を閲覧する権限がありません。ログインしてください。');
    }

    const driver = data.drivers.find((d) => d.id === invoice.driver_id);
    const lines = data.invoice_line_items.filter((l) => l.invoice_id === invoice.id);
    const company = data.company_settings || {};

    const html = renderInvoiceHtml({
      invoice,
      driver,
      company,
      salesLines: lines.filter((l) => l.section === 'sales'),
      incentiveLines: lines.filter((l) => l.section === 'incentive'),
      expenseLines: lines.filter((l) => l.section === 'expense'),
      deductionLines: lines.filter((l) => l.section === 'deduction'),
      otherWorkLines: lines.filter((l) => l.section === 'other_work')
    });
    res.html(html);
  });
}

module.exports = { register };
