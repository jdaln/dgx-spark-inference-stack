# DGX Spark Inference Stack - 自宅にサービスを！

> **免責事項:** このドキュメントはAIによって翻訳されており、誤りが含まれている可能性があります。

あなたのNvidia DGX Sparkは、ただのサイドプロジェクトであってはなりません。使い始めましょう！これは、NVIDIA vLLMとインテリジェントなリソース管理を使用して大規模言語モデル（LLM）を提供するためのDockerベースの推論スタックです。このスタックは、アイドル時の自動シャットダウン、シングルテナントGPUスケジューリング、および統合APIゲートウェイを備えたオンデマンドのモデルロードを提供します。

このプロジェクトの目標は、自宅向けの推論サーバーを提供することです。これを1ヶ月間テストし、新しいモデルを追加した後、コミュニティ向けにリリースすることにしました。これは趣味のプロジェクトであり、改善のための具体的な支援は大歓迎であることをご理解ください。これはインターネットやNVIDIAフォーラムで見つけた情報に基づいており、ホームラボの推進に役立つことを心から願っています。これは主に単一のDGX Sparkセットアップに焦点を当てており、デフォルトでそれで動作する必要がありますが、2台のサポートの追加も歓迎します。

## ドキュメント

- **[アーキテクチャと仕組み](docs/architecture.md)** - スタック、wakerサービス、およびリクエストフローの理解。
- **[設定](docs/configuration.md)** - 環境変数、ネットワーク設定、およびwakerチューニング。
- **[モデル選択ガイド](docs/models.md)** - 29以上のサポートされているモデルの詳細リスト、クイックセレクター、および使用例。
- **[統合](docs/integrations.md)** - **Cline** (VS Code) および **OpenCode** (ターミナルエージェント) のガイド。
- **[セキュリティとリモートアクセス](docs/security.md)** - SSHの強化と制限付きポート転送の設定。
- **[トラブルシューティングとモニタリング](docs/troubleshooting.md)** - デバッグ、ログ、および一般的なエラーの解決策。
- **[高度な使用法](docs/advanced.md)** - 新しいモデルの追加、カスタム設定、および永続的な運用。
- **[TODOメモ](TODO.md)** - 次に何をすべきかについてのアイデア。

## クイックスタート

1. **リポジトリのクローン**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **必要なディレクトリの作成**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **必要なトークナイザーのダウンロード（重要）**
   このスタックでは、GPT-OSSモデル用のtiktokenファイルを手動でダウンロードする必要があります。
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **カスタムDockerイメージのビルド（必須）**
   このスタックは、最大のパフォーマンスを確保するためにローカルでビルドする必要があるカスタム最適化されたvLLMイメージを使用します。
   *   **時間:** イメージごとに約20分かかります。
   *   **認証:** ベースイメージをプルするには、NVIDIA NGCで認証する必要があります。
       1.  [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) で開発者アカウントを作成します（制裁対象国にあってはなりません）。
       2.  認証情報を使用して `docker login nvcr.io` を実行します。
   *   **ビルドコマンド:**
       ```bash
       # Avarokイメージのビルド（汎用） - アップストリームではなくローカルバージョンを使用するには、このタグを使用する必要があります
       docker build -t avarok/vllm-dgx-spark:v11 custom-docker-containers/avarok

       # Christopher Owenイメージのビルド（MXFP4最適化）
       docker build -t christopherowen/vllm-dgx-spark:v12 custom-docker-containers/christopherowen
       ```

5. **スタックの開始**
   ```bash
   # ゲートウェイとwakerのみを開始（モデルはオンデマンドで開始）
   docker compose up -d

   # すべての有効なモデルコンテナを事前に作成（推奨）
   docker compose --profile models up --no-start
   ```

6. **APIのテスト**
   ```bash
   # qwen2.5-1.5bへのリクエスト（自動的に開始されます）
   curl -X POST http://localhost:8009/v1/qwen2.5-1.5b-instruct/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
       "model": "qwen2.5-1.5b-instruct",
       "messages": [{"role": "user", "content": "こんにちは！"}]
     }'
   ```

## 前提条件
- Docker 20.10+ と Docker Compose
- NVIDIA GPU（CUDAサポート付き）および NVIDIA Container Toolkit
- Linuxホスト（Ubuntuでテスト済み）

## 貢献

プルリクエストは大歓迎です。 :)
ただし、安定性を確保するために、厳格な **プルリクエストテンプレート** を適用しています。

## ⚠️ 既知の問題

### 実験的モデル（GB10/CUDA 12.1の互換性）

以下のモデルは、DGX Spark（GB10 GPU）での散発的なクラッシュのため、**実験的** とマークされています：

