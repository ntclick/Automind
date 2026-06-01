// AutoMind – Popup
// Translate (default) + Overview (quota + settings link)

const STATE_KEY = 'translateState';
const MAX_CHARS = 2000;

// Caption history storage
let captionHistory = []; // Array of { time: string, original: string, translated: string }
let captionHistoryVisible = false;

// Track current active tab ID synchronously to preserve user gesture context
let currentActiveTabId = null;
window.currentCapturedMicTabId = null;

document.addEventListener('DOMContentLoaded', () => {
  // Mark body when running in detached window so .popout-btn hides
  if (new URLSearchParams(location.search).get('detached') === '1') {
    document.body.classList.add('detached');
  }

  // Explicitly set window type context for side panel
  document.body.classList.add('in-sidepanel');
  document.body.classList.remove('in-popup');

  setupTabs();
  
  // Initialize active tab ID synchronously on load using lastFocusedWindow to avoid popup window empty tabs issue
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, ([tab]) => {
    if (tab) {
      currentActiveTabId = tab.id;
      console.log('🎙️ [Sidepanel] Initialized active tab ID:', currentActiveTabId);
    }
  });

  // Keep track of active tab ID on tab switches to maintain synchronous user gesture reference
  chrome.tabs.onActivated.addListener((activeInfo) => {
    currentActiveTabId = activeInfo.tabId;
    console.log('🎙️ [Sidepanel] Active tab changed (activated):', currentActiveTabId);
  });

  // Keep track of active tab on window focus changes
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    chrome.tabs.query({ active: true, windowId: windowId }, ([tab]) => {
      if (tab) {
        currentActiveTabId = tab.id;
        console.log('🎙️ [Sidepanel] Active tab changed (window focus):', currentActiveTabId);
      }
    });
  });

  // Keep track of active tab on tab reloads/updates
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab.active) {
      currentActiveTabId = tabId;
    }
  });
  


  bindListeners();
  restoreTranslationState();
  loadQuota();
  loadProvider();
  updateCharCount();
  syncLiveStatus();
  
  // Load saved caption history
  loadCaptionHistoryFromStorage();

  // Keep settings in sync between Side Panel, Popup, and Options page
  chrome.storage.onChanged.addListener((changes) => {
    for (const [key, change] of Object.entries(changes)) {
      const newVal = change.newValue;
      if (newVal === undefined) continue;
      
      if (key === 'ltAsrEngine') {
        const asrEngineElement = document.getElementById('ltAsrEngine');
        if (asrEngineElement && asrEngineElement.value !== newVal) {
          asrEngineElement.value = newVal;
        }
        const newMode = newVal === 'webSpeech' ? 'microphone' : 'tabCapture';
        if (typeof switchLtMode === 'function') {
          switchLtMode(newMode);
        }
      } else if (key === 'isCapturing') {
        if (typeof setLiveStatus === 'function') {
          setLiveStatus(!!newVal);
        }
      } else if (key === 'activeTabId') {
        if (newVal) window.currentCapturedTabId = newVal;
      } else {
        const el = document.getElementById(key);
        if (el) {
          if (el.value !== newVal) {
            el.value = newVal;
          }
        } else if (key === 'ltTtsEnabled') {
          const toggle = document.getElementById('ltTtsToggle');
          if (toggle && toggle.checked !== !!newVal) {
            toggle.checked = !!newVal;
          }
        } else if (key === 'ltMuteTab') {
          const toggle = document.getElementById('ltMuteTabToggle');
          if (toggle && toggle.checked !== !!newVal) {
            toggle.checked = !!newVal;
          }
        }
      }
    }
  });
});

function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`${target}-panel`).classList.add('active');
    });
  });
}

function bindListeners() {
  document.getElementById('openOptions').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Pop out into a standalone window so it doesn't auto-close on focus loss
  const popOut = document.getElementById('popOutBtn');
  if (popOut) {
    popOut.addEventListener('click', async () => {
      const url = chrome.runtime.getURL('shared/popup.html') + '?detached=1';
      try {
        await chrome.windows.create({
          url,
          type: 'popup',
          width: 400,
          height: 640,
          focused: true
        });
        window.close();
      } catch (err) {
        console.error('Failed to open detached window:', err);
      }
    });
  }

  // Click side panel button to pin into Side Panel
  const pinSidePanel = document.getElementById('pinSidePanelBtn');
  if (pinSidePanel) {
    pinSidePanel.addEventListener('click', openSidePanel);
  }

  // Make brand logo & header clickable to pin into Side Panel
  const brand = document.querySelector('.brand');
  if (brand) {
    brand.style.cursor = 'pointer';
    brand.title = 'Pin to Chrome Side Panel (Persistent)';
    brand.addEventListener('click', openSidePanel);
  }

  document.getElementById('translateBtn').addEventListener('click', handleTranslate);
  document.getElementById('clearTranslate').addEventListener('click', clearTranslate);
  document.getElementById('copyTranslation').addEventListener('click', copyTranslation);
  document.getElementById('swapLangs').addEventListener('click', swapLanguages);

  // Submit on Cmd/Ctrl+Enter
  document.getElementById('translateInput').addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleTranslate();
    }
  });

  // Persist + char count
  const persist = () => { saveTranslationState(); updateCharCount(); };
  document.getElementById('translateInput').addEventListener('input', persist);
  document.getElementById('srcLang').addEventListener('change', saveTranslationState);
  document.getElementById('tgtLang').addEventListener('change', saveTranslationState);

  // Live translation bindings
  document.getElementById('ltModeMic').addEventListener('click', () => switchLtMode('microphone'));
  document.getElementById('ltModeTab').addEventListener('click', () => switchLtMode('tabCapture'));
  document.getElementById('toggleLiveBtn').addEventListener('click', toggleLiveTranslation);
  document.getElementById('clearLiveCaptions').addEventListener('click', clearLiveCaptions);
  document.getElementById('openSidePanelBtn').addEventListener('click', openSidePanel);

  // Caption history buttons
  document.getElementById('toggleCaptionHistory').addEventListener('click', toggleCaptionHistory);
  document.getElementById('copyAllCaptions').addEventListener('click', copyAllCaptions);
  document.getElementById('exportCaptionsTxt').addEventListener('click', exportCaptionsTxt);

  document.getElementById('ltTopic').addEventListener('change', async () => {
    await chrome.storage.local.set({ ltTopic: document.getElementById('ltTopic').value });
  });

  document.getElementById('ltSourceLang').addEventListener('change', async () => {
    await chrome.storage.local.set({ ltSourceLang: document.getElementById('ltSourceLang').value });
  });

  document.getElementById('ltTgtLang').addEventListener('change', async () => {
    await chrome.storage.local.set({ ltTgtLang: document.getElementById('ltTgtLang').value });
  });

  document.getElementById('ltEngine').addEventListener('change', async () => {
    await chrome.storage.local.set({ ltEngine: document.getElementById('ltEngine').value });
  });

  document.getElementById('ltAsrEngine').addEventListener('change', async () => {
    const val = document.getElementById('ltAsrEngine').value;
    await chrome.storage.sync.set({ ltAsrEngine: val });
    const newMode = val === 'webSpeech' ? 'microphone' : 'tabCapture';
    switchLtMode(newMode);
    
    // Sync the popup mode selector button display state
    const popupModeMic = document.getElementById('popupModeMic');
    const popupModeTab = document.getElementById('popupModeTab');
    if (popupModeMic && popupModeTab) {
      if (newMode === 'microphone') {
        popupModeMic.style.borderColor = 'var(--primary)';
        popupModeMic.style.background = 'var(--primary-soft)';
        popupModeMic.style.color = 'var(--text)';
        popupModeMic.style.display = 'flex';
        popupModeTab.style.borderColor = 'var(--border)';
        popupModeTab.style.background = 'transparent';
        popupModeTab.style.color = 'var(--text-muted)';
        popupModeTab.style.display = 'none';
      } else {
        popupModeTab.style.borderColor = 'var(--primary)';
        popupModeTab.style.background = 'var(--primary-soft)';
        popupModeTab.style.color = 'var(--text)';
        popupModeTab.style.display = 'flex';
        popupModeMic.style.borderColor = 'var(--border)';
        popupModeMic.style.background = 'transparent';
        popupModeMic.style.color = 'var(--text-muted)';
        popupModeMic.style.display = 'none';
      }
    }
  });

  document.getElementById('ltSegmentPreset').addEventListener('change', async () => {
    await chrome.storage.local.set({ ltSegmentPreset: document.getElementById('ltSegmentPreset').value });
  });

  const scrollLockBtn = document.getElementById('toggleScrollLock');
  if (scrollLockBtn) {
    scrollLockBtn.addEventListener('click', () => {
      scrollLocked = !scrollLocked;
      const icon = document.getElementById('scrollLockIcon');
      if (scrollLocked) {
        scrollLockBtn.title = 'Unlock Scroll';
        scrollLockBtn.style.color = 'var(--danger)';
        scrollLockBtn.style.background = 'rgba(239, 68, 68, 0.08)';
        icon.innerHTML = `
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        `;
        toast('warning', 'Scroll locked. New captions will not auto-scroll.');
      } else {
        scrollLockBtn.title = 'Scroll Lock';
        scrollLockBtn.style.color = '';
        scrollLockBtn.style.background = '';
        icon.innerHTML = `
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
        `;
        toast('success', 'Scroll unlocked.');
        const container = document.getElementById('liveSubtitleContainer');
        if (container) container.scrollTop = container.scrollHeight;
      }
    });
  }

  document.getElementById('ltTtsToggle').addEventListener('change', async () => {
    const enabled = document.getElementById('ltTtsToggle').checked;
    await chrome.storage.local.set({ ltTtsEnabled: enabled });
    
    if (!enabled) {
      try { chrome.tts.stop(); } catch (_) {}
    }
  });


}

