# DGX Spark Inference Stack - Servez la maison !

> **Avertissement :** Ce document a été traduit par une IA et peut contenir des erreurs.

Votre Nvidia DGX Spark ne devrait pas être un autre projet secondaire. Commencez à l'utiliser ! Il s'agit d'une stack d'inférence basée sur Docker pour servir de grands modèles de langage (LLMs) utilisant NVIDIA vLLM avec une gestion intelligente des ressources. Cette stack permet le chargement de modèles à la demande avec arrêt automatique en cas d'inactivité, planification GPU mono-locataire et une passerelle API unifiée.

L'objectif du projet est de fournir un serveur d'inférence pour votre domicile. Après avoir testé cela et ajouté de nouveaux modèles pendant un mois, j'ai décidé de le publier pour la communauté. Veuillez comprendre qu'il s'agit d'un projet amateur et qu'une aide concrète pour l'améliorer est très appréciée. Il est basé sur des informations que j'ai trouvées sur Internet et sur les forums NVIDIA ; j'espère vraiment qu'il aidera à faire avancer les homelabs. Ceci est principalement axé sur la configuration DGX Spark unique et doit fonctionner par défaut, mais l'ajout de la prise en charge de 2 est le bienvenu.

## Documentation

- **[Architecture & Fonctionnement](docs/architecture.md)** - Comprendre la stack, le service waker et le flux des requêtes.
- **[Configuration](docs/configuration.md)** - Variables d'environnement, paramètres réseau et réglage du waker.
- **[Guide de Sélection des Modèles](docs/models.md)** - Liste détaillée de 29+ modèles pris en charge, sélecteur rapide et cas d'utilisation.
- **[Intégrations](docs/integrations.md)** - Guides pour **Cline** (VS Code) et **OpenCode** (Agent Terminal).
- **[Sécurité & Accès à Distance](docs/security.md)** - Renforcement SSH et configuration de la redirection de port restreinte.
- **[Dépannage & Surveillance](docs/troubleshooting.md)** - Débogage, journaux et solutions aux erreurs courantes.
- **[Utilisation Avancée](docs/advanced.md)** - Ajout de nouveaux modèles, configurations personnalisées et fonctionnement persistant.
- **[Notes TODO](TODO.md)** - Idées que j'ai pour la suite.

## Démarrage Rapide

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
   La stack nécessite le téléchargement manuel des fichiers tiktoken pour les modèles GPT-OSS.
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **Construire des Images Docker Personnalisées (OBLIGATOIRE)**
   La stack utilise des images vLLM optimisées personnalisées qui doivent être construites localement pour assurer des performances maximales.
   *   **Temps :** Comptez ~20 minutes par image.
   *   **Auth :** Vous devez vous authentifier auprès de NVIDIA NGC pour extraire les images de base.
       1.  Créez un compte développeur sur [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) (ne doit pas être dans un pays sanctionné).
       2.  Exécutez `docker login nvcr.io` avec vos identifiants.
   *   **Commandes de Build :**
       ```bash
       # Construire l'image Avarok (Usage Général) - DOIT utiliser ce tag pour utiliser la version locale plutôt que l'amont
       docker build -t avarok/vllm-dgx-spark:v11 custom-docker-containers/avarok

       # Construire l'image Christopher Owen (Optimisée MXFP4)
       docker build -t christopherowen/vllm-dgx-spark:v12 custom-docker-containers/christopherowen
       ```

5. **Démarrer la stack**
   ```bash
   # Démarrer la passerelle et le waker uniquement (les modèles démarrent à la demande)
   docker compose up -d

   # Pré-créer tous les conteneurs de modèles activés (recommandé)
   docker compose --profile models up --no-start
   ```

6. **Tester l'API**
   ```bash
   # Requête vers qwen2.5-1.5b (démarrera automatiquement)
   curl -X POST http://localhost:8009/v1/qwen2.5-1.5b-instruct/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
       "model": "qwen2.5-1.5b-instruct",
       "messages": [{"role": "user", "content": "Bonjour !"}]
     }'
   ```

## Prérequis
- Docker 20.10+ avec Docker Compose
- GPU(s) NVIDIA avec support CUDA et NVIDIA Container Toolkit
- Hôte Linux (testé sur Ubuntu)

## Contribuer

Les Pull Requests sont très bienvenues. :)
Cependant, pour assurer la stabilité, j'applique un strict **Modèle de Pull Request**.

## ⚠️ Problèmes Connus

### Modèles Expérimentaux (Compatibilité GB10/CUDA 12.1)

Les modèles suivants sont marqués comme **expérimentaux** en raison de plantages sporadiques sur DGX Spark (GPU GB10) :

