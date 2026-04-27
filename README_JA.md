# DGX Spark Inference Stack - 自宅で使い倒そう！

🌍 **他の言語で読む**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **AI翻訳に関する注意:** このファイルは [README.md](README.md) を元に AI で翻訳したものです。誤りを含む可能性があり、英語版より更新が遅れている場合があります。迷った場合は英語版 README を正としてください。

あなたの Nvidia DGX Spark は、ただのサイドプロジェクトで終わるべきではありません。実際に使いましょう。これは NVIDIA vLLM と賢いリソース管理を使って大規模言語モデル（LLM）を提供するための Docker ベース推論スタックです。このスタックは、アイドル時の自動停止付きオンデマンドロード、任意のユーティリティヘルパーを伴う単一のメインモデル用スケジューリングレーン、そして統一 API ゲートウェイを提供します。

このプロジェクトの目的は、自宅向けの推論サーバーを提供することです。1か月ほどテストし、新しいモデルも追加した上で、コミュニティ向けに公開することにしました。これはホビープロジェクトなので、改善のための具体的な助けはとても歓迎です。インターネット上の情報や NVIDIA フォーラムの知見を元にしており、ホームラボの前進に少しでも役立てばと思っています。主な対象は単一の DGX Spark 構成で、まずはそこできちんと動くことを重視していますが、2 台構成のサポートも歓迎します。

## ドキュメント

- **[アーキテクチャと仕組み](docs/architecture.md)** - スタック、waker サービス、リクエストフローを理解する。
- **[設定](docs/configuration.md)** - 環境変数、ネットワーク設定、waker のチューニング。
- **[モデル選択ガイド](docs/models.md)** - 29 以上の対応モデル、クイックチョイサー、利用用途の詳細。
- **[連携](docs/integrations.md)** - **Cline**（VS Code）と **OpenCode**（ターミナルエージェント）のガイド。
- **[セキュリティとリモートアクセス](docs/security.md)** - SSH の強化と制限付きポートフォワーディングの設定。
- **[トラブルシューティングと監視](docs/troubleshooting.md)** - デバッグ、ログ、よくあるエラーの対処法。
- **[高度な使い方](docs/advanced.md)** - 新しいモデルの追加、カスタム設定、常時運用。
- **[ランタイム基準](docs/runtime-baseline.md)** - リポジトリが前提にしているローカルイメージトラックと再ビルド方法。
- **[ツールと検証ハーネス](tools/README.md)** - 対応している smoke、soak、inspection、手動 probe スクリプト。
- **[TODO メモ](TODO.md)** - 今後やりたいことのメモ。

## クイックスタート

1. **リポジトリをクローンする**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **必要なディレクトリを作成する**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **必要な tokenizer をダウンロードする（重要）**
   このスタックでは GPT-OSS モデル用の `tiktoken` ファイルを手動でダウンロードする必要があります。
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **カスタム Docker イメージをビルドする（必須）**
   このスタックは最適化済み vLLM イメージを使います。最大性能のため、ローカルでビルドしてください。
   *   **時間:** 1 イメージあたりおよそ 20 分を見込んでください。
   *   **認証:** ベースイメージを pull するには NVIDIA NGC で認証が必要です。
       1.  [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) で開発者アカウントを作成します（制裁対象国は不可）。
       2.  認証情報で `docker login nvcr.io` を実行します。
   *   **ビルドコマンド:**
       ```bash
       # Build Avarok image (General Purpose) - MUST use this tag to use local version over upstream
       docker build -t avarok/vllm-dgx-spark:v11 custom-docker-containers/avarok

      # Build the repo MXFP4 track used by GPT-OSS.
      # This bakes the manually downloaded tiktoken files into the image.
      docker build -t vllm-node-mxfp4 -f custom-docker-containers/vllm-node-mxfp4/Dockerfile .

      # Build the refreshed TF5 track used by GLM 4.7.
      docker build -t local/vllm-node-tf5:cu131 -f custom-docker-containers/vllm-node-tf5/Dockerfile .

      # Build the upstream-style TF5 track used by Gemma 4 and newer TF5 recipe imports.
      # The active Gemma compose services expect this exact local image tag.
      git clone https://github.com/eugr/spark-vllm-docker tmp/spark-vllm-docker 2>/dev/null || git -C tmp/spark-vllm-docker pull --ff-only
      (cd tmp/spark-vllm-docker && bash build-and-copy.sh --pre-tf)
       ```
   *   **注意:** `vllm-node-tf5` は現在、このリポジトリ内の Dockerfile からはビルドしません。Gemma 4 や新しい TF5 系 Qwen を使うなら、上記の upstream helper フローで明示的にビルドしてください。正確な再現手順とビルド時のネットワーク要件は [docs/runtime-baseline.md](docs/runtime-baseline.md) を参照してください。

