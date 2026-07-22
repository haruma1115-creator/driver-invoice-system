const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// 永続化ディスクを使う場合は環境変数 DATA_DIR で保存先を指定できる
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');

function hashPassword(pw) {
  return crypto.createHash('sha256').update(String(pw)).digest('hex');
}

const DEFAULT_DATA = {
  drivers: [
    '中村 愛藍', '小山 諒', '昆 翼', '菊池 航', '梅澤 海',
    '佐々木幸大', '田口けんご', '菊池 佑', '村上彰', '井面賢太',
    '及川真幸', '吉田 爽悦', '小綿 大斗', '畠山 克司', '粟野 匡喜',
    '坂本 章畝', '三田地 健太', '梅澤 航', '大堰 詞葉', '大堰 星哉',
    '田中 寛也'
  ],
  schedule: {},          // schedule[date][driver] = 'full' | 'half_am' | 'half_pm' | 'off'
  offRequests: [],       // { id, driver, date, note, ts }
  headcount: { default: 1, overrides: {} },
  driverOverrides: {},   // { [driver]: { weeklyFullCap, weeklyHalfCap, note } }
  driverPasswords: {},   // { [driver]: sha256ハッシュ }
  chatLog: []            // { id, role: 'admin'|'bot', text, ts }
};

function loadStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return { ...structuredClone(DEFAULT_DATA), ...raw };
  } catch (e) {
    return structuredClone(DEFAULT_DATA);
  }
}
function saveStore() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(DB, null, 2));
}

