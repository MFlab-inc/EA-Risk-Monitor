# EA Risk Monitor

EAポートフォリオ運用商品専用のリスク計測・デリスク判定フィード。
GitHub Actions が市場データを定期取得し、`data/risk-feed.json` と運用者向けダッシュボード(`index.html`)を GitHub Pages で配信する。

- 本リポジトリは市場データと市場判定のみを扱う。**EA名・マジックナンバー・配分・ロット・口座情報・停止ライン額は一切含まない**(それらはVPS側で管理)
- 事実データであり売買助言ではない
- デイトレ用の既存システム [FXDaily-Levels](https://github.com/MFlab-inc/FXDaily-Levels) とは独立(設計パターンのみ流用)

## 構成

| 処理 | ファイル | スケジュール(JST) |
|---|---|---|
| Phase 0 初期化(D1履歴400本×7ペア) | `scripts/init-history.js` | 手動1回(Actions → Init History) |
| 日次バッチ(指標計算・フィード生成) | `scripts/daily.js` | 火〜土 7:20 |
| 日中バッチ(急変検知・イベント窓再判定) | `scripts/intraday.js` | 毎時35分(市場時間のみ) |

データ取得元: Twelve Data API(D1・当日クオート) / Yahoo Finance(DXY・US10Y・VIX 参考) / Forex Factory(経済カレンダー今週+来週)。

## 計算定義

すべてD1確定足(NY17:00クローズのセッション日付)基準。

| 項目 | 定義 |
|---|---|
| TR | max(H−L, \|H−前日C\|, \|L−前日C\|) |
| ATR14 | Wilder平滑(初期値=最初の14本のTR単純平均、以後 (前ATR×13+TR)/14)。既存FXDaily-Levelsと同一定義 |
| ATR% | ATR14 ÷ 終値 × 100(%表記) |
| ADR20 | 直近20営業日の(H−L)単純平均 |
| RV20 | 直近20個の日次対数リターンの標本標準偏差(n−1) × √252 × 100(年率%表記) |
| パーセンタイル | 直近250営業日(当日含む)のATR%系列中、当日値以下の割合×100 |
| レジーム | 平常 p<50 / 注意 50≤p<80 / 高ボラ 80≤p<95 / 異常 p≥95(境界は上位区分=保守側) |
| 急変フラグ | 当日レンジ(H−L) ÷ ADR20 が **1.50超**(2024年8月5日型の進行中急変検知) |
| イベント窓 | 監視イベントの [発表−pre, 発表+post]。日銀・FOMC=前24h/後2h、他中銀=前12h/後2h、指標=前12h/後1h、EURGBPは最短profile(前6h/後1h) |

**閾値はすべて仮置き**(`config/thresholds.json`)。Phase 3 の月次分析(`data/archive/` の日次スナップショット蓄積)で実測後に確定する。

## フラグ(アクション接続)

| フラグ | 条件 | 意味 |
|---|---|---|
| `no_new_grid` | レジーム高ボラ以上 or イベント窓内 | 新規グリッド開始・段数追加の禁止 |
| `halt_all_new` | レジーム異常 or 急変フラグ | 新規全停止(+運用監視を日次モードへ) |
| `vr_hold_check` | 金曜15:00JST以降・土曜 or 日銀窓(前30h/後2h) | USDJPYのみ。週次ルール(週末・日銀またぎ保有確認)のリマインダー。停止指示ではない |
| `monitor_only` | — | XAUUSDのみ。`no_new_grid`/`halt_all_new` は他ペアと同じ規則で**参考として**算出・表示されるが、EA側ゲート接続の対象外であることを示すマーカー(2026-07-20仕様変更) |

既存バスケットのTP決済は常時許可(フィードは「新規」に関する判定のみを配信)。
どのEAがどのフラグに従うかは本リポジトリでは定義しない(Phase 2・VPS側)。

## risk-feed.json の読み方(EA側 Phase 2 向け)

- `meta.generated_daily / generated_intraday / generated_calendar`: 各セクションの生成時刻(JST)。**鮮度が `meta.thresholds.feed_staleness_warn_minutes`(既定120分)を超えた場合のEA側の扱い(フェイルセーフで新規禁止にする等)はPhase 2で決定**
- `pairs.<PAIR>.data_ok`: false の場合、そのペアの日次値は前回値のまま(取得失敗)。`meta.errors` に理由
- `pairs.<PAIR>.flags`: 上表のフラグと `reasons`(根拠の列挙)

## 既知の制約

1. GitHub Actions の cron は数分〜数十分遅延し得る。急変フラグは毎時判定でありリアルタイム検知ではない(ティックレベル即応が必要な場合はPhase 2でEA/VPS側の補完を検討)
2. Twelve Data の日足とブローカー(MT4/MT5)の日足は原則NYクローズ基準で一致するが、特にXAUUSDの休場処理で差異が生じ得る。厳密整合が必要な場合は `node scripts/init-history.js --csv <dir>` でMT4/MT5エクスポートCSVから初期化可能
3. Forex Factoryのイベント分類(特に原油在庫・OPEC・中国指標)は実データでの捕捉確認が必要(稼働後の検証項目)
4. 無料APIプラン(8クレジット/分・800/日)を既存FXDaily-Levelsと共有するため、実行時刻をずらしている(日次 22:20 UTC vs 既存 23:13 / 毎時 :35 vs 既存 :13・:43)。変更時は衝突に注意

## テスト

```
npm test   # 計算ロジック検証20件(ネットワーク不要)
```
