/* ============================================================
   app-sa.js — Superadmin module + Auth orchestration
   Loaded after: data.js, app-core.js
   
   KEY FIX:
   1. injectSuperAdminHTML() — dynamically injects #btn-superadmin,
      #superadmin-badge, and #modal-superadmin into the DOM at load time.
   2. firebase.auth().onAuthStateChanged() — orchestrates login/logout:
      sets currentUser, shows app, loads classes, calls checkAndSetSuperAdmin().
============================================================ */
(() => {
  'use strict';

  /* ------------------------------------------------------------------
     HELPER: access core via window._K_* bridge
  ------------------------------------------------------------------ */
  const K = {
    get currentUser() { return window._K_getCurrentUser ? window._K_getCurrentUser() : null; },
    set currentUser(u) { if (window._K_setCurrentUser) window._K_setCurrentUser(u); },
    get currentClassId() { return window._K_getCurrentClassId ? window._K_getCurrentClassId() : null; },
    set currentClassId(id) { if (window._K_setCurrentClassId) window._K_setCurrentClassId(id); },
    showApp: () => window._K_showApp && window._K_showApp(),
    showLoginScreen: () => window._K_showLoginScreen && window._K_showLoginScreen(),
    updateUserUI: (u) => window._K_updateUserUI && window._K_updateUserUI(u),
    loadUserClasses: () => window._K_loadUserClasses && window._K_loadUserClasses(),
    loadBgFromFirestore: () => window._K_loadBgFromFirestore && window._K_loadBgFromFirestore(),
    applyBackground: () => window._K_applyBackground && window._K_applyBackground(),
    updateClassChip: (n) => window._K_updateClassChip && window._K_updateClassChip(n),
    bgKey: () => window._K_bgKey ? window._K_bgKey() : 'kelasku_v1_bg_anon',
    getState: () => window._K_getState ? window._K_getState() : {},
    t: (key) => window._K_t ? window._K_t(key) : key,
  };

  /* ------------------------------------------------------------------
     INJECT SA HTML — called immediately at module load
  ------------------------------------------------------------------ */
  function injectSuperAdminHTML() {
    // 1. Inject CSS styles
    if (!document.getElementById('sa-styles')) {
      const style = document.createElement('style');
      style.id = 'sa-styles';
      style.textContent = `
        #btn-superadmin { display: none; }
        #btn-superadmin.sa-visible { display: flex; }
        #superadmin-badge { display: none; font-size: 0.68rem; color: #dc2626;
          background: rgba(220,38,38,0.1); padding: 1px 8px;
          border-radius: 999px; font-weight: 700; margin-top: 2px; }
        #superadmin-badge.sa-visible { display: inline-block; }
        .sa-tab-content { display: none; }
        .sa-tab-content.active { display: block; }
        #modal-superadmin .stat-card {
          background: var(--bg-secondary); border: 1.5px solid var(--border-primary);
          border-radius: var(--radius-md); padding: 14px 16px; text-align: center; }
        #modal-superadmin .stat-value { font-size: 1.8rem; font-weight: 700;
          font-family: var(--font-display); color: var(--accent-primary); }
        #modal-superadmin .stat-label { font-size: 0.72rem; color: var(--text-muted);
          font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
        .sa-user-card, .sa-class-card, .sa-log-card {
          background: var(--bg-secondary); border: 1.5px solid var(--border-primary);
          border-radius: var(--radius-md); padding: 10px 14px; margin-bottom: 8px;
          display: flex; align-items: center; gap: 10px; font-size: 0.82rem; }
        .sa-user-card { flex-wrap: wrap; }
        .sa-user-name { font-weight: 600; color: var(--text-primary); flex: 1; min-width: 140px; }
        .sa-user-email { color: var(--text-muted); font-size: 0.75rem; }
        .sa-user-badge { font-size: 0.68rem; background: rgba(220,38,38,0.1);
          color: #dc2626; border-radius: 999px; padding: 1px 7px; font-weight: 700; }
        .sa-class-name { font-weight: 600; color: var(--text-primary); flex: 1; }
        .sa-class-meta { color: var(--text-muted); font-size: 0.75rem; }
        .sa-log-type { font-size: 0.68rem; background: var(--bg-card);
          border: 1px solid var(--border-primary); border-radius: var(--radius-sm);
          padding: 1px 7px; font-weight: 600; color: var(--text-secondary); }
        .sa-log-user { color: var(--text-primary); font-weight: 500; flex: 1; }
        .sa-log-time { color: var(--text-muted); font-size: 0.72rem; }
        .sa-log-detail { color: var(--text-secondary); font-size: 0.72rem; width: 100%; }
        .sa-empty { color: var(--text-muted); font-size: 0.85rem; text-align: center;
          padding: 20px; }
        [data-sa-tab] { font-size: 0.78rem !important; }
        [data-sa-tab].active { background: var(--accent-primary) !important;
          color: white !important; border-color: var(--accent-primary) !important; }
      `;
      document.head.appendChild(style);
    }

    // 2. Inject #btn-superadmin and #superadmin-badge into #user-dropdown
    const dropdown = document.getElementById('user-dropdown');
    if (dropdown && !document.getElementById('btn-superadmin')) {
      const userInfo = dropdown.querySelector('.user-info');
      const btnSwitchClass = document.getElementById('btn-switch-class');

      // Badge inside user-info
      if (userInfo) {
        const badge = document.createElement('span');
        badge.id = 'superadmin-badge';
        badge.setAttribute('data-i18n', 'sa_badge');
        badge.textContent = '🛡️ Superadmin';
        userInfo.appendChild(badge);
      }

      // Superadmin button BEFORE btn-switch-class
      const btnSA = document.createElement('button');
      btnSA.id = 'btn-superadmin';
      btnSA.className = 'user-dropdown-btn';
      btnSA.setAttribute('data-i18n', 'sa_btn_superadmin');
      btnSA.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:16px;height:16px;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Panel Superadmin`;
      btnSA.addEventListener('click', () => {
        dropdown.classList.remove('open');
        openSuperAdminPanel();
      });

      if (btnSwitchClass) {
        dropdown.insertBefore(btnSA, btnSwitchClass);
      } else {
        dropdown.appendChild(btnSA);
      }
    }

    // 3. Inject #modal-superadmin into document.body
    if (!document.getElementById('modal-superadmin')) {
      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.id = 'modal-superadmin';
      modal.innerHTML = `
        <div class="modal" style="max-width:780px;">
          <div class="modal-header">
            <span class="modal-title" data-i18n="sa_panel_title" style="font-family:var(--font-display)">🛡️ Superadmin Panel</span>
            <button class="btn btn-ghost btn-icon modal-close" data-modal="modal-superadmin">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div class="modal-body" style="padding:0;">
            <!-- SA Tabs -->
            <div style="display:flex;gap:4px;padding:12px 16px;border-bottom:1.5px solid var(--border-primary);background:var(--bg-secondary);overflow-x:auto;flex-wrap:nowrap;">
              <button class="btn btn-secondary active" data-sa-tab="dashboard" data-i18n="sa_tab_dashboard">Dashboard</button>
              <button class="btn btn-secondary" data-sa-tab="users" data-i18n="sa_tab_users">Users</button>
              <button class="btn btn-secondary" data-sa-tab="classes" data-i18n="sa_tab_classes">Classes</button>
              <button class="btn btn-secondary" data-sa-tab="logs" data-i18n="sa_tab_logs">Logs</button>
              <button class="btn btn-secondary" data-sa-tab="settings" data-i18n="sa_tab_settings">Settings</button>
            </div>

            <!-- Dashboard Tab -->
            <div class="sa-tab-content active" id="sa-content-dashboard" style="padding:16px;">
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:16px;">
                <div class="stat-card"><div class="stat-value" id="sa-total-users">…</div><div class="stat-label" data-i18n="sa_stat_users">Users</div></div>
                <div class="stat-card"><div class="stat-value" id="sa-total-classes">…</div><div class="stat-label" data-i18n="sa_stat_classes">Classes</div></div>
                <div class="stat-card"><div class="stat-value" id="sa-total-students">…</div><div class="stat-label" data-i18n="sa_stat_students">Students</div></div>
                <div class="stat-card"><div class="stat-value" id="sa-active-today">–</div><div class="stat-label" data-i18n="sa_stat_active">Active Today</div></div>
              </div>
              <p style="font-weight:600;font-size:0.88rem;margin-bottom:8px;" data-i18n="sa_recent_users">Recent Users</p>
              <div id="sa-recent-users"></div>
              <p style="font-weight:600;font-size:0.88rem;margin:14px 0 8px;" data-i18n="sa_recent_activity">Recent Activity</p>
              <div id="sa-recent-activity"></div>
            </div>

            <!-- Users Tab -->
            <div class="sa-tab-content" id="sa-content-users" style="padding:16px;">
              <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap;">
                <input type="text" class="form-input" id="sa-search-users" data-i18n-placeholder="sa_search_users" placeholder="Search users..." style="flex:1;min-width:160px;" />
                <button class="btn btn-secondary" id="btn-sa-refresh-users" data-i18n="sa_btn_refresh" style="white-space:nowrap;">🔄 Refresh</button>
              </div>
              <div id="sa-user-list"></div>
            </div>

            <!-- Classes Tab -->
            <div class="sa-tab-content" id="sa-content-classes" style="padding:16px;">
              <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap;">
                <input type="text" class="form-input" id="sa-search-classes" data-i18n-placeholder="sa_search_classes" placeholder="Search classes..." style="flex:1;min-width:160px;" />
                <button class="btn btn-secondary" id="btn-sa-refresh-classes" data-i18n="sa_btn_refresh" style="white-space:nowrap;">🔄 Refresh</button>
              </div>
              <div id="sa-class-list"></div>
            </div>

            <!-- Logs Tab -->
            <div class="sa-tab-content" id="sa-content-logs" style="padding:16px;">
              <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;flex-wrap:wrap;">
                <select class="form-select" id="sa-log-filter" style="width:auto;min-width:130px;font-size:0.82rem;">
                  <option value="all" data-i18n="sa_log_all">All Types</option>
                  <option value="login" data-i18n="sa_log_login">Login</option>
                  <option value="logout" data-i18n="sa_log_logout">Logout</option>
                  <option value="class_create" data-i18n="sa_log_class_create">Create Class</option>
                  <option value="class_delete" data-i18n="sa_log_class_delete">Delete Class</option>
                  <option value="attendance" data-i18n="sa_log_attendance">Attendance</option>
                  <option value="admin" data-i18n="sa_log_admin">Admin</option>
                </select>
                <input type="date" class="form-input" id="sa-log-date-from" style="width:auto;font-size:0.82rem;" />
                <span style="color:var(--text-muted)">–</span>
                <input type="date" class="form-input" id="sa-log-date-to" style="width:auto;font-size:0.82rem;" />
                <button class="btn btn-secondary" id="btn-sa-log-clear-date" data-i18n="sa_log_reset_date" style="font-size:0.72rem;white-space:nowrap;">Reset Date</button>
                <button class="btn btn-secondary" id="btn-sa-refresh-logs" data-i18n="sa_btn_refresh" style="white-space:nowrap;">🔄 Refresh</button>
                <button class="btn btn-danger" id="btn-sa-clear-logs" data-i18n="sa_btn_clear_logs" style="white-space:nowrap;">🗑 Clear Logs</button>
              </div>
              <div id="sa-log-list"></div>
            </div>

            <!-- Settings Tab -->
            <div class="sa-tab-content" id="sa-content-settings" style="padding:16px;">
              <p style="font-weight:600;margin-bottom:10px;" data-i18n="sa_settings_title">Add New Admin</p>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <input type="email" class="form-input" id="sa-new-admin-email" data-i18n-placeholder="sa_new_admin_email" placeholder="Email user to promote" style="flex:1;min-width:200px;" />
                <button class="btn btn-primary" id="btn-sa-add-admin" data-i18n="sa_btn_add_admin">Add Admin</button>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      // Bind SA modal tab events
      modal.querySelectorAll('[data-sa-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
          modal.querySelectorAll('[data-sa-tab]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          modal.querySelectorAll('.sa-tab-content').forEach(c => c.classList.remove('active'));
          const tab = btn.dataset.saTab;
          const content = document.getElementById('sa-content-' + tab);
          if (content) content.classList.add('active');
          // Load data for tab
          if (tab === 'dashboard') saLoadDashboard();
          else if (tab === 'users') saLoadUsers();
          else if (tab === 'classes') saLoadClasses();
          else if (tab === 'logs') saLoadLogs();
        });
      });

      // SA Refresh buttons
      const btnRefreshUsers = document.getElementById('btn-sa-refresh-users');
      if (btnRefreshUsers) btnRefreshUsers.addEventListener('click', saLoadUsers);

      const btnRefreshClasses = document.getElementById('btn-sa-refresh-classes');
      if (btnRefreshClasses) btnRefreshClasses.addEventListener('click', saLoadClasses);

      const btnRefreshLogs = document.getElementById('btn-sa-refresh-logs');
      if (btnRefreshLogs) btnRefreshLogs.addEventListener('click', saLoadLogs);

      const btnClearLogs = document.getElementById('btn-sa-clear-logs');
      if (btnClearLogs) {
        btnClearLogs.addEventListener('click', async () => {
          if (!confirm('Hapus semua log? Tindakan ini tidak bisa diurungkan.')) return;
          try {
            const snap = await db.collection('logs').limit(200).get();
            const batch = db.batch();
            snap.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
            saLoadLogs();
          } catch(e) {
            alert('Gagal hapus log: ' + e.message);
          }
        });
      }

      const btnClearDate = document.getElementById('btn-sa-log-clear-date');
      if (btnClearDate) {
        btnClearDate.addEventListener('click', () => {
          const fromEl = document.getElementById('sa-log-date-from');
          const toEl = document.getElementById('sa-log-date-to');
          if (fromEl) fromEl.value = '';
          if (toEl) toEl.value = '';
          saLoadLogs();
        });
      }

      const searchUsers = document.getElementById('sa-search-users');
      if (searchUsers) searchUsers.addEventListener('input', saFilterUsers);

      const searchClasses = document.getElementById('sa-search-classes');
      if (searchClasses) searchClasses.addEventListener('input', saFilterClasses);

      const logFilter = document.getElementById('sa-log-filter');
      if (logFilter) logFilter.addEventListener('change', saLoadLogs);

      const logDateFrom = document.getElementById('sa-log-date-from');
      if (logDateFrom) logDateFrom.addEventListener('change', saLoadLogs);

      const logDateTo = document.getElementById('sa-log-date-to');
      if (logDateTo) logDateTo.addEventListener('change', saLoadLogs);

      const btnAddAdmin = document.getElementById('btn-sa-add-admin');
      if (btnAddAdmin) {
        btnAddAdmin.addEventListener('click', async () => {
          const emailInput = document.getElementById('sa-new-admin-email');
          const email = emailInput ? emailInput.value.trim() : '';
          if (!email) return;
          try {
            const snap = await db.collection('users').where('email', '==', email).limit(1).get();
            if (snap.empty) { alert('User tidak ditemukan.'); return; }
            await db.collection('users').doc(snap.docs[0].id).update({ isSuperAdmin: true });
            if (emailInput) emailInput.value = '';
            alert('Admin berhasil ditambahkan!');
          } catch(e) {
            alert('Error: ' + e.message);
          }
        });
      }
    }
  }

  /* ------------------------------------------------------------------
     SUPERADMIN STATE
  ------------------------------------------------------------------ */
  let _saUsersCache = [];
  let _saClassesCache = [];

  /* ------------------------------------------------------------------
     CHECK & SET SUPERADMIN
  ------------------------------------------------------------------ */
  async function checkAndSetSuperAdmin() {
    const user = K.currentUser;
    if (!user) return;
    try {
      const doc = await db.collection('users').doc(user.uid).get();
      const isSA = doc.exists && doc.data().isSuperAdmin === true;
      updateSuperAdminUI(isSA);
    } catch(e) {
      console.warn('checkAndSetSuperAdmin error:', e);
      updateSuperAdminUI(false);
    }
  }

  /* ------------------------------------------------------------------
     UPDATE SUPERADMIN UI
  ------------------------------------------------------------------ */
  function updateSuperAdminUI(isSuperAdmin) {
    const btnSA = document.getElementById('btn-superadmin');
    const badgeInfo = document.getElementById('superadmin-badge');

    if (btnSA) {
      btnSA.classList.toggle('sa-visible', isSuperAdmin);
    }
    if (badgeInfo) {
      badgeInfo.classList.toggle('sa-visible', isSuperAdmin);
    }
  }

  /* ------------------------------------------------------------------
     OPEN SUPERADMIN PANEL
  ------------------------------------------------------------------ */
  function openSuperAdminPanel() {
    if (window._K_openModal) window._K_openModal('modal-superadmin');
    saLoadDashboard();
  }

  /* ------------------------------------------------------------------
     WRITE LOG
  ------------------------------------------------------------------ */
  async function writeLog(type, detail = '') {
    const user = K.currentUser;
    if (!user) return;
    try {
      await db.collection('logs').add({
        type,
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || '',
        detail,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch(e) {
      // Silently fail - logging should not break the app
    }
  }

  /* ------------------------------------------------------------------
     SA LOAD DASHBOARD
  ------------------------------------------------------------------ */
  async function saLoadDashboard() {
    const loadingHtml = `<p class="sa-empty">${K.t('sa_loading')}</p>`;

    // Update stat placeholders
    ['sa-total-users','sa-total-classes','sa-total-students','sa-active-today'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '…';
    });

    try {
      // Total users
      const usersSnap = await db.collection('users').get();
      const totalUsers = usersSnap.size;
      const elUsers = document.getElementById('sa-total-users');
      if (elUsers) elUsers.textContent = totalUsers;

      // Total classes & students (iterate all users' classes)
      let totalClasses = 0;
      let totalStudents = 0;
      const recentUsers = [];

      for (const userDoc of usersSnap.docs) {
        const uData = userDoc.data();
        recentUsers.push({ id: userDoc.id, ...uData });
        const classesSnap = await db.collection('users').doc(userDoc.id).collection('classes').get();
        totalClasses += classesSnap.size;
        classesSnap.docs.forEach(cd => {
          totalStudents += (cd.data().studentCount || 0);
        });
      }

      const elClasses = document.getElementById('sa-total-classes');
      if (elClasses) elClasses.textContent = totalClasses;
      const elStudents = document.getElementById('sa-total-students');
      if (elStudents) elStudents.textContent = totalStudents;

      // Active today (from logs)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayLogsSnap = await db.collection('logs')
        .where('type', '==', 'login')
        .where('createdAt', '>=', today)
        .get();
      const activeToday = new Set(todayLogsSnap.docs.map(d => d.data().uid)).size;
      const elActive = document.getElementById('sa-active-today');
      if (elActive) elActive.textContent = activeToday;

      // Recent users (last 5)
      const recentUsersEl = document.getElementById('sa-recent-users');
      if (recentUsersEl) {
        const sorted = [...recentUsers].sort((a, b) => {
          const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
          const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
          return tb - ta;
        }).slice(0, 5);

        if (sorted.length === 0) {
          recentUsersEl.innerHTML = `<p class="sa-empty">${K.t('sa_no_users')}</p>`;
        } else {
          recentUsersEl.innerHTML = sorted.map(u => `
            <div class="sa-user-card">
              <div style="flex:1;">
                <div class="sa-user-name">${_esc(u.displayName || u.email || u.id)}
                  ${u.isSuperAdmin ? `<span class="sa-user-badge">${K.t('sa_badge')}</span>` : ''}
                  ${u.id === (K.currentUser?.uid) ? `<span style="font-size:0.7rem;color:var(--text-muted)">${K.t('sa_you_label')}</span>` : ''}
                </div>
                <div class="sa-user-email">${_esc(u.email || '')}</div>
              </div>
            </div>
          `).join('');
        }
      }

      // Recent activity (last 5 logs)
      const recentActEl = document.getElementById('sa-recent-activity');
      if (recentActEl) {
        const logsSnap = await db.collection('logs')
          .orderBy('createdAt', 'desc').limit(5).get();
        if (logsSnap.empty) {
          recentActEl.innerHTML = `<p class="sa-empty">${K.t('sa_no_activity')}</p>`;
        } else {
          recentActEl.innerHTML = logsSnap.docs.map(d => {
            const log = d.data();
            const time = log.createdAt?.toDate ? log.createdAt.toDate().toLocaleString() : '–';
            return `
              <div class="sa-log-card" style="flex-wrap:wrap;">
                <span class="sa-log-type">${_esc(log.type || '')}</span>
                <span class="sa-log-user">${_esc(log.displayName || log.email || log.uid || '')}</span>
                <span class="sa-log-time">${time}</span>
                ${log.detail ? `<span class="sa-log-detail">${_esc(log.detail)}</span>` : ''}
              </div>
            `;
          }).join('');
        }
      }
    } catch(e) {
      console.warn('saLoadDashboard error:', e);
      const el = document.getElementById('sa-recent-users');
      if (el) el.innerHTML = `<p class="sa-empty">${K.t('sa_err_load')}</p>`;
    }
  }

  /* ------------------------------------------------------------------
     SA LOAD USERS
  ------------------------------------------------------------------ */
  async function saLoadUsers() {
    const listEl = document.getElementById('sa-user-list');
    if (!listEl) return;
    listEl.innerHTML = `<p class="sa-empty">${K.t('sa_loading_users')}</p>`;

    try {
      const snap = await db.collection('users').orderBy('email').get();
      _saUsersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _renderUserList(_saUsersCache);
    } catch(e) {
      listEl.innerHTML = `<p class="sa-empty">${K.t('sa_err_load')}</p>`;
    }
  }

  function saFilterUsers() {
    const q = (document.getElementById('sa-search-users')?.value || '').toLowerCase();
    const filtered = q
      ? _saUsersCache.filter(u =>
          (u.email || '').toLowerCase().includes(q) ||
          (u.displayName || '').toLowerCase().includes(q))
      : _saUsersCache;
    _renderUserList(filtered);
  }

  function _renderUserList(users) {
    const listEl = document.getElementById('sa-user-list');
    if (!listEl) return;
    if (users.length === 0) {
      listEl.innerHTML = `<p class="sa-empty">${K.t('sa_no_users')}</p>`;
      return;
    }
    listEl.innerHTML = users.map(u => `
      <div class="sa-user-card">
        <div style="flex:1;min-width:0;">
          <div class="sa-user-name">
            ${_esc(u.displayName || u.email || u.id)}
            ${u.isSuperAdmin ? `<span class="sa-user-badge">${K.t('sa_badge')}</span>` : ''}
            ${u.id === (K.currentUser?.uid) ? `<span style="font-size:0.7rem;color:var(--text-muted);margin-left:4px;">${K.t('sa_you_label')}</span>` : ''}
          </div>
          <div class="sa-user-email">${_esc(u.email || u.id)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
          <button class="btn btn-secondary" style="font-size:0.72rem;"
            onclick="window._SA_viewClasses('${_esc(u.id)}','${_esc(u.displayName || u.email || u.id)}')"
            data-i18n="sa_view_classes_btn">${K.t('sa_view_classes_btn')}</button>
          ${u.id !== (K.currentUser?.uid) ? `
            <button class="btn ${u.isSuperAdmin ? 'btn-danger' : 'btn-secondary'}" style="font-size:0.72rem;"
              onclick="window._SA_toggleRole('${_esc(u.id)}',${!!u.isSuperAdmin})"
              data-i18n="${u.isSuperAdmin ? 'sa_demote_btn' : 'sa_promote_btn'}">
              ${u.isSuperAdmin ? K.t('sa_demote_btn') : K.t('sa_promote_btn')}
            </button>
          ` : ''}
        </div>
      </div>
    `).join('');
  }

  /* ------------------------------------------------------------------
     SA TOGGLE ROLE
  ------------------------------------------------------------------ */
  window._SA_toggleRole = async (uid, currentlyAdmin) => {
    const msg = currentlyAdmin ? K.t('sa_confirm_demote') : K.t('sa_confirm_promote');
    if (!confirm(msg)) return;
    try {
      await db.collection('users').doc(uid).update({ isSuperAdmin: !currentlyAdmin });
      await writeLog('admin', `${currentlyAdmin ? 'demote' : 'promote'} uid:${uid}`);
      if (window._K_showToast) window._K_showToast(K.t('sa_role_changed'), 'success');
      saLoadUsers();
    } catch(e) {
      if (window._K_showToast) window._K_showToast(K.t('sa_err_change_role'), 'error');
    }
  };

  /* ------------------------------------------------------------------
     SA VIEW CLASSES FOR USER
  ------------------------------------------------------------------ */
  window._SA_viewClasses = async (uid, displayName) => {
    const listEl = document.getElementById('sa-user-list');
    if (listEl) {
      listEl.innerHTML = `<p class="sa-empty">${K.t('sa_loading_classes')}</p>`;
    }
    await saRenderClassesFor(uid, displayName);
  };

  async function saRenderClassesFor(uid, displayName) {
    const listEl = document.getElementById('sa-user-list');
    if (!listEl) return;
    try {
      const snap = await db.collection('users').doc(uid).collection('classes').get();
      if (snap.empty) {
        listEl.innerHTML = `
          <button class="btn btn-secondary" style="margin-bottom:10px;" onclick="window._SA_backToUsers()">← Back</button>
          <p class="sa-empty">${K.t('sa_no_classes')}</p>`;
        return;
      }
      const classes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      listEl.innerHTML = `
        <button class="btn btn-secondary" style="margin-bottom:10px;font-size:0.78rem;" onclick="window._SA_backToUsers()">← Back</button>
        <p style="font-weight:600;font-size:0.82rem;margin-bottom:8px;">${_esc(displayName)}</p>
        ${classes.map(cls => `
          <div class="sa-class-card">
            <div style="flex:1;">
              <div class="sa-class-name">${_esc(cls.name)}</div>
              <div class="sa-class-meta">${cls.studentCount || 0} students</div>
            </div>
          </div>
        `).join('')}
      `;
    } catch(e) {
      if (listEl) listEl.innerHTML = `<p class="sa-empty">${K.t('sa_err_load')}</p>`;
    }
  }

  window._SA_backToUsers = () => {
    _renderUserList(_saUsersCache);
  };

  /* ------------------------------------------------------------------
     SA LOAD CLASSES
  ------------------------------------------------------------------ */
  async function saLoadClasses() {
    const listEl = document.getElementById('sa-class-list');
    if (!listEl) return;
    listEl.innerHTML = `<p class="sa-empty">${K.t('sa_loading_classes')}</p>`;

    try {
      const usersSnap = await db.collection('users').get();
      const allClasses = [];
      for (const uDoc of usersSnap.docs) {
        const uData = uDoc.data();
        const clsSnap = await db.collection('users').doc(uDoc.id).collection('classes').get();
        clsSnap.docs.forEach(cd => {
          allClasses.push({
            id: cd.id, userId: uDoc.id,
            ownerEmail: uData.email || uDoc.id,
            ownerName: uData.displayName || uData.email || uDoc.id,
            ...cd.data()
          });
        });
      }
      _saClassesCache = allClasses;
      _renderClassList(allClasses);
    } catch(e) {
      listEl.innerHTML = `<p class="sa-empty">${K.t('sa_err_load')}</p>`;
    }
  }

  function saFilterClasses() {
    const q = (document.getElementById('sa-search-classes')?.value || '').toLowerCase();
    const filtered = q
      ? _saClassesCache.filter(c =>
          (c.name || '').toLowerCase().includes(q) ||
          (c.ownerEmail || '').toLowerCase().includes(q) ||
          (c.ownerName || '').toLowerCase().includes(q))
      : _saClassesCache;
    _renderClassList(filtered);
  }

  function _renderClassList(classes) {
    const listEl = document.getElementById('sa-class-list');
    if (!listEl) return;
    if (classes.length === 0) {
      listEl.innerHTML = `<p class="sa-empty">${K.t('sa_no_classes')}</p>`;
      return;
    }
    listEl.innerHTML = classes.map(cls => `
      <div class="sa-class-card">
        <div style="flex:1;min-width:0;">
          <div class="sa-class-name">${_esc(cls.name || cls.id)}</div>
          <div class="sa-class-meta">${_esc(cls.ownerName || cls.ownerEmail || cls.userId)} · ${cls.studentCount || 0} students</div>
        </div>
      </div>
    `).join('');
  }

  /* ------------------------------------------------------------------
     SA LOAD LOGS
  ------------------------------------------------------------------ */
  async function saLoadLogs() {
    const listEl = document.getElementById('sa-log-list');
    if (!listEl) return;
    listEl.innerHTML = `<p class="sa-empty">${K.t('sa_loading_logs')}</p>`;

    try {
      const filterType = document.getElementById('sa-log-filter')?.value || 'all';
      const fromDate = document.getElementById('sa-log-date-from')?.value;
      const toDate = document.getElementById('sa-log-date-to')?.value;

      let query = db.collection('logs').orderBy('createdAt', 'desc').limit(100);
      if (filterType !== 'all') query = query.where('type', '==', filterType);

      const snap = await query.get();
      let docs = snap.docs;

      // Client-side date filter
      if (fromDate) {
        const from = new Date(fromDate);
        docs = docs.filter(d => {
          const dt = d.data().createdAt?.toDate ? d.data().createdAt.toDate() : null;
          return dt && dt >= from;
        });
      }
      if (toDate) {
        const to = new Date(toDate);
        to.setHours(23, 59, 59, 999);
        docs = docs.filter(d => {
          const dt = d.data().createdAt?.toDate ? d.data().createdAt.toDate() : null;
          return dt && dt <= to;
        });
      }

      _renderLogDocs(docs);
    } catch(e) {
      listEl.innerHTML = `<p class="sa-empty">${K.t('sa_err_load')}</p>`;
    }
  }

  function _renderLogDocs(docs) {
    const listEl = document.getElementById('sa-log-list');
    if (!listEl) return;
    if (docs.length === 0) {
      listEl.innerHTML = `<p class="sa-empty">${K.t('sa_no_logs')}</p>`;
      return;
    }
    listEl.innerHTML = docs.map(d => {
      const log = d.data();
      const time = log.createdAt?.toDate ? log.createdAt.toDate().toLocaleString() : '–';
      return `
        <div class="sa-log-card" style="flex-wrap:wrap;gap:6px;">
          <span class="sa-log-type">${_esc(log.type || '')}</span>
          <span class="sa-log-user">${_esc(log.displayName || log.email || log.uid || '')}</span>
          <span class="sa-log-time">${time}</span>
          ${log.detail ? `<span class="sa-log-detail" style="flex-basis:100%;">${_esc(log.detail)}</span>` : ''}
        </div>
      `;
    }).join('');
  }

  /* ------------------------------------------------------------------
     HELPER: HTML escape
  ------------------------------------------------------------------ */
  function _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ------------------------------------------------------------------
     i18n HOOK — update SA elements when language changes
  ------------------------------------------------------------------ */
  function saUpdateI18n() {
    // Update SA modal tab buttons
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      const txt = K.t(key);
      if (!txt || txt === key) return;
      if (el.children.length === 0) {
        el.textContent = txt;
      } else {
        const textNode = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
        if (textNode) textNode.textContent = txt;
      }
    });

    // Update placeholder attributes
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const txt = K.t(key);
      if (txt && txt !== key) el.placeholder = txt;
    });

    // Update select option texts
    document.querySelectorAll('select option[data-i18n]').forEach(opt => {
      const key = opt.dataset.i18n;
      const txt = K.t(key);
      if (txt && txt !== key) opt.textContent = txt;
    });
  }

  // Register as applyLang hook
  window._K_applyLangHook = saUpdateI18n;

  /* ------------------------------------------------------------------
     FIREBASE AUTH OBSERVER — orchestrates all app initialization
  ------------------------------------------------------------------ */
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      // Set currentUser via bridge
      K.currentUser = user;

      // Show app UI
      K.showApp();
      K.updateUserUI(user);

      // Load background from cloud
      const bgFromCloud = await K.loadBgFromFirestore();
      if (bgFromCloud) {
        const state = K.getState();
        if (state) state.bgImage = bgFromCloud;
        try { localStorage.setItem(K.bgKey(), bgFromCloud); } catch(e) {}
        K.applyBackground();
      }

      // Ensure user document exists in Firestore
      try {
        const userRef = db.collection('users').doc(user.uid);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
          await userRef.set({
            email: user.email || '',
            displayName: user.displayName || '',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        } else {
          // Update last seen
          await userRef.update({ lastSeen: firebase.firestore.FieldValue.serverTimestamp() });
        }
      } catch(e) {}

      // Load user's classes
      await K.loadUserClasses();

      // Check superadmin status and show button if applicable
      await checkAndSetSuperAdmin();

      // Write login log
      writeLog('login');

    } else {
      // Logout: clear state
      try { localStorage.removeItem(K.bgKey()); } catch(e) {}
      K.currentUser = null;
      K.currentClassId = null;
      const state = K.getState();
      if (state) { state.bgImage = null; }
      K.applyBackground();
      K.updateClassChip(null);
      updateSuperAdminUI(false);
      K.showLoginScreen();
    }
  });

  /* ------------------------------------------------------------------
     INJECT SA HTML at module load time
  ------------------------------------------------------------------ */
  // Inject immediately if DOM is ready, otherwise wait for DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectSuperAdminHTML);
  } else {
    injectSuperAdminHTML();
  }

})();