// ─── Translation state persistence ───────────────────────────────────────

async function saveTranslationState() {
  await chrome.storage.local.set({
    [STATE_KEY]: {
      input:   document.getElementById('translateInput').value,
      output:  document.getElementById('translateOutput').textContent,
      srcLang: document.getElementById('srcLang').value,
      tgtLang: document.getElementById('tgtLang').value
    }
  });
}

async function restoreTranslationState() {
  const { [STATE_KEY]: state } = await chrome.storage.local.get(STATE_KEY);
  
  const srcEl = document.getElementById('srcLang');
  const tgtEl = document.getElementById('tgtLang');
  
  if (state) {
    if (state.input) document.getElementById('translateInput').value = state.input;
    
    // Smart migration of old default state to new English-first defaults
    let src = state.srcLang || 'English';
    let tgt = state.tgtLang || 'English';
    if (src === 'Vietnamese' && tgt === 'English') {
      src = 'English';
      tgt = 'English';
      // Save migrated state immediately
      chrome.storage.local.set({
        [STATE_KEY]: {
          ...state,
          srcLang: 'English',
          tgtLang: 'English'
        }
      }).catch(() => {});
    }
    
    srcEl.value = src;
    tgtEl.value = tgt;
    if (state.output) {
      document.getElementById('translateOutput').textContent = state.output;
      document.getElementById('translateResult').classList.remove('hidden');
    }
  } else {
    srcEl.value = 'English';
    tgtEl.value = 'English';
    await saveTranslationState();
  }
  updateCharCount();
}

// ─── Translate ───────────────────────────────────────────────────────────

async function handleTranslate() {
  const text = document.getElementById('translateInput').value.trim();
  if (!text) {
    toast('warning', 'Please enter text to translate');
    document.getElementById('translateInput').focus();
    return;
  }

  const from = document.getElementById('srcLang').value;
  const to   = document.getElementById('tgtLang').value;

  const btn     = document.getElementById('translateBtn');
  const btnText = document.getElementById('translateBtnText');
  const btnIcon = btn.querySelector('svg');

  btn.disabled = true;
  btnText.textContent = 'Translating...';
  btnIcon.outerHTML = '<div class="spinner"></div>';

  try {
    const response = await sendMessage({ action: 'translate', text, from, to });

    if (response?.success) {
      document.getElementById('translateOutput').textContent = response.translated;
      document.getElementById('translateResult').classList.remove('hidden');
      await saveTranslationState();
      if (response.quota) updateQuotaDisplay(response.quota);
    } else {
      toast('error', response?.error || 'Translation failed');
      if (response?.quota) updateQuotaDisplay(response.quota);
    }
  } catch (err) {
    toast('error', err.message);
  } finally {
    btn.disabled = false;
    btnText.textContent = 'Translate';
    // Restore checkmark icon
    const spinner = btn.querySelector('.spinner');
    if (spinner) {
      spinner.outerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    }
  }
}

function clearTranslate() {
  document.getElementById('translateInput').value = '';
  document.getElementById('translateOutput').textContent = '';
  document.getElementById('translateResult').classList.add('hidden');
  saveTranslationState();
  updateCharCount();
  document.getElementById('translateInput').focus();
}

function copyTranslation() {
  const text = document.getElementById('translateOutput').textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyTranslation');
    btn.classList.add('copied');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    toast('success', 'Copied!');
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    }, 1500);
  }).catch(() => toast('error', 'Copy failed'));
}

function swapLanguages() {
  const src = document.getElementById('srcLang');
  const tgt = document.getElementById('tgtLang');
  [src.value, tgt.value] = [tgt.value, src.value];

  const inputEl  = document.getElementById('translateInput');
  const outputEl = document.getElementById('translateOutput');
  const oldInput = inputEl.value;
  const oldOutput = outputEl.textContent;
  if (oldOutput) {
    inputEl.value = oldOutput;
    outputEl.textContent = oldInput;
    updateCharCount();
  }
  saveTranslationState();
}

