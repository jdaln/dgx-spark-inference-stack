# DGX Spark Inference Stack - Faites-le servir la maison !

🌍 **Lisez ceci dans d'autres langues** :
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **Note de traduction IA :** Ce fichier a été traduit par une IA à partir de [README.md](README.md). Il peut contenir des erreurs ou être moins à jour que la version anglaise. En cas de doute, la README anglaise fait foi.

Votre Nvidia DGX Spark ne devrait pas être un projet secondaire de plus. Utilisez-le. Il s'agit d'une stack d'inférence basée sur Docker pour servir de grands modèles de langage (LLM) avec NVIDIA vLLM et une gestion intelligente des ressources. Cette stack fournit un chargement des modèles à la demande avec arrêt automatique à l'inactivité, une seule voie d'ordonnancement pour le modèle principal avec un assistant utilitaire optionnel, et une passerelle API unifiée.

Le but du projet est de fournir un serveur d'inférence pour la maison. Après l'avoir testé pendant un mois et avoir ajouté de nouveaux modèles, j'ai décidé de le publier pour la communauté. Merci de garder à l'esprit qu'il s'agit d'un projet hobby et que toute aide concrète pour l'améliorer est très appréciée. Il s'appuie sur des informations trouvées sur Internet et sur les forums NVIDIA. J'espère sincèrement que cela aidera les homelabs à avancer. L'accent est mis avant tout sur une seule DGX Spark et cela doit fonctionner dessus par défaut, mais le support de deux machines est bienvenu.

## Documentation

- **[Architecture et fonctionnement](docs/architecture.md)** - Comprendre la stack, le service waker et le flux des requêtes.
- **[Configuration](docs/configuration.md)** - Variables d'environnement, réglages réseau et tuning du waker.
- **[Guide de choix des modèles](docs/models.md)** - Liste détaillée de plus de 29 modèles pris en charge, sélection rapide et cas d'usage.
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
   *   **Commandes de build :**
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
    curl -X POST http://localhost:8009/v1/qwen3.5-0.8b/chat/completions \
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

- Lisez [README.md](README.md), puis [docs/architecture.md](docs/architecture.md), puis [tools/README.md](tools/README.md).
- Traitez [tools/README.md](tools/README.md) et [models.json](models.json) comme la source opérationnelle de vérité actuelle.
- Considérez comme expérimentaux les modèles qui ne font pas partie de l'ensemble validé dans cette README tant que le harnais n'indique pas le contraire.

## Prérequis
- Docker 20.10+ avec Docker Compose
- GPU NVIDIA avec prise en charge CUDA et NVIDIA Container Toolkit
- Hôte Linux (testé sur Ubuntu)

## Contributions

Les pull requests sont les bienvenues. :)
Pour préserver la stabilité, j'applique toutefois un **modèle de pull request strict**.

## ⚠️ Problèmes connus

### État actuel de la validation

Avec le harnais actuel et les valeurs par défaut du dépôt, les seuls **modèles principaux validés** à ce jour sont :

- **`gpt-oss-20b`**
- **`gpt-oss-120b`**
- **`glm-4.7-flash-awq`**

Le petit assistant `qwen3.5-0.8b` fourni est désormais l'**assistant utilitaire validé** pour les titres et les métadonnées de session, mais il ne fait pas partie de cet ensemble de modèles principaux validés.

Les autres modèles disponibles peuvent fonctionner, mais au-delà de cet assistant utilitaire validé ils doivent être considérés comme **expérimentaux** plutôt que comme des choix par défaut recommandés tant qu'ils n'ont pas été re-testés avec l'outillage actuel.

### Modèles expérimentaux (compatibilité GB10 / CUDA 12.1)

Les modèles suivants sont marqués comme **expérimentaux** à cause de plantages sporadiques sur DGX Spark (GPU GB10) :

- **Qwen3-Next-80B-A3B-Instruct** - Plante aléatoirement dans la couche d'attention linéaire
- **Qwen3-Next-80B-A3B-Thinking** - Même problème

**Cause racine :** Le GPU GB10 utilise CUDA 12.1, mais la stack vLLM/PyTorch actuelle ne prend en charge que CUDA ≤12.0. Cela provoque des erreurs `cudaErrorIllegalInstruction` après plusieurs requêtes réussies.

