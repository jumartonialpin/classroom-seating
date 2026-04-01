/* ============================================================
   app-sa.js — Superadmin panel
   Requires: data.js, app-core.js (window._K_* bridge)
   Load AFTER app-core.js
============================================================ */
(() => {
  'use strict';

  /* ── Bridge: read/write app-core.js internal variables via window._K_* ── */
  let db, auth, showToast, openModal, closeModal, t, LS_KEY, applyLang;

  // Getters/setters for mutable variables shared with app-core.js
  Object.defineProperties(window._sabridge = {}, {});

  let nilaiRekapTab_local = 'per-siswa';
  let includeZero_local   = false;

  // We proxy nilaiRekapTab and includeZero through the window._K_* bridge
  // so that changes here are reflected in app-core.js and vice-versa
  function getNilaiRekapTab() {
    return (typeof window._K_nilaiRekapTab !== 'undefined') ? window._K_nilaiRekapTab : nilaiRekapTab_local;
  }
  function setNilaiRekapTab(v) {
    nilaiRekapTab_local = v;
    if (typeof window._K_nilaiRekapTab !== 'undefined') window._K_nilaiRekapTab = v;
  }
  function getIncludeZero() {
    return (typeof window._K_includeZero !== 'undefined') ? window._K_includeZero : includeZero_local;
  }
  function setIncludeZero(v) {
    includeZero_local = v;
    if (typeof window._K_includeZero !== 'undefined') window._K_includeZero = v;
  }

  /* ── Superadmin state ── */
  let saCurrentTab    = 'users';
  let saUsers         = [];
  let saAllClasses    = [];
  let saViewingUid    = null;
  let saViewingClasses = [];
  let saViewingClassId = null;
  let saSearchUsers   = '';
  let saSearchClasses = '';

  const MAX_CLASSES_KEY  = 'kelasku_sa_max_classes';
  const MAX_STUDENTS_KEY = 'kelasku_sa_max_students';

  /* ── Helper: escape HTML to prevent XSS ── */
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ── Superadmin i18n helper ── */
  function tSA(key) {
    return (typeof t === 'function') ? t(key) : (I18N.en[key] || key);
  }

  /* ══════════════════════════════════════════════════════════
     DOM INJECTION
  ══════════════════════════════════════════════════════════ */
  function injectSuperAdminPanel() {
    if (document.getElementById('sa-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'sa-panel';
    panel.className = 'modal-overlay';
    panel.innerHTML = `
      <div class="modal" style="max-width:780px;max-height:90vh;display:flex;flex-direction:column;">
        <div class="modal-header" style="flex-shrink:0;">
          <span class="modal-title" style="font-family:var(--font-display)">⚙️ ${esc(tSA('sa_title'))}</span>
          <button class="btn btn-ghost btn-icon" id="sa-close-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div style="display:flex;border-bottom:1px solid var(--border-primary);flex-shrink:0;overflow-x:auto;">
          <button class="sa-tab-btn active" data-sa-tab="users">${esc(tSA('sa_tab_users'))}</button>
          <button class="sa-tab-btn" data-sa-tab="classes">${esc(tSA('sa_tab_classes'))}</button>
          <button class="sa-tab-btn" data-sa-tab="settings">${esc(tSA('sa_tab_settings'))}</button>
        </div>
        <div class="modal-body" id="sa-body" style="flex:1;overflow-y:auto;padding:16px;">
          <p style="color:var(--text-muted)">${esc(tSA('sa_loading'))}</p>
        </div>
        <div style="padding:8px 16px;border-top:1px solid var(--border-primary);font-size:0.72rem;color:var(--text-muted);flex-shrink:0;">
          ${esc(tSA('sa_footer'))}
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    // Tab switching
    panel.querySelectorAll('.sa-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.sa-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        saCurrentTab = btn.dataset.saTab;
        saRenderCurrentTab();
      });
    });

    document.getElementById('sa-close-btn').addEventListener('click', () => {
      panel.classList.remove('open');
    });

    // Close on overlay click
    panel.addEventListener('click', e => {
      if (e.target === panel) panel.classList.remove('open');
    });

    injectSAStyles();
  }

  function injectSAStyles() {
    if (document.getElementById('sa-styles')) return;
    const style = document.createElement('style');
    style.id = 'sa-styles';
    style.textContent = `
      .sa-tab-btn {
        padding: 10px 16px;
        border: none;
        background: none;
        cursor: pointer;
        font-size: 0.85rem;
        font-weight: 500;
        color: var(--text-secondary);
        border-bottom: 2px solid transparent;
        white-space: nowrap;
        transition: color 0.15s, border-color 0.15s;
      }
      .sa-tab-btn:hover { color: var(--text-primary); }
      .sa-tab-btn.active { color: var(--accent-primary); border-bottom-color: var(--accent-primary); }
      .sa-user-card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        border-radius: var(--radius-md);
        border: 1px solid var(--border-primary);
        margin-bottom: 8px;
        background: var(--bg-card);
      }
      .sa-user-avatar {
        width: 38px; height: 38px; border-radius: 50%;
        background: var(--bg-secondary);
        display: flex; align-items: center; justify-content: center;
        font-weight: 700; font-size: 1rem; color: var(--accent-primary);
        flex-shrink: 0; overflow: hidden;
      }
      .sa-user-avatar img { width: 100%; height: 100%; object-fit: cover; }
      .sa-user-info { flex: 1; min-width: 0; }
      .sa-user-name { font-weight: 600; font-size: 0.88rem; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sa-user-email { font-size: 0.75rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sa-user-actions { display: flex; gap: 6px; flex-shrink: 0; flex-wrap: wrap; }
      .sa-chip { font-size: 0.7rem; padding: 2px 8px; border-radius: var(--radius-full); font-weight: 600; }
      .sa-chip-admin { background: #fef3c7; color: #92400e; }
      .sa-chip-user  { background: var(--bg-secondary); color: var(--text-muted); }
      .sa-class-card {
        padding: 10px 12px; border-radius: var(--radius-md);
        border: 1px solid var(--border-primary);
        background: var(--bg-card); margin-bottom: 8px;
      }
      .sa-class-name { font-weight: 600; font-size: 0.88rem; color: var(--text-primary); }
      .sa-class-meta { font-size: 0.74rem; color: var(--text-muted); margin-top: 2px; }
      .sa-search-input {
        width: 100%; padding: 8px 12px;
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-md);
        background: var(--bg-input); color: var(--text-primary);
        font-size: 0.85rem; margin-bottom: 12px;
        box-sizing: border-box;
      }
      .sa-back-btn {
        background: none; border: none; cursor: pointer;
        color: var(--accent-secondary); font-size: 0.85rem;
        padding: 0; margin-bottom: 12px; display: block;
      }
      .sa-back-btn:hover { text-decoration: underline; }
      .sa-settings-row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 0; border-bottom: 1px solid var(--border-primary); gap: 12px;
      }
      .sa-settings-label { font-weight: 500; font-size: 0.85rem; }
      .sa-settings-input {
        width: 80px; padding: 6px 10px; border: 1px solid var(--border-primary);
        border-radius: var(--radius-sm); background: var(--bg-input);
        color: var(--text-primary); font-size: 0.85rem; text-align: center;
      }
      .sa-summary-bar {
        font-size: 0.78rem; color: var(--text-muted); margin-bottom: 10px;
      }
      .sa-panel-toolbar { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
    `;
    document.head.appendChild(style);
  }

  function injectSuperAdminButtons() {
    // Wait until toolbar is visible (user is logged in)
    const userDropdown = document.getElementById('user-dropdown');
    if (!userDropdown || document.getElementById('sa-open-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'sa-open-btn';
    btn.className = 'user-dropdown-btn';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:14px;height:14px;">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
      ⚙️ ${esc(tSA('sa_title'))}
    `;
    btn.addEventListener('click', () => {
      userDropdown.classList.remove('open');
      openSAPanel();
    });
    userDropdown.insertBefore(btn, userDropdown.querySelector('#btn-logout'));

    // Override applyLang hook safely here (DOM is ready)
    try {
      const origApplyLang = window._K_applyLang;
      window._K_applyLang = function() {
        if (typeof origApplyLang === 'function') origApplyLang();
        try { saUpdatePanelTexts(); } catch(e) {}
      };
    } catch(e) {
      console.warn('[app-sa] applyLang override failed:', e);
    }
  }

  function saUpdatePanelTexts() {
    try {
      const titleEl = document.querySelector('#sa-panel .modal-title');
      if (titleEl) titleEl.textContent = '⚙️ ' + tSA('sa_title');
      const footerEl = document.querySelector('#sa-panel > .modal > div:last-child');
      if (footerEl) footerEl.textContent = tSA('sa_footer');
      document.querySelectorAll('#sa-panel .sa-tab-btn').forEach(btn => {
        const key = 'sa_tab_' + btn.dataset.saTab;
        if (btn.dataset.saTab) btn.textContent = tSA(key);
      });
    } catch(e) {}
  }

  function openSAPanel() {
    if (!document.getElementById('sa-panel')) injectSuperAdminPanel();
    const panel = document.getElementById('sa-panel');
    if (!panel) return;
    panel.classList.add('open');
    saRenderCurrentTab();
  }

  /* ══════════════════════════════════════════════════════════
     TAB RENDERING
  ══════════════════════════════════════════════════════════ */
  function saRenderCurrentTab() {
    switch (saCurrentTab) {
      case 'users':    saRenderUsersTab();    break;
      case 'classes':  saRenderClassesTab();  break;
      case 'settings': saRenderSettingsTab(); break;
      default:         saRenderUsersTab();
    }
  }

  /* ══════════════════════════════════════════════════════════
     USERS TAB
  ══════════════════════════════════════════════════════════ */
  async function saRenderUsersTab() {
    const body = document.getElementById('sa-body');
    if (!body) return;

    // If viewing a specific user's classes, show that
    if (saViewingUid) {
      saRenderUserClasses();
      return;
    }

    body.innerHTML = `<p class="sa-summary-bar">${esc(tSA('sa_loading_users'))}</p>`;

    try {
      const snap = await db.collection('users').get();
      saUsers = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    } catch(e) {
      body.innerHTML = `<p style="color:var(--accent-danger)">${esc(tSA('sa_err_load'))}${esc(e.message)}</p>`;
      return;
    }

    const currentUser = window._K_currentUser;
    const filtered = saUsers.filter(u => {
      if (!saSearchUsers) return true;
      const q = saSearchUsers.toLowerCase();
      return (u.displayName||'').toLowerCase().includes(q)
          || (u.email||'').toLowerCase().includes(q);
    });

    body.innerHTML = `
      <input class="sa-search-input" id="sa-search-users" placeholder="${esc(tSA('sa_search_users_placeholder'))}" value="${esc(saSearchUsers)}" />
      <p class="sa-summary-bar">${esc(tSA('sa_classes_summary'))} ${filtered.length} ${esc(tSA('sa_classes_summary2'))}</p>
      <div id="sa-users-list"></div>
    `;

    document.getElementById('sa-search-users').addEventListener('input', e => {
      saSearchUsers = e.target.value;
      saRenderUsersTab();
    });

    const list = document.getElementById('sa-users-list');
    if (filtered.length === 0) {
      list.innerHTML = `<p style="color:var(--text-muted)">${esc(tSA('sa_no_users'))}</p>`;
      return;
    }

    filtered.forEach(u => {
      const isYou = currentUser && u.uid === currentUser.uid;
      const isAdmin = u.role === 'superadmin';
      const card = document.createElement('div');
      card.className = 'sa-user-card';

      const initial = esc((u.displayName || u.email || '?')[0].toUpperCase());
      const avatarHtml = u.photoURL
        ? `<img src="${esc(u.photoURL)}" alt="" loading="lazy" />`
        : initial;

      card.innerHTML = `
        <div class="sa-user-avatar">${avatarHtml}</div>
        <div class="sa-user-info">
          <div class="sa-user-name">${esc(u.displayName || '—')}${isYou ? ` <span class="sa-chip sa-chip-admin">${esc(tSA('sa_you_label'))}</span>` : ''}</div>
          <div class="sa-user-email">${esc(u.email || u.uid)}</div>
        </div>
        <div class="sa-user-actions">
          <span class="sa-chip ${isAdmin ? 'sa-chip-admin' : 'sa-chip-user'}">${isAdmin ? 'superadmin' : 'user'}</span>
          <button class="btn btn-secondary" style="font-size:0.75rem;padding:4px 8px;" data-uid="${esc(u.uid)}" data-action="view-classes">${esc(tSA('sa_view_classes_btn'))}</button>
          ${!isYou && isAdmin ? `<button class="btn btn-secondary" style="font-size:0.75rem;padding:4px 8px;color:var(--accent-danger)" data-uid="${esc(u.uid)}" data-action="demote">${esc(tSA('sa_demote_btn'))}</button>` : ''}
          ${!isYou && !isAdmin ? `<button class="btn btn-secondary" style="font-size:0.75rem;padding:4px 8px;" data-uid="${esc(u.uid)}" data-action="promote">${esc(tSA('sa_promote_btn'))}</button>` : ''}
        </div>
      `;
      list.appendChild(card);
    });

    list.addEventListener('click', async e => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const { uid, action } = btn.dataset;
      if (action === 'view-classes') {
        saViewingUid = uid;
        saRenderUserClasses();
      } else if (action === 'promote') {
        await saChangeRole(uid, 'superadmin');
      } else if (action === 'demote') {
        if (!confirm(tSA('sa_confirm_revoke_admin'))) return;
        await saChangeRole(uid, 'user');
      }
    });
  }

  async function saChangeRole(uid, role) {
    try {
      await db.collection('users').doc(uid).set({ role }, { merge: true });
      showToast(tSA('sa_role_changed').replace('{role}', role), 'success');
      saRenderUsersTab();
    } catch(e) {
      showToast(tSA('sa_err_change_role') + e.message, 'error');
    }
  }

  async function saRenderUserClasses() {
    const body = document.getElementById('sa-body');
    if (!body) return;

    const user = saUsers.find(u => u.uid === saViewingUid);
    body.innerHTML = `
      <button class="sa-back-btn" id="sa-back-users">${esc(tSA('sa_back_to_users'))}</button>
      <p class="sa-summary-bar">${esc(tSA('sa_classes_owned_by'))} <strong>${esc(user ? (user.displayName || user.email || saViewingUid) : saViewingUid)}</strong></p>
      <p style="color:var(--text-muted)">${esc(tSA('sa_loading_class'))}</p>
    `;

    document.getElementById('sa-back-users').addEventListener('click', () => {
      saViewingUid = null;
      saRenderUsersTab();
    });

    try {
      const snap = await db.collection('users').doc(saViewingUid).collection('classes').get();
      saViewingClasses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
      body.querySelector('p:last-child').textContent = tSA('sa_err_load') + e.message;
      return;
    }

    const listEl = document.createElement('div');
    if (saViewingClasses.length === 0) {
      listEl.innerHTML = `<p style="color:var(--text-muted)">${esc(tSA('sa_no_user_classes'))}</p>`;
    } else {
      saViewingClasses.forEach(cls => {
        const card = document.createElement('div');
        card.className = 'sa-class-card';
        card.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:start;">
            <div>
              <div class="sa-class-name">${esc(cls.name || cls.id)}</div>
              <div class="sa-class-meta">${esc(tSA('sa_update'))} ${esc(cls.updatedAt ? new Date(cls.updatedAt).toLocaleDateString() : '—')}</div>
            </div>
            <button class="btn btn-danger" style="font-size:0.75rem;padding:4px 8px;" data-cls-id="${esc(cls.id)}" data-cls-name="${esc(cls.name || cls.id)}">🗑️</button>
          </div>
        `;
        listEl.appendChild(card);
      });

      listEl.addEventListener('click', async e => {
        const btn = e.target.closest('button[data-cls-id]');
        if (!btn) return;
        const user = saUsers.find(u => u.uid === saViewingUid);
        const username = user ? (user.displayName || user.email || saViewingUid) : saViewingUid;
        const msg = tSA('sa_confirm_delete_class')
          .replace('{name}', btn.dataset.clsName)
          .replace('{user}', username);
        if (!confirm(msg)) return;
        try {
          await db.collection('users').doc(saViewingUid).collection('classes').doc(btn.dataset.clsId).delete();
          showToast(tSA('sa_class_deleted').replace('{name}', btn.dataset.clsName), 'success');
          saRenderUserClasses();
        } catch(e) {
          showToast(tSA('sa_err_delete_class') + e.message, 'error');
        }
      });
    }

    body.querySelector('p:last-child').replaceWith(listEl);
  }

  /* ══════════════════════════════════════════════════════════
     CLASSES TAB
  ══════════════════════════════════════════════════════════ */
  async function saRenderClassesTab() {
    const body = document.getElementById('sa-body');
    if (!body) return;

    body.innerHTML = `<p style="color:var(--text-muted)">${esc(tSA('sa_loading_classes'))}</p>`;

    // Load all users
    let users = [];
    try {
      const snap = await db.collection('users').get();
      users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    } catch(e) {
      body.innerHTML = `<p style="color:var(--accent-danger)">${esc(tSA('sa_err_load'))}${esc(e.message)}</p>`;
      return;
    }

    // Load all classes for all users (sequential to avoid quota issues)
    const allClasses = [];
    for (const user of users) {
      try {
        const snap = await db.collection('users').doc(user.uid).collection('classes').get();
        snap.docs.forEach(d => {
          allClasses.push({ id: d.id, ownerUid: user.uid, ownerName: user.displayName || user.email || user.uid, ...d.data() });
        });
      } catch(e) {}
    }
    saAllClasses = allClasses;

    const filtered = saAllClasses.filter(c => {
      if (!saSearchClasses) return true;
      const q = saSearchClasses.toLowerCase();
      return (c.name || '').toLowerCase().includes(q)
          || (c.ownerName || '').toLowerCase().includes(q);
    });

    body.innerHTML = `
      <input class="sa-search-input" id="sa-search-classes" placeholder="${esc(tSA('sa_search_classes_placeholder'))}" value="${esc(saSearchClasses)}" />
      <p class="sa-summary-bar">${esc(tSA('sa_classes_summary'))} ${filtered.length} ${esc(tSA('sa_tab_classes').toLowerCase())}</p>
      <div id="sa-classes-list"></div>
    `;

    document.getElementById('sa-search-classes').addEventListener('input', e => {
      saSearchClasses = e.target.value;
      saRenderClassesTab();
    });

    const list = document.getElementById('sa-classes-list');
    if (filtered.length === 0) {
      list.innerHTML = `<p style="color:var(--text-muted)">${esc(tSA(saSearchClasses ? 'sa_no_classes_match' : 'sa_no_classes'))}</p>`;
      return;
    }

    filtered.forEach(cls => {
      const card = document.createElement('div');
      card.className = 'sa-class-card';
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:start;">
          <div>
            <div class="sa-class-name">${esc(cls.name || cls.id)}</div>
            <div class="sa-class-meta">${esc(tSA('sa_by'))} ${esc(cls.ownerName)} · ${esc(tSA('sa_update'))} ${esc(cls.updatedAt ? new Date(cls.updatedAt).toLocaleDateString() : '—')}</div>
          </div>
          <button class="btn btn-danger" style="font-size:0.75rem;padding:4px 8px;" data-cls-id="${esc(cls.id)}" data-owner-uid="${esc(cls.ownerUid)}" data-cls-name="${esc(cls.name || cls.id)}" data-owner-name="${esc(cls.ownerName)}">🗑️</button>
        </div>
      `;
      list.appendChild(card);
    });

    list.addEventListener('click', async e => {
      const btn = e.target.closest('button[data-cls-id]');
      if (!btn) return;
      const msg = tSA('sa_confirm_delete_class')
        .replace('{name}', btn.dataset.clsName)
        .replace('{user}', btn.dataset.ownerName);
      if (!confirm(msg)) return;
      try {
        await db.collection('users').doc(btn.dataset.ownerUid).collection('classes').doc(btn.dataset.clsId).delete();
        showToast(tSA('sa_class_deleted').replace('{name}', btn.dataset.clsName), 'success');
        saRenderClassesTab();
      } catch(e) {
        showToast(tSA('sa_err_delete_class') + e.message, 'error');
      }
    });
  }

  /* ══════════════════════════════════════════════════════════
     SETTINGS TAB
  ══════════════════════════════════════════════════════════ */
  function saRenderSettingsTab() {
    const body = document.getElementById('sa-body');
    if (!body) return;

    const maxClasses  = parseInt(localStorage.getItem(MAX_CLASSES_KEY)  || '10', 10);
    const maxStudents = parseInt(localStorage.getItem(MAX_STUDENTS_KEY) || '40', 10);

    body.innerHTML = `
      <div class="sa-settings-row">
        <span class="sa-settings-label">Max classes per user</span>
        <div style="display:flex;gap:8px;align-items:center;">
          <input class="sa-settings-input" type="number" id="sa-max-classes" min="1" max="100" value="${maxClasses}" />
          <button class="btn btn-secondary" id="sa-save-max-classes" style="font-size:0.8rem;">Save</button>
        </div>
      </div>
      <div class="sa-settings-row">
        <span class="sa-settings-label">Max students per class</span>
        <div style="display:flex;gap:8px;align-items:center;">
          <input class="sa-settings-input" type="number" id="sa-max-students" min="1" max="200" value="${maxStudents}" />
          <button class="btn btn-secondary" id="sa-save-max-students" style="font-size:0.8rem;">Save</button>
        </div>
      </div>
      <div class="sa-settings-row" style="border-bottom:none;margin-top:8px;">
        <span class="sa-settings-label" style="color:var(--accent-danger);">⚠️ Danger Zone</span>
        <button class="btn btn-danger" id="sa-nuke-btn" style="font-size:0.8rem;" disabled title="${esc(tSA('sa_nuke_disabled'))}">${esc(tSA('sa_nuke_confirm').split('?')[0])}…</button>
      </div>
    `;

    document.getElementById('sa-save-max-classes').addEventListener('click', () => {
      const val = parseInt(document.getElementById('sa-max-classes').value, 10);
      if (isNaN(val) || val < 1) return;
      localStorage.setItem(MAX_CLASSES_KEY, val);
      showToast(tSA('sa_max_classes_saved'), 'success');
    });

    document.getElementById('sa-save-max-students').addEventListener('click', () => {
      const val = parseInt(document.getElementById('sa-max-students').value, 10);
      if (isNaN(val) || val < 1) return;
      localStorage.setItem(MAX_STUDENTS_KEY, val);
      showToast(tSA('sa_max_students_saved'), 'success');
    });

    document.getElementById('sa-nuke-btn').addEventListener('click', () => {
      showToast(tSA('sa_nuke_disabled'), 'warning');
    });
  }

  /* ══════════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════════ */
  function init() {
    // Wait for app-core.js to expose its bridge
    const tryInit = () => {
      if (!window._K_db || !window._K_auth || !window._K_showToast) {
        setTimeout(tryInit, 100);
        return;
      }

      // Bind bridge variables
      db        = window._K_db;
      auth      = window._K_auth;
      showToast = window._K_showToast;
      openModal = window._K_openModal;
      closeModal= window._K_closeModal;
      t         = window._K_t;
      LS_KEY    = window._K_LS_KEY;
      applyLang = window._K_applyLang;

      // Listen for auth state to inject SA button when user logs in
      auth.onAuthStateChanged(async user => {
        if (!user) return;

        try {
          const doc = await db.collection('users').doc(user.uid).get();
          const data = doc.data() || {};
          if (data.role === 'superadmin') {
            // Give app-core.js a moment to render the toolbar
            setTimeout(() => {
              injectSuperAdminButtons();
            }, 300);
          }
        } catch(e) {
          console.warn('[app-sa] Role check failed:', e);
        }
      });
    };

    tryInit();
  }

  document.addEventListener('DOMContentLoaded', init);

})();
