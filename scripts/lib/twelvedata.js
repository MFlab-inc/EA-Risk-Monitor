/**
 * Twelve Data API クライアント(既存FXDaily-Levels fetch.js / intraday.jsから流用)
 * - 日足: /time_series (1シンボル=1クレジット)
 * - 当日クオート: /quote バッチ(7シンボル=7クレジット/1リクエスト)
 * レート制限: 無料プラン 8クレジット/分・800/日。取得間に1500ms待機。
 * 既存FXDaily-Levelsのcron(毎時:13/:43)と実行分をずらすこと(本リポジトリは:35)。
 */

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

module.exports = { fetchDailyBars, fetchQuotes };
