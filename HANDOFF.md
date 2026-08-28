# YOMU 読書管理アプリ 引継書

更新日: 2026-08-28

## 1. プロジェクト概要

Android向け読書管理アプリ「YOMU」のモックアップ。iOSアプリ「読書管理ビブリア」の公開機能を要件の参考にしつつ、画面・名称・素材は複製せず、独自デザインの静的PWAとして実装している。

最終目標は、読書記録、データエクスポート、BI風分析を備えたAndroidアプリを完成させ、Google Playで公開できる状態へ進めること。

作業ディレクトリ:

```text
C:\Users\ZA-KESSAN-11\Documents\読書管理アプリ
```

注意: 現在このディレクトリはGitリポジトリではない。

## 2. 現在の実装

依存関係のないHTML/CSS/JavaScript製PWA。データはブラウザーの `localStorage` に保存する。

実装済み:

- 読んだ本、読書中、読みたい本の切替
- グリッド／リスト表示、AND検索、並び替え
- カメラプレビュー、バーコード読取デモ、書誌検索デモ、手入力
- タイトル、著者、状態、読了日、評価、メモ、感想の編集
- 本棚間の移動、共有、削除
- 読了数、ページ数、平均評価、著者数
- ジャンル円グラフ、月別読了数、評価分布、分析インサイト
- UTF-8 BOM付きCSVエクスポート
- JSON完全バックアップ／復元
- ライト／ダーク表示、年間目標設定
- Service Workerによるオフラインキャッシュ
- Android向けレスポンシブUI

主要ファイル:

| ファイル | 役割 |
| --- | --- |
| `index.html` | 画面構造、ダイアログ、PWAメタ情報 |
| `styles.css` | モバイル／タブレット／デスクトップのUI |
| `app.js` | サンプルデータ、状態管理、分析、入出力、画面操作 |
| `manifest.json` | PWAマニフェスト |
| `sw.js` | オフラインキャッシュ。現在 `yomu-shell-v2` |
| `README.md` | 利用方法、本稼働構成、公開ロードマップ |
| `tests/verify_app.py` | Playwrightによる主要導線の自動検証 |
| `assets/lucide.min.js` | オフライン利用するLucideアイコン |
| `assets/app-icon.png` | 生成した架空アプリアイコン |
| `assets/book-cover-sprite.png` | 生成した架空書籍用書影スプライト |

localStorageキー:

```text
yomu-reading-archive:v1
yomu-settings:v1
```

## 3. 起動方法

現在、PythonのHTTPサーバーが次の状態で起動している。

```text
0.0.0.0:8056
確認結果: HTTP 200
確認時PID: 46764
```

新しいセッションではプロセスが残っていると仮定せず、最初に確認する。

```powershell
netstat -ano | Select-String ':8056'
```

起動していなければ、プロジェクト直下で実行する。

```powershell
python -m http.server 8056 --bind 0.0.0.0
```

PCからの確認:

```text
http://localhost:8056
```

Androidからの確認:

```text
http://<PCの現在のIPv4アドレス>:8056
```

PCのIPv4アドレスはWi-Fi再接続やネットワーク切替で変わるため、毎回 `ipconfig` で確認する。Androidでは `localhost` を使わない。

## 4. ネットワーク検証結果

- 学内の全学用無線LANでは、PC自身からは開けるがAndroidから接続できなかった。
- PythonのWindowsファイアウォール許可設定は存在した。
- PCとAndroidをモバイルホットスポット経由で接続すると、Androidから正常に起動できた。
- したがって、学内無線LANのAP isolation / Client isolation等による端末間通信制限が原因である可能性が高い。
- 今後の通常試用は、モバイルホットスポットまたはHTTPS公開版で行う。
- LAN内HTTPは表示確認用。PWAのインストール、Service Worker、カメラ利用を安定させるにはHTTPS公開が必要。

## 5. npm修復結果

当初、`npm` と `npx` はユーザー領域の不完全なnpmコピーを優先し、`npm-cli.js` / `npx-cli.js` の `MODULE_NOT_FOUND` で失敗していた。

不完全なフォルダーを削除せず、次へ退避した。

```text
C:\Users\ZA-KESSAN-11\AppData\Roaming\npm\node_modules\npm.broken-backup-20260828
```

修復後の確認結果:

```text
node --version  -> v22.14.0
npm --version   -> 10.9.2
npx --version   -> 10.9.2
npm ping        -> PONG 213ms
```

正規のnpmは `C:\Program Files\nodejs\node_modules\npm` に存在する。退避フォルダーは復旧が安定するまで削除しない。

