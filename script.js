// =========================================================
// OP/ED CHART — lógica de la app (versión Firebase / Firestore)
//
// Los openings/endings y las calificaciones ahora se guardan en
// una base de datos Firestore compartida: cualquiera que visite
// la página ve el mismo catálogo y el mismo ranking, y se
// actualiza solo (sin recargar) cuando alguien califica o
// cuando el admin agrega/borra algo.
// =========================================================
import { db, auth } from './firebase-config.js';
import {
  collection, doc, addDoc, setDoc, deleteDoc,
  onSnapshot, query, orderBy,
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';

/* =========================================================
   CONFIG
   Este correo es solo un identificador para tu usuario admin
   en Firebase Authentication, no tiene que ser una bandeja real.
   Debe coincidir EXACTO con el usuario que crees en el paso
   "Authentication" del tutorial (README.md).
   ========================================================= */
const ADMIN_EMAIL = 'admin@opedchart.app';

/* ---------------- State ---------------- */
let entries = [];              // [{id, anime, number, type, videoId, addedAt}]
let ratingsMap = {};           // { entryId: score }
let currentFilter = 'all';
let isAdmin = false;
let entriesLoaded = false;
let ratingsLoaded = false;

/* ---------------- Elements ---------------- */
const el = {
  adminToggleBtn: document.getElementById('adminToggleBtn'),
  adminPanel: document.getElementById('adminPanel'),
  adminPasswordInput: document.getElementById('adminPasswordInput'),
  adminSubmitBtn: document.getElementById('adminSubmitBtn'),
  adminError: document.getElementById('adminError'),
  adminBadge: document.getElementById('adminBadge'),
  adminLogoutBtn: document.getElementById('adminLogoutBtn'),
  adminAddForm: document.getElementById('adminAddForm'),

  sidebar: document.getElementById('sidebar'),
  sidebarToggle: document.getElementById('sidebarToggle'),
  sidebarOverlay: document.getElementById('sidebarOverlay'),
  catalogList: document.getElementById('catalogList'),
  filterBtns: document.querySelectorAll('.filter-btn'),

  tableBody: document.getElementById('ratingTableBody'),
  emptyState: document.getElementById('emptyState'),
  entryCount: document.getElementById('entryCount'),

  newAnime: document.getElementById('newAnime'),
  newNumber: document.getElementById('newNumber'),
  newType: document.getElementById('newType'),
  newUrl: document.getElementById('newUrl'),
  newSubmit: document.getElementById('newEntrySubmit'),
  newFormError: document.getElementById('newFormError'),

  dbStatusBanner: document.getElementById('dbStatusBanner'),
};

/* ---------------- DB status banner ---------------- */
function showDbStatus(msg, kind) {
  el.dbStatusBanner.textContent = msg;
  el.dbStatusBanner.className = 'db-status ' + (kind || 'info');
  el.dbStatusBanner.classList.remove('hidden');
}
function hideDbStatusIfReady() {
  if (entriesLoaded && ratingsLoaded) {
    el.dbStatusBanner.classList.add('hidden');
  }
}
showDbStatus('Conectando con la base de datos…', 'info');

/* ---------------- YouTube helpers ---------------- */
function parseYouTubeId(url) {
  if (!url) return null;
  const trimmed = url.trim();
  const patterns = [
    /youtube\.com\/watch\?v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /youtube\.com\/embed\/([\w-]{11})/,
    /youtube\.com\/shorts\/([\w-]{11})/,
  ];
  for (const re of patterns) {
    const m = trimmed.match(re);
    if (m) return m[1];
  }
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  return null;
}
function thumbUrl(id) { return 'https://img.youtube.com/vi/' + id + '/mqdefault.jpg'; }
function watchUrl(id) { return 'https://www.youtube.com/watch?v=' + id; }
function openVideo(id) { window.open(watchUrl(id), '_blank', 'noopener,noreferrer'); }

/* ---------------- Ratings ---------------- */
// Solo existe una calificación por entrada (no un promedio de varias
// personas): quien la escriba, actualiza el valor que ven todos.
function getScore(entryId) {
  const val = ratingsMap[entryId];
  return typeof val === 'number' ? val : null;
}

async function submitRating(entryId, score) {
  try {
    await setDoc(doc(db, 'ratings', entryId), { score, updatedAt: Date.now() }, { merge: true });
  } catch (err) {
    alert('No se pudo guardar la calificación: ' + err.message);
  }
  // no hace falta volver a dibujar a mano: el listener onSnapshot
  // de "ratings" va a reaccionar solo para todos los que estén viendo la página.
}

/* ---------------- Admin (Firebase Authentication) ---------------- */
function showAdminError(msg) {
  el.adminError.textContent = msg;
  el.adminError.classList.remove('hidden');
}
function hideAdminError() { el.adminError.classList.add('hidden'); }

function updateAdminUI() {
  el.adminToggleBtn.classList.toggle('hidden', isAdmin);
  el.adminBadge.classList.toggle('hidden', !isAdmin);
  el.adminAddForm.classList.toggle('hidden', !isAdmin);
}

async function attemptAdminLogin() {
  const val = el.adminPasswordInput.value;
  if (!val) { showAdminError('Escribe la contraseña.'); return; }
  el.adminSubmitBtn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, val);
    el.adminPanel.classList.add('hidden');
    el.adminPasswordInput.value = '';
    hideAdminError();
  } catch (err) {
    showAdminError('Contraseña incorrecta.');
  } finally {
    el.adminSubmitBtn.disabled = false;
  }
}

