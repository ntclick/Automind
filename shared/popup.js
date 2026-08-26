// AutoMind – Popup
// Translate (default) + Overview (quota + settings link)

const STATE_KEY = 'translateState';
const MAX_CHARS = 2000;

// ─── Shared output-language memory ────────────────────────────────────────
// The Live tab (ltTgtLang, ISO codes like 'vi') and the Translate tab
// (tgtLang, full names like 'Vietnamese') used to keep completely separate,
// un-synced language memory — picking Vietnamese in one never carried over
// to the other. This map lets the two features share one remembered choice.
const LANG_CODE_TO_NAME = {
  en: 'English', vi: 'Vietnamese', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
  fr: 'French', es: 'Spanish', de: 'German', ru: 'Russian', th: 'Thai', ar: 'Arabic'
};
const LANG_NAME_TO_CODE = Object.fromEntries(
  Object.entries(LANG_CODE_TO_NAME).map(([code, name]) => [name, code])
);

// Caption history storage
let captionHistory = []; // Array of { time: string, original: string, translated: string }
let captionHistoryVisible = false;
let isHistoryLoaded = false;       // guard: true after loadCaptionHistoryFromStorage resolves
let pendingSubtitleMessages = [];  // queue for lt_subtitle messages that arrive before history is loaded
let lastSubtitleSeq = -1;

// Track current active tab ID synchronously to preserve user gesture context
let currentActiveTabId = null;
window.currentCapturedMicTabId = null;