現時点ではプロジェクトに `package.json` やnpmパッケージは追加していない。

## 6. 検証状況

2026-08-28に次を実行し、成功している。

```powershell
node --check app.js
python tests\verify_app.py
```

期待されるテスト結果:

```text
PASS: shelf, add/edit, analytics, exports, offline PWA, and 360/768/1440 layouts
```

自動テスト内容:

- 初期本棚12冊の表示
- 読書中タブの切替
- 手入力による本の追加
- 詳細メモの更新
- 分析値の再計算
- CSV／JSONダウンロード
- 360px、768px、1440pxで横スクロールがないこと
- PWAマニフェスト
- Service Workerキャッシュによるオフライン再読込
- ブラウザーコンソールエラーがないこと

テストはローカルChromeを次のパスから起動する。

```text
C:\Program Files\Google\Chrome\Application\chrome.exe
```

テスト用の画像とエクスポート結果は `artifacts/` に保存される。

## 7. モックの既知の制約

- 書誌検索とバーコード読取結果はサンプルデータ。
- カメラプレビューは利用できるが、ISBN画像認識は未接続。
- データはブラウザーごとのlocalStorageに保存され、端末間同期しない。
- ログイン、クラウド同期、Google Drive／Dropboxバックアップは未実装。
- CSVはエクスポートのみ。復元はJSONのみ。
- PWAアイコンは1254x1254の生成画像1点。正式な公開前に192x192、512x512、adaptive icon用素材を用意する。
- 年次分析は現状2026年を前提とした箇所がある。日付依存処理は本稼働前に動的化する。
- 現在の静的構成はプロトタイプ向け。本稼働では型、DBマイグレーション、APIエラー処理を追加する。

## 8. 重要な設計判断

- デザインは静かで編集的な日本語UI。絵文字は使わずLucideアイコンを利用。
- 架空書影とアイコンは本プロジェクト用に新規生成し、実在書籍やビブリアの素材を使用していない。
- ビブリアの公開機能を参考にしたが、独自アプリとして実装する。
- 分析に使えるよう、CSVではID、書名、著者、ISBN、ジャンル、状態、評価、ページ数、読了日、登録日、メモ、感想を出力する。
- ユーザーデータはまず端末内保存を基本とし、クラウド同期を追加する場合は選択式にする方向。

## 9. 次の推奨作業

優先順:

1. Gitを初期化し、現在の動作済みモックを最初のコミットとして保存する。
2. HTTPSのプレビュー環境へ公開し、学内無線LANからAndroid実機でアクセスできるようにする。
3. PWA用192x192／512x512アイコンと `manifest.json` の `id` を追加する。
4. Vite + TypeScriptへ段階的に移行し、現在の動作を維持する回帰テストを通す。
5. データスキーマ、バージョン、マイグレーション方針を確定する。
6. ビブリア互換CSVインポート、重複検知、入力値検証を追加する。
7. openBD等の書誌APIと実ISBN検索を接続する。
8. CapacitorでAndroidプロジェクトを生成する。
9. SQLite、ML Kitバーコード、ネイティブ共有、端末ファイル保存を接続する。
10. Android実機テスト、Play Console内部テスト、クローズドテスト、公開へ進む。

Capacitor導入の基本コマンドは次のとおり。ただし、実行前にVite移行とパッケージ名の決定を推奨する。

```powershell
npm install @capacitor/cli @capacitor/core
npx cap init
npm install @capacitor/android
npx cap add android
npx cap sync android
npx cap open android
```

## 10. 新セッション開始時の確認チェックリスト

```powershell
Get-Location
Get-ChildItem -Force
node --version
npm --version
npx --version
netstat -ano | Select-String ':8056'
node --check app.js
python tests\verify_app.py
```

注意事項:

- テスト実行前に8056番のサーバーが必要。
- ユーザーの既存変更を勝手に戻さない。
- 現在はGit未初期化なので、変更前にファイル状態を必ず確認する。
- 学内Wi-FiでLAN内サーバーへ接続できないことをアプリ不具合と誤認しない。
- 本稼働作業に入る前に、アプリ名、パッケージ名、クラウド同期の要否、公開範囲をユーザーと確定する。

## 11. 参考URL

- 読書管理ビブリア App Store: https://apps.apple.com/jp/app/id894377244
- 読書管理ビブリア サポート: https://biblia978.com/support/
- Capacitor公式: https://capacitorjs.com/docs
- Android公開準備: https://developer.android.com/studio/publish/preparing
- Google Play target API要件: https://developer.android.com/google/play/requirements/target-sdk

