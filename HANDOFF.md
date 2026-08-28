# YOMU 読書管理アプリ 引継書

更新日: 2026-08-28

## 1. 現在地

Android向け読書管理アプリ「YOMU」。静的モックから、Vite + TypeScript製PWAへ移行済み。独自デザイン・独自生成素材を使い、読書記録、データ移行、BI風分析、PWAオフライン利用を実装している。

作業ディレクトリ:

```text
C:\Users\ZA-KESSAN-11\Documents\読書管理アプリ
```

Git:

- `main` ブランチで初期化済み。
- 動作済み静的モックの基準コミットは `2d1be8a`。
- テスト生成物 `artifacts/`、`dist/`、`node_modules/` はGit対象外。

## 2. 実装済み

- 読んだ本、読書中、読みたい本の切替
- グリッド／リスト表示、AND検索、並び替え
- 手入力、カメラプレビュー、バーコード読取デモ
- openBDによるISBN-10／ISBN-13の実書誌検索
- ISBN優先、ISBNなしは書名＋著者による重複検知
- タイトル、著者、状態、読了日、評価、メモ、感想の編集
- 本棚間の移動、共有、削除
- 選択年／全期間の読了数、ページ数、平均評価、著者数
- ジャンル円グラフ、12か月推移、評価分布
- UTF-8 BOM付きYOMU CSVエクスポート
- YOMU CSV、ビブリア14列CSVの自動判別インポート
- JSON完全バックアップ／復元
- スキーマv2保存とv1 localStorage／JSONからの非破壊移行
- ライト／ダーク表示、年間目標設定
- 192x192／512x512 PWAアイコン、manifest `id`
- Service Workerによる同一オリジンのオフラインキャッシュ
- GitHub Pages用の自動ビルド・HTTPS公開ワークフロー
- 設定画面からのPWAインストール導線と端末保存の注意表示

## 3. 技術構成

| ファイル | 役割 |
| --- | --- |
| `index.html` | 画面構造、ダイアログ、PWAメタ情報 |
| `src/main.ts` | 状態管理、画面操作、分析、入出力 |
| `src/data.ts` | 型、スキーマv2、正規化、移行、バックアップ |
| `src/csv.ts` | CSV解析、ビブリア変換、重複検知 |
| `src/openbd.ts` | ISBN検証、openBD API接続、応答変換 |
| `src/styles.css` | モバイル／タブレット／デスクトップUI |
| `public/manifest.json` | PWAマニフェスト |
| `public/sw.js` | オフラインキャッシュ。現在 `yomu-shell-v5` |
| `.github/workflows/deploy-pages.yml` | `main` push時のGitHub Pages自動公開 |
| `tests/verify_app.py` | Vite本番プレビューを使うPlaywright回帰テスト |
| `package.json` | Vite、TypeScript、ビルド／テストコマンド |

主要localStorageキー:

```text
yomu-reading-archive:v2
yomu-settings:v2
```

旧 `:v1` キーは読み取り移行後も削除しない。移行テストもこの非破壊性を確認している。

## 4. 起動・ビルド・検証

開発サーバー:

```powershell
npm install
npm run dev
```

既定URL:

```text
http://localhost:8056
```

型検査と本番ビルド:

```powershell
npm run typecheck
npm run build
```

全回帰テスト:

```powershell
npm test
```

`npm test` は `dist/` を再生成し、Vite previewを `127.0.0.1:4173` で一時起動して終了時に停止する。

2026-08-28の期待結果:

```text
PASS: shelf, add/edit, analytics, exports, offline PWA, and 360/768/1440 layouts
```

検証範囲:

- 360px、768px、1440pxで横スクロールなし
- 追加・編集・検索・分析・CSV／JSON入出力
- openBD検索はテスト内でAPI応答をモック
- ビブリアCSVの改行入りフィールド、重複、無効行
- v1からv2へのlocalStorage移行と値の上限補正
- PWAマニフェスト、実アイコン寸法、オフライン再読込
- ブラウザーコンソールエラーなし

## 5. 書誌・CSV仕様上の注意

openBD:

- `https://api.openbd.jp/v1/get?isbn=...` を使用。
- openBDはISBN取得のみ。書名・著者キーワード検索は現状デモ候補。
- 代替書誌へ移行済みのため未収録項目や書影欠落があり得る。
- 外部書影はPWAキャッシュしない。URLだけを保存し、提供元の更新・削除を反映可能にする。
- API失敗、未収録、8秒タイムアウト時も手入力可能。

ビブリアCSV:

- 公式サポート記載のUTF-8、ヘッダーなし、14列形式を対象。
- 1列目タイトル、3列目著者、6列目ISBN、7列目日付、8列目メモ、9列目感想、12列目登録日、13列目本棚、14列目評価を使用。
- 12列未満またはタイトルなしの行は無効行として集計。
- ISBN一致を優先し、ISBNなしは正規化した書名＋著者で重複判定。

## 6. ネットワーク確認結果

- 学内の全学用無線LANでは、PC自身からは開けるがAndroidからLAN内HTTPへ接続できなかった。
- モバイルホットスポット経由ではAndroidから正常に起動できた。
- 学内無線LANのAP isolation / Client isolation等による端末間通信制限の可能性が高い。
- LAN内HTTPは表示確認用。PWAインストール、Service Worker、カメラ実機確認にはHTTPS公開版を使う。

## 7. 既知の制約

- GitHub Pages向け設定は実装済みだが、GitHubリモート未設定のため未公開。
- AndroidパッケージIDが未決定のためCapacitorプロジェクトは未生成。
- ISBN画像認識は未接続。カメラプレビューとサンプル読取まで。
- 端末DBはlocalStorage。SQLite、全文検索、DBマイグレーションは未実装。
- ログイン、クラウド同期、Google Drive／Dropboxバックアップは未実装。
- openBDにない書籍のキーワード実検索フォールバックは未実装。
- 外部書影URLはネットワーク切断時に表示できないが、記録本文はオフライン利用可能。

## 8. 次の推奨作業（優先順）

1. GitHubリポジトリを作成してpushし、PagesのSourceをGitHub ActionsにしてHTTPS公開する。
2. 学内Wi-FiのAndroid実機でPWAインストール・カメラ・オフラインを確認する。
3. 正式アプリ名、AndroidパッケージID、公開主体、クラウド同期の要否を確定する。
4. Capacitorを導入しAndroidプロジェクトを生成する。
5. SQLiteスキーマとWebスキーマv2からの初回移行を実装する。
6. ML Kit Barcode Scanning、ネイティブ共有、端末ファイル保存を接続する。
7. openBD未収録時の書誌フォールバックを決める。
8. TalkBack、200%文字拡大、5000冊性能、Android実機回帰を追加する。
9. Play Console内部テスト、クローズドテスト、公開へ進む。

## 9. 次回開始時チェック

```powershell
Get-Location
git status --short --branch
node --version
npm --version
npm run typecheck
npm test
```

注意:

- ユーザーの既存変更を戻さない。
- `dist/` は生成物なので直接編集しない。
- 旧v1保存データを削除しない。
- openBD書影をService Workerで永続キャッシュしない。
- Capacitor実行前にパッケージIDをユーザーと確定する。

## 10. 参考URL

- 読書管理ビブリア CSV仕様: https://biblia978.com/support/articles/15/
- openBD: https://openbd.jp/
- openBD API仕様: https://openbd.jp/spec/
- Capacitor公式: https://capacitorjs.com/docs
- Android公開準備: https://developer.android.com/studio/publish/preparing