function updateCharCount() {
  const len = document.getElementById('translateInput').value.length;
  document.getElementById('charCount').textContent = `${len} / ${MAX_CHARS}`;
}

// ─── Quota / Provider ────────────────────────────────────────────────────

async function loadQuota() {
  try {
    // Detect if user has their own key (then unlimited)
    const { apiProvider, openaiApiKey, claudeApiKey, geminiApiKey, kimiApiKey, deepseekApiKey, nvidiaApiKey } =
      await chrome.storage.sync.get(['apiProvider', 'openaiApiKey', 'claudeApiKey', 'geminiApiKey', 'kimiApiKey', 'deepseekApiKey', 'nvidiaApiKey']);
    const provider = apiProvider || 'kimi';
    const userKeyMap = { openai: openaiApiKey, claude: claudeApiKey, gemini: geminiApiKey, kimi: kimiApiKey, deepseek: deepseekApiKey, nvidia: nvidiaApiKey };
    const hasOwnKey = !!(userKeyMap[provider] || '').trim();

    if (hasOwnKey) {
      renderUnlimited();
      return;
    }

    const response = await sendMessage({ action: 'getQuota' });
    if (response?.success && response.quota) updateQuotaDisplay(response.quota);
  } catch (_) { /* ignore */ }
}

function renderUnlimited() {
  document.getElementById('quotaPillText').textContent = '∞';
  const pill = document.getElementById('quotaPill');
  pill.classList.remove('low', 'empty');
  pill.title = 'Using your own API key — unlimited';

  document.getElementById('dailyUsage').textContent = '∞';
  document.getElementById('quotaSub').textContent = 'Unlimited (using your own key)';
  const fill = document.getElementById('quotaFill');
  fill.style.width = '100%';
  fill.classList.remove('low', 'empty');
  document.getElementById('resetTime').textContent = '—';
}

function updateQuotaDisplay(quota) {
  const used  = quota.used  || 0;
  const limit = quota.limit || 50;
  const remaining = limit - used;
  const percent = Math.min(100, (used / limit) * 100);

  // Header pill
  document.getElementById('quotaPillText').textContent = `${remaining}/${limit}`;
  const pill = document.getElementById('quotaPill');
  pill.classList.remove('low', 'empty');
  if (remaining === 0) pill.classList.add('empty');
  else if (remaining <= 10) pill.classList.add('low');

  // Overview tab
  document.getElementById('dailyUsage').textContent = `${used} / ${limit}`;
  document.getElementById('quotaSub').textContent =
    remaining === 0 ? 'Out of free uses — resets at 0h UTC' : `${remaining} free uses left`;

  const fill = document.getElementById('quotaFill');
  fill.style.width = `${percent}%`;
  fill.classList.remove('low', 'empty');
  if (remaining === 0) fill.classList.add('empty');
  else if (remaining <= 10) fill.classList.add('low');

  if (quota.resetAt) {
    const d = new Date(quota.resetAt);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    document.getElementById('resetTime').textContent = `${hh}:${mm} UTC`;
  }
}

async function loadProvider() {
  try {
    const settings = await new Promise((resolve) => {
      chrome.storage.sync.get(['aiMode', 'apiProvider', 'selectedModel'], resolve);
    });
    const aiMode = settings.aiMode || 'system';
    const provider = settings.apiProvider || 'openai';
    const model = settings.selectedModel || (provider === 'openai' ? 'gpt-4o-mini' : 'default');
    const modeLabel = aiMode === 'custom' ? 'Custom Key' : 'Default Quota';
    
    const labels = {
      openai: 'OpenAI',
      claude: 'Claude',
      gemini: 'Gemini',
      kimi: 'Kimi',
      deepseek: 'DeepSeek',
      local: 'Local AI'
    };
    const providerName = labels[provider] || provider;
    document.getElementById('aiProvider').textContent = `${providerName} (${model}) [${modeLabel}]`;
  } catch (_) { /* ignore */ }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function sendMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, response => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

let toastTimer;
function toast(type, message) {
  const el = document.getElementById('toast');
  if (!el) return;
  clearTimeout(toastTimer);
  const icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
  };
  el.className = `toast ${type}`;
  el.innerHTML = `${icons[type] || ''}<span>${message}</span>`;
  requestAnimationFrame(() => el.classList.add('show'));
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// ==========================================
// 🎙️ LIVE TRANSLATOR: Event Handlers & State
// ==========================================

let ltMode = 'tabCapture';
let ltListening = false;
let scrollLocked = false;

async function syncLiveStatus(retries = 3) {
  try {
    const result = await chrome.storage.local.get(['ltSourceLang', 'ltTgtLang', 'ltMode', 'ltEngine', 'ltTtsEnabled', 'ltMuteTab', 'ltSegmentPreset', 'ltTopic', 'isCapturing', 'activeTabId']);
    
    // Set default languages: source = auto-detect, target = Vietnamese
    const sourceLang = result.ltSourceLang || 'auto';
    const targetLang = result.ltTgtLang || 'vi';
    
    document.getElementById('ltSourceLang').value = sourceLang;
    document.getElementById('ltTgtLang').value = targetLang;
    
    if (!result.ltSourceLang) chrome.storage.local.set({ ltSourceLang: 'auto' });
    if (!result.ltTgtLang) chrome.storage.local.set({ ltTgtLang: 'vi' });

    const activeTopic = result.ltTopic || 'general';
    document.getElementById('ltTopic').value = activeTopic;
    if (!result.ltTopic) chrome.storage.local.set({ ltTopic: 'general' });

    if (result.ltEngine) document.getElementById('ltEngine').value = result.ltEngine;
    if (result.ltSegmentPreset) document.getElementById('ltSegmentPreset').value = result.ltSegmentPreset;

    // Sync popup-only mode buttons based on ASR Engine
    const syncRes = await chrome.storage.sync.get('ltAsrEngine');
    const asrEngine = syncRes.ltAsrEngine || 'groq';
    
    const asrEngineElement = document.getElementById('ltAsrEngine');
    if (asrEngineElement) {
      asrEngineElement.value = asrEngine;
    }
    
    const activeMode = 'tabCapture';

    const popupModeMic = document.getElementById('popupModeMic');
    const popupModeTab = document.getElementById('popupModeTab');
    if (popupModeMic) popupModeMic.style.display = 'none';
    if (popupModeTab) {
      popupModeTab.style.borderColor = 'var(--primary)';
      popupModeTab.style.background = 'var(--primary-soft)';
      popupModeTab.style.color = 'var(--text)';
      popupModeTab.style.display = 'flex';
    }
    if (result.ltTtsEnabled !== undefined) document.getElementById('ltTtsToggle').checked = !!result.ltTtsEnabled;
    if (result.ltMuteTab !== undefined) document.getElementById('ltMuteTabToggle').checked = !!result.ltMuteTab;
    switchLtMode(activeMode);

    const bgStatus = await sendMessage({ action: 'lt_get_status' });
    // Also check storage isCapturing as backup — handles race condition where
    // popup triggers openSidePanel() causing sidepanel to reload mid-capture
    const isListening = (bgStatus && bgStatus.status === 'listening') || !!result.isCapturing;
    const capturedTabId = (bgStatus && bgStatus.tabId) || result.activeTabId;

    if (isListening) {
      switchLtMode(activeMode);
      setLiveStatus(true);
      if (capturedTabId) {
        window.currentCapturedTabId = capturedTabId;
        chrome.tabs.get(capturedTabId, (capturedTab) => {
          if (capturedTab && capturedTab.url) {
            window.currentCapturedTabUrl = capturedTab.url;
          }
        });
        chrome.tabs.query({ active: true, currentWindow: true }, ([currentTab]) => {
          if (currentTab && capturedTabId !== currentTab.id) {
            toast('warning', 'Translating background tab. Click Stop to reset.');
          }
        });
      }
    } else {
      setLiveStatus(false);
    }
  } catch (err) {
    console.error('Failed to sync live status:', err);
  }
}

function switchLtMode(mode) {
  ltMode = 'tabCapture';
  chrome.storage.local.set({ ltMode: 'tabCapture' });

  const micBtn = document.getElementById('ltModeMic');
  const tabBtn = document.getElementById('ltModeTab');

  if (micBtn) micBtn.style.display = 'none';
  if (tabBtn) {
    tabBtn.style.cssText = 'flex: 1; border-color: var(--primary); background: var(--primary-soft); color: var(--text); display: flex !important;';
  }
}

async function ensureContentScriptInjected(tabId) {
  try {
    // Check if the content script is already listening
    await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          reject(new Error('Need injection'));
        } else {
          resolve();
        }
      });
    });
    console.log('🎙️ [Popup] Content script is already injected and active.');
  } catch (_) {
    console.log('🎙️ [Popup] Content script not detected. Performing programmatic injection...');
    try {
      // Inject CSS
      await chrome.scripting.insertCSS({
        target: { tabId: tabId },
        files: ['shared/styles.css']
      });
    } catch (e) {
      console.warn('CSS injection warning:', e);
    }

    const files = [
      'shared/language-detector.js',
      'shared/humanization-advanced.js',
      'twitter/messenger.js',
      'twitter/content.js'
    ];
    
    for (const file of files) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: [file]
        });
      } catch (err) {
        console.error(`Failed to inject script ${file}:`, err);
        throw new Error(`Permission required to run on this webpage. Please click the AutoMind extension icon in your Chrome toolbar once to authorize it, or use it on Twitter/X!`);
      }
    }
    console.log('🎙️ [Popup] Programmatic script injection completed successfully.');
  }
}

