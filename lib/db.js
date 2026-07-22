// データストア(2モード対応)
//
// 1. 通常モード(既定): ローカルのJSONファイル(data/db.json)に保存。npm install不要でそのまま動く。
// 2. MongoDBモード: 環境変数 MONGODB_URI が設定されている場合、MongoDB Atlas等の永続データベースを使用する。
//    Render等の無料ホスティングはディスクが一時的(再起動でファイルが消える)なため、
//    データを消したくない本番運用ではこちらを使う。`npm install` で mongodb パッケージが必要。
//
// どちらのモードでも呼び出し側(routes/*.js)からは同じ非同期インターフェース
// (db.load() / db.update(fn) / db.id())で利用できるように統一している。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const MONGODB_URI = process.env.MONGODB_URI;

const DEFAULT_DATA = {
  drivers: [],
  admins: [],
  work_entries: [],
  deduction_items: [],
  expense_items: [],
  incentive_items: [],
  invoices: [],
  invoice_line_items: [],
  messages: [],
  company_settings: null,
  counters: { invoice: 0 }
};

function id() {
  return crypto.randomUUID();
}

function withDefaults(data) {
  for (const key of Object.keys(DEFAULT_DATA)) {
    if (!(key in data)) data[key] = JSON.parse(JSON.stringify(DEFAULT_DATA[key]));
  }
  return data;
}

// ---------- JSONファイルモード ----------

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2), 'utf8');
  }
}

function loadFromFile() {
  ensureFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  return withDefaults(JSON.parse(raw));
}

function saveToFile(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ---------- MongoDBモード ----------
// mongodb パッケージは MONGODB_URI が設定されているときだけ require する(遅延読み込み)。
// これにより、ローカルでJSONファイルモードのまま使う分には npm install が一切不要になる。

let mongoCollectionPromise = null;

async function getMongoCollection() {
  if (!mongoCollectionPromise) {
    mongoCollectionPromise = (async () => {
      const { MongoClient } = require('mongodb');
      const client = new MongoClient(MONGODB_URI);
      await client.connect();
      const database = client.db(); // 接続文字列に含まれるDB名を使用(例: .../driver_invoice_system)
      return database.collection('app_state');
    })();
  }
  return mongoCollectionPromise;
}

async function loadFromMongo() {
  const col = await getMongoCollection();
  let doc = await col.findOne({ _id: 'singleton' });
  if (!doc) {
    doc = { _id: 'singleton', ...JSON.parse(JSON.stringify(DEFAULT_DATA)) };
    await col.insertOne(doc);
  }
  const { _id, ...data } = doc;
  return withDefaults(data);
}

async function saveToMongo(data) {
  const col = await getMongoCollection();
  await col.replaceOne({ _id: 'singleton' }, { _id: 'singleton', ...data }, { upsert: true });
}

// ---------- 共通インターフェース ----------

async function load() {
  return MONGODB_URI ? loadFromMongo() : loadFromFile();
}

async function save(data) {
  return MONGODB_URI ? saveToMongo(data) : saveToFile(data);
}

// 読み込み→更新→保存を1つの処理として直列化して行うためのキュー。
// (同じプロセス内から同時に update が呼ばれても、読み込みと保存の間に別の更新が
//  割り込んで上書き事故が起きないようにするため)
let queue = Promise.resolve();

function update(fn) {
  const task = queue.then(async () => {
    const data = await load();
    const result = await fn(data);
    await save(data);
    return result;
  });
  // 1件のエラーでキュー全体が詰まらないようにしておく
  queue = task.then(() => {}, () => {});
  return task;
}

module.exports = { load, save, update, id, DATA_FILE, isMongoMode: !!MONGODB_URI };