- **Qwen3-Next-80B-A3B-Instruct** - 線形アテンションレイヤーでランダムにクラッシュする
- **Qwen3-Next-80B-A3B-Thinking** - 同じ問題

**根本原因:** GB10 GPUはCUDA 12.1を使用していますが、現在のvLLM/PyTorchスタックはCUDA ≤12.0のみをサポートしています。これにより、数回の成功したリクエストの後に `cudaErrorIllegalInstruction` エラーが発生します。

**回避策:** 適切なGB10サポートを備えた更新されたvLLMイメージが利用可能になるまで、安定したツール呼び出しのために `gpt-oss-20b` または `gpt-oss-120b` を使用してください。

### Nemotron 3 Nano 30B (NVFP4)

**`nemotron-3-nano-30b-nvfp4`** モデルは現在無効になっています。
**理由:** GB10での現在のvLLMビルドと互換性がありません。適切なV1エンジンのサポートまたは更新されたバックエンドの実装が必要です。


### LinuxでのOpenCode画像/スクリーンショットサポート

OpenCode（ターミナルAIエージェント）には、Linux上で **クリップボード画像とファイルパス画像が機能しない** という既知のバグがあります。VLモデルがAPI経由で正しく動作していても、モデルは「使用しているモデルは画像入力をサポートしていません」と応答します。

**根本原因:** OpenCodeのLinuxクリップボード処理は、エンコード前にバイナリ画像データを破損させます（`.arrayBuffer()` の代わりに `.text()` を使用）。実際の画像データはサーバーに送信されません。

**ステータス:** これはクライアント側のOpenCodeのバグのようです。調査/修正の支援は大歓迎です！推論スタックは、適切に送信された場合、base64画像を正しく処理します（curl経由で検証済み）。

**回避策:** curlまたは他のAPIクライアントを使用して、画像を `qwen2.5-vl-7b` などのVLモデルに直接送信してください。

### Qwen 2.5 Coder 7B と OpenCode の非互換性

`qwen2.5-coder-7b-instruct` モデルには、**32,768トークン** の厳格なコンテキスト制限があります。しかし、OpenCodeは通常、**35,000トークン** を超える非常に大きなリクエスト（バッファ + 入力）を送信し、`ValueError` とリクエストの失敗を引き起こします。

**推奨事項:** 長いコンテキストのタスクには、OpenCodeで `qwen2.5-coder-7b` を使用しないでください。代わりに、**65,536トークン** のコンテキストをサポートし、OpenCodeの大きなリクエストを快適に処理できる **`qwen3-coder-30b-instruct`** を使用してください。

### Llama 3.3 と OpenCode の非互換性

**`llama-3.3-70b-instruct-fp4`** モデルは、**OpenCodeでの使用は推奨されません**。
**理由:** モデルはAPI経由で正しく動作しますが、OpenCodeの特定のクライアントプロンプトによって初期化されると、積極的なツール呼び出し動作を示します。これにより、検証エラーが発生し、ユーザーエクスペリエンスが低下します（例：挨拶の直後にツールを呼び出そうとする）。
**推奨事項:** 代わりに、OpenCodeセッションには `gpt-oss-20b` または `qwen3-next-80b-a3b-instruct` を使用してください。

## クレジット

このスタックで使用される最適化されたDockerイメージを作成したコミュニティメンバーに特別な感謝を捧げます：

- **AvarokのThomas P. Braun**: ノンゲートアクティベーション（Nemotron）とハイブリッドモデルをサポートする汎用vLLMイメージ（`avarok/vllm-dgx-spark`）と、このような投稿 https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6 に対して。
- **Christopher Owen**: DGX Sparkでの高性能推論を可能にするMXFP4最適化vLLMイメージ（`christopherowen/vllm-dgx-spark`）に対して。
- **eugr**: オリジナルのvLLMイメージ（`eugr/vllm-dgx-spark`）のカスタマイズに関するすべての作業と、NVIDIAフォーラムでの素晴らしい投稿に対して。

### モデルプロバイダー

FP4/FP8推論のためにこれらのモデルを最適化している組織に深く感謝します：

- **Fireworks AI** (`Firworks`): GLM-4.5、Llama 3.3、Ministralを含む幅広い最適化モデルに対して。
- **NVIDIA**: Qwen3-Next、Nemotron、標準的なFP4実装に対して。
- **RedHat**: Qwen3-VLとMistral Smallに対して。
- **QuantTrio**: Qwen3-VL-Thinkingに対して。
- **OpenAI**: GPT-OSSモデルに対して。

## ライセンス

このプロジェクトは **Apache License 2.0** の下でライセンスされています。詳細については [LICENSE](LICENSE) ファイルを参照してください。