async function toggleLiveTranslation() {
  const sourceLang = document.getElementById('ltSourceLang').value;
  const targetLang = document.getElementById('ltTgtLang').value;
  const btn = document.getElementById('toggleLiveBtn');
  const btnText = document.getElementById('toggleLiveBtnText');
  const btnIcon = btn.querySelector('svg') || btn.querySelector('.spinner');

  if (!ltListening) {
    // Validate that the user has the required API Key for the selected ASR Speech Engine
    try {
      const syncSettings = await chrome.storage.sync.get(['ltAsrEngine', 'openaiApiKey', 'groqApiKey', 'apiKey']);
      const asrEngine = syncSettings.ltAsrEngine || 'groq';
      if (asrEngine === 'groq') {
        if (!syncSettings.groqApiKey || !syncSettings.groqApiKey.trim()) {
          toast('error', 'Groq API Key is missing. Please add it in settings.');
          return;
        }
      } else if (asrEngine === 'whisper') {
        const whisperKey = syncSettings.openaiApiKey || syncSettings.apiKey;
        if (!whisperKey || !whisperKey.trim()) {
          toast('error', 'OpenAI API Key is missing. Please add it in settings.');
          return;
        }
      }
    } catch (e) {
      console.warn('ASR key validation failed:', e);
    }

    window._captureStartTimestamp = Date.now();
    console.log('🚀 [Latency Benchmark] Start capture initiated at:', window._captureStartTimestamp);
    
    // ─── HYBRID PERSISTENT TAB CAPTURE REDIRECTION ───
    // Synchronously open popup inside click handler to preserve user gesture
    toast('info', 'Opening secure popup to grant audio capture permission...', 3000);
    try {
      chrome.storage.local.set({ autoStartCapture: true });
      chrome.action.openPopup();
    } catch (err) {
      console.warn('chrome.action.openPopup failed:', err);
      showLiveCaptureError(err, null);
      toast('error', 'Cannot capture tab audio directly from Sidebar.');
    }
  } else {
    stopLocalTabCapture();
  }
}

function stopLocalTabCapture() {
  if (window.currentCaptureInterval) {
    clearTimeout(window.currentCaptureInterval);
    window.currentCaptureInterval = null;
  }
  if (window.currentVolumeInterval) {
    clearInterval(window.currentVolumeInterval);
    window.currentVolumeInterval = null;
  }
  if (window.currentMediaRecorder && window.currentMediaRecorder.state !== 'inactive') {
    try { window.currentMediaRecorder.stop(); } catch (_) {}
  }
  window.currentMediaRecorder = null;
  if (window.currentCaptureStream) {
    window.currentCaptureStream.getTracks().forEach(track => track.stop());
    window.currentCaptureStream = null;
  }
  if (window.currentAudioCtx) {
    try { window.currentAudioCtx.close(); } catch (_) {}
    window.currentAudioCtx = null;
  }
  window.currentCapturedTabId = null;
  sendMessage({ action: 'lt_tab_stop', explicit: true }).catch(() => {});
  try { chrome.tts.stop(); } catch (_) {}
  sendMessage({ action: 'lt_stop_tts' }).catch(() => {});
  // Reset Mute Tab state when stopping
  chrome.storage.local.set({ ltMuteTab: false }).catch(() => {});
  try { document.getElementById('ltMuteTabToggle').checked = false; } catch (_) {}
  setLiveStatus(false);
  toast('success', 'Tab capturing stopped.');
}

function cleanupLocalTabCaptureSilently() {
  if (window.currentCaptureInterval) {
    clearTimeout(window.currentCaptureInterval);
    window.currentCaptureInterval = null;
  }
  if (window.currentVolumeInterval) {
    clearInterval(window.currentVolumeInterval);
    window.currentVolumeInterval = null;
  }
  if (window.currentMediaRecorder && window.currentMediaRecorder.state !== 'inactive') {
    try { window.currentMediaRecorder.stop(); } catch (_) {}
  }
  window.currentMediaRecorder = null;
  if (window.currentCaptureStream) {
    window.currentCaptureStream.getTracks().forEach(track => track.stop());
    window.currentCaptureStream = null;
  }
  if (window.currentAudioCtx) {
    try { window.currentAudioCtx.close(); } catch (_) {}
    window.currentAudioCtx = null;
  }
  window.currentCapturedTabId = null;
}

