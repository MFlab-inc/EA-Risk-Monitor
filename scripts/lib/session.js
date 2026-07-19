/**
 * セッション日付・市場時間の判定(既存FXDaily-Levels fetch.jsから流用)
 * 日足の区切りはNY17:00クローズ基準。
 */
const { fmtDateLocal } = require("./util");

/** 直近の「確定した」セッション日付(NY17:00より前なら前日、週末はスキップ) */
function lastCompletedSessionDate(now = new Date()) {
  const nyStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const ny = new Date(nyStr);
  let d = new Date(ny);
  if (ny.getHours() < 17) d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return fmtDateLocal(d);
}

/**
 * FX市場が開いているか(NY時間基準: 日曜17:00オープン〜金曜17:00クローズ)
 * intradayバッチの実行ガードに使用。
 */
function isMarketOpen(now = new Date()) {
  const ny = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const dow = ny.getDay();
  const h = ny.getHours();
  if (dow === 6) return false;                 // 土曜(NY)は終日クローズ
  if (dow === 0 && h < 17) return false;       // 日曜17:00前
  if (dow === 5 && h >= 17) return false;      // 金曜17:00以降
  return true;
}

module.exports = { lastCompletedSessionDate, isMarketOpen };
