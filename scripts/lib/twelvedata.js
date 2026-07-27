/**
 * Twelve Data API クライアント(既存FXDaily-Levels fetch.js / intraday.jsから流用)
 * - 日足: /time_series (1シンボル=1クレジット)
 * - 当日クオート: /quote バッチ(7シンボル=7クレジット/1リクエスト)
 * レート制限: Grow 55プラン 55クレジット/分・日次上限なし(2026-07-24〜)。取得間に1500ms待機。
 * 既存FXDaily-Levelsのcron(毎時:13/:43)と実行分をずらすこと(分ずらし運用は継続。詳細は intraday.yml)。
 */

/**
 * 土日日付のバーか判定(dateは YYYY-MM-DD)。
 * 2026-07-26修正: Twelve Dataのtime_seriesが取得タイミングによって土日日付の
 * バーを返すことがあり(実データで確認)、営業日ベースの定義(ADR20=直近20営業日、
 * パーセンタイル=250営業日)が崩れてFXDaily-Levelsとの数値不整合の原因になった。
 * API取得時に除外する(日次バッチ側でも既存履歴から浄化する)。
 */
function isWeekdayDate(dateStr) {
  const dow = new Date(dateStr + "T00:00:00Z").getUTCDay();
  return dow !== 0 && dow !== 6;
}

function apiKey() {
  const k = process.env.TWELVE_DATA_API_KEY;
  if (!k) {
    console.error("ERROR: 環境変数 TWELVE_DATA_API_KEY が設定されていません");
    process.exit(1);
  }
  return k;
}

/** 日足OHLCを取得(昇順で返す)。cutoffDate以前の確定足のみ。 */
async function fetchDailyBars(tdSymbol, { outputsize = 45, cutoffDate = null } = {}) {
  const url =
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSymbol)}` +
    `&interval=1day&outputsize=${outputsize}&timezone=America/New_York&apikey=${apiKey()}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.status === "error" || !json.values) {
    throw new Error(`Twelve Data エラー (${tdSymbol}): ${json.message || "no data"}`);
  }
  let bars = json.values.map((v) => ({
    date: v.datetime.slice(0, 10),
    open: parseFloat(v.open),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
  }));
  bars = bars.filter((b) => isWeekdayDate(b.date)); // 土日日付バーの除外(2026-07-26)
  if (cutoffDate) bars = bars.filter((b) => b.date <= cutoffDate);
  bars.sort((a, b) => a.date.localeCompare(b.date));
  return bars;
}

/** バッチクオート(当日ここまでの高値・安値・現在値)。symbolMap: {PAIRCODE: "GBP/JPY", ...} */
async function fetchQuotes(symbolMap) {
  const tdSymbols = Object.values(symbolMap);
  const url =
    `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(tdSymbols.join(","))}` +
    `&apikey=${apiKey()}`;
  const res = await fetch(url);
  const json = await res.json();
  const out = {};
  for (const [code, td] of Object.entries(symbolMap)) {
    // バッチ時はシンボルをキーにしたオブジェクト、単一時はトップレベルに返る
    const q = tdSymbols.length === 1 ? json : json[td];
    if (!q || q.status === "error" || !q.close) {
      out[code] = null;
      continue;
    }
    out[code] = {
      price: parseFloat(q.close),
      today_high: parseFloat(q.high),
      today_low: parseFloat(q.low),
    };
  }
  return out;
}

module.exports = { fetchDailyBars, fetchQuotes, isWeekdayDate };
