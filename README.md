# CCT 統合クイズ学習アプリ ログイン同期版

既存問題とNew問題を混ぜて出題する CCT クイズアプリです。
この版では、Cloudflare Workers + KV を使って **ユーザー登録ありログイン** と **ユーザー別の学習履歴同期** を実装しています。

## 主な機能

- 既存問題 + New問題をランダム出題
- 問題文と選択肢は英語
- 解説は日本語
- New問題には `New` バッジを表示
- 3回連続正解で出題範囲から除外
- 1回でも不正解なら連続正解数を0にリセット
- 未解答 / 戻り / 1回正解 / 2回正解 / 3回正解 の件数表示
- 日次ダッシュボード
- ユーザー登録
- ログイン / ログアウト
- ユーザーごとの学習履歴を Cloudflare KV に保存
- 別端末・別ブラウザでも同じ履歴を利用可能

## ファイル構成

- `index.html`：画面本体
- `styles.css`：デザイン
- `script.js`：クイズ処理・ログイン・Worker同期処理
- `questions.js`：問題データ
- `questions.json`：問題データのJSON版
- `generation_report.json`：生成レポート
- `cloudflare-worker/worker.js`：Cloudflare Worker API
- `cloudflare-worker/wrangler.toml`：Wrangler用設定例

## 構成

```txt
GitHub Pagesのクイズアプリ
  ↓ register / login / save / load
Cloudflare Worker
  ↓ get / put
Cloudflare KV
```

KVには以下のように保存します。

```txt
user:{userId}      ログインユーザー情報
progress:{userId}  ユーザーごとの学習履歴JSON
```

パスワードは平文では保存しません。Worker側で PBKDF2 + SHA-256 によりハッシュ化して保存します。

## Cloudflare側の設定手順

### 1. KV namespaceを作成

Cloudflare DashboardでKV namespaceを作成します。

例：

```txt
CCT_PROGRESS
```

### 2. Workerを作成

Workerを新規作成し、以下のファイル内容を貼り付けます。

```txt
cloudflare-worker/worker.js
```

### 3. KV bindingを設定

Workerの Settings → Bindings で KV namespace を追加します。

```txt
Variable name: CCT_PROGRESS
KV namespace : 作成したKV namespace
```

binding名は必ず `CCT_PROGRESS` にしてください。

### 4. 環境変数・Secretを設定

Workerの Settings → Variables and Secrets で以下を設定します。

必須：

```txt
ALLOWED_ORIGIN = GitHub PagesのURL
JWT_SECRET     = 任意の長いランダム文字列
```

例：

```txt
ALLOWED_ORIGIN = https://tkmjackie.github.io
JWT_SECRET     = cct-quiz-jwt-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`JWT_SECRET` はSecretとして登録するのがおすすめです。

任意：

```txt
REGISTRATION_CODE  = 新規登録時に必要な招待コード
TOKEN_TTL_DAYS     = ログイントークンの有効日数。未設定なら30日
PASSWORD_ITERATIONS = パスワードハッシュ回数。未設定なら120000
```

`REGISTRATION_CODE` を設定すると、登録画面の Registration Code に同じ値を入力した人だけが登録できます。自分だけで使う場合や勝手に登録されたくない場合は設定してください。

ローカル確認中だけは以下でも動きます。

```txt
ALLOWED_ORIGIN = *
```

公開運用では `*` ではなく、GitHub PagesのURLにしてください。

## アプリ側の使い方

1. GitHub Pagesへアプリ一式を配置
2. クイズアプリを開く
3. 右上の `ログイン / 同期` を押す
4. `Worker API URL` にWorkerのURLを入力
5. `新規登録` タブでアカウント作成
6. 登録後、自動的にログイン
7. 回答後に自動保存したい場合は `回答後に自動保存する` をON

次回以降は `ログイン` タブから同じユーザーID・パスワードでログインできます。

## API一覧

Workerは以下のAPIを持っています。

```txt
GET  /health    接続確認
POST /register  新規登録
POST /login     ログイン
GET  /me        ログイン確認
GET  /load      学習履歴読み込み
POST /save      学習履歴保存
```

`/load` と `/save` はログイン後のBearer tokenが必要です。

```txt
Authorization: Bearer <token>
```

## 注意点

- GitHub Pages上のJSONファイルを直接書き換える方式ではありません。
- 学習履歴はCloudflare KVにユーザーごとに保存されます。
- ブラウザ側にはログイントークンが localStorage に保存されます。
- 共用PCでは使い終わったらログアウトしてください。
- 同じユーザーで複数端末から同時に回答した場合、最後に保存した履歴が優先されます。

## 既存のWorker同期版からの変更点

以前の `User ID + Sync Key` 方式を廃止し、以下に変更しています。

```txt
旧：User ID + Sync Key
新：ユーザー登録 + ログイン + Bearer token
```

これにより、毎回Sync Keyを入力する必要がなくなり、ユーザーごとに自然に履歴を分けられます。
