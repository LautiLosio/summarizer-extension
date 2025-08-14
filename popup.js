const CONFIG_KEY = 'sts_config';

const minWordsInput = document.getElementById('minWords');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');

function load() {
  if (chrome?.storage?.sync) {
    chrome.storage.sync.get([CONFIG_KEY], (res) => {
      const cfg = res?.[CONFIG_KEY];
      if (cfg && typeof cfg.minWords === 'number') {
        minWordsInput.value = String(cfg.minWords);
      }
    });
  }
}

function save() {
  const minWords = Math.max(1, Number(minWordsInput.value || 40));
  const cfg = { minWords };
  if (chrome?.storage?.sync) {
    chrome.storage.sync.set({ [CONFIG_KEY]: cfg }, () => {
      statusEl.textContent = 'Saved!';
      setTimeout(() => (statusEl.textContent = ''), 1200);
    });
  }
}

saveBtn.addEventListener('click', save);

document.addEventListener('DOMContentLoaded', load);