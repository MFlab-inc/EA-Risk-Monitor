/**
 * Phase 1: 日中バッチ(1時間8回・市場時間のみ)
 * 1. 市場時間外なら即終了(NY基準: 日曜17:00〜金曜17:00)
 * 2. バッチクオート(1リクエスト=監視ペア数と同数のクレジット)で当日ここまでの高値・安値を取得
 * 3. 当日レンジ÷ADR20 と急変フラグ(150%超)を更新
 * 4. カレンダーを再取得し、イベントウィンドウ・全フラグを現在時刻で再合成
 * 5. DXY/US10Y/VIX(参考)も更新
 *
 * 実行分は既存FXDaily-Levels(:13/:43)と常に7分以上ずらしている(分ずらし運用は継続。詳細は intraday.yml)。
 * 2026-07-24: Twelve Data Grow 55プランへアップグレード済みでレート制限の実害は小さくなったが、
 * FXDaily-Levels側の変更にも備え、しょうさんの意向によりこの運用を維持する。
 */
const { loadConfigs, jstIso, sleep } = require("./lib/util");
const { isMarketOpen } = require("./lib/session");
const { fetchQuotes } = require("./lib/twelvedata");
const { fetchSentiment } = require("./lib/yahoo");
const { fetchEvents } = require("./lib/calendar");
const { loadFeed, applyIntraday, applyEventsAndFlags, saveFeed } = require("./lib/feed");

async function run() {
  const now = new Date();
  if (!isMarketOpen(now)) {
    console.log(`市場時間外のためスキップ ${jstIso(now)}`);
    return;
  }
  const { pairs, thresholds, pairKeys } = loadConfigs();
  console.log(`日中バッチ ${jstIso(now)}`);

  const feed = loadFeed(pairs, thresholds, pairKeys);
  feed.meta.errors = (feed.meta.errors || []).filter((e) => !e.startsWith("intraday/"));

  // 当日クオート(バッチ)。失敗ペアは65秒待って1回だけ再取得
  // (Grow 55プラン移行後もネットワーク一時障害等への保険として維持。
  //  レート制限衝突は55クレジット/分の余裕により発生しにくくなった)
  try {
    const symbolMap = Object.fromEntries(pairKeys.map((k) => [k, pairs[k].symbol]));
    const quotes = await fetchQuotes(symbolMap);
    const missing = pairKeys.filter((k) => !quotes[k]);
    if (missing.length > 0) {
      console.warn(`quote失敗${missing.length}件 — 65秒待機してリトライ(一時的な取得失敗対策)`);
      await sleep(65000);
      try {
        const retry = await fetchQuotes(
          Object.fromEntries(missing.map((k) => [k, pairs[k].symbol]))
        );
        for (const k of missing) if (retry[k]) quotes[k] = retry[k];
      } catch (e) {
        console.error(`リトライも失敗: ${e.message}`);
      }
    }
    for (const key of pairKeys) {
      const ok = applyIntraday(feed, key, quotes[key], pairs[key].digits, thresholds, now);
      if (!ok) feed.meta.errors.push(`intraday/${key}: quote取得失敗(前回値保持)`);
    }
  } catch (e) {
    console.error(`FAIL: quote - ${e.message}`);
    feed.meta.errors.push(`intraday/quote: ${e.message}(前回値保持)`);
  }

  // 市場心理(参考・部分失敗許容)
  try {
    feed.market = await fetchSentiment();
  } catch (e) {
    feed.meta.errors.push(`intraday/sentiment: ${e.message}`);
  }

  // カレンダー+フラグ再合成(イベントウィンドウは時刻依存のため毎回必須)
  try {
    const events = await fetchEvents();
    applyEventsAndFlags(feed, pairs, thresholds, pairKeys, events, now);
  } catch (e) {
    console.error(`FAIL: カレンダー - ${e.message}`);
    feed.meta.errors.push(`intraday/calendar: ${e.message}(前回ウィンドウ判定を保持)`);
  }

  feed.meta.generated_intraday = jstIso(now);
  saveFeed(feed);

  const spikes = pairKeys.filter((k) => feed.pairs[k].intraday.spike_flag);
  console.log(`保存完了: risk-feed.json${spikes.length ? ` / 急変フラグ: ${spikes.join(",")}` : ""}`);
}

module.exports = { run };

if (require.main === module) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
