/* TEM 🐜 — mobile-first PWA vision board. V2 features edition. */

const STORAGE_KEY = "tem-board-v1";
const SESSION_KEY = "tem-unlocked-session-v1";
const BACKEND_URL = "https://tem-backend.onrender.com"; // backend Web Push (rappels de motivation)

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const uid = (prefix = "id") => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const localDateStr = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

const TAB_ORDER = ["Vision", "Objectives", "Focus", "Today", "Nest", "Settings"];
let _currentTabIdx = 0;

const OBJ_COLORS = {
  pink:   { main: "#ff4fd8", label: "Rose" },
  violet: { main: "#b46dff", label: "Violet" },
  gold:   { main: "#ffd98b", label: "Or" },
  green:  { main: "#7dffcf", label: "Vert" },
  blue:   { main: "#5be0ff", label: "Bleu" },
  red:    { main: "#ff5470", label: "Rouge" },
};

const defaultState = () => ({
  version: 1,
  settings: {
    title: "TEM 🐜",
    passwordEnabled: true,
    passwordHash: null,
    hasCompletedSetup: false,
    firstName: "",
    notifEnabled: false,
  },
  globalNotes: "",
  visions: [],
  objectives: [],
  streak: { count: 0, lastActiveDay: null },
  today: { date: null, picks: [] },
});

let state = loadState();
let selectedImageData = null;
let lastTouchDelete = { id: null, time: 0 };
let _heroAnimated = false;
let _todayAllDoneToasted = false;
let _heroBgCached = null;
let _sheetFlush = null; // flush des champs debounced d'un sheet avant fermeture

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return mergeState(defaultState(), JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

function mergeState(base, incoming) {
  return {
    ...base,
    ...incoming,
    settings: { ...base.settings, ...(incoming.settings || {}) },
    visions: Array.isArray(incoming.visions) ? incoming.visions : [],
    objectives: Array.isArray(incoming.objectives) ? incoming.objectives : [],
    streak: { ...base.streak, ...(incoming.streak || {}) },
    today: { ...base.today, ...(incoming.today || {}) },
  };
}

function saveState({ silent = false } = {}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (!silent) toast("Sauvegardé ✨");
  } catch (err) {
    if (err?.name === "QuotaExceededError") {
      toast("Stockage plein : compresse ou supprime quelques photos.");
    } else {
      console.error("saveState:", err);
    }
  }
}

async function hashPassword(value) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function boot() {
  bindGlobalEvents();
  setupLockFlow();
}

function setupLockFlow() {
  const needsSetup = !state.settings.hasCompletedSetup;
  const lockEnabled = state.settings.passwordEnabled && state.settings.passwordHash;
  const sessionUnlocked = sessionStorage.getItem(SESSION_KEY) === "1";
  if (needsSetup) { showLock("setup"); return; }
  if (lockEnabled && !sessionUnlocked) { showLock("login"); return; }
  showApp();
}

function showLock(mode) {
  $("#lockScreen").classList.remove("hidden");
  $("#mainApp").classList.add("hidden");
  $("#bottomNav").classList.add("hidden");
  $("#setupPanel").classList.toggle("hidden", mode !== "setup");
  $("#loginPanel").classList.toggle("hidden", mode !== "login");
  $("#lockFeedback").textContent = "";
  setTimeout(() => {
    const input = mode === "setup" ? $("#setupPassword") : $("#loginPassword");
    input?.focus();
  }, 180);
}

function showApp() {
  $("#lockScreen").classList.add("hidden");
  $("#mainApp").classList.remove("hidden");
  $("#bottomNav").classList.remove("hidden");
  renderAll();
  // Au lancement, aller droit au rituel du jour si le Top 3 est déjà choisi
  if (state.today.date === localDateStr() && (state.today.picks || []).length > 0) switchTab("Today");
  if (!_heroAnimated) {
    _heroAnimated = true;
    animateHero();
  }
  // Petit message de motivation une fois par ouverture de session
  if (sessionStorage.getItem("tem-greeted") !== "1") {
    sessionStorage.setItem("tem-greeted", "1");
    setTimeout(() => toast(motivationMessage()), 1500);
  }
}

function bindGlobalEvents() {
  $("#createPasswordBtn").addEventListener("click", createInitialPassword);
  $("#skipPasswordBtn").addEventListener("click", () => {
    state.settings.passwordEnabled = false;
    state.settings.passwordHash = null;
    state.settings.hasCompletedSetup = true;
    saveState({ silent: true });
    sessionStorage.setItem(SESSION_KEY, "1");
    showApp();
  });
  $("#unlockBtn").addEventListener("click", unlock);
  $("#loginPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") unlock(); });
  $("#setupPasswordConfirm").addEventListener("keydown", (e) => { if (e.key === "Enter") createInitialPassword(); });

  $("#quickAddBtn").addEventListener("click", openQuickAddSheet);
  $("#addVisionBtn").addEventListener("click", () => openVisionEditor());
  $("#addObjectiveBtn").addEventListener("click", () => openObjectiveEditor());
  $("#celebrateBtn").addEventListener("click", () => celebrate(70));

  $$("#bottomNav button").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  $("#sheetBackdrop").addEventListener("click", closeSheet);
  $("#globalNotes").addEventListener("input", debounce(() => {
    state.globalNotes = $("#globalNotes").value;
    saveState({ silent: true });
  }, 300));

  $$(".ghost-btn[data-ritual]").forEach(btn => {
    btn.addEventListener("click", () => {
      const area = $("#globalNotes");
      const insert = `\n\n${new Date().toLocaleDateString("fr-FR")} — ${btn.dataset.ritual}`;
      area.value += insert;
      area.focus();
      area.selectionStart = area.selectionEnd = area.value.length;
      state.globalNotes = area.value;
      saveState({ silent: true });
    });
  });

  $("#passwordToggle").addEventListener("change", handlePasswordToggle);
  $("#changePasswordBtn").addEventListener("click", openChangePasswordSheet);
  $("#exportBtn").addEventListener("click", exportData);
  $("#importInput").addEventListener("change", importData);
  $("#resetBtn").addEventListener("click", resetApp);
  $("#openGuideBtn").addEventListener("click", openGuideSheet);
  $("#notifToggle")?.addEventListener("change", toggleNotifications);

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

  // Swipe between tabs
  let _swipeX = null, _swipeY = null;
  const mainApp = $("#mainApp");
  mainApp.addEventListener("touchstart", (e) => {
    if (!$("#editorSheet").classList.contains("hidden")) return;
    if (document.getElementById("visionViewer")) return;
    _swipeX = e.touches[0].clientX;
    _swipeY = e.touches[0].clientY;
  }, { passive: true });
  mainApp.addEventListener("touchend", (e) => {
    if (_swipeX === null) return;
    const dx = e.changedTouches[0].clientX - _swipeX;
    const dy = e.changedTouches[0].clientY - _swipeY;
    _swipeX = null;
    if (Math.abs(dx) < 65 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
    navigateTab(dx < 0 ? 1 : -1);
  }, { passive: true });

  // Drag-to-dismiss sheet
  attachSheetDrag();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      toast("✨ Mise à jour — rechargement...");
      setTimeout(() => window.location.reload(), 1200);
    });
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").then(() => {
        // Ré-abonnement silencieux si les rappels étaient activés
        if (state.settings.notifEnabled && "Notification" in window && Notification.permission === "granted") {
          subscribeToPush().catch(() => {});
        }
      }).catch(() => {});
    });
  }
}

