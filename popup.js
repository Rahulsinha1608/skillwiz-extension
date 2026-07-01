// popup.js

const settings = {
  autoNext: true,
  autoQuiz: true,
  markComplete: true,
  autoScroll: false,
  useChatGPT: false,
  chatGPTApiKey: '',
  randomizeAnswers: false,
};
let isActive = false;
let stepDelay = 1500;

const mainBtn = document.getElementById('mainBtn');
const runOnceBtn = document.getElementById('runOnceBtn');
const statusBadge = document.getElementById('statusBadge');
const warningBox = document.getElementById('warningBox');
const logBox = document.getElementById('logBox');
const delaySlider = document.getElementById('delaySlider');
const delayVal = document.getElementById('delayVal');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const apiKeyInput = document.getElementById('apiKeyInput');

// ── Settings panel toggle ────────────────────────────────
settingsBtn?.addEventListener('click', () => {
  settingsPanel?.classList.toggle('visible');
});

closeSettingsBtn?.addEventListener('click', () => {
  settingsPanel?.classList.remove('visible');
});

// ── API Key input ────────────────────────────────────────
apiKeyInput?.addEventListener('change', () => {
  const key = apiKeyInput.value.trim();
  // Basic validation
  if (key && !key.startsWith('sk-') && key.length < 30) {
    addLog('Warning: API key format looks invalid (should start with sk-)', true);
  }
  settings.chatGPTApiKey = key;
  saveSettings();
  if (key) {
    addLog('ChatGPT API key saved.');
  }
});

// ── Toggle rows ──────────────────────────────────────────
document.querySelectorAll('.toggle-row').forEach((row) => {
  row.addEventListener('click', () => {
    const key = row.dataset.key;
    settings[key] = !settings[key];
    row.classList.toggle('active', settings[key]);
    saveSettings();

    // Update useChatGPT toggle state
    if (key === 'useChatGPT' && settings.useChatGPT && !settings.chatGPTApiKey) {
      addLog('Tip: Add your OpenAI API key in settings for direct API calls', true);
    }
  });
});

// ── Delay slider ─────────────────────────────────────────
delaySlider?.addEventListener('input', () => {
  stepDelay = parseInt(delaySlider.value);
  delayVal.textContent = (stepDelay / 1000).toFixed(1) + 's';
  saveSettings();
});

// ── Logging ──────────────────────────────────────────────
function addLog(msg, isErr = false) {
  const entry = document.createElement('div');
  entry.className = 'entry' + (isErr ? ' err' : '');
  const time = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  entry.textContent = `[${time}] ${msg}`;
  logBox.appendChild(entry);
  logBox.scrollTop = logBox.scrollHeight;
  while (logBox.children.length > 30) logBox.removeChild(logBox.firstChild);
}

// ── Get active tab (with retry logic) ────────────────────
async function getActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs.length > 0 ? tabs[0] : null;
  } catch (e) {
    addLog(`Failed to query tabs: ${e.message}`, true);
    return null;
  }
}

// ── Detect if tab is Skillwiz ────────────────────────────
function isSkillwizTab(tab) {
  if (!tab || !tab.url) return false;
  return /myskillwiz\.com|myskillwiz\.io|myskillwiz\.app/i.test(tab.url);
}

// ── Save / load settings ─────────────────────────────────
function saveSettings() {
  chrome.storage.local.set({
    settings,
    autopilotActive: isActive,
    stepDelay,
  });
}

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['settings', 'autopilotActive', 'stepDelay'], (data) => {
      if (data.settings) {
        Object.assign(settings, data.settings);
        document.querySelectorAll('.toggle-row').forEach((row) => {
          const key = row.dataset.key;
          row.classList.toggle('active', !!settings[key]);
        });
        if (apiKeyInput) apiKeyInput.value = settings.chatGPTApiKey || '';
      }
      if (data.stepDelay) {
        stepDelay = data.stepDelay;
        delaySlider.value = stepDelay;
        delayVal.textContent = (stepDelay / 1000).toFixed(1) + 's';
      }
      if (data.autopilotActive) {
        isActive = true;
        setActiveUI(true);
      }
      resolve();
    });
  });
}

// ── UI state ─────────────────────────────────────────────
function setActiveUI(active) {
  isActive = active;
  if (active) {
    mainBtn.textContent = '⏹ Stop Autopilot';
    mainBtn.className = 'main-btn stop';
    statusBadge.textContent = 'RUNNING';
    statusBadge.className = 'status-badge on';
  } else {
    mainBtn.textContent = '▶ Start Autopilot';
    mainBtn.className = 'main-btn start';
    statusBadge.textContent = 'IDLE';
    statusBadge.className = 'status-badge off';
  }
}

// ── Send message to content script (with retry) ──────────
async function sendToContent(type, extra = {}) {
  const tab = await getActiveTab();
  if (!tab?.id) {
    addLog('Could not get active tab.', true);
    return null;
  }

  const payload = {
    type,
    settings: { ...settings, stepDelay },
    ...extra,
  };

  try {
    addLog(`Sending "${type}" to tab ${tab.id}...`);
    const response = await chrome.tabs.sendMessage(tab.id, payload);
    return response;
  } catch (e) {
    addLog(`Message failed: ${e.message}. Trying again...`, true);

    // Retry once after delay
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const response = await chrome.tabs.sendMessage(tab.id, payload);
      return response;
    } catch (e2) {
      addLog(`Still failed. Ensure content.js is injected and reload Skillwiz tab.`, true);
      return null;
    }
  }
}

// ── Main button ──────────────────────────────────────────
mainBtn.addEventListener('click', async () => {
  const tab = await getActiveTab();

  if (!tab) {
    addLog('No active tab found.', true);
    warningBox.classList.add('visible');
    return;
  }

  if (!isSkillwizTab(tab)) {
    warningBox.classList.add('visible');
    addLog(`Not on Skillwiz. Current URL: ${tab.url?.slice(0, 50)}...`, true);
    return;
  }
  warningBox.classList.remove('visible');

  if (!isActive) {
    const resp = await sendToContent('START_AUTOPILOT');
    if (resp?.status === 'started') {
      setActiveUI(true);
      saveSettings();
      addLog('✓ Autopilot started');
    } else if (resp?.error) {
      addLog(`Failed: ${resp.error}`, true);
    } else {
      addLog('Failed to start. Check console for errors.', true);
    }
  } else {
    const resp = await sendToContent('STOP_AUTOPILOT');
    if (resp?.status === 'stopped') {
      setActiveUI(false);
      saveSettings();
      addLog('Autopilot stopped.');
    }
  }
});

// ── Run once ─────────────────────────────────────────────
runOnceBtn.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab) {
    addLog('No active tab found.', true);
    return;
  }
  if (!isSkillwizTab(tab)) {
    warningBox.classList.add('visible');
    addLog('Not on Skillwiz page.', true);
    return;
  }
  warningBox.classList.remove('visible');

  const resp = await sendToContent('RUN_ONCE');
  if (resp?.status === 'ran_once') {
    addLog('Ran once on current page.');
  } else {
    addLog('Failed to run once.', true);
  }
});

// ── Init ─────────────────────────────────────────────────
(async () => {
  await loadSettings();
  const tab = await getActiveTab();

  addLog(`Current tab: ${tab?.url?.slice(0, 50) || 'Unknown'}...`);

  if (!tab || !isSkillwizTab(tab)) {
    warningBox.classList.add('visible');
  } else {
    addLog('✓ On Skillwiz page');
  }
})();