5. **スタックを起動する**
   ```bash
   # Start gateway and waker only (models start on-demand)
   docker compose up -d

   # Pre-create all enabled model containers once the required local track images exist
   docker compose --profile models up --no-start
   ```

6. **API をテストする**
   ```bash
    # Request to the shipped utility helper
    curl -X POST http://localhost:8009/v1/qwen3.5-0.8b/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
          "model": "qwen3.5-0.8b",
       "messages": [{"role": "user", "content": "こんにちは！"}]
     }'
   ```

7. **サポートされている検証ハーネスを使う**
   最初の手動 `curl` が成功したら、アドホックスクリプトではなくリポジトリが保守している bring-up フローに切り替えてください。
   ```bash
   bash tools/validate-stack.sh
   bash tools/smoke-gateway.sh
   ```
   モデル固有の bring-up、smoke、soak、手動 probe コマンドは [tools/README.md](tools/README.md) を参照してください。

## 初めて使うならここから

- まず [README.md](README.md)、次に [docs/architecture.md](docs/architecture.md)、その次に [tools/README.md](tools/README.md) を読んでください。
- [tools/README.md](tools/README.md) と [models.json](models.json) を、現時点での運用上の真実のソースとして扱ってください。
- この README で検証済みとされていないモデルは、ハーネスで再確認されるまで実験的扱いにしてください。

## 前提条件
- Docker 20.10+ と Docker Compose
- CUDA 対応 NVIDIA GPU と NVIDIA Container Toolkit
- Linux ホスト（Ubuntu で検証）

## 貢献

Pull request はとても歓迎です。 :)
ただし安定性のため、**厳格な Pull Request Template** を適用しています。

## ⚠️ 既知の問題

### 現在の検証状況

現在のハーネスとリポジトリ既定値で、いま **検証済みのメインモデル** は次のものだけです。

- **`gpt-oss-20b`**
- **`gpt-oss-120b`**
- **`glm-4.7-flash-awq`**

同梱されている小型ヘルパー `qwen3.5-0.8b` は、タイトルやセッションメタデータ用の **検証済みユーティリティヘルパー** ですが、この検証済みメインモデル群には含まれません。

それ以外の利用可能なモデルも動く可能性はありますが、この検証済みユーティリティヘルパー以外は、現在のツール群で再検証されるまで **推奨デフォルトではなく実験的** とみなしてください。

### 実験的モデル（GB10 / CUDA 12.1 互換性）

以下のモデルは DGX Spark（GB10 GPU）上で断続的にクラッシュするため **実験的** としています。

- **Qwen3-Next-80B-A3B-Instruct** - 線形 attention 層でランダムにクラッシュ
- **Qwen3-Next-80B-A3B-Thinking** - 同じ問題

**根本原因:** GB10 GPU は CUDA 12.1 を使用しますが、現在の vLLM / PyTorch スタックは CUDA ≤12.0 しかサポートしていません。そのため、数回の成功後に `cudaErrorIllegalInstruction` が発生します。

**回避策:** 正しい GB10 対応を持つ更新済み vLLM イメージが出るまでは、安定した tool calling 用に `gpt-oss-20b` か `gpt-oss-120b` を使ってください。