function attachSheetDrag() {
  const sheet = $("#editorSheet");
  const handle = $(".sheet-handle");
  if (!handle) return;
  let startY = 0, captured = false;

  handle.addEventListener("pointerdown", (e) => {
    startY = e.clientY;
    captured = true;
    sheet.style.transition = "none";
    handle.setPointerCapture?.(e.pointerId);
  });

  handle.addEventListener("pointermove", (e) => {
    if (!captured) return;
    const dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translate3d(-50%, ${dy}px, 0)`;
    sheet.style.opacity = `${1 - dy / 400}`;
  });

  handle.addEventListener("pointerup", (e) => {
    if (!captured) return;
    captured = false;
    const dy = e.clientY - startY;
    sheet.style.transition = "";
    sheet.style.opacity = "";
    if (dy > 90) {
      sheet.style.transform = "translate3d(-50%, 110%, 0)";
      setTimeout(closeSheet, 320);
    } else {
      sheet.style.transform = "translate3d(-50%, 0, 0)";
    }
  });

  handle.addEventListener("pointercancel", () => {
    captured = false;
    sheet.style.transition = "";
    sheet.style.opacity = "";
    sheet.style.transform = "translate3d(-50%, 0, 0)";
  });
}

async function createInitialPassword() {
  const p1 = $("#setupPassword").value.trim();
  const p2 = $("#setupPasswordConfirm").value.trim();
  if (p1.length < 4) return lockFeedback("Mets au moins 4 caractères.");
  if (p1 !== p2) return lockFeedback("Les deux mots de passe ne correspondent pas.");
  state.settings.passwordHash = await hashPassword(p1);
  state.settings.passwordEnabled = true;
  state.settings.hasCompletedSetup = true;
  saveState({ silent: true });
  sessionStorage.setItem(SESSION_KEY, "1");
  showApp();
}

let _unlockAttempts = 0;
let _unlockThrottled = false;

async function unlock() {
  if (_unlockThrottled) return;
  const pass = $("#loginPassword").value.trim();
  const hash = await hashPassword(pass);
  if (hash !== state.settings.passwordHash) {
    _unlockAttempts++;
    if (_unlockAttempts >= 5) {
      _unlockThrottled = true;
      lockFeedback("Trop d'essais — réessaie dans 30s.");
      setTimeout(() => { _unlockThrottled = false; _unlockAttempts = 0; lockFeedback(""); }, 30000);
      return;
    }
    lockFeedback(`Mot de passe incorrect. (${_unlockAttempts}/5)`);
    return;
  }
  _unlockAttempts = 0;
  sessionStorage.setItem(SESSION_KEY, "1");
  showApp();
}

function lockFeedback(message) {
  $("#lockFeedback").textContent = message;
}

function renderAll() {
  $("#greetingTitle").textContent = "TEM Board";
  const notes = $("#globalNotes");
  if (document.activeElement !== notes) notes.value = state.globalNotes || "";
  $("#passwordToggle").checked = !!state.settings.passwordEnabled;
  renderHero();
  renderVisionGrid();
  renderObjectives();
  renderFocus();
  renderToday();
  renderWeeklyReview();
  updateNotifUI();
}

function startOfWeekTs() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // 0 = lundi
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

function renderWeeklyReview() {
  const el = $("#weeklyReview");
  if (!el) return;
  const actions = state.objectives.flatMap(getObjectiveActions);
  if (!actions.length) { el.innerHTML = ""; return; }
  const start = startOfWeekTs();
  const doneThisWeek = actions.filter(a => a.doneAt && a.doneAt >= start).length;
  const withActions = state.objectives.filter(o => getObjectiveActions(o).length);
  const top = withActions.slice().sort((a, b) => computeObjectiveProgress(b) - computeObjectiveProgress(a))[0];
  const topPct = top ? computeObjectiveProgress(top) : 0;
  const isSunday = new Date().getDay() === 0;
  const streak = state.streak?.count || 0;
  const streakTxt = streak >= 1 ? `🔥 ${streak === 1 ? "1er jour" : streak + " jours d'affilée"}` : "";
  el.innerHTML = `
    <div class="weekly-card">
      <p class="eyebrow" style="color:var(--gold)">${isSunday ? "Bilan du dimanche 🌙" : "Cette semaine"}</p>
      <p class="big">${doneThisWeek} action${doneThisWeek !== 1 ? "s" : ""} cochée${doneThisWeek !== 1 ? "s" : ""}</p>
      <p class="sub">${[streakTxt, top ? `Objectif en tête : ${escapeHtml(top.title)} (${topPct}%)` : ""].filter(Boolean).join(" · ")}</p>
    </div>
  `;
}

// ─── Progress helpers ─────────────────────────────────────────────────────────

function computeObjectiveProgress(objective) {
  const actions = getObjectiveActions(objective);
  if (!actions.length) return 0;
  return Math.round((actions.filter(a => a.done).length / actions.length) * 100);
}

function getObjectiveActions(objective) {
  return (objective.subgoals || []).flatMap(s => s.actions || []);
}

function computeGlobalProgress() {
  const actions = state.objectives.flatMap(getObjectiveActions);
  if (!actions.length) return 0;
  return Math.round((actions.filter(a => a.done).length / actions.length) * 100);
}

function progressMessage(pct) {
  if (pct >= 100) return "Vision validée. Mission accomplie ✨";
  if (pct >= 80) return "Presque au sommet. Continue, c'est solide.";
  if (pct >= 55) return "La dynamique est lancée. Ne casse pas le rythme.";
  if (pct >= 25) return "Ça prend forme, petite fourmi par petite fourmi.";
  if (pct > 0) return "Premier mouvement lancé. Maintenant on construit.";
  return "Chaque petite action construit la vision.";
}

// Message de motivation contextuel affiché à l'ouverture (Phase A, sans backend)
function motivationMessage() {
  const h = new Date().getHours();
  const greet = h < 12 ? "Bonjour" : h < 18 ? "Bel après-midi" : "Bonne soirée";
  if (!state.objectives.length) return `${greet} 🌱 Crée ton premier objectif pour lancer ta vision.`;
  const picks = (state.today.date === localDateStr() ? state.today.picks : []) || [];
  if (!picks.length) return `${greet} 🎯 Choisis tes 3 actions du jour pour avancer.`;
  const remaining = picks.map(p => {
    const o = state.objectives.find(x => x.id === p.objectiveId);
    const s = o?.subgoals?.find(y => y.id === p.subId);
    return s?.actions?.find(a => a.id === p.actionId);
  }).filter(Boolean).filter(a => !a.done).length;
  if (remaining === 0) return `${greet} ✨ Ton Top 3 du jour est bouclé. Tu assures.`;
  return `${greet} 🔥 Il te reste ${remaining} action${remaining > 1 ? "s" : ""} dans ton Top 3.`;
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function renderHero() {
  const pct = computeGlobalProgress();
  const circumference = 314;
  $("#globalScore").textContent = `${pct}%`;
  $("#globalMessage").textContent = progressMessage(pct);
  $("#ringLabel").textContent = `${pct}%`;
  $("#globalBar").style.width = `${pct}%`;
  $("#ringProgress").style.strokeDashoffset = `${circumference - (circumference * pct / 100)}`;

  // Dynamic hero background — best vision photo
  const bestVision = state.visions.find(v => v.image);
  if (bestVision?.id !== _heroBgCached) {
    _heroBgCached = bestVision?.id || null;
    const bgEl = $("#heroBgImg");
    if (bgEl) {
      bgEl.style.backgroundImage = bestVision ? `url(${bestVision.image})` : "none";
      bgEl.style.opacity = bestVision ? "0.28" : "0";
    }
  }

  // Streak badge
  const streak = state.streak?.count || 0;
  const badge = $("#streakBadge");
  if (badge) {
    if (streak >= 1) {
      badge.style.display = "flex";
      badge.querySelector(".streak-count").textContent = streak === 1 ? "1er jour" : `${streak} jours d'affilée`;
    } else {
      badge.style.display = "none";
    }
  }
}

function animateHero() {
  // renderHero a déjà posé les valeurs finales — on saute juste l'animation
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const target = computeGlobalProgress();
  const circumference = 314;
  const ring = $("#ringProgress");
  const bar = $("#globalBar");

  // Snap to 0 without transition
  ring.style.transition = "none";
  bar.style.transition = "none";
  ring.style.strokeDashoffset = `${circumference}`;
  bar.style.width = "0%";

  // Two rAF frames to flush the style reset, then animate
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ring.style.transition = "";
    bar.style.transition = "";
    ring.style.strokeDashoffset = `${circumference - (circumference * target / 100)}`;
    bar.style.width = `${target}%`;
    animateCounter("#globalScore", 0, target, 1900, "%");
    animateCounter("#ringLabel", 0, target, 1900, "%");
  }));
}

function animateCounter(selector, from, to, duration, suffix = "") {
  const el = $(selector);
  if (!el) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { el.textContent = `${to}${suffix}`; return; }
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 4); // easeOutQuart — aggressive initial ramp
    el.textContent = `${Math.round(from + (to - from) * eased)}${suffix}`;
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ─── Streak ───────────────────────────────────────────────────────────────────

function updateStreak() {
  const today = localDateStr();
  const s = state.streak;
  if (s.lastActiveDay === today) return;
  const yesterday = localDateStr(new Date(Date.now() - 86400000));
  s.count = s.lastActiveDay === yesterday ? (s.count || 0) + 1 : 1;
  s.lastActiveDay = today;
}

// ─── Vision grid ──────────────────────────────────────────────────────────────

