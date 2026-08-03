const $ = (id) => document.getElementById(id);

function mirrorMsg(action, payload = {}) {
  return { domain: 'mirror', action, ...payload };
}

function sendMirror(action, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(mirrorMsg(action, payload), resolve);
  });
}

function setMessage(text, tone = '') {
  const el = $('message');
  el.textContent = text || '';
  el.className = tone ? `foot is-${tone}` : 'foot';
}

async function refresh() {
  const [cfg, status] = await Promise.all([
    MirrorSettings.load(),
    sendMirror('GET_ACTIVE_TAB_STATUS')
  ]);

  $('enabled').checked = cfg.enabled !== false;
  $('mirror_url').value = cfg.mirrorUrl;

  if (!status?.site) {
    $('site').textContent = status?.hostname || 'Not an X tab';
    $('status').textContent = '-';
    return;
  }

  $('site').textContent = status.site.label;
  $('status').textContent = status.isAttached ? 'Listening' : cfg.enabled ? 'Starting' : 'Off';
}

$('enabled').addEventListener('change', () => {
  sendMirror('SET_MIRROR_ENABLED_ACTIVE_TAB', { enabled: $('enabled').checked }).then(refresh);
});

$('save').addEventListener('click', async () => {
  const mirrorUrl = $('mirror_url').value.trim();
  await MirrorSettings.save({ mirrorUrl });
  setMessage('Saved.', 'success');
  refresh();
});

refresh();