let DB = loadStore();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/driver'));
app.get('/driver', (req, res) => res.sendFile(path.join(__dirname, 'public', 'driver.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

/* ===================== 日付ユーティリティ ===================== */
function isoDate(d) { return d.toISOString().slice(0, 10); }
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}
function dow(dateStr) { return new Date(dateStr + 'T00:00:00Z').getUTCDay(); }
function pad(n) { return String(n).padStart(2, '0'); }
function lastDayOfMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

// 指定の年月(month: 1-12)について、表示・生成に使う「日曜始まり週」の範囲を返す
function monthRange(year, month) {
  const monthStart = `${year}-${pad(month)}-01`;
  const lastDate = lastDayOfMonth(year, month);
  const monthEnd = `${year}-${pad(month)}-${pad(lastDate)}`;
  const rangeStart = addDays(monthStart, -dow(monthStart));
  const rangeEnd = addDays(monthEnd, 6 - dow(monthEnd));
  return { monthStart, monthEnd, rangeStart, rangeEnd };
}
function datesBetween(start, end) {
  const arr = [];
  let d = start;
  while (d <= end) { arr.push(d); d = addDays(d, 1); }
  return arr;
}

function requiredHeadcount(date) {
  if (DB.headcount.overrides && date in DB.headcount.overrides) return DB.headcount.overrides[date];
  return DB.headcount.default || 0;
}

/* ===================== 自動シフト作成ロジック ===================== */
// ルール: 日曜〜土曜の週で、フル勤務5日+半日1日(=5.5日)を上限。週をまたいでも連続勤務は最大6日。
// driverOverrides でドライバーごとに上限を変更できる(チャット指示から反映)。
function generateForRange(rangeStart, rangeEnd) {
  const dates = datesBetween(rangeStart, rangeEnd);
  const drivers = DB.drivers;

  const offByDate = {}; // offByDate[date][driver] = 'full' | 'am' | 'pm'
  DB.offRequests.forEach(r => {
    if (r.date < rangeStart || r.date > rangeEnd) return;
    offByDate[r.date] = offByDate[r.date] || {};
    offByDate[r.date][r.driver] = r.type || 'full';
  });

  const consec = {}, weekFull = {}, weekHalf = {};
  drivers.forEach(d => { consec[d] = 0; weekFull[d] = 0; weekHalf[d] = 0; });

  const capOf = (d) => {
    const ov = DB.driverOverrides[d] || {};
    return {
      full: (typeof ov.weeklyFullCap === 'number') ? ov.weeklyFullCap : 5,
      half: (typeof ov.weeklyHalfCap === 'number') ? ov.weeklyHalfCap : 1
    };
  };

  const warnings = [];

  dates.forEach(date => {
    if (dow(date) === 0) { drivers.forEach(d => { weekFull[d] = 0; weekHalf[d] = 0; }); }
    const need = requiredHeadcount(date);
    DB.schedule[date] = DB.schedule[date] || {};

    const dayOff = (offByDate[date]) || {}; // driver -> 'full'|'am'|'pm'
    const forcedOff = drivers.filter(d => dayOff[d] === 'full');
    const pool = drivers.filter(d => dayOff[d] !== 'full');

    // そのドライバーがその日に取り得る勤務形態(希望休の午前/午後指定・週の上限を考慮)
    function assignmentFor(d) {
      const cap = capOf(d);
      const restriction = dayOff[d]; // undefined | 'am' | 'pm'
      if (restriction === 'am') { // 午前休希望 → 午後(C2)のみ可
        return (weekHalf[d] < cap.half) ? { type: 'half_pm', units: 0.5 } : null;
      }
      if (restriction === 'pm') { // 午後休希望 → 午前(C1)のみ可
        return (weekHalf[d] < cap.half) ? { type: 'half_am', units: 0.5 } : null;
      }
      if (weekFull[d] < cap.full) return { type: 'full', units: 1 };
      if (weekHalf[d] < cap.half) return { type: 'half_am', units: 0.5 };
      return null;
    }

    const candidates = pool.filter(d => consec[d] < 6 && assignmentFor(d) !== null);
    candidates.sort((a, b) => (weekFull[a] + weekHalf[a] * 0.5) - (weekFull[b] + weekHalf[b] * 0.5));

    // 半日(C1/C2)は0.5人・全日は1人として、必要人数(need)に達するまで順番に選ぶ
    const selectedType = {};
    let covered = 0;
    for (const d of candidates) {
      if (covered >= need) break;
      const a = assignmentFor(d);
      selectedType[d] = a.type;
      covered += a.units;
    }
    if (covered < need) {
      warnings.push(`${date}(${'日月火水木金土'[dow(date)]}) 必要人数${need}名に対し出勤可能${covered}名分`);
    }

    drivers.forEach(d => {
      if (forcedOff.includes(d)) {
        DB.schedule[date][d] = 'off'; consec[d] = 0;
      } else if (selectedType[d]) {
        DB.schedule[date][d] = selectedType[d];
        if (selectedType[d] === 'full') weekFull[d]++; else weekHalf[d]++;
        consec[d]++;
      } else {
        DB.schedule[date][d] = 'off'; consec[d] = 0;
      }
    });
  });

  return warnings;
}

/* ===================== ドライバー ===================== */
app.get('/api/drivers', (req, res) => res.json(DB.drivers));

app.post('/api/drivers', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!DB.drivers.includes(name)) DB.drivers.push(name);
  saveStore();
  res.json(DB.drivers);
});

app.delete('/api/drivers/:name', (req, res) => {
  DB.drivers = DB.drivers.filter(d => d !== req.params.name);
  delete DB.driverOverrides[req.params.name];
  delete DB.driverPasswords[req.params.name];
  saveStore();
  res.json(DB.drivers);
});

/* ===================== ドライバーのパスワード・ログイン ===================== */
app.post('/api/drivers/:name/password', (req, res) => {
  const name = req.params.name;
  const password = (req.body.password || '').toString();
  if (!DB.drivers.includes(name)) return res.status(404).json({ error: 'driver not found' });
  if (!password) return res.status(400).json({ error: 'password required' });
  DB.driverPasswords[name] = hashPassword(password);
  saveStore();
  res.json({ ok: true });
});

// どのドライバーにパスワードが設定済みかどうか(パスワード自体は返さない)
app.get('/api/driver-password-status', (req, res) => {
  const status = {};
  DB.drivers.forEach(d => { status[d] = !!DB.driverPasswords[d]; });
  res.json(status);
});

