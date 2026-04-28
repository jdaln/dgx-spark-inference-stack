# DGX Spark Inference Stack - Faites-le servir la maison !

🌍 **Lisez ceci dans d'autres langues** :
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **Note de traduction IA :** Ce fichier a été traduit par une IA à partir de [README.md](README.md). Il peut contenir des erreurs ou être moins à jour que la version anglaise. En cas de doute, la README anglaise fait foi.

Votre Nvidia DGX Spark ne devrait pas être un projet secondaire de plus. Utilisez-le. Il s'agit d'une stack d'inférence basée sur Docker pour servir de grands modèles de langage (LLM) avec NVIDIA vLLM et une gestion intelligente des ressources. Cette stack fournit un chargement des modèles à la demande avec arrêt automatique à l'inactivité, une seule voie d'ordonnancement pour le modèle principal avec un assistant utilitaire optionnel, et une passerelle API unifiée.

Le but du projet est de fournir un serveur d'inférence pour la maison. Après l'avoir testé pendant un mois et avoir ajouté de nouveaux modèles, j'ai décidé de le publier pour la communauté. Merci de garder à l'esprit qu'il s'agit d'un projet hobby et que toute aide concrète pour l'améliorer est très appréciée. Il s'appuie sur des informations trouvées sur Internet et sur les forums NVIDIA. J'espère sincèrement que cela aidera les homelabs à avancer. L'accent est mis avant tout sur une seule DGX Spark et cela doit fonctionner dessus par défaut, mais le support de deux machines est bienvenu.

## Documentation

- **[Architecture et fonctionnement](docs/architecture.md)** - Comprendre la stack, le service waker et le flux des requêtes.
- **[Configuration](docs/configuration.md)** - Variables d'environnement, réglages réseau et tuning du waker.
- **[Guide de choix des modèles](docs/models.md)** - Catalogue actuel des modèles, sélection rapide et état de validation.
- **[Intégrations](docs/integrations.md)** - Guides pour **Cline** (VS Code) et **OpenCode** (agent terminal).
- **[Sécurité et accès distant](docs/security.md)** - Durcissement SSH et mise en place d'un transfert de ports restreint.
- **[Dépannage et supervision](docs/troubleshooting.md)** - Débogage, journaux et solutions aux erreurs courantes.
- **[Utilisation avancée](docs/advanced.md)** - Ajout de nouveaux modèles, configurations personnalisées et fonctionnement persistant.
- **[Base runtime](docs/runtime-baseline.md)** - Quelles images locales le dépôt attend et comment les reconstruire.
- **[Outils et harnais de validation](tools/README.md)** - Scripts pris en charge pour smoke, soak, inspection et sondes manuelles.
- **[Notes TODO](TODO.md)** - Idées pour la suite.

## Démarrage rapide

1. **Cloner le dépôt**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **Créer les répertoires nécessaires**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **Télécharger les tokenizers requis (CRITIQUE)**
   La stack nécessite le téléchargement manuel des fichiers `tiktoken` pour les modèles GPT-OSS.
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **Construire les images Docker personnalisées (OBLIGATOIRE)**
   La stack utilise des images vLLM optimisées qui doivent être construites localement pour garantir les meilleures performances.
   *   **Temps :** Comptez environ 20 minutes par image.
   *   **Authentification :** Vous devez vous authentifier auprès de NVIDIA NGC pour récupérer les images de base.
       1.  Créez un compte développeur sur [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) (il ne doit pas se trouver dans un pays sous sanctions).
       2.  Exécutez `docker login nvcr.io` avec vos identifiants.
      **Commandes de build :**
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
   *   **Note :** `vllm-node-tf5` n'est pas construit aujourd'hui à partir d'un Dockerfile local au dépôt. Si vous prévoyez d'exécuter Gemma 4 ou les nouveaux dérivés Qwen sur la voie TF5, construisez-le explicitement avec le flux helper upstream ci-dessus. Voir [docs/runtime-baseline.md](docs/runtime-baseline.md) pour les étapes exactes et les contraintes réseau au moment du build.