**Contournement :** Utilisez `gpt-oss-20b` ou `gpt-oss-120b` pour un tool calling stable jusqu'à ce qu'une image vLLM mise à jour avec un vrai support GB10 soit disponible.

### Nemotron 3 Nano 30B (NVFP4)

Le modèle **`nemotron-3-nano-30b-nvfp4`** est de nouveau activé sur la voie standard `vllm-node` actualisée, mais il doit toujours être traité comme **expérimental** avec le harnais actuel.
**État actuel :** Il charge désormais et répond aux requêtes sur le runtime rafraîchi, mais il ne fait pas partie de l'ensemble des modèles principaux validés ni de la configuration OpenCode livrée.
**Comportement important :** Le contenu visible de l'assistant dépend d'une forme de requête sans thinking. Le validateur de requêtes injecte maintenant cette valeur par défaut pour les requêtes normales via la passerelle.
**Plafond client conservateur actuel :** Environ `100000` tokens de prompt pour un usage manuel de type OpenCode/Cline. Le soak à cinq voies de la stack passe proprement vers `101776` tokens de prompt et devient déjà limite vers `116298`.

### Prise en charge des images/captures OpenCode sur Linux

OpenCode (agent IA en terminal) a un bug connu sous Linux où **les images du presse-papiers et les images passées par chemin de fichier ne fonctionnent pas** avec les modèles de vision. Le modèle répond par "The model you're using does not support image input" alors que les modèles VL fonctionnent correctement via l'API.

**Cause racine :** La gestion du presse-papiers Linux d'OpenCode corrompt les données binaires de l'image avant l'encodage (utilise `.text()` au lieu de `.arrayBuffer()`). Aucune donnée image n'est donc réellement envoyée au serveur.

**État :** Cela ressemble à un bug côté client OpenCode. Toute aide pour l'investiguer ou le corriger est bienvenue. La stack d'inférence gère correctement les images base64 lorsqu'elles sont envoyées proprement via `curl` ou un autre client API.

**Contournement :** Utilisez `curl` ou un autre client API pour envoyer directement des images aux modèles VL comme `qwen2.5-vl-7b`.

### Qwen 2.5 Coder 7B et incompatibilité OpenCode

Le modèle `qwen2.5-coder-7b-instruct` a une limite stricte de **32 768 tokens**. Or OpenCode envoie généralement de très grosses requêtes (tampon + entrée) dépassant **35 000 tokens**, ce qui provoque un `ValueError` et l'échec des requêtes.

**Recommandation :** N'utilisez pas `qwen2.5-coder-7b` avec OpenCode pour des tâches long contexte. Utilisez plutôt **`qwen3-coder-30b-instruct`**, qui prend en charge **65 536 tokens** de contexte et encaisse beaucoup mieux les grosses requêtes OpenCode.

### Llama 3.3 et incompatibilité OpenCode

Le modèle **`llama-3.3-70b-instruct-fp4`** est **déconseillé avec OpenCode**.
**Raison :** Même si le modèle fonctionne correctement via l'API, il montre un comportement de tool calling agressif quand il est initialisé avec les prompts spécifiques du client OpenCode. Cela entraîne des erreurs de validation et une expérience dégradée, par exemple lorsqu'il tente d'appeler des outils dès le message de salutation.
**Recommandation :** Utilisez `gpt-oss-20b` ou `qwen3-next-80b-a3b-instruct` pour les sessions OpenCode.

## Crédits

Remerciements particuliers aux membres de la communauté qui ont rendu possibles les images Docker optimisées utilisées par cette stack :

- **Thomas P. Braun d'Avarok** : Pour l'image vLLM généraliste (`avarok/vllm-dgx-spark`) avec prise en charge des activations non gated (Nemotron), des modèles hybrides et des billets comme https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen** : Pour l'image vLLM optimisée MXFP4 (`christopherowen/vllm-dgx-spark`) permettant une inférence haute performance sur DGX Spark.
- **eugr** : Pour tout le travail sur les personnalisations de l'image vLLM d'origine (`eugr/vllm-dgx-spark`) et pour ses excellentes publications sur les forums NVIDIA.
- **Patrick Yi / scitrera.ai** : Pour la recette SGLang de modèle utilitaire qui a inspiré la voie locale de l'assistant `qwen3.5-0.8b`.

## Licence

Ce projet est distribué sous la **licence Apache 2.0**. Voir le fichier [LICENSE](LICENSE) pour les détails.
