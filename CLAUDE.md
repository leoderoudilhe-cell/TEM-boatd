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
sw.js        — service worker network-first (CACHE_NAME: tem-board-v3)
manifest.json — PWA manifest
assets/      — icon-192.png, icon-512.png (fourmi 🐜 rasterisée), icon.svg
GUIDE.md     — guide d'utilisation pour l'utilisatrice finale
```

## State (localStorage: "tem-board-v1")
```js
{
  settings: { passwordEnabled, passwordHash, hasCompletedSetup, firstName },
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
- Notifs Phase A : `motivationMessage()` en toast à l'ouverture (1×/session, flag sessionStorage `tem-greeted`). Phase B (vraies push) = backend non encore fait
- Accessibilité : `aria-label` sur boutons-icônes, `prefers-reduced-motion` respecté en JS
- Icône PWA : PNG fourmi rasterisés depuis l'emoji (canvas), apple-touch-icon = icon-192.png

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
