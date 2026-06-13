/* TEM 🐜 — mobile-first PWA vision board.
   V1 = no backend. Data is stored locally on the device/browser.
*/

const STORAGE_KEY = "tem-board-v1";
const SESSION_KEY = "tem-unlocked-session-v1";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const uid = (prefix = "id") => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const defaultState = () => ({
  version: 1,
  settings: {
    title: "TEM 🐜",
    passwordEnabled: true,
    passwordHash: null,
    hasCompletedSetup: false,
    firstName: "",
  },
  globalNotes: "",
  visions: [],
  objectives: [],
});

let state = loadState();
let selectedImageData = null;
let lastTouchDelete = { id: null, time: 0 };

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return mergeState(defaultState(), parsed);
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
  };
}

function saveState({ silent = false } = {}) {
  try {
    const serialized = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, serialized);
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

  if (needsSetup) {
    showLock("setup");
    return;
  }
  if (lockEnabled && !sessionUnlocked) {
    showLock("login");
    return;
  }
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
  $("#loginPassword").addEventListener("keydown", (e) => {
    if (e.key === "Enter") unlock();
  });
  $("#setupPasswordConfirm").addEventListener("keydown", (e) => {
    if (e.key === "Enter") createInitialPassword();
  });

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

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSheet();
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      toast("✨ Mise à jour — rechargement...");
      setTimeout(() => window.location.reload(), 1200);
    });
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }
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
  $("#greetingTitle").textContent = state.settings.firstName ? `${state.settings.firstName} Board` : "Life Progress Board";
  $("#globalNotes").value = state.globalNotes || "";
  $("#passwordToggle").checked = !!state.settings.passwordEnabled;
  renderHero();
  renderVisionGrid();
  renderObjectives();
  renderFocus();
}

function computeObjectiveProgress(objective) {
  const actions = getObjectiveActions(objective);
  if (!actions.length) return 0;
  const done = actions.filter(a => a.done).length;
  return Math.round((done / actions.length) * 100);
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
  if (pct >= 80) return "Presque au sommet. Continue, c’est solide.";
  if (pct >= 55) return "La dynamique est lancée. Ne casse pas le rythme.";
  if (pct >= 25) return "Ça prend forme, petite fourmi par petite fourmi.";
  if (pct > 0) return "Premier mouvement lancé. Maintenant on construit.";
  return "Chaque petite action construit la vision.";
}

