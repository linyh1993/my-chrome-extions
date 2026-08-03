const $ = (id) => document.getElementById(id);

function mirrorMsg(action, payload = {}) {
  return { domain: 'mirror', action, ...payload };
}

function sendMirror(action, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(mirrorMsg(action, payload), (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
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

  if (status?.ok === false) {
    $('site').textContent = '-';
    $('status').textContent = 'Unavailable';
    setMessage(status.error || 'Service worker unavailable.', 'error');
    return;
  }

  if (!status?.site) {
    $('site').textContent = status?.hostname || 'Not an X tab';
    $('status').textContent = '-';
    setMessage('');
    return;
  }

  $('site').textContent = status.site.label;
  $('status').textContent = status.isAttached
    ? 'Listening'
    : status.isAttaching
      ? 'Attaching'
      : cfg.enabled
        ? 'Starting'
        : 'Off';

  if (status.delivery?.ok === false) {
    setMessage(`Last delivery failed: ${status.delivery.error}`, 'error');
  } else {
    setMessage('');
  }
}

$('enabled').addEventListener('change', () => {
  sendMirror('SET_MIRROR_ENABLED_ACTIVE_TAB', { enabled: $('enabled').checked }).then((res) => {
    if (res?.permissionDenied) setMessage('Debugger permission denied.', 'error');
    else if (res?.ok === false) setMessage(res.error || 'Mirror update failed.', 'error');
    refresh();
  });
});

$('save').addEventListener('click', async () => {
  const mirrorUrl = $('mirror_url').value.trim();
  await MirrorSettings.save({ mirrorUrl });
  setMessage('Saved.', 'success');
  refresh();
});

refresh();
