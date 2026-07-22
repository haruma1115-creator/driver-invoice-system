const passwords = require('../lib/passwords');
const db = require('../lib/db');
const { requireDriver } = require('../lib/auth');
const { DEDUCTION_CATEGORIES, INCENTIVE_CATEGORIES, EXPENSE_CATEGORIES } = require('../lib/constants');
const { buildInvoicePreview } = require('../lib/calc');

function publicDriver(d) {
  if (!d) return null;
  const { password_hash, ...rest } = d;
  return rest;
}

function register(app) {
  const P = '/api/driver';

  // ---- 認証 ----

  app.post(`${P}/register`, async (req, res) => {
    const { email, password, name } = req.body || {};
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'メールアドレス・パスワード・氏名は必須です' });
    }
    const result = await db.update((data) => {
      if (data.drivers.some((d) => d.email === email)) {
        return { error: 'このメールアドレスは既に登録されています' };
      }
      const driver = {
        id: db.id(),
        email,
        password_hash: passwords.hash(password),
        name,
        name_kana: '',
        postal_code: '',
        address: '',
        phone: '',
        bank_name: '',
        bank_branch: '',
        bank_account_type: '普通',
        bank_account_number: '',
        bank_account_holder: '',
        is_qualified_invoice_issuer: false,
        invoice_registration_number: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      data.drivers.push(driver);
      return { driver };
    });
    if (result.error) return res.status(409).json({ error: result.error });
    req.session.driverId = result.driver.id;
    res.json({ driver: publicDriver(result.driver) });
  });

  app.post(`${P}/login`, async (req, res) => {
    const { email, password } = req.body || {};
    const data = await db.load();
    const driver = data.drivers.find((d) => d.email === email);
    if (!driver || !passwords.verify(password || '', driver.password_hash)) {
      return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' });
    }
    req.session.driverId = driver.id;
    res.json({ driver: publicDriver(driver) });
  });

  app.post(`${P}/logout`, async (req, res) => {
    req.session = null;
    res.json({ ok: true });
  });

  app.get(`${P}/me`, requireDriver, async (req, res) => {
    const data = await db.load();
    const driver = data.drivers.find((d) => d.id === req.session.driverId);
    if (!driver) return res.status(404).json({ error: 'ドライバーが見つかりません' });
    res.json({ driver: publicDriver(driver) });
  });

  app.get(`${P}/categories`, requireDriver, async (req, res) => {
    res.json({ DEDUCTION_CATEGORIES, INCENTIVE_CATEGORIES, EXPENSE_CATEGORIES });
  });

  // ---- プロフィール ----

  app.put(`${P}/profile`, requireDriver, async (req, res) => {
    const allowed = [
      'name', 'name_kana', 'postal_code', 'address', 'phone',
      'bank_name', 'bank_branch', 'bank_account_type', 'bank_account_number', 'bank_account_holder',
      'is_qualified_invoice_issuer', 'invoice_registration_number'
    ];
    const result = await db.update((data) => {
      const driver = data.drivers.find((d) => d.id === req.session.driverId);
      if (!driver) return { error: 'ドライバーが見つかりません' };
      for (const key of allowed) {
        if (key in (req.body || {})) driver[key] = req.body[key];
      }
      driver.updated_at = new Date().toISOString();
      return { driver };
    });
    if (result.error) return res.status(404).json({ error: result.error });
    res.json({ driver: publicDriver(result.driver) });
  });

  // ---- 稼働実績(勤務日数・稼働単価) ----

  app.get(`${P}/work-entries`, requireDriver, async (req, res) => {
    const { period } = req.query;
    const data = await db.load();
    const entries = data.work_entries.filter(
      (w) => w.driver_id === req.session.driverId && (!period || w.period === period)
    );
    res.json({ entries });
  });

  app.post(`${P}/work-entries`, requireDriver, async (req, res) => {
    const {
      period, full_days, half_days, unit_price,
      other_work_unit_price, other_work_days, note
    } = req.body || {};
    if (!period || full_days == null || unit_price == null) {
      return res.status(400).json({ error: '対象月・全日勤務日数・日当は必須です' });
    }
    const result = await db.update((data) => {
      let entry = data.work_entries.find((w) => w.driver_id === req.session.driverId && w.period === period);
      if (entry) {
        entry.full_days = Number(full_days);
        entry.half_days = Number(half_days || 0);
        entry.unit_price = Number(unit_price);
        entry.other_work_unit_price = Number(other_work_unit_price || 0);
        entry.other_work_days = Number(other_work_days || 0);
        entry.note = note || '';
        entry.updated_at = new Date().toISOString();
      } else {
        entry = {
          id: db.id(),
          driver_id: req.session.driverId,
          period,
          full_days: Number(full_days),
          half_days: Number(half_days || 0),
          unit_price: Number(unit_price),
          other_work_unit_price: Number(other_work_unit_price || 0),
          other_work_days: Number(other_work_days || 0),
          note: note || '',
          status: 'submitted',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        data.work_entries.push(entry);
      }
      return { entry };
    });
    res.json({ entry: result.entry });
  });

  // ---- 控除項目(ドライバーからの申請) ----

  app.get(`${P}/deductions`, requireDriver, async (req, res) => {
    const { period } = req.query;
    const data = await db.load();
    const items = data.deduction_items.filter(
      (x) => x.driver_id === req.session.driverId && (!period || x.period === period)
    );
    res.json({ items });
  });

  app.post(`${P}/deductions`, requireDriver, async (req, res) => {
    const { period, category, amount, memo } = req.body || {};
    if (!period || !category || amount == null) {
      return res.status(400).json({ error: '対象月・項目・金額は必須です' });
    }
    if (!DEDUCTION_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: '不正な控除項目です' });
    }
    const item = {
      id: db.id(),
      driver_id: req.session.driverId,
      period,
      category,
      amount: Number(amount),
      memo: memo || '',
      source: 'driver',
      created_at: new Date().toISOString()
    };
    await db.update((data) => { data.deduction_items.push(item); });
    res.json({ item });
  });

  app.delete(`${P}/deductions/:id`, requireDriver, async (req, res) => {
    const result = await db.update((data) => {
      const idx = data.deduction_items.findIndex(
        (x) => x.id === req.params.id && x.driver_id === req.session.driverId && x.source === 'driver'
      );
      if (idx === -1) return { error: '対象が見つかりません' };
      data.deduction_items.splice(idx, 1);
      return { ok: true };
    });
    if (result.error) return res.status(404).json({ error: result.error });
    res.json({ ok: true });
  });

  // ---- 経費申請 ----

  app.get(`${P}/expenses`, requireDriver, async (req, res) => {
    const { period } = req.query;
    const data = await db.load();
    const items = data.expense_items.filter(
      (x) => x.driver_id === req.session.driverId && (!period || x.period === period)
    );
    res.json({ items });
  });

  app.post(`${P}/expenses`, requireDriver, async (req, res) => {
    const { period, category, amount, memo } = req.body || {};
    if (!period || !category || amount == null) {
      return res.status(400).json({ error: '対象月・項目・金額は必須です' });
    }
    if (!EXPENSE_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: '不正な経費項目です' });
    }
    const item = {
      id: db.id(),
      driver_id: req.session.driverId,
      period,
      category,
      amount: Number(amount),
      memo: memo || '',
      source: 'driver',
      created_at: new Date().toISOString()
    };
    await db.update((data) => { data.expense_items.push(item); });
    res.json({ item });
  });

  app.delete(`${P}/expenses/:id`, requireDriver, async (req, res) => {
    const result = await db.update((data) => {
      const idx = data.expense_items.findIndex(
        (x) => x.id === req.params.id && x.driver_id === req.session.driverId && x.source === 'driver'
      );
      if (idx === -1) return { error: '対象が見つかりません' };
      data.expense_items.splice(idx, 1);
      return { ok: true };
    });
    if (result.error) return res.status(404).json({ error: result.error });
    res.json({ ok: true });
  });

  // ---- インセンティブ(閲覧のみ。付与は管理側で行う) ----

  app.get(`${P}/incentives`, requireDriver, async (req, res) => {
    const { period } = req.query;
    const data = await db.load();
    const items = data.incentive_items.filter(
      (x) => x.driver_id === req.session.driverId && (!period || x.period === period)
    );
    res.json({ items });
  });

  // ---- 請求書 ----

  app.get(`${P}/invoices`, requireDriver, async (req, res) => {
    const data = await db.load();
    const invoices = data.invoices
      .filter((inv) => inv.driver_id === req.session.driverId)
      .sort((a, b) => (a.period < b.period ? 1 : -1));
    res.json({ invoices });
  });

  app.get(`${P}/invoices/:id`, requireDriver, async (req, res) => {
    const data = await db.load();
    const invoice = data.invoices.find((inv) => inv.id === req.params.id && inv.driver_id === req.session.driverId);
    if (!invoice) return res.status(404).json({ error: '請求書が見つかりません' });
    const lines = data.invoice_line_items.filter((l) => l.invoice_id === invoice.id);
    res.json({ invoice, lines });
  });

  // 現在の入力状況からのプレビュー(未確定・請求書発行前の見込み額)
  app.get(`${P}/preview`, requireDriver, async (req, res) => {
    const { period } = req.query;
    if (!period) return res.status(400).json({ error: '対象月が必要です' });
    const data = await db.load();
    try {
      const preview = buildInvoicePreview(data, req.session.driverId, period);
      res.json({ preview });
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });
}

module.exports = { register };