// Settings cache to preserve user gesture in synchronous callbacks
let cachedSyncSettings = {};
async function updateSettingsCache() {
  try {
    cachedSyncSettings = await chrome.storage.sync.get(['ltAsrEngine', 'openaiApiKey', 'groqApiKey', 'apiKey']);
  } catch (e) {
    console.warn('Failed to update sync settings cache:', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  updateSettingsCache();
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
      updateSettingsCache();
    }
  });
  // Mark body when running in detached window so .popout-btn hides
  if (new URLSearchParams(location.search).get('detached') === '1') {
    document.body.classList.add('detached');
  }

  // Explicitly set window type context for popup
  document.body.classList.add('in-popup');
  document.body.classList.remove('in-sidepanel');

  setupTabs();

  // Initialize active tab ID synchronously on load using currentWindow to avoid popup window empty tabs issue
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab) {
      currentActiveTabId = tab.id;
      console.log('🎙️ [Popup] Initialized active tab ID:', currentActiveTabId);
    }
  });

  // Pre-create offscreen document to speed up capture startup!
  sendMessage({ action: 'lt_ensure_offscreen' }).catch(() => {});


  bindListeners();
  restoreTranslationState();
  loadQuota();
  loadProvider();
  updateCharCount();
  syncLiveStatus();
  
  // Load saved caption history
  loadCaptionHistoryFromStorage();

  // Legacy hand-off flag from the old "reopen the popup to grant permission"
  // flow. That flow never actually granted activeTab, so it is gone — clear any
  // leftover value so an upgraded install doesn't act on it.
  chrome.storage.local.remove(['autoStartCapture']);

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
        refreshAsrControls();
        if (typeof switchLtMode === 'function') {
          switchLtMode('tabCapture');
        }
      } else if (key === 'openaiApiKey' || key === 'groqApiKey' || key === 'apiKey') {
        // Keys are edited on the Options page now, so a panel left open would
        // otherwise keep refusing to start with a key the user just saved.
        cachedSyncSettings[key] = newVal;
      } else if (key === 'isCapturing') {
        if (typeof setLiveStatus === 'function') {
          setLiveStatus(!!newVal);
        }
      } else if (key === 'activeTabId') {
        if (newVal) window.currentCapturedTabId = newVal;
      } else if (key === 'ltTtsChromeVoiceMap') {
        // Re-sync voice dropdown when map changes from another panel
        if (typeof updateVoiceGroupVisibility === 'function') updateVoiceGroupVisibility();
      } else if (key === 'ltTgsVoice') {
        // legacy key, ignore
      } else if (key === 'apiProvider' || key === 'aiMode' || key === 'ltEngine' || key === 'ltTgtLang') {
        const el = document.getElementById(key);
        if (el && el.value !== newVal) {
          el.value = newVal;
        }
        if (key === 'ltTgtLang') {
          // Keep the Translate tab's remembered language in sync when it changes
          // in another open window (popup vs side panel).
          const name = LANG_CODE_TO_NAME[newVal];
          const tgtEl = document.getElementById('tgtLang');
          if (name && tgtEl && tgtEl.value !== name) tgtEl.value = name;
        }
        if (typeof updateVoiceGroupVisibility === 'function') {
          updateVoiceGroupVisibility();
        }
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
      if (target === 'tldr') {
        renderTldrSessionSelect();
        updateTldrCaptureUI();
      }
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
  document.getElementById('tgtLang').addEventListener('change', async () => {
    await saveTranslationState();
    // Remember this choice for the Live tab too, when the language is one both share.
    const name = document.getElementById('tgtLang').value;
    const code = LANG_NAME_TO_CODE[name];
    if (code) {
      await chrome.storage.local.set({ ltTgtLang: code });
      const ltTgtEl = document.getElementById('ltTgtLang');
      if (ltTgtEl && ltTgtEl.value !== code) ltTgtEl.value = code;
    }
  });

  // Live translation bindings
  // (ltModeMic / ltModeTab buttons were removed from the panel — mode is
  // derived from the ASR engine setting, now configured in the Options page.)
  document.getElementById('toggleLiveBtn').addEventListener('click', toggleLiveTranslation);
  document.getElementById('clearLiveCaptions').addEventListener('click', clearLiveCaptions);
  document.getElementById('openSidePanelBtn').addEventListener('click', openSidePanel);
  
  const promoOpenBtn = document.getElementById('promoOpenSidePanelBtn');
  if (promoOpenBtn) {
    promoOpenBtn.addEventListener('click', openSidePanel);
  }

  // Caption history buttons
  document.getElementById('toggleCaptionHistory').addEventListener('click', toggleCaptionHistory);
  document.getElementById('copyAllCaptions').addEventListener('click', copyAllCaptions);
  document.getElementById('exportCaptionsTxt').addEventListener('click', exportCaptionsTxt);
  const sessionSelect = document.getElementById('historySessionSelect');
  if (sessionSelect) {
    sessionSelect.addEventListener('change', renderHistoryPanel);
  }

  // TLDR tab: "Read video" reuses the exact Live Captions capture pipeline —
  // one capture state, whichever tab started it.
  const tldrAutoReadBtn = document.getElementById('tldrAutoReadBtn');
  if (tldrAutoReadBtn) tldrAutoReadBtn.addEventListener('click', autoReadTldr);
  const tldrCaptureBtn = document.getElementById('tldrCaptureBtn');
  if (tldrCaptureBtn) tldrCaptureBtn.addEventListener('click', toggleLiveTranslation);
  const tldrSessionSel = document.getElementById('tldrSessionSelect');
  if (tldrSessionSel) tldrSessionSel.addEventListener('change', updateTldrSessionInfo);
  const tldrBtn = document.getElementById('tldrVideoBtn');
  if (tldrBtn) tldrBtn.addEventListener('click', generateTldrPost);
  const copyTldrBtn = document.getElementById('copyTldrPost');
  if (copyTldrBtn) copyTldrBtn.addEventListener('click', copyTldrPost);

  document.getElementById('ltTopic').addEventListener('change', async () => {
    await chrome.storage.local.set({ ltTopic: document.getElementById('ltTopic').value });
  });

  document.getElementById('ltSourceLang').addEventListener('change', async () => {
    await chrome.storage.local.set({ ltSourceLang: document.getElementById('ltSourceLang').value });
  });

  document.getElementById('ltTgtLang').addEventListener('change', async () => {
    const lang = document.getElementById('ltTgtLang').value;
    await chrome.storage.local.set({ ltTgtLang: lang });
    // Refresh voice panel for the newly selected output language
    if (typeof updateVoiceGroupVisibility === 'function') {
      await updateVoiceGroupVisibility();
    }
    // Remember this choice for the Translate tab too, when the language is one both share.
    const name = LANG_CODE_TO_NAME[lang];
    if (name) {
      const tgtEl = document.getElementById('tgtLang');
      if (tgtEl && tgtEl.value !== name) {
        tgtEl.value = name;
        await saveTranslationState();
      }
    }
  });

  document.getElementById('ltEngine').addEventListener('change', async () => {
    await chrome.storage.local.set({ ltEngine: document.getElementById('ltEngine').value });
    if (typeof updateVoiceGroupVisibility === 'function') {
      await updateVoiceGroupVisibility();
    }
  });

  // ASR engine selection moved to the Options page (single source of truth,
  // next to the API keys it depends on). The storage.onChanged listener above
  // still picks up changes and switches the capture mode accordingly.
  const openOptionsFromLive = document.getElementById('openOptionsFromLive');
  if (openOptionsFromLive) {
    openOptionsFromLive.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

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

  const ttsOriginalAudioSelect = document.getElementById('ltTtsOriginalAudio');
  if (ttsOriginalAudioSelect) {
    ttsOriginalAudioSelect.addEventListener('change', async () => {
      await chrome.storage.local.set({ ltTtsOriginalAudio: ttsOriginalAudioSelect.value });
      await applyOriginalAudioVolume();
    });
  }

  // On-page overlay style. The content script watches these storage keys, so a
  // change lands on the running stream without restarting capture.
  const asrEngineSelect = document.getElementById('ltAsrEngine');
  if (asrEngineSelect) {
    asrEngineSelect.addEventListener('change', async () => {
      await chrome.storage.sync.set({ ltAsrEngine: asrEngineSelect.value });
      await refreshAsrControls();
    });
  }

  const asrModelSelect = document.getElementById('ltAsrModel');
  if (asrModelSelect) {
    asrModelSelect.addEventListener('change', async () => {
      const engine = document.getElementById('ltAsrEngine')?.value || 'groq';
      const spec = ASR_MODELS[engine];
      if (spec) await chrome.storage.sync.set({ [spec.key]: asrModelSelect.value });
    });
  }

  const subtitleStyleSelect = document.getElementById('ltSubtitleStyle');
  if (subtitleStyleSelect) {
    subtitleStyleSelect.addEventListener('change', async () => {
      await chrome.storage.local.set({ ltSubtitleStyle: subtitleStyleSelect.value });
    });
  }

  const subtitleLinesSelect = document.getElementById('ltSubtitleLines');
  if (subtitleLinesSelect) {
    subtitleLinesSelect.addEventListener('change', async () => {
      await chrome.storage.local.set({ ltSubtitleLines: parseInt(subtitleLinesSelect.value, 10) || 3 });
    });
  }

  const subtitleTypewriterToggle = document.getElementById('ltSubtitleTypewriter');
  if (subtitleTypewriterToggle) {
    subtitleTypewriterToggle.addEventListener('change', async () => {
      await chrome.storage.local.set({ ltSubtitleTypewriter: subtitleTypewriterToggle.checked });
    });
  }

  document.getElementById('ltTtsToggle').addEventListener('change', async () => {
    const enabled = document.getElementById('ltTtsToggle').checked;
    await chrome.storage.local.set({ ltTtsEnabled: enabled });
    
    if (!enabled) {
      // stop() only cuts the utterance Chrome is speaking; the background's own
      // _ttsQueue survives and its 'interrupted' event just advances to the next
      // item, so turning narration off used to drain the backlog instead of
      // ending it. Flush the queue too.
      try { chrome.tts.stop(); } catch (_) {}
      try { sendMessage({ action: 'lt_stop_tts' }).catch(() => {}); } catch (_) {}
    }
    // Refresh voice group visibility based on TTS on/off state
    if (typeof updateVoiceGroupVisibility === 'function') {
      await updateVoiceGroupVisibility();
    }
    await applyOriginalAudioVolume();
  });

  const ttsSpeedSelect = document.getElementById('ltTtsSpeedSelect');
  if (ttsSpeedSelect) {
    ttsSpeedSelect.addEventListener('change', async () => {
      const selectedSpeed = ttsSpeedSelect.value;
      await chrome.storage.local.set({ ltTtsSpeed: selectedSpeed });
      console.log(`⚡ [TTS] Speed set to: ${selectedSpeed}`);
    });
  }

  const ttsGenderSelect = document.getElementById('ltTtsGenderSelect');
  if (ttsGenderSelect) {
    ttsGenderSelect.addEventListener('change', async () => {
      const selectedGender = ttsGenderSelect.value;
      await chrome.storage.local.set({ ltTtsGender: selectedGender });
      console.log(`🗣️ [TTS] Gender set to: ${selectedGender}`);
    });
  }

  const chromeVoiceSelect = document.getElementById('ltTtsChromeVoiceSelect');
  if (chromeVoiceSelect) {
    chromeVoiceSelect.addEventListener('change', async () => {
      const selectedVoice = chromeVoiceSelect.value;
      const lang = document.getElementById('ltTgtLang')?.value || 'vi';
      // Save per-language chrome voice map
      const stored = await chrome.storage.local.get(['ltTtsChromeVoiceMap']);
      const voiceMap = stored.ltTtsChromeVoiceMap || {};
      voiceMap[lang] = selectedVoice;
      await chrome.storage.local.set({ ltTtsChromeVoiceMap: voiceMap });
      await chrome.storage.sync.set({ ltTtsChromeVoiceMap: voiceMap });
      console.log(`🗣️ [TTS] Chrome Voice for "${lang}" set to: ${selectedVoice}`);
    });
  }

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
    // First run for this feature: inherit the user's Live tab output-language
    // choice if one is already remembered, instead of always defaulting to
    // English regardless of what they picked elsewhere in the extension.
    const { ltTgtLang } = await chrome.storage.local.get('ltTgtLang');
    srcEl.value = 'English';
    tgtEl.value = LANG_CODE_TO_NAME[ltTgtLang] || 'Vietnamese';
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
  
  let srcVal = src.value;
  let tgtVal = tgt.value;
  
  if (srcVal === 'auto') {
    srcVal = tgtVal;
    tgtVal = (tgtVal === 'English') ? 'Vietnamese' : 'English';
  } else {
    [srcVal, tgtVal] = [tgtVal, srcVal];
  }
  
  src.value = srcVal;
  tgt.value = tgtVal;

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

async function syncLiveStatus() {
  try {
    const result = await chrome.storage.local.get(['ltSourceLang', 'ltTgtLang', 'ltMode', 'ltEngine', 'ltTtsEnabled', 'ltTtsSpeed', 'ltTtsGender', 'ltTtsOriginalAudio', 'ltSubtitleLines', 'ltSubtitleTypewriter', 'ltSubtitleStyle', 'ltMuteTab', 'ltTopic']);
    
    // Set default languages: source = English, target = Vietnamese
    const sourceLang = result.ltSourceLang || 'en';
    const targetLang = result.ltTgtLang || 'vi';
    
    document.getElementById('ltSourceLang').value = sourceLang;
    document.getElementById('ltTgtLang').value = targetLang;
    
    if (!result.ltSourceLang) chrome.storage.local.set({ ltSourceLang: 'en' });
    if (!result.ltTgtLang) chrome.storage.local.set({ ltTgtLang: 'vi' });

    const activeTopic = result.ltTopic || 'general';
    document.getElementById('ltTopic').value = activeTopic;
    if (!result.ltTopic) chrome.storage.local.set({ ltTopic: 'general' });

    if (result.ltEngine) document.getElementById('ltEngine').value = result.ltEngine;


    // Sync popup-only mode buttons based on ASR Engine
    const syncRes = await chrome.storage.sync.get('ltAsrEngine');
    const asrEngine = syncRes.ltAsrEngine || 'groq';
    
    const asrEngineElement = document.getElementById('ltAsrEngine');
    if (asrEngineElement) {
      asrEngineElement.value = asrEngine;
    }
    await refreshAsrControls();
    
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
    // Null-guarded: ltMuteTabToggle no longer exists in the markup, and the
    // unguarded lookup used to throw here and silently skip every sync below it.
    const ttsToggleEl = document.getElementById('ltTtsToggle');
    if (ttsToggleEl && result.ltTtsEnabled !== undefined) ttsToggleEl.checked = !!result.ltTtsEnabled;
    const muteToggleEl = document.getElementById('ltMuteTabToggle');
    if (muteToggleEl && result.ltMuteTab !== undefined) muteToggleEl.checked = !!result.ltMuteTab;


    const ttsOriginalAudioSelect = document.getElementById('ltTtsOriginalAudio');
    if (ttsOriginalAudioSelect) ttsOriginalAudioSelect.value = result.ltTtsOriginalAudio || 'mute';

    const subtitleStyleSelect = document.getElementById('ltSubtitleStyle');
    if (subtitleStyleSelect) subtitleStyleSelect.value = result.ltSubtitleStyle || 'netflix';
    const subtitleLinesSelect = document.getElementById('ltSubtitleLines');
    if (subtitleLinesSelect) subtitleLinesSelect.value = String(result.ltSubtitleLines || 3);
    const subtitleTypewriterToggle = document.getElementById('ltSubtitleTypewriter');
    if (subtitleTypewriterToggle) subtitleTypewriterToggle.checked = result.ltSubtitleTypewriter !== false;

    // Sync TTS speed select
    const ttsSpeedSelect = document.getElementById('ltTtsSpeedSelect');
    if (ttsSpeedSelect) {
      ttsSpeedSelect.value = result.ltTtsSpeed || '1.25';
    }

    // Sync Chrome TTS gender select
    const ttsGenderSelect = document.getElementById('ltTtsGenderSelect');
    if (ttsGenderSelect) {
      ttsGenderSelect.value = result.ltTtsGender || 'female';
    }


    
    // Sync per-language TTS voice selection (handled inside updateVoiceGroupVisibility)
    if (typeof updateVoiceGroupVisibility === 'function') {
      await updateVoiceGroupVisibility();
    }

    switchLtMode(activeMode);

    // Ensure we get the active tab ID asynchronously to avoid race conditions on startup
    let activeTabId = currentActiveTabId;
    if (!activeTabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        currentActiveTabId = tab.id;
        activeTabId = tab.id;
      }
    }

    const bgStatus = await sendMessage({ action: 'lt_get_status' });
    if (bgStatus && bgStatus.status === 'listening') {
      // Prioritize the focused tab: only set active UI if this tab is the one being captured!
      if (bgStatus.tabId === activeTabId) {
        switchLtMode(activeMode);
        setLiveStatus(true);
        window.currentCapturedTabId = bgStatus.tabId;
        chrome.tabs.get(bgStatus.tabId, (capturedTab) => {
          if (capturedTab && capturedTab.url) {
            window.currentCapturedTabUrl = capturedTab.url;
          }
        });
      } else {
        // A different tab is captured. Let this focused tab start capture to take over.
        setLiveStatus(false);
        toast('info', 'Another tab is active. Click Start here to capture this tab instead.');
      }
    } else {
      setLiveStatus(false);
    }
  } catch (err) {
    console.error('Failed to sync live status:', err);
  }
}

function switchLtMode(mode) {
  ltMode = mode;
  chrome.storage.local.set({ ltMode: mode });

  const micBtn = document.getElementById('ltModeMic');
  const tabBtn = document.getElementById('ltModeTab');

  if (mode === 'microphone') {
    if (micBtn) {
      micBtn.style.cssText = 'flex: 1; border-color: var(--primary); background: var(--primary-soft); color: var(--text); display: flex !important;';
    }
    if (tabBtn) {
      tabBtn.style.display = 'none';
    }
  } else {
    if (micBtn) {
      micBtn.style.display = 'none';
    }
    if (tabBtn) {
      tabBtn.style.cssText = 'flex: 1; border-color: var(--primary); background: var(--primary-soft); color: var(--text); display: flex !important;';
    }
  }
}

async function ensureContentScriptInjected(tabId) {
  try {
    // Check if the content script is already listening
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 500);
      chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
        clearTimeout(timer);
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
  // One physical action = one toggle. A double-click used to stop AND restart:
  // the first click stops, the button relabels to Start instantly, and the
  // second click of the pair lands on the new meaning.
  const now = Date.now();
  if (now - (window._lastToggleAt || 0) < 600) return;
  window._lastToggleAt = now;

  const sourceLang = document.getElementById('ltSourceLang').value;
  const targetLang = document.getElementById('ltTgtLang').value;
  const btn = document.getElementById('toggleLiveBtn');
  const btnText = document.getElementById('toggleLiveBtnText');
  const btnIcon = btn.querySelector('svg') || btn.querySelector('.spinner');

  if (!ltListening) {
    // Validate that the user has the required API Key for the selected ASR Speech Engine
    const asrEngine = cachedSyncSettings.ltAsrEngine || 'groq';
    if (asrEngine === 'groq') {
      if (!cachedSyncSettings.groqApiKey || !cachedSyncSettings.groqApiKey.trim()) {
        toast('error', 'Groq API Key is missing. Please add it in settings.');
        return;
      }
    } else if (asrEngine === 'whisper') {
      const whisperKey = cachedSyncSettings.openaiApiKey || cachedSyncSettings.apiKey;
      if (!whisperKey || !whisperKey.trim()) {
        toast('error', 'OpenAI API Key is missing. Please add it in settings.');
        return;
      }
    }

    window._captureStartTimestamp = Date.now();
    console.log('🚀 [Latency Benchmark] Start capture initiated at:', window._captureStartTimestamp);
    
    // Helper to safely restore button UI state on failures.
    // Re-query the icon: btnIcon is DETACHED once the spinner swap runs, and
    // writing outerHTML on a detached node throws — which used to leave the
    // spinner stuck forever on any failed start.
    const resetBtnState = () => {
      btn.disabled = false;
      btnText.textContent = 'Start Live Captions';
      const icon = btn.querySelector('svg') || btn.querySelector('.spinner');
      if (icon) {
        icon.outerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
      }
    };

    // ─── HYBRID PERSISTENT TAB CAPTURE INITIATION ───
    btn.disabled = true;
    btnText.textContent = 'Starting Tab Capture...';
    if (btnIcon) btnIcon.outerHTML = '<div class="spinner"></div>';

    const targetTabId = currentActiveTabId;
    if (!targetTabId) {
      toast('warning', 'Active tab ID not initialized yet. Try again.');
      resetBtnState();
      return;
    }

    const executeCapture = async (streamId = null) => {
      try {
        cleanupLocalTabCaptureSilently();

        // Concurrently ensure content script is injected and offscreen is created
        const injectPromise = (async () => {
          try {
            await ensureContentScriptInjected(targetTabId);
          } catch (injectErr) {
            console.warn('⚠️ [Popup] Content script injection failed or was restricted. Overlay is disabled for this tab:', injectErr);
          }
        })();

        const offscreenPromise = sendMessage({ action: 'lt_ensure_offscreen' });

        const [_, ensureResponse] = await Promise.all([injectPromise, offscreenPromise]);

        if (!ensureResponse || !ensureResponse.success) {
          throw new Error(ensureResponse?.error || 'Failed to initialize offscreen environment');
        }

        const ltEngine = document.getElementById('ltEngine').value;

        // Request background script to capture the tab stream ID and launch Offscreen capture
        const startResponse = await sendMessage({
          action: 'lt_tab_start',
          tabId: targetTabId,
          streamId: streamId, // Pass the streamId if we successfully captured it in the page!
          sourceLang: sourceLang,
          targetLang: targetLang,
          ltEngine: ltEngine
        });

        // The background swallowed a start that raced a just-finished stop.
        // Not an error — just quietly stay stopped.
        if (startResponse && startResponse.cause === 'stop_cooldown') {
          console.log('🎙️ [Popup] Start ignored: it raced a just-finished stop.');
          setLiveStatus(false);
          return;
        }

        if (startResponse && startResponse.success) {
          window.currentCapturedTabId = targetTabId;

          // Get tab URL for status tracking
          chrome.tabs.get(targetTabId, (capturedTab) => {
            if (capturedTab && capturedTab.url) {
              window.currentCapturedTabUrl = capturedTab.url;
            }
          });

          setLiveStatus(true);
          toast('success', 'Tab audio capture active');
          // Captions render right here in the popup. No auto-redirect to the
          // Side Panel: closing the surface the user just clicked in is jarring,
          // and the "Open in Chrome Side Panel" button exists for when they
          // actually want the docked view.
        } else {
          throw new Error(startResponse?.error || 'Failed to start background tab capture');
        }
      } catch (err) {
        console.error('🎙️ [Tab Capture] Failed in executeCapture:', err);
        showLiveCaptureError(err, null);
        toast('error', 'Unable to capture tab audio: ' + err.message);
        setLiveStatus(false);
      } finally {
        btn.disabled = false;
        const spinner = btn.querySelector('.spinner');
        if (spinner) {
          spinner.outerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
        }
      }
    };

    // chrome.tabCapture needs activeTab for this tab, which clicking the toolbar
    // icon grants, or a host permission covering the URL. Asking from the popup
    // is the surface where that grant exists.
    const failCapture = (reason) => {
      console.warn('⚠️ tabCapture unavailable:', reason);
      chrome.tabs.get(targetTabId, (tab) => {
        showLiveCaptureError(new Error(reason), tab?.url || null);
        toast('error', 'Unable to capture tab audio.');
        resetBtnState();
      });
    };

    try {
      if (typeof chrome.tabCapture !== 'undefined' && chrome.tabCapture.getMediaStreamId) {
        chrome.tabCapture.getMediaStreamId({ targetTabId: targetTabId }, async (streamId) => {
          if (chrome.runtime.lastError || !streamId) {
            failCapture(chrome.runtime.lastError?.message || 'no stream id');
            return;
          }

          try {
            await executeCapture(streamId);
          } catch (execErr) {
            console.error('Error in executeCapture execution:', execErr);
            resetBtnState();
          }
        });
      } else {
        failCapture('chrome.tabCapture is not available in this context');
      }
    } catch (outerErr) {
      console.error('Error in direct tabCapture block:', outerErr);
      failCapture(outerErr.message);
    }
  } else {
    stopLocalTabCapture();
  }
}

// Model choices per speech engine. Both keys live in storage.sync alongside
// ltAsrEngine, which is what the background caches — so switching here takes
// effect on the next audio segment without restarting capture.
const ASR_MODELS = {
  groq: {
    key: 'groqModel',
    fallback: 'whisper-large-v3',
    options: [
      ['whisper-large-v3', 'whisper-large-v3 (accurate)'],
      ['whisper-large-v3-turbo', 'whisper-large-v3-turbo (faster)']
    ]
  },
  whisper: {
    key: 'openaiWhisperModel',
    fallback: 'whisper-1',
    options: [
      ['whisper-1', 'whisper-1 (cheapest)'],
      ['gpt-4o-mini-transcribe', 'gpt-4o-mini-transcribe (better)'],
      ['gpt-4o-transcribe', 'gpt-4o-transcribe (best)']
    ]
  },
  webSpeech: null // Chrome's own recogniser — no model to pick, no key needed
};

/** Repaint the model list and the missing-key warning for the chosen engine. */
async function refreshAsrControls() {
  const engineEl = document.getElementById('ltAsrEngine');
  if (!engineEl) return;

  const modelEl = document.getElementById('ltAsrModel');
  const wrap = document.getElementById('ltAsrModelWrap');
  const warn = document.getElementById('ltAsrKeyWarning');

  const engine = engineEl.value || 'groq';
  const spec = ASR_MODELS[engine];
  const stored = await chrome.storage.sync.get([
    'groqModel', 'openaiWhisperModel', 'groqApiKey', 'openaiApiKey', 'apiKey'
  ]);

  if (wrap) wrap.style.display = spec ? 'flex' : 'none';
  if (spec && modelEl) {
    const current = stored[spec.key] || spec.fallback;
    modelEl.innerHTML = '';
    spec.options.forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      modelEl.appendChild(opt);
    });
    modelEl.value = spec.options.some(([v]) => v === current) ? current : spec.fallback;
  }

  if (warn) {
    let missing = '';
    if (engine === 'groq' && !(stored.groqApiKey || '').trim()) missing = 'Groq';
    if (engine === 'whisper' && !((stored.openaiApiKey || stored.apiKey || '').trim())) missing = 'OpenAI';
    warn.textContent = missing
      ? `⚠️ No ${missing} API key saved — captions cannot start. Add it in Settings → API Keys.`
      : '';
    warn.style.display = missing ? 'block' : 'none';
  }
}

