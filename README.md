# TEM 🐜 — Vision Board V1

Web app mobile-first haut de gamme, fond noir + néon rose, pensée pour être ajoutée à l’écran d’accueil.

> **🔒 Mise à jour 25 juin 2026 — sécurité** : faille XSS corrigée (les URL d'images injectées
> sont échappées, et l'import JSON ne garde que les vraies images `data:image/...`). Libellé notif
> corrigé (« 3 rappels » → « 2 »). Détails dans `CLAUDE.md` (section Journal sécurité).

## Fonctionnalités incluses

- PWA installable sur écran d’accueil
- Design mobile-first premium
- Mot de passe à la première utilisation
- Mot de passe activable/désactivable dans l’app
- Vision board avec photos
- Upload de photos depuis le téléphone
- Zoom / positionnement / taille des photos
- Blocs Vision déplaçables au doigt
- Appui long sur un bloc Vision = suppression par double confirmation
- Niveaux : Vision → Objectif → Sous-objectif → Action
- Actions cochables
- Barres de progression néon en direct
- Score global
- Messages dynamiques selon progression
- Notes globales dans “Le Nid”
- Notes par objectif
- Export / import JSON
- Sauvegarde locale dans le navigateur

## Hébergement simple

Tu peux héberger le dossier tel quel sur :

- Netlify Drop
- Vercel
- GitHub Pages
- n’importe quel hébergement statique

Aucune compilation n’est nécessaire.

## Important

La V1 sauvegarde les données uniquement dans le navigateur du téléphone.
Si elle change de téléphone ou vide Safari/Chrome, il faut utiliser l’export/import.

Le mot de passe est une protection locale simple, pas une sécurité bancaire.
Pour une vraie version multi-appareils, il faudra une V2 avec Supabase/Firebase.

## Structure

- `index.html` : structure de l’app
- `styles.css` : design premium mobile-first
- `app.js` : logique, données, interactions
- `manifest.json` : installation PWA
- `sw.js` : cache offline de base
- `assets/` : icônes