function setLiveStatus(active) {
  ltListening = active;
  const btn = document.getElementById('toggleLiveBtn');
  const btnText = document.getElementById('toggleLiveBtnText');
  const indicator = document.getElementById('liveStatusIndicator');

  const svg = btn.querySelector('svg') || btn.querySelector('.spinner');


  const subtitleArea = document.getElementById('liveSubtitleArea');
  if (subtitleArea) {
    if (active) {
      subtitleArea.classList.add('active');
    } else {
      subtitleArea.classList.remove('active');
    }
  }
  if (active) {
    btn.classList.remove('btn-primary');
    btn.style.background = 'var(--danger)';
    btn.style.color = '#fff';
    btn.style.boxShadow = '0 2px 6px rgba(239, 68, 68, 0.25)';
    btnText.textContent = 'Stop Live Captions';
    if (svg) {
      svg.outerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/></svg>';
    }
    
    indicator.style.background = 'var(--danger)';
    indicator.style.boxShadow = '0 0 8px var(--danger)';
    showPopupListeningIndicator();
  } else {
    btn.classList.add('btn-primary');
    btn.style.background = '';
    btn.style.color = '';
    btn.style.boxShadow = '';
    btnText.textContent = 'Start Live Captions';
    if (svg) {
      svg.outerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    }
    
    indicator.style.background = '#64748b';
    indicator.style.boxShadow = 'none';
    clearPopupListeningIndicator();

    // Clean up microphone muting
    if (window.currentCapturedMicTabId) {
      chrome.tabs.update(window.currentCapturedMicTabId, { muted: false }).catch(() => {});
      window.currentCapturedMicTabId = null;
    }
  }
}

function showPopupListeningIndicator() {
  const container = document.getElementById('liveSubtitleContainer');
  if (container.querySelector('.subtitle-translation') || document.getElementById('popupLiveListeningIndicator')) return;

  const placeholder = container.querySelector('span[style*="italic"]');
  if (placeholder) container.innerHTML = '';

  const div = document.createElement('div');
  div.id = 'popupLiveListeningIndicator';
  div.style.cssText = 'text-align: center; margin-top: 50px; padding: 20px; animation: fadeIn 0.3s ease;';
  div.innerHTML = `
    <div class="pulsing-mic-glow" style="display: inline-flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 50%; background: rgba(99, 102, 241, 0.1); color: var(--primary); margin-bottom: 16px; animation: pulse 2s infinite ease-in-out;">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
      </svg>
    </div>
    <div style="font-weight: 600; color: var(--text); font-size: 14px;">🔊 System capturing tab audio...</div>
    <div style="color: var(--text-muted); font-size: 11px; margin-top: 6px; line-height: 1.4;">
      Play audio or video in the active tab to start live translation.
    </div>
  `;
  container.appendChild(div);
  if (!scrollLocked) container.scrollTop = container.scrollHeight;
}

function clearPopupListeningIndicator() {
  const container = document.getElementById('liveSubtitleContainer');
  const listeningIndicator = document.getElementById('popupLiveListeningIndicator');
  if (listeningIndicator) listeningIndicator.remove();

  if (container.children.length === 0) {
    container.innerHTML = '<span style="color: var(--text-dim); font-style: italic; display: block; text-align: center; margin-top: 10px;">Captions will appear here in real-time...</span>';
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'lt_subtitle') {
    if (!ltListening) {
      setLiveStatus(true);
    }
    appendSubtitleMarkup(message.original, message.translated, message.isUpdate, message.segmentId);
  } else if (message.action === 'lt_processing') {
    if (!ltListening) {
      setLiveStatus(true);
    }
    showPopupProcessingIndicator();
  } else if (message.action === 'lt_status') {
    if (message.status === 'listening') {
      if (window._captureStartTimestamp) {
        console.log(`🚀 [Latency Benchmark] Tab capture to ready: ${Date.now() - window._captureStartTimestamp}ms`);
        window._captureStartTimestamp = null;
      }
      setLiveStatus(true);
    } else if (message.status === 'stopped') {
      window._captureStartTimestamp = null;
      // ─── CRITICAL FIX: Do NOT call stopLocalTabCapture() here! ─────────
      // Background already stopped the capture and broadcast this message.
      // Calling stopLocalTabCapture() would send lt_tab_stop BACK to
      // background, creating a feedback loop that kills capture instantly.
      // We only need to reset popup's own UI state.
      if (ltListening) {
        window.currentCapturedTabId = null;
        try { chrome.tts.stop(); } catch (_) {}
        chrome.storage.local.set({ ltMuteTab: false }).catch(() => {});
        try { document.getElementById('ltMuteTabToggle').checked = false; } catch (_) {}
        setLiveStatus(false);
      }
    }
  } else if (message.action === 'lt_error') {
    window._captureStartTimestamp = null;
    toast('error', message.error);
    // ─── Same fix: only reset local UI, don't send stop back to background ───
    if (ltListening) {
      window.currentCapturedTabId = null;
      try { chrome.tts.stop(); } catch (_) {}
      chrome.storage.local.set({ ltMuteTab: false }).catch(() => {});
      try { document.getElementById('ltMuteTabToggle').checked = false; } catch (_) {}
      setLiveStatus(false);
    }
  } else if (message.action === 'lt_warning') {
    toast('warning', message.error);
  } else if (message.action === 'lt_tab_stop') {
    if (ltListening) {
      window.currentCapturedTabId = null;
      try { chrome.tts.stop(); } catch (_) {}
      chrome.storage.local.set({ ltMuteTab: false }).catch(() => {});
      try { document.getElementById('ltMuteTabToggle').checked = false; } catch (_) {}
      setLiveStatus(false);
      toast('warning', 'Captured tab was closed.');
    }
  } else if (message.action === 'lt_tab_reconnected') {
    setLiveStatus(true);
    toast('success', 'Audio capture reconnected successfully.');
  }
});

function showPopupProcessingIndicator() {
  const container = document.getElementById('liveSubtitleContainer');
  
  // Check if indicator already exists
  let indicator = document.getElementById('popupLiveProcessingIndicator');
  if (!indicator) {
    const listeningIndicator = document.getElementById('popupLiveListeningIndicator');
    if (listeningIndicator) listeningIndicator.remove();

    const placeholder = container.querySelector('span[style*="italic"]');
    if (placeholder) container.innerHTML = '';

    indicator = document.createElement('div');
    indicator.id = 'popupLiveProcessingIndicator';
    indicator.style.cssText = `
      padding: 6px 0;
      color: var(--text-muted);
      font-size: 11px;
      font-style: italic;
      animation: pulse 1.5s infinite ease-in-out;
      display: flex;
      align-items: center;
      gap: 6px;
    `;
    indicator.innerHTML = `
      <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--primary);"></span>
      <span>🔊 Transcribing & translating tab audio...</span>
    `;
    container.appendChild(indicator);
    if (!scrollLocked) container.scrollTop = container.scrollHeight;
  }
}

