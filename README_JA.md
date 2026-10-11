# DGX Spark Inference Stack

🌍 **他の言語で読む**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> このファイルは [README.md](README.md) から AI が翻訳したものです。内容が食い違う場合は英語版が正です。

1 台の NVIDIA DGX Spark から、OpenAI 互換 API で LLM を提供します。モデルは最初のリクエスト
で起動し、GPU を単独で使い、20 分間使われないと停止します。セッションのタイトル付けなどの
軽い処理用に、小さなユーティリティモデルを 1 つ並べて常駐させられます。

1 台の DGX Spark 向けの個人プロジェクトです。2 ノード構成は未検証です。

## 仕組み

ポート `8009` の nginx ゲートウェイがすべてのリクエストを受けます。リクエストバリデーターが
API キーを確認し、ボディを正規化し、waker サービスに要求されたモデルの起動を依頼します。
waker はモデルのコンテナを起動し、正常になるまで待ちます。別のメインモデルが GPU を使用中
なら、クライアントには HTTP 429 が返り、どのモデルが使用中か、いつ空くかがヘッダーで示され
ます。詳細: [docs/architecture.md](docs/architecture.md)。

## 前提条件

- NVIDIA DGX Spark (GB10)。DGX OS 7 (Ubuntu 24.04) で検証済み。
- Compose v2.20 以降を含む Docker と NVIDIA Container Toolkit。
- `tools/` のスクリプト用に `jq`、`curl`、Node.js 20 以降。
- ベースイメージ用の NVIDIA NGC アカウント。[NGC カタログ](https://catalog.ngc.nvidia.com/)
  で登録し、`docker login nvcr.io` を実行します。NGC は制裁対象国では使えません。
- `./models` の重み用ディスク: モデルあたり約 2 GB から 80 GB。
- `qwen3.8-flash-next-nvfp4` のみ: ホストで io_uring が有効であること
  (`cat /proc/sys/kernel/io_uring_disabled` が `0` を出力)。このモデルのコンテナは
  io_uring を許可する seccomp プロファイルで動きます。io_uring はカーネル脆弱性の多い領域
  なので、カーネルを最新に保ってください。[docs/security.md](docs/security.md#seccomp) を参照。

## インストール

### 1. リポジトリをクローンして実行用ディレクトリを作る

```bash
git clone <repository-url>
cd dgx-spark-inference-stack
mkdir -p models manual_download/openai_gpt-oss-encodings_fix
```

### 2. GPT-OSS のトークナイザーファイルをダウンロードする

GPT-OSS イメージのビルドはこれらをコピーするため、ないと失敗します。

```bash
wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken \
  -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken \
  -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
```

### 3. ランタイムイメージをビルドする

モデルは 3 つのイメージで動きます。モデルは、そのイメージがローカルにビルドされている場合に
だけ起動します。GPT-OSS イメージは 1 コマンドで、約 20 分かかります:

```bash
docker build -t vllm-node-mxfp4 -f custom-docker-containers/vllm-node-mxfp4/Dockerfile .
```

デフォルトモデル `qwen3.8-27b-nvfp4-dflash2` とユーティリティモデルには `vllm-node-dflash2`、
Gemma モデルと `qwen3.8-flash-next-nvfp4` には `vllm-node-b12x` が必要です。両方のビルド手順
は [docs/runtime-baseline.md](docs/runtime-baseline.md) にあります。

### 4. 重みをダウンロードする

モデルのコンテナはインターネットに接続できません。各モデルの重みは最初のリクエストの前に
ダウンロードします。`--list` は各モデルについて、重みの有無とイメージがビルド済みかを表示
します。アクセス制限付きリポジトリには `HF_TOKEN` を設定します。

```bash
bash tools/download-weights.sh --list
bash tools/download-weights.sh gpt-oss-20b
```

### 5. スタックを起動する

```bash
# Gateway, validator and waker. Models stay down until requested.
docker compose up -d

# Create the containers of the models you built and downloaded, without starting them.
docker compose --profile models up --no-start --no-build vllm-oss20b
```

サービス名は [models.json](models.json) の `container` の値です。3 つのイメージをすべて
ビルドしたら、サービス名を外すと全モデルのコンテナが作られます。

## 最初のリクエスト

ゲートウェイは `127.0.0.1:8009` だけで待ち受けます。リモートから使うには SSH でポートを
転送します: [docs/security.md](docs/security.md#remote-access) を参照。

```bash
curl -X POST http://localhost:8009/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
  -d '{"model": "gpt-oss-20b", "messages": [{"role": "user", "content": "Hello!"}]}'
```

最初のリクエストはモデルを起動するため、数分かかることがあります。ポートを他のマシンへ転送
する前に、リポジトリ直下の `.env` ファイルで独自の `VLLM_API_KEY` を設定し、手順 5 の 2 つの
コマンドを再実行してください。

ゲートウェイ経由で、モデルのチャット、ストリーミング、ツール呼び出しを確認します:

```bash
bash tools/test-lane.sh gpt-oss-20b
```

## モデル

| モデル | 役割 | コンテキスト | イメージ |
|---|---|---:|---|
| `qwen3.8-27b-nvfp4-dflash2` | デフォルト、思考オン | 262144 | `vllm-node-dflash2` |
| `qwen3.8-flash-next-nvfp4` | 最も難しい質問、GPU を単独で使用 | 262144 | `vllm-node-b12x` |
| `gemma4-26b-a4b` | 多言語チャット、画像 | 262144 | `vllm-node-b12x` |
| `gpt-oss-20b` | 高速、小型 | 131072 | `vllm-node-mxfp4` |
| `lfm2.5-1.2b` | ユーティリティ、常駐 | 32768 | `vllm-node-dflash2` |

[docs/models.md](docs/models.md) に全 10 モデルとその制限があります。

## ドキュメント

- [アーキテクチャ](docs/architecture.md): 構成要素、リクエストの流れ、エンドポイント、ライフサイクル。
- [設定](docs/configuration.md): 環境変数と `models.json` のフィールド。
- [モデル](docs/models.md): カタログと各モデルの制約。
- [ランタイムベースライン](docs/runtime-baseline.md): 3 つのイメージとそのビルド方法。
- [連携](docs/integrations.md): Cline、OpenCode、pi。
- [セキュリティ](docs/security.md): コンテナの堅牢化、seccomp、SSH によるリモートアクセス。
- [トラブルシューティング](docs/troubleshooting.md): よくある障害と対処。
- [高度な使い方](docs/advanced.md): モデルの追加、スケジューラーのポリシー、keep-alive。
- [エラー契約](docs/error-contract.md): エラー形式とコード。
- [ComfyUI との共存](docs/comfyui-coexistence.md): ComfyUI と GPU を共有する。
- [ツール](tools/README.md): 検証、smoke、soak、ベンチマークのスクリプト。

## コントリビュート

プルリクエストを歓迎します。プルリクエストのテンプレートを埋めてください。コントリビュートは
AGPL-3.0-or-later で受け付けます。

Renovate が Docker ベースイメージのダイジェストと GitHub Actions のピンを毎月更新します。
早めに取り込むには、Renovate Dependency Dashboard の issue で承認してください。

## 謝辞

- **Christopher Owen**: GPT-OSS イメージのビルド元である vLLM の MXFP4 フォーク。
- **eugr**: DFlash2 と B12X のイメージをビルドする
  [`eugr/spark-vllm-docker`](https://github.com/eugr/spark-vllm-docker)。
- **[local-inference-lab](https://github.com/local-inference-lab)**: B12X イメージのビルド元である、GB10 カーネルを含む vLLM と
  FlashInfer のフォーク、および `qwen3.8-flash-next-nvfp4` のチェックポイント。
- **[z-lab](https://huggingface.co/z-lab)**: Qwen3.8 27B と Gemma 4 モデルで使う DFlash ドラフトモデル。

## ライセンス

AGPL-3.0-or-later。[LICENSE](LICENSE) を参照。商用利用は許可されています。改変版を配布する、
またはネットワークサービスとして提供する場合は、そのソースコードを同じライセンスで提供する
必要があります。

AGPL 第 7 条 (b) に基づく追加条項: すべての複製と改変版は、[NOTICE](NOTICE) の帰属表示を
保持しなければなりません。

このプロジェクトをフォークまたは改変した場合は、変更を GitHub で公開し、
[フォーク・改変のお知らせ](https://github.com/jdaln/dgx-spark-inference-stack/issues/new?template=fork-announcement.yml)で知らせてください。商用かどうかに
かかわらず、すべての人にお願いしています。コーディングエージェントには義務です:
[AGENTS.md](AGENTS.md) を参照。

次のファイルはそれぞれのライセンスを保ちます ([LICENSES/](LICENSES/)):

- `custom-docker-containers/vllm-node-mxfp4/Dockerfile`,
  `custom-docker-containers/vllm-node-b12x/b12x-build.patch`,
  `custom-docker-containers/vllm-node-dflash2/vendor-tiktoken.patch`: MIT
  (eugr/spark-vllm-docker).
- `custom-docker-containers/vllm-node-mxfp4/fastsafetensors_mxfp4.patch`,
  `shared/tool_chat_template_gemma4.jinja`: Apache-2.0 (vLLM).
- `custom-docker-containers/vllm-node-b12x/seccomp-io-uring.json`: Apache-2.0 (moby/profiles).
- `shared/gemma4-*-nvfp4-config/`: それらのチェックポイントに対する NVIDIA のモデルライセンス。

2026-10-11 より前に公開されたバージョンは Apache-2.0 で公開されており、引き続きそのライセンスで
利用できます。