### Nemotron 3 Nano 30B（NVFP4）

**`nemotron-3-nano-30b-nvfp4`** モデルは更新済み `vllm-node` 標準トラックで再有効化されましたが、現在のハーネスでは引き続き **実験的** として扱うべきです。
**現在の状況:** 更新済みランタイムでロードと応答は可能になりましたが、検証済みメインモデル群にも同梱 OpenCode 設定にもまだ含まれていません。
**重要な挙動:** 可視の assistant content は non-thinking リクエスト形状に依存します。通常の gateway リクエストでは request validator がその既定値を注入するようになっています。
**現在の保守的なクライアント上限:** OpenCode / Cline 風の手動利用では prompt token 約 `100000`。スタック上の 5 並列 soak は prompt token 約 `101776` で安定通過し、約 `116298` ではすでにぎりぎりです。

### Linux 上の OpenCode 画像 / スクリーンショット対応

OpenCode（ターミナル AI エージェント）には Linux 上で **クリップボード画像やファイルパス画像が vision モデルで使えない** 既知の不具合があります。VL モデル自体は API 経由で正しく動いていても、モデルは "The model you're using does not support image input" と返します。

**根本原因:** OpenCode の Linux クリップボード処理が、エンコード前に画像のバイナリを壊しています（`.arrayBuffer()` ではなく `.text()` を使用）。つまり実際には画像データがサーバーへ送られていません。

**状況:** OpenCode クライアント側のバグに見えます。調査や修正の協力は歓迎です。推論スタック自体は、`curl` などで正しく送られた base64 画像を問題なく処理できます。

**回避策:** `curl` などの API クライアントを使って、`qwen2.5-vl-7b` のような VL モデルに直接画像を送ってください。

### Qwen 2.5 Coder 7B と OpenCode の非互換

`qwen2.5-coder-7b-instruct` は **32,768 token** の厳格なコンテキスト制限を持っています。しかし OpenCode は通常、バッファ + 入力を合わせて **35,000 token** を超える大きなリクエストを送るため、`ValueError` で失敗します。

**推奨:** 長文コンテキスト用途で `qwen2.5-coder-7b` を OpenCode と組み合わせないでください。代わりに **`qwen3-coder-30b-instruct`** を使ってください。こちらは **65,536 token** のコンテキストをサポートし、大きな OpenCode リクエストをより余裕をもって処理できます。

### Llama 3.3 と OpenCode の非互換

**`llama-3.3-70b-instruct-fp4`** は **OpenCode には非推奨** です。
**理由:** API 経由では正しく動作する一方で、OpenCode 固有のクライアントプロンプトで初期化されると tool calling が過剰に攻撃的になります。その結果、たとえば挨拶直後にツールを呼ぼうとして検証エラーや体験劣化が起きます。
**推奨:** OpenCode セッションでは `gpt-oss-20b` か `qwen3-next-80b-a3b-instruct` を使ってください。

## クレジット

このスタックで使われる最適化済み Docker イメージを支えてくれたコミュニティメンバーに感謝します。

- **Avarok の Thomas P. Braun**: 非 gated activation（Nemotron）、ハイブリッドモデル対応の汎用 vLLM イメージ `avarok/vllm-dgx-spark` と、https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6 のような記事への貢献。
- **Christopher Owen**: DGX Spark で高性能推論を実現する MXFP4 最適化 vLLM イメージ `christopherowen/vllm-dgx-spark` への貢献。
- **eugr**: 元の vLLM イメージ `eugr/vllm-dgx-spark` のカスタマイズ全般と、NVIDIA Forums での素晴らしい発信。
- **Patrick Yi / scitrera.ai**: ローカル `qwen3.5-0.8b` helper パスの参考になった SGLang のユーティリティモデルレシピ。

## ライセンス

このプロジェクトは **Apache License 2.0** の下で提供されます。詳細は [LICENSE](LICENSE) を参照してください。
