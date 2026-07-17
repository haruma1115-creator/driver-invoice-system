// 初期データ投入スクリプト。サーバー起動時に自動実行されます(`node lib/seed.js` で単独実行も可能)。
const passwords = require('./passwords');
const db = require('./db');

async function seed() {
  await db.update((data) => {
    if (data.admins.length === 0) {
      data.admins.push({
        id: db.id(),
        email: 'admin@example.com',
        password_hash: passwords.hash('admin1234'),
        name: '管理者',
        created_at: new Date().toISOString()
      });
      console.log('[seed] 管理者アカウントを作成しました: admin@example.com / admin1234');
    }
    if (!data.company_settings) {
      data.company_settings = {
        company_name: '株式会社エースナンバー',
        postal_code: '100-0001',
        address: '東京都千代田区千代田1-1-1',
        phone: '03-0000-0000',
        representative_name: '代表取締役',
        invoice_registration_number: ''
      };
      console.log('[seed] 会社情報の初期値を作成しました(管理画面から編集してください)');
    }
  });
}

if (require.main === module) {
  seed().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { seed };
