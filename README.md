# Révis'Quiz

Petite application web (installable sur téléphone) qui transforme des photos de cours en quiz de révision, grâce à l'API Claude.

- **Créer** : jusqu'à 5 photos, matière, classe, chapitre, nombre de questions (5-20), difficulté.
- **Répondre** : QCM, vrai/faux, texte à trous, réponse courte, réponse rédigée. Correction à la fin, avec note et évaluation des réponses libres.
- **Historique** : revoir la correction, refaire, refaire les ratées, supprimer.

Aucun serveur : fichiers statiques (HTML/CSS/JS) hébergés sur GitHub Pages. Les quiz et la clé API restent dans le navigateur de l'appareil (`localStorage`). Les photos ne sont pas conservées.

## Clé API

1. Créer une clé dédiée sur https://console.anthropic.com (Settings → API Keys).
2. Fixer une limite de dépense mensuelle (Settings → Limits).
3. Saisir la clé dans l'appli (bouton ⚙️). Elle n'est jamais dans le code.

Modèle utilisé : `claude-sonnet-5-5` (constante `MODEL` dans `app.js`).

## Publication sur GitHub Pages

1. Créer un dépôt sur GitHub (ex. `revisquiz`) et y pousser le contenu de ce dossier.
2. Dans le dépôt : Settings → Pages → Source « Deploy from a branch », branche `main`, dossier `/ (root)`.
3. L'appli est disponible à `https://<pseudo>.github.io/revisquiz/`.

## Installation sur le téléphone

- **iPhone** (Safari) : bouton Partager → « Sur l'écran d'accueil ».
- **Android** (Chrome) : menu ⋮ → « Installer l'application ».

## Mise à jour

Après une modification, incrémenter `CACHE` dans `sw.js` (`revisquiz-v2`, …) pour que les téléphones récupèrent la nouvelle version.

## Sauvegarde

Réglages ⚙️ → Exporter / Importer (fichier JSON) pour changer de téléphone sans perdre l'historique.
