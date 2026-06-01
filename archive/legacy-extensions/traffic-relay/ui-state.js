const UI_STATE_KEY = 'copierUiState';

function loadUiState(callback) {
  chrome.storage.local.get(UI_STATE_KEY, (data) => {
    callback(data[UI_STATE_KEY] || { mode: 'expanded' });
  });
}

function saveUiState(state, callback) {
  chrome.storage.local.set({ [UI_STATE_KEY]: state }, callback);
}