onAuthStateChanged(auth, (user) => {
  isAdmin = !!user;
  updateAdminUI();
  renderAll();
});

el.adminToggleBtn.addEventListener('click', () => {
  el.adminPanel.classList.toggle('hidden');
  if (!el.adminPanel.classList.contains('hidden')) el.adminPasswordInput.focus();
});
el.adminSubmitBtn.addEventListener('click', attemptAdminLogin);
el.adminPasswordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') attemptAdminLogin();
});
el.adminLogoutBtn.addEventListener('click', () => { signOut(auth); });
document.addEventListener('click', (e) => {
  if (!el.adminPanel.classList.contains('hidden') &&
      !el.adminPanel.contains(e.target) &&
      e.target !== el.adminToggleBtn) {
    el.adminPanel.classList.add('hidden');
  }
});

/* ---------------- Add / delete entries (admin) ---------------- */
function showNewFormError(msg) {
  el.newFormError.textContent = msg;
  el.newFormError.classList.remove('hidden');
}

el.newSubmit.addEventListener('click', async () => {
  if (!isAdmin) { showNewFormError('Debes iniciar sesión como admin.'); return; }

  const anime = el.newAnime.value.trim();
  const number = el.newNumber.value.trim();
  const type = el.newType.value;
  const videoId = parseYouTubeId(el.newUrl.value);

  if (!anime) { showNewFormError('Escribe el nombre del anime.'); return; }
  if (!videoId) { showNewFormError('No reconocí el link de YouTube. Pega la URL completa del video.'); return; }
  el.newFormError.classList.add('hidden');

  el.newSubmit.disabled = true;
  el.newSubmit.textContent = 'Agregando…';
  try {
    await addDoc(collection(db, 'entries'), {
      anime, number: number || null, type, videoId, addedAt: Date.now(),
    });
    el.newAnime.value = '';
    el.newNumber.value = '';
    el.newUrl.value = '';
  } catch (err) {
    showNewFormError('No se pudo guardar: ' + err.message);
  } finally {
    el.newSubmit.disabled = false;
    el.newSubmit.textContent = 'Agregar al catálogo';
  }
});

async function deleteEntry(entryId) {
  if (!isAdmin) return;
  if (!confirm('¿Borrar este OP/ED del catálogo? Esta acción no se puede deshacer.')) return;
  try {
    await deleteDoc(doc(db, 'entries', entryId));
    await deleteDoc(doc(db, 'ratings', entryId));
  } catch (err) {
    alert('No se pudo borrar: ' + err.message);
  }
}

/* ---------------- Rendering ---------------- */
function entryLabel(entry) { return entry.type + (entry.number ? ' ' + entry.number : ''); }
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
function filteredEntries() {
  if (currentFilter === 'all') return entries;
  return entries.filter((e) => e.type === currentFilter);
}

function renderSidebar() {
  const list = filteredEntries();
  el.catalogList.innerHTML = '';

  if (!list.length) {
    el.catalogList.innerHTML = '<p class="empty-msg">' +
      (entriesLoaded ? 'No hay openings ni endings en esta categoría todavía.' : 'Cargando catálogo…') +
      '</p>';
    return;
  }

  const groups = {};
  list.forEach((e) => {
    if (!groups[e.anime]) groups[e.anime] = [];
    groups[e.anime].push(e);
  });

  Object.keys(groups).sort((a, b) => a.localeCompare(b)).forEach((animeName) => {
    const details = document.createElement('details');
    details.className = 'anime-group';

    const summary = document.createElement('summary');
    summary.textContent = animeName + ' (' + groups[animeName].length + ')';
    details.appendChild(summary);

    groups[animeName].forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'catalog-item';
      item.innerHTML =
        '<button class="catalog-thumb-btn" data-video="' + entry.videoId + '" title="Ver en YouTube">' +
          '<img src="' + thumbUrl(entry.videoId) + '" alt="Miniatura de ' + escapeHtml(entryLabel(entry)) + ' de ' + escapeHtml(animeName) + '" loading="lazy">' +
          '<span class="play-icon">▶</span>' +
        '</button>' +
        '<div class="catalog-item-info">' +
          '<span class="type-badge type-' + entry.type + '">' + escapeHtml(entryLabel(entry)) + '</span>' +
        '</div>' +
        (isAdmin ? '<button class="delete-btn" data-id="' + entry.id + '" title="Borrar del catálogo">🗑</button>' : '');
      details.appendChild(item);
    });

    el.catalogList.appendChild(details);
  });

  el.catalogList.querySelectorAll('.catalog-thumb-btn').forEach((btn) => {
    btn.addEventListener('click', () => openVideo(btn.dataset.video));
  });
  el.catalogList.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', (ev) => { ev.stopPropagation(); deleteEntry(btn.dataset.id); });
  });
}

