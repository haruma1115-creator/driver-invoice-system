const passwords = require('../lib/passwords');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { DEDUCTION_CATEGORIES, INCENTIVE_CATEGORIES, EXPENSE_CATEGORIES } = require('../lib/constants');
const { buildInvoicePreview } = require('../lib/calc');

function publicDriver(d) {
  if (!d) return null;
  const { password_hash, ...rest } = d;
  return rest;
}

function replaceItemsForPeriod(collectionName, allowedCategories) {
  return async (req, res) => {
    const { id: driverId } = req.params;
    const { period, items } = req.body || {};
    if (!period || !Array.isArray(items)) {
      return res.status(400).json({ error: '対象月と項目一覧は必須です' });
    }
    for (const it of items) {
      if (!allowedCategories.includes(it.category)) {
        return res.status(400).json({ error: `不正な項目です: ${it.category}` });
      }
      if (it.amount == null || isNaN(Number(it.amount))) {
        return res.status(400).json({ error: '金額を数値で入力してください' });
      }
    }
    const result = await db.update((data) => {
      const driver = data.drivers.find((d) => d.id === driverId);
      if (!driver) return { error: 'ドライバーが見つかりません' };
      data[collectionName] = data[collectionName].filter((x) => !(x.driver_id === driverId && x.period === period));
      const created = items.map((it) => ({
        id: db.id(),
        driver_id: driverId,
        period,
        category: it.category,
        amount: Number(it.amount),
        memo: it.memo || '',
        source: 'admin',
        created_at: new Date().toISOString()
      }));
      data[collectionName].push(...created);
      return { items: created };
    });
    if (result.error) return res.status(404).json({ error: result.error });
    res.json(result);
  };
}

