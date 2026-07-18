// 請求書メール送信(依存パッケージ nodemailer を使用)。
// ローカルでこの機能を使わない限り nodemailer は読み込まれないため、npm install は不要のまま。
// クラウド(Render等)でメール送信機能を使う場合のみ、Build Commandで npm install を実行してください。
async function sendMail({ to, from, subject, html }) {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    throw new Error(
      'メール送信の設定(環境変数 SMTP_USER / SMTP_PASS)がされていません。Renderの環境変数を確認してください。'
    );
  }
  if (!to) {
    throw new Error('送付先メールアドレスが設定されていません。会社情報設定で「銀行への送付先メールアドレス」を入力してください。');
  }

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  await transporter.sendMail({
    from: from || process.env.SMTP_FROM || user,
    to,
    subject,
    html
  });
}

module.exports = { sendMail };