function renderVisionGrid() {
  const grid = $("#visionGrid");
  grid.innerHTML = "";
  if (!state.visions.length) {
    grid.appendChild(emptyState("Ajoute tes premières photos", "Crée une vision avec une photo, un titre, une taille et un lien vers un objectif.", "+ ajouter une photo", () => openVisionEditor()));
    return;
  }
  state.visions.forEach((vision) => {
    const tpl = $("#visionCardTpl").content.cloneNode(true);
    const card = $(".vision-card", tpl);
    const img = $("img", tpl);
    const pill = $(".pill", tpl);
    const title = $("h3", tpl);
    const subtitle = $("p", tpl);
    card.dataset.id = vision.id;
    card.classList.add(vision.size || "medium");
    img.src = vision.image || placeholderSvg(vision.title || "TEM");
    img.alt = vision.title || "Vision";
    const tune = vision.tune || { scale: 1, x: 0, y: 0 };
    img.style.transform = `scale(${tune.scale || 1}) translate(${tune.x || 0}%, ${tune.y || 0}%)`;
    pill.textContent = vision.category || "VISION";
    title.textContent = vision.title || "Nouvelle vision";
    subtitle.textContent = vision.subtitle || "Appuie pour détailler";
    attachVisionGestures(card, vision.id);
    grid.appendChild(tpl);
  });
}

function attachVisionGestures(card, id) {
  let startX = 0, startY = 0, dragging = false, longPressTimer = null, target = null, moved = false;

  card.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    startX = e.clientX; startY = e.clientY;
    moved = false; dragging = false;
    card.setPointerCapture?.(e.pointerId);
    longPressTimer = setTimeout(() => {
      if (!moved) { navigator.vibrate?.(28); confirmDeleteVision(id); }
    }, 760);
  });

  card.addEventListener("pointermove", (e) => {
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.hypot(dx, dy) > 12) moved = true;
    if (moved) clearTimeout(longPressTimer);
    if (moved && !dragging) { dragging = true; card.classList.add("dragging"); }
    if (dragging) {
      card.style.transform = `translate(${dx}px,${dy}px) scale(1.04)`;
      target = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".vision-card");
      $$(".vision-card").forEach(c => c.classList.remove("drop-target"));
      if (target && target !== card) target.classList.add("drop-target");
    }
  });

  card.addEventListener("pointerup", (e) => {
    clearTimeout(longPressTimer);
    card.releasePointerCapture?.(e.pointerId);
    const wasDragging = dragging;
    card.classList.remove("dragging"); card.style.transform = "";
    $$(".vision-card").forEach(c => c.classList.remove("drop-target"));
    if (wasDragging && target && target !== card) reorderVision(id, target.dataset.id);
    else if (!moved) openVisionViewer(id); // full-screen first
    dragging = false; target = null;
  });

  card.addEventListener("pointercancel", () => {
    clearTimeout(longPressTimer);
    card.classList.remove("dragging"); card.style.transform = "";
  });
}

function reorderVision(sourceId, targetId) {
  const from = state.visions.findIndex(v => v.id === sourceId);
  const to = state.visions.findIndex(v => v.id === targetId);
  if (from < 0 || to < 0 || from === to) return;
  const [item] = state.visions.splice(from, 1);
  state.visions.splice(to, 0, item);
  saveState({ silent: true });
  renderVisionGrid();
  toast("Bloc déplacé ✨");
}

// ─── Objectives ───────────────────────────────────────────────────────────────

function renderObjectives() {
  const list = $("#objectivesList");
  list.innerHTML = "";
  if (!state.objectives.length) {
    list.appendChild(emptyState("Crée un objectif", "Un objectif contient des étapes et des actions cochables.", "+ ajouter un objectif", () => openObjectiveEditor()));
    return;
  }
  state.objectives.forEach(obj => {
    const pct = computeObjectiveProgress(obj);
    const totalActions = getObjectiveActions(obj).length;
    const doneActions = getObjectiveActions(obj).filter(a => a.done).length;
    const linkedVision = state.visions.find(v => v.id === obj.visionId);
    const color = OBJ_COLORS[obj.color || "pink"]?.main || "#ff4fd8";
    const card = document.createElement("article");
    card.className = "objective-card";
    card.style.setProperty("--obj-c", color);
    card.innerHTML = `
      <div class="objective-head">
        <div>
          <p class="eyebrow">${linkedVision ? escapeHtml(linkedVision.title) : "OBJECTIF"}</p>
          <h3>${escapeHtml(obj.title || "Objectif")}</h3>
          <p class="muted">${escapeHtml(obj.why || "Ajoute le pourquoi de cet objectif.")}</p>
        </div>
        <div class="score-chip">${pct}%</div>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="objective-meta">
        <span class="meta-pill">${(obj.subgoals || []).length} étape(s)</span>
        <span class="meta-pill">${doneActions}/${totalActions} action(s)</span>
      </div>
    `;
    card.addEventListener("click", () => openObjectiveDetail(obj.id));
    list.appendChild(card);
  });
}

// ─── Focus ────────────────────────────────────────────────────────────────────

function renderFocus() {
  const list = $("#focusList");
  list.innerHTML = "";
  const objectivesWithActions = state.objectives.filter(o => getObjectiveActions(o).length);
  if (!objectivesWithActions.length) {
    list.appendChild(emptyState("Aucune action pour l'instant", "Ajoute des actions dans tes objectifs pour les cocher ici en mode focus.", "+ ajouter un objectif", () => openObjectiveEditor()));
    return;
  }
  objectivesWithActions.forEach(obj => {
    const pct = computeObjectiveProgress(obj);
    const color = OBJ_COLORS[obj.color || "pink"]?.main || "#ff4fd8";
    const card = document.createElement("article");
    card.className = "focus-card";
    card.style.setProperty("--obj-c", color);
    card.innerHTML = `
      <div class="objective-head">
        <div>
          <p class="eyebrow">Objectif</p>
          <h3>${escapeHtml(obj.title)}</h3>
          <p class="muted">${progressMessage(pct)}</p>
        </div>
        <div class="score-chip">${pct}%</div>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="focus-actions"></div>
    `;
    const actionsRoot = $(".focus-actions", card);
    (obj.subgoals || []).forEach(sub => {
      const block = document.createElement("div");
      block.className = "subgoal-block";
      block.innerHTML = `<div class="subgoal-head"><h4>${escapeHtml(sub.title)}</h4></div>`;
      (sub.actions || []).forEach(action => {
        block.appendChild(actionRow(action, () => toggleAction(obj.id, sub.id, action.id)));
      });
      actionsRoot.appendChild(block);
    });
    list.appendChild(card);
  });
}

function actionRow(action, onToggle, withDelete = null, onPriority = null) {
  const row = document.createElement("div");
  row.className = `action-row ${action.done ? "done" : ""} ${action.priority ? "is-priority" : ""}`;
  row.innerHTML = `
    <div class="check"></div>
    <div class="action-text">${action.priority ? '<span class="prio-star">★</span> ' : ""}${escapeHtml(action.text || "Action")}</div>
    ${onPriority ? `<button class="prio-btn ${action.priority ? "on" : ""}" type="button" aria-label="Marquer prioritaire">★</button>` : ""}
    ${withDelete ? `<button class="inline-delete" type="button" aria-label="Supprimer">×</button>` : ""}
  `;
  row.addEventListener("click", (e) => {
    if (e.target.closest(".inline-delete") || e.target.closest(".prio-btn")) return;
    onToggle();
  });
  if (withDelete) $(".inline-delete", row).addEventListener("click", withDelete);
  if (onPriority) $(".prio-btn", row).addEventListener("click", (e) => { e.stopPropagation(); onPriority(); });
  return row;
}

function toggleAction(objectiveId, subId, actionId) {
  const obj = state.objectives.find(o => o.id === objectiveId);
  const sub = obj?.subgoals?.find(s => s.id === subId);
  const action = sub?.actions?.find(a => a.id === actionId);
  if (!action) return;
  const prevPct = computeObjectiveProgress(obj);
  action.done = !action.done;
  if (action.done) action.doneAt = Date.now(); else delete action.doneAt;
  const newPct = computeObjectiveProgress(obj);
  if (action.done) updateStreak();
  saveState({ silent: true });
  renderAll();
  if (action.done) {
    const milestone = checkMilestone(prevPct, newPct, obj);
    if (!milestone) {
      toast(randomWinMessage(newPct));
      celebrate(22);
    }
  }
}