function register(app) {
  const P = '/api/admin';

  // ---- 認証 ----

  app.post(`${P}/login`, async (req, res) => {
    const { email, password } = req.body || {};
    const data = await db.load();
    const admin = data.admins.find((a) => a.email === email);
    if (!admin || !passwords.verify(password || '', admin.password_hash)) {
      return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' });
    }
    req.session.adminId = admin.id;
    res.json({ admin: { id: admin.id, email: admin.email, name: admin.name } });
  });

  app.post(`${P}/logout`, async (req, res) => {
    req.session = null;
    res.json({ ok: true });
  });

  app.get(`${P}/me`, requireAdmin, async (req, res) => {
    const data = await db.load();
    const admin = data.admins.find((a) => a.id === req.session.adminId);
    if (!admin) return res.status(404).json({ error: '管理者が見つかりません' });
    res.json({ admin: { id: admin.id, email: admin.email, name: admin.name } });
  });

  app.get(`${P}/categories`, requireAdmin, async (req, res) => {
    res.json({ DEDUCTION_CATEGORIES, INCENTIVE_CATEGORIES, EXPENSE_CATEGORIES });
  });

  // ---- 会社情報 ----

  app.get(`${P}/company-settings`, requireAdmin, async (req, res) => {
    const data = await db.load();
    res.json({ company: data.company_settings });
  });

  app.put(`${P}/company-settings`, requireAdmin, async (req, res) => {
    const allowed = ['company_name', 'postal_code', 'address', 'phone', 'representative_name', 'invoice_registration_number'];
    const result = await db.update((data) => {
      if (!data.company_settings) data.company_settings = {};
      for (const key of allowed) {
        if (key in (req.body || {})) data.company_settings[key] = req.body[key];
      }
      return { company: data.company_settings };
    });
    res.json(result);
  });

  // ---- ドライバー一覧・詳細 ----

  app.get(`${P}/drivers`, requireAdmin, async (req, res) => {
    const { period } = req.query;
    const data = await db.load();
    const drivers = data.drivers.map((d) => {
      const workEntry = period ? data.work_entries.find((w) => w.driver_id === d.id && w.period === period) : null;
      const invoice = period ? data.invoices.find((i) => i.driver_id === d.id && i.period === period) : null;
      return {
        ...publicDriver(d),
        sales_amount: workEntry ? Math.round(workEntry.working_days * workEntry.unit_price) : null,
        work_entry_status: workEntry ? workEntry.status : null,
        invoice_status: invoice ? invoice.status : null,
        invoice_id: invoice ? invoice.id : null
      };
    });
    res.json({ drivers });
  });

  app.get(`${P}/drivers/:id`, requireAdmin, async (req, res) => {
    const data = await db.load();
    const driver = data.drivers.find((d) => d.id === req.params.id);
    if (!driver) return res.status(404).json({ error: 'ドライバーが見つかりません' });
    const { period } = req.query;
    let preview = null;
    if (period) {
      try {
        preview = buildInvoicePreview(data, driver.id, period);
      } catch (e) {
        preview = null;
      }
    }
    const invoices = data.invoices.filter((i) => i.driver_id === driver.id).sort((a, b) => (a.period < b.period ? 1 : -1));
    res.json({ driver: publicDriver(driver), preview, invoices });
  });

  app.put(`${P}/drivers/:id/deductions`, requireAdmin, replaceItemsForPeriod('deduction_items', DEDUCTION_CATEGORIES));
  app.put(`${P}/drivers/:id/incentives`, requireAdmin, replaceItemsForPeriod('incentive_items', INCENTIVE_CATEGORIES));
  app.put(`${P}/drivers/:id/expenses`, requireAdmin, replaceItemsForPeriod('expense_items', EXPENSE_CATEGORIES));

  // ---- 請求書生成 ----

  app.post(`${P}/drivers/:id/invoices`, requireAdmin, async (req, res) => {
    const { period } = req.body || {};
    if (!period) return res.status(400).json({ error: '対象月は必須です' });

    const result = await db.update((data) => {
      const driver = data.drivers.find((d) => d.id === req.params.id);
      if (!driver) return { error: 'ドライバーが見つかりません' };

      const preview = buildInvoicePreview(data, driver.id, period);
      if (!preview.workEntry) {
        return { error: 'このドライバーはこの月の稼働実績(勤務日数・稼働単価)が未入力です' };
      }

      data.counters.invoice += 1;
      const invoiceNumber = `INV-${period}-${String(data.counters.invoice).padStart(4, '0')}`;

      let existing = data.invoices.find((i) => i.driver_id === driver.id && i.period === period);
      if (existing) {
        data.invoice_line_items = data.invoice_line_items.filter((l) => l.invoice_id !== existing.id);
      }

      const invoice = existing || {
        id: db.id(),
        driver_id: driver.id,
        period,
        invoice_number: invoiceNumber,
        created_at: new Date().toISOString()
      };
      invoice.issue_date = new Date().toISOString().slice(0, 10);
      invoice.sales_amount = preview.salesAmount;
      invoice.gasoline_amount = preview.gasolineAmount;
      invoice.other_work_amount = preview.otherWorkAmount;
      invoice.non_taxed_additions_total = preview.nonTaxedAdditionsTotal;
      invoice.incentives_total = preview.incentivesTotal;
      invoice.expenses_total = preview.expensesTotal;
      invoice.deductions_total = preview.deductionsTotal;
      invoice.taxable_base = preview.taxableBase;
      invoice.tax_rate = preview.taxRate;
      invoice.tax_amount = preview.taxAmount;
      invoice.taxable_total = preview.taxableTotal;
      invoice.net_payment = preview.netPayment;
      invoice.status = existing ? existing.status : 'issued';
      invoice.updated_at = new Date().toISOString();

      if (!existing) data.invoices.push(invoice);

      const lineItems = [];
      if (preview.workEntry) {
        lineItems.push({
          id: db.id(),
          invoice_id: invoice.id,
          section: 'sales',
          category: '稼働費',
          description: `稼働 ${preview.workEntry.working_days}日 × 単価 ${preview.workEntry.unit_price.toLocaleString()}円`,
          quantity: preview.workEntry.working_days,
          unit_price: preview.workEntry.unit_price,
          amount: preview.salesAmount,
          taxable: true
        });
        if (preview.gasolineAmount > 0) {
          lineItems.push({
            id: db.id(),
            invoice_id: invoice.id,
            section: 'non_taxed_addition',
            category: 'ガソリン代',
            description: `稼働 ${preview.workEntry.working_days}日 × 日額 ${preview.gasolineUnitPrice.toLocaleString()}円`,
            quantity: preview.workEntry.working_days,
            unit_price: preview.gasolineUnitPrice,
            amount: preview.gasolineAmount,
            taxable: false
          });
        }
        if (preview.otherWorkAmount > 0) {
          lineItems.push({
            id: db.id(),
            invoice_id: invoice.id,
            section: 'non_taxed_addition',
            category: 'その他稼働',
            description: `稼働 ${preview.workEntry.working_days}日 × 日額 ${preview.otherWorkUnitPrice.toLocaleString()}円`,
            quantity: preview.workEntry.working_days,
            unit_price: preview.otherWorkUnitPrice,
            amount: preview.otherWorkAmount,
            taxable: false
          });
        }
      }
      for (const li of preview.incentiveLines) {
        lineItems.push({
          id: db.id(), invoice_id: invoice.id, section: 'incentive', category: li.category,
          description: li.memo || li.category, quantity: 1, unit_price: li.amount, amount: li.amount, taxable: true
        });
      }
      for (const li of preview.expenseLines) {
        lineItems.push({
          id: db.id(), invoice_id: invoice.id, section: 'expense', category: li.category,
          description: li.memo || li.category, quantity: 1, unit_price: li.amount, amount: li.amount, taxable: true
        });
      }
      for (const li of preview.deductionLines) {
        lineItems.push({
          id: db.id(), invoice_id: invoice.id, section: 'deduction', category: li.category,
          description: li.memo || li.category, quantity: 1, unit_price: li.amount, amount: li.amount, taxable: false
        });
      }
      data.invoice_line_items.push(...lineItems);

      const workEntry = data.work_entries.find((w) => w.driver_id === driver.id && w.period === period);
      if (workEntry) workEntry.status = 'invoiced';

      return { invoice, lineItems };
    });

    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  });

  app.get(`${P}/invoices`, requireAdmin, async (req, res) => {
    const { period } = req.query;
    const data = await db.load();
    let invoices = data.invoices;
    if (period) invoices = invoices.filter((i) => i.period === period);
    invoices = invoices.map((inv) => {
      const driver = data.drivers.find((d) => d.id === inv.driver_id);
      return { ...inv, driver_name: driver ? driver.name : '(不明)' };
    });
    res.json({ invoices });
  });

  app.get(`${P}/invoices/:id`, requireAdmin, async (req, res) => {
    const data = await db.load();
    const invoice = data.invoices.find((i) => i.id === req.params.id);
    if (!invoice) return res.status(404).json({ error: '請求書が見つかりません' });
    const lines = data.invoice_line_items.filter((l) => l.invoice_id === invoice.id);
    res.json({ invoice, lines });
  });

  app.put(`${P}/invoices/:id/status`, requireAdmin, async (req, res) => {
    const { status } = req.body || {};
    if (!['issued', 'sent'].includes(status)) return res.status(400).json({ error: '不正なステータスです' });
    const result = await db.update((data) => {
      const invoice = data.invoices.find((i) => i.id === req.params.id);
      if (!invoice) return { error: '請求書が見つかりません' };
      invoice.status = status;
      invoice.updated_at = new Date().toISOString();
      return { invoice };
    });
    if (result.error) return res.status(404).json({ error: result.error });
    res.json(result);
  });
}

module.exports = { register };
