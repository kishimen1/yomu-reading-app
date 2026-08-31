# YOMU 読書記録PWA 引継書

更新日: 2026-08-31

## 1. 現在地

YOMUはVite + TypeScript製のローカルファーストPWA。GitHub PagesでHTTPS公開済みで、Androidのホーム画面追加も実機確認済み。v1.2.0では、openBDとOpen Libraryによる実在表紙の自動補完を加え、保存済みの本も順次更新できる。

- 作業ディレクトリ: `C:\Users\ZA-KESSAN-11\Documents\読書管理アプリ`
- ブランチ: `main`
- 公開リポジトリ: `https://github.com/kishimen1/yomu-reading-app`
- 公開版: `https://kishimen1.github.io/yomu-reading-app/`
- 静的版の基準コミット: `2d1be8a`
- `artifacts/`、`dist/`、`node_modules/` はGit対象外

学内Wi-Fi固有の検証は今後の要件から外す。公開版はGitHub PagesのHTTPS URLを利用する。

## 2. 実装済み

- 初回は空の本棚と明確な登録導線を表示
- 旧試作版の架空デモ本だけをID＋書名の完全一致で一度だけ除去
- 利用者の既存記録、旧v1キー、v1から移行した記録を保持
- 読んだ／読書中／読みたい、グリッド／リスト、AND検索、並び替え
- openBDによるISBN-10／ISBN-13の実書誌検索と登録先選択
- 対応ブラウザーのBarcodeDetectorによるISBN-13（EAN-13）カメラ読み取り
- Open Libraryによる書名・著者・出版社・ISBN検索と手入力欄への候補反映
- openBD優先、Open Library補完による実在表紙の自動取得
- 保存済み・手入力・CSV取込を含む表紙のバックグラウンド補完と詳細画面からの再取得
- 画像なし判定の30日保持、ISBNなしでは書名・著者の厳密一致、読込失敗時の代替表紙
- 手入力によるISBN、ジャンル、ページ数、状態、読了日、評価、メモ、感想の登録
- 詳細画面でタイトル、著者、ISBN、ジャンル、ページ数、出版社、状態、読了日、評価、メモ、感想を編集
- ISBN優先、ISBNなしは書名＋著者による重複検知
- 選択年／全期間の読了数、ページ数、平均評価、著者数、ジャンル構成、月別推移、評価分布
- UTF-8 BOM付きYOMU CSV出力、YOMU／ビブリアCSV取込
- JSON完全バックアップ／復元
- ライト／ダーク表示、年間目標
- Service Workerによるアプリ本体のオフラインキャッシュ
- GitHub ActionsによるGitHub Pages自動公開

## 3. 技術構成

| ファイル | 役割 |
| --- | --- |
| `index.html` | 画面構造、登録・詳細ダイアログ、PWAメタ情報 |
| `src/main.ts` | 状態管理、登録・編集、分析、入出力 |
| `src/data.ts` | 型、スキーマv2、正規化、v1移行、旧デモ除去 |
| `src/csv.ts` | CSV解析、ビブリア変換、重複検知 |
| `src/openbd.ts` | ISBN検証、openBD API接続 |
| `src/book-search.ts` | Open Library検索、書誌データ正規化 |
| `src/book-covers.ts` | 表紙取得順、厳密一致、30日再検索判定 |
| `src/styles.css` | モバイル／タブレット／デスクトップUI |
| `public/manifest.json` | PWAマニフェスト |
| `public/sw.js` | オフラインキャッシュ `yomu-shell-v8` |
| `.github/workflows/deploy-pages.yml` | `main` push時のGitHub Pages公開 |
| `tests/verify_app.py` | 本番プレビューを使うPlaywright回帰テスト |

主要localStorageキー:

```text
yomu-reading-archive:v2
yomu-settings:v2
yomu-demo-library-cleanup:v1
```

旧 `:v1` キーは読み取り移行後も削除しない。

## 4. 起動・検証

```powershell
npm install
npm run dev
npm run typecheck
npm test
```

開発URLは `http://localhost:8056`。`npm test` は本番ビルド後、Vite previewを `127.0.0.1:4173` で一時起動する。

回帰テストの範囲:

- 空の初回状態とISBN／手入力導線
- 登録、再読込後の永続化、詳細編集、重複防止
- 実openBD形状の応答を使ったISBN登録
- 実データだけを集計する分析
- ビブリアCSVの改行、重複、無効行、YOMU CSV再取込
- JSONバックアップ
- v1からv2への非破壊移行と値の上限補正
- 旧デモ本のみの安全な除去
- PWAマニフェスト、アイコン寸法、オフライン再読込
- 360px、768px、1440pxの横スクロールと主要画面
- ブラウザーコンソールエラーなし

## 5. 保存・プライバシー

- 読書記録は利用者の端末内に保存し、GitHubには送らない。
- 書誌検索と表紙補完では、ISBNまたは書名・著者をopenBDとOpen Libraryへ送る。
- カメラ映像はブラウザー内で処理し、保存・送信しない。
- 機種変更、アプリ削除、ブラウザーデータ削除の前にJSON完全バックアップが必要。
- 外部書影URLは永続キャッシュしない。書影がなくても記録本文は保持する。

## 6. 既知の制約

- ログイン、端末間同期、クラウドバックアップは未実装。
- カメラ読み取りはHTTPSとBarcodeDetector対応ブラウザーが必要。非対応時はISBN入力へ戻る。
- openBD／Open Libraryに未収録の本は直接入力が必要。
- Open Libraryの候補は作品単位の情報を含むため、版・ページ数・出版社を登録前に確認する。
- localStorageを端末DBとして使うため、大量データ向けSQLiteや全文検索は未実装。
- ブラウザーデータ削除時は、事前バックアップがなければ記録を復旧できない。
- 外部書影はオフライン時に表示できない場合がある。

## 7. 次の推奨作業（優先順）

1. Android実機で、手入力／ISBN登録、アプリ再起動後の保持、編集、JSONバックアップを一巡確認する。
2. Android実機でカメラ権限の許可／拒否、暗所、複数バーコードが写る場合を確認する。
3. 日本語書籍の検索精度が不足する場合だけ、APIキー管理を含む別書誌サービスの追加を検討する。
4. TalkBack、200%文字拡大、長文メモ、5000冊規模の回帰を追加する。
5. 複数端末利用が必要になった場合だけ、アカウントと暗号化同期を設計する。

## 8. 作業時の注意

- ユーザーの既存変更を戻さない。
- `dist/` は生成物なので直接編集しない。
- 旧v1保存データを削除しない。
- 旧デモ除去はID＋書名の完全一致条件を緩めない。
- openBD書影をService Workerで永続キャッシュしない。
- `main` push後はGitHub Actions完了と公開URLを確認してから完了報告する。