function randomWinMessage(pct) {
  if (pct >= 100) return "Objectif complété. Très gros score ✨";
  if (pct >= 80) return "Encore un step, ça sent la victoire.";
  if (pct >= 50) return "La barre monte. Rythme validé.";
  return "Petite action validée. La vision avance.";
}

// ─── Milestones ───────────────────────────────────────────────────────────────

function checkMilestone(prev, next, obj) {
  const milestones = [25, 50, 75, 100];
  const hit = milestones.find(m => prev < m && next >= m);
  if (!hit) return false;
  navigator.vibrate?.([80, 40, 80, 40, 180]);
  if (hit === 100) {
    celebrate(120);
    setTimeout(() => toast(`🏆 100% — "${obj.title}" accompli !`), 350);
  } else if (hit === 75) {
    celebrate(75);
    setTimeout(() => toast(`✨ 75% sur "${obj.title}" — presque là !`), 350);
  } else if (hit === 50) {
    celebrate(50);
    setTimeout(() => toast(`⚡ Mi-parcours sur "${obj.title}" !`), 350);
  } else {
    celebrate(28);
    setTimeout(() => toast(`🔥 Premier quart validé sur "${obj.title}" !`), 350);
  }
  return true;
}

// ─── Tab navigation ───────────────────────────────────────────────────────────

const TAB_VIEWS = {
  Vision: "#viewVision",
  Objectives: "#viewObjectives",
  Focus: "#viewFocus",
  Today: "#viewToday",
  Nest: "#viewNest",
  Settings: "#viewSettings",
};

