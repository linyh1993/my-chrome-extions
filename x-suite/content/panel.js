/** @file 页内控制：默认小图标，点击展开完整面板 */
const XcfPanel = (() => {
  const POS_KEY = 'xcf_panel_pos';
  let dock = null;
  let iconBtn = null;
  let panel = null;
  let handlers = null;
  let drag = null;
  let suppressIconClick = false;
  let mirrorAttached = false;
  let mirrorEnabledPref = true;
  let mirrorBusy = false;

  function loadPos() {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
    } catch {
      /* ignore */
    }
    return null;
  }

  function savePos(x, y) {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ x, y }));
    } catch {
      /* ignore */
    }
  }

  function applyPosition(el, pos) {
    if (!el) return;
    if (pos) {
      el.style.left = `${Math.max(8, pos.x)}px`;
      el.style.top = `${Math.max(8, pos.y)}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    } else {
      el.style.left = 'auto';
      el.style.top = 'auto';
      el.style.right = '16px';
      el.style.bottom = '72px';
    }
  }

  function clampPos(x, y, w, h) {
    const pad = 8;
    const maxX = Math.max(pad, window.innerWidth - w - pad);
    const maxY = Math.max(pad, window.innerHeight - h - pad);
    return {
      x: Math.min(maxX, Math.max(pad, x)),
      y: Math.min(maxY, Math.max(pad, y))
    };
  }

  function startDrag(e, el, { fromIcon = false } = {}) {
    if (e.button !== 0) return;
    const rect = el.getBoundingClientRect();
    drag = {
      el,
      fromIcon,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left,
      origTop: rect.top
    };
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.classList.add('xcf-dock-dragging');
    e.preventDefault();
  }

  function onDragMove(e) {
    if (!drag) return;
    const w = drag.el.offsetWidth;
    const h = drag.el.offsetHeight;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    const p = clampPos(drag.origLeft + dx, drag.origTop + dy, w, h);
    drag.el.style.left = `${p.x}px`;
    drag.el.style.top = `${p.y}px`;
  }

  function endDrag() {
    if (!drag) return;
    const { fromIcon, moved } = drag;
    drag.el.classList.remove('xcf-dock-dragging');
    const rect = drag.el.getBoundingClientRect();
    savePos(rect.left, rect.top);
    if (fromIcon && moved) suppressIconClick = true;
    drag = null;
  }

  function renderMirrorStatus() {
    const el = panel?.querySelector('[data-xcf-mirror-status]');
    if (!el) return;
    el.textContent =
      mirrorAttached ? '镜像：监听中'
      : mirrorEnabledPref ? '镜像：连接中…'
      : '镜像：已关闭';
    el.classList.toggle('xcf-panel-mirror-on', mirrorAttached);
  }

  function setMirrorEnabled(enabled) {
    if (mirrorBusy) return;
    mirrorBusy = true;
    chrome.runtime.sendMessage(
      { domain: 'mirror', action: 'SET_MIRROR_ENABLED', enabled },
      (res) => {
        mirrorBusy = false;
        if (chrome.runtime.lastError) {
          updateMirror({ status: mirrorAttached });
          return;
        }
        if (res?.permissionDenied) {
          updateMirror({ status: false, permissionDenied: true });
          return;
        }
        updateMirror({
          status: Boolean(res?.isAttached),
          enabled: res?.mirrorEnabled !== false
        });
      }
    );
  }

  function openOptionsSection(sectionId) {
    chrome.storage.session.set({ [XCF.SESSION.OPTIONS_MAIN]: sectionId }, () => {
      chrome.runtime.sendMessage({ type: XCF.MSG.OPEN_OPTIONS_PAGE });
    });
  }

  function setExpanded(expanded, { persist = true } = {}) {
    if (!dock || !iconBtn || !panel) return;
    dock.classList.toggle('xcf-dock--expanded', expanded);
    iconBtn.hidden = expanded;
    panel.hidden = !expanded;
    if (persist) handlers?.onPanelUiChange?.({ expanded });
  }

  function mount(h) {
    handlers = h;
    if (dock) return panel;

    dock = document.createElement('div');
    dock.className = 'xcf-dock';
    dock.setAttribute('role', 'group');
    dock.setAttribute('aria-label', 'X Suite');

    iconBtn = document.createElement('button');
    iconBtn.type = 'button';
    iconBtn.className = 'xcf-dock-icon';
    iconBtn.title = '拖动移动，单击打开';
    iconBtn.setAttribute('aria-label', '拖动移动，单击打开 X Suite');
    iconBtn.textContent = 'X';

    panel = document.createElement('div');
    panel.className = 'xcf-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="xcf-panel-head" data-xcf-drag title="拖动移动">
        <span class="xcf-panel-title">X Suite</span>
        <button type="button" class="xcf-panel-shrink" data-xcf-shrink title="收为小图标">−</button>
      </div>
      <div class="xcf-panel-body">
        <p class="xcf-panel-section-label">评论过滤</p>
        <label class="xcf-panel-switch">
          <input type="checkbox" data-xcf-enabled />
          <span>启用</span>
        </label>
        <p class="xcf-panel-stats" data-xcf-stats>等待扫描</p>
        <hr class="xcf-panel-divider" />
        <p class="xcf-panel-section-label">流量镜像</p>
        <label class="xcf-panel-switch">
          <input type="checkbox" data-xcf-mirror />
          <span>启用</span>
        </label>
        <p class="xcf-panel-mirror-status" data-xcf-mirror-status>镜像：已关闭</p>
        <div class="xcf-panel-actions">
          <button type="button" class="xcf-panel-link" data-xcf-open-filter>评论设置</button>
          <button type="button" class="xcf-panel-link" data-xcf-open-library>评论库</button>
          <button type="button" class="xcf-panel-link" data-xcf-open-mirror>镜像设置</button>
        </div>
      </div>
    `;

    dock.appendChild(iconBtn);
    dock.appendChild(panel);
    document.body.appendChild(dock);

    applyPosition(dock, loadPos());

    iconBtn.addEventListener('pointerdown', (e) => startDrag(e, dock, { fromIcon: true }));
    iconBtn.addEventListener('click', () => {
      if (suppressIconClick) {
        suppressIconClick = false;
        return;
      }
      setExpanded(true);
    });

    const head = panel.querySelector('[data-xcf-drag]');
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-xcf-shrink]')) return;
      startDrag(e, dock);
    });

    panel.querySelector('[data-xcf-shrink]').addEventListener('click', (e) => {
      e.stopPropagation();
      setExpanded(false);
    });

    panel.querySelector('[data-xcf-enabled]').addEventListener('change', (e) => {
      handlers?.onEnabledChange?.(e.target.checked);
    });

    panel.querySelector('[data-xcf-mirror]').addEventListener('change', (e) => {
      setMirrorEnabled(e.target.checked);
    });

    panel.querySelector('[data-xcf-open-filter]').addEventListener('click', () =>
      openOptionsSection('filter-settings')
    );
    panel.querySelector('[data-xcf-open-library]').addEventListener('click', () =>
      openOptionsSection('library')
    );
    panel.querySelector('[data-xcf-open-mirror]').addEventListener('click', () =>
      openOptionsSection('mirror')
    );

    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    renderMirrorStatus();
    syncMirrorStateFromBg();
    return panel;
  }

  function normalizePanelUi(ui) {
    if (ui && typeof ui.expanded === 'boolean') {
      return { expanded: ui.expanded };
    }
    if (ui?.hidden === false && (ui?.collapsed === false || ui?.wide)) {
      return { expanded: true };
    }
    return { expanded: false };
  }

  function applyPanelUi(ui = {}) {
    setExpanded(normalizePanelUi(ui).expanded, { persist: false });
  }

  function syncMirrorStateFromBg() {
    chrome.runtime.sendMessage(
      { domain: 'mirror', action: 'ENSURE_TAB_MIRROR' },
      (res) => {
        if (chrome.runtime.lastError || !res) return;
        updateMirror({
          status: res.isAttached,
          enabled: res.mirrorEnabled,
          siteLabel: res.siteLabel
        });
      }
    );
  }

  function updateMirror({ status, enabled, siteLabel, permissionDenied } = {}) {
    if (enabled !== undefined) mirrorEnabledPref = enabled !== false;
    mirrorAttached = Boolean(status);
    const cb = panel?.querySelector('[data-xcf-mirror]');
    if (cb && !mirrorBusy) cb.checked = mirrorEnabledPref;
    if (permissionDenied) {
      const el = panel?.querySelector('[data-xcf-mirror-status]');
      if (el) {
        el.textContent = '镜像：需授权调试权限';
        el.classList.remove('xcf-panel-mirror-on');
      }
      return;
    }
    renderMirrorStatus();
    if (siteLabel && panel) panel.dataset.mirrorSite = siteLabel;
  }

  function update(settings, stats = {}) {
    if (!panel) return;
    const enabled = settings?.enabled !== false;
    const cb = panel.querySelector('[data-xcf-enabled]');
    if (cb) cb.checked = enabled;

    const statsEl = panel.querySelector('[data-xcf-stats]');
    if (statsEl) {
      statsEl.textContent =
        enabled && stats.foldedCount > 0 ?
          `折叠 ${stats.foldedCount}`
        : enabled ? '等待扫描' : '已关闭';
    }

    applyPanelUi(settings?.panelUi || {});
  }

  function isOwnNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    return Boolean(node.closest?.('.xcf-dock'));
  }

  return { mount, update, updateMirror, isOwnNode, loadPos, applyPanelUi, normalizePanelUi };
})();
