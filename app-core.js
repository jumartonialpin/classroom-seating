/* ============================================================
   app-core.js — Core application logic
   Loaded after: firebase-sdk, data.js
   Loaded before: app-sa.js
============================================================ */
(() => {
  'use strict';


    /* ============================================================
       CRYPTO-SECURE RANDOM UTILITIES
       Pakai Web Crypto API (CSPRNG) — jauh lebih acak dari Math.random()
    ============================================================ */

    // Ambil float [0, 1) dengan 32-bit entropy (setara Math.random tapi crypto-secure)
    function cryptoRandom() {
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      return arr[0] / (0xFFFFFFFF + 1);
    }

    // Ambil integer acak [0, max)
    function cryptoRandInt(max) {
      // Pakai rejection sampling supaya distribusinya perfectly uniform
      // (hindari modulo bias)
      const arr = new Uint32Array(1);
      const limit = Math.floor(0x100000000 / max) * max;
      let val;
      do {
        crypto.getRandomValues(arr);
        val = arr[0];
      } while (val >= limit);
      return val % max;
    }

    // Fisher-Yates shuffle dengan CSPRNG
    function cryptoShuffle(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = cryptoRandInt(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }



    /* ============================================================
       i18n STRINGS

    /* ============================================================
       STATE
    ============================================================ */
    let state = {
      students: [],       // { id, name, gender, status:'present'|'absent' }
      seats: [],          // array of seat objects indexed 0..rows*cols-1
      rows: 4,
      cols: 5,
      theme: 'light',
      lang: 'en',
      pov: 'teacher',
      pickerHistory: [],  // { name, gender, time }
      pickerAllowRepeat: false,
      bgImage: null,      // base64 string or null
    };

    // seat object shape: { studentId: null|id, locked: false, disabled: false }

    /* ============================================================
       LOCALSTORAGE
    ============================================================ */
    const LS_KEY = 'kelasku_v1';
    // Key localStorage background selalu per-user supaya ga bocor antar akun
    function bgKey() {
      return LS_KEY + '_bg_' + (currentUser ? currentUser.uid : 'anon');
    }



    /* ============================================================
       AUTH STATE VARIABLES
    ============================================================ */
    let currentUser = null;
    let currentClassId = null;
    let isSyncing = false;

    /* ============================================================
       AVATAR SVGs
    ============================================================ */
    function maleAvatar(size = 44) {
      return `<svg width="${size}" height="${size}" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
        <rect width="44" height="44" rx="22" fill="#DBEAFE"/>
        <circle cx="22" cy="17" r="8" fill="#93C5FD"/>
        <path d="M6 40c0-8.837 7.163-12 16-12s16 3.163 16 12" fill="#3B82F6"/>
      </svg>`;
    }

    function femaleAvatar(size = 44) {
      return `<svg width="${size}" height="${size}" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
        <rect width="44" height="44" rx="22" fill="#FCE7F3"/>
        <circle cx="22" cy="17" r="8" fill="#F9A8D4"/>
        <path d="M6 40c0-8.837 7.163-12 16-12s16 3.163 16 12" fill="#EC4899"/>
        <path d="M14 14 Q22 8 30 14" stroke="#F472B6" stroke-width="2" fill="none" stroke-linecap="round"/>
      </svg>`;
    }

    function getAvatar(gender, size) {
      return gender === 'female' ? femaleAvatar(size) : maleAvatar(size);
    }

    /* ============================================================
       i18n
    ============================================================ */
    function t(key) {
      return (I18N[state.lang] || I18N.en)[key] || key;
    }

    function applyI18n() {
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        const translated = t(key);
        // Kalau element punya child elements (misal SVG icon), update hanya text node terakhir
        // supaya icon tidak terhapus
        const childEls = [...el.childNodes].filter(n => n.nodeType === 1); // element nodes
        if (childEls.length > 0) {
          // Cari atau buat text node
          let textNode = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
          if (textNode) {
            textNode.textContent = translated;
          } else {
            // Cari span dengan data-i18n yang sama atau .btn-label
            const span = el.querySelector('[data-i18n="' + key + '"], .btn-label');
            if (span) span.textContent = translated;
          }
        } else {
          el.textContent = translated;
        }
      });
      document.documentElement.lang = state.lang;
      // Re-render stats panel kalau sedang terbuka
      const statsPanel = document.getElementById('stats-panel');
      if (statsPanel && statsPanel.classList.contains('show')) {
        showStats(); showStats(); // toggle off lalu on lagi
      }
    }

    /* ============================================================
       TOAST SYSTEM
    ============================================================ */
    function showToast(message, type = 'info') {
      const container = document.getElementById('toast-container');
      const icons = {
        success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
        error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
        warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      };
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${message}</span>`;
      container.appendChild(toast);
      setTimeout(() => {
        toast.classList.add('toast-out');
        toast.addEventListener('transitionend', () => toast.remove());
      }, 3000);
    }

    /* ============================================================
       MODAL SYSTEM
    ============================================================ */
    function openModal(id) {
      const overlay = document.getElementById(id);
      if (overlay) overlay.classList.add('open');
    }

    function closeModal(id) {
      const overlay = document.getElementById(id);
      if (overlay) overlay.classList.remove('open');
      // FIX #3: Reset temp state saat modal absensi ditutup
      if (id === 'modal-attendance') {
        attTemp = {};
        nilaiTemp = {};
      }
    }

    function initModals() {
      // Close buttons
      document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.dataset.modal));
      });
      // Click overlay to close
      document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
          if (e.target === overlay) closeModal(overlay.id);
        });
      });
      // ESC key
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          document.querySelectorAll('.modal-overlay.open').forEach(o => closeModal(o.id));
          closeAllContextMenus();
        }
      });
    }

    /* ============================================================
       SEAT UTILITIES
    ============================================================ */
    function makeSeat(overrides = {}) {
      return { studentId: null, locked: false, disabled: false, ...overrides };
    }

    function initSeats(rows, cols) {
      const total = rows * cols;
      const existing = state.seats;
      const newSeats = [];
      for (let i = 0; i < total; i++) {
        newSeats.push(existing[i] ? { ...existing[i] } : makeSeat());
      }
      return newSeats;
    }

    function getStudentById(id) {
      return state.students.find(s => s.id === id) || null;
    }

    function getPresentStudents() {
      return state.students.filter(s => s.status === 'present');
    }

    /* ============================================================
       SEATING GRID RENDER
    ============================================================ */
    function renderGrid() {
      const grid = document.getElementById('seating-grid');
      const { rows, cols, seats } = state;

      grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
      grid.innerHTML = '';

      // Set lebar meja guru = 2 kolom dari total kolom (+ gap antar kolom)
      const barPct = (2 / cols * 100).toFixed(2);
      const gap = 12; // px, sama dengan gap grid
      // Hitung: (2/cols * 100%) + sedikit koreksi gap
      // Pakai calc supaya presisi
      const teacherBarWidth = `calc(${barPct}% + ${(2 - 1) * gap}px)`;
      document.getElementById('seating-grid-section').style.setProperty('--teacher-bar-width', teacherBarWidth);

      const total = rows * cols;

      // Teacher POV: guru lihat murid dari depan.
      // Baris 1 (seat 0..cols-1) harus tampil PALING BAWAH layar.
      // Caranya: render dari index tertinggi ke terendah (baris terakhir dulu).
      // Student POV: murid lihat ke depan, baris 1 di atas → render normal.
      const isTeacher = state.pov !== 'student';
      const indices = [];
      for (let i = 0; i < total; i++) indices.push(i);
      if (isTeacher) indices.reverse();

      indices.forEach(i => {
        const seat = seats[i] || makeSeat();
        const student = seat.studentId ? getStudentById(seat.studentId) : null;
        const card = buildSeatCard(i, seat, student);
        grid.appendChild(card);
      });

      updateSeatCountBadge();
    }

    function buildSeatCard(index, seat, student) {
      const card = document.createElement('div');
      card.className = 'seat-card';
      card.dataset.seatIndex = index;
      // data-student-id dipakai oleh FLIP shuffle animation untuk tracking posisi
      if (student) card.dataset.studentId = student.id;

      if (seat.disabled) card.classList.add('seat-disabled');
      if (seat.locked) card.classList.add('seat-locked');

      // Seat number
      const numEl = document.createElement('span');
      numEl.className = 'seat-number';
      numEl.textContent = index + 1;
      card.appendChild(numEl);

      // Badges
      const badges = document.createElement('div');
      badges.className = 'seat-badges';
      if (seat.locked) {
        badges.innerHTML = `<span class="seat-badge badge-lock">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
        </span>`;
      }
      if (seat.disabled) {
        badges.innerHTML += `<span class="seat-badge badge-disable">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-4H7l5-8v4h4l-5 8z"/></svg>
        </span>`;
      }
      card.appendChild(badges);

      // Avatar
      const avatarDiv = document.createElement('div');
      avatarDiv.className = 'seat-avatar';
      if (student) {
        avatarDiv.innerHTML = getAvatar(student.gender, 44);
      } else {
        avatarDiv.innerHTML = `<svg width="44" height="44" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
          <rect width="44" height="44" rx="22" fill="var(--bg-secondary)"/>
          <text x="22" y="28" text-anchor="middle" font-size="20" fill="var(--text-muted)">?</text>
        </svg>`;
      }
      card.appendChild(avatarDiv);

      // Name
      const nameEl = document.createElement('p');
      nameEl.className = seat.disabled ? 'seat-empty-label' : 'seat-name';
      if (seat.disabled) {
        nameEl.textContent = '— —';
      } else if (student) {
        nameEl.textContent = student.name;
      } else {
        nameEl.className = 'seat-empty-label';
        nameEl.textContent = t('opt_absent');
      }
      card.appendChild(nameEl);

      // Click handler — formasi mode: langsung toggle, normal: context menu
      if (seat.disabled) {
        // Bangku disabled hanya bisa diklik saat formasi mode (CSS handle visibility)
        card.addEventListener('click', e => {
          e.stopPropagation();
          if (formasiMode) { toggleDisable(index); }
        });
      } else {
        const menu = buildContextMenu(index, seat, student);
        card.appendChild(menu);

        card.addEventListener('click', e => {
          e.stopPropagation();
          if (formasiMode) {
            toggleDisable(index);
          } else {
            closeAllContextMenus();
            // Naikkan z-index card aktif supaya menu tidak tertimpa card sebelahnya
            card.style.zIndex = '200';
            // Deteksi apakah card ini di sisi kiri layar
            const r = card.getBoundingClientRect();
            const vw = window.innerWidth;
            if (r.left < vw * 0.3) {
              menu.classList.add('menu-left');
            }
            menu.classList.add('open');
          }
        });
      }

      return card;
    }

    function buildContextMenu(seatIndex, seat, student) {
      const menu = document.createElement('div');
      menu.className = 'seat-context-menu';

      const lockBtn = menuBtn(
        seat.locked ? lockOpenIcon() : lockIcon(),
        seat.locked ? t('ctx_unlock') : t('ctx_lock'),
        () => { toggleLock(seatIndex); closeAllContextMenus(); }
      );

      const disableBtn = menuBtn(
        disableIcon(),
        t('ctx_disable'),
        () => { toggleDisable(seatIndex); closeAllContextMenus(); }
      );

      const genderBtn = student ? menuBtn(
        genderIcon(),
        t('ctx_gender'),
        () => { toggleGender(seatIndex); closeAllContextMenus(); }
      ) : null;

      menu.appendChild(lockBtn);
      if (genderBtn) menu.appendChild(genderBtn);
      menu.appendChild(disableBtn);

      return menu;
    }

    function menuBtn(iconSvg, label, onClick) {
      const btn = document.createElement('button');
      btn.className = 'seat-context-btn';
      btn.innerHTML = `${iconSvg}<span>${label}</span>`;
      btn.addEventListener('click', e => { e.stopPropagation(); onClick(); });
      return btn;
    }

    function closeAllContextMenus() {
      document.querySelectorAll('.seat-context-menu').forEach(m => {
        m.classList.remove('open', 'menu-left');
        // Reset z-index card induknya
        if (m.parentElement) m.parentElement.style.zIndex = '';
      });
    }

    // Close context menus on outside click
    document.addEventListener('click', closeAllContextMenus);

    /* Seat action icons */
    function lockIcon() { return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`; }
    function lockOpenIcon() { return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1C9.24 1 7 3.24 7 6h2c0-1.66 1.34-3 3-3s3 1.34 3 3v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2h-1V6c0-2.76-2.24-5-5-5zm0 13c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>`; }
    function disableIcon() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`; }
    function genderIcon() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M12 12v8M9 18h6"/></svg>`; }

    /* ============================================================
       SEAT ACTIONS
    ============================================================ */
    function toggleLock(i) {
      state.seats[i].locked = !state.seats[i].locked;
      saveState(); renderGrid();
    }

    function toggleDisable(i) {
      state.seats[i].disabled = !state.seats[i].disabled;
      if (state.seats[i].disabled) {
        state.seats[i].studentId = null;
        state.seats[i].locked = false;
      }
      saveState(); renderGrid();
    }

    function toggleGender(i) {
      const sid = state.seats[i].studentId;
      if (!sid) return;
      const student = getStudentById(sid);
      if (!student) return;
      student.gender = student.gender === 'male' ? 'female' : 'male';
      saveState(); renderGrid(); renderStudentList();
    }

    function showStats() {
      const panel = document.getElementById('stats-panel');
      if (panel.classList.contains('show')) {
        panel.classList.remove('show');
        return;
      }
      const present = state.students.filter(s => s.status === 'present').length;
      const absent = state.students.length - present;
      const activeSeats = state.seats.filter(s => !s.disabled).length;
      const occupancy = state.students.length > 0 ? ((present / state.students.length) * 100).toFixed(1) : 0;

      panel.innerHTML = `
        <div class="stat-card"><div class="stat-value">${state.students.length}</div><div class="stat-label">${t('stat_total')}</div></div>
        <div class="stat-card"><div class="stat-value" style="color:var(--accent-success)">${present}</div><div class="stat-label">${t('stat_present')}</div></div>
        <div class="stat-card"><div class="stat-value" style="color:var(--accent-danger)">${absent}</div><div class="stat-label">${t('stat_absent')}</div></div>
        <div class="stat-card"><div class="stat-value">${activeSeats}</div><div class="stat-label">${t('stat_seats')}</div></div>
        <div class="stat-card"><div class="stat-value">${occupancy}%</div><div class="stat-label">${t('stat_occupancy')}</div></div>
      `;
      panel.classList.add('show');
    }

    function updateSeatCountBadge() {
      const occupied = state.seats.filter(s => s.studentId && !s.disabled).length;
      const present = getPresentStudents().length;
      document.getElementById('seat-count-badge').textContent = `${occupied} / ${present}`;
      updateFormasiBadge();
    }

    function updateFormasiBadge() {
      const { rows, cols, seats } = state;
      const counts = [];
      for (let r = 0; r < rows; r++) {
        let count = 0;
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          if (seats[idx] && !seats[idx].disabled) count++;
        }
        counts.push(count);
      }
      // Tampilkan dari sudut pandang teacher POV (baris terakhir di atas)
      const display = state.pov === 'student' ? counts : [...counts].reverse();
      document.getElementById('formasi-badge').textContent = display.join('-');
    }

    let formasiMode = false;

    function toggleFormasiMode() {
      formasiMode = !formasiMode;
      document.body.classList.toggle('formasi-mode', formasiMode);
      const btn = document.getElementById('btn-edit-formasi');
      const lbl = document.getElementById('btn-formasi-label');
      if (formasiMode) {
        btn.classList.add('btn-formasi-active');
        lbl.textContent = t('btn_done_formasi');
      } else {
        btn.classList.remove('btn-formasi-active');
        lbl.textContent = t('btn_edit_formasi');
      }
      renderGrid();
    }

    /* ============================================================
       SHUFFLE
    ============================================================ */
    // ── State animasi shuffle (FLIP)
    let isShuffling = false;
    let shuffleAnimTimeout = null;

    function _doShuffle() {
      const present = getPresentStudents();
      if (present.length === 0) { showToast(t('toast_no_students'), 'warning'); return false; }

      const freeSeatIndices = state.seats
        .map((s, i) => (!s.locked && !s.disabled) ? i : -1)
        .filter(i => i >= 0);

      freeSeatIndices.forEach(i => { state.seats[i].studentId = null; });

      const lockedStudentIds = new Set(
        state.seats.filter(s => s.locked && s.studentId).map(s => s.studentId)
      );
      const availableStudents = [...present].filter(s => !lockedStudentIds.has(s.id));

      const shuffled = cryptoShuffle(availableStudents);
      shuffled.forEach((s, i) => availableStudents[i] = s);

      availableStudents.forEach((student, idx) => {
        if (freeSeatIndices[idx] !== undefined) {
          state.seats[freeSeatIndices[idx]].studentId = student.id;
        }
      });

      return true;
    }

    function _setShuffleBtn(isAnim) {
      ['btn-shuffle', 'btn-shuffle-mobile'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        const span = btn.querySelector('span');
        if (!span) return;
        if (isAnim) {
          span.textContent = t('btn_skip_anim');
          btn.classList.add('btn-secondary');
          btn.classList.remove('btn-primary');
        } else {
          span.setAttribute('data-i18n', 'btn_shuffle');
          span.textContent = t('btn_shuffle');
          btn.classList.remove('btn-secondary');
          if (id === 'btn-shuffle') btn.classList.add('btn-primary');
        }
      });
    }

    function _endShuffleAnim() {
      isShuffling = false;
      clearTimeout(shuffleAnimTimeout);
      shuffleAnimTimeout = null;
      // Hapus semua transform dan class transit — posisi final sudah di DOM
      document.querySelectorAll('.seat-card.seat-flip-transit').forEach(el => {
        el.classList.remove('seat-flip-transit');
        el.style.transform = '';
        el.style.transition = '';
        el.style.zIndex = '';
        el.style.boxShadow = '';
      });
      _setShuffleBtn(false);
    }

    function shuffleSeats() {
      // Skip jika sedang animasi
      if (isShuffling) {
        _endShuffleAnim();
        renderGrid(); // render ulang tanpa animasi supaya bersih
        return;
      }

      const present = getPresentStudents();
      if (present.length === 0) { showToast(t('toast_no_students'), 'warning'); return; }

      // ── FLIP: F (First) — rekam posisi SEBELUM shuffle
      const grid = document.getElementById('seating-grid');
      const cardsBefore = grid.querySelectorAll('.seat-card:not(.seat-disabled)');
      const firstPositions = new Map(); // studentId → {x, y}
      cardsBefore.forEach(card => {
        const sid = card.dataset.studentId;
        if (sid) {
          const r = card.getBoundingClientRect();
          firstPositions.set(sid, { x: r.left, y: r.top });
        }
      });

      // ── Jalankan logika shuffle (state berubah)
      _doShuffle();
      saveState();
      try { if (navigator.vibrate) navigator.vibrate(20); } catch(e) {}

      const lockedCount = state.seats.filter(s => s.locked && s.studentId).length;
      const msg = lockedCount > 0
        ? `${t('toast_shuffled')} ${lockedCount} ${t('toast_locked_seats')}`
        : t('toast_shuffled');

      // ── FLIP: L (Last) — render ke DOM dulu supaya posisi baru ada
      renderGrid();

      const cardsAfter = grid.querySelectorAll('.seat-card:not(.seat-disabled)');
      if (cardsAfter.length === 0 || firstPositions.size === 0) {
        showToast(msg, 'success');
        return;
      }

      // ── FLIP: I (Invert) — geser tiap card ke posisi lamanya via transform
      const movedCards = [];
      cardsAfter.forEach(card => {
        const sid = card.dataset.studentId;
        if (!sid || !firstPositions.has(sid)) return;
        const last = card.getBoundingClientRect();
        const first = firstPositions.get(sid);
        const dx = first.x - last.x;
        const dy = first.y - last.y;
        // Kalau tidak bergerak, skip animasi
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
        // Set posisi lama (tanpa transition dulu)
        card.style.transition = 'none';
        card.style.transform = `translate(${dx}px, ${dy}px)`;
        movedCards.push(card);
      });

      if (movedCards.length === 0) {
        showToast(msg, 'success');
        return;
      }

      isShuffling = true;
      _setShuffleBtn(true);

      // ── FLIP: P (Play) — satu frame berikutnya, aktifkan transition ke posisi baru
      // requestAnimationFrame ganda supaya browser sempat paint posisi awal
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          movedCards.forEach((card, i) => {
            // Stagger kecil berdasarkan jarak gerak supaya terasa natural
            const delay = Math.min(i * 18, 200);
            card.style.transition = `transform 0.65s cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms,
                                     box-shadow 0.65s ease ${delay}ms`;
            card.style.transform = ''; // balik ke posisi baru (natural)
            card.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)';
            card.classList.add('seat-flip-transit');
          });

          const TOTAL_MS = 650 + 200 + 80; // duration + max stagger + buffer
          shuffleAnimTimeout = setTimeout(() => {
            _endShuffleAnim();
            showToast(msg, 'success');
          }, TOTAL_MS);
        });
      });
    }

    /* ============================================================
       STUDENT MANAGEMENT
    ============================================================ */
    function generateId() {
      // ID unik pakai crypto random bytes
      const bytes = new Uint8Array(4);
      crypto.getRandomValues(bytes);
      const hex = Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join('');
      return 'stu_' + Date.now() + '_' + hex;
    }

    function addStudent(name, gender) {
      const student = { id: generateId(), name: name.trim(), gender, status: 'present' };
      state.students.push(student);
      saveState();
      return student;
    }

    function deleteStudent(id) {
      state.students = state.students.filter(s => s.id !== id);
      // Remove from seats
      state.seats.forEach(seat => { if (seat.studentId === id) seat.studentId = null; });
      saveState();
    }

    function updateStudent(id, fields) {
      const s = getStudentById(id);
      if (!s) return;
      Object.assign(s, fields);
      // If marked absent, remove from seat
      if (fields.status === 'absent') {
        state.seats.forEach(seat => { if (seat.studentId === id) seat.studentId = null; });
      }
      saveState();
    }

    function renderStudentList() {
      const ul = document.getElementById('student-list-ul');
      ul.innerHTML = '';

      if (state.students.length === 0) {
        ul.innerHTML = `<li style="text-align:center;padding:20px;color:var(--text-muted);font-style:italic;">${t('history_empty')}</li>`;
        updateStudentTotalBadge();
        return;
      }

      state.students.forEach(student => {
        const li = document.createElement('li');
        li.className = 'student-item' + (student.status === 'absent' ? ' absent' : '');

        const isPresent = student.status === 'present';

        li.innerHTML = `
          <div class="student-item-avatar">${getAvatar(student.gender, 32)}</div>
          <div class="student-item-info">
            <p class="student-item-name">${student.name}</p>
            <p class="student-item-status ${isPresent ? 'present' : 'absent-text'}">
              ${isPresent ? t('status_present') : t('status_absent')}
            </p>
          </div>
          <div class="student-item-actions">
            <button class="student-action-btn ${isPresent ? 'danger' : 'success'}" data-action="toggle-status" data-id="${student.id}" title="${isPresent ? t('btn_mark_absent_one') : t('btn_mark_present_one')}">
              ${isPresent
                ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`
              }
            </button>
            <button class="student-action-btn" data-action="edit" data-id="${student.id}" title="Edit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="student-action-btn danger" data-action="delete" data-id="${student.id}" title="Delete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14H6L5 6"/>
                <path d="M10 11v6M14 11v6"/>
              </svg>
            </button>
          </div>
        `;
        ul.appendChild(li);
      });

      // Delegate events
      ul.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const { action, id } = btn.dataset;
          if (action === 'delete') {
            deleteStudent(id);
            renderStudentList(); renderGrid(); renderPickerPool();
            showToast(t('toast_student_deleted'), 'info');
          } else if (action === 'edit') {
            openEditModal(id);
          } else if (action === 'toggle-status') {
            const s = getStudentById(id);
            if (!s) return;
            updateStudent(id, { status: s.status === 'present' ? 'absent' : 'present' });
            renderStudentList(); renderGrid(); renderPickerPool();
            // Sync attTemp jika modal absensi sedang terbuka dan tanggal = hari ini
            // (hanya untuk data yang BELUM tersimpan di Firestore — jadi tidak override data lama)
            const _attModal = document.getElementById('modal-attendance');
            if (_attModal && _attModal.classList.contains('open')) {
              const _attDate = document.getElementById('input-att-date').value;
              if (_attDate === todayStr()) {
                const _updated = getStudentById(id);
                if (_updated) {
                  attTemp[id] = _updated.status === 'present' ? 'H' : 'A';
                  renderAttStudentList();
                }
              }
            }
          }
        });
      });

      updateStudentTotalBadge();
    }

    function updateStudentTotalBadge() {
      const badge = document.getElementById('student-total-badge');
      badge.textContent = `${state.students.length} ${t('word_students')}`;
    }

    function openEditModal(id) {
      const student = getStudentById(id);
      if (!student) return;
      document.getElementById('edit-student-id').value = id;
      document.getElementById('edit-student-name').value = student.name;
      document.getElementById('edit-student-gender').value = student.gender;
      document.getElementById('edit-student-status').value = student.status;
      openModal('modal-edit-student');
    }

    /* ============================================================
       PICKER
    ============================================================ */
    let pickerAnimFrame = null;
    let isPicking = false;

    function renderPickerPool() {
      const present = getPresentStudents();
      const picked = new Set(state.pickerHistory.map(h => h.name));
      const eligible = state.pickerAllowRepeat
        ? present
        : present.filter(s => !picked.has(s.name));
      document.getElementById('picker-pool-count').textContent =
        `${eligible.length} ${t('picker_eligible')}`;
      return eligible;
    }

    function renderPickerHistory() {
      const list = document.getElementById('picker-history-list');
      const badge = document.getElementById('history-count-badge');
      badge.textContent = `${state.pickerHistory.length} ${t('picker_picks')}`;

      if (state.pickerHistory.length === 0) {
        list.innerHTML = `<li class="history-empty">${t('history_empty')}</li>`;
        return;
      }

      list.innerHTML = '';
      [...state.pickerHistory].reverse().forEach((entry, i) => {
        const li = document.createElement('li');
        li.className = 'history-item';
        const num = state.pickerHistory.length - i;
        li.innerHTML = `
          <span class="history-item-num">#${num}</span>
          <span style="flex-shrink:0">${getAvatar(entry.gender || 'male', 24)}</span>
          <span class="history-item-name">${entry.name}</span>
          <span class="history-item-time">${entry.time}</span>
        `;
        list.appendChild(li);
      });
    }

    function showFocusMode(studentId, seatIndex) {
      const student = getStudentById(studentId);
      if (!student) return;

      const { rows, cols } = state;
      const row = Math.floor(seatIndex / cols) + 1;
      const col = (seatIndex % cols) + 1;

      document.getElementById('focus-avatar').innerHTML = getAvatar(student.gender, 100);
      document.getElementById('focus-name').textContent = student.name;
      const _iid = state.lang === 'id', _ija = state.lang === 'ja';
      document.getElementById('focus-seat-num').textContent =
        (_iid ? 'Bangku ' : _ija ? '席 ' : 'Seat ') + (seatIndex + 1);
      document.getElementById('focus-row-num').textContent =
        (_iid ? 'Baris ' : _ija ? '列 ' : 'Row ') + row + (_iid ? ', Kolom ' : _ija ? '、列 ' : ', Col ') + col;

      // Highlight bangku di grid
      document.querySelectorAll('.seat-card').forEach(c => c.classList.remove('seat-focused'));
      document.querySelectorAll('.seat-card').forEach(c => {
        if (parseInt(c.dataset.seatIndex) === seatIndex) c.classList.add('seat-focused');
      });

      document.getElementById('focus-overlay').classList.add('open');
      pushBackState('focus-overlay');
    }

    function closeFocusMode() {
      document.getElementById('focus-overlay').classList.remove('open');
      document.querySelectorAll('.seat-card.seat-focused').forEach(c => c.classList.remove('seat-focused'));
    }

    function undoPick() {
      if (state.pickerHistory.length === 0) {
        showToast(t('toast_undo_empty'), 'info');
        return;
      }
      const last = state.pickerHistory.pop();
      // Reset display
      document.getElementById('picker-name-display').classList.add('hidden');
      document.getElementById('picker-placeholder').classList.remove('hidden');
      document.getElementById('picker-avatar').style.display = 'none';
      document.getElementById('picker-display').classList.remove('picking', 'picked');
      document.querySelectorAll('.seat-card.seat-highlighted').forEach(c => c.classList.remove('seat-highlighted'));
      saveState(); renderPickerHistory(); renderPickerPool();
      showToast(t('word_undo') + ': ' + last.name, 'info');
    }

    function pickName() {
      if (isPicking) return;

      const eligible = renderPickerPool();
      if (eligible.length === 0) {
        const present = getPresentStudents();
        if (present.length === 0) showToast(t('toast_no_eligible'), 'warning');
        else showToast(t('toast_all_picked'), 'info');
        return;
      }

      isPicking = true;
      const display = document.getElementById('picker-display');
      const nameEl = document.getElementById('picker-name-display');
      const placeholder = document.getElementById('picker-placeholder');
      const avatarDiv = document.getElementById('picker-avatar');
      const pickBtn = document.getElementById('btn-pick');

      placeholder.classList.add('hidden');
      nameEl.classList.remove('hidden');
      nameEl.classList.add('shuffle-anim');
      display.classList.remove('picked');
      display.classList.add('picking');
      pickBtn.disabled = true;

      const chosen = eligible[cryptoRandInt(eligible.length)];
      let elapsed = 0;
      const duration = 1800;
      const fastInterval = 60;
      const slowInterval = 180;

      function tick() {
        const randomStudent = eligible[cryptoRandInt(eligible.length)];
        nameEl.textContent = randomStudent.name;
        avatarDiv.style.display = 'block';
        avatarDiv.innerHTML = getAvatar(randomStudent.gender, 56);
        elapsed += elapsed < duration * 0.6 ? fastInterval : slowInterval;

        if (elapsed < duration) {
          pickerAnimFrame = setTimeout(tick, elapsed < duration * 0.6 ? fastInterval : slowInterval);
        } else {
          // Final reveal
          nameEl.textContent = chosen.name;
          nameEl.classList.remove('shuffle-anim');
          avatarDiv.innerHTML = getAvatar(chosen.gender, 64);
          display.classList.remove('picking');
          display.classList.add('picked');
          isPicking = false;
          pickBtn.disabled = false;
          // Haptic feedback
          try { if (navigator.vibrate) navigator.vibrate([30, 20, 50]); } catch(e) {}

          // Highlight seat
          highlightStudentSeat(chosen.id);

          // Tampilkan mode fokus — cari seatIndex
          const chosenSeatIdx = state.seats.findIndex(s => s.studentId === chosen.id);
          if (chosenSeatIdx >= 0) {
            setTimeout(() => showFocusMode(chosen.id, chosenSeatIdx), 400);
          }

          // Add to history
          const now = new Date();
          const timeStr = now.toLocaleTimeString(state.lang === 'id' ? 'id-ID' : state.lang === 'ja' ? 'ja-JP' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          state.pickerHistory.push({ name: chosen.name, gender: chosen.gender, time: timeStr });
          saveState();
          renderPickerHistory();
          renderPickerPool();
        }
      }

      tick();
    }

    function highlightStudentSeat(studentId) {
      document.querySelectorAll('.seat-card.seat-highlighted').forEach(c => c.classList.remove('seat-highlighted'));
      const cards = document.querySelectorAll('.seat-card');
      cards.forEach(card => {
        const idx = parseInt(card.dataset.seatIndex);
        if (state.seats[idx] && state.seats[idx].studentId === studentId) {
          card.classList.add('seat-highlighted');
        }
      });
    }

    /* ============================================================
       GRID SIZE
    ============================================================ */
    function applyGridSize() {
      const rows = Math.max(1, Math.min(10, parseInt(document.getElementById('input-rows').value) || 4));
      const cols = Math.max(1, Math.min(12, parseInt(document.getElementById('input-cols').value) || 5));
      document.getElementById('input-rows').value = rows;
      document.getElementById('input-cols').value = cols;
      state.rows = rows;
      state.cols = cols;
      state.seats = initSeats(rows, cols);
      saveState(); renderGrid();
    }

    /* ============================================================
       BACKGROUND IMAGE
    ============================================================ */
    // Simpan bg ke Firestore dipecah per 800KB chunk
    async function saveBgToFirestore(base64) {
      if (!currentUser) return;
      const CHUNK = 800000;
      const chunks = [];
      for (let i = 0; i < base64.length; i += CHUNK) {
        chunks.push(base64.slice(i, i + CHUNK));
      }
      const ref = db.collection('users').doc(currentUser.uid).collection('bg').doc('image');

      // PATCH #3: Simpan metadata + chunks dalam satu batch atomic
      // supaya tidak ada kondisi "metadata ada tapi chunks kosong"
      const batch = db.batch();
      batch.set(ref, { total: chunks.length, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      chunks.forEach((chunk, i) => {
        batch.set(ref.collection('chunks').doc(String(i)), { data: chunk });
      });
      await batch.commit(); // satu operasi — all-or-nothing
    }

    async function loadBgFromFirestore() {
      if (!currentUser) return null;
      try {
        const ref = db.collection('users').doc(currentUser.uid).collection('bg').doc('image');
        const meta = await ref.get();
        if (!meta.exists) return null;
        const total = meta.data().total;
        if (!total || total < 1) return null;
        const chunkDocs = await Promise.all(
          Array.from({ length: total }, (_, i) => ref.collection('chunks').doc(String(i)).get())
        );
        // PATCH #4: Validasi tiap chunk sebelum join — cegah string 'undefined' corrupt
        const parts = chunkDocs.map(d => {
          if (!d.exists || !d.data().data) throw new Error('Chunk bg rusak atau hilang');
          return d.data().data;
        });
        return parts.join('');
      } catch(e) {
        console.warn('loadBgFromFirestore failed:', e);
        return null;
      }
    }

    async function deleteBgFromFirestore() {
      if (!currentUser) return;
      try {
        const ref = db.collection('users').doc(currentUser.uid).collection('bg').doc('image');
        const meta = await ref.get();
        if (!meta.exists) return;
        const total = meta.data().total;
        const batch = db.batch();
        Array.from({ length: total }, (_, i) => {
          batch.delete(ref.collection('chunks').doc(String(i)));
        });
        batch.delete(ref);
        await batch.commit();
      } catch(e) {}
    }

    async function compressAndSetBg(file) {
      showToast('Memproses gambar...', 'info');

      // Deteksi dan konversi HEIC/HEIF (format foto iPhone)
      let processedFile = file;
      const isHeic = file.type === 'image/heic' || file.type === 'image/heif'
        || /\.(heic|heif)$/i.test(file.name);

      if (isHeic) {
        showToast('Mengkonversi HEIC → JPEG...', 'info');
        try {
          const converted = await heic2any({
            blob: file,
            toType: 'image/jpeg',
            quality: 0.8,
          });
          processedFile = Array.isArray(converted) ? converted[0] : converted;
        } catch(e) {
          throw new Error('Gagal konversi HEIC: ' + (e.message || e));
        }
      }

      // Pakai createObjectURL — jauh lebih ringan di memory mobile
      const objectUrl = URL.createObjectURL(processedFile);

      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        const timeout = setTimeout(() => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Timeout load gambar'));
        }, 20000);
        i.onload = () => {
          clearTimeout(timeout);
          resolve(i);
        };
        i.onerror = () => {
          clearTimeout(timeout);
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Format gambar tidak didukung'));
        };
        i.src = objectUrl;
      });

      // Kompres — ukuran lebih kecil untuk HP
      const MAX = 720;
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (!w || !h) { URL.revokeObjectURL(objectUrl); throw new Error('Ukuran gambar tidak valid'); }
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(objectUrl); throw new Error('Canvas tidak tersedia'); }
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(objectUrl); // free memory segera

      let base64 = canvas.toDataURL('image/jpeg', 0.6);
      if (!base64 || base64 === 'data:,' || base64.length < 200) {
        base64 = canvas.toDataURL('image/png');
      }
      if (!base64 || base64.length < 200) {
        throw new Error('Gagal export canvas');
      }

      // Terapkan background
      state.bgImage = base64;
      applyBackground();
      try { localStorage.setItem(bgKey(), base64); } catch(e) {}
      showToast(t('toast_bg_set'), 'success');

      // Upload ke Firestore
      if (currentUser) {
        showToast(t('toast_bg_uploading'), 'info');
        try {
          await deleteBgFromFirestore();
          await saveBgToFirestore(base64);
          showToast(t('toast_bg_set'), 'success');
        } catch(err) {
          console.warn('Firestore bg upload failed:', err);
          showToast(t('toast_bg_local'), 'warning');
        }
      }
    }

    // Wrapper dengan error handling untuk dipanggil dari event listener
    async function handleBgUpload(file) {
      try {
        await compressAndSetBg(file);
      } catch(err) {
        console.error('BG upload error:', err);
        showToast('Gagal: ' + (err.message || String(err)), 'error');
      }
    }

    function applyBackground() {
      if (state.bgImage) {
        document.body.classList.add('has-bg-image');
        document.body.style.setProperty('--custom-bg-image', `url("${state.bgImage}")`);
      } else {
        document.body.classList.remove('has-bg-image');
        document.body.style.removeProperty('--custom-bg-image');
      }
    }

    /* ============================================================
       EXPORT / IMPORT
    ============================================================ */
    function exportData() {
      const data = { ...state };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kelasku_backup_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(t('toast_exported'), 'success');
    }

    function importData(file) {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const parsed = JSON.parse(e.target.result);
          if (!parsed.students) throw new Error('Invalid');
          state = { ...state, ...parsed };
          applyTheme();
          applyLang();
          applyPOV();
          applyBackground();
          syncGridInputs();
          renderAll();
          saveState();
          showToast(t('toast_imported'), 'success');
        } catch {
          showToast(t('toast_import_error'), 'error');
        }
      };
      reader.readAsText(file);
    }

    /* ============================================================
       THEME / LANG / POV
    ============================================================ */
    function applyTheme() {
      document.documentElement.dataset.theme = state.theme;
      const moon = document.getElementById('icon-moon');
      const sun = document.getElementById('icon-sun');
      if (state.theme === 'dark') {
        moon.classList.add('hidden'); sun.classList.remove('hidden');
      } else {
        moon.classList.remove('hidden'); sun.classList.add('hidden');
      }
    }

    function applyLang() {
      document.documentElement.dataset.lang = state.lang;
      // Sync globe dropdown — highlight opsi aktif
      document.querySelectorAll('#lang-dropdown .lang-option').forEach(btn => {
        const isActive = btn.dataset.lang === state.lang;
        btn.classList.toggle('active', isActive);
        const check = btn.querySelector('.lang-check');
        if (check) check.style.visibility = isActive ? 'visible' : 'hidden';
      });
      // Set locale untuk format tanggal
      document.documentElement.lang = state.lang === 'ja' ? 'ja' : state.lang === 'id' ? 'id' : 'en';
      applyI18n();
      renderStudentList();
      renderPickerHistory();
      renderPickerPool();
      // Re-render stats panel kalau terbuka
      const _sp = document.getElementById('stats-panel');
      if (_sp && _sp.classList.contains('show')) { _sp.classList.remove('show'); showStats(); }
      // Hook for app-sa.js to update SA-specific i18n
      if (typeof window._K_applyLangHook === 'function') {
        try { window._K_applyLangHook(); } catch(e) {}
      }
    }

    function applyPOV() {
      document.documentElement.dataset.pov = state.pov;
      document.getElementById('pov-label').textContent =
        state.pov === 'teacher' ? t('pov_teacher_label') : t('pov_student_label');
      // Sync all POV toggles
      document.querySelectorAll('[data-pov]').forEach(btn => {
        if (btn.tagName === 'BUTTON') {
          btn.classList.toggle('active', btn.dataset.pov === state.pov);
        }
      });
      // Re-render grid karena urutan seat berubah
      renderGrid();
    }

    function syncGridInputs() {
      document.getElementById('input-rows').value = state.rows;
      document.getElementById('input-cols').value = state.cols;
    }

    /* ============================================================
       VIEW SWITCHING
    ============================================================ */
    function switchView(viewName) {
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      const target = document.getElementById('view-' + viewName);
      if (target) target.classList.add('active');

      // Sync desktop tabs
      document.querySelectorAll('#view-tabs button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewName);
      });

      // Sync mobile bottom nav
      document.querySelectorAll('#bottom-nav .bottom-nav-btn[data-view]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewName);
      });

      if (viewName === 'picker') {
        renderPickerPool();
        renderPickerHistory();
      }
    }

    /* ============================================================
       RENDER ALL
    ============================================================ */
    function renderAll() {
      renderGrid();
      renderStudentList();
      renderPickerPool();
      renderPickerHistory();
      applyI18n();
    }

    /* ============================================================
       RESET DEFAULTS
    ============================================================ */
    function resetToDefaults() {
      state.students = DEFAULT_STUDENTS.map(s => ({
        id: generateId(),
        name: s.name,
        gender: s.gender,
        status: 'present',
      }));
      state.seats = initSeats(state.rows, state.cols);
      // Auto-assign
      state.students.forEach((student, i) => {
        if (state.seats[i]) state.seats[i].studentId = student.id;
      });
      saveState(); renderAll();
      showToast(t('toast_reset'), 'success');
    }

    /* ============================================================
       STUDENT TABS (inside modal)
    ============================================================ */
    function initStudentTabs() {
      document.querySelectorAll('.student-manager-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          const target = tab.dataset.studentTab;
          document.querySelectorAll('.student-manager-tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.student-tab-content').forEach(c => c.classList.remove('active'));
          tab.classList.add('active');
          const content = document.getElementById('stab-' + target);
          if (content) content.classList.add('active');
          // Pre-fill bulk textarea with current student names
          if (target === 'bulk') {
            const ta = document.getElementById('textarea-bulk');
            ta.value = state.students.map(s => s.name).join('\n');
            // Move cursor to end
            ta.setSelectionRange(ta.value.length, ta.value.length);
            ta.focus();
          }
        });
      });
    }

    /* ============================================================
       INDONESIAN NAME → GENDER DICTIONARY (offline, comprehensive)
    ============================================================ */
    const FEMALE_NAMES = new Set([
      // A
      'aas','adel','adelia','adelya','adinda','adira','afifah','afiya','agustin',
      'aida','aini','aira','airin','aisha','aisyah','alifah','aliya','aliyah',
      'aliyawati','alma','almira','alpina','amanda','amalia','amaya','amelia',
      'amira','amiroh','amisa','anastasia','andini','anggraeni','anggraini',
      'anggun','anis','anisa','anisah','anita','anjani','annisa','annisah',
      'annisya','aprilia','apriliani','aqila','arini','arisa','ariska','arista',
      'arni','arum','arumi','arwinda','asih','asri','astri','astrid','astuti',
      'aulia','auliawati','aurelia','ayu','ayuk','ayuning','ayuni','azalea',
      'amel',

      // B
      'bella','bintang','bunga','bulan',
      'bila',

      // C
      'cahaya','cahyani','cantika','cempaka','ceria','cinta','citra','clarissa',
      'claudia','cornelia',
      // D
      'dania','daniswara','dara','deby','desi','desy','deti','devi','devia',
      'devita','dewi','dian','diana','dinda','dini','dinta','diski','dita',
      'dwi','dyah','diah',
      'dia','dina','dona',

      // E
      'ella','elsa','elva','elvi','elvira','ema','emilia','endah','erika',
      'erlin','erma','erna','esthi','esther','eva','evelin','evita',
      // F
      'fadila','fadilah','fadiya','faizah','farida','fariha','fatimah','fatma',
      'fera','fika','fitri','fitria','fitriana','fitriani','fitriyah','flora',
      'fransisca','friska',
      'feni','fia','fina','fira','fiya','fiza',

      // G
      'galuh','gita','grace',
      'gia','gina','githa',

      // H
      'haliza','hana','hani','hania','haniah','hanifah','hanna','hanum',
      'harafiah','hasna','hasnah','hasni','heni','herlina','hermi','hesti','hilda',
      'hera',

      // I
      'ida','indah','indriani','ines','ira','irawati','irma','isna','isnaini',
      'icha','ika','ike','ila','ima','ina','intan','iva','ivi',

      // J
      'jasmine','jeni','jenny','jessica','julia','juliana','julianti',
      'juli','juni','juwita',

      // K
      'kamila','kartika','kasih','keira','kharisma','khofifah','khoirun',
      'kanti','keke','kenia','kia','kiki','kirana',

      // L
      'laila','lailah','laili','lailia','laras','lara','lathifa','lathifah',
      'layla','lela','leli','lena','leni','lenny','lestari','lika','lilis',
      'lina','linda','lingga','lisa','listya','lita','livi','lola','loli',
      'lora','lufita','lulu','luna',
      'lala','lia',

      // M
      'maesaroh','maharani','mahira','maida','maira','maisa','maisyah','malika',
      'marlina','marsha','marta','mayang','maya','meilani','melani','melda',
      'meli','meliawati','melinda','mellisa','melsa','mentari','merry','mia',
      'milda','mira','mirasari','mirna','mita','mutiara',
      'maulida','mega','mei','melati','melly','mila','mina','monita',

      // N
      'nabila','nadia','nadila','nadiya','nafiisa','nafisa','nafisah','naili',
      'naira','najwa','natasya','neni','nia','niken','nila','nilam','nina',
      'ninda','nindy','nining','nira','nisa','nisfa','nisfah','nisrina','nita',
      'novi','noviana','novita','novia','novianti','novitasari',
      'nur','nuraeni','nuraisyah','nuraini','nurfadhilah','nurhaliza',
      'nurhayati','nuriyah','nurjanah','nurkhaliza','nurlita','nurmala',
      'nurmalasari','nurnabila','nurul','nurulizzah','nuryanti',
      'naila','nana','nanda','nani','nanik','naning','nany','nara','neli','nelly','nena','nessa','neva','nona','noni',

      // O
      'oktavia','oktaviana','olivia',
      'okta','ola','olga',

      // P
      'pertiwi','pipit','pita','prameswari','prasasti','pratiwi','prita','putri',
      'pia','poppy',

      // R
      'rachma','rahma','rahmah','rahmawati','raina','raisa','raiza','rara',
      'ratih','ratna','ratnasari','raudah','raudha','raula','reni','resa',
      'resti','reva','riana','rianti','rima','rina','rindiana','rini','ririn',
      'ristia','riyanti','rizka','robiah','rohana','rohmah','rosi','rosyida',
      'roza',
      'rachel','rahayu','ratu','rena','ria','rifa','rifka','rika','rila','risa','riska','risma','rita','riva','rosy',

      // S
      'sabrina','safira','safirah','salsabila','salsabil','sari','sarifah',
      'sarimah','saripah','sarita','sasmita','selvi','sely','senja','sera',
      'seri','sheila','shinta','sifa','sinta','siti','sonia','sonya','sri',
      'stella','suci','sufia','sulistia','sulistiani','sumiati','sumirah',
      'sumiyati','sunarti','sundari','supriyati','suryani',
      'sahara','salma','salwa','santi','sara','sarah','selvia','shela','shella','sila','silvi','silvia','silviana','sisca','siska',

      // T
      'tasya','tia','tiana','tiara','tika','tina','titik','tiwi',
      'tari','tata','tini','tita','tyas',

      // U
      'ulfah','ulfa','ulfianti','uliya','uma','ummi','uni','umi','utami',
      'ulin','ulya','unik',

      // V
      'valentina','vera','veronika','via','vika','vina','viona','vita','vivi',
      'vanda','vani','vania','vanisa','vira','voni',

      // W
      'wahyuni','wati','widya','wilda','windi','wulan','wulandari',
      'wanda','weni','wila','winda','windy','wita','wiwi',

      // Y
      'yani','yanis','yenny','yessi','yeti','yolanda','yuli','yulia','yuliana',
      'yunita','yunni','yuri','yuyun',
      'yanti','yesi','yola','yuliani','yunda','yuni',

      // Z
      'zahira','zahra','zakiya','zerlina','ziyan','zulaikha','zuliana',
      // Tambahan spesifik
      'despia','anggun','aliyawati','haliza','esther','rega','fariha',
      'melda','diansa','natasya','azizah','kamila','rindiana','lufita',
      'zakia','zelda','zena','zeni','zila','zita','zuhra',
    ]);

    const MALE_NAMES = new Set([
      // A
      'abdillah','abdullah','abi','abid','abrar','adam','aden','adi','adib',
      'adif','adil','adim','adip','adit','aditya','ageng','agung','agus',
      'ahdan','ahmad','ahsan','aji','ajiansyah','ajib','ajie','akhsin',
      'akhyar','akbar','akmal','aksan','aksara','alan','aldi','alfian','alfi',
      'alif','alpin','alvin','amin','aminullah','amir','amirullah','amirulloh',
      'anas','andi','andika','andiko','andri','andre','andrean','andrian',
      'andriansyah','andriawan','andru','anggoro','angga','angi','annas',
      'anwar','apri','aqil','aqshal','ardan','ardani','ardhan','ardi',
      'ardian','ardiansyah','ardo','arfan','arief','aries','arif','arifin',
      'aris','ariyanto','arman','armando','armin','arono','arsad','arsan',
      'arsel','arsil','arvin','aryadi','aryan','aryandi','aryo','asep',
      'ashari','asrul','awal','awang','ayub','azis','aziz','azmi','azri','azzam',
      // B
      'bagas','bagus','baihaqi','bambang','bayu','bima','bisma','budi',
      // C
      'calvin','jeremia',
      // D
      'dani','danang','dandung','daru','david','dede','dedek','dendra',
      'deny','deva','devano','dicky','dimas','dino','dio','dionisius',
      'dodi','doni','donni','dony','dudi','duta','dwiki',
      // E
      'edi','eko','elang','elvin','elvino','endra','erik','erwin','evan','ezra',
      // F
      'fachri','fahri','fahrul','faisal','fajar','fajri','fakhri','fakri',
      'fanani','fandi','farel','faris','fariz','farlo','farrel','faruk',
      'faturrahman','fazri','febri','febrian','febriansyah','febriyan',
      'ferdian','ferdi','ferry','fikri','fiqri','firmansyah','firman','fuad',
      // G
      'galih','gani','ganjar','gavin','gerry','ghani','ghufron','gilang',
      'gildan','giri','gogo','gunawan','gusti',
      // H
      'hafidz','hafiz','hamdan','hamid','hamzah','handoko','haris','harisma',
      'hasan','hendra','hendri','hendrian','hengki','henry','hilmi',
      'husain','husni',
      // I
      'ibad','ibrahim','ilham','imam','indra','irfan','irvan','irwan',
      'iskandar','ismail','ivan','iwan',
      // J
      'jaka','jaksun','jaya','jenius','jepri','jerry','joko','jona','jonas',
      'jose','josua','juan','julian','julianto','juni','juno',
      // K
      'kaerul','kafi','kahfi','kamal','karim','kevin','khaerul','khoirul',
      // L
      'lukman','luthfi',
      // M
      'madri','made','mahar','mahfud','mahfuz','mahmud','maman','marvin',
      'mas','masagung','masagus','maulana','maulid','maulidan',
      'misbah','misbahudin','mohamad','mohammad','muhajir','muhamad',
      'muhammad','mukhlis','munif','murad','mustofa',
      // N
      'nabil','naufal','nizar','noval','novandri','novian',
      // O
      'oscar',
      // P
      'pandu','panji','prayogi','putra',
      // R
      'raffi','rafiq','rahmat','rahmad','raihan','rajib','raka','ramadhan',
      'ramadan','ramlan','randi','rangga','rasyid','reza','ridho','ridwan',
      'rifqi','riski','rizal','rizki','robby','roby','roji','roni','ryan',
      // S
      'saeful','samsul','sandhi','sandi','sandy','santoso','satriya','satria',
      'septian','setiawan','sigit','slamet','sofyan','soni','sony','sugeng',
      'sugianto','surya','sutan',
      // T
      'taufik','tomi','tommy','tomy','trian','trisno',
      // U
      'umar',
      // W
      'wahyu','wahyudi','wandi','wawan','wildan','willy',
      // Y
      'yanuar','yehezkiel','yohanes','yudi','yulian','yusuf',
      // Z
      'zainal','zaki','zakky','zikri','zulkifli',
      // Tambahan spesifik
      'akhsin','amirulloh','elqoni','pamungkas','jeremia','natalino',
      'agung','trisno','dendra','ramadani','ibad',
    ]);

    // Suffix heuristik — cek kata pertama saja karena nama depan
    // paling konsisten mencerminkan gender di nama Indonesia
    const FEMALE_SUFFIXES = /(?:wati|yanti|yani|ningsih|sari|dewi|putri|ayu|ita|ani|ina|eni|ela|ula|nia|tia|via|sha|iza|nisa|nisah|rifah|fiyah|liyah|mawati|nawati|rawati)$/;
    const MALE_SUFFIXES   = /(?:anto|awan|yudi|yono|wan|uddin|han|man|ton|son|gun|vin|fin|bin|run|jan)$/;
    // Catatan: 'din' dihapus — duplikat dan terlalu banyak false-positive

    function guessGenderFromName(fullName) {
      const parts = fullName.trim().toLowerCase().split(/\s+/);
      for (const part of parts) {
        if (FEMALE_NAMES.has(part)) return 'female';
        if (MALE_NAMES.has(part)) return 'male';
      }
      const first = parts[0];
      if (FEMALE_SUFFIXES.test(first)) return 'female';
      if (MALE_SUFFIXES.test(first))   return 'male';
      return null;
    }




    /* ============================================================
       INIT & EVENT BINDINGS
    ============================================================ */
    function init() {
      loadState();

      // If no students, load defaults
      if (state.students.length === 0) {
        state.students = DEFAULT_STUDENTS.map(s => ({
          id: generateId(), name: s.name, gender: s.gender, status: 'present',
        }));
        state.seats = initSeats(state.rows, state.cols);
        state.students.forEach((student, i) => {
          if (state.seats[i]) state.seats[i].studentId = student.id;
        });
        saveState();
      } else {
        state.seats = initSeats(state.rows, state.cols);
      }

      // Apply persisted settings
      applyTheme();
      applyLang();
      applyPOV();
      applyBackground();
      syncGridInputs();

      initModals();
      initStudentTabs();
      renderAll();
      bindEvents();
    }

    let eventsBound = false;
    function bindEvents() {
      // Guard: cegah double-binding jika bindEvents() dipanggil lebih dari sekali
      if (eventsBound) return;
      eventsBound = true;

      /* ---------- VIEW TABS (desktop) ---------- */
      document.querySelectorAll('#view-tabs button').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
      });

      /* ---------- MOBILE BOTTOM NAV ---------- */
      document.querySelectorAll('#bottom-nav .bottom-nav-btn[data-view]').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
      });

      /* ---------- DARK MODE ---------- */
      document.getElementById('btn-darkmode').addEventListener('click', () => {
        state.theme = state.theme === 'light' ? 'dark' : 'light';
        applyTheme(); saveState();
      });

      /* ---------- LANGUAGE ---------- */
      // Globe language picker
      const langGlobeBtn = document.getElementById('btn-lang-globe');
      const langDropdown = document.getElementById('lang-dropdown');

      langGlobeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        langDropdown.classList.toggle('open');
      });

      // Tutup dropdown saat klik di luar
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#lang-picker')) {
          langDropdown.classList.remove('open');
        }
      });

      document.querySelectorAll('#lang-dropdown .lang-option').forEach(btn => {
        btn.addEventListener('click', () => {
          state.lang = btn.dataset.lang;
          langDropdown.classList.remove('open');
          applyLang(); saveState();
        });
      });

      /* ---------- POV TOGGLES ---------- */
      function bindPovToggle(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.querySelectorAll('button[data-pov]').forEach(btn => {
          btn.addEventListener('click', () => {
            state.pov = btn.dataset.pov;
            applyPOV(); saveState();
          });
        });
      }
      bindPovToggle('pov-toggle');
      bindPovToggle('pov-toggle-mobile');

      /* ---------- SHUFFLE ---------- */
      document.getElementById('btn-shuffle').addEventListener('click', shuffleSeats);
      document.getElementById('btn-shuffle-mobile').addEventListener('click', shuffleSeats);

      /* ---------- OPEN MODALS ---------- */
      document.getElementById('btn-open-students').addEventListener('click', () => {
        renderStudentList(); openModal('modal-students');
      });
      document.getElementById('btn-students-mobile').addEventListener('click', () => {
        renderStudentList(); openModal('modal-students');
      });
      document.getElementById('btn-open-settings').addEventListener('click', () => openModal('modal-settings'));

      // Absensi buttons
      document.getElementById('btn-open-attendance').addEventListener('click', openAttendanceModal);
      document.getElementById('btn-attendance-mobile').addEventListener('click', openAttendanceModal);

      // Input tanggal absensi — reload data
      document.getElementById('input-att-date').addEventListener('change', async e => {
        await loadAttForDate(e.target.value);
      });

      // Mark all hadir/alpa
      document.getElementById('btn-att-all-hadir').addEventListener('click', () => {
        state.students.forEach(s => { attTemp[s.id] = 'H'; });
        renderAttStudentList();
      });
      document.getElementById('btn-att-all-alpa').addEventListener('click', () => {
        state.students.forEach(s => { attTemp[s.id] = 'A'; });
        renderAttStudentList();
      });

      // Simpan absensi
      document.getElementById('btn-save-attendance').addEventListener('click', saveAttendance);

      // Rekap: buka dari settings atau bisa tambah dari settings modal
      // Filter rekap
      document.getElementById('btn-rekap-filter').addEventListener('click', async () => {
        const from = document.getElementById('rekap-from').value;
        const to   = document.getElementById('rekap-to').value;
        if (!from || !to) { showToast(t('toast_att_no_date'), 'warning'); return; }
        await renderRekap(from, to);
      });

      // Print rekap
      document.getElementById('btn-print-rekap').addEventListener('click', () => {
        window.print();
      });

      // Delete date
      document.getElementById('btn-delete-date').addEventListener('click', deleteAttDate);

      // Rekap dari settings
      document.getElementById('btn-open-rekap-att').addEventListener('click', openRekapModal);

      // Rekap nilai
      document.getElementById('btn-open-rekap-nilai').addEventListener('click', openRekapNilai);

      document.getElementById('btn-nilai-filter').addEventListener('click', async () => {
        const from = document.getElementById('nilai-from').value;
        const to   = document.getElementById('nilai-to').value;
        if (!from || !to) return;
        await renderRekapNilai(from, to);
      });

      document.getElementById('chk-include-zero').addEventListener('change', async () => {
        const from = document.getElementById('nilai-from').value;
        const to   = document.getElementById('nilai-to').value;
        if (from && to) await renderRekapNilai(from, to);
      });

      document.getElementById('btn-print-nilai').addEventListener('click', () => window.print());

      // Sub-tabs rekap nilai
      document.querySelectorAll('[data-nilai-tab]').forEach(btn => {
        btn.addEventListener('click', async () => {
          nilaiRekapTab = btn.dataset.nilaiTab;
          document.querySelectorAll('[data-nilai-tab]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const from = document.getElementById('nilai-from').value;
          const to   = document.getElementById('nilai-to').value;
          if (from && to) await renderRekapNilai(from, to);
        });
      });
      document.getElementById('btn-settings-mobile').addEventListener('click', () => openModal('modal-settings'));

      /* ---------- GRID SIZE ---------- */
      document.getElementById('btn-apply-grid').addEventListener('click', applyGridSize);
      document.getElementById('btn-edit-formasi').addEventListener('click', toggleFormasiMode);
      document.getElementById('btn-show-stats').addEventListener('click', () => {
        const panel = document.getElementById('stats-panel');
        const wasOpen = panel.classList.contains('show');
        showStats();
        if (!wasOpen && panel.classList.contains('show')) {
          pushBackState('stats-panel');
        }
      });
      document.getElementById('input-rows').addEventListener('keydown', e => { if (e.key === 'Enter') applyGridSize(); });
      document.getElementById('input-cols').addEventListener('keydown', e => { if (e.key === 'Enter') applyGridSize(); });

      /* ---------- ADD STUDENT ---------- */
      document.getElementById('btn-add-student').addEventListener('click', () => {
        const name = document.getElementById('input-student-name').value.trim();
        if (!name) { showToast('Please enter a name.', 'warning'); return; }

        // Auto-deteksi gender dari dictionary lokal
        const detected = guessGenderFromName(name);
        const gender = detected || document.getElementById('select-student-gender').value;
        document.getElementById('select-student-gender').value = gender;

        addStudent(name, gender);
        document.getElementById('input-student-name').value = '';
        renderStudentList(); renderGrid(); renderPickerPool();
        showToast(t('toast_student_added'), 'success');
        document.querySelector('[data-student-tab="list"]').click();
      });

      document.getElementById('input-student-name').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('btn-add-student').click();
      });

      /* ---------- BULK SAVE (reconcile + smart gender detection) ---------- */
      document.getElementById('btn-bulk-add').addEventListener('click', () => {
        const lines = document.getElementById('textarea-bulk').value
          .split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) { showToast('Enter at least one name.', 'warning'); return; }

        // Build a map of existing students by name (case-insensitive key, preserve original)
        const existingByName = {};
        state.students.forEach(s => { existingByName[s.name.toLowerCase()] = s; });

        // Deteksi gender semua nama dari dictionary lokal
        const genderMap = {};
        lines.forEach(name => {
          const g = guessGenderFromName(name);
          genderMap[name.toLowerCase()] = g || 'male';
        });

        // Figure out what's new vs kept vs removed
        const newStudentList = [];
        let addedCount = 0;
        lines.forEach(name => {
          const key = name.toLowerCase();
          const detectedGender = genderMap[key];
          if (existingByName[key]) {
            const existing = existingByName[key];
            // Always update gender from detection
            if (detectedGender) existing.gender = detectedGender;
            newStudentList.push(existing);
            delete existingByName[key];
          } else {
            newStudentList.push({ id: generateId(), name, gender: detectedGender || 'male', status: 'present' });
            addedCount++;
          }
        });

        // Students left in existingByName were removed from the list
        const removedIds = new Set(Object.values(existingByName).map(s => s.id));
        const removedCount = removedIds.size;

        // Remove removed students from seats
        state.seats.forEach(seat => {
          if (seat.studentId && removedIds.has(seat.studentId)) seat.studentId = null;
        });

        state.students = newStudentList;

        // Auto-assign unassigned present students to empty, non-disabled seats
        const assignedIds = new Set(state.seats.map(s => s.studentId).filter(Boolean));
        const unassigned = newStudentList.filter(s => s.status === 'present' && !assignedIds.has(s.id));
        const emptySeats = state.seats
          .map((s, i) => ({ seat: s, i }))
          .filter(({ seat }) => !seat.disabled && !seat.studentId);

        unassigned.forEach((student, idx) => {
          if (emptySeats[idx]) {
            emptySeats[idx].seat.studentId = student.id;
          }
        });

        // If grid is too small, expand columns to fit
        const totalSeats = state.rows * state.cols;
        if (newStudentList.length > totalSeats) {
          state.cols = Math.ceil(newStudentList.length / state.rows);
          state.seats = initSeats(state.rows, state.cols);
          syncGridInputs();
          // Re-assign everyone from scratch
          const presentStudents = newStudentList.filter(s => s.status === 'present');
          presentStudents.forEach((student, idx) => {
            if (state.seats[idx]) state.seats[idx].studentId = student.id;
          });
        }

        saveState();
        renderStudentList(); renderGrid(); renderPickerPool();

        const msg = [
          addedCount > 0 ? `+${addedCount} ${t('word_added')}` : '',
          removedCount > 0 ? `-${removedCount} ${t('word_removed')}` : '',
          `${newStudentList.length} ${t('word_total')}`,
        ].filter(Boolean).join(' · ');
        showToast(msg, 'success');
        document.querySelector('[data-student-tab="list"]').click();
      });

      /* ---------- MARK ALL ---------- */
      document.getElementById('btn-mark-all-present').addEventListener('click', () => {
        state.students.forEach(s => s.status = 'present');
        saveState(); renderStudentList(); renderGrid(); renderPickerPool();
        showToast(t('toast_all_present'), 'success');
      });

      document.getElementById('btn-mark-all-absent').addEventListener('click', () => {
        state.students.forEach(s => s.status = 'absent');
        state.seats.forEach(seat => { if (!seat.locked) seat.studentId = null; });
        saveState(); renderStudentList(); renderGrid(); renderPickerPool();
        showToast(t('toast_all_absent'), 'info');
      });

      document.getElementById('btn-sort-alpha').addEventListener('click', () => {
        state.students.sort((a, b) => a.name.localeCompare(b.name));
        saveState(); renderStudentList(); renderGrid();
        showToast(t('toast_sort_alpha'), 'success');
      });

      document.getElementById('btn-sort-status').addEventListener('click', () => {
        state.students.sort((a, b) => (b.status === 'present' ? 1 : 0) - (a.status === 'present' ? 1 : 0));
        saveState(); renderStudentList();
        showToast(t('toast_sort_status'), 'success');
      });

      document.getElementById('btn-reset-defaults').addEventListener('click', () => {
        if (confirm(t('toast_reset_confirm'))) {
          resetToDefaults();
          closeModal('modal-students');
        }
      });

      document.getElementById('btn-fix-gender').addEventListener('click', () => {
        let fixed = 0;
        state.students.forEach(s => {
          const detected = guessGenderFromName(s.name);
          if (detected && detected !== s.gender) {
            s.gender = detected;
            fixed++;
          }
        });
        saveState();
        renderStudentList(); renderGrid();
        showToast(fixed > 0 ? fixed + ' ' + t('toast_fix_gender') : t('toast_fix_gender_ok'), 'success');
      });

      /* ---------- EDIT STUDENT ---------- */
      document.getElementById('btn-save-edit').addEventListener('click', () => {
        const id = document.getElementById('edit-student-id').value;
        const name = document.getElementById('edit-student-name').value.trim();
        const gender = document.getElementById('edit-student-gender').value;
        const status = document.getElementById('edit-student-status').value;

        // PATCH #5: Validasi id sebelum update — cegah update ke student yang salah
        if (!id) { showToast('Error: ID siswa tidak ditemukan.', 'error'); return; }
        if (!name) { showToast('Please enter a name.', 'warning'); return; }
        if (!state.students.find(s => s.id === id)) {
          showToast('Error: Siswa tidak ditemukan.', 'error');
          closeModal('modal-edit-student');
          return;
        }

        updateStudent(id, { name, gender, status });
        renderStudentList(); renderGrid(); renderPickerPool();
        closeModal('modal-edit-student');
        showToast(t('toast_student_updated'), 'success');
      });

      /* ---------- PICKER ---------- */
      document.getElementById('focus-close-btn').addEventListener('click', closeFocusMode);
      document.getElementById('focus-overlay').addEventListener('click', e => {
        if (e.target === document.getElementById('focus-overlay')) closeFocusMode();
      });

      document.getElementById('btn-pick').addEventListener('click', pickName);
      document.getElementById('btn-undo-pick').addEventListener('click', undoPick);

      document.getElementById('chk-allow-repeat').addEventListener('change', e => {
        state.pickerAllowRepeat = e.target.checked;
        saveState(); renderPickerPool();
      });
      // Sync checkbox on load
      document.getElementById('chk-allow-repeat').checked = state.pickerAllowRepeat;

      document.getElementById('btn-clear-history').addEventListener('click', () => {
        state.pickerHistory = [];
        // Reset picker display
        document.getElementById('picker-name-display').classList.add('hidden');
        document.getElementById('picker-placeholder').classList.remove('hidden');
        document.getElementById('picker-avatar').style.display = 'none';
        document.getElementById('picker-display').classList.remove('picking', 'picked');
        // Remove seat highlights
        document.querySelectorAll('.seat-card.seat-highlighted').forEach(c => c.classList.remove('seat-highlighted'));
        saveState(); renderPickerHistory(); renderPickerPool();
      });

      /* ---------- EXPORT / IMPORT ---------- */
      document.getElementById('btn-export').addEventListener('click', exportData);

      document.getElementById('input-import').addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) { importData(file); e.target.value = ''; }
      });

      /* ---------- BACKGROUND IMAGE ---------- */
      document.getElementById('input-bg-image').addEventListener('change', e => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        // Validasi tipe file
        if (!file.type.startsWith('image/')) {
          showToast('File harus berupa gambar!', 'error');
          e.target.value = '';
          return;
        }
        handleBgUpload(file);
        e.target.value = '';
      });

      document.getElementById('btn-clear-bg').addEventListener('click', async () => {
        state.bgImage = null;
        applyBackground();
        try { localStorage.removeItem(bgKey()); } catch(e) {}
        if (currentUser) await deleteBgFromFirestore();
        showToast(t('toast_bg_cleared'), 'info');
      });

      /* ---------- CLEAR ALL DATA ---------- */
      document.getElementById('btn-clear-all-data').addEventListener('click', () => {
        if (confirm(t('toast_clear_confirm'))) {
          localStorage.removeItem(LS_KEY);
          localStorage.removeItem(bgKey());
          location.reload();
        }
      });

      /* ---------- LOGIN FORM EVENTS ---------- */
      document.getElementById('btn-email-login').addEventListener('click', async () => {
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        if (!email || !password) { showLoginError('Isi email dan password!'); return; }
        const btn = document.getElementById('btn-email-login');
        btn.disabled = true; btn.textContent = 'Memproses...';
        try {
          await auth.signInWithEmailAndPassword(email, password);
        } catch(e) {
          showLoginError(friendlyError(e.code));
          btn.disabled = false; btn.textContent = 'Masuk';
        }
      });

      document.getElementById('login-password').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('btn-email-login').click();
      });

      document.getElementById('btn-email-register').addEventListener('click', async () => {
        const name = document.getElementById('reg-name').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const pass = document.getElementById('reg-password').value;
        const confirm = document.getElementById('reg-confirm').value;
        if (!name) { showLoginError('Isi nama lengkap!'); return; }
        if (!email) { showLoginError('Isi email!'); return; }
        if (pass.length < 6) { showLoginError('Password min. 6 karakter.'); return; }
        if (pass !== confirm) { showLoginError('Password tidak cocok!'); return; }
        const btn = document.getElementById('btn-email-register');
        btn.disabled = true; btn.textContent = 'Mendaftar...';
        try {
          const cred = await auth.createUserWithEmailAndPassword(email, pass);
          await cred.user.updateProfile({ displayName: name });
        } catch(e) {
          showLoginError(friendlyError(e.code));
          btn.disabled = false; btn.textContent = 'Daftar';
        }
      });

      document.getElementById('btn-forgot').addEventListener('click', async () => {
        const emailField = document.getElementById('login-email');
        const email = emailField.value.trim();
        if (!email) {
          showLoginError('Isi email kamu dulu, lalu klik "Lupa password?"');
          emailField.focus();
          return;
        }
        const btn = document.getElementById('btn-forgot');
        btn.textContent = 'Mengirim...';
        btn.style.pointerEvents = 'none';
        try {
          await auth.sendPasswordResetEmail(email);
          const errEl = document.getElementById('login-error');
          errEl.className = 'login-error show';
          errEl.style.cssText = 'display:block;background:rgba(22,163,74,0.1);border-color:rgba(22,163,74,0.3);color:#16a34a;';
          errEl.textContent = '✓ Link reset password dikirim ke ' + email + '. Cek inbox & folder spam kamu!';
        } catch(e) {
          showLoginError(friendlyError(e.code));
        } finally {
          btn.textContent = 'Lupa password?';
          btn.style.pointerEvents = '';
        }
      });

      document.getElementById('btn-google-login').addEventListener('click', async () => {
        try {
          await auth.signInWithPopup(googleProvider);
        } catch(e) {
          showLoginError(friendlyError(e.code));
        }
      });

      /* ---------- USER AVATAR & DROPDOWN ---------- */
      document.getElementById('btn-logout').addEventListener('click', async () => {
        await auth.signOut();
        document.getElementById('user-dropdown').classList.remove('open');
        currentClassId = null;
      });

      document.getElementById('btn-user-avatar').addEventListener('click', e => {
        e.stopPropagation();
        document.getElementById('user-dropdown').classList.toggle('open');
      });

      document.addEventListener('click', () => {
        document.getElementById('user-dropdown').classList.remove('open');
      });

      /* ---------- CLASS SELECTOR ---------- */
      document.getElementById('seating-class-name').addEventListener('click', () => {
        openClassSelector();
      });

      document.getElementById('btn-switch-class').addEventListener('click', () => {
        document.getElementById('user-dropdown').classList.remove('open');
        openClassSelector();
      });

      document.getElementById('btn-close-classes').addEventListener('click', () => {
        closeModal('modal-classes');
      });

      document.getElementById('btn-create-class').addEventListener('click', async () => {
        const nameInput = document.getElementById('input-new-class');
        const name = nameInput.value.trim();
        if (!name) { showToast(t('toast_class_empty_name'), 'warning'); return; }
        const ref = await db.collection('users').doc(currentUser.uid).collection('classes').add({
          name,
          studentCount: 0,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        nameInput.value = '';
        await selectClass(ref.id);
        closeModal('modal-classes');
      });
    }

    function showLoginScreen() {
      document.getElementById('login-screen').style.display = 'flex';
      document.getElementById('toolbar').style.display = 'none';
      document.getElementById('main-content').style.display = 'none';
      document.getElementById('bottom-nav').style.display = 'none';
      // Reset form supaya tombol ga stuck disabled
      const btnLogin = document.getElementById('btn-email-login');
      const btnReg = document.getElementById('btn-email-register');
      if (btnLogin) { btnLogin.disabled = false; btnLogin.textContent = 'Masuk'; }
      if (btnReg) { btnReg.disabled = false; btnReg.textContent = 'Daftar'; }
      // Kosongkan field
      ['login-email','login-password','reg-name','reg-email','reg-password','reg-confirm']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      // Sembunyikan error
      const err = document.getElementById('login-error');
      if (err) err.classList.remove('show');
      // Kembali ke tab Masuk
      switchLoginTab('login');
    }

    function showApp() {
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('toolbar').style.display = '';
      document.getElementById('main-content').style.display = '';
      document.getElementById('bottom-nav').style.display = '';
    }

    function updateUserUI(user) {
      document.getElementById('user-display-name').textContent = user.displayName || user.email || 'Pengguna';
      document.getElementById('user-display-email').textContent = user.email || '';
      document.getElementById('user-menu-wrap').style.display = '';
      const avatarBtn = document.getElementById('btn-user-avatar');
      if (user.photoURL) {
        avatarBtn.innerHTML = `<img src="${user.photoURL}" alt="avatar" referrerpolicy="no-referrer">`;
      } else {
        // Inisial nama untuk user email/password
        const initial = (user.displayName || user.email || '?').charAt(0).toUpperCase();
        avatarBtn.innerHTML = `<span style="font-size:0.85rem;font-weight:700;color:var(--accent-primary)">${initial}</span>`;
      }
    }

    // ── Google Login


    function showLoginError(msg) {
      const el = document.getElementById('login-error');
      // Reset ke warna error (kalau sebelumnya warna sukses dari forgot password)
      el.style.background = '';
      el.style.borderColor = '';
      el.style.color = '';
      el.textContent = msg;
      el.classList.add('show');
    }

    function friendlyError(code) {
      const map = {
        'auth/user-not-found': 'Email tidak terdaftar.',
        'auth/wrong-password': 'Password salah.',
        'auth/invalid-credential': 'Email atau password salah.',
        'auth/email-already-in-use': 'Email sudah terdaftar.',
        'auth/weak-password': 'Password terlalu lemah (min. 6 karakter).',
        'auth/invalid-email': 'Format email tidak valid.',
        'auth/too-many-requests': 'Terlalu banyak percobaan. Coba lagi nanti.',
        'auth/popup-closed-by-user': 'Login dibatalkan.',
      };
      return map[code] || 'Terjadi kesalahan. Coba lagi.';
    }

    function classDoc(classId) {
      return db.collection('users').doc(currentUser.uid).collection('classes').doc(classId);
    }

    // ── Load semua kelas user
    async function loadUserClasses() {
      const snap = await db.collection('users').doc(currentUser.uid)
        .collection('classes').orderBy('createdAt', 'asc').get();

      if (snap.empty) {
        // User baru — buka class selector langsung
        openClassSelector();
      } else {
        const classes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Load kelas terakhir yang dipakai, atau kelas pertama
        const lastClassId = localStorage.getItem('kelasku_last_class_' + currentUser.uid);
        const targetId = lastClassId && classes.find(c => c.id === lastClassId)
          ? lastClassId : classes[0].id;
        await selectClass(targetId);
      }
    }

    // ── Buka class selector modal
    async function openClassSelector() {
      await renderClassList();
      openModal('modal-classes');
    }

    // ── Render daftar kelas di modal
    async function renderClassList() {
      const ul = document.getElementById('class-list-ul');
      ul.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-size:0.85rem;padding:12px;">Memuat...</p>';

      const snap = await db.collection('users').doc(currentUser.uid)
        .collection('classes').orderBy('createdAt', 'asc').get();

      if (snap.empty) {
        ul.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-size:0.85rem;padding:12px;">Belum ada kelas. Buat kelas baru di bawah.</p>';
        return;
      }

      ul.innerHTML = '';
      snap.docs.forEach(doc => {
        const cls = { id: doc.id, ...doc.data() };
        const li = document.createElement('div');
        li.className = 'class-item' + (cls.id === currentClassId ? ' active' : '');

        const initial = cls.name.charAt(0).toUpperCase();
        const studentCount = cls.studentCount || 0;
        const updatedAt = cls.updatedAt ? new Date(cls.updatedAt.toDate()).toLocaleDateString(state.lang === 'id' ? 'id-ID' : state.lang === 'ja' ? 'ja-JP' : 'en-US') : '–';

        li.innerHTML = `
          <div class="class-item-icon">${initial}</div>
          <div class="class-item-info">
            <p class="class-item-name">${cls.name}</p>
            <p class="class-item-meta">${studentCount} siswa · ${updatedAt}</p>
          </div>
          <div class="class-item-actions">
            <button class="class-action-btn danger" data-delete="${cls.id}" data-name="${cls.name}" title="Hapus">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14H6L5 6"/>
              </svg>
            </button>
          </div>
        `;

        li.addEventListener('click', async e => {
          if (e.target.closest('[data-delete]')) return;
          await selectClass(cls.id);
          closeModal('modal-classes');
        });

        // Delete handler
        li.querySelector('[data-delete]').addEventListener('click', async e => {
          e.stopPropagation();
          const name = e.currentTarget.dataset.name;
          if (!confirm(t('toast_class_delete_confirm').replace('kelas', `kelas "${name}"`))) return;

          // PATCH #2a: Guard double-click
          const delBtn = e.currentTarget;
          if (delBtn.disabled) return;
          delBtn.disabled = true;

          try {
            await db.collection('users').doc(currentUser.uid)
              .collection('classes').doc(cls.id).delete();

            // PATCH #2b: Batalkan saveTimer kalau kelas yang dihapus sedang aktif
            // supaya data lama tidak ke-save setelah delete
            if (currentClassId === cls.id) {
              clearTimeout(saveTimer);
              saveTimer = null;
              currentClassId = null;
              document.getElementById('active-class-label').style.display = 'none';
              document.getElementById('active-class-label').textContent = '';
              updateClassChip(null);
              Object.assign(state, buildFreshState());
              renderAll();
            }
            await renderClassList();
            showToast('Kelas dihapus.', 'info');
          } catch(e) {
            showToast('Gagal hapus kelas: ' + e.message, 'error');
            delBtn.disabled = false;
          }
        });

        ul.appendChild(li);
      });
    }

    function buildFreshState() {
      return {
        students: [],
        seats: Array.from({ length: 20 }, () => ({ studentId: null, locked: false, disabled: false })),
        rows: 4, cols: 5,
        theme: state.theme,
        lang: state.lang,
        pov: 'teacher',
        pickerHistory: [],
        pickerAllowRepeat: false,
        bgImage: null,
      };
    }

    // ── Pilih / load kelas
    // Token untuk cegah stale load: setiap selectClass() baru increment token
    // dan setiap await dicek apakah token masih valid
    let _selectToken = 0;

    async function selectClass(classId) {
      // Increment token — request lama yang masih await akan melihat token berbeda
      const myToken = ++_selectToken;

      currentClassId = classId;
      localStorage.setItem('kelasku_last_class_' + currentUser.uid, classId);
      setSyncStatus('syncing');

      // Helper: cek apakah request ini masih relevan
      const isStale = () => myToken !== _selectToken;

      try {
        const snap = await classDoc(classId).collection('data').doc('state').get();
        if (isStale()) return; // user sudah pindah kelas lain

        if (snap.exists) {
          const data = snap.data();
          const localTheme = state.theme;
          const localLang = state.lang;
          Object.assign(state, data);
          state.theme = localTheme;
          state.lang = localLang;

          const bgFromCloud = await loadBgFromFirestore();
          if (isStale()) return; // cek lagi setelah await bg

          if (bgFromCloud) {
            state.bgImage = bgFromCloud;
            try { localStorage.setItem(bgKey(), bgFromCloud); } catch(e) {}
            applyBackground();
          } else {
            const cached = localStorage.getItem(bgKey());
            if (cached) { state.bgImage = cached; applyBackground(); }
          }
        } else {
          // Kelas ada tapi belum ada state — init fresh
          const fresh = buildFreshState();
          await classDoc(classId).collection('data').doc('state').set(fresh);
          if (isStale()) return;
          Object.assign(state, fresh);
        }

        // Update nama kelas di toolbar
        const clsSnap = await db.collection('users').doc(currentUser.uid)
          .collection('classes').doc(classId).get();
        if (isStale()) return;

        if (clsSnap.exists) {
          const label = document.getElementById('active-class-label');
          label.textContent = clsSnap.data().name;
          updateClassChip(clsSnap.data().name);
        }

        applyTheme();
        applyLang();
        applyPOV();
        syncGridInputs();
        renderAll();
        setSyncStatus('synced');

      } catch(e) {
        if (isStale()) return; // error dari request lama, abaikan
        console.warn('selectClass failed:', e);
        showToast('Gagal load kelas: ' + e.message, 'error');
        setSyncStatus('error'); // jujur: tidak set synced saat error
      }
    }

    // ── Simpan state ke Firestore (debounced)
    let saveTimer = null;

    function saveState() {
      // Tetap simpan ke localStorage sebagai cache offline
      try {
        const toSave = { ...state, bgImage: null };
        localStorage.setItem(LS_KEY, JSON.stringify(toSave));
        if (state.bgImage) localStorage.setItem(bgKey(), state.bgImage);
        else localStorage.removeItem(bgKey());
      } catch(e) {}

      // Simpan ke Firestore jika sudah login & ada kelas aktif
      if (!currentUser || !currentClassId) return;
      setSyncStatus('syncing');
      clearTimeout(saveTimer);
      // FIX #1: Capture classId & uid saat saveState dipanggil,
      // bukan saat timer fired — cegah race condition ganti kelas
      const savedClassId = currentClassId;
      const savedUid = currentUser.uid;
      saveTimer = setTimeout(async () => {
        // Batalkan jika user sudah ganti kelas atau logout
        if (!currentUser || currentUser.uid !== savedUid || currentClassId !== savedClassId) return;
        try {
          const toSave = { ...state };
          delete toSave.bgImage;
          await classDoc(savedClassId).collection('data').doc('state').set(toSave);
          await db.collection('users').doc(savedUid)
            .collection('classes').doc(savedClassId).update({
              studentCount: state.students.length,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
          setSyncStatus('synced');
        } catch(e) {
          console.warn('Firestore save failed:', e);
          setSyncStatus('error');
        }
      }, 1200);
    }

    function updateClassChip(name) {
      const seatingLabel = document.getElementById('seating-class-name');
      if (!seatingLabel) return;
      if (!name) { seatingLabel.style.display = 'none'; return; }
      seatingLabel.textContent = name;
      seatingLabel.style.display = '';
    }

    function setSyncStatus(status) {
      const indicator = document.getElementById('sync-indicator');
      const label = document.getElementById('sync-label');
      if (!indicator || !label) return;

      // Reset semua class status
      indicator.classList.remove('syncing', 'sync-error', 'offline');

      if (status === 'syncing') {
        indicator.classList.add('syncing');
        label.textContent = t('sync_saving');
      } else if (status === 'error') {
        indicator.classList.add('sync-error');
        label.textContent = t('sync_error');
      } else if (status === 'offline') {
        indicator.classList.add('offline');
        label.textContent = t('sync_offline');
      } else {
        // synced / online
        label.textContent = t('sync_saved');
      }
    }

    // ── Monitor koneksi internet secara aktif
    function startNetworkMonitor() {
      function checkOnline() {
        if (!navigator.onLine) {
          setSyncStatus('offline');
        } else {
          // Kalau sebelumnya offline dan sekarang online lagi,
          // kembalikan ke synced (bukan langsung syncing)
          const indicator = document.getElementById('sync-indicator');
          if (indicator && indicator.classList.contains('offline')) {
            setSyncStatus('synced');
          }
        }
      }

      window.addEventListener('online',  () => setSyncStatus('synced'));
      window.addEventListener('offline', () => setSyncStatus('offline'));

      // Cek awal saat pertama load
      checkOnline();

      // Poll tiap 5 detik sebagai fallback (beberapa browser lambat update navigator.onLine)
      setInterval(checkOnline, 5000);
    }

    // ── Override loadState agar tidak crash saat pertama load
    // (data akan di-load dari Firestore setelah auth)
    function loadState() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          state = { ...state, ...parsed };
          state.bgImage = null; // bg selalu load dari Firestore per-user, bukan localStorage
        }
      } catch(e) {}
    }

    // Keyboard shortcuts
    /* ============================================================
       NILAI SYSTEM
    ============================================================ */

    let nilaiTemp = {}; // { studentId: score }
    let nilaiRekapTab = 'per-siswa';
    let includeZero = false;


    function nilaiDoc(date) {
      return classDoc(currentClassId).collection('nilai').doc(date);
    }

    // scores = array nilai yang ada (tidak undefined)
    // inclZero = true → bagi dengan totalDates (yang tidak ada dihitung 0)
    // inclZero = false → bagi hanya dengan yang ada nilainya
    function calcAvg(scores, inclZero, totalDates) {
      const existing = scores.filter(v => v !== undefined && v !== null);
      if (existing.length === 0) return null;
      const sum = existing.reduce((a, b) => a + b, 0);
      const divisor = inclZero && totalDates ? totalDates : existing.length;
      if (divisor === 0) return null;
      return (sum / divisor).toFixed(1);
    }

    function scoreColor(avg) {
      if (avg === null) return 'var(--text-muted)';
      if (avg >= 85) return '#16a34a';
      if (avg >= 70) return '#2563eb';
      if (avg >= 55) return '#d97706';
      return '#dc2626';
    }

    async function openRekapNilai() {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const lastDay  = new Date(now.getFullYear(), now.getMonth()+1, 0).toISOString().split('T')[0];
      document.getElementById('nilai-from').value = firstDay;
      document.getElementById('nilai-to').value = lastDay;
      openModal('modal-rekap-nilai');
      await renderRekapNilai(firstDay, lastDay);
    }

    async function renderRekapNilai(from, to) {
      const thead = document.getElementById('nilai-thead');
      const tbody = document.getElementById('nilai-tbody');
      includeZero = document.getElementById('chk-include-zero').checked;

      tbody.innerHTML = `<tr><td colspan="20" style="text-align:center;padding:20px;color:var(--text-muted)">Memuat...</td></tr>`;
      thead.innerHTML = '';

      // Ambil semua dokumen nilai dalam range
      let docs = [];
      try {
        const snap = await classDoc(currentClassId).collection('nilai').get();
        docs = snap.docs
          .filter(d => d.id >= from && d.id <= to)
          .sort((a, b) => a.id.localeCompare(b.id));
      } catch(e) {
        tbody.innerHTML = `<tr><td colspan="20" style="text-align:center;padding:20px;color:var(--text-muted)">${t('lbl_no_nilai')}</td></tr>`;
        return;
      }

      if (docs.length === 0) {
        thead.innerHTML = '';
        tbody.innerHTML = `<tr><td colspan="20" style="text-align:center;padding:24px;color:var(--text-muted);font-style:italic">${t('lbl_no_nilai')}</td></tr>`;
        return;
      }

      // Build data structure
      const nilaiByDate = {};
      docs.forEach(d => { nilaiByDate[d.id] = d.data(); });
      const dates = docs.map(d => d.id);

      // Collect per-student scores
      const studentScores = {}; // { studentId: { date: score } }
      const weeklyScores  = {}; // { studentId: { week: [scores] } }
      state.students.forEach(s => { studentScores[s.id] = {}; weeklyScores[s.id] = {}; });

      docs.forEach(d => {
        const date = d.id;
        const data = d.data();
        const week = data._week || getWeekNumber(date);
        state.students.forEach(s => {
          const score = data[s.id];
          if (score !== undefined) {
            studentScores[s.id][date] = score;
            if (!weeklyScores[s.id][week]) weeklyScores[s.id][week] = [];
            weeklyScores[s.id][week].push(score);
          }
        });
      });

      const tab = nilaiRekapTab;

      if (tab === 'per-siswa') {
        // Kolom: nama | tanggal1 | tanggal2 | ... | rata-rata
        thead.innerHTML = `<tr>
          <th class="th-name">${t('col_name')}</th>
          ${dates.map(d => {
            const dd = new Date(d + 'T00:00:00');
            const day = dd.toLocaleDateString(state.lang === 'id' ? 'id-ID' : state.lang === 'ja' ? 'ja-JP' : 'en-US', { day:'numeric', month:'short' });
            const isMonday = dd.getDay() === 1;
            return `<th>${day}<div style="font-size:0.65rem;opacity:0.7;font-weight:400">${isMonday ? '📋' : '✏️'}</div></th>`;
          }).join('')}
          <th style="background:var(--bg-primary)">${t('lbl_avg')}</th>
        </tr>`;

        let rows = '';
        state.students.forEach(s => {
          const cells = dates.map(d => {
            const score = studentScores[s.id][d];
            if (score === undefined) return `<td style="color:var(--text-muted)">–</td>`;
            const color = scoreColor(score);
            return `<td><strong style="color:${color}">${score}</strong></td>`;
          }).join('');
          const allScores = dates.map(d => studentScores[s.id][d]).filter(v => v !== undefined);
          const avg = calcAvg(allScores, includeZero, dates.length);
          rows += `<tr>
            <td class="td-name">${s.name}</td>
            ${cells}
            <td><strong style="color:${scoreColor(avg ? parseFloat(avg) : null)}">${avg ?? '–'}</strong></td>
          </tr>`;
        });

        // Class avg row
        const dateAvgs = dates.map(d => {
          const scores = state.students.map(s => studentScores[s.id][d]).filter(v => v !== undefined);
          return calcAvg(scores, includeZero, state.students.length);
        });
        rows += `<tr class="rekap-summary-row">
          <td class="td-name">${t('lbl_class_avg')}</td>
          ${dateAvgs.map(avg => `<td><strong style="color:${scoreColor(avg ? parseFloat(avg) : null)}">${avg ?? '–'}</strong></td>`).join('')}
          <td><strong style="color:${scoreColor((() => {
            const all = dateAvgs.filter(v => v !== null).map(v => parseFloat(v));
            return all.length ? parseFloat((all.reduce((a,b)=>a+b,0)/all.length).toFixed(1)) : null;
          })())}">${(() => {
            const all = dateAvgs.filter(v => v !== null).map(v => parseFloat(v));
            return all.length ? (all.reduce((a,b)=>a+b,0)/all.length).toFixed(1) : '–';
          })()}</strong></td>
        </tr>`;
        tbody.innerHTML = rows;

      } else if (tab === 'per-hari') {
        // Kolom: tanggal | rata-rata kelas | nilai tertinggi | nilai terendah
        thead.innerHTML = `<tr>
          <th class="th-name">Tanggal</th>
          <th>Tipe</th>
          <th>${t('lbl_class_avg')}</th>
          <th>Max</th>
          <th>Min</th>
          <th>Siswa Hadir</th>
        </tr>`;
        let rows = '';
        dates.forEach(d => {
          const dd = new Date(d + 'T00:00:00');
          const dayLabel = dd.toLocaleDateString(state.lang === 'id' ? 'id-ID' : state.lang === 'ja' ? 'ja-JP' : 'en-US', { weekday:'long', day:'numeric', month:'short' });
          const isMonday = dd.getDay() === 1;
          const scores = state.students.map(s => studentScores[s.id][d]).filter(v => v !== undefined);
          const avg = calcAvg(scores, includeZero, state.students.length);
          // Min/Max: saat includeZero, siswa tanpa nilai dihitung 0
          const allStudentScores = state.students.map(s => studentScores[s.id][d]);
          const hasAbsent = allStudentScores.some(v => v === undefined);
          const scoresForMax = scores.length ? scores : [];
          const scoresForMin = includeZero
            ? (hasAbsent ? [0] : scores)  // kalau ada yang kosong, min = 0
            : scores.filter(v => v > 0);
          const maxVal = scoresForMax.length ? Math.max(...scoresForMax) : '–';
          const minVal = scoresForMin.length ? Math.min(...scoresForMin) : '–';
          rows += `<tr>
            <td class="td-name">${dayLabel}</td>
            <td><span class="quiz-type-badge ${isMonday ? 'badge-weekly' : 'badge-daily'}">${isMonday ? t('lbl_quiz_weekly') : t('lbl_quiz_daily')}</span></td>
            <td><strong style="color:${scoreColor(avg ? parseFloat(avg) : null)}">${avg ?? '–'}</strong></td>
            <td style="color:#16a34a"><strong>${maxVal}</strong></td>
            <td style="color:#dc2626"><strong>${minVal}</strong></td>
            <td>${scores.length}</td>
          </tr>`;
        });
        tbody.innerHTML = rows;

      } else if (tab === 'per-minggu') {
        // Minggu-minggu unik
        const weeks = [...new Set(docs.map(d => d.data()._week || getWeekNumber(d.id)))].sort();
        // Hitung berapa hari quiz ada per minggu (sebagai total untuk includeZero)
        const datesPerWeek = {};
        weeks.forEach(w => {
          datesPerWeek[w] = docs.filter(d => (d.data()._week || getWeekNumber(d.id)) === w).length;
        });
        const totalAllDates = docs.length;

        thead.innerHTML = `<tr>
          <th class="th-name">${t('col_name')}</th>
          ${weeks.map(w => `<th>Minggu ${w}<div style="font-size:0.65rem;opacity:0.6;font-weight:400">${datesPerWeek[w]} hari</div></th>`).join('')}
          <th>${t('lbl_avg')}</th>
        </tr>`;
        let rows = '';
        state.students.forEach(s => {
          const cells = weeks.map(w => {
            const wScores = weeklyScores[s.id][w] || [];
            // includeZero: tambah 0 untuk hari yang siswa tidak ada nilainya di minggu ini
            const totalDaysInWeek = datesPerWeek[w];
            const missingDays = totalDaysInWeek - wScores.length;
            const scoresWithZero = includeZero
              ? [...wScores, ...Array(Math.max(0, missingDays)).fill(0)]
              : wScores;
            const avg = calcAvg(scoresWithZero, false, scoresWithZero.length);
            return `<td><strong style="color:${scoreColor(avg ? parseFloat(avg) : null)}">${avg ?? '–'}</strong></td>`;
          }).join('');
          const allW = Object.values(weeklyScores[s.id]).flat();
          // Overall: tambah 0 untuk semua hari yang tidak ada nilainya
          const missingOverall = totalAllDates - allW.length;
          const allWWithZero = includeZero
            ? [...allW, ...Array(Math.max(0, missingOverall)).fill(0)]
            : allW;
          const overall = calcAvg(allWWithZero, false, allWWithZero.length);
          rows += `<tr>
            <td class="td-name">${s.name}</td>
            ${cells}
            <td><strong style="color:${scoreColor(overall ? parseFloat(overall) : null)}">${overall ?? '–'}</strong></td>
          </tr>`;
        });
        tbody.innerHTML = rows;

      } else if (tab === 'ringkasan') {
        // 1 row per siswa: nama | total hadir | rata keseluruhan | rata harian | rata mingguan
        thead.innerHTML = `<tr>
          <th class="th-name">${t('col_name')}</th>
          <th>Quiz Masuk</th>
          <th>${t('lbl_avg')}</th>
          <th>${t('lbl_quiz_daily')} Avg</th>
          <th>${t('lbl_quiz_weekly')} Avg</th>
          <th>Rank</th>
        </tr>`;

        const studentData = state.students.map(s => {
          const allScores = Object.values(studentScores[s.id]);
          const dailyScores = dates
            .filter(d => nilaiByDate[d]?._type === 'weekday' && studentScores[s.id][d] !== undefined)
            .map(d => studentScores[s.id][d]);
          const weeklyScoresArr = dates
            .filter(d => nilaiByDate[d]?._type === 'monday' && studentScores[s.id][d] !== undefined)
            .map(d => studentScores[s.id][d]);
          return {
            s,
            count: allScores.length,
            avg: calcAvg(allScores, includeZero, dates.length),
            dailyAvg: calcAvg(dailyScores, includeZero, dates.filter(d => nilaiByDate[d]?._type === 'weekday').length),
            weeklyAvg: calcAvg(weeklyScoresArr, includeZero, dates.filter(d => nilaiByDate[d]?._type === 'monday').length),
          };
        });

        // Sort by avg descending untuk rank
        const sorted = [...studentData].sort((a, b) => (parseFloat(b.avg)||0) - (parseFloat(a.avg)||0));
        const rankMap = {};
        sorted.forEach((d, i) => { rankMap[d.s.id] = i + 1; });

        let rows = '';
        studentData.forEach(({ s, count, avg, dailyAvg, weeklyAvg }) => {
          const rank = rankMap[s.id];
          const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
          rows += `<tr>
            <td class="td-name">${s.name}</td>
            <td>${count}</td>
            <td><strong style="color:${scoreColor(avg ? parseFloat(avg) : null)}">${avg ?? '–'}</strong></td>
            <td>${dailyAvg ?? '–'}</td>
            <td>${weeklyAvg ?? '–'}</td>
            <td>${medal}</td>
          </tr>`;
        });

        // Class summary
        const allClassScores = state.students.flatMap(s => Object.values(studentScores[s.id]));
        const classAvg = calcAvg(allClassScores, includeZero, state.students.length * dates.length);
        rows += `<tr class="rekap-summary-row">
          <td class="td-name">${t('lbl_class_avg')}</td>
          <td>–</td>
          <td><strong style="color:${scoreColor(classAvg ? parseFloat(classAvg) : null)}">${classAvg ?? '–'}</strong></td>
          <td>–</td><td>–</td><td>–</td>
        </tr>`;
        tbody.innerHTML = rows;
      }
    }

    /* ============================================================
       ABSENSI SYSTEM
    ============================================================ */

    // State absensi sementara saat modal terbuka
    // { studentId: 'H'|'S'|'I'|'A' }
    let attTemp = {};
    let _lastAttErrToast = 0;

    // Firestore path absensi: users/{uid}/classes/{classId}/attendance/{date}
    function attDoc(date) {
      return classDoc(currentClassId).collection('attendance').doc(date);
    }

    // Format tanggal YYYY-MM-DD
    function todayStr() {
      return new Date().toISOString().split('T')[0];
    }

    function formatDateDisplay(dateStr) {
      if (!dateStr) return '';
      const d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString(state.lang === 'id' ? 'id-ID' : state.lang === 'ja' ? 'ja-JP' : 'en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
    }

    async function openAttendanceModal() {
      if (!currentClassId) { showToast('Pilih kelas dulu!', 'warning'); return; }
      // Set tanggal default = hari ini
      document.getElementById('input-att-date').value = todayStr();
      // Load data absensi hari ini kalau ada
      await loadAttForDate(todayStr());
      openModal('modal-attendance');
    }

    async function loadAttForDate(date) {
      attTemp = {};
      nilaiTemp = {};
      state.students.forEach(s => { attTemp[s.id] = 'H'; });
      state.students.forEach(s => { if (s.status === 'absent') attTemp[s.id] = 'A'; });

      if (currentUser && currentClassId) {
        try {
          // Load absensi
          const attSnap = await attDoc(date).get();
          // "tidak ada data" = doc tidak exist → normal, bukan error
          if (attSnap.exists) {
            const data = attSnap.data();
            Object.keys(data).forEach(id => { if (id !== '_date') attTemp[id] = data[id]; });
          }
          // Load nilai
          const nilaiSnap = await nilaiDoc(date).get();
          if (nilaiSnap.exists) {
            const data = nilaiSnap.data();
            Object.keys(data).forEach(id => {
              if (id !== '_date' && id !== '_type') nilaiTemp[id] = data[id];
            });
          }
        } catch(e) {
          // "gagal load" = error jaringan / permission — bedakan dari "data kosong"
          console.warn('loadAttForDate gagal:', e.message);
          const _now = Date.now();
          if (_now - _lastAttErrToast > 3000) {
            _lastAttErrToast = _now;
            showToast('Data absensi gagal dimuat. Coba lagi.', 'warning');
          }
        }
      }
      renderAttStudentList();
    }

    function getDayType(dateStr) {
      // Return 'monday' untuk Senin (kuis mingguan), 'weekday' untuk Selasa-Jumat
      // Return null untuk Sabtu/Minggu
      if (!dateStr) return null;
      const d = new Date(dateStr + 'T00:00:00');
      const day = d.getDay(); // 0=Sun,1=Mon,...,6=Sat
      if (day === 0 || day === 6) return null;
      if (day === 1) return 'monday';
      return 'weekday';
    }

    function getWeekNumber(dateStr) {
      const d = new Date(dateStr + 'T00:00:00');
      const startOfYear = new Date(d.getFullYear(), 0, 1);
      const diff = d - startOfYear;
      return Math.ceil((diff / 86400000 + startOfYear.getDay() + 1) / 7);
    }

    function renderAttStudentList() {
      const date = document.getElementById('input-att-date').value;
      const dayType = getDayType(date);
      const list = document.getElementById('att-student-list');
      list.innerHTML = '';

      // Header nilai — tampilkan hanya untuk hari kerja
      let nilaiHeader = '';
      if (dayType === 'monday') {
        nilaiHeader = `<div class="nilai-section-title" style="margin-top:0;margin-bottom:8px;">
          ${t('lbl_quiz_weekly')} <span class="quiz-type-badge badge-weekly">Senin</span>
        </div>`;
      } else if (dayType === 'weekday') {
        nilaiHeader = `<div class="nilai-section-title" style="margin-top:0;margin-bottom:8px;">
          ${t('lbl_quiz_daily')} <span class="quiz-type-badge badge-daily">Quiz</span>
        </div>`;
      }

      // Sisipkan header di atas list
      if (nilaiHeader) {
        const headerEl = document.createElement('div');
        headerEl.innerHTML = nilaiHeader;
        list.appendChild(headerEl);
      }

      state.students.forEach(s => {
        const current = attTemp[s.id] || 'H';
        const currentNilai = nilaiTemp[s.id] !== undefined ? nilaiTemp[s.id] : '';
        const isPresent = current === 'H';

        const row = document.createElement('div');
        row.className = 'attendance-student-row';
        row.innerHTML = `
          <div style="flex-shrink:0">${getAvatar(s.gender, 28)}</div>
          <span class="attendance-student-name">${s.name}</span>
          <div style="display:flex;align-items:center;gap:8px;">
            ${dayType ? `<input
              type="number" min="0" max="100"
              class="nilai-input ${currentNilai !== '' ? 'nilai-filled' : 'nilai-empty'}"
              placeholder="–"
              value="${currentNilai}"
              data-sid="${s.id}"
              ${!isPresent ? 'disabled style="opacity:0.4;"' : ''}
              title="${t('lbl_nilai_label')}"
            />` : ''}
            <div class="attendance-status-btns">
              ${[['H',t('att_hadir')],['S',t('att_sakit')],['I',t('att_izin')],['A',t('att_alpa')]].map(([st,lbl]) => `
                <button class="att-btn ${st} ${current === st ? 'active' : ''}"
                  data-sid="${s.id}" data-status="${st}">
                  ${lbl}
                </button>
              `).join('')}
            </div>
          </div>
        `;
        list.appendChild(row);
      });

      // Event: status buttons
      list.querySelectorAll('.att-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const sid = btn.dataset.sid;
          const status = btn.dataset.status;
          attTemp[sid] = status;
          btn.closest('.attendance-status-btns').querySelectorAll('.att-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.status === status);
          });
          // Disable/enable nilai input
          const nilaiInput = btn.closest('.attendance-student-row').querySelector('.nilai-input');
          if (nilaiInput) {
            nilaiInput.disabled = status !== 'H';
            nilaiInput.style.opacity = status !== 'H' ? '0.4' : '1';
          }
        });
      });

      // Event: nilai input
      list.querySelectorAll('.nilai-input').forEach(input => {
        input.addEventListener('input', () => {
          const sid = input.dataset.sid;
          const val = input.value.trim();
          if (val === '') {
            delete nilaiTemp[sid];
            input.classList.remove('nilai-filled');
            input.classList.add('nilai-empty');
          } else {
            const num = Math.min(100, Math.max(0, parseInt(val) || 0));
            nilaiTemp[sid] = num;
            input.classList.add('nilai-filled');
            input.classList.remove('nilai-empty');
          }
        });
        // Clamp saat blur
        input.addEventListener('blur', () => {
          if (input.value !== '') {
            input.value = Math.min(100, Math.max(0, parseInt(input.value) || 0));
          }
        });

        // Enter → loncat ke input nilai berikutnya yang tidak disabled
        input.addEventListener('keydown', e => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const allInputs = [...document.querySelectorAll('.nilai-input:not([disabled])')];
          const idx = allInputs.indexOf(input);
          if (idx >= 0 && idx < allInputs.length - 1) {
            allInputs[idx + 1].focus();
            allInputs[idx + 1].select();
          } else if (idx === allInputs.length - 1) {
            // Sudah input terakhir — fokus ke tombol simpan
            document.getElementById('btn-save-attendance').focus();
          }
        });
      });
    }

    async function saveAttendance() {
      const date = document.getElementById('input-att-date').value;
      if (!date) { showToast(t('toast_att_no_date'), 'warning'); return; }
      if (!currentUser || !currentClassId) return;

      // Baca nilai dari input yang masih aktif di DOM
      document.querySelectorAll('.nilai-input').forEach(input => {
        const sid = input.dataset.sid;
        const val = input.value.trim();
        if (val !== '' && !input.disabled) {
          nilaiTemp[sid] = Math.min(100, Math.max(0, parseInt(val) || 0));
        }
      });

      // FIX #4: Pisahkan try/catch absensi dan nilai
      // supaya partial failure tidak menyesatkan user
      const dayType = getDayType(date);
      const weekNum = getWeekNumber(date);

      let attOk = false, nilaiOk = false;
      try {
        await attDoc(date).set({ ...attTemp, _date: date });
        attOk = true;
      } catch(e) {
        showToast('Gagal simpan absensi: ' + e.message, 'error');
      }

      if (dayType && attOk) {
        try {
          await nilaiDoc(date).set({
            ...nilaiTemp,
            _date: date,
            _type: dayType,
            _week: weekNum,
          });
          nilaiOk = true;
        } catch(e) {
          showToast('Absensi tersimpan, tapi nilai gagal: ' + e.message, 'warning');
        }
      }

      if (attOk) {
        const msg = dayType
          ? (nilaiOk ? t('toast_att_saved') + ' & ' + t('toast_nilai_saved') : t('toast_att_saved'))
          : t('toast_att_saved');
        showToast(msg, 'success');
        closeModal('modal-attendance');
      }
    }

    // ── Rekap Absensi ──
    async function openRekapModal() {
      if (!currentClassId) { showToast('Pilih kelas dulu!', 'warning'); return; }
      // Default range: bulan ini
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const lastDay  = new Date(now.getFullYear(), now.getMonth()+1, 0).toISOString().split('T')[0];
      document.getElementById('rekap-from').value = firstDay;
      document.getElementById('rekap-to').value = lastDay;
      openModal('modal-rekap');
      await renderRekap(firstDay, lastDay);
    }

    async function renderRekap(from, to) {
      const tbody = document.getElementById('rekap-tbody');
      const thead = document.getElementById('rekap-thead');
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--text-muted)">Memuat...</td></tr>`;

      // Ambil semua dokumen absensi dalam range
      let snap;
      try {
        snap = await classDoc(currentClassId).collection('attendance')
          .where('_date', '>=', from)
          .where('_date', '<=', to)
          .orderBy('_date', 'asc')
          .get();
      } catch(e) {
        // Fallback tanpa orderBy kalau index belum ada
        try {
          snap = await classDoc(currentClassId).collection('attendance').get();
        } catch(e2) {
          tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--text-muted)">${t('rekap_no_data')}</td></tr>`;
          return;
        }
      }

      // Filter manual kalau pakai fallback
      const docs = snap.docs
        .filter(d => d.id >= from && d.id <= to && d.id !== '_meta')
        .sort((a, b) => a.id.localeCompare(b.id));

      if (docs.length === 0) {
        thead.innerHTML = '';
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--text-muted);font-style:italic">${t('rekap_no_data')}</td></tr>`;
        return;
      }

      const dates = docs.map(d => d.id);
      const attByDate = {};
      docs.forEach(d => { attByDate[d.id] = d.data(); });

      // Header
      thead.innerHTML = `<tr>
        <th class="th-name">${t('col_name')}</th>
        ${dates.map(d => {
          const dd = new Date(d + 'T00:00:00');
          const day = dd.toLocaleDateString(state.lang === 'id' ? 'id-ID' : state.lang === 'ja' ? 'ja-JP' : 'en-US', { day: 'numeric', month: 'short' });
          const dow = dd.toLocaleDateString(state.lang === 'id' ? 'id-ID' : state.lang === 'ja' ? 'ja-JP' : 'en-US', { weekday: 'short' });
          return `<th><div>${day}</div><div style="font-weight:400;opacity:0.7">${dow}</div></th>`;
        }).join('')}
        <th style="background:var(--bg-primary)">${t('col_total_H')}</th>
        <th style="background:var(--bg-primary)">${t('col_total_S')}</th>
        <th style="background:var(--bg-primary)">${t('col_total_I')}</th>
        <th style="background:var(--bg-primary)">${t('col_total_A')}</th>
      </tr>`;

      // Rows per siswa
      const summaryH = Array(dates.length).fill(0);
      const summaryS = Array(dates.length).fill(0);
      const summaryI = Array(dates.length).fill(0);
      const summaryA = Array(dates.length).fill(0);

      let rows = '';
      state.students.forEach(s => {
        let totH=0, totS=0, totI=0, totA=0;
        const cells = dates.map((d, di) => {
          const st = (attByDate[d] && attByDate[d][s.id]) || '–';
          if (st==='H') { totH++; summaryH[di]++; }
          else if (st==='S') { totS++; summaryS[di]++; }
          else if (st==='I') { totI++; summaryI[di]++; }
          else if (st==='A') { totA++; summaryA[di]++; }
          const cls = st === '–' ? '' : `rb-${st}`;
          return `<td><span class="rekap-badge ${cls}">${st}</span></td>`;
        }).join('');
        rows += `<tr>
          <td class="td-name">${s.name}</td>
          ${cells}
          <td><span class="rekap-badge rb-H">${totH}</span></td>
          <td><span class="rekap-badge rb-S">${totS}</span></td>
          <td><span class="rekap-badge rb-I">${totI}</span></td>
          <td><span class="rekap-badge rb-A">${totA}</span></td>
        </tr>`;
      });

      // Summary row
      const sumCells = dates.map((d, di) => {
        return `<td style="font-size:0.7rem;line-height:1.4">
          <span class="rekap-badge rb-H">${summaryH[di]}</span>
        </td>`;
      }).join('');
      rows += `<tr class="rekap-summary-row">
        <td class="td-name">${t('row_summary')}</td>
        ${sumCells}
        <td><span class="rekap-badge rb-H">${summaryH.reduce((a,b)=>a+b,0)}</span></td>
        <td><span class="rekap-badge rb-S">${summaryS.reduce((a,b)=>a+b,0)}</span></td>
        <td><span class="rekap-badge rb-I">${summaryI.reduce((a,b)=>a+b,0)}</span></td>
        <td><span class="rekap-badge rb-A">${summaryA.reduce((a,b)=>a+b,0)}</span></td>
      </tr>`;

      tbody.innerHTML = rows;

      // Update info header cetak
      const classSnap = await db.collection('users').doc(currentUser.uid)
        .collection('classes').doc(currentClassId).get();
      const className = classSnap.exists ? classSnap.data().name : '';
      document.getElementById('rekap-class-name').textContent = className;
      document.getElementById('rekap-date-range').textContent =
        formatDateDisplay(from) + ' – ' + formatDateDisplay(to);
      document.getElementById('rekap-class-info').style.display = 'block';
    }

    async function deleteAttDate() {
      const from = document.getElementById('rekap-from').value;
      const to   = document.getElementById('rekap-to').value;
      if (!from || !to) { showToast(t('toast_att_no_date'), 'warning'); return; }
      if (!confirm('Hapus data absensi dari ' + from + ' s/d ' + to + '?')) return;
      try {
        const snap = await classDoc(currentClassId).collection('attendance')
          .where('_date', '>=', from).where('_date', '<=', to).get();
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        showToast(t('toast_att_deleted'), 'success');
        await renderRekap(from, to);
      } catch(e) { showToast('Gagal hapus: ' + e.message, 'error'); }
    }

    /* ============================================================
       REKAP ABSENSI — IMPORT / EXPORT
    ============================================================ */

    // Helper: safe filename slug
    function slugifyName(str) {
      return (str || 'kelas')
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 40) || 'kelas';
    }

    // Helper: today YYYY-MM-DD
    function todayStr() {
      return new Date().toISOString().split('T')[0];
    }

    // Helper: trigger file download dari Blob
    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    // Helper: ambil semua data absensi kelas aktif dari Firestore
    async function fetchAllAttendance() {
      const snap = await classDoc(currentClassId).collection('attendance').get();
      // Filter dokumen _meta jika ada
      return snap.docs.filter(d => d.id !== '_meta');
    }

    // Helper: dapatkan nama kelas aktif
    async function getActiveClassName() {
      try {
        const doc = await db.collection('users').doc(currentUser.uid)
          .collection('classes').doc(currentClassId).get();
        return doc.exists ? (doc.data().name || '') : '';
      } catch(e) { return ''; }
    }

    // ── EXPORT JSON ──────────────────────────────────────────────
    async function exportAttendanceJSON() {
      if (!currentUser || !currentClassId) {
        showToast('Pilih kelas terlebih dahulu.', 'warning'); return;
      }
      const btn = document.getElementById('btn-rekap-export-json');
      if (btn) btn.disabled = true;
      try {
        const className = await getActiveClassName();
        const docs = await fetchAllAttendance();

        const attendance = docs
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(d => {
            const data = d.data();
            // Hapus field internal _date/_week dari records
            const records = {};
            Object.entries(data).forEach(([k, v]) => {
              if (!k.startsWith('_')) records[k] = v;
            });
            return { date: d.id, records };
          });

        const payload = {
          type: 'attendance-export',
          version: 1,
          exportedAt: new Date().toISOString(),
          classId: currentClassId,
          className,
          students: state.students.map(s => ({ id: s.id, name: s.name })),
          attendance,
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const fname = `attendance_${slugifyName(className)}_${todayStr()}.json`;
        downloadBlob(blob, fname);
        showToast('Export JSON berhasil!', 'success');
      } catch(e) {
        console.error('exportAttendanceJSON:', e);
        showToast('Gagal export: ' + e.message, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    // ── IMPORT JSON ──────────────────────────────────────────────
    async function importAttendanceJSON(file) {
      if (!currentUser || !currentClassId) {
        showToast('Pilih kelas terlebih dahulu.', 'warning'); return;
      }
      let parsed;
      try {
        const text = await file.text();
        parsed = JSON.parse(text);
      } catch(e) {
        showToast('File JSON tidak valid.', 'error'); return;
      }

      // Validasi minimal
      if (parsed.type !== 'attendance-export' || !parsed.version || !Array.isArray(parsed.attendance)) {
        showToast('Format file tidak dikenali. Pastikan file export dari Kelasku.', 'error'); return;
      }

      const records = parsed.attendance;
      if (records.length === 0) {
        showToast('File tidak berisi data absensi.', 'warning'); return;
      }

      // Cek konflik: tanggal yang sudah ada
      let existingDates = new Set();
      try {
        const snap = await classDoc(currentClassId).collection('attendance').get();
        snap.docs.forEach(d => { if (d.id !== '_meta') existingDates.add(d.id); });
      } catch(e) {}

      const conflictDates = records.filter(r => existingDates.has(r.date));
      let overwrite = false;
      if (conflictDates.length > 0) {
        overwrite = confirm(`Data absensi pada ${conflictDates.length} tanggal sudah ada. Timpa data tanggal yang bentrok?`);
      }

      // Buat mapping nama → id dari siswa aktif (fallback jika id tidak cocok)
      const nameMap = {};
      state.students.forEach(s => {
        nameMap[s.name.trim().toLowerCase()] = s.id;
      });
      const idSet = new Set(state.students.map(s => s.id));

      let importedCount = 0, skippedCount = 0, unmatchedCells = 0;

      for (const rec of records) {
        if (!rec.date || typeof rec.date !== 'string') continue;

        // Skip tanggal bentrok jika user memilih tidak timpa
        if (existingDates.has(rec.date) && !overwrite) {
          skippedCount++;
          continue;
        }

        const docData = {};
        const rawRecords = rec.records || {};
        Object.entries(rawRecords).forEach(([sid, status]) => {
          const validStatus = ['H','S','I','A'];
          if (!validStatus.includes(status)) { unmatchedCells++; return; }

          if (idSet.has(sid)) {
            // ID langsung cocok
            docData[sid] = status;
          } else {
            // Fallback: cari berdasarkan nama di export
            const exportStudent = (parsed.students || []).find(st => st.id === sid);
            if (exportStudent) {
              const nameKey = exportStudent.name.trim().toLowerCase();
              const mappedId = nameMap[nameKey];
              if (mappedId) {
                docData[mappedId] = status;
              } else {
                unmatchedCells++;
              }
            } else {
              unmatchedCells++;
            }
          }
        });

        if (Object.keys(docData).length > 0) {
          try {
            // _date wajib ada agar query where('_date',...) di renderRekap bisa menemukan dokumen ini
            await classDoc(currentClassId).collection('attendance').doc(rec.date).set(
              { ...docData, _date: rec.date },
              { merge: !overwrite }
            );
            importedCount++;
          } catch(e) {
            console.warn('Import gagal untuk', rec.date, e);
            skippedCount++;
          }
        }
      }

      // Refresh rekap jika modal terbuka
      const from = document.getElementById('rekap-from').value;
      const to = document.getElementById('rekap-to').value;
      if (from && to) {
        try { await renderRekap(from, to); } catch(e) {}
      }

      const msg = `Import selesai: ${importedCount} tanggal masuk, ${skippedCount} dilewati, ${unmatchedCells} sel tidak cocok.`;
      showToast(msg, importedCount > 0 ? 'success' : 'warning');
    }

    // ── EXPORT CSV ───────────────────────────────────────────────
    async function exportAttendanceCSV() {
      if (!currentUser || !currentClassId) {
        showToast('Pilih kelas terlebih dahulu.', 'warning'); return;
      }
      const btn = document.getElementById('btn-rekap-export-csv');
      if (btn) btn.disabled = true;
      try {
        const className = await getActiveClassName();
        const docs = await fetchAllAttendance();

        if (docs.length === 0) {
          showToast('Belum ada data absensi untuk diekspor.', 'warning');
          return;
        }

        const sortedDocs = docs.sort((a, b) => a.id.localeCompare(b.id));
        const students = state.students;

        // Header: Tanggal, Nama1, Nama2, ...
        const escapeCsv = v => `"${String(v).replace(/"/g, '""')}"`;
        const headerRow = ['Tanggal', ...students.map(s => escapeCsv(s.name))].join(',');

        const rows = [headerRow];
        sortedDocs.forEach(d => {
          const data = d.data();
          const cells = [d.id, ...students.map(s => {
            const st = data[s.id];
            return st ? escapeCsv(st) : '""';
          })];
          rows.push(cells.join(','));
        });

        // UTF-8 BOM agar Excel Indonesia tidak rusak encoding
        const csvContent = '\uFEFF' + rows.join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const fname = `attendance_table_${slugifyName(className)}_${todayStr()}.csv`;
        downloadBlob(blob, fname);
        showToast('Export Tabel (CSV) berhasil!', 'success');
      } catch(e) {
        console.error('exportAttendanceCSV:', e);
        showToast('Gagal export CSV: ' + e.message, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    // ── IMPORT CSV ───────────────────────────────────────────────
    async function importAttendanceCSV(file) {
      if (!currentUser || !currentClassId) {
        showToast('Pilih kelas terlebih dahulu.', 'warning'); return;
      }
      let text;
      try {
        text = await file.text();
      } catch(e) {
        showToast('Gagal membaca file.', 'error'); return;
      }

      // Simple CSV parser: handle quoted fields
      function parseCSVRow(line) {
        const result = [];
        let cur = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            if (inQ && line[i+1] === '"') { cur += '"'; i++; }
            else inQ = !inQ;
          } else if (ch === ',' && !inQ) {
            result.push(cur.trim()); cur = '';
          } else {
            cur += ch;
          }
        }
        result.push(cur.trim());
        return result;
      }

      // Hapus BOM jika ada
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      const lines = text.split(/\r?\n/).filter(l => l.trim());

      if (lines.length < 2) {
        showToast('File CSV kosong atau header tidak valid.', 'error'); return;
      }

      const headerCols = parseCSVRow(lines[0]);
      if (headerCols[0].toLowerCase() !== 'tanggal') {
        showToast('Header kolom pertama harus "Tanggal".', 'error'); return;
      }

      // Mapping nama header → student id
      const nameMap = {};
      state.students.forEach(s => {
        nameMap[s.name.trim().toLowerCase()] = s.id;
      });

      const colStudentIds = headerCols.slice(1).map(name => {
        return nameMap[name.trim().toLowerCase()] || null;
      });
      const unmatchedHeaders = colStudentIds.filter(id => id === null).length;

      // Cek konflik
      let existingDates = new Set();
      try {
        const snap = await classDoc(currentClassId).collection('attendance').get();
        snap.docs.forEach(d => { if (d.id !== '_meta') existingDates.add(d.id); });
      } catch(e) {}

      const dataCols = lines.slice(1).map(l => parseCSVRow(l));
      const conflictCount = dataCols.filter(cols => cols[0] && existingDates.has(cols[0])).length;
      let overwrite = false;
      if (conflictCount > 0) {
        overwrite = confirm(`Data absensi pada ${conflictCount} tanggal sudah ada. Timpa data tanggal yang bentrok?`);
      }

      const validStatus = new Set(['H','S','I','A']);
      let importedCount = 0, skippedCount = 0, invalidCells = 0;

      for (const cols of dataCols) {
        const date = (cols[0] || '').trim();
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

        if (existingDates.has(date) && !overwrite) {
          skippedCount++; continue;
        }

        const docData = {};
        for (let ci = 1; ci < cols.length; ci++) {
          const sid = colStudentIds[ci - 1];
          if (!sid) continue;
          const val = (cols[ci] || '').trim().toUpperCase();
          if (validStatus.has(val)) {
            docData[sid] = val;
          } else if (val !== '') {
            invalidCells++;
          }
        }

        if (Object.keys(docData).length > 0) {
          try {
            // _date wajib ada agar query where('_date',...) di renderRekap bisa menemukan dokumen ini
            await classDoc(currentClassId).collection('attendance').doc(date).set(
              { ...docData, _date: date },
              { merge: !overwrite }
            );
            importedCount++;
          } catch(e) {
            console.warn('Import CSV gagal untuk', date, e);
            skippedCount++;
          }
        }
      }

      // Refresh rekap
      const from = document.getElementById('rekap-from').value;
      const to = document.getElementById('rekap-to').value;
      if (from && to) {
        try { await renderRekap(from, to); } catch(e) {}
      }

      let msg = `Import Tabel selesai: ${importedCount} tanggal masuk, ${skippedCount} dilewati`;
      if (invalidCells > 0) msg += `, ${invalidCells} sel tidak valid`;
      if (unmatchedHeaders > 0) msg += `, ${unmatchedHeaders} nama siswa tidak cocok`;
      msg += '.';
      showToast(msg, importedCount > 0 ? 'success' : 'warning');
    }

    // ── Bind event listener tombol-tombol baru ───────────────────
    document.getElementById('btn-rekap-export-json').addEventListener('click', exportAttendanceJSON);
    document.getElementById('btn-rekap-export-csv').addEventListener('click', exportAttendanceCSV);

    document.getElementById('input-rekap-import-json').addEventListener('change', async e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      await importAttendanceJSON(file);
      e.target.value = '';
    });

    document.getElementById('input-rekap-import-csv').addEventListener('change', async e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      await importAttendanceCSV(file);
      e.target.value = '';
    });

    // ── Fungsi "tutup semua" — sama seperti Escape / tombol back HP
    function handleBackAction() {
      // 1. Tutup focus overlay kalau terbuka
      const focusOverlay = document.getElementById('focus-overlay');
      if (focusOverlay && focusOverlay.classList.contains('open')) {
        closeFocusMode(); return;
      }

      // 2. Tutup context menu kalau ada
      const openMenus = document.querySelectorAll('.seat-context-menu.open');
      if (openMenus.length > 0) { closeAllContextMenus(); return; }

      // 3. Tutup stats panel kalau terbuka
      const statsPanel = document.getElementById('stats-panel');
      if (statsPanel && statsPanel.classList.contains('show')) {
        statsPanel.classList.remove('show');
        return;
      }

      // 4. Tutup modal yang terbuka
      const openModals = document.querySelectorAll('.modal-overlay.open');
      if (openModals.length > 0) {
        closeModal(openModals[openModals.length - 1].id);
        return;
      }
    }

    // ── Push dummy history state saat buka modal/panel
    // supaya tombol back HP trigger popstate, bukan keluar app
    function pushBackState(label) {
      history.pushState({ kelasku: label }, '');
    }

    // ── Intercept tombol back HP via popstate
    window.addEventListener('popstate', (e) => {
      const hasOpen = document.querySelectorAll('.modal-overlay.open, .seat-context-menu.open').length > 0
        || document.getElementById('stats-panel')?.classList.contains('show');

      if (hasOpen) {
        handleBackAction();
        // Push state lagi supaya back masih bisa dipakai kalau ada yang lain terbuka
        const stillOpen = document.querySelectorAll('.modal-overlay.open').length > 0
          || document.getElementById('stats-panel')?.classList.contains('show');
        if (stillOpen) history.pushState({ kelasku: 'open' }, '');
      }
    });

    // FIX #5: Ganti monkey-patch dengan wrapper bersih
    // _origOpenModal dihapus, openModal langsung include pushBackState
    // Redefine openModal setelah fungsi awal didefinisikan
    const _openModalBase = openModal;
    openModal = function(id) {
      _openModalBase(id);
      // Push history state hanya kalau modal benar-benar terbuka
      const el = document.getElementById(id);
      if (el && el.classList.contains('open')) {
        pushBackState(id);
      }
    };

    // ── Keyboard shortcut (Escape untuk PC, popstate untuk HP)
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault(); shuffleSeats();
      }
      if (e.key === 'Escape') {
        handleBackAction();
      }
      if (e.key === 'p' && !e.ctrlKey && !e.metaKey) switchView('picker');
      if (e.key === 's' && !e.ctrlKey && !e.metaKey) switchView('seating');
    });

    // Auto-open kalender saat input date difokus/diklik — pakai mousedown bukan click
    // supaya tidak re-trigger setelah pilih tanggal
    document.addEventListener('mousedown', e => {
      if (e.target.matches('input[type="date"]')) {
        // Beri sedikit delay supaya focus selesai dulu
        setTimeout(() => {
          try { e.target.showPicker(); } catch(err) {}
        }, 10);
      }
    });

    // Touch untuk mobile
    document.addEventListener('touchstart', e => {
      if (e.target.matches('input[type="date"]')) {
        setTimeout(() => {
          try { e.target.showPicker(); } catch(err) {}
        }, 50);
      }
    }, { passive: true });

    document.addEventListener('DOMContentLoaded', () => {
      // Init UI dulu dalam kondisi tersembunyi
      showLoginScreen();
      loadState();
      applyTheme();
      applyLang();
      initModals();
      initStudentTabs();
      bindEvents();
      startNetworkMonitor();
    });


    /* ============================================================
       window._K_* BRIDGE — Expose internals to app-sa.js
    ============================================================ */
    // State accessors
    window._K_getState = () => state;
    window._K_getCurrentUser = () => currentUser;
    window._K_setCurrentUser = (u) => { currentUser = u; };
    window._K_getCurrentClassId = () => currentClassId;
    window._K_setCurrentClassId = (id) => { currentClassId = id; };
    window._K_isSyncing = () => isSyncing;
    window._K_LS_KEY = LS_KEY;

    // Core UI functions
    window._K_showApp = showApp;
    window._K_showLoginScreen = showLoginScreen;
    window._K_updateUserUI = updateUserUI;
    window._K_showLoginError = showLoginError;
    window._K_showToast = showToast;
    window._K_openModal = (id) => openModal(id);
    window._K_closeModal = closeModal;
    window._K_t = t;
    window._K_applyLang = applyLang;
    window._K_applyBackground = applyBackground;
    window._K_applyTheme = applyTheme;
    window._K_bgKey = bgKey;
    window._K_updateClassChip = updateClassChip;
    window._K_setSyncStatus = setSyncStatus;
    window._K_renderAll = renderAll;

    // Class management
    window._K_loadUserClasses = loadUserClasses;
    window._K_selectClass = selectClass;
    window._K_openClassSelector = openClassSelector;

    // Background
    window._K_loadBgFromFirestore = loadBgFromFirestore;
    window._K_deleteBgFromFirestore = deleteBgFromFirestore;

    // i18n hook — sa.js can override to add SA translations
    window._K_applyLangHook = null;

  })();