function switchTab(name) {
  _currentTabIdx = Math.max(0, TAB_ORDER.indexOf(name));
  Object.values(TAB_VIEWS).forEach(sel => $(sel)?.classList.remove("active"));
  $(TAB_VIEWS[name])?.classList.add("active");
  $$("#bottomNav button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
}

function navigateTab(delta) {
  const newIdx = Math.max(0, Math.min(TAB_ORDER.length - 1, _currentTabIdx + delta));
  if (newIdx !== _currentTabIdx) switchTab(TAB_ORDER[newIdx]);
}

// ─── Sheets ───────────────────────────────────────────────────────────────────

function openQuickAddSheet() {
  openSheet(`
    <div class="sheet-title-row">
      <div><p class="eyebrow">Créer</p><h2>Nouvel élément</h2></div>
      <button class="close-btn" data-close aria-label="Fermer">×</button>
    </div>
    <div class="stack">
      <button id="quickVision" class="primary-btn full">Ajouter une photo de vision</button>
      <button id="quickObjective" class="ghost-btn full">Ajouter un objectif</button>
      <button id="quickNote" class="ghost-btn full">Écrire dans le Nid</button>
    </div>
  `);
  $("#quickVision").addEventListener("click", () => openVisionEditor());
  $("#quickObjective").addEventListener("click", () => openObjectiveEditor());
  $("#quickNote").addEventListener("click", () => { closeSheet(); switchTab("Nest"); setTimeout(() => $("#globalNotes").focus(), 100); });
}

function openVisionEditor(id = null) {
  const vision = id ? state.visions.find(v => v.id === id) : null;
  selectedImageData = vision?.image || null;
  const tune = vision?.tune || { scale: 1, x: 0, y: 0 };
  openSheet(`
    <div class="sheet-title-row">
      <div><p class="eyebrow">${vision ? "Modifier" : "Créer"}</p><h2>Photo de vision</h2></div>
      <button class="close-btn" data-close aria-label="Fermer">×</button>
    </div>
    <div class="form-grid">
      <label class="field"><span>Titre</span><input id="visionTitle" value="${escapeAttr(vision?.title || "")}" placeholder="Ex : Corps & énergie" /></label>
      <label class="field"><span>Phrase courte</span><input id="visionSubtitle" value="${escapeAttr(vision?.subtitle || "")}" placeholder="Ex : devenir régulière et fière" /></label>
      <label class="field"><span>Catégorie</span><input id="visionCategory" value="${escapeAttr(vision?.category || "")}" placeholder="Lifestyle, sport, argent..." /></label>
      <label class="upload-box" id="visionUploadBox">
        ${selectedImageData ? `<img src="${selectedImageData}" alt="">` : `<div><strong>Ajouter une photo</strong><br><span>Appuie pour importer depuis le téléphone</span></div>`}
        <input id="visionImageInput" type="file" accept="image/*" hidden />
      </label>
      <div class="image-tune">
        <p class="eyebrow">Cadrage de la photo</p>
        <div class="slider-row"><span>Zoom</span><input id="visionScale" type="range" min="1" max="2.4" step=".01" value="${tune.scale || 1}"><b id="scaleVal">${Number(tune.scale || 1).toFixed(2)}</b></div>
        <div class="slider-row"><span>Horizontal</span><input id="visionX" type="range" min="-30" max="30" step="1" value="${tune.x || 0}"><b id="xVal">${tune.x || 0}</b></div>
        <div class="slider-row"><span>Vertical</span><input id="visionY" type="range" min="-30" max="30" step="1" value="${tune.y || 0}"><b id="yVal">${tune.y || 0}</b></div>
      </div>
      <div>
        <p class="eyebrow">Taille du bloc</p>
        <div class="segmented" id="sizePicker">
          ${["small","medium","large","hero"].map(size => `<button type="button" data-size="${size}" class="${(vision?.size || "medium") === size ? "active" : ""}">${size}</button>`).join("")}
        </div>
      </div>
      <label class="field"><span>Relier à un objectif</span>
        <select id="visionObjective">
          <option value="">Aucun pour l'instant</option>
          ${state.objectives.map(o => `<option value="${o.id}" ${vision?.linkedObjectiveId === o.id ? "selected" : ""}>${escapeHtml(o.title)}</option>`).join("")}
        </select>
      </label>
      <button id="saveVisionBtn" class="primary-btn full">${vision ? "Sauvegarder" : "Créer la vision"}</button>
    </div>
  `);

  const updatePreview = () => {
    $("#scaleVal").textContent = Number($("#visionScale").value).toFixed(2);
    $("#xVal").textContent = $("#visionX").value;
    $("#yVal").textContent = $("#visionY").value;
  };
  ["visionScale","visionX","visionY"].forEach(id => $(`#${id}`).addEventListener("input", updatePreview));

  $("#visionUploadBox").addEventListener("change", async (e) => {
    if (!e.target.matches("input[type='file']")) return;
    const file = e.target.files?.[0];
    if (!file) return;
    try { selectedImageData = await compressImage(file); }
    catch { toast("Impossible de charger cette image."); return; }
    const box = $("#visionUploadBox");
    box.innerHTML = `<img src="${selectedImageData}" alt=""><input id="visionImageInput" type="file" accept="image/*" hidden />`;
  });

  $$("#sizePicker button").forEach(btn => {
    btn.addEventListener("click", () => {
      $$("#sizePicker button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  $("#saveVisionBtn").addEventListener("click", () => {
    const payload = {
      title: $("#visionTitle").value.trim() || "Nouvelle vision",
      subtitle: $("#visionSubtitle").value.trim(),
      category: $("#visionCategory").value.trim() || "VISION",
      image: selectedImageData,
      size: $("#sizePicker button.active")?.dataset.size || "medium",
      linkedObjectiveId: $("#visionObjective").value || null,
      tune: {
        scale: Number($("#visionScale").value),
        x: Number($("#visionX").value),
        y: Number($("#visionY").value),
      },
    };
    if (vision) Object.assign(vision, payload);
    else state.visions.push({ id: uid("vision"), ...payload });
    saveState({ silent: true });
    renderAll();
    closeSheet();
    toast("Vision sauvegardée ✨");
  });
}

// ─── Vision viewer (full screen) ─────────────────────────────────────────────

function openVisionViewer(id) {
  // Une vision sans photo n'a rien à montrer en plein écran → détail direct
  if (!state.visions.find(v => v.id === id)?.image) { openVisionDetail(id); return; }
  const visions = state.visions.filter(v => v.image);
  if (!visions.length) { openVisionDetail(id); return; }

  let idx = visions.findIndex(v => v.id === id);
  if (idx < 0) idx = 0;

  const existing = document.getElementById("visionViewer");
  if (existing) existing.remove();

  const viewer = document.createElement("div");
  viewer.id = "visionViewer";
  viewer.className = "vision-viewer";

  const closeViewer = () => {
    viewer.style.animation = "viewerOut .32s ease forwards";
    setTimeout(() => viewer.remove(), 320);
  };

  const renderSlide = (i) => {
    const v = visions[i];
    const tune = v.tune || { scale: 1, x: 0, y: 0 };
    viewer.innerHTML = `
      <img class="vision-viewer-img" src="${v.image}" style="transform:scale(${tune.scale}) translate(${tune.x}%,${tune.y}%)" />
      <div class="vision-viewer-overlay"></div>
      <div class="vision-viewer-nav">
        <button class="vision-viewer-btn" id="vvEdit" title="Modifier" aria-label="Modifier">✎</button>
        <button class="vision-viewer-btn" id="vvClose" title="Fermer" aria-label="Fermer">×</button>
      </div>
      <div class="vision-viewer-info">
        <p class="eyebrow" style="color:rgba(255,255,255,.7);margin-bottom:2px">${escapeHtml(v.category || "VISION")}</p>
        <h2>${escapeHtml(v.title)}</h2>
        ${v.subtitle ? `<p>${escapeHtml(v.subtitle)}</p>` : ""}
        <button class="ghost-btn" id="vvDetails" style="margin-top:12px;font-size:13px">Détails & modifier →</button>
      </div>
      ${visions.length > 1 ? `
      <div class="vision-viewer-dots">
        ${visions.map((_, di) => `<div class="viewer-dot ${di === i ? "active" : ""}"></div>`).join("")}
      </div>` : ""}
    `;
    $(`#vvClose`, viewer).addEventListener("click", closeViewer);
    $(`#vvEdit`, viewer).addEventListener("click", () => { closeViewer(); setTimeout(() => openVisionEditor(v.id), 350); });
    $(`#vvDetails`, viewer).addEventListener("click", () => { closeViewer(); setTimeout(() => openVisionDetail(v.id), 350); });
  };

  // Swipe between visions
  let touchX = null;
  viewer.addEventListener("touchstart", e => { touchX = e.touches[0].clientX; }, { passive: true });
  viewer.addEventListener("touchend", e => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) < 55) return;
    if (dx < 0 && idx < visions.length - 1) { idx++; renderSlide(idx); }
    else if (dx > 0 && idx > 0) { idx--; renderSlide(idx); }
  }, { passive: true });

  // Close on backdrop tap — viewer root or overlay
  viewer.addEventListener("click", (e) => {
    if (e.target === viewer || e.target.classList.contains("vision-viewer-overlay")) closeViewer();
  });

  renderSlide(idx);
  document.body.appendChild(viewer);
}

function openVisionDetail(id) {
  const vision = state.visions.find(v => v.id === id);
  if (!vision) return;
  const linked = state.objectives.find(o => o.id === vision.linkedObjectiveId);
  const color = linked ? (OBJ_COLORS[linked.color || "pink"]?.main || "#ff4fd8") : "#ff4fd8";
  openSheet(`
    <div class="sheet-title-row">
      <div><p class="eyebrow">${escapeHtml(vision.category || "VISION")}</p><h2>${escapeHtml(vision.title)}</h2></div>
      <button class="close-btn" data-close aria-label="Fermer">×</button>
    </div>
    <div class="upload-box">
      <img src="${vision.image || placeholderSvg(vision.title)}" alt="">
    </div>
    <p class="muted">${escapeHtml(vision.subtitle || "Aucune phrase ajoutée.")}</p>
    ${linked ? `
      <article class="objective-card" id="linkedObjectiveCard" style="--obj-c:${color}">
        <div class="objective-head">
          <div><p class="eyebrow">Relié à</p><h3>${escapeHtml(linked.title)}</h3><p class="muted">${escapeHtml(linked.why || "")}</p></div>
          <div class="score-chip">${computeObjectiveProgress(linked)}%</div>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${computeObjectiveProgress(linked)}%"></div></div>
      </article>` : `<p class="hint">Cette vision n'est pas encore reliée à un objectif.</p>`}
    <div class="actions-toolbar">
      <button id="editVisionBtn" class="ghost-btn">Modifier</button>
      <button id="deleteVisionBtn" class="danger-btn">Supprimer</button>
    </div>
  `);
  $("#editVisionBtn").addEventListener("click", () => openVisionEditor(id));
  $("#deleteVisionBtn").addEventListener("click", () => confirmDeleteVision(id));
  $("#linkedObjectiveCard")?.addEventListener("click", () => openObjectiveDetail(linked.id));
}

function confirmDeleteVision(id) {
  const vision = state.visions.find(v => v.id === id);
  if (!vision) return;
  const now = Date.now();
  if (lastTouchDelete.id === id && now - lastTouchDelete.time < 2500) {
    state.visions = state.visions.filter(v => v.id !== id);
    saveState({ silent: true });
    document.getElementById("visionViewer")?.remove();
    closeSheet();
    renderAll();
    toast("Photo supprimée.");
    lastTouchDelete = { id: null, time: 0 };
    return;
  }
  lastTouchDelete = { id, time: now };
  toast("Appuie encore une fois pour confirmer la suppression.");
}

// ─── Objective editor (with color picker) ────────────────────────────────────

function openObjectiveEditor(id = null) {
  const obj = id ? state.objectives.find(o => o.id === id) : null;
  const currentColor = obj?.color || "pink";
  openSheet(`
    <div class="sheet-title-row">
      <div><p class="eyebrow">${obj ? "Modifier" : "Créer"}</p><h2>Objectif</h2></div>
      <button class="close-btn" data-close aria-label="Fermer">×</button>
    </div>
    <div class="form-grid">
      <label class="field"><span>Titre</span><input id="objectiveTitle" value="${escapeAttr(obj?.title || "")}" placeholder="Ex : Corps & énergie" /></label>
      <label class="field"><span>Pourquoi cet objectif compte</span><textarea id="objectiveWhy" placeholder="Explique le sens de cet objectif...">${escapeHtml(obj?.why || "")}</textarea></label>
      <label class="field"><span>Relier à une photo de vision</span>
        <select id="objectiveVision">
          <option value="">Aucune</option>
          ${state.visions.map(v => `<option value="${v.id}" ${obj?.visionId === v.id ? "selected" : ""}>${escapeHtml(v.title)}</option>`).join("")}
        </select>
      </label>
      <div>
        <p class="eyebrow" style="margin-bottom:10px">Couleur accent</p>
        <div class="color-picker" id="colorPicker">
          ${Object.entries(OBJ_COLORS).map(([key, { main, label }]) =>
            `<button type="button" class="color-swatch ${currentColor === key ? "active" : ""}" data-color="${key}" style="background:${main}" title="${label}" aria-label="${label}"></button>`
          ).join("")}
        </div>
      </div>
      <button id="saveObjectiveBtn" class="primary-btn full">${obj ? "Sauvegarder" : "Créer l'objectif"}</button>
    </div>
  `);

  $$("#colorPicker .color-swatch").forEach(swatch => {
    swatch.addEventListener("click", () => {
      $$("#colorPicker .color-swatch").forEach(s => s.classList.remove("active"));
      swatch.classList.add("active");
    });
  });

  $("#saveObjectiveBtn").addEventListener("click", () => {
    const payload = {
      title: $("#objectiveTitle").value.trim() || "Nouvel objectif",
      why: $("#objectiveWhy").value.trim(),
      visionId: $("#objectiveVision").value || null,
      color: $("#colorPicker .color-swatch.active")?.dataset.color || "pink",
      subgoals: obj?.subgoals || [],
      notes: obj?.notes || "",
    };
    if (obj) Object.assign(obj, payload);
    else state.objectives.push({ id: uid("obj"), ...payload });
    saveState({ silent: true });
    renderAll();
    closeSheet();
    toast("Objectif sauvegardé ✨");
  });
}

function openObjectiveDetail(id) {
  const obj = state.objectives.find(o => o.id === id);
  if (!obj) return;
  const pct = computeObjectiveProgress(obj);
  const vision = state.visions.find(v => v.id === obj.visionId);
  const color = OBJ_COLORS[obj.color || "pink"]?.main || "#ff4fd8";

  openSheet(`
    <div class="sheet-title-row">
      <div><p class="eyebrow">${vision ? escapeHtml(vision.title) : "OBJECTIF"}</p><h2>${escapeHtml(obj.title)}</h2></div>
      <button class="close-btn" data-close aria-label="Fermer">×</button>
    </div>
    <p class="muted">${escapeHtml(obj.why || "Ajoute le pourquoi de cet objectif.")}</p>
    <div class="progress-track" style="--obj-c:${color}"><div class="progress-fill" style="width:${pct}%"></div></div>
    <p class="hint">${pct}% — ${progressMessage(pct)}</p>
    <div id="subgoalsEditor"></div>
    <button id="addSubgoalBtn" class="ghost-btn full">+ étape</button>
    <label class="field">
      <span>Notes de cet objectif</span>
      <textarea id="objectiveNotes" placeholder="Notes, idées, ressentis...">${escapeHtml(obj.notes || "")}</textarea>
    </label>
    <div class="actions-toolbar">
      <button id="editObjectiveBtn" class="ghost-btn">Modifier</button>
      <button id="deleteObjectiveBtn" class="danger-btn">Supprimer</button>
    </div>
  `);

  // Apply color to score chip and progress in the sheet
  const sheet = $("#editorSheet");
  sheet.querySelectorAll(".score-chip,.progress-track,.progress-fill").forEach(el => {
    el.style.setProperty("--obj-c", color);
  });

  renderSubgoalsEditor(obj);
  $("#addSubgoalBtn").addEventListener("click", () => {
    obj.subgoals ||= [];
    obj.subgoals.push({ id: uid("sub"), title: "Nouvelle étape", actions: [] });
    saveState({ silent: true });
    renderAll();
    renderSubgoalsEditor(obj);
  });
  $("#objectiveNotes").addEventListener("input", debounce(() => {
    obj.notes = $("#objectiveNotes").value;
    saveState({ silent: true });
  }, 300));
  _sheetFlush = () => { const n = $("#objectiveNotes"); if (n) obj.notes = n.value; };
  $("#editObjectiveBtn").addEventListener("click", () => openObjectiveEditor(obj.id));
  $("#deleteObjectiveBtn").addEventListener("click", () => {
    if (!confirm("Supprimer cet objectif et toutes ses actions ?")) return;
    state.objectives = state.objectives.filter(o => o.id !== obj.id);
    state.visions.forEach(v => { if (v.linkedObjectiveId === obj.id) v.linkedObjectiveId = null; });
    state.today.picks = (state.today.picks || []).filter(p => p.objectiveId !== obj.id);
    saveState({ silent: true });
    closeSheet();
    renderAll();
    toast("Objectif supprimé.");
  });
}

function updateSheetProgress(obj) {
  const pct = computeObjectiveProgress(obj);
  const sheet = $("#editorSheet");
  const fill = $(".progress-fill", sheet);
  const hint = $(".hint", sheet);
  const chip = $(".score-chip", sheet);
  if (fill) fill.style.width = `${pct}%`;
  if (hint) hint.textContent = `${pct}% — ${progressMessage(pct)}`;
  if (chip) chip.textContent = `${pct}%`;
}

function renderSubgoalsEditor(obj) {
  const root = $("#subgoalsEditor");
  root.innerHTML = "";
  if (!obj.subgoals?.length) {
    root.appendChild(emptyState("Pas encore d'étape", "Ajoute une étape, puis des actions à cocher.", "+ étape", () => $("#addSubgoalBtn").click()));
    return;
  }
  obj.subgoals.forEach(sub => {
    const block = document.createElement("div");
    block.className = "subgoal-block";
    block.innerHTML = `
      <div class="subgoal-head">
        <input class="subgoal-title-input" value="${escapeAttr(sub.title || "")}" style="width:100%;background:transparent;color:white;border:0;outline:0;font-weight:900;font-size:15px" />
        <button class="inline-delete" type="button" aria-label="Supprimer">×</button>
      </div>
      <div class="sub-actions"></div>
      <div class="two-col" style="margin-top:10px">
        <input class="new-action-input" placeholder="Nouvelle action..." style="min-height:42px;border-radius:15px;border:1px solid rgba(255,255,255,.13);background:rgba(0,0,0,.2);color:white;padding:0 12px;outline:0" />
        <button class="ghost-btn add-action-btn" type="button">Ajouter</button>
      </div>
    `;
    $(".subgoal-title-input", block).addEventListener("input", debounce((e) => {
      sub.title = e.target.value || "Étape";
      saveState({ silent: true });
      renderObjectives();
      renderFocus();
    }, 400));
    $(".inline-delete", block).addEventListener("click", () => {
      obj.subgoals = obj.subgoals.filter(s => s.id !== sub.id);
      saveState({ silent: true });
      renderAll();
      renderSubgoalsEditor(obj);
    });
    const actionsRoot = $(".sub-actions", block);
    (sub.actions || []).forEach(action => {
      actionsRoot.appendChild(actionRow(action, () => {
        toggleAction(obj.id, sub.id, action.id);
        updateSheetProgress(obj);
        renderSubgoalsEditor(obj);
      }, () => {
        sub.actions = sub.actions.filter(a => a.id !== action.id);
        saveState({ silent: true });
        renderAll();
        renderSubgoalsEditor(obj);
      }, () => {
        action.priority = !action.priority;
        saveState({ silent: true });
        renderAll();
        renderSubgoalsEditor(obj);
      }));
    });
    const input = $(".new-action-input", block);
    const add = () => {
      const text = input.value.trim();
      if (!text) return;
      sub.actions ||= [];
      sub.actions.push({ id: uid("act"), text, done: false });
      input.value = "";
      saveState({ silent: true });
      renderAll();
      renderSubgoalsEditor(obj);
    };
    $(".add-action-btn", block).addEventListener("click", add);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
    root.appendChild(block);
  });
}

// ─── Today view ───────────────────────────────────────────────────────────────

function renderToday() {
  const view = $("#viewToday");
  if (!view) return;

  const todayDate = localDateStr();
  if (state.today.date !== todayDate) {
    state.today = { date: todayDate, picks: [] };
    _todayAllDoneToasted = false;
    saveState({ silent: true });
  }

  const picks = state.today.picks || [];

  // Resolve picks against current state
  const resolved = picks.map(p => {
    const obj = state.objectives.find(o => o.id === p.objectiveId);
    const sub = obj?.subgoals?.find(s => s.id === p.subId);
    const action = sub?.actions?.find(a => a.id === p.actionId);
    return action ? { ...p, action, obj, objTitle: obj.title } : null;
  }).filter(Boolean);

  // Purge des picks orphelins (action/objectif supprimé entre-temps)
  if (resolved.length !== picks.length) {
    state.today.picks = resolved.map(r => ({ objectiveId: r.objectiveId, subId: r.subId, actionId: r.actionId, text: r.action.text, objTitle: r.objTitle }));
    saveState({ silent: true });
  }

  const doneCount = resolved.filter(r => r.action.done).length;
  const formatted = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  view.innerHTML = "";

  const header = document.createElement("div");
  header.className = "section-title-row";
  header.innerHTML = `
    <div>
      <p class="eyebrow">Top 3 du jour</p>
      <h2>Mes 3 actions</h2>
    </div>
    <button id="pickTodayBtn" class="mini-btn">Choisir</button>
  `;
  view.appendChild(header);

  if (!resolved.length) {
    view.appendChild(emptyState(
      "Choisis tes 3 actions du jour",
      `${formatted}. Sélectionne 3 actions clés à accomplir aujourd'hui.`,
      "⚡ Choisir maintenant",
      openTodayPicker
    ));
  } else {
    const progDiv = document.createElement("div");
    progDiv.className = "today-progress";
    progDiv.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <p class="eyebrow" style="color:var(--muted)">${formatted}</p>
        <span class="meta-pill" style="font-weight:900">${doneCount}/${resolved.length}</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${Math.round(doneCount / resolved.length * 100)}%;--obj-c:var(--gold)"></div></div>
    `;
    view.appendChild(progDiv);

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "today-actions";
    resolved.forEach((r, i) => {
      const card = document.createElement("div");
      card.className = `today-pick ${r.action.done ? "done" : ""}`;
      card.innerHTML = `
        <div class="check ${r.action.done ? "done" : ""}"></div>
        <div class="today-pick-text">
          <p class="today-pick-title">${escapeHtml(r.action.text)}</p>
          <p class="today-pick-obj">${escapeHtml(r.objTitle || "")}</p>
        </div>
        <span class="meta-pill" style="flex:0 0 auto;font-weight:900">${i + 1}</span>
      `;
      card.addEventListener("click", () => {
        toggleAction(r.objectiveId, r.subId, r.actionId);
        // All-done celebration (debounced by flag)
        const allResolved = (state.today.picks || []).map(p2 => {
          const o = state.objectives.find(ob => ob.id === p2.objectiveId);
          const s = o?.subgoals?.find(sg => sg.id === p2.subId);
          return s?.actions?.find(ac => ac.id === p2.actionId);
        }).filter(Boolean);
        const allNowDone = allResolved.length > 0 && allResolved.every(a => a.done);
        if (allNowDone && !_todayAllDoneToasted) {
          _todayAllDoneToasted = true;
          setTimeout(() => { celebrate(100); toast("🏆 Top 3 du jour accompli ! Tu déchires."); }, 500);
        }
        if (!allNowDone) _todayAllDoneToasted = false;
      });
      actionsDiv.appendChild(card);
    });
    view.appendChild(actionsDiv);

    const changeBtn = document.createElement("button");
    changeBtn.className = "ghost-btn full";
    changeBtn.textContent = "Modifier mes picks";
    changeBtn.style.marginTop = "16px";
    changeBtn.addEventListener("click", openTodayPicker);
    view.appendChild(changeBtn);
  }

  $("#pickTodayBtn")?.addEventListener("click", openTodayPicker);
}

function openTodayPicker() {
  const existingPicks = (state.today.picks || []).map(p => p.actionId);
  const allActions = [];
  state.objectives.forEach(obj => {
    (obj.subgoals || []).forEach(sub => {
      (sub.actions || []).forEach(action => {
        // Actions non faites + celles déjà dans le Top 3 (même cochées, pour pouvoir les retirer)
        if (!action.done || existingPicks.includes(action.id)) {
          allActions.push({ objectiveId: obj.id, subId: sub.id, actionId: action.id, text: action.text, objTitle: obj.title, priority: !!action.priority });
        }
      });
    });
  });

  // Les actions prioritaires remontent en tête pour faciliter le choix du matin
  allActions.sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0));

  if (!allActions.length) {
    toast("Ajoute d'abord des actions non complétées dans tes objectifs.");
    return;
  }

  let selected = [...existingPicks];

  openSheet(`
    <div class="sheet-title-row">
      <div><p class="eyebrow">Top 3</p><h2>Actions du jour</h2></div>
      <button class="close-btn" data-close aria-label="Fermer">×</button>
    </div>
    <p class="hint">Choisis jusqu'à 3 actions clés à accomplir aujourd'hui. <span id="pickCounter" style="font-weight:900;color:var(--gold)">${selected.length}/3</span></p>
    <div id="pickerActions" class="form-grid" style="margin-bottom:8px"></div>
    <button id="saveTodayBtn" class="primary-btn full" style="margin-top:6px">Valider mes ${selected.length} action${selected.length !== 1 ? "s" : ""}</button>
  `);

  const renderPicker = () => {
    const root = $("#pickerActions");
    root.innerHTML = "";
    const counter = $("#pickCounter");
    if (counter) counter.textContent = `${selected.length}/3`;
    const saveBtn = $("#saveTodayBtn");
    if (saveBtn) saveBtn.textContent = `Valider mes ${selected.length} action${selected.length !== 1 ? "s" : ""}`;

    allActions.forEach(a => {
      const isSelected = selected.includes(a.actionId);
      const pos = selected.indexOf(a.actionId) + 1;
      const row = document.createElement("div");
      row.className = `action-row ${isSelected ? "done" : ""}`;
      row.innerHTML = `
        <div class="check ${isSelected ? "done" : ""}"></div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:800;color:var(--text)">${a.priority ? '<span class="prio-star">★</span> ' : ""}${escapeHtml(a.text)}</div>
          <div style="font-size:12px;color:var(--muted)">${escapeHtml(a.objTitle)}</div>
        </div>
        ${isSelected ? `<span class="meta-pill" style="font-weight:900">${pos}</span>` : ""}
      `;
      row.addEventListener("click", () => {
        if (selected.includes(a.actionId)) {
          selected = selected.filter(id => id !== a.actionId);
        } else {
          if (selected.length >= 3) { toast("Maximum 3 actions par jour."); return; }
          selected.push(a.actionId);
        }
        renderPicker();
      });
      root.appendChild(row);
    });
  };

  renderPicker();

  $("#saveTodayBtn").addEventListener("click", () => {
    state.today = { date: localDateStr(), picks: allActions.filter(a => selected.includes(a.actionId)) };
    if (selected.length) updateStreak(); // planifier son Top 3 entretient le streak
    _todayAllDoneToasted = false;
    saveState({ silent: true });
    closeSheet();
    renderAll();
    toast(`⚡ ${selected.length} action${selected.length !== 1 ? "s" : ""} du jour choisie${selected.length !== 1 ? "s" : ""} !`);
  });
}

// ─── Password sheet ───────────────────────────────────────────────────────────

async function handlePasswordToggle(e) {
  if (e.target.checked) {
    if (state.settings.passwordHash) {
      state.settings.passwordEnabled = true;
      saveState({ silent: true });
      toast("Mot de passe activé.");
      return;
    }
    e.target.checked = false;
    openChangePasswordSheet({ enabling: true });
    return;
  }
  state.settings.passwordEnabled = false;
  saveState({ silent: true });
  toast("Mot de passe désactivé.");
}

function openChangePasswordSheet({ enabling = false } = {}) {
  openSheet(`
    <div class="sheet-title-row">
      <div><p class="eyebrow">Sécurité</p><h2>${enabling ? "Créer" : "Changer"} le mot de passe</h2></div>
      <button class="close-btn" data-close aria-label="Fermer">×</button>
    </div>
    <div class="form-grid">
      <label class="field"><span>Nouveau mot de passe</span><input id="newPassword" type="password" placeholder="Minimum 4 caractères" /></label>
      <label class="field"><span>Confirmer</span><input id="newPasswordConfirm" type="password" placeholder="Répète le mot de passe" /></label>
      <button id="savePasswordBtn" class="primary-btn full">Sauvegarder</button>
    </div>
  `);
  $("#savePasswordBtn").addEventListener("click", async () => {
    const p1 = $("#newPassword").value.trim();
    const p2 = $("#newPasswordConfirm").value.trim();
    if (p1.length < 4) return toast("Minimum 4 caractères.");
    if (p1 !== p2) return toast("Les mots de passe ne correspondent pas.");
    state.settings.passwordHash = await hashPassword(p1);
    state.settings.passwordEnabled = true;
    saveState({ silent: true });
    closeSheet();
    renderAll();
    toast("Mot de passe sauvegardé.");
  });
}

function openGuideSheet() {
  openSheet(`
    <div class="sheet-title-row">
      <div><p class="eyebrow">Aide</p><h2>Guide d'utilisation</h2></div>
      <button class="close-btn" data-close aria-label="Fermer">×</button>
    </div>
    <div class="guide">
      <p class="guide-intro">TEM transforme tes rêves en petites actions quotidiennes. Une fourmi, un pas chaque jour. 🐜</p>

      <h3>La méthode en 4 temps</h3>
      <ol class="guide-list">
        <li><b>Pose ta vision</b> — les images de la vie que tu veux.</li>
        <li><b>Découpe en objectifs</b> — objectif → étapes → actions.</li>
        <li><b>Choisis ton Top 3</b> chaque matin — 3 actions, pas plus.</li>
        <li><b>Coche</b> et regarde ton score grimper.</li>
      </ol>

      <h3>Les onglets</h3>
      <div class="guide-tab"><span>✦</span><div><b>Vision</b> — ton mur d'inspiration. Appuie pour agrandir, glisse pour réorganiser, appui long pour supprimer. Relie une photo à un objectif : elle devient ton <i>pourquoi</i>.</div></div>
      <div class="guide-tab"><span>◇</span><div><b>Objectifs</b> — un grand domaine, avec son <i>pourquoi</i>, ses étapes et ses actions. Touche ★ pour marquer une action prioritaire.</div></div>
      <div class="guide-tab"><span>✓</span><div><b>Actions</b> — coche tout ce que tu fais. Les paliers d'un objectif déclenchent des célébrations.</div></div>
      <div class="guide-tab"><span>⚡</span><div><b>Top 3</b> — ton rituel du jour, max 3 actions. L'app s'ouvre directement ici.</div></div>
      <div class="guide-tab"><span>☾</span><div><b>Nid</b> — notes, rituels rapides, et ton bilan de la semaine (spécial le dimanche).</div></div>
      <div class="guide-tab"><span>⚙</span><div><b>Réglages</b> — mot de passe, export et import de tes données.</div></div>

      <h3>Ce qui te tient motivée</h3>
      <p class="muted">Le score animé, le streak 🔥 (entretenu dès que tu choisis ton Top 3), les confettis aux étapes clés, et l'étoile ★ pour tes priorités.</p>

      <h3>Installer sur ton iPhone</h3>
      <p class="muted">Dans Safari : bouton Partager → « Sur l'écran d'accueil ». TEM devient une vraie app avec l'icône 🐜.</p>

      <h3>Tes données</h3>
      <p class="muted">Tout reste sur ton téléphone. Pense à exporter de temps en temps pour garder une sauvegarde.</p>

      <h3>Ton rituel idéal</h3>
      <p class="muted">Matin : choisis ton Top 3. Journée : coche au fil de l'eau. Soir : un mot dans le Nid. Dimanche : savoure ton bilan. Petite fourmi par petite fourmi. 🐜💗</p>
    </div>
  `);
}

function openSheet(html) {
  _sheetFlush = null;
  const sheet = $("#editorSheet");
  sheet.style.transform = "";
  sheet.style.opacity = "";
  $("#sheetContent").innerHTML = html;
  $("#sheetBackdrop").classList.remove("hidden");
  sheet.classList.remove("hidden");
  $$("[data-close]", sheet).forEach(btn => btn.addEventListener("click", closeSheet));
}

function closeSheet() {
  _sheetFlush?.();
  _sheetFlush = null;
  selectedImageData = null;
  saveState({ silent: true });
  const sheet = $("#editorSheet");
  sheet.style.transition = "";
  sheet.style.opacity = "";
  sheet.style.transform = "";
  $("#sheetBackdrop").classList.add("hidden");
  sheet.classList.add("hidden");
  $("#sheetContent").innerHTML = "";
}

function emptyState(title, text, buttonLabel, onClick) {
  const div = document.createElement("div");
  div.className = "empty-state";
  div.innerHTML = `<h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p><button class="mini-btn">${escapeHtml(buttonLabel)}</button>`;
  $("button", div).addEventListener("click", onClick);
  return div;
}

// ─── Image utilities ──────────────────────────────────────────────────────────

async function compressImage(file) {
  const img = await readImage(file);
  const maxSide = 1400;
  const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * ratio);
  canvas.height = Math.round(img.naturalHeight * ratio);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  try { return canvas.toDataURL("image/webp", 0.82); }
  catch { return canvas.toDataURL("image/jpeg", 0.82); }
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function placeholderSvg(text = "TEM") {
  const clean = String(text || "TEM").slice(0, 22);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
    <defs>
      <radialGradient id="g" cx="30%" cy="20%">
        <stop offset="0" stop-color="#ff4fd8" stop-opacity=".72"/>
        <stop offset=".45" stop-color="#b46dff" stop-opacity=".34"/>
        <stop offset="1" stop-color="#08050a"/>
      </radialGradient>
      <filter id="blur"><feGaussianBlur stdDeviation="28"/></filter>
    </defs>
    <rect width="900" height="1200" fill="#08050a"/>
    <circle cx="220" cy="180" r="230" fill="#ff4fd8" opacity=".28" filter="url(#blur)"/>
    <circle cx="780" cy="340" r="260" fill="#b46dff" opacity=".24" filter="url(#blur)"/>
    <path d="M90 980 C240 820 360 1080 520 905 S740 850 815 720" fill="none" stroke="#ff8dea" stroke-opacity=".42" stroke-width="5"/>
    <text x="70" y="1020" fill="#fff8ff" font-family="Arial,sans-serif" font-size="78" font-weight="800">${escapeHtml(clean)}</text>
    <text x="72" y="1088" fill="#ff8dea" font-family="Arial,sans-serif" font-size="28" font-weight="700" letter-spacing="8">TEM BOARD</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ─── Data management ──────────────────────────────────────────────────────────

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tem-board-export-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Export téléchargé.");
}

async function importData(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) { toast("Fichier trop grand (max 50 Mo)."); e.target.value = ""; return; }
  try {
    const parsed = JSON.parse(await file.text());
    state = mergeState(defaultState(), parsed);
    saveState({ silent: true });
    renderAll();
    toast("Import réussi.");
  } catch { toast("Fichier impossible à importer."); }
  finally { e.target.value = ""; }
}

function resetApp() {
  if (!confirm("Tout supprimer et repartir de zéro ?")) return;
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  state = defaultState();
  _heroAnimated = false;
  closeSheet();
  setupLockFlow();
}

// ─── Toast & confetti ─────────────────────────────────────────────────────────

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.remove("hidden");
  el.style.animation = "none";
  requestAnimationFrame(() => { el.style.animation = ""; });
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.classList.add("hidden"), 2600);
}

function celebrate(amount = 24) {
  const layer = $("#confettiLayer");
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cx = w / 2;
  const cy = h * 0.38;
  const colors = ["#ff4fd8","#ff8dea","#b46dff","#ffd98b","#ffffff","#7dffcf","#ff5470","#5be0ff","#ffb347"];

  for (let i = 0; i < amount; i++) {
    setTimeout(() => {
      const spark = document.createElement("span");
      const size = 5 + Math.random() * 10;
      const isSquare = Math.random() > 0.55;
      spark.className = `spark${isSquare ? " spark-square" : ""}`;
      spark.style.left = `${cx + (Math.random() * 80 - 40)}px`;
      spark.style.top = `${cy + (Math.random() * 80 - 40)}px`;
      spark.style.width = `${size}px`;
      spark.style.height = `${size}px`;
      const angle = Math.random() * Math.PI * 2;
      const dist = 100 + Math.random() * 340;
      spark.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
      spark.style.setProperty("--dy", `${-Math.abs(Math.sin(angle) * dist) - 80}px`);
      spark.style.background = colors[Math.floor(Math.random() * colors.length)];
      spark.style.animationDuration = `${0.8 + Math.random() * 0.9}s`;
      layer.appendChild(spark);
      setTimeout(() => spark.remove(), 1800);
    }, i * 10);
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

// ─── Web Push (rappels de motivation via tem-backend) ──────────────────────────

function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function subscribeToPush() {
  const reg = await navigator.serviceWorker.ready;
  const resp = await fetch(`${BACKEND_URL}/api/push-key`, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error("serveur injoignable");
  const { publicKey } = await resp.json();
  if (!publicKey) throw new Error("clé VAPID absente");
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const r2 = await fetch(`${BACKEND_URL}/api/push-subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
    signal: AbortSignal.timeout(10000),
  });
  if (!r2.ok) throw new Error("abonnement refusé");
  return true;
}

