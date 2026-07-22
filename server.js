const path = require('path');
const crypto = require('crypto');
const { createApp } = require('./lib/miniapp');
const { seed } = require('./lib/seed');
const db = require('./lib/db');
const driverRoutes = require('./routes/driver');
const adminRoutes = require('./routes/admin');
const printRoutes = require('./routes/print');

const PORT = process.env.PORT || 3000;
// セッション署名用の秘密鍵。本番運用する場合は環境変数 SESSION_SECRET を必ず設定してください。
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

async function main() {
  await seed();

  const app = createApp();
  app.useSession(SESSION_SECRET);

  driverRoutes.register(app);
  adminRoutes.register(app);
  printRoutes.register(app);

  app.useStatic(path.join(__dirname, 'public'));

  app.get('/', (req, res) => res.redirect('/driver/login.html'));

  app.listen(PORT, () => {
    console.log(`業務委託ドライバー請求書システム 起動: http://localhost:${PORT}`);
    console.log(`  ドライバー画面: http://localhost:${PORT}/driver/login.html`);
    console.log(`  管理画面      : http://localhost:${PORT}/admin/login.html`);
    console.log(`  データストア  : ${db.isMongoMode ? 'MongoDB (永続化あり)' : `JSONファイル (${db.DATA_FILE})`}`);
    if (!process.env.SESSION_SECRET) {
      console.log('  ※ SESSION_SECRET未設定のため、再起動するとログインが切れます。本番運用時は環境変数で固定してください。');
    }
  });
}

main().catch((err) => {
  console.error('起動に失敗しました:', err);
  process.exit(1);
});