// Mirrors resolvePlaybackGain() in offscreen.js. Kept in sync so flipping TTS
// or its "Original audio" choice takes effect on the running capture instead of
// waiting for the next one.
const TTS_ORIGINAL_AUDIO_GAIN = { mute: 0.0, low: 0.15, keep: 1.0 };

async function applyOriginalAudioVolume() {
  try {
    const s = await chrome.storage.local.get(['ltMuteTab', 'ltTtsEnabled', 'ltTtsOriginalAudio', 'isCapturing']);
    if (!s.isCapturing) return;

    let volume = 1.0;
    if (s.ltMuteTab) {
      volume = 0.0;
    } else if (s.ltTtsEnabled) {
      const gain = TTS_ORIGINAL_AUDIO_GAIN[s.ltTtsOriginalAudio];
      volume = gain === undefined ? 0.0 : gain;
    }
    await sendMessage({ action: 'lt_playback_volume', volume: volume });
  } catch (err) {
    console.warn('⚠️ [TTS] Could not apply original audio volume:', err);
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
  updateTldrCaptureUI();
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
    if (message.sequenceNumber !== undefined) {
      if (message.sequenceNumber < lastSubtitleSeq) {
        console.log(`🎙️ [Popup] Drop out-of-order/stale subtitle segment (seq: ${message.sequenceNumber} < last: ${lastSubtitleSeq})`);
        return;
      }
      lastSubtitleSeq = message.sequenceNumber;
    }
    // Queue the message if history hasn't been loaded yet to prevent race condition
    if (!isHistoryLoaded) {
      pendingSubtitleMessages.push(message);
    } else {
      appendSubtitleMarkup(message.original, message.translated, message.isUpdate, message.segmentId);
    }
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
      lastSubtitleSeq = -1;
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

function isRepetitiveLoop(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").replace(/\s+/g, " ").trim();
  const words = clean.split(' ');
  const n = words.length;
  if (n < 4) return false;

  // 1. Check for single word repetition (Whisper stutter/loop)
  const wordCounts = {};
  for (const w of words) {
    if (w.length < 3) continue;
    wordCounts[w] = (wordCounts[w] || 0) + 1;
  }
  for (const [w, count] of Object.entries(wordCounts)) {
    if (w.length >= 5 && count >= 3) {
      return true;
    }
    if (count >= 4) {
      return true;
    }
  }

  // 2. Check for phrase repetition (from 2 to 8 words)
  for (let len = 2; len <= 8; len++) {
    const phraseCounts = {};
    for (let i = 0; i <= n - len; i++) {
      const phrase = words.slice(i, i + len).join(' ');
      phraseCounts[phrase] = (phraseCounts[phrase] || 0) + 1;
    }
    for (const [phrase, count] of Object.entries(phraseCounts)) {
      if (count >= 3) {
        return true;
      }
      if (count >= 2 && len >= 3) {
        const coverage = (len * count) / n;
        if (coverage > 0.5) {
          return true;
        }
      }
    }
  }

  // 3. Substring loop check (for languages like Korean/Japanese without word spaces or with grammar particles)
  const subCounts = {};
  for (const w of words) {
    for (let len = 4; len <= 5; len++) {
      for (let i = 0; i <= w.length - len; i++) {
        const sub = w.substring(i, i + len);
        if (subCounts[sub] !== undefined) continue;
        
        let count = 0;
        let pos = 0;
        while ((pos = clean.indexOf(sub, pos)) !== -1) {
          count++;
          pos += 1;
        }
        subCounts[sub] = count;
      }
    }
  }
  for (const [sub, count] of Object.entries(subCounts)) {
    if (count >= 3) {
      return true;
    }
  }

  return false;
}

function isWhisperHallucination(text) {
  if (!text || typeof text !== 'string') return true;
  if (isRepetitiveLoop(text)) return true;
  
  const lowerText = text.trim().toLowerCase();
  
  // 1. Strict substring checks - block the entire segment if these appear ANYWHERE
  const strictBlockedSubstrings = [
    "transcriber's manual",
    "transcribers manual",
    "translation purposes only",
    "subtitles by",
    "opensubtitles",
    "subscene",
    "amara.org",
    "amara org",
    "otter.ai",
    "otter ai",
    "castingwords",
    "casting words",
    "transcription by eso",
    "translation by eso",
    "hướng dẫn sử dụng của người phiên",
    "transcription provided by",
    "transcription outsourcing",
    "complete disclaimer",
    "tuyên bố từ chối trách nhiệm",
    "sites.google.com",
    "phiên âm được cung cấp bởi",
    "renaissancere",
    "transcription sponsored by",
    "phiên âm được tài trợ bởi",
    "please transcribe the audio",
    "transcribe the audio accurately",
    "vui lòng phiên âm âm thanh",
    "phiên âm âm thanh chính xác",
    "specialized terms:",
    "tech/blockchain/crypto livestream",
    "general transcription",
    "recent clean transcript context"
  ];
  for (const strictSub of strictBlockedSubstrings) {
    if (lowerText.includes(strictSub)) {
      return true;
    }
  }

  // 2. Conversational substring checks - only block if they represent the standalone content of the segment
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
    'chúc các bạn một ngày',
    // Additional Vietnamese translations of common Whisper outros
    'cảm ơn quý vị đã theo dõi',
    'cảm ơn các bạn đã theo dõi',
    'cảm ơn bạn đã theo dõi',
    'cám ơn quý vị đã theo dõi',
    'cám ơn các bạn đã theo dõi',
    'cám ơn bạn đã theo dõi',
    'cám ơn các bạn đã xem',
    'cám ơn bạn đã xem',
    'cám ơn đã xem',
    'cám ơn đã theo dõi',
    'cảm ơn đã theo dõi',
    'hãy đăng ký kênh',
    'đăng ký kênh của tôi',
    'đăng ký kênh để',
    'chúc các bạn một ngày tốt lành',
    'chúc các bạn ngày mới',
    'chúc bạn ngày mới',
    'chúc quý vị một ngày tốt lành',
    'chúc một ngày tốt lành',
    'cảm ơn bạn đã xem video',
    'cảm ơn các bạn đã xem video',
    'cám ơn các bạn đã xem video',
    'cám ơn bạn đã xem video',
    'cảm ơn đã xem video',
    'cám ơn đã xem video',
    'nhớ đăng ký kênh',
    'hãy nhấn đăng ký',
    'nhấn đăng ký kênh',
    'hãy subscribe',
    'subtitles by amara org',
    'otter ai',
    'see you next time',
    'see you in the next video',
    'see you soon',
    'thank you very much',
    'thanks very much',
    'thank you so much',
    'thanks so much',
    'have a great day',
    'have a good day',
    'don\'t forget to subscribe',
    'like and subscribe',
    'castingwords',
    'casting words',
    'transcription by eso',
    'translation by eso',
    'kakaotalk',
    '明镜与点点',
    '请不吝点赞',
    '订阅 转发',
    '자막 제공',
    '플러스친구'
  ];
  
  for (const sub of blockedSubstrings) {
    if (lowerText.includes(sub)) {
      const withoutSub = lowerText.replace(sub, '').trim();
      const isStandalone = withoutSub.length < 10; // Less than 10 chars remaining = just the phrase
      if (isStandalone) return true;
    }
  }
  
  // 2. Normalize and check exact patterns
  // Clean all punctuation, symbols, brackets, and quotes (including smart quotes)
  // Note: We do NOT remove digits/numbers (\d) here, as digit-only chunks (e.g. stock prices, years, IDs, SSNs)
  // are meaningful spoken content, not Whisper hallucinations.
  const clean = lowerText
    .replace(/[\s\p{P}\p{S}]/gu, ' ') // replaces punctuation, symbols, and spaces with space
    .replace(/\s+/g, ' ')
    .trim();
    
  if (clean.length <= 1) {
    if (!/\d/.test(clean)) {
      return true;
    }
  }
  
  let cleanPatterns = [
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
    'đăng ký kênh',
    // Vietnamese translation fillers/hallucinations
    'cảm ơn',
    'cám ơn',
    'cảm ơn bạn',
    'cám ơn bạn',
    'cảm ơn các bạn',
    'cám ơn các bạn',
    'tạm biệt',
    'hẹn gặp lại',
    'hẹn gặp lại các bạn',
    'hẹn gặp lại quý vị',
    'chào tạm biệt',
    'chào các bạn',
    'chào mọi người',
    'xin chào',
    'tiếng anh',
    'tiếng việt',
    'tiếng trung',
    'tiếng nhật',
    'tiếng hàn',
    'english',
    'vietnamese',
    'chinese',
    'japanese',
    'korean',
    'thanks you',
    'thank u',
    'thank you all',
    'thank you guys',
    // NOTE: real single-word speech ('you', 'okay', 'yes', 'no', 'go', company
    // names like 'google'/'microsoft'/'zoom') was removed from this list — an
    // AMA guest answering "Yes." was being silently dropped. Only true
    // hallucination artifacts (fillers + transcription-service credits) remain,
    // keeping this display filter in sync with the background gate.
    'oh',
    'um',
    'uh',
    'ah',
    'video',
    'subtitles',
    'caption',
    'captions',
    'transcription',
    'transcribe',
    'translation',
    'translate',
    'amara',
    'otter'
  ];

  // Anything reaching the panel already cleared the background filter, and the
  // mic path is the user speaking directly — so short pleasantries are real here.
  {
    const conversationalTerms = new Set([
      'thank you very much', 'thanks very much', 'thank you', 'thanks', 'goodbye', 'bye',
      'see you next time', 'see you soon', 'thank you so much', 'cảm ơn', 'cám ơn', 'cảm ơn bạn',
      'cám ơn bạn', 'cảm ơn các bạn', 'cám ơn các bạn', 'tạm biệt', 'hẹn gặp lại', 'hẹn gặp lại các bạn',
      'hẹn gặp lại quý vị', 'chào tạm biệt', 'chào các bạn', 'chào mọi người', 'xin chào',
      'thanks you', 'thank u', 'thank you all', 'thank you guys', 'oh', 'um', 'uh', 'ah',
      'tiếng anh', 'tiếng việt', 'tiếng trung', 'tiếng nhật', 'tiếng hàn',
      'english', 'vietnamese', 'chinese', 'japanese', 'korean', 'you', 'okay', 'ok', 'yeah', 'yes', 'no', 'go'
    ]);
    cleanPatterns = cleanPatterns.filter(p => !conversationalTerms.has(p));
  }
  
  if (cleanPatterns.includes(clean)) return true;
  
  // Filter repetitions of short filler words during silent stream gaps (both English and Vietnamese)
  const fillers = new Set([
    'ah', 'oh', 'um', 'uh', 'so', 'and', 'but', 'the', 'video',
    'ơi', 'thì', 'là', 'mà', 'nhỉ', 'nhé', 'nha', 'vậy', 'đó', 'này', 'kia', 'thế', 'ô', 'ơ', 'ư', 'á', 'à',
    'you', 'me', 'i', 'we', 'he', 'she', 'it', 'they', 'them', 'him', 'her', 'his', 'its', 'us', 'our', 'your', 'my', 'their',
    'go', 'do', 'bye', 'hello', 'hi', 'thank', 'thanks', 'yeah', 'yep', 'nah', 'uh-huh', 'um-hum',
    'tôi', 'bạn', 'anh', 'chị', 'em', 'nó', 'họ', 'chúng', 'ta', 'đây', 'ấy', 'nào', 'ai', 'gì', 'dạ', 'vâng', 'ừ'
  ]);
  const words = clean.split(' ');
  const onlyFillers = words.every(w => fillers.has(w));
  if (onlyFillers) {
    const maxFillerLength = 2;
    if (words.length < maxFillerLength) return true;
  }
  
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
  const targetDiv = segmentId ? document.getElementById('sub-' + segmentId) : null;
  const lastDiv = targetDiv || (isUpdate ? container.lastElementChild : null);
  
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

    // Update history entry in-place, or push new if not found
    if (translated !== 'Translating...' && !(typeof translated === 'string' && translated.startsWith('🎙️'))) {
      let histIndex = -1;
      if (segmentId) {
        histIndex = captionHistory.findIndex(h => h.segmentId === segmentId);
      }
      if (histIndex !== -1) {
        // Update existing entry
        captionHistory[histIndex].original = original;
        captionHistory[histIndex].translated = translated;
      } else {
        // No entry found (e.g. history empty or segmentId missing) — push new
        captionHistory.push({ segmentId: segmentId, time: timeStr, original: original, translated: translated });
      }
      updateHistoryBadge();
      if (captionHistoryVisible) renderHistoryPanel();
      saveCaptionHistoryToStorage();
    }
    
    if (!scrollLocked) container.scrollTop = container.scrollHeight;
    return;
  }

  // Push to history (only finalized captions, not "Translating...")
  if (translated !== 'Translating...') {
    let histIndex = -1;
    if (segmentId) {
      histIndex = captionHistory.findIndex(h => h.segmentId === segmentId);
    }
    if (histIndex !== -1) {
      captionHistory[histIndex].original = original;
      captionHistory[histIndex].translated = translated;
    } else {
      captionHistory.push({ segmentId: segmentId, time: timeStr, original: original, translated: translated });
    }
    updateHistoryBadge();
    if (captionHistoryVisible) renderHistoryPanel();
    saveCaptionHistoryToStorage();
  } else {
    // Still push a placeholder so in-place updates work
    let histIndex = -1;
    if (segmentId) {
      histIndex = captionHistory.findIndex(h => h.segmentId === segmentId);
    }
    if (histIndex !== -1) {
      captionHistory[histIndex].original = original;
      captionHistory[histIndex].translated = '';
    } else {
      captionHistory.push({ segmentId: segmentId, time: timeStr, original: original, translated: '' });
    }
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

async function getSessionCaptions(sessionId) {
  if (sessionId === 'current') {
    return captionHistory || [];
  }
  try {
    const res = await chrome.storage.local.get(['ltSessionHistory']);
    const sessions = res.ltSessionHistory || [];
    const found = sessions.find(s => s.id === sessionId);
    return found ? (found.captions || []) : [];
  } catch (err) {
    console.warn('[Popup] Failed to get session captions:', err);
    return [];
  }
}

async function getSelectedSessionCaptions() {
  const select = document.getElementById('historySessionSelect');
  return getSessionCaptions(select ? select.value : 'current');
}

async function clearLiveCaptions() {
  const select = document.getElementById('historySessionSelect');
  const selectedSession = select ? select.value : 'current';
  
  if (selectedSession === 'current') {
    const container = document.getElementById('liveSubtitleContainer');
    if (container) {
      container.innerHTML = '<span style="color: var(--text-dim); font-style: italic; display: block; text-align: center; margin-top: 10px;">Captions will appear here in real-time...</span>';
    }
    captionHistory = [];
    updateHistoryBadge();
    if (captionHistoryVisible) await renderHistoryPanel();
    chrome.storage.local.remove('captionHistory').catch(() => {});
    sendMessage({ action: 'lt_clear_session' }).catch(() => {});
    toast('success', 'Active session captions cleared.');
  } else {
    try {
      const res = await chrome.storage.local.get(['ltSessionHistory']);
      let sessions = res.ltSessionHistory || [];
      sessions = sessions.filter(s => s.id !== selectedSession);
      await chrome.storage.local.set({ ltSessionHistory: sessions });
      
      if (select) select.value = 'current';
      if (captionHistoryVisible) await renderHistoryPanel();
      toast('success', 'Past session deleted.');
    } catch (err) {
      console.warn('[Popup] Failed to delete past session:', err);
      toast('error', 'Failed to delete past session.');
    }
  }
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

async function renderHistoryPanel() {
  const list = document.getElementById('captionHistoryList');
  const countEl = document.getElementById('historyCount');
  const select = document.getElementById('historySessionSelect');
  if (!list || !countEl) return;
  
  const currentVal = select ? select.value : 'current';
  
  let sessions = [];
  try {
    const res = await chrome.storage.local.get(['ltSessionHistory']);
    sessions = res.ltSessionHistory || [];
  } catch (err) {
    console.warn('[Popup] Failed to load ltSessionHistory:', err);
  }
  
  if (select) {
    select.innerHTML = '<option value="current">Active Session</option>';
    sessions.forEach(sess => {
      const opt = document.createElement('option');
      opt.value = sess.id;
      
      const startTime = sess.startTime || Date.now();
      const timeStr = new Date(startTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
      const dateStr = new Date(startTime).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
      const cleanTitle = sess.title && sess.title.length > 20 ? sess.title.substring(0, 20) + '...' : (sess.title || 'Live Stream');
      opt.textContent = `[${timeStr} ${dateStr}] ${cleanTitle}`;
      select.appendChild(opt);
    });
    
    const exists = Array.from(select.options).some(opt => opt.value === currentVal);
    select.value = exists ? currentVal : 'current';
  }
  
  const selectedSession = select ? select.value : 'current';
  let targetCaptions = [];
  if (selectedSession === 'current') {
    targetCaptions = captionHistory || [];
  } else {
    const found = sessions.find(s => s.id === selectedSession);
    if (found) {
      targetCaptions = found.captions || [];
    }
  }
  
  const finalized = targetCaptions.filter(c => c.translated && c.translated.length > 0);
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
  
  list.scrollTop = list.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updateHistoryBadge() {
  const badge = document.getElementById('historyBadge');
  if (badge) {
    const finalized = captionHistory.filter(c => c.translated && c.translated.length > 0);
    if (finalized.length > 0) {
      badge.style.display = 'block';
      badge.textContent = finalized.length > 99 ? '99+' : finalized.length;
    } else {
      badge.style.display = 'none';
    }
  }
  // The TLDR tab counts the same stream, so keep its line counter live too.
  updateTldrSessionInfo();
}

async function copyAllCaptions() {
  const targetCaptions = await getSelectedSessionCaptions();
  const finalized = targetCaptions.filter(c => c.translated && c.translated.length > 0);
  if (finalized.length === 0) {
    toast('warning', 'No subtitles to copy.');
    return;
  }
  
  const text = finalized.map(c => `[${c.time}] ${c.translated}\n         ${c.original}`).join('\n\n');
  navigator.clipboard.writeText(text).then(() => {
    toast('success', `Copied ${finalized.length} lines of captions!`);
    const btn = document.getElementById('copyAllCaptions');
    if (btn) {
      btn.style.color = 'var(--success)';
      setTimeout(() => { btn.style.color = ''; }, 1500);
    }
  }).catch(() => {
    toast('error', 'Copy failed. Try again.');
  });
}

async function exportCaptionsTxt() {
  const targetCaptions = await getSelectedSessionCaptions();
  const finalized = targetCaptions.filter(c => c.translated && c.translated.length > 0);
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

// ─── TLDR video → post ──────────────────────────────────────────────────────
// The TLDR tab reads the whole video through Whisper first (the same capture
// pipeline Live Captions uses), then feeds the transcript to the provider
// picked in Options (Groq or OpenAI) to boil it down to one post.

function transcriptLinesFrom(captions) {
  // The spoken original is the real transcript; fall back to the translated
  // line for captions where the original side wasn't kept.
  return captions
    .map(c => (c.original && c.original.trim()) || (c.translated && c.translated.trim()) || '')
    .filter(Boolean);
}

function updateTldrCaptureUI() {
  const btnText = document.getElementById('tldrCaptureBtnText');
  if (!btnText) return;
  const dot = document.getElementById('tldrCaptureDot');
  const state = document.getElementById('tldrCaptureState');
  if (ltListening) {
    btnText.textContent = 'Stop reading';
    if (dot) { dot.style.background = 'var(--danger)'; dot.style.boxShadow = '0 0 6px var(--danger)'; }
    if (state) state.textContent = 'Reading video audio…';
  } else {
    btnText.textContent = 'Read video (Whisper)';
    if (dot) { dot.style.background = '#64748b'; dot.style.boxShadow = 'none'; }
    if (state) state.textContent = 'Not reading';
  }
  updateTldrSessionInfo();
}

async function updateTldrSessionInfo() {
  const select = document.getElementById('tldrSessionSelect');
  const info = document.getElementById('tldrSessionInfo');
  if (!select || !info) return;
  const captions = await getSessionCaptions(select.value || 'current');
  info.textContent = `${transcriptLinesFrom(captions).length} lines captured`;
}

async function renderTldrSessionSelect() {
  const select = document.getElementById('tldrSessionSelect');
  if (!select) return;
  const currentVal = select.value || 'current';

  let sessions = [];
  try {
    const res = await chrome.storage.local.get(['ltSessionHistory']);
    sessions = res.ltSessionHistory || [];
  } catch (err) {
    console.warn('[TLDR] Failed to load session history:', err);
  }

  select.innerHTML = '<option value="current">Active Session (just captured)</option>';
  sessions.forEach(sess => {
    const opt = document.createElement('option');
    opt.value = sess.id;
    const startTime = sess.startTime || Date.now();
    const timeStr = new Date(startTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const dateStr = new Date(startTime).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
    const cleanTitle = sess.title && sess.title.length > 20 ? sess.title.substring(0, 20) + '...' : (sess.title || 'Live Stream');
    opt.textContent = `[${timeStr} ${dateStr}] ${cleanTitle}`;
    select.appendChild(opt);
  });

  const exists = Array.from(select.options).some(opt => opt.value === currentVal);
  select.value = exists ? currentVal : 'current';
  updateTldrSessionInfo();
}

// Runs INSIDE the target page (via chrome.scripting.executeScript), so it must
// stay self-contained. Finds a directly downloadable media URL: <video>/<source>
// src attributes plus og:video-style metadata, skipping blob: (MSE) and
// m3u8/mpd manifests that Whisper can't ingest.
function scanPageForVideo() {
  const urls = [];
  const push = (u) => {
    if (u && /^https?:/i.test(u) && !/\.(m3u8|mpd)([?#]|$)/i.test(u)) urls.push(u);
  };
  document.querySelectorAll('video').forEach(v => {
    push(v.currentSrc);
    push(v.src);
    v.querySelectorAll('source').forEach(s => push(s.src));
  });
  ['og:video:secure_url', 'og:video:url', 'og:video', 'twitter:player:stream'].forEach(p => {
    const el = document.querySelector('meta[property="' + p + '"], meta[name="' + p + '"]');
    if (el && el.content) push(el.content);
  });
  const direct = urls.find(u => /\.(mp4|webm|mov|m4v|m4a|mp3|ogg|wav)([?#]|$)/i.test(u)) || urls[0] || null;
  return { url: direct, title: document.title || '' };
}

// Fast hidden reading: the background fetches the video file itself and
// transcribes the whole thing in one Whisper call — no playback, no waiting
// out the video's runtime. On X the file comes from the syndication API; on
// any other site we scan the page for a direct media URL. Falls back to the
// realtime capture path via toasts.
async function autoReadTldr() {
  let tab = null;
  try {
    if (currentActiveTabId) tab = await chrome.tabs.get(currentActiveTabId);
  } catch (err) { /* tab may be gone — re-query below */ }
  if (!tab || !tab.url) {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tab = tabs && tabs[0];
    } catch (err) { /* leave tab null */ }
  }

  const m = tab && tab.url ? tab.url.match(/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/) : null;

  // Off X, scan the page itself for a direct media URL. That needs cross-site
  // access (inject the scanner + let the background download the file) — an
  // optional permission Chrome asks the user for exactly once.
  let payload = null;
  if (m) {
    payload = { action: 'tldrAutoRead', tweetId: m[1], title: tab.title || '' };
  } else {
    if (!tab || !tab.id || !/^https?:/i.test(tab.url || '')) {
      toast('warning', 'Open the page with the video first, or use "Read video (Whisper)".');
      return;
    }
    let granted = false;
    try {
      granted = await chrome.permissions.contains({ origins: ['https://*/*'] });
      if (!granted) granted = await chrome.permissions.request({ origins: ['https://*/*'] });
    } catch (err) { /* treated as denied below */ }
    if (!granted) {
      toast('warning', 'Auto-read outside X needs site access. Allow it when asked, or use "Read video (Whisper)".');
      return;
    }
    let scan = null;
    try {
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scanPageForVideo });
      scan = results && results[0] ? results[0].result : null;
    } catch (err) {
      toast('error', 'Could not read this page. Use "Read video (Whisper)" instead.');
      return;
    }
    if (!scan || !scan.url) {
      toast('warning', 'No downloadable video found on this page (streaming players hide the file). Use "Read video (Whisper)" instead.');
      return;
    }
    payload = { action: 'tldrAutoRead', videoUrl: scan.url, title: scan.title || tab.title || '' };
  }

  const btn = document.getElementById('tldrAutoReadBtn');
  const btnText = document.getElementById('tldrAutoReadBtnText');
  const prevText = btnText ? btnText.textContent : '';
  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'Reading video (hidden)…';

  try {
    const res = await sendMessage(payload);
    if (res && res.success) {
      const area = document.getElementById('tldrResultArea');
      const body = document.getElementById('tldrResultBody');
      const meta = document.getElementById('tldrResultMeta');
      if (body) body.textContent = res.post;
      if (meta) meta.textContent = `${res.post.length} chars · auto-read (${(res.transcriptChars || 0).toLocaleString()} chars transcript) · ${res.provider} · ${res.model}`;
      if (area) area.style.display = 'block';
      toast('success', 'TLDR post ready — copy and share it.');
    } else {
      toast('error', (res && res.error) || 'Auto-read failed. Try "Read video (Whisper)".');
    }
  } catch (err) {
    toast('error', 'Auto-read failed: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = prevText;
  }
}

async function generateTldrPost() {
  const select = document.getElementById('tldrSessionSelect');
  const sessionId = select ? (select.value || 'current') : 'current';
  const captions = await getSessionCaptions(sessionId);
  const lines = transcriptLinesFrom(captions);
  if (lines.length === 0) {
    toast('warning', 'No transcript yet. Press "Read video (Whisper)" and play the video first.');
    return;
  }
  if (ltListening && sessionId === 'current') {
    toast('warning', 'Still reading — for a full-video TLDR, stop reading when the video ends first.');
  }

  // A past session carries the page title it was captured on — give it to the
  // AI as context for what the video is about.
  let title = '';
  if (sessionId !== 'current') {
    try {
      const res = await chrome.storage.local.get(['ltSessionHistory']);
      const found = (res.ltSessionHistory || []).find(s => s.id === sessionId);
      if (found && found.title) title = found.title;
    } catch (err) { /* title is optional context */ }
  }

  const btn = document.getElementById('tldrVideoBtn');
  const btnText = document.getElementById('tldrVideoBtnText');
  const prevText = btnText ? btnText.textContent : '';
  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'Summarizing…';

  try {
    const res = await sendMessage({ action: 'tldrVideo', transcript: lines.join('\n'), title });
    if (res && res.success) {
      const area = document.getElementById('tldrResultArea');
      const body = document.getElementById('tldrResultBody');
      const meta = document.getElementById('tldrResultMeta');
      if (body) body.textContent = res.post;
      if (meta) meta.textContent = `${res.post.length} chars · ${res.provider} · ${res.model}`;
      if (area) area.style.display = 'block';
      toast('success', 'TLDR post ready — copy and share it.');
    } else {
      toast('error', (res && res.error) || 'TLDR failed. Try again.');
    }
  } catch (err) {
    toast('error', 'TLDR failed: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = prevText;
  }
}

function copyTldrPost() {
  const body = document.getElementById('tldrResultBody');
  const text = body ? body.textContent : '';
  if (!text) {
    toast('warning', 'Nothing to copy yet.');
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    toast('success', 'Post copied!');
    const btn = document.getElementById('copyTldrPost');
    if (btn) {
      btn.style.color = 'var(--success)';
      setTimeout(() => { btn.style.color = ''; }, 1500);
    }
  }).catch(() => {
    toast('error', 'Copy failed. Try again.');
  });
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
  } finally {
    // Mark history as loaded and flush any queued subtitle messages
    isHistoryLoaded = true;
    if (pendingSubtitleMessages.length > 0) {
      console.log('[Popup] Flushing', pendingSubtitleMessages.length, 'queued subtitle message(s).');
      const queued = pendingSubtitleMessages.splice(0);
      queued.forEach(msg => {
        appendSubtitleMarkup(msg.original, msg.translated, msg.isUpdate, msg.segmentId);
      });
    }
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

  const isRestricted = isRestrictedUrl(tabUrl);
  const titleText = isRestricted ? 'Capture Restricted on This Page' : 'Could Not Start Captions';
  const icon = isRestricted ? '⚠️' : '🎧';
  const color = isRestricted ? 'var(--warning)' : '#6366f1';

  let descriptionHtml = '';
  let stepsHtml = '';

  if (isRestricted) {
    descriptionHtml = `Chrome policies strictly restrict audio/video capture on system pages (such as <code>chrome://...</code>, Chrome Web Store, or empty new tabs).`;
    stepsHtml = `
      <div style="display: flex; flex-direction: column; gap: 8px; font-size: 11.5px; color: var(--text); line-height: 1.4;">
        <div style="display: flex; align-items: flex-start; gap: 6px;">
          <span style="background: var(--warning); color: #000; width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; flex-shrink: 0; margin-top: 1px;">1</span>
          <span>Please open any standard website containing audio or video (e.g., YouTube.com, X.com, or your learning/movie site).</span>
        </div>
        <div style="display: flex; align-items: flex-start; gap: 6px;">
          <span style="background: var(--warning); color: #000; width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; flex-shrink: 0; margin-top: 1px;">2</span>
          <span>Then open AutoMind from the toolbar icon on that tab and click <b>Start Live Captions</b>.</span>
        </div>
      </div>
    `;
  } else {
    descriptionHtml = `Chrome only lets an extension capture a tab's audio after you have invoked the extension on that tab. Opening AutoMind from the toolbar icon is what grants it.`;
    stepsHtml = `
      <div style="display: flex; flex-direction: column; gap: 8px; font-size: 11.5px; color: var(--text); line-height: 1.4;">
        <div style="display: flex; align-items: flex-start; gap: 6px;">
          <span style="background: #6366f1; color: #fff; width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; flex-shrink: 0; margin-top: 1px;">1</span>
          <span>Click the <b>AutoMind icon in the Chrome toolbar</b> while this tab is open — that grants access to it.</span>
        </div>
        <div style="display: flex; align-items: flex-start; gap: 6px;">
          <span style="background: #6366f1; color: #fff; width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; flex-shrink: 0; margin-top: 1px;">2</span>
          <span>Then press <b>Start Live Captions</b> in the popup that opens.</span>
        </div>
      </div>
    `;
  }

  const titleHtml = `
    <div style="display: flex; align-items: center; gap: 8px; color: ${color}; font-weight: 600; font-size: 13px; margin-bottom: 8px;">
      <span style="font-size: 15px;">${icon}</span>
      <span>${titleText}</span>
    </div>
    <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.45;">
      ${descriptionHtml}
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

// Language display names for the voice panel label
const _LT_LANG_DISPLAY = {
  'en': 'English', 'vi': 'Vietnamese', 'zh': 'Chinese', 'ja': 'Japanese',
  'ko': 'Korean', 'fr': 'French', 'es': 'Spanish', 'de': 'German',
  'ru': 'Russian', 'th': 'Thai', 'hi': 'Hindi', 'ar': 'Arabic',
  'nl': 'Dutch', 'tl': 'Filipino', 'pl': 'Polish', 'bn': 'Bengali',
  'ur': 'Urdu', 'ms': 'Malay', 'fa': 'Persian', 'sw': 'Swahili',
  'uk': 'Ukrainian', 'ro': 'Romanian', 'el': 'Greek', 'he': 'Hebrew',
  'sv': 'Swedish', 'da': 'Danish', 'no': 'Norwegian', 'fi': 'Finnish',
  'cs': 'Czech', 'hu': 'Hungarian', 'sk': 'Slovak', 'bg': 'Bulgarian',
  'hr': 'Croatian', 'sr': 'Serbian', 'ka': 'Georgian', 'az': 'Azerbaijani',
  'kk': 'Kazakh', 'mn': 'Mongolian'
};

// Default voices per language for a natural first-run experience
const _LT_DEFAULT_VOICES = {
  'vi': 'nova', 'en': 'alloy', 'zh': 'echo', 'ja': 'shimmer',
  'ko': 'shimmer', 'fr': 'fable', 'es': 'nova', 'de': 'onyx',
  'ru': 'echo', 'th': 'nova', 'hi': 'coral', 'ar': 'onyx',
  'default': 'alloy'
};

async function updateVoiceGroupVisibility() {
  try {
    const settingsRes = await chrome.storage.sync.get(['ltTtsChromeVoiceMap']);
    const localRes = await chrome.storage.local.get(['ltTtsChromeVoiceMap', 'ltTgtLang', 'ltTtsGender', 'ltTtsEnabled']);
    const ttsEnabled = !!localRes.ltTtsEnabled;
    const chromeGroup = document.getElementById('ltTtsChromeGroup');
    const chromeVoiceGroup = document.getElementById('ltTtsChromeVoiceGroup');

    // The original-audio choice only means anything while TTS is speaking
    const originalAudioRow = document.getElementById('ltTtsOriginalAudioRow');
    if (originalAudioRow) originalAudioRow.style.display = ttsEnabled ? 'flex' : 'none';

    // If TTS is disabled, hide all voice selectors and return early
    if (!ttsEnabled) {
      if (chromeGroup) chromeGroup.style.display = 'none';
      if (chromeVoiceGroup) chromeVoiceGroup.style.display = 'none';
      return;
    }

    // Get current output language
    const lang = document.getElementById('ltTgtLang')?.value
               || localRes.ltTgtLang || 'vi';

    if (chrome.tts && typeof chrome.tts.getVoices === 'function') {
      chrome.tts.getVoices(async (voices) => {
        const targetPrefix = lang.split('-')[0].toLowerCase();
        const matchingVoices = (voices || []).filter(v => {
          if (!v.lang) return false;
          const vPrefix = v.lang.split('-')[0].toLowerCase();
          return vPrefix === targetPrefix;
        });

        if (matchingVoices.length > 0) {
          // Show system voice selection, hide general gender selection
          if (chromeGroup) chromeGroup.style.display = 'none';
          if (chromeVoiceGroup) chromeVoiceGroup.style.display = 'block';

          const chromeVoiceSelect = document.getElementById('ltTtsChromeVoiceSelect');
          const chromeVoiceLangLabel = document.getElementById('ltTtsChromeVoiceLangLabel');
          
          if (chromeVoiceLangLabel) {
            chromeVoiceLangLabel.textContent = _LT_LANG_DISPLAY[lang] || lang.toUpperCase();
          }

          if (chromeVoiceSelect) {
            const storedVoiceMap = Object.assign(
              {},
              settingsRes.ltTtsChromeVoiceMap || {},
              localRes.ltTtsChromeVoiceMap || {}
            );
            const selectedVoice = storedVoiceMap[lang] || '';

            // Clear matching options, keep the first "Default" option
            while (chromeVoiceSelect.options.length > 1) {
              chromeVoiceSelect.remove(1);
            }

            matchingVoices.forEach(v => {
              const opt = document.createElement('option');
              opt.value = v.voiceName;
              const genderStr = v.gender ? ` (${v.gender})` : '';
              opt.textContent = `${v.voiceName}${genderStr}`;
              chromeVoiceSelect.appendChild(opt);
            });

            // Check if selected voice is in the list, otherwise use default ""
            if (matchingVoices.some(v => v.voiceName === selectedVoice)) {
              chromeVoiceSelect.value = selectedVoice;
            } else {
              chromeVoiceSelect.value = '';
            }
          }
        } else {
          // Hide system voice selection, show general gender selection
          if (chromeGroup) chromeGroup.style.display = 'block';
          if (chromeVoiceGroup) chromeVoiceGroup.style.display = 'none';
          
          const ttsGenderSelect = document.getElementById('ltTtsGenderSelect');
          if (ttsGenderSelect) {
            ttsGenderSelect.value = localRes.ltTtsGender || 'female';
          }
        }
      });
    } else {
      // Fallback: No chrome.tts API or list doesn't load
      if (chromeGroup) chromeGroup.style.display = 'block';
      if (chromeVoiceGroup) chromeVoiceGroup.style.display = 'none';
      
      const ttsGenderSelect = document.getElementById('ltTtsGenderSelect');
      if (ttsGenderSelect) {
        ttsGenderSelect.value = localRes.ltTtsGender || 'female';
      }
    }
  } catch (e) {
    console.warn('Failed to update voice group visibility:', e);
  }
}
