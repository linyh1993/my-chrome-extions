/** @file 页面内统一浮动控制条：评论过滤 + 流量镜像 */
const XcfPanel = (() => {
  const POS_KEY = 'xcf_panel_pos';
  let panel = null;
  let fab = null;
  let handlers = null;
  let drag = null;
  let mirrorAttached = false;
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

  function startDrag(e, el) {
    if (e.button !== 0) return;
    const rect = el.getBoundingClientRect();
    drag = {
      el,
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left,
      origTop: rect.top
    };
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.classList.add('xcf-panel-dragging');
    e.preventDefault();
  }

  function onDragMove(e) {
    if (!drag) return;
    const w = drag.el.offsetWidth;
    const h = drag.el.offsetHeight;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const p = clampPos(drag.origLeft + dx, drag.origTop + dy, w, h);
    drag.el.style.left = `${p.x}px`;
    drag.el.style.top = `${p.y}px`;
  }

  function endDrag() {
    if (!drag) return;
    const el = drag.el;
    el.classList.remove('xcf-panel-dragging');
    const rect = el.getBoundingClientRect();
    savePos(rect.left, rect.top);
    drag = null;
  }

  function renderMirrorStatus() {
    const el = panel?.querySelector('[data-xcf-mirror-status]');
    if (!el) return;
    el.textContent = mirrorAttached ? '镜像：监听中' : '镜像：已关闭';
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
        const on = Boolean(res?.isAttached);
        updateMirror({ status: on });
      }
    );
  }

  function openOptionsSection(sectionId) {
    chrome.storage.session.set({ [XCF.SESSION.OPTIONS_MAIN]: sectionId }, () => {
      chrome.runtime.sendMessage({ type: XCF.MSG.OPEN_OPTIONS_PAGE });
    });
  }

  function mount(h) {
    handlers = h;
    if (panel) return panel;

    panel = document.createElement('div');
    panel.className = 'xcf-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'X Suite');

    panel.innerHTML = `
      <div class="xcf-panel-head" data-xcf-drag title="拖动移动">
        <span class="xcf-panel-grip" aria-hidden="true">⋮⋮</span>
        <span class="xcf-panel-title">X Suite</span>
        <div class="xcf-panel-head-actions">
          <button type="button" class="xcf-panel-icon" data-xcf-wide title="放大/配置">□</button>
          <button type="button" class="xcf-panel-icon" data-xcf-collapse title="收起">−</button>
          <button type="button" class="xcf-panel-icon" data-xcf-hide title="隐藏">×</button>
        </div>
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
        <div class="xcf-panel-actions" data-xcf-actions hidden>
          <button type="button" class="xcf-panel-link" data-xcf-open-filter>评论设置</button>
          <button type="button" class="xcf-panel-link" data-xcf-open-library>评论库</button>
          <button type="button" class="xcf-panel-link" data-xcf-open-mirror>镜像设置</button>
        </div>
        <p class="xcf-panel-hint" data-xcf-hint>拖标题移动</p>
      </div>
    `;

    fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'xcf-panel-fab';
    fab.title = '显示 X Suite 面板';
    fab.textContent = 'Suite';
    fab.hidden = true;

    document.body.appendChild(panel);
    document.body.appendChild(fab);

    applyPosition(panel, loadPos());

    const head = panel.querySelector('[data-xcf-drag]');
    head.addEventListener('pointerdown', (e) => {
      if (
        e.target.closest(
          '[data-xcf-collapse],[data-xcf-hide],[data-xcf-wide]'
        )
      ) {
        return;
      }
      startDrag(e, panel);
    });
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    panel.querySelector('[data-xcf-enabled]').addEventListener('change', (e) => {
      handlers?.onEnabledChange?.(e.target.checked);
    });

    panel.querySelector('[data-xcf-mirror]').addEventListener('change', (e) => {
      setMirrorEnabled(e.target.checked);
    });

    panel.querySelector('[data-xcf-wide]').addEventListener('click', (e) => {
      e.stopPropagation();
      const wide = !panel.classList.contains('xcf-panel-wide');
      panel.classList.toggle('xcf-panel-wide', wide);
      panel.querySelector('[data-xcf-wide]').textContent = wide ? '◧' : '□';
      panel.querySelector('[data-xcf-actions]').hidden = !wide;
      handlers?.onPanelUiChange?.({ wide });
    });

    panel.querySelector('[data-xcf-collapse]').addEventListener('click', (e) => {
      e.stopPropagation();
      const collapsed = !panel.classList.contains('xcf-panel-collapsed');
      panel.classList.toggle('xcf-panel-collapsed', collapsed);
      panel.querySelector('[data-xcf-collapse]').textContent = collapsed ? '+' : '−';
      handlers?.onPanelUiChange?.({ collapsed });
    });

    panel.querySelector('[data-xcf-hide]').addEventListener('click', (e) => {
      e.stopPropagation();
      setHidden(true);
      handlers?.onPanelUiChange?.({ hidden: true });
    });

    fab.addEventListener('click', () => {
      setHidden(false);
      handlers?.onPanelUiChange?.({ hidden: false });
    });

    panel
      .querySelector('[data-xcf-open-filter]')
      ?.addEventListener('click', () => openOptionsSection('filter-settings'));
    panel
      .querySelector('[data-xcf-open-library]')
      ?.addEventListener('click', () => openOptionsSection('library'));
    panel
      .querySelector('[data-xcf-open-mirror]')
      ?.addEventListener('click', () => openOptionsSection('mirror'));

    renderMirrorStatus();
    return panel;
  }

  function setHidden(hidden) {
    if (!panel || !fab) return;
    panel.hidden = hidden;
    fab.hidden = !hidden;
  }

  function updateMirror({ status, siteLabel, permissionDenied } = {}) {
    mirrorAttached = Boolean(status);
    const cb = panel?.querySelector('[data-xcf-mirror]');
    if (cb && !mirrorBusy) cb.checked = mirrorAttached;
    if (permissionDenied) {
      const el = panel?.querySelector('[data-xcf-mirror-status]');
      if (el) {
        el.textContent = '镜像：需授权调试权限';
        el.classList.remove('xcf-panel-mirror-on');
      }
      return;
    }
    renderMirrorStatus();
    if (siteLabel && panel) {
      panel.dataset.mirrorSite = siteLabel;
    }
  }

  function applyPanelUi(ui = {}) {
    if (!panel) return;
    panel.classList.toggle('xcf-panel-collapsed', Boolean(ui.collapsed));
    const collapseBtn = panel.querySelector('[data-xcf-collapse]');
    if (collapseBtn) collapseBtn.textContent = ui.collapsed ? '+' : '−';

    const wide = Boolean(ui.wide);
    panel.classList.toggle('xcf-panel-wide', wide);
    const wideBtn = panel.querySelector('[data-xcf-wide]');
    if (wideBtn) wideBtn.textContent = wide ? '◧' : '□';
    const actions = panel.querySelector('[data-xcf-actions]');
    if (actions) actions.hidden = !wide;

    setHidden(Boolean(ui.hidden));
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

    const hint = panel.querySelector('[data-xcf-hint]');
    if (hint) {
      hint.textContent = enabled ? '拖标题移动' : '已暂停';
    }

    applyPanelUi(settings?.panelUi || {});
  }

  function isOwnNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    return Boolean(
      node.classList?.contains('xcf-panel') ||
        node.classList?.contains('xcf-panel-fab') ||
        node.closest?.('.xcf-panel, .xcf-panel-fab') ||
        node.id === 'traffic-copier-root' ||
        node.closest?.('#traffic-copier-root')
    );
  }

  return { mount, update, updateMirror, setHidden, isOwnNode, loadPos, applyPanelUi };
})();
