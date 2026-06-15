const form = document.getElementById('opts-form');
const mirrorUrlInput = document.getElementById('mirror-url');
const sitesList = document.getElementById('sites-list');
const siteTemplate = document.getElementById('site-row-template');
const statusEl = document.getElementById('opts-status');

function listToText(list) {
  return (list || []).join('\n');
}

function readSiteRow(row) {
  return {
    enabled: row.querySelector('.site-enabled').checked,
    label: row.querySelector('.site-label').value.trim(),
    id: row.querySelector('.site-id').value.trim(),
    hosts: RelayConfig.linesToList(row.querySelector('.site-hosts').value),
    pathIncludes: RelayConfig.linesToList(row.querySelector('.site-paths').value)
  };
}

function bindSiteRow(row) {
  const labelInput = row.querySelector('.site-label');
  const idInput = row.querySelector('.site-id');
  const title = row.querySelector('.site-title');

  function syncTitle() {
    title.textContent = labelInput.value.trim() || '未命名站点';
  }

  labelInput.addEventListener('input', () => {
    syncTitle();
    if (!idInput.dataset.touched) {
      idInput.value = RelayConfig.normalizeSite({ label: labelInput.value }, 0).id;
    }
  });

  idInput.addEventListener('input', () => {
    idInput.dataset.touched = '1';
  });

  row.querySelector('.site-remove').addEventListener('click', () => {
    row.remove();
  });

  syncTitle();
}

function addSiteRow(site = {}) {
  const fragment = siteTemplate.content.cloneNode(true);
  const row = fragment.querySelector('.site-row');
  row.querySelector('.site-enabled').checked = site.enabled !== false;
  row.querySelector('.site-label').value = site.label || '';
  row.querySelector('.site-id').value = site.id || '';
  row.querySelector('.site-hosts').value = listToText(site.hosts);
  row.querySelector('.site-paths').value = listToText(site.pathIncludes);
  bindSiteRow(row);
  sitesList.appendChild(fragment);
}

document.getElementById('add-site').addEventListener('click', () => {
  addSiteRow({ label: '', id: '', hosts: [], pathIncludes: [] });
});

RelayConfig.load((config) => {
  mirrorUrlInput.value = config.mirrorUrl || '';
  sitesList.replaceChildren();
  config.sites.forEach((site) => addSiteRow(site));
});

form.addEventListener('submit', (event) => {
  event.preventDefault();

  const sites = [...sitesList.querySelectorAll('.site-row')].map(readSiteRow);

  RelayConfig.save(
    {
      mirrorUrl: mirrorUrlInput.value.trim(),
      sites
    },
    () => {
      statusEl.hidden = false;
      setTimeout(() => {
        statusEl.hidden = true;
      }, 2000);
    }
  );
});