app.post('/api/driver-login', (req, res) => {
  const name = (req.body.name || '').toString();
  const password = (req.body.password || '').toString();
  if (!DB.drivers.includes(name)) return res.status(401).json({ error: 'ドライバーが見つかりません' });
  const hash = DB.driverPasswords[name];
  if (!hash) return res.status(401).json({ error: 'このドライバーはまだパスワードが設定されていません。管理者に設定を依頼してください。' });
  if (hashPassword(password) !== hash) return res.status(401).json({ error: 'パスワードが違います' });
  res.json({ ok: true, name });
});

/* ===================== シフト表 ===================== */
app.get('/api/schedule', (req, res) => {
  const year = parseInt(req.query.year), month = parseInt(req.query.month);
  if (!year || !month) return res.status(400).json({ error: 'year, month required' });
  const { monthStart, monthEnd, rangeStart, rangeEnd } = monthRange(year, month);
  const dates = datesBetween(rangeStart, rangeEnd);

  const offRequestMap = {};
  DB.offRequests.forEach(r => {
    offRequestMap[r.date] = offRequestMap[r.date] || {};
    offRequestMap[r.date][r.driver] = true;
  });

  const requiredHeadcountMap = {};
  dates.forEach(d => { requiredHeadcountMap[d] = requiredHeadcount(d); });

  res.json({
    monthStart, monthEnd, rangeStart, rangeEnd, dates,
    drivers: DB.drivers,
    schedule: DB.schedule,
    offRequestMap,
    requiredHeadcount: requiredHeadcountMap
  });
});

app.post('/api/schedule/cell', (req, res) => {
  const { date, driver, status } = req.body;
  if (!date || !driver || !status) return res.status(400).json({ error: 'invalid' });
  DB.schedule[date] = DB.schedule[date] || {};
  DB.schedule[date][driver] = status;
  saveStore();
  res.json({ ok: true });
});

app.post('/api/generate', (req, res) => {
  const year = parseInt(req.body.year), month = parseInt(req.body.month);
  if (!year || !month) return res.status(400).json({ error: 'year, month required' });
  const { rangeStart, rangeEnd } = monthRange(year, month);
  const warnings = generateForRange(rangeStart, rangeEnd);
  saveStore();
  res.json({ warnings });
});

/* ===================== 希望休 ===================== */
app.get('/api/offrequests', (req, res) => res.json(DB.offRequests));

app.post('/api/offrequests', (req, res) => {
  const { driver, requests, note } = req.body;
  if (!driver || !Array.isArray(requests) || requests.length === 0) return res.status(400).json({ error: 'invalid' });
  const created = requests.map(item => ({
    id: Date.now() + Math.random(),
    driver,
    date: item.date,
    type: (item.type === 'am' || item.type === 'pm') ? item.type : 'full',
    note: note || '',
    ts: new Date().toISOString()
  }));
  DB.offRequests.push(...created);
  saveStore();
  res.json(DB.offRequests);
});

app.delete('/api/offrequests/:id', (req, res) => {
  DB.offRequests = DB.offRequests.filter(r => String(r.id) !== req.params.id);
  saveStore();
  res.json(DB.offRequests);
});

/* ===================== 必要人数設定 ===================== */
app.get('/api/headcount', (req, res) => res.json(DB.headcount));

app.post('/api/headcount', (req, res) => {
  if (typeof req.body.default === 'number') DB.headcount.default = req.body.default;
  DB.headcount.overrides = DB.headcount.overrides || {};
  if (req.body.overrideDate && typeof req.body.overrideCount === 'number') {
    DB.headcount.overrides[req.body.overrideDate] = req.body.overrideCount;
  }
  if (req.body.deleteOverrideDate) {
    delete DB.headcount.overrides[req.body.deleteOverrideDate];
  }
  saveStore();
  res.json(DB.headcount);
});

/* ===================== チャットで指示出し ===================== */
app.get('/api/chat', (req, res) => res.json(DB.chatLog));