5. **Démarrer la stack**
   ```bash
   # Start gateway and waker only (models start on-demand)
   docker compose up -d

   # Pre-create all enabled model containers once the required local track images exist
   docker compose --profile models up --no-start
   ```

6. **Tester l'API**
   ```bash
    # Request to the shipped utility helper
    curl -X POST http://localhost:8009/v1/chat/completions\
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
          "model": "qwen3.5-0.8b",
       "messages": [{"role": "user", "content": "Bonjour !"}]
     }'
   ```

7. **Utiliser le harnais de validation pris en charge**
   Après le premier `curl` manuel réussi, passez au flux de mise en route maintenu par le dépôt plutôt qu'à des scripts ad hoc :
   ```bash
   bash tools/validate-stack.sh
   bash tools/smoke-gateway.sh
   ```
   Pour les commandes de bring-up, smoke, soak et sondes manuelles par modèle, voir [tools/README.md](tools/README.md).

## Commencez ici si vous débutez

- Lisez [docs/architecture.md](docs/architecture.md), puis [tools/README.md](tools/README.md).
- Traitez [tools/README.md](tools/README.md) et [models.json](models.json) comme la source opérationnelle de vérité actuelle.
- Considérez cette README comme une entrée courte, pas comme le catalogue complet des modèles. Utilisez [docs/models.md](docs/models.md) pour le catalogue plus large.

## Prérequis
- Docker 20.10+ avec Docker Compose
- GPU NVIDIA avec prise en charge CUDA et NVIDIA Container Toolkit
- Hôte Linux (testé sur Ubuntu)

## Contributions

Les pull requests sont les bienvenues. :)
Pour préserver la stabilité, j'applique toutefois un **modèle de pull request strict**.

## État actuel

Cette README ne met en avant que les choix par défaut actuellement recommandés de la stack.

- **Modèles principaux validés :** `gpt-oss-20b`, `gpt-oss-120b` et `glm-4.7-flash-awq`
- **Assistant utilitaire validé :** `qwen3.5-0.8b` pour les titres et les métadonnées de session
- **Tout le reste :** Présent dans le dépôt, mais pas un choix par défaut de cette README tant qu'il n'a pas été revalidé avec le harnais actuel

Pour le catalogue plus large des modèles, les voies expérimentales et les cas manuels, utilisez [docs/models.md](docs/models.md) et [models.json](models.json).

Pour les réserves côté client, les particularités runtime et les notes de dépannage, utilisez [docs/integrations.md](docs/integrations.md) et [docs/troubleshooting.md](docs/troubleshooting.md).

## Crédits

Remerciements particuliers aux membres de la communauté dont les images Docker et le travail sur les recettes ont inspiré cette stack :

- **Thomas P. Braun d'Avarok** : Pour l'image vLLM généraliste (`avarok/vllm-dgx-spark`) avec prise en charge des activations non gated (Nemotron), des modèles hybrides et des billets comme https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen** : Pour l'image vLLM optimisée MXFP4 (`christopherowen/vllm-dgx-spark`) permettant une inférence haute performance sur DGX Spark.
- **eugr** : Pour le dépôt communautaire vLLM DGX Spark d'origine (`eugr/spark-vllm-docker`), ses personnalisations et ses excellentes publications sur les forums NVIDIA.
- **Patrick Yi / scitrera.ai** : Pour la recette SGLang de modèle utilitaire qui a inspiré la voie locale de l'assistant `qwen3.5-0.8b`.
- **Raphael Amorim** : Pour la forme de recette AutoRound communautaire qui a inspiré la voie locale expérimentale `qwen3.5-122b-a10b-int4-autoround`.
- **Bjarke Bolding** : Pour la forme de recette AutoRound long contexte qui a inspiré la voie locale expérimentale `qwen3-coder-next-int4-autoround`.

## Licence

Ce projet est distribué sous la **licence Apache 2.0**. Voir le fichier [LICENSE](LICENSE) pour les détails.