- **Qwen3-Next-80B-A3B-Instruct** - Plante aléatoirement dans la couche d'attention linéaire
- **Qwen3-Next-80B-A3B-Thinking** - Même problème

**Cause racine :** Le GPU GB10 utilise CUDA 12.1, mais la stack vLLM/PyTorch actuelle ne prend en charge que CUDA ≤12.0. Cela provoque des erreurs `cudaErrorIllegalInstruction` après plusieurs requêtes réussies.

**Solution de contournement :** Utilisez `gpt-oss-20b` ou `gpt-oss-120b` pour des appels d'outils stables jusqu'à ce qu'une image vLLM mise à jour avec un support GB10 approprié soit disponible.

### Nemotron 3 Nano 30B (NVFP4)

Le modèle **`nemotron-3-nano-30b-nvfp4`** est actuellement désactivé.
**Raison :** Incompatible avec le build vLLM actuel sur GB10. Nécessite un support moteur V1 approprié ou une implémentation backend mise à jour.


### Support Image/Capture d'écran OpenCode sur Linux

OpenCode (agent AI terminal) a un bug connu sur Linux où **les images du presse-papiers et les images par chemin de fichier ne fonctionnent pas** avec les modèles de vision. Le modèle répond par "The model you're using does not support image input" même si les modèles VL fonctionnent correctement via API.

**Cause racine :** La gestion du presse-papiers Linux d'OpenCode corrompt les données d'image binaires avant l'encodage (utilise `.text()` au lieu de `.arrayBuffer()`). Aucune donnée d'image réelle n'est envoyée au serveur.

**Statut :** Cela semble être un bug côté client OpenCode. Toute aide pour enquêter/corriger est la bienvenue ! La stack d'inférence gère correctement les images base64 lorsqu'elles sont envoyées correctement (vérifié via curl).

**Solution de contournement :** Utilisez curl ou d'autres clients API pour envoyer des images directement aux modèles VL comme `qwen2.5-vl-7b`.

### Incompatibilité Qwen 2.5 Coder 7B & OpenCode

Le modèle `qwen2.5-coder-7b-instruct` a une limite de contexte stricte de **32 768 tokens**. Cependant, OpenCode envoie généralement de très grandes requêtes (buffer + entrée) dépassant **35 000 tokens**, provoquant une `ValueError` et des échecs de requête.

**Recommandation :** N'utilisez pas `qwen2.5-coder-7b` avec OpenCode pour des tâches à long contexte. Utilisez plutôt **`qwen3-coder-30b-instruct`** qui prend en charge **65 536 tokens** de contexte et gère confortablement les grandes requêtes d'OpenCode.

### Incompatibilité Llama 3.3 & OpenCode

Le modèle **`llama-3.3-70b-instruct-fp4`** n'est **pas recommandé pour une utilisation avec OpenCode**.
**Raison :** Bien que le modèle fonctionne correctement via API, il présente un comportement d'appel d'outil agressif lorsqu'il est initialisé par les prompts clients spécifiques d'OpenCode. Cela entraîne des erreurs de validation et une expérience utilisateur dégradée (par exemple, essayer d'appeler des outils immédiatement après la salutation).
**Recommandation :** Utilisez `gpt-oss-20b` ou `qwen3-next-80b-a3b-instruct` pour les sessions OpenCode à la place.

## Crédits

Un grand merci aux membres de la communauté qui ont réalisé les images Docker optimisées utilisées dans cette stack :

- **Thomas P. Braun d'Avarok** : Pour l'image vLLM à usage général (`avarok/vllm-dgx-spark`) avec prise en charge des activations non contrôlées (Nemotron) et des modèles hybrides, et des articles comme celui-ci https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen** : Pour l'image vLLM optimisée MXFP4 (`christopherowen/vllm-dgx-spark`) permettant une inférence haute performance sur DGX Spark.
- **eugr** : Pour tout le travail sur les personnalisations de l'image vLLM originale (`eugr/vllm-dgx-spark`) et les excellents messages sur les forums NVIDIA.

### Fournisseurs de Modèles

Un immense merci aux organisations optimisant ces modèles pour l'inférence FP4/FP8 :

- **Fireworks AI** (`Firworks`) : Pour une large gamme de modèles optimisés, notamment GLM-4.5, Llama 3.3 et Ministral.
- **NVIDIA** : Pour Qwen3-Next, Nemotron et les implémentations FP4 standard.
- **RedHat** : Pour Qwen3-VL et Mistral Small.
- **QuantTrio** : Pour Qwen3-VL-Thinking.
- **OpenAI** : Pour les modèles GPT-OSS.

## Licence

Ce projet est sous licence **Apache License 2.0**. Voir le fichier [LICENSE](LICENSE) pour plus de détails.