function isWhisperHallucination(text) {
  if (!text || typeof text !== 'string') return true;
  
  const lowerText = text.trim().toLowerCase();
  
  // 1. Direct substring checks - if it contains these, it's almost certainly a hallucination
  const blockedSubstrings = [
    'i hope you enjoyed this video',
    'hope you enjoyed this video',
    'thank you for watching',
    'thanks for watching',
    'please subscribe to my channel',
    'subscribe to the channel',
    'please subscribe',
    'subtitles by amara',
    'otter.ai',
    'transcribed by',
    'hope you liked this video',
    'be sure to subscribe',
    'thank you so much for watching',
    'thanks so much for watching',
    'cảm ơn các bạn đã xem',
    'cảm ơn đã xem',
    'cảm ơn bạn đã xem',
    'hy vọng bạn thích video này',
    'đăng ký kênh',
    'chúc các bạn một ngày'
  ];
  
  for (const sub of blockedSubstrings) {
    if (lowerText.includes(sub)) return true;
  }
  
  // 2. Normalize and check exact patterns
  // Clean all punctuation, symbols, brackets, and quotes (including smart quotes)
  const clean = lowerText
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
    
  if (clean.length <= 1) return true;
  
  const cleanPatterns = [
    'thank you for watching',
    'thanks for watching',
    'i hope you enjoyed this video',
    'hope you enjoyed this video',
    'please subscribe to my channel',
    'subscribe to the channel',
    'please subscribe',
    'thank you very much',
    'thanks very much',
    'thank you',
    'thanks',
    'goodbye',
    'bye',
    'watch this video',
    'watching this video',
    'subtitles by amara org',
    'otter ai',
    'transcribed by',
    'i hope you liked this video',
    'hope you liked this video',
    'be sure to subscribe',
    'see you next time',
    'see you in the next video',
    'subscribe',
    'thank you so much',
    'cảm ơn các bạn đã xem',
    'cảm ơn đã xem',
    'cảm ơn bạn đã xem',
    'hy vọng bạn thích video này',
    'đăng ký kênh'
  ];
  
  if (cleanPatterns.includes(clean)) return true;
  
  // Filter repetitions of short filler words during silent stream gaps
  const fillers = new Set(['you', 'yeah', 'ok', 'okay', 'yes', 'no', 'ah', 'oh', 'um', 'uh', 'so', 'and', 'but', 'the', 'video']);
  const words = clean.split(' ');
  const onlyFillers = words.every(w => fillers.has(w));
  if (onlyFillers && words.length < 5) return true;
  
  return false;
}

function appendSubtitleMarkup(original, translated, isUpdate, segmentId) {
  // Prevent logging any Whisper silence hallucinations in the popup panel
  if (isWhisperHallucination(original) || isWhisperHallucination(translated)) {
    console.log('🎙️ [Popup] Blocked Whisper hallucination log:', original, '->', translated);
    return;
  }

  const container = document.getElementById('liveSubtitleContainer');
  
  // Remove processing indicator if present
  const indicator = document.getElementById('popupLiveProcessingIndicator');
  if (indicator) indicator.remove();

  // Remove listening indicator if present
  const listeningIndicator = document.getElementById('popupLiveListeningIndicator');
  if (listeningIndicator) listeningIndicator.remove();

  const placeholder = container.querySelector('span[style*="italic"]');
  if (placeholder) container.innerHTML = '';

  const now = new Date();
  const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Check if we should update the last block in-place
  if (isUpdate) {
    // Try to find the exact block by segmentId first to avoid out-of-order race conditions!
    const targetDiv = segmentId ? document.getElementById('sub-' + segmentId) : null;
    const lastDiv = targetDiv || container.lastElementChild;
    
    // Verify it is a valid subtitle block (has two children)
    if (lastDiv && lastDiv.children.length === 2) {
      const translationText = lastDiv.children[0];
      const originalText = lastDiv.children[1];
      
      if (translated === 'Translating...') {
        translationText.style.color = 'var(--text-dim)';
        translationText.style.fontStyle = 'italic';
        translationText.textContent = '⚡ Translating...';
        originalText.textContent = original;
      } else if (typeof translated === 'string' && translated.startsWith('🎙️')) {
        translationText.style.color = 'var(--text-dim)';
        translationText.style.fontStyle = 'italic';
        translationText.textContent = translated;
        originalText.textContent = original;
      } else {
        translationText.style.color = '#ffd043';
        translationText.style.fontStyle = 'normal';
        translationText.textContent = translated;
        originalText.textContent = original;
      }

      // Update last history entry in-place
      if (captionHistory.length > 0 && translated !== 'Translating...') {
        captionHistory[captionHistory.length - 1].original = original;
        captionHistory[captionHistory.length - 1].translated = translated;
        if (captionHistoryVisible) renderHistoryPanel();
        saveCaptionHistoryToStorage();
      }
      
      if (!scrollLocked) container.scrollTop = container.scrollHeight;
      return;
    }
  }

  // Push to history (only finalized captions, not "Translating...")
  if (translated !== 'Translating...') {
    captionHistory.push({ time: timeStr, original: original, translated: translated });
    updateHistoryBadge();
    if (captionHistoryVisible) renderHistoryPanel();
    saveCaptionHistoryToStorage();
  } else {
    // Still push a placeholder so in-place updates work
    captionHistory.push({ time: timeStr, original: original, translated: '' });
    saveCaptionHistoryToStorage();
  }

  // Create a new block if not updating or no previous block exists
  const div = document.createElement('div');
  if (segmentId) {
    div.id = 'sub-' + segmentId;
  }
  div.style.cssText = `
    padding: 6px 0;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    animation: fadeIn 0.2s ease;
  `;

  const translationText = document.createElement('div');
  translationText.style.cssText = 'font-weight: 600; margin-bottom: 2px;';
  
  const originalText = document.createElement('div');
  originalText.style.cssText = 'color: var(--text-muted); font-size: 11px;';

  if (translated === 'Translating...') {
    translationText.style.color = 'var(--text-dim)';
    translationText.style.fontStyle = 'italic';
    translationText.textContent = '⚡ Translating...';
    originalText.textContent = original;
  } else if (typeof translated === 'string' && translated.startsWith('🎙️')) {
    translationText.style.color = 'var(--text-dim)';
    translationText.style.fontStyle = 'italic';
    translationText.textContent = translated;
    originalText.textContent = original;
  } else {
    translationText.style.color = '#ffd043';
    translationText.style.fontStyle = 'normal';
    translationText.textContent = translated;
    originalText.textContent = original;
  }

  div.appendChild(translationText);
  div.appendChild(originalText);
  container.appendChild(div);

  if (!scrollLocked) container.scrollTop = container.scrollHeight;
}

