# TEM Board — CLAUDE.md

## Projet
PWA 100% statique (HTML/CSS/JS vanilla). Aucun build, aucun framework, aucune dépendance npm.
Déployé sur Render Static Site : https://tem-boatd.onrender.com
GitHub : https://github.com/leoderoudilhe-cell/TEM-boatd (note: "boatd" typo volontaire)

## Architecture fichiers
```
index.html   — structure DOM, template vision card, sections de vue
styles.css   — design system complet + animations
app.js       — toute la logique (state, render, events)
sw.js        — service worker network-first (CACHE_NAME: tem-board-v4) + handlers push/notificationclick
manifest.json — PWA manifest
assets/      — icon-192.png, icon-512.png (fourmi 🐜 rasterisée), icon.svg
GUIDE.md     — guide d'utilisation pour l'utilisatrice finale
```
Backend notifs séparé (hors de ce repo) : `/Users/derouds/DEV/tem-backend` → repo privé `leoderoudilhe-cell/tem-backend`. Voir section "Notifications push".

## State (localStorage: "tem-board-v1")
```js
{
  settings: { passwordEnabled, passwordHash, hasCompletedSetup, firstName, notifEnabled },
  globalNotes: string,
  visions: [{ id, title, subtitle, category, image (base64), size, linkedObjectiveId, tune:{scale,x,y} }],
  objectives: [{ id, title, why, color, visionId, subgoals:[{ id, title, actions:[{id,text,done,priority?,doneAt?}] }], notes }],
  streak: { count, lastActiveDay },
  today: { date, picks:[{ objectiveId, subId, actionId, text, objTitle }] },
}
```

## Conventions code
- Pas de framework, pas de classes ES6 pour l'état — mutations directes sur `state`
- `saveState({ silent: true })` pour auto-save sans toast
- `renderAll()` re-rend tout sauf le contenu du sheet actif
- IDs générés avec `uid(prefix)` — format: `prefix_timestampBase36_random`
- `escapeHtml()` / `escapeAttr()` obligatoires sur tout contenu utilisateur injecté en innerHTML
- `$` et `$$` sont des alias de `querySelector` / `querySelectorAll`

## Couleurs objectifs (OBJ_COLORS)
pink, violet, gold, green, blue, red — chaque objectif stocke `color: "pink"` etc.
Le CSS utilise `--obj-c` (CSS custom property) sur chaque `.objective-card`.

## Tabs (ordre fixe)
Vision → Objectives → Focus → Today → Nest → Settings
`TAB_ORDER` dans app.js, `_currentTabIdx` pour le swipe.
Au boot, `showApp()` ouvre direct sur Today si un Top 3 est déjà choisi pour le jour.

## Lexique UI (clés internes → mot affiché)
Objectives → **Objectif** · subgoals → **Étape** · Focus → **Actions** · Today → **Top 3** · Nest → **Nid**.
Garder ces mots dans les libellés ; ne pas réintroduire "Pilier" / "Mission" / "sous-objectif".

## Features V2 (toutes implémentées)
1. Score animé au boot (animateHero + animateCounter easeOutQuart 1.9s)
2. Drag-to-dismiss sheet (pointer capture sur .sheet-handle, seuil 90px)
3. Streak badge (🔥 à partir de 2 jours consécutifs)
4. Hero bg dynamique (première vision avec photo, blur 26px)
5. Couleur accent par objectif (6 swatches dans l'éditeur)
6. Milestones 25/50/75/100% (confetti tiered + vibrate)
7. Swipe horizontal tabs (touchstart/end sur #mainApp, seuil 65px)
8. Vision viewer plein écran (swipe entre visions, dots nav)
9. Top 3 du jour (picker max 3 actions, reset chaque nouveau jour)

## Évolutions post-V2
- Terminologie unifiée (voir Lexique UI)
- Rituel quotidien : ouverture directe sur Top 3 ; streak entretenu à la planification du Top 3 ; streak visible dès J1
- Action prioritaire (★, champ `priority`) : remonte en tête du picker Top 3
- Bilan de la semaine (`renderWeeklyReview` dans le Nid) basé sur `doneAt` ; libellé spécial le dimanche
- Notifs Phase A : `motivationMessage()` en toast à l'ouverture (1×/session, flag sessionStorage `tem-greeted`)
- Notifs Phase B (vraies push, même app fermée) : IMPLÉMENTÉE — voir section "Notifications push"
- Accessibilité : `aria-label` sur boutons-icônes, `aria-current` nav, `aria-pressed` sur ★, `prefers-reduced-motion` respecté en JS, cibles tactiles 44px
- Icône PWA : PNG fourmi rasterisés depuis l'emoji (canvas), apple-touch-icon = icon-192.png

## Notifications push (Phase B — backend séparé)
Backend dédié **tem-backend** (repo privé `leoderoudilhe-cell/tem-backend`, local `/Users/derouds/DEV/tem-backend`) : Node/Express + `web-push`, déployé en Web Service Render. L'app statique l'appelle via la constante `BACKEND_URL` (en haut d'app.js).
- App : toggle "Rappels de motivation" dans Réglages → `toggleNotifications` → `subscribeToPush` (permission, `pushManager.subscribe`, POST `/api/push-subscribe`). Ré-abonnement silencieux au boot si `settings.notifEnabled` + permission `granted`. Garde iOS : actif uniquement en PWA installée (`isStandalone`). `timeoutSignal()` = polyfill d'`AbortSignal.timeout`.
- `sw.js` : handlers `push` (showNotification) + `notificationclick` (focus/openWindow).
- Backend : 2 rappels/jour 9h & 19h (heure de Paris via `Intl`), messages en rotation quotidienne, anti-doublon par clé jour+heure **persistée**, abonnements persistés sur GitHub (`data/push-subs.json`, nécessite `GITHUB_TOKEN`). C'est le serveur qui pousse → marche app fermée.
- Variables d'env Render : `VAPID_PUBLIC` / `VAPID_PRIVATE` (clés dans `tem-backend/VAPID-KEYS.txt`, gitignored), `GITHUB_TOKEN` (persistance), `PUSH_SECRET` (protège `/api/push-test`), `ALLOWED_ORIGINS` (CORS, défaut https://tem-boatd.onrender.com).
- Keepalive : self-ping serveur toutes les 4 min ; pas de cron externe (choix assumé). iOS : requiert PWA installée + permission accordée.

## Déploiement
```bash
git add -A && git commit -m "..." && git push
# Render se met à jour automatiquement depuis main
```

## Rules
- Toujours tester JS avec `node --check app.js` avant push
- Jamais de token/secret dans le code
- Demander confirmation avant push vers main
- Images compressées en WebP/JPEG via `compressImage()` (max 1400px, 0.82 quality)