app.post('/api/chat', async (req, res) => {
  const message = (req.body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'empty message' });

  DB.chatLog.push({ id: Date.now() + Math.random(), role: 'admin', text: message, ts: new Date().toISOString() });

  let reply;
  try {
    reply = await parseInstruction(message);
  } catch (e) {
    console.error('chat parse error', e);
    reply = '指示の解析中にエラーが発生しました。もう少しシンプルな言い方で送ってみてください。';
  }

  DB.chatLog.push({ id: Date.now() + Math.random(), role: 'bot', text: reply, ts: new Date().toISOString() });
  saveStore();
  res.json({ reply });
});

async function parseInstruction(message) {
  const driver = DB.drivers.find(d => message.includes(d));
  if (!driver) {
    return `どのドライバーさんへの指示か分かりませんでした。登録されている名前(${DB.drivers.join('、') || 'まだ登録なし'})を含めて送ってください。`;
  }

  // ANTHROPIC_API_KEY が設定されていれば、AIによる柔軟な解釈を試みる
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const parsed = await callClaudeForInstruction(message, DB.drivers);
      if (parsed && parsed.driver && DB.drivers.includes(parsed.driver)) {
        DB.driverOverrides[parsed.driver] = DB.driverOverrides[parsed.driver] || {};
        if (typeof parsed.weeklyFullCap === 'number') DB.driverOverrides[parsed.driver].weeklyFullCap = parsed.weeklyFullCap;
        if (typeof parsed.weeklyHalfCap === 'number') DB.driverOverrides[parsed.driver].weeklyHalfCap = parsed.weeklyHalfCap;
        DB.driverOverrides[parsed.driver].note = message;
        return (parsed.summary || `${parsed.driver}さんの設定を更新しました。`) + '(次回の「自動シフト作成」から反映されます)';
      }
    } catch (e) {
      console.error('claude call failed, falling back to keyword parser', e);
    }
  }

  // フォールバック: 簡易キーワード解析(「週3日」のような表現から上限日数を抽出)
  const m = message.match(/週\s*(\d)\s*日/);
  if (m) {
    const n = Math.max(0, Math.min(5, parseInt(m[1])));
    DB.driverOverrides[driver] = DB.driverOverrides[driver] || {};
    DB.driverOverrides[driver].weeklyFullCap = n;
    DB.driverOverrides[driver].weeklyHalfCap = n >= 5 ? 1 : 0;
    DB.driverOverrides[driver].note = message;
    return `${driver}さんの週の勤務日数上限を${n}日に設定しました。次回の「自動シフト作成」から反映されます。`;
  }

  // それ以外は備考として保存するのみ(自動反映はされない)
  DB.driverOverrides[driver] = DB.driverOverrides[driver] || {};
  DB.driverOverrides[driver].note = message;
  return `${driver}さんへの備考として保存しました。「週◯日」のような具体的な条件が含まれていなかったため、自動反映はされていません。手動でシフト表をご確認ください。`;
}

async function callClaudeForInstruction(message, drivers) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: `あなたはシフト管理アシスタントです。管理者からの日本語の指示を読み取り、対象ドライバー名・週あたりの勤務日数上限(weeklyFullCap: 0〜5の整数)・半日勤務上限(weeklyHalfCap: 0か1)を抽出してください。値が指示から読み取れない項目はnullにしてください。ドライバー一覧: ${drivers.join('、')}。出力は次のJSON形式のみとし、それ以外の文字は一切含めないでください: {"driver":"名前","weeklyFullCap":数値かnull,"weeklyHalfCap":数値かnull,"summary":"日本語での一言まとめ"}`,
      messages: [{ role: 'user', content: message }]
    })
  });
  const data = await r.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  return JSON.parse(jsonMatch[0]);
}

app.listen(PORT, () => {
  console.log(`シフト自動作成システム起動中: http://localhost:${PORT}`);
  console.log(`ドライバー用: http://localhost:${PORT}/driver`);
  console.log(`管理者用: http://localhost:${PORT}/admin`);
});