function clearLiveCaptions() {
  const container = document.getElementById('liveSubtitleContainer');
  container.innerHTML = '<span style="color: var(--text-dim); font-style: italic; display: block; text-align: center; margin-top: 10px;">Captions will appear here in real-time...</span>';
  captionHistory = [];
  updateHistoryBadge();
  if (captionHistoryVisible) renderHistoryPanel();
  chrome.storage.local.remove('captionHistory').catch(() => {});
  sendMessage({ action: 'lt_clear_session' }).catch(() => {});
}

// ─── Caption History Functions ──────────────────────────────────────────────

function toggleCaptionHistory() {
  captionHistoryVisible = !captionHistoryVisible;
  const panel = document.getElementById('captionHistoryPanel');
  const btn = document.getElementById('toggleCaptionHistory');
  
  if (captionHistoryVisible) {
    panel.style.display = 'block';
    btn.style.background = 'var(--primary-soft)';
    btn.style.color = 'var(--primary)';
    renderHistoryPanel();
  } else {
    panel.style.display = 'none';
    btn.style.background = '';
    btn.style.color = '';
  }
}

function renderHistoryPanel() {
  const list = document.getElementById('captionHistoryList');
  const countEl = document.getElementById('historyCount');
  
  // Filter out entries that have no translation yet (still "Translating...")
  const finalized = captionHistory.filter(c => c.translated && c.translated.length > 0);
  countEl.textContent = finalized.length + ' lines';
  
  if (finalized.length === 0) {
    list.innerHTML = '<div style="text-align:center; color:var(--text-dim); font-style:italic; padding: 16px 0;">No subtitles recorded yet.</div>';
    return;
  }
  
  list.innerHTML = finalized.map((c, i) => `
    <div style="padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.03); ${i === finalized.length - 1 ? 'border-bottom:none;' : ''}">
      <div style="display: flex; align-items: baseline; gap: 6px; margin-bottom: 1px;">
        <span style="font-size: 9px; color: var(--text-dim); font-family: monospace; flex-shrink:0;">${c.time}</span>
        <span style="color: #ffd043; font-weight: 600; font-size: 12px;">${escapeHtml(c.translated)}</span>
      </div>
      <div style="padding-left: 52px; color: var(--text-muted); font-size: 10.5px;">${escapeHtml(c.original)}</div>
    </div>
  `).join('');
  
  // Auto-scroll to bottom
  list.scrollTop = list.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updateHistoryBadge() {
  const badge = document.getElementById('historyBadge');
  const finalized = captionHistory.filter(c => c.translated && c.translated.length > 0);
  if (finalized.length > 0) {
    badge.style.display = 'block';
    badge.textContent = finalized.length > 99 ? '99+' : finalized.length;
  } else {
    badge.style.display = 'none';
  }
}

function copyAllCaptions() {
  const finalized = captionHistory.filter(c => c.translated && c.translated.length > 0);
  if (finalized.length === 0) {
    toast('warning', 'No subtitles to copy.');
    return;
  }
  
  const text = finalized.map(c => `[${c.time}] ${c.translated}\n         ${c.original}`).join('\n\n');
  navigator.clipboard.writeText(text).then(() => {
    toast('success', `Copied ${finalized.length} lines of captions!`);
    // Flash the copy button
    const btn = document.getElementById('copyAllCaptions');
    btn.style.color = 'var(--success)';
    setTimeout(() => { btn.style.color = ''; }, 1500);
  }).catch(() => {
    toast('error', 'Copy failed. Try again.');
  });
}

function exportCaptionsTxt() {
  const finalized = captionHistory.filter(c => c.translated && c.translated.length > 0);
  if (finalized.length === 0) {
    toast('warning', 'No subtitles to export.');
    return;
  }
  
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }).replace(':', '-');
  const filename = `AutoMind_Captions_${dateStr}_${timeStr}.txt`;
  
  let content = `AutoMind Live Captions - Exported ${now.toLocaleString('en-US')}\n`;
  content += `${'═'.repeat(60)}\n\n`;
  
  finalized.forEach((c, i) => {
    content += `[${c.time}] 🔤 ${c.translated}\n`;
    content += `${' '.repeat(c.time.length + 3)}🔊 ${c.original}\n`;
    if (i < finalized.length - 1) content += '\n';
  });
  
  content += `\n${'═'.repeat(60)}\n`;
  content += `Total: ${finalized.length} lines of captions | Powered by AutoMind\n`;
  
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  
  toast('success', `Exported ${finalized.length} lines → ${filename}`);
}

async function openSidePanel() {
  try {
    const currentWindow = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: currentWindow.id });
    if (window.close && typeof window.close === 'function') {
      window.close();
    }
  } catch (err) {
    console.error('Failed to open side panel:', err);
    toast('error', 'Could not open side panel. Try opening it manually from Chrome menu.');
  }
}

// Tab switching listener commented out so the Side Panel continues translating 
// background tab audio even when the user switches to other tabs!
/*
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (ltListening && ltMode === 'tabCapture' && window.currentCapturedTabId) {
    if (window.currentCapturedTabId !== activeInfo.tabId) {
      console.log('🔄 [Tab Switch] Active tab changed. Stopping background tab audio capture.');
      stopLocalTabCapture();
      toast('warning', 'Stopped capturing background tab.');
    }
  }
});
*/

// Tab update listener removed to prevent SPA/livestream dynamic URL changes 
// (e.g. video player timestamp query/hash updates) from stopping capture.
// offscreen.js track.onended handles complete tab navigations/reloads perfectly!

async function loadCaptionHistoryFromStorage() {
  try {
    const result = await chrome.storage.local.get('captionHistory');
    if (result.captionHistory && Array.isArray(result.captionHistory)) {
      captionHistory = result.captionHistory;
      updateHistoryBadge();
      
      // Render stored history into the main liveSubtitleContainer on startup
      const container = document.getElementById('liveSubtitleContainer');
      if (captionHistory.length > 0) {
        container.innerHTML = '';
        captionHistory.forEach(c => {
          const div = document.createElement('div');
          div.style.cssText = `
            padding: 6px 0;
            border-bottom: 1px solid rgba(255,255,255,0.04);
          `;
          const translationText = document.createElement('div');
          translationText.style.cssText = 'font-weight: 600; margin-bottom: 2px;';
          const originalText = document.createElement('div');
          originalText.style.cssText = 'color: var(--text-muted); font-size: 11px;';
          if (c.translated === 'Translating...') {
            translationText.style.color = 'var(--text-dim)';
            translationText.style.fontStyle = 'italic';
            translationText.textContent = '⚡ Translating...';
            originalText.textContent = c.original;
          } else {
            translationText.style.color = '#ffd043';
            translationText.style.fontStyle = 'normal';
            translationText.textContent = c.translated;
            originalText.textContent = c.original;
          }
          div.appendChild(translationText);
          div.appendChild(originalText);
          container.appendChild(div);
        });
        container.scrollTop = container.scrollHeight;
      }
      
      if (captionHistoryVisible) renderHistoryPanel();
      console.log('[Popup] Loaded', captionHistory.length, 'captions from storage.');
    }
  } catch (e) {
    console.warn('[Popup] Failed to load caption history:', e);
  }
}

