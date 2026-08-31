# YOMU - 読書記録PWA

YOMUは、Androidのホーム画面から使えるローカルファーストの読書記録PWAです。アカウント登録は不要で、読書記録は利用者の端末内に保存されます。

- 公開版: [https://kishimen1.github.io/yomu-reading-app/](https://kishimen1.github.io/yomu-reading-app/)
- 公開リポジトリ: [https://github.com/kishimen1/yomu-reading-app](https://github.com/kishimen1/yomu-reading-app)

## 利用者向け

1. 公開版をAndroid版Chromeで開きます。
2. Chromeのメニューから「ホーム画面に追加」または「アプリをインストール」を選びます。
3. 「本を追加」から、ISBNバーコードをカメラで読むか、書名・著者から候補を検索して記録します。
4. 読了日、評価、ページ数、ジャンル、メモ、感想は後から編集できます。
5. 機種変更やブラウザーデータ削除の前に、「設定」からJSON完全バックアップを保存します。

GitHubに保存されるのはアプリのコードだけです。読書記録やカメラ映像はGitHubへ送信されません。書誌検索と表紙補完では、ISBNまたは書名・著者をopenBD、Google Books、Open Libraryへ送信します。

## 実装済みの機能

| 領域 | 機能 |
| --- | --- |
| 本棚 | 読んだ・読書中・読みたい、グリッド／リスト、AND検索、並び替え |
| 登録 | カメラのISBNバーコード認識、openBDのISBN検索、Open Libraryの書名・著者・出版社検索、候補から手入力欄への反映、登録先選択、重複検知 |
| 記録 | タイトル、著者、ISBN、ジャンル、ページ数、出版社、状態、読了日、評価、メモ、感想の編集 |
| 表紙 | openBD優先、Google Books、Open Libraryの順で補完する実在書影の自動表示、既存記録の順次補完、30日再検索抑制、手動再取得 |
| 分析 | 年別／全期間の冊数、ページ数、平均評価、著者数、ジャンル構成、月別推移、評価分布 |
| データ | YOMU／ビブリアCSV取込、UTF-8 BOM付きCSV出力、JSON完全バックアップ／復元 |
| PWA | 端末内保存、オフライン起動、ホーム画面追加、ライト／ダーク表示 |

初回起動時は空の本棚から始まります。以前の試作版に含まれていた架空のデモ本だけをIDと書名の完全一致で一度だけ除去し、利用者が追加した記録と旧v1データは保持します。

## 現在の仕様と制約

- データはインストールしたPWA／ブラウザーのlocalStorageに保存されます。端末間同期とクラウドバックアップはありません。
- openBD、Google Books、Open Libraryに未収録の本、通信できない状況では、入力欄へ直接記入して登録できます。
- カメラ読み取りはHTTPS上の対応ブラウザーで利用できます。利用できない端末ではISBNを数字で入力できます。
- バーコード認識は本の裏表紙にある978／979で始まるEAN-13（ISBN-13）を対象にします。
- 外部書影は通信できないと表示されない場合がありますが、記録本文とアプリ本体はオフラインで利用できます。
- ビブリアCSVは14列・UTF-8形式を対象とし、ISBN一致、ISBNなしは書名＋著者一致で重複をスキップします。

## 開発と検証

```powershell
npm install
npm run dev
```

開発サーバーは `http://localhost:8056` です。本番ビルドとPlaywright回帰テストは次で実行します。

```powershell
npm run typecheck
npm test
```

`main` ブランチへのpushで、GitHub Actionsが型検査・本番ビルド・GitHub Pages公開を自動実行します。

## 主なファイル

- `src/main.ts`: 画面状態、登録・編集、分析、入出力
- `src/data.ts`: スキーマv2、旧データ移行、正規化、バックアップ
- `src/csv.ts`: YOMU／ビブリアCSV解析、重複検知
- `src/openbd.ts`: ISBN検証、openBD接続
- `src/google-books.ts`: Google Books Dynamic LinksによるISBN完全一致の書影取得
- `src/book-search.ts`: Open Libraryの書名・著者・出版社・ISBN検索
- `src/book-covers.ts`: 表紙の厳密一致、取得順、再検索判定
- `src/styles.css`: レスポンシブUI
- `public/manifest.json` / `public/sw.js`: PWA設定、オフラインキャッシュ
- `tests/verify_app.py`: 実データ前提の主要導線と移行の回帰テスト

## 生成素材

- `public/assets/book-cover-sprite.png`: 表紙未取得時に使う抽象的なプレースホルダー。OpenAIの画像生成機能で作成。
- `public/assets/app-icon.png`: YOMU用のアプリアイコン。OpenAIの画像生成機能で作成。

これらはYOMU用に新規生成した素材で、実在書籍や他アプリのアセットではありません。
