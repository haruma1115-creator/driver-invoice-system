// 控除・インセンティブ・経費の項目マスタ。
// 項目を増減したい場合はここを編集してください(サーバー再起動不要、リクエスト毎に読み込みます)。

const DEDUCTION_CATEGORIES = ['車両代', '事務手数料', '車両修繕代', '前借り分返済'];

const INCENTIVE_CATEGORIES = ['繁忙期インセンティブ', 'SNSインセンティブ', 'リクルートインセンティブ', 'その他'];

const EXPENSE_CATEGORIES = ['消耗品費', '車両修繕'];

const TAX_RATE = 0.10; // 標準税率10%(本システムは軽減税率の取り扱いはありません)

module.exports = { DEDUCTION_CATEGORIES, INCENTIVE_CATEGORIES, EXPENSE_CATEGORIES, TAX_RATE };