function renderHero() {
  const pct = computeGlobalProgress();
  $("#globalScore").textContent = `${pct}%`;
  $("#globalMessage").textContent = progressMessage(pct);
  $("#ringLabel").textContent = `${pct}%`;
  $("#globalBar").style.width = `${pct}%`;
  const circumference = 314;
  $("#ringProgress").style.strokeDashoffset = `${circumference - (circumference * pct / 100)}`;
}

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
  let startX = 0, startY = 0, dragging = false, longPressTimer = null, target = null;
  let moved = false;

  card.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    moved = false;
    dragging = false;
    card.setPointerCapture?.(e.pointerId);

    longPressTimer = setTimeout(() => {
      if (!moved) {
        navigator.vibrate?.(28);
        confirmDeleteVision(id);
      }
    }, 760);
  });

  card.addEventListener("pointermove", (e) => {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.hypot(dx, dy) > 12) moved = true;
    if (moved) clearTimeout(longPressTimer);

    if (moved && !dragging) {
      dragging = true;
      card.classList.add("dragging");
    }
    if (dragging) {
      card.style.transform = `translate(${dx}px,${dy}px) scale(1.03)`;
      target = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".vision-card");
      $$(".vision-card").forEach(c => c.classList.remove("drop-target"));
      if (target && target !== card) target.classList.add("drop-target");
    }
  });

  card.addEventListener("pointerup", (e) => {
    clearTimeout(longPressTimer);
    card.releasePointerCapture?.(e.pointerId);
    const wasDragging = dragging;
    card.classList.remove("dragging");
    card.style.transform = "";
    $$(".vision-card").forEach(c => c.classList.remove("drop-target"));

    if (wasDragging && target && target !== card) {
      reorderVision(id, target.dataset.id);
    } else if (!moved) {
      openVisionDetail(id);
    }
    dragging = false;
    target = null;
  });

  card.addEventListener("pointercancel", () => {
    clearTimeout(longPressTimer);
    card.classList.remove("dragging");
    card.style.transform = "";
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

function renderObjectives() {
  const list = $("#objectivesList");
  list.innerHTML = "";
  if (!state.objectives.length) {
    list.appendChild(emptyState("Crée un pilier", "Un objectif principal contient des sous-objectifs et des actions cochables.", "+ ajouter un objectif", () => openObjectiveEditor()));
    return;
  }

  state.objectives.forEach(obj => {
    const pct = computeObjectiveProgress(obj);
    const totalActions = getObjectiveActions(obj).length;
    const doneActions = getObjectiveActions(obj).filter(a => a.done).length;
    const linkedVision = state.visions.find(v => v.id === obj.visionId);

    const card = document.createElement("article");
    card.className = "objective-card";
    card.innerHTML = `
      <div class="objective-head">
        <div>
          <p class="eyebrow">${linkedVision ? escapeHtml(linkedVision.title) : "PILIER TEM"}</p>
          <h3>${escapeHtml(obj.title || "Objectif")}</h3>
          <p class="muted">${escapeHtml(obj.why || "Ajoute le pourquoi de cet objectif.")}</p>
        </div>
        <div class="score-chip">${pct}%</div>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="objective-meta">
        <span class="meta-pill">${(obj.subgoals || []).length} sous-objectif(s)</span>
        <span class="meta-pill">${doneActions}/${totalActions} action(s)</span>
      </div>
    `;
    card.addEventListener("click", () => openObjectiveDetail(obj.id));
    list.appendChild(card);
  });
}

function renderFocus() {
  const list = $("#focusList");
  list.innerHTML = "";
  const objectivesWithActions = state.objectives.filter(o => getObjectiveActions(o).length);

  if (!objectivesWithActions.length) {
    list.appendChild(emptyState("Aucune action pour l’instant", "Ajoute des actions dans tes objectifs pour les cocher ici en mode focus.", "+ ajouter un objectif", () => openObjectiveEditor()));
    return;
  }

  objectivesWithActions.forEach(obj => {
    const pct = computeObjectiveProgress(obj);
    const card = document.createElement("article");
    card.className = "focus-card";
    card.innerHTML = `
      <div class="objective-head">
        <div>
          <p class="eyebrow">MISSION</p>
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
        block.appendChild(actionRow(action, () => {
          toggleAction(obj.id, sub.id, action.id);
        }));
      });
      actionsRoot.appendChild(block);
    });
    list.appendChild(card);
  });
}

function actionRow(action, onToggle, withDelete = null) {
  const row = document.createElement("div");
  row.className = `action-row ${action.done ? "done" : ""}`;
  row.innerHTML = `
    <div class="check"></div>
    <div class="action-text">${escapeHtml(action.text || "Action")}</div>
    ${withDelete ? `<button class="inline-delete" type="button">×</button>` : ""}
  `;
  row.addEventListener("click", (e) => {
    if (e.target.closest(".inline-delete")) return;
    onToggle();
  });
  if (withDelete) {
    $(".inline-delete", row).addEventListener("click", withDelete);
  }
  return row;
}

function toggleAction(objectiveId, subId, actionId) {
  const obj = state.objectives.find(o => o.id === objectiveId);
  const sub = obj?.subgoals?.find(s => s.id === subId);
  const action = sub?.actions?.find(a => a.id === actionId);
  if (!action) return;
  action.done = !action.done;
  saveState({ silent: true });
  renderAll();
  if (action.done) {
    toast(randomWinMessage(computeObjectiveProgress(obj)));
    celebrate(18);
  }
}

function randomWinMessage(pct) {
  if (pct >= 100) return "Objectif complété. Très gros score ✨";
  if (pct >= 80) return "Encore un step, ça sent la victoire.";
  if (pct >= 50) return "La barre monte. Rythme validé.";
  return "Petite action validée. La vision avance.";
}

function switchTab(name) {
  const views = {
    Vision: "#viewVision",
    Objectives: "#viewObjectives",
    Focus: "#viewFocus",
    Nest: "#viewNest",
    Settings: "#viewSettings",
  };
  Object.values(views).forEach(sel => $(sel).classList.remove("active"));
  $(views[name]).classList.add("active");
  $$("#bottomNav button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
}

function openQuickAddSheet() {
  openSheet(`
    <div class="sheet-title-row">
      <div><p class="eyebrow">Créer</p><h2>Nouvel élément</h2></div>
      <button class="close-btn" data-close>×</button>
    </div>
    <div class="stack">
      <button id="quickVision" class="primary-btn full">Ajouter une photo de vision</button>
      <button id="quickObjective" class="ghost-btn full">Ajouter un objectif principal</button>
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
      <button class="close-btn" data-close>×</button>
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
          <option value="">Aucun pour l’instant</option>
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

  // Event delegation sur le container — fonctionne même après remplacement du innerHTML
  $("#visionUploadBox").addEventListener("change", async (e) => {
    if (!e.target.matches("input[type='file']")) return;
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      selectedImageData = await compressImage(file);
    } catch {
      toast("Impossible de charger cette image.");
      return;
    }
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

function openVisionDetail(id) {
  const vision = state.visions.find(v => v.id === id);
  if (!vision) return;
  const linked = state.objectives.find(o => o.id === vision.linkedObjectiveId);
  openSheet(`
    <div class="sheet-title-row">
      <div><p class="eyebrow">${escapeHtml(vision.category || "VISION")}</p><h2>${escapeHtml(vision.title)}</h2></div>
      <button class="close-btn" data-close>×</button>
    </div>
    <div class="upload-box">
      <img src="${vision.image || placeholderSvg(vision.title)}" alt="">
    </div>
    <p class="muted">${escapeHtml(vision.subtitle || "Aucune phrase ajoutée.")}</p>
    ${linked ? `
      <article class="objective-card" id="linkedObjectiveCard">
        <div class="objective-head">
          <div><p class="eyebrow">Relié à</p><h3>${escapeHtml(linked.title)}</h3><p class="muted">${escapeHtml(linked.why || "")}</p></div>
          <div class="score-chip">${computeObjectiveProgress(linked)}%</div>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${computeObjectiveProgress(linked)}%"></div></div>
      </article>` : `<p class="hint">Cette vision n’est pas encore reliée à un objectif.</p>`}
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
    closeSheet();
    renderAll();
    toast("Photo supprimée.");
    lastTouchDelete = { id: null, time: 0 };
    return;
  }
  lastTouchDelete = { id, time: now };
  toast("Appuie encore une fois pour confirmer la suppression.");
}

function openObjectiveEditor(id = null) {
  const obj = id ? state.objectives.find(o => o.id === id) : null;
  openSheet(`
    <div class="sheet-title-row">
      <div><p class="eyebrow">${obj ? "Modifier" : "Créer"}</p><h2>Objectif principal</h2></div>
      <button class="close-btn" data-close>×</button>
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
      <button id="saveObjectiveBtn" class="primary-btn full">${obj ? "Sauvegarder" : "Créer l’objectif"}</button>
    </div>
  `);
  $("#saveObjectiveBtn").addEventListener("click", () => {
    const payload = {
      title: $("#objectiveTitle").value.trim() || "Nouvel objectif",
      why: $("#objectiveWhy").value.trim(),
      visionId: $("#objectiveVision").value || null,
      subgoals: obj?.subgoals || [],
      notes: obj?.notes || "",
    };
    if (obj) Object.assign(obj, payload);
    else {
      state.objectives.push({ id: uid("obj"), ...payload });
    }
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

  openSheet(`
    <div class="sheet-title-row">
      <div><p class="eyebrow">${vision ? escapeHtml(vision.title) : "PILIER"}</p><h2>${escapeHtml(obj.title)}</h2></div>
      <button class="close-btn" data-close>×</button>
    </div>
    <p class="muted">${escapeHtml(obj.why || "Ajoute le pourquoi de cet objectif.")}</p>
    <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    <p class="hint">${pct}% — ${progressMessage(pct)}</p>
    <div id="subgoalsEditor"></div>
    <button id="addSubgoalBtn" class="ghost-btn full">+ sous-objectif</button>
    <label class="field">
      <span>Notes de cet objectif</span>
      <textarea id="objectiveNotes" placeholder="Notes, idées, ressentis...">${escapeHtml(obj.notes || "")}</textarea>
    </label>
    <div class="actions-toolbar">
      <button id="editObjectiveBtn" class="ghost-btn">Modifier</button>
      <button id="deleteObjectiveBtn" class="danger-btn">Supprimer</button>
    </div>
  `);

  renderSubgoalsEditor(obj);
  $("#addSubgoalBtn").addEventListener("click", () => {
    obj.subgoals ||= [];
    obj.subgoals.push({ id: uid("sub"), title: "Nouveau sous-objectif", actions: [] });
    saveState({ silent: true });
    renderAll();
    renderSubgoalsEditor(obj);
  });
  $("#objectiveNotes").addEventListener("input", debounce(() => {
    obj.notes = $("#objectiveNotes").value;
    saveState({ silent: true });
  }, 300));
  $("#editObjectiveBtn").addEventListener("click", () => openObjectiveEditor(obj.id));
  $("#deleteObjectiveBtn").addEventListener("click", () => {
    if (!confirm("Supprimer cet objectif et toutes ses actions ?")) return;
    state.objectives = state.objectives.filter(o => o.id !== obj.id);
    state.visions.forEach(v => { if (v.linkedObjectiveId === obj.id) v.linkedObjectiveId = null; });
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
    root.appendChild(emptyState("Pas encore de sous-objectif", "Ajoute un sous-objectif, puis des actions à cocher.", "+ sous-objectif", () => $("#addSubgoalBtn").click()));
    return;
  }

  obj.subgoals.forEach(sub => {
    const block = document.createElement("div");
    block.className = "subgoal-block";
    block.innerHTML = `
      <div class="subgoal-head">
        <input class="subgoal-title-input" value="${escapeAttr(sub.title || "")}" style="width:100%;background:transparent;color:white;border:0;outline:0;font-weight:900;font-size:15px" />
        <button class="inline-delete" type="button">×</button>
      </div>
      <div class="sub-actions"></div>
      <div class="two-col" style="margin-top:10px">
        <input class="new-action-input" placeholder="Nouvelle action..." style="min-height:42px;border-radius:15px;border:1px solid rgba(255,255,255,.13);background:rgba(0,0,0,.2);color:white;padding:0 12px;outline:0" />
        <button class="ghost-btn add-action-btn" type="button">Ajouter</button>
      </div>
    `;

    $(".subgoal-title-input", block).addEventListener("input", debounce((e) => {
      sub.title = e.target.value || "Sous-objectif";
      saveState({ silent: true });
      renderAll();
    }, 250));

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
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") add();
    });

    root.appendChild(block);
  });
}

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
      <button class="close-btn" data-close>×</button>
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

function openSheet(html) {
  $("#sheetContent").innerHTML = html;
  $("#sheetBackdrop").classList.remove("hidden");
  $("#editorSheet").classList.remove("hidden");
  $$("[data-close]", $("#editorSheet")).forEach(btn => btn.addEventListener("click", closeSheet));
}

function closeSheet() {
  selectedImageData = null;
  saveState({ silent: true });
  $("#sheetBackdrop").classList.add("hidden");
  $("#editorSheet").classList.add("hidden");
  $("#sheetContent").innerHTML = "";
}

function emptyState(title, text, buttonLabel, onClick) {
  const div = document.createElement("div");
  div.className = "empty-state";
  div.innerHTML = `<h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p><button class="mini-btn">${escapeHtml(buttonLabel)}</button>`;
  $("button", div).addEventListener("click", onClick);
  return div;
}

async function compressImage(file) {
  const img = await readImage(file);
  const maxSide = 1400;
  const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * ratio);
  canvas.height = Math.round(img.naturalHeight * ratio);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  try {
    return canvas.toDataURL("image/webp", 0.82);
  } catch {
    return canvas.toDataURL("image/jpeg", 0.82);
  }
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
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
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
      <text x="70" y="1020" fill="#fff8ff" font-family="Arial, sans-serif" font-size="78" font-weight="800">${escapeHtml(clean)}</text>
      <text x="72" y="1088" fill="#ff8dea" font-family="Arial, sans-serif" font-size="28" font-weight="700" letter-spacing="8">TEM BOARD</text>
    </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

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
  if (file.size > 50 * 1024 * 1024) {
    toast("Fichier trop grand (max 50 Mo).");
    e.target.value = "";
    return;
  }
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    state = mergeState(defaultState(), parsed);
    saveState({ silent: true });
    renderAll();
    toast("Import réussi.");
  } catch {
    toast("Fichier impossible à importer.");
  } finally {
    e.target.value = "";
  }
}

function resetApp() {
  if (!confirm("Tout supprimer et repartir de zéro ?")) return;
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  state = defaultState();
  closeSheet();
  setupLockFlow();
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.classList.add("hidden"), 2400);
}

function celebrate(amount = 24) {
  const layer = $("#confettiLayer");
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (let i = 0; i < amount; i++) {
    const spark = document.createElement("span");
    spark.className = "spark";
    spark.style.left = `${w / 2 + (Math.random() * 90 - 45)}px`;
    spark.style.top = `${h * .38 + (Math.random() * 80 - 40)}px`;
    spark.style.setProperty("--dx", `${Math.random() * 260 - 130}px`);
    spark.style.setProperty("--dy", `${Math.random() * 260 - 190}px`);
    spark.style.background = ["#ff4fd8","#ff8dea","#b46dff","#ffd98b"][Math.floor(Math.random() * 4)];
    layer.appendChild(spark);
    setTimeout(() => spark.remove(), 950);
  }
}

function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
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