function renderTable() {
  const list = filteredEntries().slice().sort((a, b) => {
    const scoreA = getScore(a.id);
    const scoreB = getScore(b.id);
    if (scoreA === null && scoreB === null) return b.addedAt - a.addedAt;
    if (scoreA === null) return 1;
    if (scoreB === null) return -1;
    return scoreB - scoreA;
  });

  el.entryCount.textContent = list.length ? list.length + (list.length === 1 ? ' entrada' : ' entradas') : '';
  el.tableBody.innerHTML = '';
  el.emptyState.classList.toggle('hidden', list.length > 0);
  if (!list.length && entriesLoaded) {
    el.emptyState.textContent = 'Todavía no hay openings ni endings cargados. Si eres admin, entra arriba a la derecha y agrega el primero desde el catálogo.';
  } else if (!list.length) {
    el.emptyState.textContent = 'Cargando catálogo…';
    el.emptyState.classList.remove('hidden');
  }

  list.forEach((entry, idx) => {
    const score = getScore(entry.id);

    const tr = document.createElement('tr');
    if (idx < 3) tr.classList.add('rank-' + (idx + 1));

    tr.innerHTML =
      '<td class="col-rank">' + (idx + 1) + '</td>' +
      '<td class="col-thumb">' +
        '<button class="table-thumb-btn" data-video="' + entry.videoId + '" title="Ver en YouTube">' +
          '<img src="' + thumbUrl(entry.videoId) + '" alt="Miniatura de ' + escapeHtml(entryLabel(entry)) + '" loading="lazy">' +
        '</button>' +
      '</td>' +
      '<td class="col-title">' +
        '<span class="table-anime">' + escapeHtml(entry.anime) + '</span>' +
        '<span class="type-badge type-' + entry.type + '">' + escapeHtml(entryLabel(entry)) + '</span>' +
      '</td>' +
      '<td class="col-avg">' + (score === null ? '—' : score.toFixed(1)) + '</td>' +
      '<td class="col-rate">' +
        '<input type="number" min="0" max="10" step="0.1" class="rate-input" value="' + (score !== null ? score : '') + '" placeholder="0–10" data-id="' + entry.id + '">' +
        '<button class="rate-btn" data-id="' + entry.id + '">' + (score !== null ? 'Actualizar' : 'Calificar') + '</button>' +
      '</td>';

    el.tableBody.appendChild(tr);
  });

  el.tableBody.querySelectorAll('.table-thumb-btn').forEach((btn) => {
    btn.addEventListener('click', () => openVideo(btn.dataset.video));
  });
  el.tableBody.querySelectorAll('.rate-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const input = el.tableBody.querySelector('.rate-input[data-id="' + id + '"]');
      const val = parseFloat(input.value);
      if (isNaN(val) || val < 0 || val > 10) {
        input.classList.add('input-error');
        input.focus();
        setTimeout(() => input.classList.remove('input-error'), 1200);
        return;
      }
      btn.disabled = true;
      submitRating(id, val).finally(() => { btn.disabled = false; });
    });
  });
}

function renderAll() {
  renderSidebar();
  renderTable();
}

/* ---------------- Filters ---------------- */
el.filterBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    el.filterBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderAll();
  });
});

/* ---------------- Sidebar drawer (mobile) ---------------- */
function openSidebar() {
  el.sidebar.classList.add('open');
  el.sidebarOverlay.classList.remove('hidden');
  el.sidebarToggle.setAttribute('aria-expanded', 'true');
}
function closeSidebar() {
  el.sidebar.classList.remove('open');
  el.sidebarOverlay.classList.add('hidden');
  el.sidebarToggle.setAttribute('aria-expanded', 'false');
}
el.sidebarToggle.addEventListener('click', () => {
  el.sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
});
el.sidebarOverlay.addEventListener('click', closeSidebar);

/* ---------------- Firestore listeners (tiempo real) ---------------- */
const entriesQuery = query(collection(db, 'entries'), orderBy('addedAt', 'asc'));
onSnapshot(entriesQuery, (snap) => {
  entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  entriesLoaded = true;
  hideDbStatusIfReady();
  renderAll();
}, (err) => {
  showDbStatus('No se pudo conectar con la base de datos. Revisa firebase-config.js y las reglas de Firestore (ver README). Detalle: ' + err.message, 'error');
});

onSnapshot(collection(db, 'ratings'), (snap) => {
  const map = {};
  snap.docs.forEach((d) => {
    const data = d.data();
    if (data && typeof data.score === 'number') map[d.id] = data.score;
  });
  ratingsMap = map;
  ratingsLoaded = true;
  hideDbStatusIfReady();
  renderAll();
}, (err) => {
  showDbStatus('No se pudo conectar con la base de datos. Revisa firebase-config.js y las reglas de Firestore (ver README). Detalle: ' + err.message, 'error');
});
