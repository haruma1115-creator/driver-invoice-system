// ミドルウェアは (req, res) => boolean|undefined を返す。
// false を返すとそこでリクエスト処理を打ち切る(既にレスポンス送信済みの意味)。
function requireDriver(req, res) {
  if (!req.session || !req.session.driverId) {
    res.status(401).json({ error: 'ログインが必要です' });
    return false;
  }
}

function requireAdmin(req, res) {
  if (!req.session || !req.session.adminId) {
    res.status(401).json({ error: '管理者ログインが必要です' });
    return false;
  }
}

module.exports = { requireDriver, requireAdmin };
