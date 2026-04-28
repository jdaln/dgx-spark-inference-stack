# DGX Spark Inference Stack - 自宅で使い倒そう！

🌍 **他の言語で読む**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **AI翻訳に関する注意:** このファイルは [README.md](README.md) を元に AI で翻訳したものです。誤りを含む可能性があり、英語版より更新が遅れている場合があります。迷った場合は英語版 README を正としてください。

あなたの Nvidia DGX Spark は、ただのサイドプロジェクトで終わるべきではありません。実際に使いましょう。これは NVIDIA vLLM と賢いリソース管理を使って大規模言語モデル（LLM）を提供するための Docker ベース推論スタックです。このスタックは、アイドル時の自動停止付きオンデマンドロード、任意のユーティリティヘルパーを伴う単一のメインモデル用スケジューリングレーン、そして統一 API ゲートウェイを提供します。

このプロジェクトの目的は、自宅向けの推論サーバーを提供することです。1か月ほどテストし、新しいモデルも追加した上で、コミュニティ向けに公開することにしました。これはホビープロジェクトなので、改善のための具体的な助けはとても歓迎です。インターネット上の情報や NVIDIA フォーラムの知見を元にしており、ホームラボの前進に少しでも役立てばと思っています。主な対象は単一の DGX Spark 構成で、まずはそこできちんと動くことを重視していますが、2 台構成のサポートも歓迎します。

## ドキュメント

- **[アーキテクチャと仕組み](docs/architecture.md)** - スタック、waker サービス、リクエストフローを理解する。
- **[設定](docs/configuration.md)** - 環境変数、ネットワーク設定、waker のチューニング。
- **[モデル選択ガイド](docs/models.md)** - 現在のモデルカタログ、クイックチョイサー、検証状況。
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
      **ビルドコマンド:**
      ```bash
      # Build Avarok image (General Purpose) - MUST use this tag to use local version over upstream.
      # Build from the repo root so the manually downloaded tokenizer files are included.
      docker build -t avarok/vllm-dgx-spark:v11 -f custom-docker-containers/avarok/Dockerfile .

      # If you want compose services that default to the pinned upstream Avarok image
      # to use your local rebuild instead, export this override for the current shell
      # or place it in .env before running docker compose.
      export VLLM_TRACK_AVAROK=avarok/vllm-dgx-spark:v11

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
    curl -X POST http://localhost:8009/v1/chat/completions\
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

- まず [docs/architecture.md](docs/architecture.md)、その次に [tools/README.md](tools/README.md) を読んでください。
- [tools/README.md](tools/README.md) と [models.json](models.json) を、現時点での運用上の真実のソースとして扱ってください。
- この README は短い入口として扱い、完全なモデルカタログとしては扱わないでください。より広いカタログは [docs/models.md](docs/models.md) を使ってください。

## 前提条件
- Docker 20.10+ と Docker Compose
- CUDA 対応 NVIDIA GPU と NVIDIA Container Toolkit
- Linux ホスト（Ubuntu で検証）

## 貢献

Pull request はとても歓迎です。 :)
ただし安定性のため、**厳格な Pull Request Template** を適用しています。

## 現在の状況

この README では、現在このスタックで推奨される既定パスだけを簡潔に扱います。

- **検証済みメインモデル:** `gpt-oss-20b`、`gpt-oss-120b`、`glm-4.7-flash-awq`
- **検証済みユーティリティヘルパー:** タイトルとセッションメタデータ用の `qwen3.5-0.8b`
- **それ以外:** リポジトリにはありますが、現行ハーネスで再検証されるまで README の既定選択ではありません

より広いモデルカタログ、実験的なレーン、手動専用パスについては [docs/models.md](docs/models.md) と [models.json](models.json) を使ってください。

クライアント側の注意点、runtime の癖、トラブルシューティングのメモについては [docs/integrations.md](docs/integrations.md) と [docs/troubleshooting.md](docs/troubleshooting.md) を使ってください。

## クレジット

このスタックの参考になった Docker イメージとレシピ作業を提供してくれたコミュニティメンバーに感謝します。

- **Avarok の Thomas P. Braun**: 非 gated activation（Nemotron）、ハイブリッドモデル対応の汎用 vLLM イメージ `avarok/vllm-dgx-spark` と、https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6 のような記事への貢献。
- **Christopher Owen**: DGX Spark で高性能推論を実現する MXFP4 最適化 vLLM イメージ `christopherowen/vllm-dgx-spark` への貢献。
- **eugr**: DGX Spark 向けコミュニティ vLLM リポジトリ `eugr/spark-vllm-docker`、その各種カスタマイズ、そして NVIDIA Forums での素晴らしい発信。
- **Patrick Yi / scitrera.ai**: ローカル `qwen3.5-0.8b` helper パスの参考になった SGLang のユーティリティモデルレシピ。
- **Raphael Amorim**: 実験的なローカル `qwen3.5-122b-a10b-int4-autoround` レーンの参考になったコミュニティ AutoRound レシピ構成。
- **Bjarke Bolding**: 実験的なローカル `qwen3-coder-next-int4-autoround` レーンの参考になった長文脈向け AutoRound レシピ構成。

## ライセンス

このプロジェクトは **Apache License 2.0** の下で提供されます。詳細は [LICENSE](LICENSE) を参照してください。