async function unsubscribeFromPush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await sub.unsubscribe().catch(() => {});
      fetch(`${BACKEND_URL}/api/push-unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
    }
  } catch (e) {}
}

async function toggleNotifications() {
  const toggle = $("#notifToggle");
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    toast("Notifications non supportées sur ce navigateur.");
    if (toggle) toggle.checked = false;
    return;
  }
  if (isIOS() && !isStandalone()) {
    toast("Installe TEM sur l'écran d'accueil pour activer les rappels.");
    if (toggle) toggle.checked = false;
    return;
  }
  if (toggle.checked) {
    if (Notification.permission === "denied") {
      toast("Bloquées — Réglages iPhone → TEM → Notifications.");
      toggle.checked = false;
      return;
    }
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Permission refusée."); toggle.checked = false; return; }
    toast("Activation des rappels…");
    try {
      await subscribeToPush();
      state.settings.notifEnabled = true;
      saveState({ silent: true });
      toast("🔔 Rappels activés !");
    } catch (e) {
      toggle.checked = false;
      toast("⚠️ " + String(e.message || "échec").slice(0, 50));
    }
  } else {
    state.settings.notifEnabled = false;
    saveState({ silent: true });
    await unsubscribeFromPush();
    toast("🔕 Rappels désactivés.");
  }
  updateNotifUI();
}

function updateNotifUI() {
  const toggle = $("#notifToggle");
  const hint = $("#notifHint");
  if (!toggle) return;
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    toggle.checked = false; toggle.disabled = true;
    if (hint) hint.textContent = "Non supporté sur ce navigateur.";
    return;
  }
  if (isIOS() && !isStandalone()) {
    toggle.checked = false;
    if (hint) hint.textContent = "📲 Installe TEM sur l'écran d'accueil pour activer.";
    return;
  }
  if (Notification.permission === "denied") {
    toggle.checked = false;
    if (hint) hint.textContent = "❌ Bloquées — Réglages iPhone → TEM → Notifications.";
    return;
  }
  const on = !!state.settings.notifEnabled && Notification.permission === "granted";
  toggle.checked = on;
  if (hint) hint.textContent = on ? "✅ Rappels actifs : matin, midi et soir." : "Reçois 3 petits rappels motivants par jour.";
}

function debounce(fn, wait = 250) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value = "") {
  return escapeHtml(value).replaceAll("\n", " ");
}

boot();