function saveCaptionHistoryToStorage() {
  try {
    // Giới hạn 200 items để tránh exceed storage limit
    const toSave = captionHistory.slice(-200);
    chrome.storage.local.set({ captionHistory: toSave }).catch(err => {
      console.warn('[Popup] Failed to save caption history:', err);
    });
  } catch (e) {
    console.warn('[Popup] saveCaptionHistoryToStorage error:', e);
  }
}

// ─── HELPER FUNCTIONS FOR TAB CAPTURE ERRORS / SITE ACCESS SECURITY ───────

function isRestrictedUrl(url) {
  if (!url) return false; // Don't assume restricted if empty (hidden by lack of permission)
  const lowerUrl = url.toLowerCase();
  return (
    lowerUrl.startsWith('chrome://') ||
    lowerUrl.startsWith('chrome-extension://') ||
    lowerUrl.startsWith('about:') ||
    lowerUrl.startsWith('edge://') ||
    lowerUrl.startsWith('view-source:') ||
    lowerUrl.includes('chrome.google.com/webstore') ||
    lowerUrl.includes('chromewebstore.google.com')
  );
}

function showLiveCaptureError(err, tabUrl) {
  const container = document.getElementById('liveSubtitleContainer');
  if (!container) return;

  const titleHtml = `
    <div style="display: flex; align-items: center; gap: 8px; color: var(--warning); font-weight: 600; font-size: 13px; margin-bottom: 8px;">
      <span style="font-size: 15px;">⚠️</span>
      <span>Capture Restricted on This Page</span>
    </div>
    <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.45;">
      Chrome policies strictly restrict audio/video capture on system pages (such as <code>chrome://...</code>, Chrome Web Store, or empty new tabs).
    </div>
  `;
  const stepsHtml = `
    <div style="display: flex; flex-direction: column; gap: 8px; font-size: 11.5px; color: var(--text); line-height: 1.4;">
      <div style="display: flex; align-items: flex-start; gap: 6px;">
        <span style="background: var(--warning); color: #000; width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; flex-shrink: 0; margin-top: 1px;">1</span>
        <span>Please open any standard website containing audio or video (e.g., YouTube.com, X.com, or your learning/movie site).</span>
      </div>
      <div style="display: flex; align-items: flex-start; gap: 6px;">
        <span style="background: var(--warning); color: #000; width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; flex-shrink: 0; margin-top: 1px;">2</span>
        <span>Click the <b>Start Live Captions</b> button directly in this Sidebar to begin capturing and translating immediately!</span>
      </div>
    </div>
  `;

  container.innerHTML = `
    <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-strong); border-radius: 8px; padding: 12px; margin: 6px 0; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
      ${titleHtml}
      ${stepsHtml}
      <div style="margin-top: 12px; display: flex; gap: 8px;">
        <button id="btnErrorHelpRefresh" style="flex: 1; padding: 6px 12px; border-radius: 4px; border: none; background: var(--surface-hover); color: var(--text); font-size: 11px; cursor: pointer; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 4px; transition: background 0.15s;">
          🔄 Reload Current Page (F5)
        </button>
      </div>
    </div>
  `;

  // Bind a refresh button helper inside the alert card
  const btnRefresh = document.getElementById('btnErrorHelpRefresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (tab?.id) {
          chrome.tabs.reload(tab.id, {}, () => {
            toast('success', 'Reloading page...');
            container.innerHTML = '<span style="color: var(--text-dim); font-style: italic; display: block; text-align: center; margin-top: 10px;">Captions will appear here in real-time...</span>';
          });
        }
      });
    });
  }

  container.scrollTop = container.scrollHeight;
}

function showSecureGestureOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'secureGestureOverlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: radial-gradient(circle at top, #1e1b4b 0%, #090d16 100%);
    z-index: 99999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
    text-align: center;
    animation: fadeIn 0.3s ease;
  `;

  overlay.innerHTML = `
    <div class="pulsing-mic-glow" style="display: inline-flex; align-items: center; justify-content: center; width: 72px; height: 72px; border-radius: 50%; background: rgba(99, 102, 241, 0.12); color: var(--primary); margin-bottom: 20px; animation: pulse 2s infinite ease-in-out; border: 1px solid rgba(99, 102, 241, 0.25); box-shadow: 0 0 15px rgba(99, 102, 241, 0.15);">
      <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
    </div>
    
    <h3 style="font-size: 17px; font-weight: 700; color: #fff; margin-bottom: 10px; font-family: var(--font); letter-spacing: 0.3px;">
      Start Live Translation
    </h3>
    
    <p style="font-size: 12.5px; color: var(--text-muted); max-width: 290px; margin-bottom: 28px; line-height: 1.5; font-family: var(--font);">
      Chrome security requires a single click to authorize tab audio translation. Captions will automatically stream in the sidebar once started!
    </p>
    
    <button id="secureConfirmBtn" style="
      width: 100%;
      max-width: 250px;
      padding: 12px 20px;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      background: var(--primary-gradient);
      color: #fff;
      font-size: 13.5px;
      font-weight: 600;
      font-family: var(--font);
      cursor: pointer;
      box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3);
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    ">
      <span>🚀 Click to Launch (Start)</span>
    </button>
  `;

  document.body.appendChild(overlay);

  const confirmBtn = overlay.querySelector('#secureConfirmBtn');
  
  confirmBtn.addEventListener('mouseenter', () => {
    confirmBtn.style.transform = 'translateY(-1px)';
    confirmBtn.style.boxShadow = '0 6px 20px rgba(99, 102, 241, 0.45)';
    confirmBtn.style.filter = 'brightness(1.1)';
  });
  confirmBtn.addEventListener('mouseleave', () => {
    confirmBtn.style.transform = 'none';
    confirmBtn.style.boxShadow = '0 4px 15px rgba(99, 102, 241, 0.3)';
    confirmBtn.style.filter = 'none';
  });

  confirmBtn.addEventListener('click', async () => {
    chrome.storage.local.remove(['autoStartCapture']);
    overlay.remove();
    
    const btn = document.getElementById('toggleLiveBtn');
    if (btn) {
      btn.click();
    }
  });
}
