console.log('🚀 AutoMind Background Script Loading...');

// First-install onboarding: open options page once with onboarding flag
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.storage.local.set({ onboarding: true, installedAt: Date.now() });
    chrome.runtime.openOptionsPage();
  }
});

// Load proxy URL from shared/secrets.js (gitignored).
// See shared/secrets.example.js for setup instructions.
try {
  importScripts('./secrets.js');
} catch (e) {
  console.warn('[BG] secrets.js not loaded:', e.message);
}
try {
  importScripts('./proxy-client.js');
} catch (e) {
  console.warn('[BG] proxy-client.js not loaded:', e.message);
}
const ADMIN_DEFAULTS = (self.ADMIN_DEFAULTS && typeof self.ADMIN_DEFAULTS === 'object') ? self.ADMIN_DEFAULTS : {};

// PROXY_URL is the only "secret" that ships in extension — it's just a URL, not a key.
// Real API keys live as Cloudflare Worker secrets and never reach the client.
const PROXY_URL = ADMIN_DEFAULTS.proxyUrl || 'https://automind-proxy.dev102vn.workers.dev';
const HAS_PROXY = !!PROXY_URL;

// Legacy bundled keys (only used if proxy is NOT configured — e.g. local dev)
const DEFAULT_KIMI_API_KEY = ADMIN_DEFAULTS.kimiApiKey || '';
const DEFAULT_OPENAI_API_KEY = ADMIN_DEFAULTS.openaiApiKey || '';
const DEFAULT_CLAUDE_API_KEY = ADMIN_DEFAULTS.claudeApiKey || '';
const DEFAULT_GEMINI_API_KEY = ADMIN_DEFAULTS.geminiApiKey || '';

const DEFAULT_PROVIDER = 'openai';
// gpt-4o-mini: cheapest OpenAI model with solid quality
// (~$0.15/1M input, $0.60/1M output — 5x cheaper than gpt-5.4-mini)
const DEFAULT_MODEL = 'gpt-4o-mini';
const DAILY_FREE_QUOTA = 50;

// Validate a default/admin key: non-empty, not the placeholder, sane length.
function isValidDefaultKey(key) {
  if (!key || typeof key !== 'string') return false;
  const trimmed = key.trim();
  if (trimmed.length < 10) return false;
  if (/REPLACE_WITH/i.test(trimmed)) return false;
  return true;
}

// Pick a user-provided key over the admin default, treating whitespace as empty.
function pickKey(userKey, defaultKey) {
  const u = (userKey || '').trim();
  if (u) return u;
  return isValidDefaultKey(defaultKey) ? defaultKey.trim() : '';
}

// Warn admin at startup if the bundled default is still a placeholder.
if (DEFAULT_KIMI_API_KEY && !isValidDefaultKey(DEFAULT_KIMI_API_KEY)) {
  console.warn('⚠️ [BG] DEFAULT_KIMI_API_KEY is still a placeholder. Edit shared/secrets.js with a real key before publishing.');
}

self.addEventListener('unhandledrejection', event => {
  console.error('🚨 Unhandled promise rejection:', event.reason);
  event.preventDefault();
});

// ─── Quota system ──────────────────────────────────────────────────────────
// Counts comment generations + translations. Resets at 0h UTC each day.

function getNextUtcMidnight() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
  return next.getTime();
}

async function getQuotaState() {
  const { quota } = await chrome.storage.local.get('quota');
  const now = Date.now();
  if (!quota || now >= quota.resetAt) {
    return { used: 0, resetAt: getNextUtcMidnight(), limit: DAILY_FREE_QUOTA };
  }
  return { used: quota.used || 0, resetAt: quota.resetAt, limit: DAILY_FREE_QUOTA };
}

async function checkQuota() {
  const state = await getQuotaState();
  if (state.used >= state.limit) {
    return { ok: false, ...state, error: `Out of ${state.limit} free uses for today. Resets at 0h UTC.` };
  }
  return { ok: true, ...state };
}

async function consumeQuota() {
  const state = await getQuotaState();
  const next = { used: state.used + 1, resetAt: state.resetAt };
  await chrome.storage.local.set({ quota: next });
  return { used: next.used, resetAt: next.resetAt, limit: DAILY_FREE_QUOTA };
}

async function getStreamIdWithTimeout(targetTabId, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('getMediaStreamId timeout after ' + timeoutMs + 'ms'));
    }, timeoutMs);

    chrome.tabCapture.getMediaStreamId({ targetTabId }, (streamId) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (chrome.runtime.lastError || !streamId) {
        reject(new Error(chrome.runtime.lastError?.message || 'No stream ID'));
      } else {
        resolve(streamId);
      }
    });
  });
}

// ✅ Minimal AI Detection Patterns - only obvious AI phrases
const AI_DETECTION_PATTERNS = [
  'as an ai', 'i\'m an ai', 'artificial intelligence', 'language model',
  'i don\'t have personal', 'i can\'t experience', 'from my training data'
];

// ✅ ENHANCED: Multi-language detection function
function detectLanguage(text) {
  if (!text) return 'english';

  // Fast-path Unicode check — consistent with language-detector.js
  if (/[\u0e00-\u0e7f]/.test(text)) return 'thai';
  if (/[\uac00-\ud7af]/.test(text)) return 'korean';
  if (/[\u3040-\u30ff]/.test(text)) return 'japanese';
  if (/[\u0600-\u06ff]/.test(text)) return 'arabic';
  if (/[\u0400-\u04ff]/.test(text)) return 'russian';
  if (/[\u0900-\u097f]/.test(text)) return 'hindi';
  if (/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(text)) return 'vietnamese';
  if (/[\u4e00-\u9fff]/.test(text)) return /[\u3040-\u30ff]/.test(text) ? 'japanese' : 'chinese';

  // Check for Spanish and French using a quick word scoring over Latin text
  const cleanText = text.toLowerCase();

  // Spanish specific indicators
  let esScore = 0;
  const esAccents = cleanText.match(/[ñáéíóúü]/g);
  if (esAccents) esScore += esAccents.length * 8;

  const esWords = ['el', 'la', 'de', 'que', 'y', 'a', 'en', 'un', 'ser', 'se', 'no', 'te', 'lo', 'le', 'los', 'las', 'del', 'al', 'por', 'con', 'para', 'sobre', 'entre', 'hasta', 'desde', 'hacia'];
  esWords.forEach(w => {
    const matches = cleanText.match(new RegExp(`\\b${w}\\b`, 'g'));
    if (matches) esScore += matches.length * 4;
  });

  // French specific indicators
  let frScore = 0;
  const frAccents = cleanText.match(/[âäéèêëïîôöùûüÿç]/g);
  if (frAccents) frScore += frAccents.length * 8;

  const frWords = ['le', 'de', 'et', 'il', 'être', 'en', 'avoir', 'que', 'pour', 'dans', 'ce', 'son', 'une', 'sur', 'avec', 'ne', 'se', 'pas', 'tout', 'mais', 'plus', 'par', 'comme'];
  frWords.forEach(w => {
    const matches = cleanText.match(new RegExp(`\\b${w}\\b`, 'g'));
    if (matches) frScore += matches.length * 4;
  });

  if (esScore > frScore && esScore >= 4) return 'spanish';
  if (frScore > esScore && frScore >= 4) return 'french';

  return 'english';
}

// ✅ CRITICAL: Proper async message handler with timeout
try {
console.log('🚀 Background script loaded and ready!');
console.log('🚀 Background script version: 2.0');
console.log('🚀 Background script timestamp:', new Date().toISOString());
console.log('🚀 Background script environment:', typeof window, typeof chrome);

    // Test basic Chrome APIs
    if (typeof chrome !== 'undefined' && chrome.runtime) {
        console.log('✅ Chrome runtime API available');
    } else {
        console.error('❌ Chrome runtime API not available');
    }

    if (typeof chrome !== 'undefined' && chrome.storage) {
        console.log('✅ Chrome storage API available');
    } else {
        console.error('❌ Chrome storage API not available');
    }
} catch (error) {
    console.error('💥 Background script crashed during initialization:', error);
}

// ✅ CRITICAL: Message handler with comprehensive action support
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('📨 [BG] Message received:', request.action);
  console.log('🔍 [BG] Message platform:', request.platform);

  // ✅ Handle ping test
  if (request.action === 'ping') {
    console.log('🏓 [BG] Ping received, responding...');
    sendResponse({ pong: true, timestamp: Date.now() });
    return true;
  }

  if (request.action === 'generateComments') {
    let responded = false;
    const safeSendResponse = (payload) => {
      if (responded) return false;
      responded = true;
      clearTimeout(timeoutId);
      sendResponse(payload);
      return true;
    };

    const timeoutId = setTimeout(() => {
      safeSendResponse({ success: false, error: 'Request timeout. Please try again.', timeout: true });
    }, 30000);

    (async () => {
      try {
        const settings = await getSettings();
        const isDefaultKey = settings.usingDefaultKey;

        // Only enforce quota when using bundled default key
        if (isDefaultKey) {
          const quota = await checkQuota();
          if (!quota.ok) {
            safeSendResponse({ success: false, error: quota.error, quotaExhausted: true, quota });
            return;
          }
        }

        const response = await handleGenerateComments(request);
        if (responded) return;

        // Lock the response channel before doing final quota/storage work so the
        // timeout cannot fire midway and cause quota consumption after a timeout.
        responded = true;
        clearTimeout(timeoutId);

        try {
          if (response.success && isDefaultKey) {
            response.quota = await consumeQuota();
          }
          // Always include quota info so popup can render UI correctly
          if (!response.quota) response.quota = await getQuotaState();
          response.usingDefaultKey = isDefaultKey;
          sendResponse(response);
        } catch (finalizeError) {
          sendResponse({ success: false, error: finalizeError.message || 'Unknown error' });
        }
      } catch (error) {
        safeSendResponse({ success: false, error: error.message || 'Unknown error' });
      }
    })();

    return true;
  }

  if (request.action === 'getQuota') {
    getQuotaState().then(state => sendResponse({ success: true, quota: state }));
    return true;
  }

  // Content scripts cannot call chrome.runtime.openOptionsPage() themselves.
  // This handler was missing, so every "open Settings" link from the X panel
  // silently did nothing.
  if (request.action === 'openOptionsPage') {
    try { chrome.runtime.openOptionsPage(); } catch (e) { console.warn('openOptionsPage failed:', e); }
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'getSettings') {
    getSettings().then(settings => {
      sendResponse({ success: true, data: settings });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.action === 'checkDailyQuota') {
    getSettings().then(async (settings) => {
      const canGenerate = await checkDailyQuota(settings);
      const state = await getQuotaState();
      sendResponse({ success: true, canGenerate, dailyQuota: state.limit });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.action === 'settingsChanged') {
    handleSettingsChange(request.data)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'debugAPI') {
    debugAPIConnection()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'testModelConnection') {
    console.log('🔗 [BG] Received testModelConnection request:', { provider: request.provider, model: request.model });
    testModelConnection(request)
      .then(result => {
        console.log('🔗 [BG] testModelConnection success:', result);
        sendResponse(result);
      })
      .catch(error => {
        console.error('🔗 [BG] testModelConnection failed:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === 'testApiKey') {
    console.log('🔑 [BG] Received testApiKey request:', { provider: request.provider, model: request.model, hasApiKey: !!request.apiKey });
    testApiKey(request)
      .then(result => {
        console.log('🔑 [BG] testApiKey success:', result);
        sendResponse(result);
      })
      .catch(error => {
        console.error('🔑 [BG] testApiKey failed:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  // Options "Test Local" button. This action was sent for a long time with no
  // handler on this side, so the test always died with "Unknown error" no matter
  // whether the server was reachable.
  if (request.action === 'testLocalAI') {
    (async () => {
      try {
        const endpoint = (request.endpoint || '').trim().replace(/\/+$/, '');
        if (!endpoint) {
          sendResponse({ success: false, error: 'No endpoint configured' });
          return;
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        // /models is the cheapest OpenAI-compatible liveness probe (Ollama,
        // LM Studio, vLLM all serve it) — no tokens burned on a completion.
        const resp = await fetch(`${endpoint}/models`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!resp.ok) {
          sendResponse({ success: false, error: `Server responded ${resp.status}` });
          return;
        }
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.name === 'AbortError' ? 'Connection timed out (8s)' : err.message });
      }
    })();
    return true;
  }

  // Debug helper on the Options page — same story: sent, never answered.
  if (request.action === 'resetDailyQuota') {
    (async () => {
      try {
        await chrome.storage.local.remove('quota');
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.action === 'translate') {
    (async () => {
      const settings = await getSettings();
      const isDefaultKey = settings.usingDefaultKey;

      if (isDefaultKey) {
        const quota = await checkQuota();
        if (!quota.ok) {
          sendResponse({ success: false, error: quota.error, quotaExhausted: true, quota });
          return;
        }
      }
      try {
        const result = await translateText(request);
        if (result.success && isDefaultKey) {
          result.quota = await consumeQuota();
        }
        if (!result.quota) result.quota = await getQuotaState();
        result.usingDefaultKey = isDefaultKey;
        sendResponse(result);
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (request.action === 'testAPIConnection') {
    testAPIConnection()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // ✅ ENHANCED: Core testing actions
  if (request.action === 'runFullTest') {
    extensionTester.runFullTest()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'testSettings') {
    extensionTester.testSettings()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'testAIGeneration') {
    extensionTester.testAIGeneration()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'lt_ensure_offscreen') {
    (async () => {
      try {
        await createOffscreenDocument();
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.action === 'lt_capture_ready') {
    console.log('🎙️ [BG] Received lt_capture_ready from offscreen. Syncing listening status.');
    broadcastMessage({ action: 'lt_status', status: 'listening', tabId: activeTabId });
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'lt_error') {
    console.error('❌ [BG] Error reported by offscreen document:', request.error);
    (async () => {
      try {
        await stopTabCapture(activeTabId || 0);
      } catch (stopErr) {
        console.warn('⚠️ [BG] stopTabCapture failed during error handling:', stopErr);
      }
      broadcastMessage({ action: 'lt_error', error: request.error });
    })();
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'lt_tab_start') {
    (async () => {
      try {
        // A start landing within moments of an explicit stop is almost never a
        // human decision — it is the same physical click racing the Stop→Start
        // UI flip (both panels re-label the button the instant the stop
        // broadcast arrives), or a double-click. With two surfaces open this is
        // exactly how "captions restart themselves right after Stop". Only the
        // background sees clicks from every surface, so the cooldown lives here.
        if (Date.now() - _userStoppedAt < START_AFTER_STOP_COOLDOWN_MS) {
          console.log('🎙️ [BG] Ignoring lt_tab_start inside the stop cooldown window (click raced the Stop→Start flip).');
          sendResponse({ success: false, cause: 'stop_cooldown', error: 'Capture was just stopped.' });
          return;
        }

        // This IS the explicit start, so it is the one thing that clears the latch.
        await setUserStopLatch(false);

        const targetTabId = request.tabId;
        const settings = await getSettings();
        const apiKey = settings.apiKey || DEFAULT_OPENAI_API_KEY;
        const openaiApiKey = settings.openaiApiKey || apiKey;

        // Retrieve active ASR Speech Engine from Chrome Storage
        const syncSettings = await chrome.storage.sync.get('ltAsrEngine');
        const asrEngine = syncSettings.ltAsrEngine || 'groq';

        const processStart = async (streamId) => {
          try {
            const res = await startTabCapture(targetTabId, streamId, {
              sourceLang: request.sourceLang || 'auto',
              targetLang: request.targetLang || 'vi',
              apiKey: openaiApiKey,
              ltEngine: request.ltEngine || 'google',
              segmentDuration: request.segmentDuration || 2500, // Default to optimal 2.5s instead of 3.5s
              ltMode: streamId === 'microphone' ? 'microphone' : 'tabCapture',
              ltAsrEngine: asrEngine
            }, 'user-pressed-start');
            sendResponse(res);
          } catch (err) {
            sendResponse({ success: false, error: err.message });
          }
        };

        if (request.streamId) {
          await processStart(request.streamId);
        } else {
          console.log(`🎙️ [BG] No streamId provided. Obtaining from getStreamIdWithTimeout in background for tab: ${targetTabId}`);
          try {
            const streamId = await getStreamIdWithTimeout(targetTabId, 5000);
            await processStart(streamId);
          } catch (err) {
            console.warn('⚠️ [BG] getStreamIdWithTimeout failed:', err.message);
            sendResponse({ success: false, error: err.message });
          }
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.action === 'lt_tab_stop') {
    (async () => {
      try {
        const explicit = !!request.explicit;
        const tabId = activeTabId || 0;

        if (explicit) {
          console.log('🎙️ [BG] Explicit stop requested by user. Terminating captions session.');
          _userStoppedAt = Date.now();
          await setUserStopLatch(true);
          clearReconnectWatchdog();
          isReconnecting = false;
          autoReconnectConfig = null;
          const res = await stopTabCapture(tabId);
          sendResponse(res);
        } else if (!isCapturing || autoStartBlocked() || Date.now() - _userStoppedAt < USER_STOP_GRACE_MS) {
          // The offscreen document tears its tracks down as it closes, and those
          // late "track ended" reports used to re-arm reconnect on a session the
          // user had already stopped — which is how captions came back by
          // themselves after Stop.
          console.log('🎙️ [BG] Ignoring implicit stop: no capture is running (or the user just stopped one).');
          sendResponse({ success: true, ignored: true });
        } else {
          console.log('🎙️ [BG] Implicit stop triggered (audio track ended). Arming auto-reconnect window...');
          armReconnectWatchdog(tabId);
          // Stop offscreen capturing but KEEP isCapturing = true and activeTabId active in background state!
          try {
            chrome.runtime.sendMessage({ target: 'offscreen', action: 'stop_capture' });
          } catch (_) {}
          await closeOffscreenDocument();
          sendResponse({ success: true, reconnecting: true });
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.action === 'lt_get_status') {
    sendResponse({ success: true, status: isCapturing ? 'listening' : 'stopped', tabId: activeTabId });
    return true;
  }

  if (request.action === 'lt_clear_session') {
    (async () => {
      try {
        // Reset captions in active session without ending the session
        const { _currentSession: storedSession } = await chrome.storage.local.get(['_currentSession']);
        const sessionObj = storedSession || _currentSession;
        if (sessionObj) {
          sessionObj.captions = [];
          _currentSession = sessionObj;
          await chrome.storage.local.set({ _currentSession: sessionObj }).catch(() => {});
        }
        console.log('🗑️ [BG] Active session captions cleared by user.');
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.action === 'lt_local_start') {
    isCapturing = true;
    activeTabId = request.tabId;
    chrome.storage.local.set({ isCapturing: true, activeTabId: request.tabId }).catch(() => {});
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'lt_local_stop') {
    (async () => {
      isCapturing = false;
      activeTabId = null;
      chrome.storage.local.set({ isCapturing: false, activeTabId: null, autoReconnectConfig: null }).catch(() => {});
      clearTtsState(); // Clear and stop TTS state immediately on local microphone stop

      // Save active session history log
      const { _currentSession: storedSession } = await chrome.storage.local.get(['_currentSession']);
      const sessionObj = storedSession || _currentSession;
      if (sessionObj && sessionObj.captions && sessionObj.captions.length > 0) {
        sessionObj.endTime = Date.now();
        try {
          const { ltSessionHistory = [] } = await chrome.storage.local.get(['ltSessionHistory']);
          ltSessionHistory.unshift(sessionObj);
          if (ltSessionHistory.length > 50) ltSessionHistory.pop();
          await chrome.storage.local.set({ ltSessionHistory });
          console.log(`🎙️ [BG] Saved session history log (mic): ${sessionObj.id} with ${sessionObj.captions.length} captions.`);
        } catch (err) {
          console.warn('⚠️ [BG] Failed to save session history (mic):', err);
        }
      }
      _currentSession = null;
      await chrome.storage.local.remove('_currentSession').catch(() => {});

      sendResponse({ success: true });
    })();
    return true;
  }

  if (request.action === 'lt_process_audio') {
    (async () => {
      try {
        const { audioBase64, config, seq, hasSound, maxRms, avgRms, durationMs } = request;
        if (!audioBase64) {
          sendResponse({ success: true, empty: true });
          return;
        }

        const tabId = activeTabId || 0;
        if (!self.ltSessions) self.ltSessions = {};
        if (!self.ltSessions[tabId]) {
          self.ltSessions[tabId] = {
            chunks: [],
            lastText: '',
            lastTimestamp: Date.now(),
            history: [],
            segmentId: 'seg_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            nextExpectedSeq: 0,
            transcriptionBuffer: {}
          };
          await saveLtSessions();
        }

        const session = self.ltSessions[tabId];
        if (session.nextExpectedSeq === undefined) {
          session.nextExpectedSeq = 0;
        }
        if (!session.transcriptionBuffer) {
          session.transcriptionBuffer = {};
        }

        // Start transcription in parallel immediately!
        transcribeAudioSegmentConcurrently(audioBase64, config, seq !== undefined ? seq : 0, session, tabId, hasSound, maxRms, avgRms, durationMs);

        sendResponse({ success: true });
      } catch (err) {
        console.error('❌ [BG] Error handling parallel audio segment:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }



  if (request.action === 'lt_stop_tts') {
    try {
      clearTtsState();
      sendResponse({ success: true });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
    return true;
  }


  // Set the original stream's playback volume to an arbitrary level. Used when
  // TTS is toggled or its "Original audio" choice changes mid-session, which
  // previously only took effect on the next capture.
  if (request.action === 'tldrVideo') {
    (async () => {
      try {
        sendResponse(await handleTldrVideo(request));
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.action === 'tldrAutoRead') {
    (async () => {
      try {
        sendResponse(await handleTldrAutoRead(request));
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.action === 'lt_playback_volume') {
    (async () => {
      try {
        const volume = typeof request.volume === 'number' ? request.volume : 1.0;
        chrome.runtime.sendMessage({
          target: 'offscreen',
          action: 'setplaybackvolume',
          volume: volume
        }).catch(() => {});
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.action === 'ltmutetab') {
    (async () => {
      try {
        const volume = request.mute ? 0.0 : 1.0;
        chrome.runtime.sendMessage({
          target: 'offscreen',
          action: 'setplaybackvolume',
          volume: volume
        }).catch(() => {});
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ─── Streaming ASR ("dịch cabin") ──────────────────────────────────────────
  // Translation is emitted in phrase-sized pieces as the speaker talks, not once
  // per finished sentence. Waiting for the sentence is what made the rhythm break:
  // the source words scrolled continuously while the translation arrived in one
  // lump at the end, so both reading and listening stalled and then jumped.
  // A human interpreter does the same thing — render a unit of meaning as soon as
  // there is enough of it, and let the next unit continue from it.
  // Partial wording, still being revised. Put it on screen immediately: this is
  // the whole reason for streaming, and it costs no API call. Deliberately NOT
  // translated — a machine translation of half a clause is worse than showing
  // the speaker's own words until the wording settles.
  if (request.action === 'lt_stream_interim') {
    (async () => {
      try {
        await handleCabinInterim(request);
        sendResponse({ success: true });
      } catch (err) {
        console.error('❌ [BG] cabin interim failed:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // Settled wording. Translate it now — no chunk accumulation and no sentence
  // hold, because the recogniser's own endpointing already decided this is a
  // sentence boundary. That is what removes ~5s from the batch path.
  if (request.action === 'lt_stream_final') {
    (async () => {
      try {
        const cfg = request.config || {};
        const tabId = activeTabId;
        if (!tabId) { sendResponse({ success: false, error: 'no active tab' }); return; }
        if (!self.ltSessions) self.ltSessions = {};
        if (!self.ltSessions[tabId]) {
          self.ltSessions[tabId] = {
            chunks: [], lastText: '', lastTimestamp: Date.now(), history: [],
            segmentId: 'seg_' + Date.now() + '_' + Math.floor(Math.random() * 1000)
          };
        }
        const session = self.ltSessions[tabId];
        const activeTopic = _cachedTopic || 'general';

        let text = cleanAndPrecorrectOriginalText(request.text, activeTopic);
        text = cleanConsecutiveDuplicates(text);
        if (!text || !text.trim()) { sendResponse({ success: true, filtered: true }); return; }

        // The streaming recogniser is listening to the same audio the batch path
        // gated on loudness, but gives us no RMS. Treat settled speech as real
        // speech: it reached an endpoint, which silence does not.
        if (isWhisperHallucination(text, true) || isRepetitionOfHistory(text, session.history || [])) {
          console.log('🎙️ [BG] Streaming segment filtered:', text.trim());
          session._utteranceStartedAt = 0;
          sendResponse({ success: true, filtered: true });
          return;
        }

        // How long this utterance actually took to say, measured from the first
        // partial. The overlay uses it to hold the line for its spoken length.
        const startedAt = session._utteranceStartedAt || 0;
        session.audioMs = startedAt ? Math.min(Date.now() - startedAt, 15000) : 0;
        session._utteranceStartedAt = 0;

        // Most of this utterance has already been translated phrase by phrase
        // while it was being spoken. Only the tail is left — translating the
        // whole thing again here would replay what the viewer has already read
        // and the voice has already said.
        const st = cabinState(session);
        const allWords = text.split(/\s+/).filter(Boolean);
        const remainder = allWords.slice(st.committed).join(' ');

        if (remainder.trim()) {
          const piece = (await translateCabinPhrase(remainder, session, cfg) || '').trim();
          if (piece) {
            st.translated = st.translated ? `${st.translated} ${piece}` : piece;
            if (_cachedTtsEnabled) {
              speakSubtitle(piece, cfg.targetLang || 'vi', _cachedTtsSpeed || 1.25, remainder, session.segmentId, (session.subtitleSeq = (session.subtitleSeq || 0) + 1));
            }
          }
        }

        const finalLine = st.translated.trim();
        session._cabin = null;
        session._utteranceStartedAt = 0;

        if (finalLine) {
          if (!session.history) session.history = [];
          session.history.push({ original: text, translated: finalLine });
          if (session.history.length > 5) session.history.shift();
          await updateCaptionHistoryInStorage(text, finalLine);
          session.segmentId = 'seg_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
          broadcastMessage({
            action: 'lt_cabin_line',
            translated: finalLine,
            original: text,
            tail: '',
            targetLang: cfg.targetLang || 'vi',
            durationMs: session.audioMs || 0,
            done: true
          });
        }
        await saveLtSessions();
        sendResponse({ success: true });
      } catch (err) {
        console.error('❌ [BG] lt_stream_final failed:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.action === 'lt_stream_state') {
    if (request.state === 'reconnecting') {
      notifyDegraded('asr-reconnect', 'Mất kết nối ASR — đang kết nối lại');
    }
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'lt_process_text') {
    (async () => {
      try {
        const { text, sourceLang, targetLang, ltEngine } = request;
        if (!text || !text.trim()) {
          sendResponse({ success: true, empty: true });
          return;
        }

        console.log(`🎙️ [BG] lt_process_text received raw Web Speech transcript: "${text}"`);

        const tabId = request.tabId || activeTabId || (sender && sender.tab ? sender.tab.id : null);
        if (!tabId) {
          sendResponse({ success: false, error: 'No active tab session' });
          return;
        }

        // Initialize session if not present
        if (!self.ltSessions) self.ltSessions = {};
        if (!self.ltSessions[tabId]) {
          self.ltSessions[tabId] = {
            chunks: [],
            lastText: '',
            segmentId: 'seg_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            lastTimestamp: Date.now(),
            history: []
          };
          await saveLtSessions();
        }
        const session = self.ltSessions[tabId];

        // Read active topic snapshot from chrome storage
        const storageData = await chrome.storage.local.get(['ltTopic']);
        const activeTopic = storageData.ltTopic || 'general';

        // Clean duplicates and stammering just like transcribe output
        let cleanedText = cleanAndPrecorrectOriginalText(text, activeTopic);
        cleanedText = cleanConsecutiveDuplicates(cleanedText);

        if (!cleanedText || !cleanedText.trim()) {
          sendResponse({ success: true, filtered: true });
          return;
        }

        // Check if pause threshold crossed
        const pauseThreshold = 2000;
        const isPause = Date.now() - session.lastTimestamp > pauseThreshold;
        if (isPause && session.chunks.length > 0) {
          await finalizeAndTranslateSentence(session, sourceLang, targetLang, ltEngine, activeTopic);
        }

        session.lastTimestamp = Date.now();

        // Split sentences and push them to chunks
        const splitIntoSentences = (text) => {
          if (!text) return [];
          return text.split(/(?<=[.!?。！？])\s+(?=\S)/).map(s => s.trim()).filter(s => s.length > 0);
        };

        const sentences = splitIntoSentences(cleanedText);
        for (const sentence of sentences) {
          if (session.chunks.length >= 3) {
            await finalizeAndTranslateSentence(session, sourceLang, targetLang, ltEngine, activeTopic);
          }
          session.chunks.push(sentence);
        }

        let fullOriginalText = session.chunks.join(' ');
        fullOriginalText = cleanIncompletePunctuation(fullOriginalText);
        fullOriginalText = cleanConsecutiveDuplicates(fullOriginalText);

        // Keep session memory synchronized and split as individual sentences
        session.chunks = splitIntoSentences(fullOriginalText);

        const endsWithPunctuation = /[.!?。！？]$/.test(fullOriginalText.trim());
        const hasMultipleSentences = /[.!?。！？]\s+(?=\S)/.test(fullOriginalText);
        const incomplete = isSemanticallyIncomplete(fullOriginalText) && !endsWithPunctuation;
        const wordCount = fullOriginalText.split(/\s+/).length;

        const shouldFinalize = endsWithPunctuation || hasMultipleSentences || !incomplete || (wordCount >= 20);

        if (shouldFinalize) {
          await finalizeAndTranslateSentence(session, sourceLang, targetLang, ltEngine, activeTopic);
        } else {
          await saveLtSessions();
        }

        sendResponse({ success: true });
      } catch (err) {
        console.error('❌ [BG] Error in lt_process_text handler:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.action === 'lt_subtitle') {
    (async () => {
      try {
        if (request.mode === 'microphone') {
          const settings = await chrome.storage.local.get(['ltTtsEnabled', 'ltTtsSpeed']);
          if (settings.ltTtsEnabled) {
            const targetSpeed = parseFloat(settings.ltTtsSpeed) || 1.25;
            speakSubtitle(request.translated, request.targetLang, targetSpeed);
          }
        }
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // Default response
  sendResponse({ success: false, message: 'Unknown action: ' + request.action });
  return true;
});

// ✅ ENHANCED: Handle generation with comprehensive error handling
async function handleGenerateComments(request) {
  console.log('🎯 Starting generation process...');

  try {
    // Extract data from both supported request shapes:
    // 1) direct: { action, postContent, isReply, ... }
    // 2) nested: { action, data: { postContent, isReply, ... }, settings }
    const payload = (request.data && typeof request.data === 'object') ? request.data : request;
    const postContent = request.postContent || payload.postContent || payload.text || payload.content || '';
    const contentObj = {
      postContent,
      isReply: !!payload.isReply,
      originalPost: payload.originalPost || null,
      replyTo: payload.replyTo || null,
      imageUrl: request.imageUrl || payload.imageUrl || null,
      videoUrl: request.videoUrl || payload.videoUrl || null
    };

    // Step 1: Validate input
    if (!postContent || postContent.trim().length === 0) {
      throw new Error('No post content provided');
    }

    console.log('📄 Post content length:', postContent.length);

    // Step 2: Load settings with validation. Allow internal one-off overrides
    // (e.g. regenerate a single tone) without dropping stored API/provider config.
    console.log('⚙️ Loading settings...');
    const storedSettings = await getSettings();
    let settings = { ...storedSettings, ...(request.settings || {}) };
    // Route reply-writing to its dedicated provider/model if configured
    settings = await applyTaskRouting(settings, 'write');

    if (!settings) {
      throw new Error('Failed to load extension settings');
    }

    console.log('⚙️ Settings loaded:', {
      provider: settings.apiProvider,
      hasKey: !!settings.apiKey,
      model: settings.selectedModel,
      tones: settings.selectedTones?.length
    });

    // Skip key check when proxy is configured AND user is on default key
    // (proxy holds the real key server-side)
    const willUseProxy = HAS_PROXY && settings.usingDefaultKey && settings.apiProvider !== 'local';
    if (!settings.apiKey && !willUseProxy) {
      throw new Error(`${settings.apiProvider.toUpperCase()} API key not configured. Please set up your API key in extension settings.`);
    }

    // Step 3: Check quota
    console.log('📊 Checking daily quota...');
    const canGenerate = await checkDailyQuota(settings);
    if (!canGenerate) {
      throw new Error('Daily quota exceeded. Please try again tomorrow or increase your quota in settings.');
    }

    // Step 4: Get training insights
    console.log('🧠 Loading training insights...');
    const trainingInsights = await getTrainingInsights();

    // Step 5: Generate comments
    console.log('🤖 Generating AI comments...');
    const comments = await generateCommentsWithAI(
      contentObj,
      settings,
      trainingInsights
    );

    if (!comments || Object.keys(comments).length === 0) {
      throw new Error('AI failed to generate any comments');
    }

    // Separate the fallback markers from the actual reply map
    const usedFallback = !!comments.__fallback;
    const fallbackReason = comments.__fallbackReason || '';
    delete comments.__fallback;
    delete comments.__fallbackReason;
    if (usedFallback) {
      console.warn('⚠️ Returning CANNED fallback replies — the AI call did not succeed:', fallbackReason);
    }

    // Step 6: Update usage stats (canned fallbacks are not a real generation)
    if (!usedFallback) {
      console.log('📈 Updating usage stats...');
      await updateUsageStats();
    }

    // Step 7: Return success response
    const response = {
      success: true,
      data: comments,
      usedFallback,
      fallbackReason,
      apiProvider: settings.apiProvider,
      model: settings.selectedModel,
      language: settings.language,
      trainingOptimized: !!trainingInsights,
      timestamp: Date.now(),
      commentCount: Object.keys(comments).length
    };

    console.log('✅ Generation successful:', {
      commentCount: response.commentCount,
      provider: response.apiProvider,
      model: response.model
    });

    return response;

  } catch (error) {
    console.error('❌ Generation error:', error);

    // ✅ Enhanced error reporting
    const errorResponse = {
      success: false,
      error: error.message || 'Unknown error occurred',
      errorType: error.name || 'GenerationError',
      timestamp: Date.now()
    };

    // Add specific error details for debugging
    if (error.message.includes('API key')) {
      errorResponse.errorCategory = 'configuration';
      errorResponse.suggestion = 'Please check your API key in extension settings';
    } else if (error.message.includes('quota')) {
      errorResponse.errorCategory = 'quota';
      errorResponse.suggestion = 'Increase your daily quota or try again tomorrow';
    } else if (error.message.includes('network') || error.message.includes('fetch')) {
      errorResponse.errorCategory = 'network';
      errorResponse.suggestion = 'Check your internet connection and try again';
    } else {
      errorResponse.errorCategory = 'unknown';
      errorResponse.suggestion = 'Please try again or contact support';
    }

    return errorResponse;
  }
}
// ✅ ROBUST: Settings loading with comprehensive error handling
async function getSettings() {
  return new Promise((resolve, reject) => {
    try {
      const timeout = setTimeout(() => {
        reject(new Error('Settings loading timeout'));
      }, 5000);

      chrome.storage.sync.get([
        'claudeApiKey', 'openaiApiKey', 'geminiApiKey', 'kimiApiKey', 'deepseekApiKey', 'nvidiaApiKey', 'localApiKey',
        'apiProvider', 'selectedModel', 'customEndpoint', 'apiKey', 'aiMode',
        'customPrompt', 'selectedTones', 'language', 'promptType', 'commentLength',
        'userSettings'
      ], (result) => {
        clearTimeout(timeout);

        // ✅ Check for Chrome API errors
        if (chrome.runtime.lastError) {
          console.error('❌ Chrome storage error:', chrome.runtime.lastError);
          reject(new Error(`Storage error: ${chrome.runtime.lastError.message}`));
          return;
        }

        try {
          // aiMode: 'system' = use AutoMind free tier (50/day, via proxy)
          //        'custom' = user provided their own key for the chosen provider
          // Default = 'system' for new users.
          const aiMode = result.aiMode || 'system';
          let provider = result.apiProvider || DEFAULT_PROVIDER;

          // In system mode, always use the default provider (don't let stale per-provider
          // setting leak through). User key is ignored even if present.
          if (aiMode === 'system') provider = DEFAULT_PROVIDER;

          // The model has to be pinned alongside the provider. Forcing only the
          // provider left a stale model from a previous provider in place — e.g.
          // switching from DeepSeek to Free tier sent
          // {provider:'openai', model:'deepseek-v4-flash'}, which the API rejects
          // with 404 model_not_found, so every generation silently fell back to
          // canned replies.
          let resolvedModel = result.selectedModel || getDefaultModel(provider);
          if (aiMode === 'system') {
            resolvedModel = DEFAULT_MODEL;
          } else if (!isModelValidForProvider(resolvedModel, provider)) {
            console.warn(`⚠️ Stored model "${resolvedModel}" does not belong to provider "${provider}" — falling back to its default.`);
            resolvedModel = getDefaultModel(provider);
          }

          let apiKey = '';
          let userKey = ''; // raw key user typed in storage (no fallback)
          if (aiMode === 'custom') {
            switch(provider) {
              case 'claude':   userKey = (result.claudeApiKey || result.apiKey || '').trim(); break;
              case 'openai':   userKey = (result.openaiApiKey || '').trim(); break;
              case 'gemini':   userKey = (result.geminiApiKey || '').trim(); break;
              case 'kimi':     userKey = (result.kimiApiKey || '').trim(); break;
              case 'deepseek': userKey = (result.deepseekApiKey || '').trim(); break;
              case 'nvidia':   userKey = (result.nvidiaApiKey || '').trim(); break;
              case 'local':    userKey = (result.localApiKey || '').trim(); break;
            }
            apiKey = userKey;
          }
          // System mode: apiKey stays empty (proxy provides it server-side).
          // Custom mode: apiKey is user's key.

          const usingDefaultKey = aiMode === 'system' && HAS_PROXY;

          // ✅ FIX: Use tones from userSettings if available
          let selectedTones = result.selectedTones;
          if (result.userSettings && result.userSettings.selectedTones) {
            selectedTones = result.userSettings.selectedTones;
            console.log('✅ Background: Using tones from userSettings:', selectedTones);
            console.log('✅ Background: UserSettings tones count:', selectedTones.length);
          }

          const settings = {
            aiMode,
            apiProvider: provider,
            apiKey: apiKey || '',
            usingDefaultKey, // true → enforce 50/day quota; false → unlimited
            selectedModel: resolvedModel,
            customEndpoint: result.customEndpoint || '',
            customPrompt: result.customPrompt || '',
            selectedTones: selectedTones || ['professional', 'casual', 'sarcastic', 'witty', 'analytical', 'contrarian'],
            language: result.language || 'auto',
            promptType: result.promptType || 'default',
            commentLength: result.commentLength || 'medium'
          };

          // ✅ Validate settings
          if (!settings.selectedTones || settings.selectedTones.length === 0) {
            settings.selectedTones = ['professional', 'casual', 'sarcastic', 'contrarian'];
          }

          console.log('✅ Settings validated successfully');
          resolve(settings);

        } catch (parseError) {
          console.error('❌ Settings parsing error:', parseError);
          reject(new Error(`Settings parsing failed: ${parseError.message}`));
        }
      });
    } catch (error) {
      console.error('❌ Settings loading error:', error);
      reject(error);
    }
  });
}

function getDefaultModel(provider) {
  // Updated May 2026 — only currently supported, non-deprecated defaults.
  const defaults = {
    claude:   'claude-haiku-4-5-20251001', // fast + cheap, good multilingual
    openai:   DEFAULT_MODEL,               // gpt-4o-mini
    gemini:   'gemini-3.1-flash-preview',  // free tier friendly
    kimi:     'moonshot-v1-32k',           // OpenAI-compatible, fast, cheap
    deepseek: 'deepseek-v4-flash',         // cheapest DeepSeek option
    nvidia:   'nvidia/llama-3.1-nemotron-51b-instruct', // signature NVIDIA model
    local:    'auto'
  };
  return defaults[provider] || DEFAULT_MODEL;
}

// Guards against a model belonging to one provider being sent to another —
// the API answers 404 model_not_found and the whole generation silently
// degrades to canned fallback replies.
const MODEL_PREFIXES = {
  openai:   [/^gpt-/i, /^o[1-9]/i],
  claude:   [/^claude-/i],
  gemini:   [/^gemini-/i],
  kimi:     [/^moonshot-/i, /^kimi-/i],
  deepseek: [/^deepseek-/i],
  nvidia:   [/\//],           // NIM ids are namespaced, e.g. "meta/llama-3.3-70b-instruct"
  local:    [/./]             // anything goes on a self-hosted server
};

function isModelValidForProvider(model, provider) {
  if (!model) return false;
  const rules = MODEL_PREFIXES[provider];
  if (!rules) return true; // unknown provider — don't block the user
  return rules.some(re => re.test(model));
}

// ─── Per-task API routing ───────────────────────────────────────────────
// Lets the user route each task (reply writing vs translation) to a different
// provider/model in Options → AI. Only meaningful in custom-key mode: in
// system (free-tier) mode the proxy holds one server-side key, so overrides
// are ignored. Falls back to the main provider when the routed provider has
// no API key configured.
async function applyTaskRouting(settings, task) {
  if (settings.aiMode !== 'custom') return settings;
  try {
    const r = await chrome.storage.sync.get([
      'writeProvider', 'writeModel', 'translateProvider', 'translateModel',
      'claudeApiKey', 'openaiApiKey', 'geminiApiKey', 'kimiApiKey',
      'deepseekApiKey', 'nvidiaApiKey', 'localApiKey', 'apiKey'
    ]);
    const provider = task === 'write' ? (r.writeProvider || '') : (r.translateProvider || '');
    const model = task === 'write' ? (r.writeModel || '') : (r.translateModel || '');

    if (!provider) {
      // No provider override — allow a model-only override on the main provider,
      // but only if that model actually belongs to it.
      if (!model) return settings;
      if (!isModelValidForProvider(model, settings.apiProvider)) {
        console.warn(`⚠️ Task routing (${task}): model "${model}" is not a ${settings.apiProvider} model — ignoring the override.`);
        return settings;
      }
      return { ...settings, selectedModel: model };
    }

    const keyMap = {
      claude: (r.claudeApiKey || r.apiKey || ''),
      openai: (r.openaiApiKey || ''),
      gemini: (r.geminiApiKey || ''),
      kimi: (r.kimiApiKey || ''),
      deepseek: (r.deepseekApiKey || ''),
      nvidia: (r.nvidiaApiKey || ''),
      local: (r.localApiKey || '')
    };
    const key = (keyMap[provider] || '').trim();
    if (!key && provider !== 'local') {
      console.warn(`⚠️ Task routing (${task}): no API key for "${provider}" — using main provider instead.`);
      return settings;
    }
    const routedModel = (model && isModelValidForProvider(model, provider))
      ? model
      : getDefaultModel(provider);
    if (model && routedModel !== model) {
      console.warn(`⚠️ Task routing (${task}): "${model}" is not a ${provider} model — using ${routedModel} instead.`);
    }
    console.log(`🔀 Task routing (${task}): ${settings.apiProvider} → ${provider} (${routedModel})`);
    return {
      ...settings,
      apiProvider: provider,
      apiKey: key,
      selectedModel: routedModel
    };
  } catch (e) {
    console.warn('⚠️ Task routing failed, using main provider:', e);
    return settings;
  }
}

// ✅ ROBUST: Generate comments with comprehensive error handling
async function generateCommentsWithAI(contentObj, settings, trainingInsights = null) {
  console.log('🤖 Starting AI generation...');

  try {
    const { apiProvider, apiKey, selectedModel, customEndpoint, usingDefaultKey } = settings;

    // Step 1: Build prompt
    console.log('📝 Building prompt...');
    const prompt = await buildPrompt(contentObj, settings, trainingInsights);

    if (!prompt || prompt.trim().length === 0) {
      throw new Error('Failed to build prompt');
    }

    console.log('📝 Prompt built successfully, length:', prompt.length);

    // Step 2: Configure API settings
    let apiConfig = {
      max_tokens: 800,
      temperature: 0.8,
      commentLength: settings.commentLength || 'medium'
    };

    // Provider-specific optimizations
    switch (apiProvider) {
      case 'claude':
        apiConfig.temperature = 0.7;
        apiConfig.max_tokens = 1000;
        break;
      case 'openai':
        apiConfig.temperature = 0.8;
        apiConfig.max_tokens = 800;
        break;
      case 'gemini':
        apiConfig.temperature = 0.9;
        apiConfig.max_tokens = 1200;
        break;
      case 'kimi':
        // Kimi K2 family (especially K2.6 thinking) only accepts temperature: 1
        apiConfig.temperature = 1;
        apiConfig.max_tokens = 1000;
        break;
    }

    // Adjust based on training insights
    if (trainingInsights) {
      if (trainingInsights.averageRating > 4.0) {
        apiConfig.temperature = Math.max(0.6, apiConfig.temperature - 0.1);
      } else if (trainingInsights.averageRating < 3.0) {
        apiConfig.temperature = Math.min(1.0, apiConfig.temperature + 0.2);
      }
      console.log('🎯 Adjusted temperature based on feedback:', apiConfig.temperature);
    }

    // Step 3: Call AI API — via proxy if using default key, direct if user provided their own
    console.log(`🔗 Calling ${apiProvider} API... (proxy=${usingDefaultKey && HAS_PROXY})`);
    let rawResponse;

    if (usingDefaultKey && HAS_PROXY && apiProvider !== 'local') {
      rawResponse = await callViaProxy(apiProvider, selectedModel, prompt, apiConfig);
    } else {
      switch (apiProvider) {
        case 'claude':
          rawResponse = await callClaudeAPI(apiKey, selectedModel, prompt, contentObj, apiConfig);
          break;
        case 'openai':
          rawResponse = await callOpenAIAPI(apiKey, selectedModel, prompt, contentObj, apiConfig);
          break;
        case 'gemini':
          rawResponse = await callGeminiAPI(apiKey, selectedModel, prompt, contentObj, apiConfig);
          break;
        case 'kimi':
          rawResponse = await callKimiAPI(apiKey, selectedModel, prompt, apiConfig);
          break;
        case 'deepseek':
          rawResponse = await callDeepSeekAPI(apiKey, selectedModel, prompt, apiConfig);
          break;
        case 'nvidia':
          rawResponse = await callNvidiaAPI(apiKey, selectedModel, prompt, apiConfig);
          break;
        case 'local':
          rawResponse = await callLocalAPI(customEndpoint, selectedModel, prompt, apiKey, apiConfig);
          break;
        default:
          throw new Error(`Unsupported AI provider: ${apiProvider}`);
      }
    }

    if (!rawResponse) {
      throw new Error('AI API returned empty response');
    }

    // Step 4: Post-process response to remove AI patterns
    console.log('🧹 Post-processing response...');
    const processedResponse = postProcessResponse(rawResponse);

    if (!processedResponse || Object.keys(processedResponse).length === 0) {
      console.warn('⚠️ Post-processing resulted in empty response, using raw response');
      return rawResponse;
    }

    console.log('✅ AI generation completed successfully');
    return processedResponse;

  } catch (error) {
    console.error('❌ AI generation failed:', error);

    // One retry before surrendering to canned fallbacks — most failures are
    // transient network/rate-limit blips and a single retry recovers them.
    if (!settings._isRetry) {
      console.log('🔁 Retrying AI generation once...');
      await new Promise(r => setTimeout(r, 800));
      try {
        return await generateCommentsWithAI(contentObj, { ...settings, _isRetry: true }, trainingInsights);
      } catch (_) { /* fall through to fallbacks */ }
    }

    // ✅ Always return valid fallback responses — matched to the post's language
    // so a Vietnamese tweet never gets generic English canned replies.
    //
    // These are canned strings, NOT AI output: they are identical for every
    // tweet. Tag them so the UI can say so instead of silently passing them
    // off as generated replies.
    console.log('🔧 Using fallback responses due to error');
    const fallbacks = await getTrainingOptimizedFallbacks(contentObj.postContent, settings.language);
    const wanted = settings.selectedTones && settings.selectedTones.length
      ? settings.selectedTones
      : Object.keys(fallbacks);
    const trimmed = {};
    wanted.forEach(t => { if (fallbacks[t]) trimmed[t] = fallbacks[t]; });
    return {
      __fallback: true,
      __fallbackReason: error.message || 'AI request failed',
      ...(Object.keys(trimmed).length ? trimmed : fallbacks)
    };
  }
}

// ✅ ENHANCED: Build prompt with automatic language detection
async function buildPrompt(contentObj, settings, trainingInsights = null) {
  try {
    const { postContent, isReply, originalPost, replyTo } = contentObj;
    const selectedTones = settings.selectedTones || ['professional', 'casual', 'sarcastic', 'contrarian'];

    // ✅ CONVERSATION CONTEXT: Retrieve live conversation context from active translation session if available
    let liveConversationContext = '';
    try {
      const { _currentSession: storedSession } = await chrome.storage.local.get(['_currentSession']);
      const sessionObj = storedSession || _currentSession;
      if (sessionObj && sessionObj.captions && sessionObj.captions.length > 0) {
        // Get last 20 captions for context to keep prompt compact but high-signal
        const lastCaptions = sessionObj.captions.slice(-20);
        const transcriptLines = lastCaptions.map(c => `[${c.time}] Original: "${c.original}"${c.translated ? ` | Translated: "${c.translated}"` : ''}`).join('\n');
        liveConversationContext = `\n\nLIVE CONVERSATION CONTEXT (AMA/LIVESTREAM/SPACES DISCUSSION):\n${transcriptLines}\n(Use this live conversation context to make your generated replies highly relevant to what is currently being discussed in the space or livestream, especially if the post/tweet itself lacks detailed context)`;
        console.log('🎙️ [BG] Loaded live conversation context with', lastCaptions.length, 'captions.');
      }
    } catch (e) {
      console.warn('⚠️ Failed to load live conversation context for prompt:', e);
    }

    // ✅ REPLY FOCUS: Determine content to focus on
    const targetContent = isReply ? postContent : postContent;
    const contextContent = isReply ? originalPost : null;

    // ✅ HYBRID LANGUAGE DETECTION: Unicode-based detection runs locally first.
    // For non-Latin scripts (Vietnamese diacritics, CJK, Thai, Arabic...) it is
    // essentially always right, so we give the model an EXPLICIT directive
    // instead of hoping "same language as the tweet" is honored. For plain
    // Latin text we fall back to letting the model decide.
    // A forced language from Settings always wins; otherwise auto-detect.
    const forcedLanguage = (settings.language && settings.language !== 'auto') ? settings.language : null;
    let detectedLanguage = forcedLanguage || detectLanguage(targetContent || postContent);
    console.log('🌐 BuildPrompt - Reply language:', detectedLanguage, forcedLanguage ? '(forced by settings)' : '(auto-detected)');

    console.log('BuildPrompt - Final language setting:', detectedLanguage);
    console.log('BuildPrompt - Is Reply:', isReply);
    console.log('BuildPrompt - Target Content:', targetContent?.substring(0, 100) + '...');
    console.log('BuildPrompt - Context Content:', contextContent?.substring(0, 100) + '...');
    console.log('BuildPrompt - Replying to:', replyTo);
    console.log('BuildPrompt - Selected Tones:', selectedTones);
    console.log('BuildPrompt - Selected Tones Count:', selectedTones.length);

    if (!targetContent || targetContent.trim().length === 0) {
      throw new Error('No content to build prompt from');
    }
    if (!selectedTones || selectedTones.length === 0) {
      throw new Error('No tones selected for generation');
    }

    let optimizedTones = selectedTones;
    if (trainingInsights && trainingInsights.bestTones) {
      optimizedTones = [
        ...trainingInsights.bestTones.filter(tone => selectedTones.includes(tone)),
        ...selectedTones.filter(tone => !trainingInsights.bestTones.includes(tone))
      ];
      console.log('BuildPrompt - Optimized Tones (with training):', optimizedTones);
    }

    console.log('BuildPrompt - Final Tones Count:', optimizedTones.length);
    const jsonKeys = optimizedTones.map(tone => `  "${tone}": "..."`).join(',\n');
    const imageNote = '';

    // ✅ AI AUTO-DETECTION: No manual language mapping needed
    console.log('BuildPrompt - AI will automatically detect and respond in the correct language');

    // ✅ REPLY FOCUS: Build different prompt for replies vs original posts
    const taskDescription = isReply ?
      `Generate EXACTLY ${optimizedTones.length} crypto-vibe REPLIES to this specific comment` :
      `Generate EXACTLY ${optimizedTones.length} crypto-vibe comments for this post`;

    const contentSection = isReply ?
      `COMMENT BEING REPLIED TO: "${targetContent}"${contextContent ? `\n\nORIGINAL POST CONTEXT: "${contextContent}"\n(This is the main post that the comment is replying to)` : ''}${imageNote}` :
      `POST CONTENT: "${targetContent}"${imageNote}`;

    const contentReference = isReply ?
      'Directly address the specific comment content and author' :
      'Reference specific details from the post content';

    // ✅ LENGTH CONTROL: Adjust response length based on settings
    const lengthInstruction = settings.commentLength === 'short' ?
      `ultra-short and extremely concise (MAXIMUM 5-10 words, 1 short sentence). Make it highly punchy and direct.` :
      settings.commentLength === 'long' ?
      `medium length (MAXIMUM 20-30 words, 2 short sentences). Keep it concise, high-signal, and do not ramble.` :
      `short, balanced, and natural (MAXIMUM 10-18 words, 1-2 short sentences). Keep it highly focused and avoid any wordy or long-winded phrasing.`;

    // Explicit directive when detection is confident (non-English script found);
    // otherwise instruct the model to mirror the tweet's language.
    const languageInstruction = (detectedLanguage && detectedLanguage !== 'english') ?
      `The post is written in ${detectedLanguage.toUpperCase()}. Write ALL replies in ${detectedLanguage} — never in English.` :
      `Reply in the SAME language as the post (no mixing).`;

    const vietnameseStyleNote = detectedLanguage === 'vietnamese' ?
      ` Viết tiếng Việt tự nhiên như người Việt trên X: xưng "mình", gọi người đăng là "bạn" hoặc "anh em" nếu hợp ngữ cảnh cộng đồng; dùng văn nói đời thường (kiểu "GM", "chuẩn luôn", "nghe hợp lý đấy"), tuyệt đối không dịch máy hay trang trọng kiểu "quý vị". Giữ thuật ngữ tech/crypto bằng tiếng Anh.` : '';

    // Compact one-liner tone descriptors — keeps voice distinct, slashes token cost
    const TONE_BRIEFS = {
      professional: 'CALM/REFLECTIVE: measured, mature, sounds like an experienced tech lead or fund manager, no hype',
      sarcastic:    'ACTIVE/FUN: dry internet irony, mocks the hype/claim, slightly cynical',
      direct:       'CALM/REFLECTIVE: blunt, no-nonsense, states the point without sugarcoating',
      punchy:       'ACTIVE/FUN: high-energy, hype-friendly, short caps, excited reaction',
      casual:       'ACTIVE/FUN: capitalized, uses chatty dev/crypto slang (e.g. Ngl, Tbh, Lol, Gm, Wagmi), like chatting on Discord',
      witty:        'ACTIVE/FUN: clever tech/crypto wordplay, sharp punchline',
      contrarian:   'CALM/REFLECTIVE: reasonable pushback, points out a crowd-missed angle or trade-off',
      concise:      'CALM/REFLECTIVE: 3-6 words maximum, pure technical signal, no fluff',
      analytical:   'CALM/REFLECTIVE: focused on data, on-chain metrics, gas costs, tech architecture, or TA, highly objective',
      empathetic:   'CALM/REFLECTIVE: supportive, validates the struggle (e.g. dev burnout, bear market pains), thoughtful',
      humorous:     'ACTIVE/FUN: self-deprecating or slightly absurd tech humor, actually funny, dev jokes',
      brief:        'CALM/REFLECTIVE: one short, clean factual statement',
      sharp:        'CALM/REFLECTIVE: cold, dissects the flaw or hidden trade-off instantly',
      thao_mai:     'ACTIVE/FUN: (Vietnamese context) polite, friendly, socializer but cheeky',
      snappy:       'ACTIVE/FUN: attitude-filled, quick comeback, "lol no, next"',
      crisp:        'CALM/REFLECTIVE: polished, clean, slightly elevated vocabulary, high signal'
    };

    const promptTemplate = `You are a real, authentic X (Twitter) user.
Generate EXACTLY ${optimizedTones.length} replies to this ${isReply ? 'comment' : 'tweet'}, each matching a specified tone.

${isReply ? `COMMENT TO REPLY TO: "${targetContent}"${replyTo ? ` (written by ${replyTo})` : ''}
PARENT TWEET CONTEXT: "${contextContent}"` : `TWEET: "${targetContent}"`}${liveConversationContext}

INSTRUCTIONS:
1. Persona: Analyze the topic of the post (e.g., tech, crypto, lifestyle, sports, business, or daily life) and match that context naturally. If the topic is tech, coding, AI, or crypto/Web3, write like an experienced developer or enthusiast in their 30s (using casual, smart, and contextual phrasing, avoiding robotic AI clichés). For other topics, write like an authentic human matching the post's tone.
2. Language: ${languageInstruction}${vietnameseStyleNote}
3. Reply Focus: ${isReply ? 'Directly address the specific comment you are replying to. Use the PARENT TWEET CONTEXT and any LIVE CONVERSATION CONTEXT as background/thread context.' : 'Reference specific details or claims from the tweet. If LIVE CONVERSATION CONTEXT is provided, weave in those discussed topics and points naturally to write a highly contextual response.'}
4. Length: ${lengthInstruction} Ensure every generated reply is concise, punchy, and fits modern micro-blogging style. Strictly avoid verbose, long-winded, or essay-like phrasing.
5. Formatting: Return ONLY a JSON object mapping each requested tone to its reply. No preamble or explanation.
6. Tones & Vibes:
   - For ACTIVE & ENERGETIC tones, write with lively, casual, or humorous energy.
   - For CALM & REFLECTIVE tones, write with a mature, thoughtful, analytical, or direct style.
7. Humanity & Emotion: Make the comments sound like a real person, not an AI bot. Infuse genuine human emotion (such as curiosity, humor, excitement, mild skepticism, empathy, or frustration) depending on the tone. Avoid generic, dry, or overly polite AI templates. Be opinionated, relatable, and express authentic reactions.
8. Correct Grammar & Capitalization: Ensure all generated replies are written with correct spelling and proper grammar rules. Always capitalize the first letter of each sentence. Never start a sentence with a lowercase letter.

TONES TO GENERATE:
${optimizedTones.map(t => `- ${t}: ${TONE_BRIEFS[t] || 'authentic personal reaction'}`).join('\n')}

Return JSON ONLY: {${optimizedTones.map(t => `"${t}":"..."`).join(',')}}`;

    // Debug logging for prompt
    console.log('BuildPrompt - Final Prompt Preview:', promptTemplate.substring(0, 500) + '...');
    console.log('BuildPrompt - AI Auto-Detection Instructions:', 'AI must automatically detect the language and respond in that language');

    return promptTemplate;
  } catch (error) {
    throw error;
  }
}
// ✅ ENHANCED: OpenAI API call with GPT-5 support
// Build provider-specific request payload, then send to /proxy
async function callViaProxy(provider, model, prompt, apiConfig) {
  if (!self.PROXY_CLIENT) throw new Error('Proxy client not loaded');

  // GPT-5 series + o1/o3/o4 require `max_completion_tokens` instead of `max_tokens`
  const useNewOpenAIParam = provider === 'openai' && (model?.startsWith('gpt-5') || model?.startsWith('o1') || model?.startsWith('o3') || model?.startsWith('o4'));

  let payload;
  switch (provider) {
    case 'openai':
      payload = {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: apiConfig.temperature,
        ...(useNewOpenAIParam
          ? { max_completion_tokens: apiConfig.max_tokens }
          : { max_tokens: apiConfig.max_tokens })
      };
      break;
    case 'kimi':
    case 'deepseek':
      payload = {
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: apiConfig.max_tokens,
        temperature: apiConfig.temperature
      };
      break;
    case 'claude':
      payload = {
        model,
        max_tokens: apiConfig.max_tokens,
        messages: [{ role: 'user', content: prompt }],
        temperature: apiConfig.temperature
      };
      break;
    case 'gemini':
      payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: apiConfig.temperature, maxOutputTokens: apiConfig.max_tokens }
      };
      break;
    default:
      throw new Error(`Proxy unsupported for provider: ${provider}`);
  }

  const result = await self.PROXY_CLIENT.call(provider, model, payload);
  const data = result.data;

  // Extract text from provider's response shape
  let content = '';
  if (provider === 'openai' || provider === 'kimi' || provider === 'deepseek') {
    content = data.choices?.[0]?.message?.content || '';
  } else if (provider === 'claude') {
    content = data.content?.[0]?.text || '';
  } else if (provider === 'gemini') {
    content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
  if (!content) throw new Error('Proxy returned empty content');
  return parseAIResponse(content, provider);
}

async function callOpenAIAPI(apiKey, model, prompt, contentObj, apiConfig) {
  console.log('[AI-COMMENT] Calling OpenAI API with model:', model);
  console.log('🔍 [AI-COMMENT] Prompt preview:', prompt.substring(0, 200) + '...');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000); // 25 second timeout

    // Check if this is a GPT-5 model (uses new Responses API)
    const isGPT5 = model?.includes('gpt-5');

    if (isGPT5) {
      console.log('🤖 [AI-COMMENT] Using GPT-5 Responses API');
      return await callGPT5API(apiKey, model, prompt, contentObj, apiConfig);
    }

    // Chat Completions API
    console.log('🤖 [AI-COMMENT] Using Chat Completions API');
    const messages = [{ role: 'user', content: prompt }];

    // GPT-5 series + o1 series use `max_completion_tokens`. Older models use `max_tokens`.
    const useNewParam = model?.startsWith('gpt-5') || model?.startsWith('o1') || model?.startsWith('o3') || model?.startsWith('o4');
    const requestBody = {
      model,
      messages,
      temperature: apiConfig.temperature,
      ...(useNewParam
        ? { max_completion_tokens: apiConfig.max_tokens }
        : { max_tokens: apiConfig.max_tokens })
    };

    // Add JSON mode for supported models
    if (model?.includes('gpt-4') || model?.includes('gpt-3.5-turbo') || model?.startsWith('gpt-5')) {
      requestBody.response_format = { type: "json_object" };
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorText = 'Unknown API error';
      try {
        const errorResponse = await response.text();
        console.error('[AI-COMMENT] OpenAI API error response:', errorResponse);
        const error = JSON.parse(errorResponse);
        errorText = error.error?.message || errorText;

      if (error.error?.code === 'invalid_api_key') {
        throw new Error('Invalid OpenAI API key. Please check your settings.');
      }
      if (error.error?.code === 'insufficient_quota') {
        throw new Error('OpenAI quota exceeded. Please check your billing.');
      }

        throw new Error(errorText);
      } catch (parseError) {
        console.error('[AI-COMMENT] Failed to parse error response:', parseError);
        throw new Error(`OpenAI API error: ${response.status} - ${response.statusText}`);
      }
    }

    let data;
    try {
      data = await response.json();
    } catch (jsonError) {
      console.error('[AI-COMMENT] Failed to parse JSON response:', jsonError);
      throw new Error('Invalid JSON response from OpenAI API');
    }

    const content = data.choices?.[0]?.message?.content || '';

    if (!content) {
      throw new Error('OpenAI returned empty response');
    }

    console.log('✅ OpenAI API call successful');
    return parseAIResponse(content, 'OpenAI');

  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('OpenAI API request timeout');
    }
    console.error('[AI-COMMENT] OpenAI API call failed:', error);
    throw error;
  }
}

// ✅ NEW: GPT-5 Responses API implementation
async function callGPT5API(apiKey, model, prompt, contentObj, apiConfig) {
  console.log('[AI-COMMENT] Calling GPT-5 Responses API with model:', model);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    // GPT-5 uses different parameters based on comment length
    let reasoningEffort = 'medium';
    let verbosity = 'medium';

    // Adjust based on comment length setting (from settings)
    const commentLength = apiConfig.commentLength || 'medium';
    if (commentLength === 'short') {
      reasoningEffort = 'low';
      verbosity = 'low';
    } else if (commentLength === 'long') {
      reasoningEffort = 'high';
      verbosity = 'high';
    }

    const requestBody = {
      model,
      input: prompt,
      reasoning: { effort: reasoningEffort },
      max_output_tokens: apiConfig.max_tokens
    };

    // Only add verbosity if it's not medium (to minimize payload)
    if (verbosity !== 'medium') {
      requestBody.text = { verbosity: verbosity };
    }

    console.log('📤 [GPT-5] Request body:', {
      model,
      reasoning_effort: reasoningEffort,
      verbosity,
      max_tokens: apiConfig.max_tokens
    });

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorText = 'Unknown API error';
      try {
        const errorResponse = await response.text();
        console.error('[AI-COMMENT] GPT-5 API error response:', errorResponse);
        const error = JSON.parse(errorResponse);
        errorText = error.error?.message || errorText;

        if (error.error?.code === 'invalid_api_key') {
          throw new Error('Invalid OpenAI API key. Please check your settings.');
        }
        if (error.error?.code === 'insufficient_quota') {
          throw new Error('OpenAI quota exceeded. Please check your billing.');
        }

        throw new Error(errorText);
      } catch (parseError) {
        console.error('[AI-COMMENT] Failed to parse GPT-5 error response:', parseError);
        throw new Error(`GPT-5 API error: ${response.status} - ${response.statusText}`);
      }
    }

    let data;
    try {
      data = await response.json();
    } catch (jsonError) {
      console.error('[AI-COMMENT] Failed to parse GPT-5 JSON response:', jsonError);
      throw new Error('Invalid JSON response from GPT-5 API');
    }

    // GPT-5 Responses API may have different response formats
    let content = '';
    if (data.output_text) {
      content = data.output_text;
    } else if (data.content) {
      // Fallback for different response formats
      content = data.content;
    } else if (data.choices && data.choices[0]) {
      // Chat Completions format fallback
      content = data.choices[0].message?.content || '';
    }

    if (!content) {
      console.warn('⚠️ GPT-5 response format:', Object.keys(data));
      throw new Error('GPT-5 returned empty response');
    }

    console.log('✅ GPT-5 API call successful');
    return parseAIResponse(content, 'GPT-5');

  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('GPT-5 API request timeout');
    }
    console.error('[AI-COMMENT] GPT-5 API call failed:', error);
    throw error;
  }
}

async function callClaudeAPI(apiKey, model, prompt, contentObj, apiConfig) {
  console.log('[AI-COMMENT] Calling Claude API with model:', model);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    const messages = [{ role: 'user', content: prompt }];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model,
        max_tokens: apiConfig.max_tokens,
        messages,
        temperature: apiConfig.temperature
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorText = 'Unknown API error';
      try {
        const errorResponse = await response.text();
        console.error('[AI-COMMENT] Claude API error response:', errorResponse);
        const error = JSON.parse(errorResponse);
        errorText = error.error?.message || errorText;

      if (error.error?.type === 'authentication_error') {
        throw new Error('Invalid Claude API key. Please check your settings.');
      }
      if (error.error?.type === 'rate_limit_error') {
        throw new Error('Claude rate limit exceeded. Please try again later.');
      }

        throw new Error(errorText);
      } catch (parseError) {
        console.error('[AI-COMMENT] Failed to parse Claude error response:', parseError);
        throw new Error(`Claude API error: ${response.status} - ${response.statusText}`);
      }
    }

    let data;
    try {
      data = await response.json();
    } catch (jsonError) {
      console.error('[AI-COMMENT] Failed to parse Claude JSON response:', jsonError);
      throw new Error('Invalid JSON response from Claude API');
    }
    const content = data.content?.[0]?.text || '';

    if (!content) {
      throw new Error('Claude returned empty response');
    }

    console.log('✅ Claude API call successful');
    return parseAIResponse(content, 'Claude');

  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Claude API request timeout');
    }
    console.error('[AI-COMMENT] Claude API call failed:', error);
    throw error;
  }
}

async function callGeminiAPI(apiKey, model, prompt, contentObj, apiConfig) {
  console.log('[AI-COMMENT] Calling Gemini API with model:', model);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: apiConfig.temperature,
          maxOutputTokens: apiConfig.max_tokens
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: 'Unknown API error' } }));
      console.error('[AI-COMMENT] Gemini API error:', error);
      throw new Error(error.error?.message || `Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!content) {
      throw new Error('Gemini returned empty response');
    }

    console.log('✅ Gemini API call successful');
    return parseAIResponse(content, 'Gemini');

  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Gemini API request timeout');
    }
    console.error('[AI-COMMENT] Gemini API call failed:', error);
    throw error;
  }
}

async function callLocalAPI(endpoint, model, prompt, apiKey, apiConfig) {
  console.log('[AI-COMMENT] Calling Local API:', endpoint);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: apiConfig.max_tokens,
        temperature: apiConfig.temperature
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Local API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || data.response || '';

    if (!content) {
      throw new Error('Local API returned empty response');
    }

    console.log('✅ Local API call successful');
    return parseAIResponse(content, 'Local');

  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Local API request timeout');
    }
    console.error('[AI-COMMENT] Local API call failed:', error);
    throw error;
  }
}

async function callKimiAPI(apiKey, model, prompt, apiConfig) {
  console.log('[AI-COMMENT] Calling Kimi API with model:', model);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    const response = await fetch('https://api.moonshot.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: apiConfig.max_tokens,
        temperature: apiConfig.temperature
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorText = 'Unknown API error';
      try {
        const errorData = await response.json();
        errorText = errorData.error?.message || errorText;
        if (errorData.error?.code === 'invalid_api_key') {
          throw new Error('Invalid Kimi API key. Please check your settings.');
        }
      } catch (parseError) {
        throw new Error(`Kimi API error: ${response.status} - ${response.statusText}`);
      }
      throw new Error(errorText);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    if (!content) {
      throw new Error('Kimi returned empty response');
    }

    console.log('✅ Kimi API call successful');
    return parseAIResponse(content, 'Kimi');

  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Kimi API request timeout');
    }
    console.error('[AI-COMMENT] Kimi API call failed:', error);
    throw error;
  }
}

async function callDeepSeekAPI(apiKey, model, prompt, apiConfig) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: apiConfig.max_tokens,
        temperature: apiConfig.temperature
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `DeepSeek API error: ${response.status}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    if (!content) throw new Error('DeepSeek returned empty response');
    return parseAIResponse(content, 'DeepSeek');
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error('DeepSeek API request timeout');
    throw error;
  }
}

async function callNvidiaAPI(apiKey, model, prompt, apiConfig) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: apiConfig.max_tokens,
        temperature: apiConfig.temperature
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `NVIDIA API error: ${response.status}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    if (!content) throw new Error('NVIDIA returned empty response');
    return parseAIResponse(content, 'NVIDIA');
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error('NVIDIA API request timeout');
    throw error;
  }
}

// ✅ ROBUST: Response parsing with guaranteed return
function parseAIResponse(content, provider = 'Unknown') {
  console.log(`🔍 [AI-COMMENT] Parsing ${provider} response...`);
  console.log(`🔍 [AI-COMMENT] Raw response preview:`, content.substring(0, 200) + '...');
  console.log(`🔍 [AI-COMMENT] Response length:`, content.length);

  try {
    // Method 1: Direct JSON parse
    if (content.startsWith('{') && content.endsWith('}')) {
      const parsed = JSON.parse(content);
      const validated = validateAndFixResponse(parsed);
      if (validated && Object.keys(validated).length > 0) {
        console.log('✅ Direct JSON parse success:', Object.keys(validated));
        console.log('🎭 Generated Tones Count:', Object.keys(validated).length);
        console.log('🎭 Generated Tones:', Object.keys(validated).map((tone, index) => `${index + 1}. ${tone}`).join(', '));
        return validated;
      }
    }

    // Method 2: Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const validated = validateAndFixResponse(parsed);
      if (validated && Object.keys(validated).length > 0) {
        console.log('✅ Extracted JSON parse success:', Object.keys(validated));
        console.log('🎭 Generated Tones Count:', Object.keys(validated).length);
        console.log('🎭 Generated Tones:', Object.keys(validated).map((tone, index) => `${index + 1}. ${tone}`).join(', '));
        return validated;
      }
    }

    // Method 3: Fallback parsing
    console.log('⚠️ JSON parsing failed, using fallback');
    throw new Error('No valid JSON found in response');

  } catch (error) {
    console.error('❌ Parse error:', error.message);
    console.log('🔧 Using guaranteed fallback responses');

    // ✅ Always return valid response with distinct moods
    return {
      professional: "🤓 Market analysis shows interesting developments worth monitoring closely.",
      casual: "😎 This looks promising! Definitely keeping an eye on this one 🚀",
      sarcastic: "😏 Oh wow, another 'groundbreaking' development that will surely change everything.",
      witty: "😄 Another day, another plot twist in the ongoing saga.",
      analytical: "📊 Data patterns indicate potential trend continuation with volume confirmation."
    };
  }
}

// ✅ ROBUST: Validate response with guaranteed valid output
function validateAndFixResponse(parsed) {
  try {
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const result = {};
    const responseKeys = Object.keys(parsed);

    // Map all valid keys
    responseKeys.forEach(key => {
      if (parsed[key] && typeof parsed[key] === 'string' && parsed[key].trim().length > 0) {
        result[key] = cleanCommentText(parsed[key]);
      }
    });

    // Ensure we have at least some responses
    if (Object.keys(result).length === 0) {
      return null;
    }

    console.log('✅ Response validated with keys:', Object.keys(result));
    return result;

  } catch (error) {
    console.error('❌ Response validation failed:', error);
    return null;
  }
}

// ✅ Clean comment text
function cleanCommentText(text) {
  if (!text || typeof text !== 'string') return '';

  return text
    .replace(/^\d+\.?\s*/, '') // Remove numbering
    .replace(/^[-*]\s*/, '')   // Remove bullet points
    .replace(/^"(.*)"$/, '$1') // Remove quotes
    .trim();
}
// ✅ ENHANCED POST-PROCESSING: Remove ALL AI patterns and dashes
const AI_CHARACTER_PATTERNS = [
    // ✅ REMOVE ALL DASHES AND AI PUNCTUATION
    { pattern: /—/g, replacement: ' ' },                    // Em dash → space
    { pattern: /–/g, replacement: ' ' },                    // En dash → space
    { pattern: /-{2,}/g, replacement: ' ' },                // Multiple dashes → space
    { pattern: /\s-\s/g, replacement: ' ' },                // Spaced dash → space
    { pattern: /…/g, replacement: '' },                     // Ellipsis → removed
    { pattern: /"/g, replacement: '"' },                    // Smart quotes → regular
    { pattern: /"/g, replacement: '"' },
    { pattern: /'/g, replacement: "'" },                    // Smart apostrophe → regular
    { pattern: /'/g, replacement: "'" },

    // ✅ REMOVE AI FORMAL LANGUAGE COMPLETELY
    { pattern: /\btherefore\b/gi, replacement: 'so' },
    { pattern: /\bhowever\b/gi, replacement: 'but' },
    { pattern: /\bfurthermore\b/gi, replacement: 'also' },
    { pattern: /\bmoreover\b/gi, replacement: 'plus' },
    { pattern: /\bnevertheless\b/gi, replacement: 'still' },
    { pattern: /\badditionally\b/gi, replacement: 'and' },
    { pattern: /\bconsequently\b/gi, replacement: 'so' },
    { pattern: /\bsubsequently\b/gi, replacement: 'then' },
    { pattern: /\bfacilitate\b/gi, replacement: 'help' },
    { pattern: /\butilize\b/gi, replacement: 'use' },
    { pattern: /\boptimize\b/gi, replacement: 'improve' },
    { pattern: /\benhance\b/gi, replacement: 'make better' },

    // ✅ REMOVE AI SENTENCE STARTERS COMPLETELY
    { pattern: /^It's worth noting that\s*/gi, replacement: '' },
    { pattern: /^It should be noted that\s*/gi, replacement: '' },
    { pattern: /^It's important to understand that\s*/gi, replacement: '' },
    { pattern: /^It's interesting to see that\s*/gi, replacement: '' },
    { pattern: /^What's particularly interesting is that\s*/gi, replacement: '' },
    { pattern: /^Notably,\s*/gi, replacement: '' },
    { pattern: /^Importantly,\s*/gi, replacement: '' },
    { pattern: /^Interestingly,\s*/gi, replacement: '' },
    { pattern: /^Essentially,\s*/gi, replacement: '' },
    { pattern: /^Basically,\s*/gi, replacement: '' },
    { pattern: /^Overall,\s*/gi, replacement: '' },
    { pattern: /^In conclusion,\s*/gi, replacement: '' },
    { pattern: /^To summarize,\s*/gi, replacement: '' },

    // ✅ REMOVE LINE BREAKS AND FORMATTING
    { pattern: /\.\s*[\r\n]+/g, replacement: '. ' },        // Line break after period
    { pattern: /!\s*[\r\n]+/g, replacement: '! ' },         // Line break after exclamation
    { pattern: /\?\s*[\r\n]+/g, replacement: '? ' },        // Line break after question
    { pattern: /,\s*[\r\n]+/g, replacement: ', ' },         // Line break after comma
    { pattern: /[\r\n]+/g, replacement: ' ' },              // Any remaining line breaks
];

// ✅ ENHANCED Natural Replacements (English only)
const NATURAL_REPLACEMENTS = {
    // Formal → Casual
    'this is interesting': 'this is cool',
    'this development': 'this',
    'significant growth': 'big gains',
    'substantial increase': 'huge pump',
    'positive momentum': 'bullish vibes',
    'market conditions': 'the market',
    'technical analysis': 'charts',
    'step-by-step guide': 'guide',
    'comprehensive analysis': 'deep dive',
    'detailed examination': 'look at this',
    'thorough investigation': 'checking this out',
    'strategic approach': 'game plan',
    'optimal solution': 'best way',
    'significant implications': 'big impact',
    'remarkable achievement': 'awesome win',
    'outstanding performance': 'killing it',
    'exceptional results': 'amazing results',
    'innovative approach': 'cool way',
    'cutting-edge technology': 'new tech',
    'state-of-the-art': 'latest',

    // Remove AI hedging
    'it appears that': '',
    'it seems like': '',
    'one could argue that': '',
    'it might be suggested that': '',
    'potentially': '',
    'arguably': '',
    'presumably': '',
    'conceivably': '',

    // Remove filler phrases
    'for what it\'s worth': '',
    'at the end of the day': '',
    'when all is said and done': '',
    'in the final analysis': '',
    'taking everything into consideration': '',
};

// ✅ ENHANCED: Remove AI patterns and line breaks
function postProcessResponse(responses) {
    if (!responses || typeof responses !== 'object') {
        return responses;
    }

    console.log('🧹 ENHANCED post-processing: removing ALL AI patterns...');

    const processed = {};

    Object.entries(responses).forEach(([tone, comment]) => {
        if (comment && typeof comment === 'string') {
            let cleanedComment = comment;

            // Step 1: Remove ALL AI character patterns and dashes
            AI_CHARACTER_PATTERNS.forEach(({ pattern, replacement }) => {
                cleanedComment = cleanedComment.replace(pattern, replacement);
            });

            // Step 2: Replace formal phrases with natural ones
            Object.entries(NATURAL_REPLACEMENTS).forEach(([formal, natural]) => {
                const regex = new RegExp(formal, 'gi');
                cleanedComment = cleanedComment.replace(regex, natural);
            });

            // Step 3: Remove ALL AI detection patterns
            AI_DETECTION_PATTERNS.forEach(pattern => {
                const regex = new RegExp(pattern, 'gi');
                cleanedComment = cleanedComment.replace(regex, '');
            });

            // Step 4: Final aggressive cleanup
            cleanedComment = aggressiveCleanup(cleanedComment);

            processed[tone] = cleanedComment;
        }
    });

    console.log('✅ ENHANCED post-processing completed - removed all AI patterns');
    return processed;
}

// ✅ AGGRESSIVE cleanup to remove all AI artifacts
function aggressiveCleanup(comment) {
    return comment
        .replace(/\s+/g, ' ')                           // Multiple spaces → single
        .replace(/\s*,\s*,/g, ',')                     // Double commas
        .replace(/\s*\.\s*\./g, '.')                   // Double periods
        .replace(/\s*!\s*!/g, '!')                     // Double exclamations
        .replace(/\s*\?\s*\?/g, '?')                   // Double questions
        .replace(/^[,\.\s\-]+/, '')                    // Leading punctuation/dashes
        .replace(/[,\.\s\-]+$/, '')                    // Trailing punctuation/dashes
        .replace(/\s+([,\.\!\?])/g, '$1')             // Space before punctuation
        .replace(/([,\.\!\?])\s*([,\.\!\?])/g, '$1')  // Multiple punctuation
        .replace(/\s*\-\s*/g, ' ')                     // Any remaining dashes
        .replace(/^\s*and\s+/i, '')                    // Leading "and"
        .replace(/^\s*but\s+/i, '')                    // Leading "but"
        .replace(/^\s*so\s+/i, '')                     // Leading "so"
        .replace(/^./, char => char.toUpperCase())      // Capitalize first letter
        .trim();
}

// ✅ ROBUST: Fallback responses with language detection
async function getTrainingOptimizedFallbacks(postContent = '', forcedLanguage = 'auto') {
  console.log('🔧 Getting training-optimized fallbacks...');

  // Language-matched fallbacks: a Vietnamese tweet must never receive the
  // generic English canned set — that reads as an obvious bot reply.
  const postLanguage = (forcedLanguage && forcedLanguage !== 'auto')
    ? forcedLanguage
    : detectLanguage(postContent);
  if (postLanguage === 'vietnamese') {
    return {
      professional: "Nhìn tổng thể thì hướng đi này khá ổn, mình sẽ theo dõi thêm.",
      casual: "Nghe hợp lý đấy, để mình ngâm cứu thêm xem sao 👀",
      sarcastic: "Ừ thì lại một ngày 'bình thường' nữa trên X nhỉ 😌",
      witty: "Plot twist mỗi ngày, đúng chất X 😄",
      analytical: "Mình thấy có vài điểm đáng chú ý, cần thêm dữ liệu để kết luận.",
      concise: "Hợp lý đấy.",
      friendly: "Cảm ơn bạn chia sẻ nha, đọc thấy thú vị thật!",
      empathetic: "Hiểu cảm giác này mà, ai cũng có những ngày như vậy.",
      contrarian: "Mình nghĩ còn góc nhìn khác đáng cân nhắc đấy.",
      brief: "Chuẩn luôn.",
      direct: "Nói thẳng là mình thấy ổn.",
      punchy: "Quá chuẩn! 🔥",
      snappy: "Nghe được đấy chứ!",
      crisp: "Gọn gàng, rõ ràng, hợp lý.",
      sharp: "Ý tưởng ổn nhưng cần xem phần thực thi.",
      humorous: "Sáng dậy muộn mà vẫn kịp GM là giỏi rồi 😂",
      thao_mai: "Dễ thương ghê, chúc bạn ngày mới tốt lành nha!"
    };
  }

  try {
    const insights = await getTrainingInsights();

    // ✅ Natural fallbacks with authentic personality - 1 sentence max
    const fallbacks = {
      professional: "The fundamentals look solid from an institutional perspective with strong technical indicators.",
      casual: "This actually looks pretty interesting and could have some real potential!",
      sarcastic: "Oh wonderful, another 'revolutionary' project that's going to 'change everything forever.'",
      witty: "Well this is certainly an interesting turn of events in the ongoing saga!",
      analytical: "The data shows compelling indicators but I'd be cautious about current market volatility.",
      concise: "Solid fundamentals with positive momentum building.",
      detailed: "Technical indicators show interesting patterns with volume picking up and genuine interest building.",
      friendly: "Thanks for sharing this - really appreciate the thoughtful insights!",
      empathetic: "I can see both sides of this argument with valid concerns and optimism about long-term potential.",
      educational: "This is a great example of how the market is evolving with significant ecosystem implications.",
      encouraging: "Keep pushing forward - the work you're doing is important even in challenging market conditions!",
      contrarian: "I think we need to be more cautious here as I'm seeing red flags others might be overlooking.",
      brief: "This looks solid and I'm confident about the direction.",
      direct: "This is either going to be a massive success or complete failure with no middle ground.",
      punchy: "This is exactly what we've been waiting for with perfect timing and spot-on execution!",
      snappy: "Time will tell but I'm staying balanced - there's potential but not getting carried away.",
      crisp: "The fundamentals are clean and execution looks professional with some risks to consider.",
      sharp: "I'm not convinced this has the structural integrity to succeed long-term.",
      thao_mai: "This is such a cute project and I really hope it succeeds!"
    };

    // ✅ ENHANCED: Optimize based on training insights
    if (insights && insights.bestTones) {
      insights.bestTones.forEach(tone => {
        if (fallbacks[tone]) {
          // Enhance best-performing tones
          const enhancedFallbacks = {
            professional: "Advanced technical indicators suggest strong momentum building across key metrics.",
            casual: "Honestly this looks pretty solid! Really excited to see how this plays out 🚀",
            sarcastic: "Oh wonderful, another 'breakthrough'. Never seen anything like this before."
          };

          if (enhancedFallbacks[tone]) {
            fallbacks[tone] = enhancedFallbacks[tone];
          }
        }
      });
    }

    return fallbacks;

  } catch (error) {
    console.error('❌ Fallback generation failed:', error);

    // Ultimate fallback with natural responses - 1 sentence max
    return {
      professional: "The market analysis reveals genuinely interesting developments with technical indicators showing early stages of significant market dynamics shift.",
      casual: "This actually looks pretty promising with real potential worth watching!",
      sarcastic: "Oh wonderful, another 'groundbreaking' development that's going to revolutionize everything.",
      witty: "Well this is certainly an interesting turn of events in the ongoing saga!",
      analytical: "The data shows compelling indicators suggesting positive trends but I'd recommend maintaining a balanced perspective."
    };
  }
}

// ✅ ROBUST: Training insights with error handling
async function getTrainingInsights() {
  try {
    const result = await chrome.storage.local.get(['trainingInsights', 'localFeedback']);

    if (result.trainingInsights) {
      const cached = result.trainingInsights;
      const age = Date.now() - (cached.timestamp || 0);

      if (age < 3600000) { // 1 hour cache
        return cached.data;
      }
    }

    if (result.localFeedback && result.localFeedback.length > 5) {
      return await analyzeLocalFeedback(result.localFeedback);
    }

    return null;
  } catch (error) {
    console.error('❌ Failed to get training insights:', error);
    return null;
  }
}

async function analyzeLocalFeedback(feedbackData) {
  try {
    const insights = {
      totalFeedback: feedbackData.length,
      averageRating: 0,
      bestTones: []
    };

    const totalRating = feedbackData.reduce((sum, item) => sum + (item.rating || 0), 0);
    insights.averageRating = totalRating / feedbackData.length;

    const toneStats = {};
    feedbackData.forEach(item => {
      if (!toneStats[item.tone]) {
        toneStats[item.tone] = { ratings: [], count: 0 };
      }
      toneStats[item.tone].ratings.push(item.rating);
      toneStats[item.tone].count++;
    });

    const tonePerformance = Object.keys(toneStats)
      .map(tone => {
        const ratings = toneStats[tone].ratings;
        const avgRating = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
        return { tone, avgRating, count: ratings.length };
      })
      .filter(item => item.count >= 3)
      .sort((a, b) => b.avgRating - a.avgRating);

    insights.bestTones = tonePerformance.slice(0, 3).map(item => item.tone);

    return insights;
  } catch (error) {
    console.error('❌ Failed to analyze feedback:', error);
    return null;
  }
}

// ✅ ROBUST: Quota checking with error handling
async function checkDailyQuota(settings) {
  // If the user has configured their own API Key, they have unlimited quota
  if (settings && !settings.usingDefaultKey) {
    console.log('📊 Unlimited quota for custom API key');
    return true;
  }

  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(['dailyUsage', 'lastUsageDate'], (result) => {
        if (chrome.runtime.lastError) {
          console.error('❌ Quota check error:', chrome.runtime.lastError);
          resolve(true); // Allow generation if quota check fails
          return;
        }

        const today = new Date().toDateString();
        const lastUsageDate = result.lastUsageDate;
        let dailyUsage = result.dailyUsage || 0;

        if (lastUsageDate !== today) {
          dailyUsage = 0;
          chrome.storage.local.set({ dailyUsage: 0, lastUsageDate: today });
        }

        chrome.storage.sync.get(['dailyQuota'], (quotaResult) => {
          if (chrome.runtime.lastError) {
            console.error('❌ Quota settings error:', chrome.runtime.lastError);
            resolve(true); // Allow generation if quota settings fail
            return;
          }

          // Default to DAILY_FREE_QUOTA (50) instead of 10 if not configured
          const quota = parseInt(quotaResult.dailyQuota) || DAILY_FREE_QUOTA;
          const canGenerate = quota === 0 || dailyUsage < quota;

          console.log('📊 Quota check:', { dailyUsage, quota, canGenerate });
          resolve(canGenerate);
        });
      });
    } catch (error) {
      console.error('❌ Quota check failed:', error);
      resolve(true); // Allow generation if quota check completely fails
    }
  });
}

// ✅ ROBUST: Usage stats update with error handling
async function updateUsageStats() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(['dailyUsage', 'totalUsage', 'lastUsageDate'], (result) => {
        if (chrome.runtime.lastError) {
          console.error('❌ Usage stats error:', chrome.runtime.lastError);
          resolve(); // Continue even if stats update fails
          return;
        }

        const today = new Date().toDateString();
        let dailyUsage = result.dailyUsage || 0;
        let totalUsage = result.totalUsage || 0;

        if (result.lastUsageDate !== today) {
          dailyUsage = 0;
        }

        chrome.storage.local.set({
          dailyUsage: dailyUsage + 1,
          totalUsage: totalUsage + 1,
          lastUsageDate: today
        }, () => {
          if (chrome.runtime.lastError) {
            console.error('❌ Usage stats save error:', chrome.runtime.lastError);
          } else {
            console.log('✅ Usage stats updated:', { dailyUsage: dailyUsage + 1, totalUsage: totalUsage + 1 });
          }
          resolve();
        });
      });
    } catch (error) {
      console.error('❌ Usage stats update failed:', error);
      resolve(); // Continue even if stats update fails
    }
  });
}

// ✅ NEW: Settings change handler
async function handleSettingsChange(changedData) {
  try {
    console.log('⚙️ Settings changed:', changedData);

    if (changedData.apiProvider) {
      await chrome.storage.local.remove(['cachedModelInfo', 'lastProviderCheck']);
      console.log('🔄 Cleared cached data for provider change');
    }

    await chrome.storage.local.set({
      lastSettingsUpdate: Date.now(),
      lastProviderChange: changedData.apiProvider ? Date.now() : null
    });

  } catch (error) {
    console.error('❌ Settings change handling failed:', error);
  }
}

// ✅ NEW: Debug API connection
async function debugAPIConnection() {
  try {
    console.log('🔧 Starting API debug...');

    const settings = await getSettings();

    const debugInfo = {
      timestamp: Date.now(),
      settings: {
        provider: settings.apiProvider,
        hasKey: !!settings.apiKey,
        keyLength: settings.apiKey?.length || 0,
        model: settings.selectedModel,
        tones: settings.selectedTones?.length || 0
      },
      errors: []
    };

    // Basic validation
    if (!settings.apiKey) {
      debugInfo.errors.push('No API key configured');
    }

    if (!settings.selectedTones || settings.selectedTones.length === 0) {
      debugInfo.errors.push('No tones selected');
    }

    // Test basic connectivity (without actual API call)
    try {
      const testResponse = await fetch('https://httpbin.org/get', {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      debugInfo.internetConnectivity = testResponse.ok;
    } catch (error) {
      debugInfo.internetConnectivity = false;
      debugInfo.errors.push('Internet connectivity issue');
    }

    console.log('🔧 Debug completed:', debugInfo);
    return { success: true, data: debugInfo };

  } catch (error) {
    console.error('❌ Debug failed:', error);
    return { success: false, error: error.message };
  }
}
// ✅ ENHANCED: Core Testing Functions
class ExtensionTester {
  constructor() {
    this.testResults = {
      settings: null,
      api: null,
      ai: null,
      lastRun: null
    };
  }

  // Test all core functions
  async runFullTest() {
    console.log('🧪 Starting full extension test...');
    this.testResults.lastRun = new Date().toISOString();

    try {
      // Test 1: Settings validation
      this.testResults.settings = await this.testSettings();

      // Test 2: API connection
      this.testResults.api = await this.testAPIConnection();

      // Test 3: AI generation
      this.testResults.ai = await this.testAIGeneration();

      const summary = this.generateTestSummary();
      console.log('✅ Full test completed:', summary);

      return {
      success: true,
        summary: summary,
        results: this.testResults
      };

  } catch (error) {
      console.error('❌ Full test failed:', error);
    return {
      success: false,
      error: error.message,
        results: this.testResults
      };
    }
  }

  // Test settings validation
  async testSettings() {
    console.log('⚙️ Testing settings validation...');

    try {
      const result = await new Promise((resolve) => {
      chrome.storage.sync.get([
          'apiProvider', 'openaiApiKey', 'claudeApiKey', 'geminiApiKey',
          'selectedTones', 'defaultTone', 'preferredLanguage'
        ], resolve);
      });

      const hasProvider = !!result.apiProvider;
      const hasUserKey = !!(result.openaiApiKey || result.claudeApiKey || result.geminiApiKey || result.kimiApiKey);
      const hasAdminDefault = isValidDefaultKey(DEFAULT_KIMI_API_KEY) || isValidDefaultKey(DEFAULT_OPENAI_API_KEY) || isValidDefaultKey(DEFAULT_CLAUDE_API_KEY) || isValidDefaultKey(DEFAULT_GEMINI_API_KEY);
      const hasApiKey = hasUserKey || hasAdminDefault;
      const hasTones = !!result.selectedTones && result.selectedTones.length > 0;

      return {
        success: hasProvider && hasApiKey && hasTones,
        provider: result.apiProvider,
        hasApiKey: hasApiKey,
        hasTones: hasTones,
        toneCount: result.selectedTones ? result.selectedTones.length : 0
      };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Test API connection
  async testAPIConnection() {
    console.log('🔗 Testing API connection...');

    try {
      // Get settings from storage
      const result = await new Promise((resolve) => {
        chrome.storage.sync.get([
          'claudeApiKey', 'openaiApiKey', 'geminiApiKey', 'kimiApiKey', 'localApiKey',
          'apiProvider', 'selectedModel', 'customEndpoint', 'apiKey'
        ], resolve);
      });

      // Get the correct API key based on provider (with admin defaults)
      let apiKey;
      const provider = result.apiProvider || DEFAULT_PROVIDER;

      switch(provider) {
        case 'claude':
          apiKey = pickKey(result.claudeApiKey || result.apiKey, DEFAULT_CLAUDE_API_KEY);
          break;
        case 'openai':
          apiKey = pickKey(result.openaiApiKey, DEFAULT_OPENAI_API_KEY);
          break;
        case 'gemini':
          apiKey = pickKey(result.geminiApiKey, DEFAULT_GEMINI_API_KEY);
          break;
        case 'kimi':
          apiKey = pickKey(result.kimiApiKey, DEFAULT_KIMI_API_KEY);
          break;
        case 'local':
          apiKey = (result.customEndpoint || '').trim();
          break;
        default:
          apiKey = (result.apiKey || '').trim();
      }

      if (!apiKey) {
        return { success: false, error: `No API key configured for provider: ${provider}` };
      }

      // Test with a simple prompt
      const testPrompt = "Hello, this is a test message. Please respond with a JSON object containing 'status': 'Connection successful'.";

    let response;
      switch (provider) {
      case 'openai':
          response = await callOpenAIAPI(apiKey, result.selectedModel || 'gpt-4o-mini', testPrompt, {}, { max_tokens: 50, temperature: 1 });
        break;
      case 'claude':
          response = await callClaudeAPI(apiKey, result.selectedModel || 'claude-haiku-4-5-20251001', testPrompt, {}, { max_tokens: 50, temperature: 1 });
        break;
      case 'gemini':
          response = await callGeminiAPI(apiKey, result.selectedModel || 'gemini-3.1-flash-preview', testPrompt, {}, { max_tokens: 50, temperature: 1 });
        break;
      default:
          return { success: false, error: `Unsupported provider: ${provider}` };
    }

      return { success: true, provider: provider, response: response };

  } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Test AI generation with sample text
  async testAIGeneration() {
    console.log('🤖 Testing AI generation...');

    try {
      const sampleText = "Just had an amazing experience at the new coffee shop downtown! The barista recommended their signature latte and it was absolutely perfect.";

      const testRequest = {
        action: 'generateComments',
        postContent: sampleText,
        imageUrl: null,
        videoUrl: null,
        platform: 'twitter',
        sessionId: 'test_session_' + Date.now(),
        userId: 'test_user_' + Date.now(),
        timestamp: Date.now(),
        detectedLanguage: 'en'
      };

      const result = await handleGenerateComments(testRequest);

      return {
        success: result.success,
        commentCount: result.commentCount || 0,
        provider: result.apiProvider,
        model: result.model,
        tones: result.data ? Object.keys(result.data) : []
      };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Generate test summary
  generateTestSummary() {
    const settings = this.testResults.settings;
    const api = this.testResults.api;
    const ai = this.testResults.ai;

    return {
      totalTests: 3,
      passedTests: [settings, api, ai].filter(r => r && r.success).length,
      failedTests: [settings, api, ai].filter(r => r && !r.success).length,
      provider: api?.provider || 'unknown',
      toneCount: settings?.toneCount || 0,
      commentCount: ai?.commentCount || 0,
      lastRun: this.testResults.lastRun
    };
  }
}

// Create global tester instance
const extensionTester = new ExtensionTester();

/**
 * gpt-5 and the o-series spend their token budget on hidden reasoning BEFORE
 * writing a single visible character, and they reject any temperature other
 * than the default. Send them a normal chat payload and the API answers 200
 * with an empty `content` — which is exactly what surfaced to users as
 * "AI Translation failed (AI returned empty translation)".
 */
function isReasoningModel(model) {
  const m = String(model || '');
  return m.startsWith('gpt-5') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4');
}

// Reasoning models need room for the thinking pass plus the answer.
const REASONING_TOKEN_BUDGET = 4096;

async function translateText(request) {
  // proxyTimeoutMs: the live-subtitle path needs a tight deadline because its
  // calls are serialised on a per-session chain — one hung request stalls every
  // sentence behind it. Offline/manual translation keeps the roomier default.
  const { text, from = 'Vietnamese', to = 'English', bypassPrompt = false, temperature, proxyTimeoutMs } = request;
  if (!text || !text.trim()) return { success: false, error: 'No text provided' };

  // Route translation to its dedicated provider/model if configured
  const settings = await applyTaskRouting(await getSettings(), 'translate');
  // Skip key check when proxy holds the real key (default mode)
  const willUseProxy = HAS_PROXY && settings.usingDefaultKey && settings.apiProvider !== 'local';
  if (!settings.apiKey && !willUseProxy) {
    return { success: false, error: 'No API key configured' };
  }

  const isAuto = !from || from.toLowerCase() === 'auto' || from.toLowerCase() === 'auto detect';
  const fromText = isAuto ? 'the auto-detected language' : from;

  // Supporting domain context: reuse the user's Livestream Topic setting so
  // manual translations get the same domain-aware treatment as live captions.
  let topicContext = '';
  try {
    const { ltTopic } = await chrome.storage.local.get('ltTopic');
    const TOPIC_HINTS = {
      crypto: 'The text is likely about crypto, Web3, or blockchain — keep terms like token, wallet, gas, stake, airdrop, onchain, mainnet in English.',
      tech: 'The text is likely about technology, programming, or IoT — keep standard developer jargon in English.',
      business: 'The text is likely about business, startups, or marketing — keep common business English terms (SaaS, B2B, pitch deck) as-is.',
      finance: 'The text is likely about finance and markets — keep terms like ETF, bull/bear market, portfolio as commonly used.',
      gaming: 'The text is likely about gaming or esports — keep gaming slang (cooldown, respawn, gank) as commonly used.'
    };
    if (ltTopic && TOPIC_HINTS[ltTopic]) {
      topicContext = `\nDOMAIN CONTEXT: ${TOPIC_HINTS[ltTopic]}`;
    }
  } catch (_) {}

  const prompt = bypassPrompt ? text : `Translate this text from ${fromText} to ${to} dynamically, matching its original context, tone, and register.${topicContext}

INSTRUCTIONS:
1. Vibe & Persona: Match the original text's tone, topic, and register.
   - If the target language is Vietnamese, write naturally and fluently like a native speaker. Avoid dry, robotic machine-like translations. Use natural pronouns and omit subjects where natural.
   - If the source text is about tech, coding, or crypto/Web3, adapt the translation to the style of a modern tech/crypto enthusiast (e.g. keeping technical jargon in English rather than translating literally, using natural terms).
2. Technical Terms: Keep standard tech, business, and crypto terms (e.g., Arc, Circle, USDC, gas, finality, validator, bridge, swap, onchain, offchain, testnet, mainnet, dev, etc.) in their original English form if that is how the target community naturally uses them.
3. Entities & Numbers: Keep proper nouns, brands, numbers, URLs, hashtags, @mentions, and emojis exactly as they are.
4. Output Format: Return ONLY the final translated text. No introductions, explanations, or commentary.

TEXT TO TRANSLATE:
${text}`;
  // temperature 0 = most deterministic. That is right for a literal document
  // translation, but for speech it is the direct cause of translation-ese: the
  // single most probable token is almost always the word-for-word one. Callers
  // that want natural spoken output pass a higher value.
  const liveTemperature = typeof temperature === 'number' ? temperature : 0;
  const apiConfig = { max_tokens: 1000, temperature: liveTemperature };

  // Route via proxy when using bundled default key
  if (settings.usingDefaultKey && HAS_PROXY && self.PROXY_CLIENT) {
    try {
      const provider = settings.apiProvider;
      const model = settings.selectedModel || getDefaultModel(provider);
      // Kimi K2 family requires temperature: 1; everyone else honours the caller
      const temp = provider === 'kimi' ? 1 : liveTemperature;
      // GPT-5 / o1+ require `max_completion_tokens` instead of `max_tokens`
      const reasoning = provider === 'openai' && isReasoningModel(model);
      const tokenField = reasoning ? 'max_completion_tokens' : 'max_tokens';
      let payload;
      if (provider === 'claude') {
        payload = { model, max_tokens: 1000, messages: [{ role: 'user', content: prompt }], temperature: temp };
      } else if (provider === 'gemini') {
        payload = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: temp, maxOutputTokens: 1000 } };
      } else {
        payload = { model, messages: [{ role: 'user', content: prompt }], [tokenField]: reasoning ? REASONING_TOKEN_BUDGET : 1000 };
        // Omitted on purpose for reasoning models: they only accept the default.
        if (!reasoning) payload.temperature = temp;
      }
      const result = await self.PROXY_CLIENT.call(provider, model, payload, proxyTimeoutMs || 30000);
      const data = result.data;
      let translated = '';
      if (provider === 'claude')      translated = data.content?.[0]?.text || '';
      else if (provider === 'gemini') translated = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      else                            translated = data.choices?.[0]?.message?.content || '';

      if (!translated.trim()) return { success: false, error: 'Empty translation' };
      return { success: true, translated: translated.trim() };
    } catch (err) {
      if (err.quotaExhausted) return { success: false, error: err.message, quotaExhausted: true, quota: err.quota };
      return { success: false, error: err.message };
    }
  }

  try {
    let translated = '';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    switch (settings.apiProvider) {
      case 'openai': {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.apiKey}` },
          body: JSON.stringify((() => {
            const m = settings.selectedModel || 'gpt-4o-mini';
            const reasoning = isReasoningModel(m);
            const body = { model: m, messages: [{ role: 'user', content: prompt }] };
            if (reasoning) {
              body.max_completion_tokens = REASONING_TOKEN_BUDGET; // no temperature: only the default is accepted
            } else {
              body.max_tokens = 2048;
              body.temperature = liveTemperature;
            }
            return body;
          })()),
          signal: controller.signal
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error?.message || `OpenAI error ${resp.status}`);
        }
        const data = await resp.json();
        translated = data.choices?.[0]?.message?.content || '';
        break;
      }
      case 'claude': {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': settings.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: settings.selectedModel, max_tokens: 2048, messages: [{ role: 'user', content: prompt }], temperature: liveTemperature }),
          signal: controller.signal
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error?.message || `Claude error ${resp.status}`);
        }
        const data = await resp.json();
        translated = data.content?.[0]?.text || '';
        break;
      }
      case 'gemini': {
        const model = settings.selectedModel || 'gemini-3.1-flash-preview';
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: liveTemperature, maxOutputTokens: 1000 } }),
          signal: controller.signal
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error?.message || `Gemini error ${resp.status}`);
        }
        const data = await resp.json();
        translated = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        break;
      }
      case 'kimi': {
        const resp = await fetch('https://api.moonshot.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.apiKey}` },
          body: JSON.stringify({ model: settings.selectedModel || 'moonshot-v1-32k', messages: [{ role: 'user', content: prompt }], max_tokens: 1000, temperature: 1 }),
          signal: controller.signal
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error?.message || `Kimi error ${resp.status}`);
        }
        const data = await resp.json();
        translated = data.choices?.[0]?.message?.content || '';
        break;
      }
      case 'deepseek': {
        const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.apiKey}` },
          body: JSON.stringify({ model: settings.selectedModel || 'deepseek-v4-flash', messages: [{ role: 'user', content: prompt }], max_tokens: 1000, temperature: liveTemperature }),
          signal: controller.signal
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error?.message || `DeepSeek error ${resp.status}`);
        }
        const data = await resp.json();
        translated = data.choices?.[0]?.message?.content || '';
        break;
      }
      case 'nvidia': {
        const resp = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.apiKey}` },
          body: JSON.stringify({ model: settings.selectedModel || 'nvidia/llama-3.1-nemotron-51b-instruct', messages: [{ role: 'user', content: prompt }], max_tokens: 1000, temperature: liveTemperature }),
          signal: controller.signal
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error?.message || `NVIDIA error ${resp.status}`);
        }
        const data = await resp.json();
        translated = data.choices?.[0]?.message?.content || '';
        break;
      }
      case 'groq': {
        const syncGroq = await chrome.storage.sync.get(['groqApiKey']);
        const groqTransKey = syncGroq.groqApiKey || settings.apiKey;
        if (!groqTransKey) { clearTimeout(timeoutId); return { success: false, error: 'Groq API key missing' }; }
        const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqTransKey}` },
          body: JSON.stringify({ model: settings.selectedModel || 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], max_tokens: 2048, temperature: liveTemperature }),
          signal: controller.signal
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error?.message || `Groq error ${resp.status}`);
        }
        const data = await resp.json();
        translated = data.choices?.[0]?.message?.content || '';
        break;
      }
      default:
        return { success: false, error: `Provider not supported: ${settings.apiProvider}` };
    }

    clearTimeout(timeoutId);

    if (!translated.trim()) return { success: false, error: 'AI returned empty translation' };
    return { success: true, translated: translated.trim() };

  } catch (error) {
    if (error.name === 'AbortError') return { success: false, error: 'Translation timeout' };
    return { success: false, error: error.message };
  }
}

// ═══════════════════════ VIDEO TLDR → POST ═══════════════════════
// Turns a live-caption transcript into one ready-to-publish X post.
// Runs only on the user's own Groq/OpenAI key — never the proxy: transcripts
// are long, and the free-tier proxy is budgeted for short reply prompts.
async function handleTldrVideo(request) {
  const transcript = (request.transcript || '').trim();
  if (!transcript) {
    return { success: false, error: 'No transcript yet. Run Live Captions on the video first, then TLDR.' };
  }

  const s = await chrome.storage.sync.get([
    'tldrProvider', 'tldrGroqModel', 'tldrOpenaiModel', 'tldrLanguage',
    'language', 'groqApiKey', 'openaiApiKey'
  ]);

  const provider = s.tldrProvider === 'openai' ? 'openai' : 'groq';
  const providerName = provider === 'groq' ? 'Groq' : 'OpenAI';
  const apiKey = ((provider === 'groq' ? s.groqApiKey : s.openaiApiKey) || '').trim();
  if (!apiKey) {
    return { success: false, error: `No ${providerName} API key saved. Add it in Options → API Keys, or switch the TLDR provider.` };
  }
  const model = provider === 'groq'
    ? (s.tldrGroqModel || 'llama-3.3-70b-versatile')
    : (s.tldrOpenaiModel || 'gpt-4o-mini');

  // Target language: explicit TLDR choice → Reply Language → the video's own language.
  const lang = (s.tldrLanguage && s.tldrLanguage !== 'auto') ? s.tldrLanguage
    : (s.language && s.language !== 'auto') ? s.language
    : null;
  const languageInstruction = lang
    ? `Write the post in ${lang.toUpperCase()} — no other language.`
    : `Write the post in the SAME language the video is spoken in (no mixing).`;

  // Keep even 8k-context models safe: ~24k chars ≈ 6k tokens. When trimming,
  // keep the opening (topic) and the ending (conclusion) — the middle is the
  // most redundant part of a spoken transcript.
  const MAX_TRANSCRIPT_CHARS = 24000;
  let text = transcript;
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    text = text.slice(0, Math.floor(MAX_TRANSCRIPT_CHARS * 0.7))
      + '\n[... transcript trimmed ...]\n'
      + text.slice(-Math.floor(MAX_TRANSCRIPT_CHARS * 0.3));
  }

  const title = (request.title || '').trim();
  const prompt = `You are writing a social media post for X (Twitter).

Below is the full transcript of a video${title ? ` titled "${title}"` : ''}. Read it start to finish, find the MAIN POINTS, and summarize them into ONE post (a TLDR).

Rules:
1. ${languageInstruction}
2. Easy to understand: plain everyday words, short sentences, no jargon unless the video itself is about that jargon.
3. Concise: 1-3 short sentences, under 280 characters total.
4. Cover the whole video's main points and conclusion — the takeaways someone would want without watching. Don't fixate on the opening minutes.
5. Plain text only: no hashtags, no emojis, no quotes around the post, no "TLDR:" prefix.

TRANSCRIPT:
${text}

Return ONLY the post text.`;

  const endpoint = provider === 'groq'
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.4
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(errData.error?.message || `${providerName} error ${resp.status}`);
    }
    const data = await resp.json();
    let post = (data.choices?.[0]?.message?.content || '').trim();
    post = post.replace(/^["'“‘]+|["'”’]+$/g, '').replace(/^TL;?DR:?\s*/i, '').trim();
    if (!post) return { success: false, error: 'AI returned an empty post. Try again.' };
    return { success: true, post, provider, model };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') return { success: false, error: 'TLDR timed out — try again.' };
    return { success: false, error: error.message };
  }
}

// Fast hidden reading: instead of playing the video in real time through tab
// capture, fetch the post's actual mp4 from X's CDN and hand the whole file to
// Whisper in one shot — no playback, many times faster than real time.
//
// The mp4 URL comes from X's public syndication endpoint (the one that powers
// embedded tweets), which needs no login — only a token derived from the tweet
// id. If any step fails (protected account, Space, >24MB file, API change),
// the caller falls back to the realtime "Read video (Whisper)" path.
async function handleTldrAutoRead(request) {
  const s = await chrome.storage.sync.get([
    'tldrProvider', 'groqApiKey', 'openaiApiKey', 'groqModel', 'openaiWhisperModel'
  ]);
  const provider = s.tldrProvider === 'openai' ? 'openai' : 'groq';
  const providerName = provider === 'groq' ? 'Groq' : 'OpenAI';
  const apiKey = ((provider === 'groq' ? s.groqApiKey : s.openaiApiKey) || '').trim();
  if (!apiKey) {
    return { success: false, error: `No ${providerName} API key saved. Add it in Options → API Keys, or switch the TLDR provider.` };
  }

  // 1 — Resolve a downloadable media URL. Two sources: a direct URL the panel
  // scanned off the page (works on any site), or an X tweet id resolved
  // through the syndication API (the one that powers embedded tweets; its
  // token is a pure function of the id).
  let videoUrl = (request.videoUrl || '').trim();
  let tweetText = '';
  if (videoUrl && !/^https?:\/\//i.test(videoUrl)) videoUrl = '';
  if (!videoUrl) {
    const tweetId = String(request.tweetId || '').trim();
    if (!/^\d+$/.test(tweetId)) {
      return { success: false, error: 'No downloadable video found on this page. Use "Read video (Whisper)" instead.' };
    }
    const token = ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
    let variants = [];
    try {
      const metaResp = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=${token}`);
      if (!metaResp.ok) throw new Error(`syndication ${metaResp.status}`);
      const meta = await metaResp.json();
      tweetText = (meta.text || '').trim();
      const media = (meta.mediaDetails || []).find(m => m.type === 'video' || m.type === 'animated_gif');
      variants = ((media && media.video_info && media.video_info.variants) || [])
        .filter(v => v.content_type === 'video/mp4' && v.url);
    } catch (err) {
      console.warn('⚠️ [TLDR] Syndication lookup failed:', err);
      return { success: false, error: 'Could not fetch this post\'s video info (protected post or API change). Use "Read video (Whisper)" instead.' };
    }
    if (variants.length === 0) {
      return { success: false, error: 'No downloadable video found on this post (Spaces and some live videos are not supported). Use "Read video (Whisper)" instead.' };
    }
    // Lowest bitrate wins: Whisper only needs intelligible speech, and small
    // files stay under the 25MB transcription cap and download fastest.
    variants.sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
    videoUrl = variants[0].url;
  }

  // 2 — Download the mp4 (Whisper accepts mp4 directly, no audio extraction needed)
  let blob;
  try {
    const dlController = new AbortController();
    const dlTimeout = setTimeout(() => dlController.abort(), 60000);
    const mediaResp = await fetch(videoUrl, { signal: dlController.signal });
    clearTimeout(dlTimeout);
    if (!mediaResp.ok) throw new Error(`download ${mediaResp.status}`);
    blob = await mediaResp.blob();
  } catch (err) {
    return { success: false, error: 'Video download failed. Use "Read video (Whisper)" instead.' };
  }
  const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
  if (blob.size > MAX_UPLOAD_BYTES) {
    return { success: false, error: `Video too large for fast reading (${Math.round(blob.size / 1024 / 1024)}MB > 24MB). Use "Read video (Whisper)" instead.` };
  }

  // 3 — One-shot Whisper transcription of the whole file
  const asrEndpoint = provider === 'groq'
    ? 'https://api.groq.com/openai/v1/audio/transcriptions'
    : 'https://api.openai.com/v1/audio/transcriptions';
  const asrModel = provider === 'groq'
    ? (s.groqModel || 'whisper-large-v3')
    : (s.openaiWhisperModel || 'whisper-1');

  // Whisper sniffs the container from the filename extension, so keep the
  // real one when the URL carries it (generic sites serve webm/mp3/etc. too).
  const extMatch = videoUrl.match(/\.(mp4|webm|mov|m4v|m4a|mp3|ogg|wav|mpeg|mpga|flac)(?:[?#]|$)/i);
  const fileName = 'video.' + (extMatch ? extMatch[1].toLowerCase() : 'mp4');

  let transcript = '';
  try {
    const fd = new FormData();
    fd.append('file', blob, fileName);
    fd.append('model', asrModel);
    fd.append('response_format', 'text');
    const asrController = new AbortController();
    const asrTimeout = setTimeout(() => asrController.abort(), 120000);
    const asrResp = await fetch(asrEndpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: fd,
      signal: asrController.signal
    });
    clearTimeout(asrTimeout);
    if (!asrResp.ok) {
      const errData = await asrResp.json().catch(() => ({}));
      throw new Error(errData.error?.message || `${providerName} transcription error ${asrResp.status}`);
    }
    transcript = (await asrResp.text()).trim();
  } catch (err) {
    if (err.name === 'AbortError') return { success: false, error: 'Transcription timed out — try again or use "Read video (Whisper)".' };
    return { success: false, error: `Transcription failed: ${err.message}` };
  }
  if (!transcript) {
    return { success: false, error: 'Whisper heard no speech in this video.' };
  }

  // 4 — Same summarize path as the realtime flow
  // The tweet's own text beats the tab title as context — it names what the
  // video is actually about, without the "… on X" boilerplate.
  const result = await handleTldrVideo({ transcript, title: tweetText.slice(0, 100) || request.title || '' });
  if (result.success) {
    result.transcriptChars = transcript.length;
    result.autoRead = true;
  }
  return result;
}

// ✅ ADDED: Test Model Connection Function
async function testModelConnection(request) {
  console.log('🔗 Testing model connection...');

  try {
    const settings = await getSettings();
    const willUseProxy = HAS_PROXY && settings.usingDefaultKey && settings.apiProvider !== 'local';

    if (!settings.apiKey && !willUseProxy) {
      return { success: false, error: 'No API key configured' };
    }

    if (!settings.apiProvider) {
      return { success: false, error: 'No API provider selected' };
    }

    // Test with a simple prompt
    const testPrompt = "Hello, this is a test message. Please respond with 'Connection successful'.";

    let response;
    if (willUseProxy) {
      response = await callViaProxy(settings.apiProvider, settings.selectedModel, testPrompt, { max_tokens: 50, temperature: 1 });
      if (typeof response === 'object' && response !== null && response.translated) {
        response = response.translated;
      }
    } else {
      switch (settings.apiProvider) {
        case 'openai':
          // Use lightweight health check against OpenAI models endpoint
          response = await callOpenAIHealthCheck(settings.apiKey);
          break;
        case 'claude':
          response = await callClaudeAPI(settings.apiKey, settings.selectedModel, testPrompt, {}, { max_tokens: 50, temperature: 1 });
          break;
        case 'gemini':
          // Health-check using raw generateContent like test_gemini_key.js
          response = await callGeminiHealthCheck(settings.apiKey, normalizeGeminiModel(settings.selectedModel), testPrompt);
          if (!response || (typeof response === 'object' && Object.keys(response).length === 0)) {
            const fallbacks = ['gemini-3.1-flash-preview', 'gemini-1.5-flash-8b', 'gemini-2.0-flash-exp'];
            for (const m of fallbacks) {
              try {
                response = await callGeminiHealthCheck(settings.apiKey, m, testPrompt);
                if (response) break;
              } catch (_) { /* continue */ }
            }
          }
          break;
        case 'kimi':
          response = await callKimiAPI(settings.apiKey, settings.selectedModel || 'moonshot-v1-32k', testPrompt, { max_tokens: 50, temperature: 1 });
          break;
        case 'deepseek':
          response = await callDeepSeekAPI(settings.apiKey, settings.selectedModel || 'deepseek-v4-flash', testPrompt, { max_tokens: 50, temperature: 0 });
          break;
        case 'nvidia':
          response = await callNvidiaAPI(settings.apiKey, settings.selectedModel || 'nvidia/llama-3.1-nemotron-51b-instruct', testPrompt, { max_tokens: 50, temperature: 1 });
          break;
        default:
          return { success: false, error: `Unsupported provider: ${settings.apiProvider}` };
      }
    }

    console.log('✅ Model connection test successful');
    return { success: true, message: 'Model connection successful', response: response };

  } catch (error) {
    console.error('❌ Model connection test failed:', error);
    return { success: false, error: error.message };
  }
}

// ✅ ADDED: Test API Key Function
async function testApiKey(request) {
  console.log('🔑 Testing API key...');

  try {
    const { provider, apiKey } = request;

    if (!apiKey) {
      return { success: false, error: 'No API key provided' };
    }

    if (!provider) {
      return { success: false, error: 'No provider specified' };
    }

    // Test with a simple prompt
    const testPrompt = "Hello, this is a test message. Please respond with 'API key valid'.";

    let response;
    switch (provider) {
      case 'openai':
        response = await callOpenAIHealthCheck(apiKey);
        break;
      case 'claude':
        response = await callClaudeAPI(apiKey, 'claude-haiku-4-5-20251001', testPrompt, {}, { max_tokens: 50, temperature: 1 });
        break;
      case 'gemini':
        {
          const model = normalizeGeminiModel(request.model || 'gemini-3.1-flash-preview');
          try {
            response = await callGeminiHealthCheck(apiKey, model, testPrompt);
          } catch (e) {
            const fallbacks = ['gemini-3.1-flash-preview', 'gemini-1.5-flash-8b', 'gemini-2.0-flash-exp'];
            for (const m of fallbacks) {
              try {
                response = await callGeminiHealthCheck(apiKey, m, testPrompt);
                if (response) break;
              } catch (_) { /* continue */ }
            }
          }
        }
        break;
      case 'kimi':
        response = await callKimiAPI(apiKey, request.model || 'moonshot-v1-32k', testPrompt, { max_tokens: 50, temperature: 1 });
        break;
      case 'deepseek':
        response = await callDeepSeekAPI(apiKey, request.model || 'deepseek-v4-flash', testPrompt, { max_tokens: 50, temperature: 0 });
        break;
      case 'nvidia':
        response = await callNvidiaAPI(apiKey, request.model || 'nvidia/llama-3.1-nemotron-51b-instruct', testPrompt, { max_tokens: 50, temperature: 1 });
        break;
      case 'groq':
        response = await callGroqHealthCheck(apiKey);
        break;
      default:
        return { success: false, error: `Unsupported provider: ${provider}` };
    }

    console.log('✅ API key test successful');
    return { success: true, message: 'API key valid', response: response };

  } catch (error) {
    console.error('❌ API key test failed:', error);
    return { success: false, error: error.message };
  }
}

// ✅ ADDED: Test API Connection Function (legacy support)
async function testAPIConnection() {
  return await extensionTester.testAPIConnection();
}

// Raw health-check that mirrors test_gemini_key.js behavior
async function callGeminiHealthCheck(apiKey, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 50, temperature: 0.1 }
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Gemini health-check failed (${model}): ${response.status} ${response.statusText} ${errorText}`.trim());
  }
  const data = await response.json().catch(() => ({}));
  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error(`Gemini health-check invalid response (${model})`);
  return content;
}

// OpenAI health-check - minimal request to verify API key validity
async function callOpenAIHealthCheck(apiKey) {
  const url = 'https://api.openai.com/v1/models';
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    }
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`OpenAI health-check failed: ${response.status} ${response.statusText} ${errorText}`.trim());
  }
  const data = await response.json().catch(() => ({}));
  // Consider it valid if we received a non-empty data object/list
  if (!data || (Array.isArray(data.data) && data.data.length === 0)) {
    throw new Error('OpenAI health-check returned empty models list');
  }
  return true;
}

// Groq health-check - minimal request to verify API key validity
async function callGroqHealthCheck(apiKey) {
  const url = 'https://api.groq.com/openai/v1/models';
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    }
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Groq health-check failed: ${response.status} ${response.statusText} ${errorText}`.trim());
  }
  const data = await response.json().catch(() => ({}));
  if (!data || (Array.isArray(data.data) && data.data.length === 0)) {
    throw new Error('Groq health-check returned empty models list');
  }
  return true;
}

// Normalize Gemini model names to API-supported IDs
function normalizeGeminiModel(model) {
  if (!model) return 'gemini-3.1-flash-preview';
  const m = model.toLowerCase();
  if (m.includes('1.5-flash-8b')) return 'gemini-1.5-flash-8b';
  if (m.includes('1.5-flash')) return 'gemini-3.1-flash-preview';
  if (m.includes('1.5-pro')) return 'gemini-1.5-pro';
  if (m.includes('2.0-flash')) return 'gemini-2.0-flash-exp';
  if (m.includes('pro')) return 'gemini-1.5-pro';
  return 'gemini-3.1-flash-preview';
}
// ✅ Keep service worker alive with periodic activity
function keepAlive() {
    setInterval(() => {
        console.log('🔄 Service worker keep-alive ping');
        try {
            chrome.action && chrome.action.setBadgeText({ text: '•' });
            chrome.action && chrome.action.setBadgeBackgroundColor && chrome.action.setBadgeBackgroundColor({ color: '#4caf50' });
            setTimeout(() => chrome.action && chrome.action.setBadgeText({ text: '' }), 1500);
        } catch (_) {}
    }, 20000); // Every 20 seconds
}

// Start keep-alive when service worker becomes active
chrome.runtime.onStartup.addListener(() => {
    console.log('🚀 Service worker started up');
    keepAlive();
    try { chrome.alarms.create('keepAliveAlarm', { periodInMinutes: 1 }); } catch (_) {}
});

chrome.runtime.onInstalled.addListener(() => {
    console.log('📦 Extension installed and ready!');
    keepAlive();
    try { chrome.alarms.create('keepAliveAlarm', { periodInMinutes: 1 }); } catch (_) {}
});

// Start keep-alive immediately
keepAlive();

// Alarms-based keep-alive (more reliable than setInterval alone)
try {
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === 'keepAliveAlarm') {
            console.log('⏰ keepAliveAlarm tick');
            // Lightweight storage get to ensure real work
            try { chrome.storage.local.get(null, () => {}); } catch (_) {}
            try {
                chrome.action && chrome.action.setBadgeText({ text: 'A' });
                chrome.action && chrome.action.setBadgeBackgroundColor && chrome.action.setBadgeBackgroundColor({ color: '#2196f3' });
                setTimeout(() => chrome.action && chrome.action.setBadgeText({ text: '' }), 1000);
            } catch (_) {}
        }
    });
} catch (_) {}

console.log('✅ Comprehensive Background Script loaded - Full AI Support + Enhanced Language Detection!');

// =========================================================================
// 🎙️ LIVE CAPTIONS & TAB AUDIO CAPTURE TRANSLATION ENGINE (PREMIUM VERSION)
// =========================================================================

// Global Capturing States
let isCapturing = false;
let activeTabId = null;
let isReconnecting = false;

// Auto-reconnect is meant for one specific case: the captured tab reloads or
// navigates, ending the audio track, and we resume once the page is back. It is
// NOT a standing invitation to restart. Without a deadline the "waiting to
// reconnect" flag stuck forever, so an ended video armed it and the next page
// load — minutes later, or after the user had stopped — silently relaunched
// captions. The watchdog gives up and stops for real if no reload arrives.
const RECONNECT_WINDOW_MS = 15000;
// How long a recorded stop suppresses session restore on a worker restart.
const RESTORE_BLOCK_AFTER_STOP_MS = 60000;
// Late "track ended" reports arrive as the offscreen document tears down; within
// this window after a user-initiated stop they are ignored rather than obeyed.
const USER_STOP_GRACE_MS = 3000;
// A start request this soon after an explicit stop is treated as the same click
// racing the Stop→Start button flip, not a deliberate restart.
const START_AFTER_STOP_COOLDOWN_MS = 1500;

// A latch on the user's intent, not a time window.
//
// Several independent mechanisms can bring a session back: the reconnect
// watchdog, the tabs.onUpdated page-load handler, the service-worker restore
// block, and a late "track ended" report from a closing offscreen document.
// Each has been fixed at least once with its own guard, and each guard is a
// timeout — 1.5s, 3s, 60s — so any restart arriving later than its own window
// still gets through, and every new automatic path has to remember to add one.
//
// This inverts that: once the user presses Stop, NOTHING automatic may start a
// capture again. Only an explicit start from the UI clears it. Time never does.
let _userStoppedLatch = false;

async function setUserStopLatch(on) {
  _userStoppedLatch = !!on;
  try { await chrome.storage.local.set({ ltUserStopped: !!on }); } catch (_) {}
}

/** True when the user has stopped captions and not explicitly started them again. */
function autoStartBlocked() {
  return _userStoppedLatch;
}
let _reconnectDeadline = 0;
let _reconnectWatchdog = null;
let _userStoppedAt = 0;

function clearReconnectWatchdog() {
  if (_reconnectWatchdog) {
    clearTimeout(_reconnectWatchdog);
    _reconnectWatchdog = null;
  }
  _reconnectDeadline = 0;
}

function armReconnectWatchdog(tabId) {
  clearReconnectWatchdog();
  isReconnecting = true;
  _reconnectDeadline = Date.now() + RECONNECT_WINDOW_MS;
  _reconnectWatchdog = setTimeout(async () => {
    _reconnectWatchdog = null;
    if (!isReconnecting) return;
    console.log('🎙️ [BG] Reconnect window expired without a page load. Stopping captions for real.');
    isReconnecting = false;
    _reconnectDeadline = 0;
    try {
      await stopTabCapture(tabId);
    } catch (_) {}
    broadcastMessage({ action: 'lt_status', status: 'stopped' });
  }, RECONNECT_WINDOW_MS);
}

function reconnectWindowOpen() {
  return isReconnecting && _reconnectDeadline > 0 && Date.now() <= _reconnectDeadline;
}
let autoReconnectConfig = null;
let _autoMutedTabs = [];
let _currentSession = null;
self.ltSessions = {};

let _saveSessionsTimeout = null;
let _isSavingSessions = false;
let _pendingSaveSessions = false;

async function saveLtSessions() {
  if (_isSavingSessions) {
    _pendingSaveSessions = true;
    return;
  }
  if (_saveSessionsTimeout) return;

  _saveSessionsTimeout = setTimeout(async () => {
    _saveSessionsTimeout = null;
    _isSavingSessions = true;
    try {
      await chrome.storage.local.set({ ltSessionsStored: self.ltSessions });
    } catch (err) {
      console.warn('⚠️ [BG] Failed to save ltSessionsStored:', err.message);
    } finally {
      _isSavingSessions = false;
      if (_pendingSaveSessions) {
        _pendingSaveSessions = false;
        saveLtSessions();
      }
    }
  }, 1000);
}

let _offscreenHeartbeat = null;
let _offscreenDocumentReady = false;

function startOffscreenHeartbeat() {
  stopOffscreenHeartbeat();
  _offscreenHeartbeat = setInterval(async () => {
    let alive = false;
    // Retry heartbeat ping up to 3 times to prevent false positives from brief IPC latency
    for (let i = 0; i < 3; i++) {
      try {
        const pingRes = await chrome.runtime.sendMessage({ target: 'offscreen', action: 'ping' });
        if (pingRes && pingRes.alive) {
          alive = true;
          break;
        }
      } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (!alive) {
      console.warn('💔 [BG] Offscreen heartbeat failed after retries, recreating...');
      stopOffscreenHeartbeat();
      if (isCapturing) {
        await createOffscreenDocument();
        startOffscreenHeartbeat();
      }
    }
  }, 20000); // Heartbeat ping every 20 seconds to prevent Chrome MV3 offscreen idle timeout
}

function stopOffscreenHeartbeat() {
  if (_offscreenHeartbeat) {
    clearInterval(_offscreenHeartbeat);
    _offscreenHeartbeat = null;
  }
}

// ─── 1. Offscreen Document Manager & Lifecycles ──────────────────────────

async function createOffscreenDocument() {
  const OFFSCREEN_PATH = 'shared/offscreen.html';

  if (typeof chrome.offscreen === 'undefined') {
    throw new Error('chrome.offscreen API is not supported in this browser.');
  }

  // Check if an offscreen context already exists first to avoid false-alarm connection error console warnings
  let hasContext = false;
  try {
    if (typeof chrome.runtime.getContexts === 'function') {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
      });
      hasContext = contexts && contexts.length > 0;
    }
  } catch (e) {
    console.warn('[BG] Error checking offscreen contexts:', e);
  }

  let isAlive = false;
  if (hasContext) {
    // Active ping responsiveness check with retries to prevent false-positives during transient delays
    for (let i = 0; i < 3; i++) {
      try {
        const pingRes = await chrome.runtime.sendMessage({ target: 'offscreen', action: 'ping' });
        if (pingRes && pingRes.alive) {
          isAlive = true;
          break;
        }
      } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (isAlive) {
      console.log('🎙️ [BG] Offscreen document is active and responsive.');
      _offscreenDocumentReady = true;
      return;
    }

    // If not responsive or not ready, clean up and close any stale context to prevent single document creation errors
    console.log('🎙️ [BG] Offscreen document not responding or not ready. Force closing before creation...');
    _offscreenDocumentReady = false;
    try {
      await chrome.offscreen.closeDocument();
      console.log('🎙️ [BG] Closed existing offscreen document context.');
    } catch (_) {
      // Ignore error if it did not exist
    }
  } else {
    console.log('🎙️ [BG] Offscreen document does not exist. Proceeding directly to creation...');
    _offscreenDocumentReady = false;
  }

  console.log('🎙️ [BG] Creating new offscreen document...');

  // Robust retry loop (up to 5 times) to handle Chrome's asynchronous closeDocument/createDocument race conditions
  let attempts = 5;
  while (attempts > 0) {
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
        justification: 'Capture active tab audio stream and play translated TTS audio'
      });
      console.log('🎙️ [BG] Offscreen document successfully created.');
      _offscreenDocumentReady = true;
      return;
    } catch (err) {
      console.warn(`⚠️ [BG] Offscreen document creation failed (attempts left: ${attempts - 1}):`, err.message);

      // If it says only a single offscreen document may be created, try to close it again
      if (err.message && err.message.includes('Only a single offscreen document')) {
        try {
          await chrome.offscreen.closeDocument();
        } catch (_) {}
      }

      attempts--;
      if (attempts === 0) {
        throw err;
      }
      // Wait 150ms before retrying to allow any pending asynchronous closeDocument to complete
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
}

async function closeOffscreenDocument() {
  _offscreenDocumentReady = false;
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    if (contexts.length === 0) return;
  } catch (_) {}

  console.log('🎙️ [BG] Closing offscreen document...');
  try {
    await chrome.offscreen.closeDocument();
  } catch (e) {
    console.warn('[BG] Error closing offscreen:', e.message);
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
    console.log(`🎙️ [BG] Content script already injected on tab ${tabId}`);
  } catch (_) {
    console.log(`🎙️ [BG] Content script not detected on tab ${tabId}. Programmatically injecting...`);
    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tabId },
        files: ['shared/styles.css']
      });
    } catch (e) {
      console.warn('[BG] CSS injection warning:', e.message);
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
        console.error(`[BG] Script injection failed for ${file} on tab ${tabId}:`, err.message);
      }
    }
  }
}

async function startTabCapture(tabId, streamId, config, trigger = 'unknown') {
  // Tagged so a service-worker log answers "who started this?" without guessing.
  console.log(`🎙️ [BG] START CAPTURE — trigger: ${trigger} | tab: ${tabId}`);
  try {
    // Reset and clear any stale TTS state for the new session
    clearTtsState();
    // A new session gets to be told about degradation again.
    resetLtWarnLatch();

    // Initialize session history log
    let sessionObj = null;
    try {
      const tab = await chrome.tabs.get(tabId);
      sessionObj = {
        id: 'sess_' + Date.now(),
        startTime: Date.now(),
        title: (config.ltMode === 'microphone') ? 'Microphone Translation' : (tab ? tab.title : 'Live Stream'),
        url: (config.ltMode === 'microphone') ? '' : (tab ? tab.url : ''),
        captions: []
      };
    } catch (_) {
      sessionObj = {
        id: 'sess_' + Date.now(),
        startTime: Date.now(),
        title: (config.ltMode === 'microphone') ? 'Microphone Translation' : 'Live Stream',
        url: '',
        captions: []
      };
    }
    _currentSession = sessionObj;
    await chrome.storage.local.set({ _currentSession: sessionObj }).catch(() => {});

    // Ensure content script is injected on the active tab (needed for non-Twitter sites after reload/navigation)
    try {
      await ensureContentScriptInjected(tabId);
    } catch (injectErr) {
      console.warn('⚠️ [BG] ensureContentScriptInjected failed:', injectErr.message);
    }

    // Stop translation on all other tabs to prevent audio overlap and mute them to focus on the current tab
    try {
      _autoMutedTabs = [];
      const allTabs = await chrome.tabs.query({});
      for (const tab of allTabs) {
        if (tab.id && tab.id !== tabId) {
          // Send stop message to pause videos/audio and hide subtitles on all other tabs
          try {
            await chrome.tabs.sendMessage(tab.id, { action: 'lt_stop' });
          } catch (_) {}

          // Mute other tabs to ensure focus and prevent audio interference
          if (tab.mutedInfo && !tab.mutedInfo.muted) {
            await chrome.tabs.update(tab.id, { muted: true }).catch(() => {});
            _autoMutedTabs.push(tab.id);
          }
        }
      }
    } catch (err) {
      console.warn('⚠️ [BG] Failed to clean up other tabs:', err);
    }

    // Focus on the current tab and its window to ensure no permission restrictions
    try {
      const activeTab = await chrome.tabs.get(tabId);
      if (activeTab) {
        await chrome.tabs.update(tabId, { active: true }).catch(() => {});
        await chrome.windows.update(activeTab.windowId, { focused: true }).catch(() => {});
      }
    } catch (_) {}

    await createOffscreenDocument();
    startOffscreenHeartbeat(); // Heartbeat ping to keep document alive

    isCapturing = true;
    activeTabId = tabId;
    clearReconnectWatchdog();
    isReconnecting = false;
    autoReconnectConfig = config;

    // Persist active capture state to storage for Service Worker lifecycle resilience
    chrome.storage.local.set({
      isCapturing: true,
      activeTabId: tabId,
      autoReconnectConfig: config
    }).catch(() => {});

    // Clear any stale captions session state
    if (self.ltSessions) {
      self.ltSessions[tabId] = {
        chunks: [],
        lastText: '',
        lastTimestamp: Date.now(),
        history: [],
        segmentId: 'seg_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        config: config,
        nextExpectedSeq: 0,
        transcriptionBuffer: {},
        _gapSince: null,
        _gapSeq: undefined
      };
      await saveLtSessions();
    }

    // Persist Mute Tab and TTS states in storage so popup toggle reflects properly
    const storageData = await chrome.storage.local.get(['ltMuteTab', 'ltTtsEnabled', 'ltTtsOriginalAudio']);
    const isMuted = !!storageData.ltMuteTab;
    const isTtsEnabled = !!storageData.ltTtsEnabled;

    console.log(`🎙️ [BG] Tab audio capture starting on tab ID: ${tabId}. Muted: ${isMuted}, TTS Enabled: ${isTtsEnabled}`);

    // Send control message to the offscreen page to launch getUserMedia immediately!
    chrome.runtime.sendMessage({
      target: 'offscreen',
      action: 'start_capture',
      streamId: streamId,
      config: {
        ...config,
        ltMuteTab: isMuted,
        ltTtsEnabled: isTtsEnabled,
        ltTtsOriginalAudio: storageData.ltTtsOriginalAudio || 'mute',
        // Streaming ASR runs its socket in the offscreen document, so it needs
        // the engine choice and key up front — the service worker may be evicted
        // long before the stream ends.
        ltAsrEngine: _cachedAsrEngine,
        dgApiKey: _cachedDeepgramApiKey,
        dgModel: _cachedDeepgramModel || 'nova-2',
        tabId: tabId
      }
    });

    // Programmatically check and mute tab playback if TTS or mute is enabled
    try {
      await chrome.tabs.update(tabId, { muted: isMuted });
    } catch (_) {}

    // Broadcast status to sync sidepanel and popup UIs immediately!
    broadcastMessage({ action: 'lt_status', status: 'listening', tabId: tabId });

    return { success: true };
  } catch (err) {
    console.error('❌ [BG] startTabCapture failed:', err);
    stopOffscreenHeartbeat();
    return { success: false, error: err.message };
  }
}

async function stopTabCapture(tabId) {
  console.log('🎙️ [BG] Stopping tab capture. tabId:', tabId);
  isCapturing = false;
  activeTabId = null;
  clearReconnectWatchdog();
  isReconnecting = false;
  autoReconnectConfig = null;

  // Awaited on purpose. This used to be fire-and-forget, and closeOffscreenDocument()
  // below removes the keep-alive — so the service worker could be torn down before
  // the write landed, leaving isCapturing:true in storage. The next time the worker
  // woke, the recovery block at the bottom of this file read that stale flag and
  // brought the session back on its own. That is the "tự động chạy lại".
  try {
    await chrome.storage.local.set({
      isCapturing: false,
      activeTabId: null,
      autoReconnectConfig: null,
      ltStoppedAt: Date.now()
    });
  } catch (_) {}

  stopOffscreenHeartbeat(); // Stop Heartbeat ping
  clearTtsState(); // Clear and stop TTS state immediately

  // Save active session history log
  const { _currentSession: storedSession } = await chrome.storage.local.get(['_currentSession']);
  const sessionObj = storedSession || _currentSession;
  if (sessionObj && sessionObj.captions && sessionObj.captions.length > 0) {
    sessionObj.endTime = Date.now();
    try {
      const { ltSessionHistory = [] } = await chrome.storage.local.get(['ltSessionHistory']);
      ltSessionHistory.unshift(sessionObj); // newest first
      if (ltSessionHistory.length > 50) ltSessionHistory.pop(); // Limit to 50 sessions
      await chrome.storage.local.set({ ltSessionHistory });
      console.log(`🎙️ [BG] Saved session history log: ${sessionObj.id} with ${sessionObj.captions.length} captions.`);
    } catch (err) {
      console.warn('⚠️ [BG] Failed to save session history:', err);
    }
  }
  _currentSession = null;
  await chrome.storage.local.remove('_currentSession').catch(() => {});

  try {
    // Control message to offscreen page to release hardware stream
    chrome.runtime.sendMessage({
      target: 'offscreen',
      action: 'stop_capture'
    });
  } catch (_) {}

  // Clean up session chunks
  if (self.ltSessions && self.ltSessions[tabId]) {
    delete self.ltSessions[tabId];
    await saveLtSessions();
  }

  // Restore tab audio playback and hide subtitle overlay on content script
  try {
    if (tabId) {
      await chrome.tabs.update(tabId, { muted: false });
      await chrome.tabs.sendMessage(tabId, { action: 'lt_stop' }).catch(() => {});
    }
  } catch (_) {}

  // Unmute all other tabs that we auto-muted
  try {
    if (_autoMutedTabs && _autoMutedTabs.length > 0) {
      for (const otherTabId of _autoMutedTabs) {
        await chrome.tabs.update(otherTabId, { muted: false }).catch(() => {});
      }
      _autoMutedTabs = [];
    }
  } catch (_) {}

  await closeOffscreenDocument();

  // Broadcast status to sync sidepanel and popup UIs immediately!
  broadcastMessage({ action: 'lt_status', status: 'stopped' });

  return { success: true };
}

// Automatically stop capturing if the tab being recorded is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (isCapturing && tabId === activeTabId) {
    console.log('🎙️ [BG] Captured tab was closed. Cleaning up...');
    stopTabCapture(tabId).catch(() => {});
    broadcastMessage({ action: 'lt_tab_stop' });
  }
});

// Automatically restore audio (unmute) when a previously captured/muted tab becomes active
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.mutedInfo && tab.mutedInfo.muted && tab.mutedInfo.reason === 'extension') {
      // Retrieve background state to see if this is the currently captured tab
      if (!isCapturing || activeTabId !== tab.id) {
        console.log(`🎙️ [BG] Tab ${tab.id} activated. Restoring audio (unmuting).`);
        await chrome.tabs.update(tab.id, { muted: false });
      }
    }
  } catch (e) {
    console.warn('[BG] Failed to restore audio on tab activation:', e);
  }
});

// Automatically reconnect tab capture when the captured tab is reloaded or navigated!
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId === activeTabId && changeInfo.status === 'complete' && isCapturing && reconnectWindowOpen() && !autoStartBlocked()) {
    console.log(`🎙️ [BG] Captured tab ${tabId} loaded. Attempting automatic tab capture reconnection...`);

    setTimeout(async () => {
      // Re-verify capture session parameters. The latch is re-checked here too:
      // the user can press Stop during this delay.
      if (!isCapturing || !reconnectWindowOpen() || activeTabId !== tabId || autoStartBlocked()) return;

      try {
        const config = autoReconnectConfig || {};

        chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, async (streamId) => {
          if (chrome.runtime.lastError || !streamId) {
            const errMsg = chrome.runtime.lastError?.message || 'No stream ID';
            console.warn('🎙️ [BG] Auto-reconnect getMediaStreamId failed:', errMsg);
            
            // If the permission was denied, or it is a fatal permission error, stop capture entirely!
            if (errMsg.toLowerCase().includes('denied') || errMsg.toLowerCase().includes('permission') || errMsg.toLowerCase().includes('active tab')) {
              console.error('❌ [BG] Fatal permission denied during reconnect. Terminating captioning session.');
              await stopTabCapture(tabId);
              broadcastMessage({ action: 'lt_error', error: 'Capture permission denied: ' + errMsg });
            }
            return;
          }

          console.log(`🎙️ [BG] Auto-reconnect got stream ID. Resuming capture...`);
          clearReconnectWatchdog();
          isReconnecting = false;
          await startTabCapture(tabId, streamId, config, 'auto-reconnect-after-page-load');

          // Notify the UI if open to ensure smooth sync
          broadcastMessage({ action: 'lt_tab_reconnected', tabId: tabId });
        });
      } catch (err) {
        console.warn('🎙️ [BG] Auto-reconnect startTabCapture failed:', err.message);
      }
    }, 1500); // 1.5s delay to guarantee standard page environment initializations
  }
});

// Which degradation notices this session has already sent. The warning sites
// fire per SENTENCE with no throttle, and quota exhaustion lasts the rest of the
// day, so an un-latched notice would repaint on every line forever — which is
// precisely why the overlay was never given a warning handler in the first place.
// Latch by kind: say it once, then stay quiet.
let _ltWarnLatch = new Set();

function resetLtWarnLatch() {
  _ltWarnLatch = new Set();
}

// Tell the in-page overlay that output has degraded (quota gone, AI failed,
// Google unreachable), at most once per kind per session.
function notifyDegraded(kind, message) {
  if (_ltWarnLatch.has(kind)) return;
  _ltWarnLatch.add(kind);
  try {
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, {
        action: 'lt_degraded',
        kind,
        message
      }).catch(() => {});
    }
  } catch (_) {}
}

// Broadcast a message to all active pages (content scripts and popup)
function broadcastMessage(payload) {
  try {
    // Live-translation messages belong to the tab being CAPTURED. Capture keeps
    // running when the user switches tabs, so an active-tab query delivered
    // captions to whatever they had switched to — rendering them over a second
    // X/Twitter tab, or dropping them at the .catch() otherwise. In a service
    // worker `currentWindow` also resolves to the last-focused window, so moving
    // between Chrome windows misrouted too. activeTabId is already tracked and
    // used correctly elsewhere in this file.
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, payload).catch(() => {});
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, ([activeTab]) => {
        if (activeTab && activeTab.id) {
          chrome.tabs.sendMessage(activeTab.id, payload).catch(() => {});
        }
      });
    }
  } catch (_) {}
  try {
    chrome.runtime.sendMessage(payload).catch(() => {});
  } catch (_) {}
}

// ─── 2. Parallel Audio Processing & Sliding Window Reassembly ───────────

// Consecutive ASR failure counter — gates the user-facing warning toast so a
// single transient blip does not surface noise during a live session.
let _asrFailStreak = 0;

// Below this, a segment is treated as silence and never sent to the ASR API.
const RMS_MIN_THRESHOLD = 0.004;
// Comfortably above the floor = someone is genuinely speaking, so phrases that
// are usually Whisper's silence-filler ("thank you", "goodbye", "xin chào") are
// real dialogue here and must not be filtered. This replaces the old Movie Mode
// toggle: the same judgement, but made per segment instead of per session, so a
// stream that mixes music and dialogue is handled correctly either way.
const RMS_STRONG_SPEECH_MULTIPLIER = 2.5;

// ─── Cabin mode: incremental phrase translation ──────────────────────────────
// Commit a phrase once this many NEW words have settled. Around five words is
// where a fragment usually carries enough meaning to translate on its own;
// smaller pieces produce word salad, larger ones bring back the stall.
const CABIN_PHRASE_WORDS = 5;
// The last words of an interim hypothesis are the ones the recogniser is most
// likely to revise, so never commit them — wait for more audio to settle them.
const CABIN_TAIL_WORDS = 2;
// Floor on how often a phrase may be translated, so a fast speaker cannot turn
// every interim into its own request.
const CABIN_MIN_INTERVAL_MS = 500;
// A word count alone leaves a lump at the end of every sentence: whatever has
// not reached CABIN_PHRASE_WORDS when the speaker stops arrives all at once, so
// the rhythm still breaks — just later. Past this much lag, take a shorter
// phrase rather than keep waiting. Interpreters do the same: they go when they
// have a unit OR when they have fallen too far behind, whichever comes first.
const CABIN_MAX_LAG_MS = 1400;
const CABIN_MIN_PHRASE_WORDS = 3;

function cabinState(session) {
  if (!session._cabin) {
    session._cabin = { committed: 0, translated: '', lastAt: 0, busy: false, lastPaintAt: 0 };
  }
  return session._cabin;
}

/** Translate one phrase, using whichever subtitle engine the user picked. */
async function translateCabinPhrase(text, session, cfg) {
  const targetLang = cfg.targetLang || 'vi';
  const topic = _cachedTopic || 'general';
  const engine = cfg.ltEngine || 'google';
  let out = '';

  if (engine === 'openai' || engine === 'groq') {
    const res = await translateLiveWithAI({
      text,
      from: cfg.sourceLang || 'auto',
      to: targetLang,
      // The discourse context is what makes a fragment translatable at all —
      // guideline #5 of the live prompt exists for exactly this case.
      context: [...(session.history || [])],
      topic
    });
    out = (res && res.success && res.translated) ? res.translated : '';
  }
  if (!out) out = await translateGoogleBg(text, targetLang);
  return await polishLiveTranslation(out, text, targetLang, topic);
}

async function handleCabinInterim(request) {
  const tabId = activeTabId;
  if (!tabId) return;
  if (!self.ltSessions) self.ltSessions = {};
  if (!self.ltSessions[tabId]) {
    self.ltSessions[tabId] = {
      chunks: [], lastText: '', lastTimestamp: Date.now(), history: [],
      segmentId: 'seg_' + Date.now() + '_' + Math.floor(Math.random() * 1000)
    };
  }
  const session = self.ltSessions[tabId];
  const cfg = request.config || {};

  // A new utterance begins whenever the previous one was closed out. Reset the
  // phrase cursor here rather than only on the final: if the socket drops or the
  // recogniser never sends a final, a stale `committed` offset would slice the
  // NEXT utterance from the wrong index and silently swallow its opening words.
  if (!session._utteranceStartedAt) {
    session._cabin = null;
    session._utteranceStartedAt = Date.now();
  }
  const st = cabinState(session);

  const words = String(request.text || '').trim().split(/\s+/).filter(Boolean);
  // Show the speaker's own words running ahead of the translation, so the tail
  // of the sentence is never a blank gap while its phrase is still in flight.
  //
  // Throttled: a recogniser can revise its hypothesis several times a second and
  // each of these costs two extension message hops plus a DOM rebuild, for a
  // change the eye cannot resolve anyway. ~8/s still reads as continuous.
  const nowMs = Date.now();
  if (nowMs - (st.lastPaintAt || 0) >= 120) {
    st.lastPaintAt = nowMs;
    broadcastMessage({
      action: 'lt_cabin_line',
      translated: st.translated,
      tail: words.slice(st.committed).join(' '),
      targetLang: cfg.targetLang || 'vi',
      done: false
    });
  }

  if (st.busy) return;
  if (Date.now() - st.lastAt < CABIN_MIN_INTERVAL_MS) return;

  const stableCount = Math.max(0, words.length - CABIN_TAIL_WORDS);
  const pending = stableCount - st.committed;
  const lag = Date.now() - (st.lastAt || 0);
  const ready = pending >= CABIN_PHRASE_WORDS ||
                (pending >= CABIN_MIN_PHRASE_WORDS && lag >= CABIN_MAX_LAG_MS);
  if (!ready) return;

  const phrase = words.slice(st.committed, stableCount).join(' ');
  if (!phrase.trim()) return;

  st.busy = true;
  st.lastAt = Date.now();
  try {
    const piece = (await translateCabinPhrase(phrase, session, cfg) || '').trim();
    if (piece) {
      st.translated = st.translated ? `${st.translated} ${piece}` : piece;
      st.committed = stableCount;
      broadcastMessage({
        action: 'lt_cabin_line',
        translated: st.translated,
        tail: words.slice(st.committed).join(' '),
        targetLang: cfg.targetLang || 'vi',
        done: false
      });
      // Speak only the new piece. The voice then runs continuously alongside the
      // speaker instead of falling silent until the sentence closes.
      if (_cachedTtsEnabled) {
        speakSubtitle(piece, cfg.targetLang || 'vi', _cachedTtsSpeed || 1.25, phrase, session.segmentId, (session.subtitleSeq = (session.subtitleSeq || 0) + 1));
      }
    }
  } catch (err) {
    console.warn('⚠️ [BG] cabin phrase translation failed:', err.message);
  } finally {
    st.busy = false;
  }
}

// ─── ASR call pacing ─────────────────────────────────────────────────────────
// Chunks are handed to the transcriber without awaiting, so nothing bounded how
// many were in flight: a burst of short segments fired a burst of requests and
// tripped the provider's per-minute limit. Cap concurrency and, once a rate
// limit is actually seen, space calls out until it clears.
const ASR_MAX_IN_FLIGHT = 2;
let _asrInFlight = 0;
const _asrWaiters = [];
let _asrRateLimitedUntil = 0;
let _asrRateLimitStreak = 0;

function noteAsrRateLimit(limited) {
  if (limited) {
    _asrRateLimitStreak = Math.min(_asrRateLimitStreak + 1, 6);
    // Widen the spacing each time it happens, up to 4s between calls.
    const spacing = Math.min(500 * Math.pow(2, _asrRateLimitStreak - 1), 4000);
    _asrRateLimitedUntil = Date.now() + spacing;
    console.warn(`⚠️ [BG] ASR rate limited — spacing calls ${spacing}ms (streak ${_asrRateLimitStreak}).`);
  } else if (_asrRateLimitStreak > 0) {
    _asrRateLimitStreak = 0;
    _asrRateLimitedUntil = 0;
    console.log('✅ [BG] ASR rate limit cleared.');
  }
}

async function acquireAsrSlot() {
  if (_asrInFlight >= ASR_MAX_IN_FLIGHT) {
    await new Promise(resolve => _asrWaiters.push(resolve));
  }
  _asrInFlight++;
  const wait = _asrRateLimitedUntil - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}

function releaseAsrSlot() {
  _asrInFlight = Math.max(0, _asrInFlight - 1);
  const next = _asrWaiters.shift();
  if (next) next();
}

function isStrongSpeech(maxRms) {
  return typeof maxRms === 'number' && maxRms >= RMS_MIN_THRESHOLD * RMS_STRONG_SPEECH_MULTIPLIER;
}

async function transcribeAudioSegmentConcurrently(audioBase64, config, seq, session, tabId, hasSound, maxRms, avgRms, durationMs) {
  const { sourceLang, targetLang, apiKey, ltEngine } = config;
  const activeTopic = _cachedTopic;

  const rmsMinThreshold = RMS_MIN_THRESHOLD;
  const rmsScore = maxRms !== undefined ? maxRms : 0;
  const isTooQuiet = rmsScore < rmsMinThreshold || (avgRms !== undefined && avgRms < rmsMinThreshold * 0.25);

  // If VAD explicitly indicates no speech/sound OR if audio is below RMS threshold, skip API call.
  if (hasSound === false || isTooQuiet) {
    console.log(`🎙️ [BG] Segment ${seq} skipped (hasSound=${hasSound}, maxRms=${rmsScore.toFixed(5)} < ${rmsMinThreshold}, avgRms=${(avgRms || 0).toFixed(5)}). Skipping API transcription.`);
    if (!session.transcriptionBuffer) {
      session.transcriptionBuffer = {};
    }
    session.transcriptionBuffer[seq] = {
      text: '',
      success: true,
      skipped: true,
      maxRms: rmsScore,
      avgRms: avgRms !== undefined ? avgRms : 0,
      audioMs: durationMs || 0,
      hasSound: hasSound,
      asrEngine: 'skipped',
      asrModel: 'skipped',
      base64Length: audioBase64 ? audioBase64.length : 0
    };
    await saveLtSessions();
    await processReadyTranscriptions(session, config, tabId);
    return;
  }

  console.log(`🎙️ [BG] Concurrently transcribing segment ${seq}. Base64 length: ${audioBase64.length} | Topic: ${activeTopic}`);

  let transcribedText = '';
  let asrEngine = _cachedAsrEngine;
  let modelUsed = '';
  let success = true;
  let errorMsg = '';

  let asrSlotHeld = false;
  try {
    // The ASR engine is whatever the user picked in Options — nothing silently
    // reroutes to a pricier provider. Prompt chaining (feeding recent output
    // back in as Whisper's prompt) is gone too: it sharpened proper nouns but
    // is a known amplifier of Whisper's repetition/hallucination loops.
    let customPrompt = '';

    await acquireAsrSlot();
    asrSlotHeld = true;

    if (asrEngine === 'groq') {
      const groqKey = _cachedGroqApiKey;
      const groqModel = _cachedGroqModel || 'whisper-large-v3';
      modelUsed = groqModel;
      if (!groqKey) {
        throw new Error('Groq API Key is missing. Please add it in settings.');
      }
      transcribedText = await transcribeGroq(audioBase64, sourceLang, targetLang, groqKey, groqModel, activeTopic, customPrompt);
    } else {
      // Default to OpenAI Whisper
      const whisperKey = _cachedOpenaiApiKey || apiKey;
      const openaiModel = _cachedOpenaiWhisperModel || 'whisper-1';
      modelUsed = openaiModel;
      if (!whisperKey) {
        throw new Error('OpenAI API Key is missing. Please add it in settings.');
      }
      transcribedText = await transcribeWhisper(audioBase64, sourceLang, targetLang, whisperKey, activeTopic, customPrompt, openaiModel);
    }
    _asrFailStreak = 0; // reset warning gate on any successful transcription
  } catch (err) {
    if (err && (err.status === 429 || err.status === 503)) {
      notifyDegraded('asr-rate-limit', 'ASR bị giới hạn tốc độ — đang giãn nhịp gọi');
    }
    console.error(`❌ [BG] Parallel transcription failed for segment ${seq}:`, err);
    // Only surface a user-facing toast after 2+ consecutive failures.
    // A single transient network blip self-heals via the next segment and the
    // warning toast is pure noise during a livestream.
    _asrFailStreak++;
    if (_asrFailStreak >= 2) {
      broadcastMessage({ action: 'lt_warning', error: `Transcription is failing repeatedly (${_asrFailStreak} segments): ` + err.message });
    }
    transcribedText = '';
    success = false;
    errorMsg = err.message;
  } finally {
    if (asrSlotHeld) releaseAsrSlot();
    // ALWAYS populate the buffer slot even if the chunk failed or threw an error,
    // to prevent blocking the sequential chronological reassembly queue!
    if (!session.transcriptionBuffer) {
      session.transcriptionBuffer = {};
    }
    // If the gap watchdog already skipped past this seq, the slot would never be
    // read again — writing it would leak the entry for the rest of the session.
    if (session.nextExpectedSeq !== undefined && seq < session.nextExpectedSeq) {
      console.warn(`⚠️ [BG] Late ASR result for seq ${seq} arrived after the watchdog skipped it — discarding.`);
      return;
    }
    session.transcriptionBuffer[seq] = {
      text: transcribedText,
      success: success,
      skipped: false,
      error: errorMsg,
      maxRms: rmsScore,
      avgRms: avgRms !== undefined ? avgRms : 0,
      audioMs: durationMs || 0,
      hasSound: hasSound,
      asrEngine: asrEngine,
      asrModel: modelUsed,
      base64Length: audioBase64 ? audioBase64.length : 0
    };
    await saveLtSessions();

    // Process ready transcriptions in chronological order
    await processReadyTranscriptions(session, config, tabId);
  }
}

// Per-session re-entrancy guard: two ASR segments resolving simultaneously used
// to run this loop concurrently and interleave mutations of session.chunks,
// producing mixed/duplicated sentences. The guard serializes runs and re-drains
// if new segments arrived while a run was in flight.
const _procLocks = new WeakMap(); // session -> { running, pending }

async function processReadyTranscriptions(session, config, tabId) {
  let lock = _procLocks.get(session);
  if (!lock) {
    lock = { running: false, pending: false };
    _procLocks.set(session, lock);
  }
  if (lock.running) {
    lock.pending = true;
    return;
  }
  lock.running = true;
  try {
    do {
      lock.pending = false;
      await _drainReadyTranscriptions(session, config, tabId);
    } while (lock.pending);
  } finally {
    lock.running = false;
  }
}

async function _drainReadyTranscriptions(session, config, tabId) {
  const { sourceLang, targetLang, ltEngine } = config;
  const activeTopic = _cachedTopic;

  if (session.nextExpectedSeq === undefined) {
    session.nextExpectedSeq = 0;
  }

  // A seq that never arrives used to stall reassembly for the REST of the
  // session — nothing anywhere fills or skips a missing slot, so every later
  // chunk piled up in the buffer unread and the overlay froze. The gap survived
  // a service-worker restart too, because the session is persisted intact.
  // 14000ms is above the worst-case ASR path: 2 attempts x 6000ms abort + 500ms backoff.
  const GAP_TIMEOUT_MS = 14000;

  // Process sequentially from nextExpectedSeq onwards as they become ready
  while (session.transcriptionBuffer) {
    if (session.transcriptionBuffer[session.nextExpectedSeq] === undefined) {
      const pending = Object.keys(session.transcriptionBuffer).map(Number).filter(n => n > session.nextExpectedSeq);
      // Nothing newer waiting: we are legitimately just ahead of the encoder.
      if (pending.length === 0) break;
      if (!session._gapSince || session._gapSeq !== session.nextExpectedSeq) {
        session._gapSince = Date.now();
        session._gapSeq = session.nextExpectedSeq;
        break;
      }
      if (Date.now() - session._gapSince < GAP_TIMEOUT_MS) break;
      console.warn(`⚠️ [BG] ASR seq ${session.nextExpectedSeq} never arrived — skipping to unblock reassembly.`);
      session.nextExpectedSeq = Math.min(...pending);
      // Drop anything now behind the watermark so it cannot leak forever.
      for (const k of Object.keys(session.transcriptionBuffer)) {
        if (Number(k) < session.nextExpectedSeq) delete session.transcriptionBuffer[k];
      }
      session._gapSince = null;
      session._gapSeq = undefined;
      continue;
    }
    session._gapSince = null;
    session._gapSeq = undefined;
    const seq = session.nextExpectedSeq;
    const chunkObj = session.transcriptionBuffer[seq];
    const transcribedText = (chunkObj && typeof chunkObj === 'object') ? (chunkObj.text || '') : (chunkObj || '');
    
    // Remove from buffer to save space
    delete session.transcriptionBuffer[seq];
    session.nextExpectedSeq++;
    await saveLtSessions();

    console.log(`🎙️ [BG] Processing chunk ${seq} in order. Text: "${transcribedText.trim()}"`);

    // 1. Silent or empty chunk.
    if (!transcribedText || !transcribedText.trim()) {
      session.consecutiveSilenceCount = (session.consecutiveSilenceCount || 0) + 1;
      console.log(`🎙️ [BG] Chunk ${seq} is empty/silence. Consecutive silence count: ${session.consecutiveSilenceCount}`);
      if (session.consecutiveSilenceCount >= 1) {
        if (session.chunks && session.chunks.length > 0) {
          console.log(`🎙️ [BG] Silent chunk detected. Force-finalizing pending text.`);
          await finalizeAndTranslateSentence(session, sourceLang, targetLang, ltEngine, activeTopic);
        }
      }
      await saveLtSessions();
      continue;
    }

    // 2. Filter out Whisper silence/noise hallucinations. How loud this exact
    // segment was decides whether everyday phrases count as dialogue.
    const chunkHadStrongSpeech = isStrongSpeech(chunkObj && chunkObj.maxRms);
    if (chunkHadStrongSpeech) session.lastStrongSpeech = true;
    if (isWhisperHallucination(transcribedText, chunkHadStrongSpeech)) {
      session.consecutiveSilenceCount = (session.consecutiveSilenceCount || 0) + 1;
      console.log(`🎙️ [BG] Chunk ${seq} Whisper silence hallucination filtered: "${transcribedText.trim()}". Consecutive silence count: ${session.consecutiveSilenceCount}`);
      if (session.consecutiveSilenceCount >= 1) {
        if (session.chunks && session.chunks.length > 0) {
          console.log(`🎙️ [BG] Force-finalizing pending text before skipping hallucination.`);
          await finalizeAndTranslateSentence(session, sourceLang, targetLang, ltEngine, activeTopic);
        }
      }
      await saveLtSessions();
      continue;
    }

    // We received real, valid text. Reset the consecutive silence count.
    session.consecutiveSilenceCount = 0;

    // 3. Pre-correct acoustic tech nouns & stutter
    let cleanedText = cleanAndPrecorrectOriginalText(transcribedText, activeTopic);
    cleanedText = cleanConsecutiveDuplicates(cleanedText);

    // ─── Structured ASR Debug Logging ───
    const duration = config.segmentDuration || 2500;
    const base64Len = chunkObj && typeof chunkObj === 'object' ? (chunkObj.base64Length || 0) : 0;
    const asrEngine = chunkObj && typeof chunkObj === 'object' ? (chunkObj.asrEngine || 'unknown') : 'unknown';
    const asrModel = chunkObj && typeof chunkObj === 'object' ? (chunkObj.asrModel || 'unknown') : 'unknown';
    const hasSoundVal = chunkObj && typeof chunkObj === 'object' ? chunkObj.hasSound : true;
    const maxRmsVal = chunkObj && typeof chunkObj === 'object' ? (chunkObj.maxRms !== undefined ? chunkObj.maxRms : 0) : 0;
    const avgRmsVal = chunkObj && typeof chunkObj === 'object' ? (chunkObj.avgRms !== undefined ? chunkObj.avgRms : 0) : 0;

    console.log(`🎙️ [BG] ASR #${seq} (${duration}ms, ASR: ${asrEngine}/${asrModel}) | Sound: ${hasSoundVal} | RMS: ${maxRmsVal.toFixed(4)}/${avgRmsVal.toFixed(4)} | Text: "${transcribedText.trim()}" -> "${cleanedText.trim()}"`);

    // Accumulate how much real audio the sentence being assembled covers. A
    // sentence spans 1-3 chunks, and this total is what lets the overlay hold a
    // caption for as long as it was actually spoken instead of guessing from
    // character count.
    const chunkAudioMs = chunkObj && typeof chunkObj === 'object' ? (chunkObj.audioMs || 0) : 0;
    session.audioMs = (session.audioMs || 0) + chunkAudioMs;

    if (!cleanedText || !cleanedText.trim()) continue;

    // Save clean segment context (excluding hallucinations, skipped, empty, and low RMS)
    // Constraint: text length >= 12 chars and word count >= 3
    // (cleanAsrHistory was maintained here and never read by anything — a
    // leftover of the Whisper prompt-chaining that was removed on purpose,
    // because feeding the previous transcript back is a known amplifier of
    // Whisper's repetition loops. Rolling context for TRANSLATION still exists,
    // as session.history. Dropped the write, the field, and its four resets.)

    // 4. Boundary check and sentence accumulation
    session.lastTimestamp = Date.now();

    const splitIntoSentences = (text) => {
      if (!text) return [];
      // Added Hindi danda (।) to sentence boundary detection
      return text.split(/(?<=[.!?。！？।])\s+(?=\S)/).map(s => s.trim()).filter(s => s.length > 0);
    };

    const sentences = splitIntoSentences(cleanedText);
    for (const sentence of sentences) {
      if (session.chunks.length >= 3) {
        console.log(`🎙️ [BG] Chunks overflow (>=3). Force-finalizing to prevent duplication/drift.`);
        await finalizeAndTranslateSentence(session, sourceLang, targetLang, ltEngine, activeTopic);
      }
      // Start time-cap timer when beginning to accumulate a new sentence
      if (!session.chunks || session.chunks.length === 0) {
        session.sentenceStartTime = Date.now();
      }
      session.chunks.push(sentence);
    }

    let fullOriginalText = session.chunks.join(' ');
    fullOriginalText = cleanIncompletePunctuation(fullOriginalText);
    fullOriginalText = cleanConsecutiveDuplicates(fullOriginalText);

    // Keep the session memory synchronized with the cleaned text as individual sentences
    session.chunks = splitIntoSentences(fullOriginalText);

    // 5. Cognitive Semantic Completion Checking
    const endsWithPunctuation = /[.!?。！？।]$/.test(fullOriginalText.trim());
    const hasMultipleSentences = /[.!?。！？।]\s+(?=\S)/.test(fullOriginalText);
    const wordCount = fullOriginalText.split(/\s+/).length;
    const accumulatedMs = session.sentenceStartTime ? (Date.now() - session.sentenceStartTime) : undefined;

    const shouldFinalize = shouldFinalizeSegment({
      text: fullOriginalText,
      sourceLang,
      endsWithPunctuation,
      hasMultipleSentences,
      wordCount,
      accumulatedMs
    });

    if (shouldFinalize) {
      console.log(`🎙️ [BG] Chunk ${seq} -> Sentence complete (shouldFinalize=true). Word count: ${wordCount}`);
      await finalizeAndTranslateSentence(session, sourceLang, targetLang, ltEngine, activeTopic);
    } else {
      // ✅ DỊCH NHẢ (Interim translation): Translate the incomplete segment using Google Translate for zero-latency feedback
      console.log(`🎙️ [BG] Chunk ${seq} -> Sentence incomplete. Translating interim segment: "${fullOriginalText}"`);
      await saveLtSessions();

      const currentText = fullOriginalText;
      const currentSegmentId = session.segmentId;

      // Coalesce interim translations: if one is already in flight, skip this one.
      // Previously every incomplete chunk re-translated the FULL accumulated text
      // on the same serial chain as final translations — O(n²) work that delayed
      // final subtitles. Skipped interims are harmless: the next chunk (or the
      // final translation) supersedes them anyway.
      // Interim lines were fired once per chunk, which roughly doubled the
      // request rate for output that is thrown away the moment the real
      // translation lands. With the sentence hold now at 2500ms the gap they
      // cover is much shorter, so one every 1500ms is enough to keep the overlay
      // alive without paying for the rest.
      const sinceLastInterim = Date.now() - (session._lastInterimAt || 0);
      if (!session._interimBusy && sinceLastInterim >= 1500) {
        session._interimBusy = true;
        session._lastInterimAt = Date.now();
        session.translationChain = (session.translationChain || Promise.resolve()).then(async () => {
          try {
            let interimTranslated = await translateGoogleBg(currentText, targetLang);
            // polishLiveTranslation had exactly one caller, on the FINAL path, so
            // interim lines reached the screen as raw Google output: terms left
            // untranslated back into Vietnamese ("mã thông báo" for token, "khí ga"
            // for gas fee), and no Arc/Circle protection either. The glossary is
            // memoised for 30s, so this is in-memory regex work, not a round trip.
            interimTranslated = await polishLiveTranslation(
              interimTranslated, currentText, targetLang, activeTopic);
            if (interimTranslated && interimTranslated.trim()) {
              session.subtitleSeq = (session.subtitleSeq || 0) + 1;
              // Format with mic emoji to signal to content script that it is an interim real-time update
              broadcastMessage({
                action: 'lt_subtitle',
                original: currentText,
                translated: '🎙️ ' + interimTranslated.trim(),
                mode: 'tabCapture',
                timestamp: Date.now(),
                segmentId: currentSegmentId,
                sequenceNumber: session.subtitleSeq,
                targetLang: targetLang,
                isUpdate: true
              });
            }
          } catch (interimErr) {
            console.warn('⚠️ [BG] Fast interim translation failed:', interimErr);
          } finally {
            session._interimBusy = false;
          }
        });
      }
    }
  }
}

async function finalizeAndTranslateSentence(session, sourceLang, targetLang, ltEngine, activeTopic = 'general') {
  const fullTextToTranslate = session.chunks.join(' ');
  const activeSegmentId = session.segmentId;
  // Claim the accumulated audio length for THIS sentence before resetting, so a
  // chunk arriving during translation counts toward the next one.
  const sentenceAudioMs = session.audioMs || 0;

  // Reset rolling state for next sentence
  session.chunks = [];
  session.lastText = '';
  session.audioMs = 0;
  session.segmentId = 'seg_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  delete session.sentenceStartTime;
  delete session.segmentCount;
  delete session.segmentDuration;
  await saveLtSessions();

  if (!fullTextToTranslate || !fullTextToTranslate.trim()) return;

  // Filter out Whisper loops / repetitions of recent history
  if (isRepetitionOfHistory(fullTextToTranslate, session.history || [])) {
    console.log('🎙️ [BG] Finalized sentence filtered as repetition of history:', fullTextToTranslate.trim());
    return;
  }

  // Double check Whisper hallucination on the finalized accumulated sentence.
  // The sentence was built from chunks that already passed the per-chunk gate,
  // so if any of them carried real speech, treat the whole line as dialogue.
  // Remember it before the reset: the content script re-runs this same filter on
  // the TRANSLATED string, and without the signal it applies the strict rules and
  // silently drops lines this gate deliberately let through.
  const sentenceHadStrongSpeech = !!session.lastStrongSpeech;
  if (isWhisperHallucination(fullTextToTranslate, sentenceHadStrongSpeech)) {
    console.log('🎙️ [BG] Finalized sentence filtered as Whisper hallucination:', fullTextToTranslate.trim());
    session.lastStrongSpeech = false;
    return;
  }
  session.lastStrongSpeech = false;

  console.log(`🎙️ [BG] Finalizing sentence: "${fullTextToTranslate.trim()}"`);

  // Keep the previous subtitle visible while the next translation is pending.
  // Do not broadcast lt_processing: loading/flashing effects are distracting during livestreams.

  // Translate asynchronously to keep sequential audio queue fast!
  session.translationChain = (session.translationChain || Promise.resolve()).then(async () => {
    try {
      let translatedText = '';
      // Google has no prompt or context channel, so on this default path
      // buildLiveTranslationPrompt, the register rules, the few-shot examples and
      // DISCOURSE CONTEXT are all dead code — which is why out-of-the-box output
      // reads as raw machine translation. Prefer the AI path, but only when the
      // user's OWN key pays for it: the bundled proxy key is capped at 50 calls a
      // day and live translation spends one per finished sentence, so defaulting
      // everyone to AI would burn the quota within a couple of minutes and then
      // fall back to Google anyway, with a warning banner on every line.
      let engineToUse = ltEngine;
      if (!engineToUse) {
        let hasOwnKey = false;
        try {
          const s = await getSettings();
          hasOwnKey = !s.usingDefaultKey && !!(s.apiKey || s.openaiApiKey);
        } catch (_) {}
        engineToUse = hasOwnKey ? 'openai' : 'google';
      }
      const contextSnapshot = [...(session.history || [])];

      let originalText = fullTextToTranslate;

      // Skip translation API call if source == target language
      const effectiveSource = (sourceLang || 'auto').toLowerCase();
      const effectiveTarget = (targetLang || 'vi').toLowerCase();
      const skipTranslation = effectiveSource !== 'auto' && effectiveSource === effectiveTarget;

      // ─── Helper: Google Translate with user-visible error on failure ───
      const safeGoogleTranslate = async (text) => {
        const result = await translateGoogleBg(text, targetLang);
        // translateGoogleBg returns original text on all-retries-failed
        if (result === text) {
          console.warn('⚠️ [BG] Google Translate failed – returning original text.');
          broadcastMessage({
            action: 'lt_warning',
            error: 'Translation failed: Google Translate is unavailable. Showing original speech.'
          });
          notifyDegraded('google-down', 'Google Translate không phản hồi — đang hiện lời gốc');
        }
        return result;
      };

      if (skipTranslation) {
        console.log('🌐 [BG] Source == Target language. Skipping translation, showing original text.');
        translatedText = originalText;
      } else if (engineToUse === 'openai' || engineToUse === 'groq') {
        const engineLabel = engineToUse === 'groq' ? 'Groq' : 'OpenAI';
        console.log(`🤖 [BG] Translating via ${engineLabel} Premium...`);
        const transRes = await translateLiveWithAI({
          text: fullTextToTranslate,
          from: sourceLang,
          to: targetLang,
          context: contextSnapshot,
          topic: activeTopic
        });
        if (transRes && transRes.success) {
          translatedText = transRes.translated;
          if (transRes.original) {
            originalText = transRes.original;
          }
        } else {
          const apiError = transRes?.error || 'AI Translation failed';
          // Surface quota-exhausted to the user with a specific, actionable message
          if (transRes?.quotaExhausted) {
            broadcastMessage({
              action: 'lt_warning',
              error: `Free daily quota exhausted (${transRes.quota?.used ?? '?'}/${transRes.quota?.limit ?? 50} uses). Falling back to Google Translate. Add your own API key in Settings for unlimited use.`
            });
            notifyDegraded('quota', 'Hết lượt AI miễn phí hôm nay — đang dùng Google Translate');
          } else {
            console.warn(`⚠️ [BG] ${engineLabel} translation failed, falling back to Google Translate:`, apiError);
            broadcastMessage({
              action: 'lt_warning',
              error: `AI Translation failed (${apiError}). Falling back to Google Translate.`
            });
            notifyDegraded('ai-failed', 'Dịch AI lỗi — đang dùng Google Translate');
          }
          translatedText = await safeGoogleTranslate(fullTextToTranslate);
        }
      } else {
        // Default engine: Google Translate (free)
        console.log('🌐 [BG] Translating via Google Translate (Free)...');
        translatedText = await safeGoogleTranslate(fullTextToTranslate);
      }

      // Enforce premium Arc/Circle tech glossary polish across target languages
      translatedText = await polishLiveTranslation(translatedText, originalText, targetLang, activeTopic);

      console.log(`🎙️ [BG] Translation completed: "${translatedText.trim()}"`);

      // Save to sliding context dialogue memory
      if (!session.history) session.history = [];
      session.history.push({ original: originalText, translated: translatedText });
      if (session.history.length > 5) session.history.shift(); // Keep last 5 for richer context
      await saveLtSessions();

      // Save to floating history storage (limit 200)
      await updateCaptionHistoryInStorage(originalText, translatedText);

      session.subtitleSeq = (session.subtitleSeq || 0) + 1;

      // Broadcast subtitle overlay immediately (ensures full logs and real-time display)
      broadcastMessage({
        action: 'lt_subtitle',
        original: originalText,
        translated: translatedText,
        mode: 'tabCapture',
        timestamp: Date.now(),
        segmentId: activeSegmentId,
        sequenceNumber: session.subtitleSeq,
        targetLang: targetLang,
        durationMs: sentenceAudioMs,
        hasStrongSpeech: sentenceHadStrongSpeech,
        isUpdate: false
      });

      // Synchronous TTS Readout if enabled
      if (_cachedTtsEnabled) {
        const targetSpeed = _cachedTtsSpeed || 1.25;
        console.log(`🎙️ [BG] TTS Speed set to: ${targetSpeed}x`);
        speakSubtitle(translatedText, targetLang, targetSpeed, originalText, activeSegmentId, session.subtitleSeq);
      }

    } catch (err) {
      console.error('❌ [BG] Translation task failed:', err);
      broadcastMessage({
        action: 'lt_warning',
        error: `Translation error: ${err.message || 'Unknown error'}. Please check your connection or API settings.`
      });
    }
  });
}

// ─── 3. Whisper ASR & Google Translate Helpers ───────────────────────────

const PROPER_NOUNS_PROTECT = [
  'Arc', 'Arc Network', 'Circle', 'Circle Arc', 'USDC', 'EURC', 'USYC',
  'CCTP', 'App Kit', 'Bridge Kit', 'Swap Kit', 'Unified Balance',
  'ArcaneVM', 'Malachite', 'Malachite BFT', 'Tendermint BFT', 'Reth',
  'BFT consensus', 'Proof-of-Authority', 'deterministic finality', 'sub-second finality',
  'EVM', 'Layer-1', 'L1', 'JSON-RPC', 'RPC', 'EIP-1559', 'EWMA',
  'maxFeePerGas', 'maxPriorityFeePerGas', 'eth_gasPrice', 'eth_feeHistory',
  'Chain ID 5042002', '18 decimals', '6 decimals',
  'Viem', 'Ethers', 'Ethers.js', 'Hardhat', 'Foundry', 'Solidity',
  'ERC-20', 'ERC-8004', 'ERC-8183', 'MCP', 'Model Context Protocol', 'AI agent', 'testnet', 'mainnet',
  'Arcscan', 'docs.arc.io', 'x402', 'x420', 'nanopayments', 'nanopayment', 'machine-to-machine',
  'machine wallet', 'agentic payment', 'BLE', 'Bluetooth Low Energy', 'ESP32',
  'eCandle', 'pay-as-you-go', 'streaming payment', 'dynamic pricing',
  'hash rate', 'onchain', 'offchain', 'Bitcoin', 'Arc House', 'Architect',
  'Agentic Economy', 'Circle Gateway', 'Developer-Controlled Wallets', 'User-Controlled Wallets',
  'Modular Wallets', 'opt-in privacy', 'post-quantum security', 'stable fee design'
];

// Groq Whisper API rejects prompt strings longer than 896 characters.
// Build a compact spelling hint prompt by preserving priority terms and trimming safely.
function buildAsrPrompt(maxChars = 850, topic = 'general') {
  if (topic === 'crypto' || topic === 'tech') {
    const priorityTerms = [
      'Arc', 'Arc Network', 'Circle', 'Circle Arc', 'USDC', 'EURC', 'Circle Gateway',
      'Gateway', 'burn and mint', 'unit of account', 'liquidity hub',
      'CCTP', 'App Kit', 'Unified Balance', 'ArcaneVM', 'Malachite BFT',
      'Tendermint BFT', 'Reth', 'deterministic finality', 'sub-second finality',
      'EVM', 'JSON-RPC', 'RPC', 'EIP-1559', 'EWMA', 'Gwei', 'maxFeePerGas',
      'maxPriorityFeePerGas', 'eth_gasPrice', 'eth_feeHistory', 'Chain ID 5042002',
      '18 decimals', '6 decimals', 'Viem', 'Ethers.js', 'Hardhat', 'Foundry',
      'Solidity', 'ERC-20', 'ERC-8004', 'ERC-8183', 'MCP', 'AI agent', 'testnet', 'mainnet', 'Arcscan',
      'docs.arc.io', 'x402', 'x420', 'T-Level', 'GigaWork', 'nanopayments', 'nanopayment',
      'machine-to-machine', 'machine wallet', 'agentic payment', 'BLE', 'ESP32',
      'eCandle', 'pay-as-you-go', 'streaming payment', 'dynamic pricing',
      'hash rate', 'onchain', 'offchain', 'Arc House', 'Architect',
      'Agentic Economy', 'Developer-Controlled Wallets', 'User-Controlled Wallets',
      'Modular Wallets', 'opt-in privacy', 'post-quantum security', 'stable fee design'
    ];

    const orderedTerms = [...priorityTerms, ...PROPER_NOUNS_PROTECT]
      .filter((term, index, arr) => term && arr.indexOf(term) === index);

    const contextPrefix = 'Tech/blockchain/crypto livestream. Specialized terms: ';
    const suffix = '.';

    const selected = [];
    for (const term of orderedTerms) {
      const joined = selected.length ? selected.join(', ') + ', ' + term : term;
      if (contextPrefix.length + joined.length + suffix.length > maxChars) break;
      selected.push(term);
    }

    return contextPrefix + selected.join(', ') + suffix;
  }

  // Topic-specific simple prompt targets to guide spelling without heavy bias
  let contextPrefix = 'General transcription. Please transcribe the audio accurately with correct spelling.';
  if (topic === 'business') {
    contextPrefix = 'Business and marketing livestream. Specialized terms: pitch deck, SaaS, B2B, B2C, conversion rate, acquisition.';
  } else if (topic === 'gaming') {
    contextPrefix = 'Gaming livestream and playthrough. Specialized terms: cooldown, respawn, gank, newbie, gameplay.';
  } else if (topic === 'finance') {
    contextPrefix = 'Finance and stock market analysis. Specialized terms: portfolio, bull market, bear market, ETF, indexes.';
  } else if (topic === 'entertainment') {
    contextPrefix = 'Entertainment, movies, and music discussion. Specialized terms: blockbuster, fandom, premiere.';
  } else if (topic === 'education') {
    contextPrefix = 'Educational and science lecture. Specialized terms: syllabus, hypothesis, curriculum.';
  } else if (topic === 'news') {
    contextPrefix = 'Current events and news broadcast. Specialized terms: breaking news, press release, correspondent.';
  }

  return contextPrefix;
}

async function transcribeWhisper(audioBase64, sourceLang, targetLang, whisperKey, topic = 'general', customPrompt = '', model = 'whisper-1') {
  // Decode Base64 to binary ArrayBuffer
  const binaryString = atob(audioBase64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const arrayBuffer = bytes.buffer;

  // Re-encode into WebM File blob
  const audioBlob = new Blob([arrayBuffer], { type: 'audio/webm' });

  const executeCall = async () => {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', model || 'whisper-1');
    formData.append('temperature', '0');

    // Configure transcribing target accent locale if known
    if (sourceLang && sourceLang !== 'auto') {
      formData.append('language', sourceLang);
    }

    // Inject spelling alignment prompt (dynamic if customPrompt exists, otherwise base topic)
    const whisperPrompt = customPrompt || buildAsrPrompt(850, topic);
    formData.append('prompt', whisperPrompt);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout — a reply slower than this is useless for live subtitles

    try {
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${whisperKey}`
        },
        body: formData,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw asrHttpError('Whisper', response, errorText);
      }

      const data = await response.json();
      return data.text || '';
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('OpenAI Whisper ASR request timed out (6s limit)');
      }
      throw err;
    }
  };

  return runAsrWithRetry('OpenAI Whisper', executeCall);
}

/**
 * Wrap an ASR HTTP failure so the retry loop can tell a rate limit apart from a
 * genuine error. Without the status, a 429 was retried after a flat 500ms — which
 * hits the same limit again and makes the situation worse, not better.
 */
function asrHttpError(label, response, errorText) {
  const err = new Error(`${label} ASR HTTP failed (${response.status}): ${errorText}`);
  err.status = response.status;
  const retryAfter = response.headers && response.headers.get && response.headers.get('retry-after');
  if (retryAfter) {
    const secs = parseFloat(retryAfter);
    if (Number.isFinite(secs)) err.retryAfterMs = Math.min(secs * 1000, 30000);
  }
  return err;
}

// Rate limits are the one ASR failure worth waiting on: the request was well
// formed and would succeed a moment later. Everything else (bad key, bad audio)
// fails the same way on a retry, so retrying it only adds latency to a live feed.
async function runAsrWithRetry(label, executeCall) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const out = await executeCall();
      noteAsrRateLimit(false);
      return out;
    } catch (err) {
      const limited = err.status === 429 || err.status === 503;
      if (limited) noteAsrRateLimit(true);
      console.warn(`⚠️ ${label} ASR attempt ${attempt} failed${limited ? ' (rate limited)' : ''}:`, err.message);
      if (attempt === maxAttempts) throw err;
      // Only a rate limit earns a real wait, and honour Retry-After when the
      // server sends one. Other errors get the old short pause.
      const wait = limited
        ? (err.retryAfterMs || Math.min(1000 * Math.pow(2, attempt - 1), 8000))
        : 500;
      if (!limited && attempt >= 2) throw err;
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
}

async function transcribeGroq(audioBase64, sourceLang, targetLang, groqKey, groqModel = 'whisper-large-v3', topic = 'general', customPrompt = '') {
  const binaryString = atob(audioBase64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const arrayBuffer = bytes.buffer;

  const audioBlob = new Blob([arrayBuffer], { type: 'audio/webm' });

  const executeCall = async () => {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', groqModel || 'whisper-large-v3');
    formData.append('temperature', '0');

    if (sourceLang && sourceLang !== 'auto') {
      formData.append('language', sourceLang);
    }

    const whisperPrompt = customPrompt || buildAsrPrompt(850, topic);
    formData.append('prompt', whisperPrompt);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout — a reply slower than this is useless for live subtitles

    try {
      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqKey}`
        },
        body: formData,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw asrHttpError('Groq', response, errorText);
      }

      const data = await response.json();
      return data.text || '';
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('Groq ASR request timed out (6s limit)');
      }
      throw err;
    }
  };

  return runAsrWithRetry('Groq', executeCall);
}

async function translateGoogleBg(text, targetLang) {
  const codeMap = {
    'vi': 'vi', 'en': 'en', 'zh': 'zh-CN', 'ja': 'ja', 'ko': 'ko',
    'fr': 'fr', 'es': 'es', 'de': 'de', 'ru': 'ru', 'th': 'th',
    'id': 'id', 'pt': 'pt', 'it': 'it', 'tr': 'tr', 'ar': 'ar',
    'nl': 'nl', 'tl': 'tl', 'pl': 'pl', 'hi': 'hi',
    'bn': 'bn', 'ur': 'ur', 'ms': 'ms', 'fa': 'fa', 'sw': 'sw',
    'uk': 'uk', 'ro': 'ro', 'el': 'el', 'he': 'he', 'sv': 'sv',
    'da': 'da', 'no': 'no', 'fi': 'fi', 'cs': 'cs', 'hu': 'hu',
    'sk': 'sk', 'bg': 'bg', 'hr': 'hr', 'sr': 'sr', 'ka': 'ka',
    'az': 'az', 'kk': 'kk', 'mn': 'mn'
  };
  const tgt = codeMap[targetLang] || 'vi';

  // ─── Tech Term Placeholder Protection ────────────────────────────────────
  // Protect known tech/crypto terms from being mistranslated by Google.
  // Replace each term with a unique ALLCAPS placeholder before sending,
  // then restore after receiving the translation.
  const GOOGLE_PROTECT_TERMS = [
    'onchain', 'offchain', 'mainnet', 'testnet', 'stablecoin', 'stablecoins',
    'blockchain', 'DeFi', 'smart contract', 'smart contracts', 'gas fee', 'gas fees',
    'AI agent', 'AI agents', 'agentic', 'nanopayments', 'nanopayment',
    'machine-to-machine', 'pay-as-you-go', 'streaming payment', 'streaming payments',
    'hash rate', 'validator', 'validators', 'liquidity pool', 'liquidity pools',
    'Arc', 'Arc Network', 'Circle', 'USDC', 'CCTP', 'EVM', 'ERC-20', 'RPC',
    'x402', 'x420', 'BLE', 'ESP32', 'eCandle', 'eCandles',
    'Developer-Controlled Wallets', 'User-Controlled Wallets', 'Modular Wallets',
    'opt-in privacy', 'post-quantum security', 'Malachite BFT', 'Tendermint BFT',
    // Arc 101 vocabulary — audited on the "Core Primitives" video: without
    // these, Google renders Gateway (the Circle product) as "Cổng"/"网关".
    'EURC', 'Circle Gateway', 'Gateway', 'tokenized asset', 'tokenized assets'
  ];
  // Sort longest first so longer phrases are replaced before substrings
  GOOGLE_PROTECT_TERMS.sort((a, b) => b.length - a.length);

  let protectedText = text;
  const restoreMap = {};
  GOOGLE_PROTECT_TERMS.forEach((term, i) => {
    const placeholder = `XPROTECT${i}X`;
    const regex = new RegExp(`(?<![\\w])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'gi');
    if (regex.test(protectedText)) {
      restoreMap[placeholder] = term;
      protectedText = protectedText.replace(regex, placeholder);
    }
  });

  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tgt}&dt=t&q=${encodeURIComponent(protectedText)}`;
  console.log(`🌐 [BG] Google Translate: protected ${Object.keys(restoreMap).length} tech terms.`);

  // Retry up to 3 times with exponential backoff on rate-limit / server errors
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url);

      if (response.status === 429 || response.status >= 500) {
        const delay = attempt * 1000;
        console.warn(`⚠️ [BG] Google Translate HTTP ${response.status}. Retry ${attempt}/${MAX_RETRIES} in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      if (!response.ok) {
        throw new Error(`Google Translate API error: ${response.status}`);
      }

      const data = await response.json();
      let translatedText = '';
      if (data && data[0]) {
        data[0].forEach(item => {
          if (item[0]) translatedText += item[0];
        });
      }
      // Restore protected tech terms that Google may have mis-translated
      if (translatedText && restoreMap) {
        for (const [placeholder, original] of Object.entries(restoreMap)) {
          translatedText = translatedText.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), original);
        }
      }
      return translatedText || text;
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        console.error(`❌ [BG] Google Translate failed after ${MAX_RETRIES} retries:`, err.message);
        return text;
      }
      const delay = attempt * 1000;
      console.warn(`⚠️ [BG] Google Translate error (attempt ${attempt}): ${err.message}. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return text;
}

function buildLiveTranslationPrompt(text, sourceLang, targetLang, context, topic = 'general') {
  const LANG_NAMES = {
    'vi': 'Vietnamese', 'en': 'English', 'zh': 'Chinese',
    'ja': 'Japanese', 'ko': 'Korean', 'es': 'Spanish',
    'fr': 'French', 'th': 'Thai', 'de': 'German', 'ru': 'Russian',
    'id': 'Indonesian', 'pt': 'Portuguese', 'it': 'Italian', 'tr': 'Turkish',
    'ar': 'Arabic', 'hi': 'Hindi',
    // Extended: matches the full 43-language list in content.js langNames
    'nl': 'Dutch', 'tl': 'Tagalog', 'pl': 'Polish', 'bn': 'Bengali',
    'ur': 'Urdu', 'ms': 'Malay', 'fa': 'Persian', 'sw': 'Swahili',
    'uk': 'Ukrainian', 'ro': 'Romanian', 'el': 'Greek', 'he': 'Hebrew',
    'sv': 'Swedish', 'da': 'Danish', 'no': 'Norwegian', 'fi': 'Finnish',
    'cs': 'Czech', 'hu': 'Hungarian', 'sk': 'Slovak', 'bg': 'Bulgarian',
    'hr': 'Croatian', 'sr': 'Serbian', 'ka': 'Georgian', 'az': 'Azerbaijani',
    'kk': 'Kazakh', 'mn': 'Mongolian'
  };
  const targetName = LANG_NAMES[targetLang] || targetLang || 'Vietnamese';
  const sourceName = (sourceLang && sourceLang !== 'auto') ? (LANG_NAMES[sourceLang] || sourceLang) : "the speaker's language (auto-detected)";

  // Vietnamese register researched from real VN livestream communities (Coin98,
  // MarginATM, Coin68 style): crypto/gaming streams address the audience as
  // "anh em"; general streams use "các bạn"/"mọi người". "quý vị" is TV-formal
  // and reads as machine translation in a stream context.
  const viAudience = (topic === 'crypto' || topic === 'gaming')
    ? '"anh em" (the standard address form in Vietnamese crypto/gaming communities) or "mọi người"'
    : '"các bạn" or "mọi người"';
  const viStyleRule = `Write natural SPOKEN Vietnamese exactly as a native Vietnamese streamer/caster talks — NOT formal written Vietnamese, NOT literal machine translation. Address the audience as ${viAudience}; use "bạn" for a single co-host/guest; NEVER use "quý vị". Use "mình"/"tụi mình" (or inclusive "chúng ta") for "I"/"we"; avoid stiff "tôi"/"chúng tôi" unless quoting something formal. Drop subject pronouns wherever Vietnamese naturally omits them. Prefer natural spoken connectors ("thì", "là", "mà", "nói chung là", "về cơ bản thì", "kiểu như") over translation-ese ("rằng", "việc mà", "điều đó có nghĩa là"). Keep the English terms the Vietnamese community actually says in English (hold, stake, swap, farm, airdrop, token, gas, wallet, mainnet, testnet, bridge, layer, pump, dump, list, long, short). The output must sound like a Vietnamese person talking, not a translated sentence.`;

  const pronounRules = {
    'vi': viStyleRule,
    'en': 'Write natural, fluent, and conversational English. Use active voice and avoid overly formal or archaic phrasing.',
    'ja': 'Ensure natural pronouns and politeness levels in Japanese (usually polite neutral "desu/masu" form unless highly informal context demands otherwise). Keep standard technical proper nouns as-is.',
    'ko': 'Ensure natural address/pronouns in Korean (usually polite neutral "해요체" form). Keep standard technical proper nouns as-is.',
    'zh': 'Ensure natural pronouns and phrasing in Chinese (standard Mandarin, simplified or traditional based on output). Avoid translation-ese. Keep English proper nouns as-is.',
    'es': 'Use natural, fluent Spanish. Use polite neutral address ("usted" or respectful "tú" depending on context, preferring respectful standard colloquial Spanish). Keep standard tech/crypto terms in English.',
    'fr': 'Translate into natural, elegant, and conversational French. Use respectful address ("vous"). Keep standard technical jargon in English.',
    'de': 'Translate into natural, professional German. Use the polite form of address ("Sie"). Keep standard technical terms in English.',
    'ru': 'Use natural, grammatically correct Russian. Use the polite plural address ("вы"). Keep English technical terms as-is if they are commonly used in the Russian tech community.',
    'th': 'Use natural and polite Thai (using polite particles like ครับ/ค่ะ where appropriate, and clear respectful pronouns). Keep technical terms in English.',
    'id': 'Use natural, conversational Indonesian (Bahasa Indonesia). Maintain a polite, professional tone using standard pronouns ("Anda" or "Kami"). Keep tech terms in English.',
    'pt': 'Use natural, fluent Portuguese (standard professional/colloquial, using "você" or "vocês" respectfully). Keep tech terms in English.',
    'it': 'Use natural, fluent Italian. Use polite address ("lei" or polite "voi"). Keep tech terms in English.',
    'tr': 'Use natural, fluent Turkish. Use polite plural address ("siz"). Keep tech terms in English.',
    'ar': 'Use modern standard Arabic (Fusha) that is natural, professional, and clear. Avoid overly localized dialects. Keep technical terms in English as commonly written.',
    'hi': 'Use natural, conversational Hindi (respectful "aap"/आप). Keep standard technical and business terms in English or in English transliterated form as used naturally.'
  };
  const pronounRule = pronounRules[targetLang] || `Ensure natural address/pronouns in the target language (${targetName}). Use active, colloquial speech matching standard informal but respectful dialogue.`;

  const contextLines = context?.map(c =>
    `"${c.original}" -> "${c.translated}"`
  ).join('\n') || 'None';

  // Topic-aware scene description — previously hard-coded to "tech/blockchain
  // livestream", which primed the wrong tone for gaming/movie/finance streams.
  const topicScenes = {
    crypto: 'a crypto/blockchain livestream',
    tech: 'a technology livestream',
    business: 'a business/marketing livestream',
    finance: 'a finance and markets livestream',
    gaming: 'a gaming livestream',
    entertainment: 'an entertainment livestream or show',
    general: 'a live video stream'
  };
  const scene = topicScenes[topic] || topicScenes.general;

  const termRule = (topic === 'crypto' || topic === 'tech')
    ? 'Do NOT translate standard tech/crypto terms (e.g. Arc, Circle, USDC, Layer-1, gas, finality, validator, RPC, EVM, bridge, swap, stablecoin, onchain, offchain, testnet, mainnet, BLE, ESP32, eCandle, hash rate, x402, x420, Clarity Act, etc.) — keep them in their original English form exactly.'
    : 'Keep proper nouns, brand names, and widely-used English loanwords in their original form; translate everything else.';

  // Style rules buried at guideline #6 of a 2.5k-char prompt get under-weighted.
  // The register is the whole complaint about the Vietnamese output, so it now
  // leads the prompt and is restated right before the output format.
  // Worked examples beat prose: they show subject-dropping, "mình/tụi mình",
  // and the exact translation-ese to avoid far more reliably than a rule list.
  // The ✓ lines are exemplars — the model copies them literally, so they must be
  // correct Vietnamese AND lossless. The old set taught two bad habits: it wrote
  // "gas phí" (wrong order; every other table in this file maps to "phí gas"),
  // and three of its four ✓ lines quietly dropped or invented content, directly
  // contradicting guideline #2 below.
  const fewShot = targetLang === 'vi' ? `
HOW NATURAL VIETNAMESE SOUNDS — study these before you translate.
Both lines in each pair say EXACTLY the same thing; only the register changes. Never add or drop information.
  ✗ "Điều đó có nghĩa là chúng tôi có thể giảm phí gas một cách đáng kể."
  ✓ "Tức là mình giảm được phí gas đáng kể."
  ✗ "Việc mà chúng ta đang thực hiện là xây dựng một mạng lưới thanh toán."
  ✓ "Tụi mình đang xây một mạng lưới thanh toán."
  ✗ "Quý vị hãy tiếp tục theo dõi để biết thêm chi tiết."
  ✓ "Anh em theo dõi tiếp nha, còn nhiều chi tiết nữa."
  ✗ "Nó cho phép người dùng thực hiện giao dịch một cách nhanh chóng."
  ✓ "Cái này cho phép người dùng giao dịch nhanh."
  ✗ "Chúng tôi tin rằng điều này sẽ tạo ra một sự thay đổi lớn."
  ✓ "Tụi mình nghĩ cái này sẽ tạo ra thay đổi lớn."
The ✗ lines are grammatical but nobody talks like that. Write the ✓ register — same meaning, spoken form.
` : '';

  return `You are a live speech translator for ${scene}.
Translate the speaker's words from ${sourceName} to ${targetName}.

MOST IMPORTANT RULE — REGISTER: ${pronounRule}
${fewShot}
DISCOURSE CONTEXT (recent lines):
${contextLines}

TRANSLATION & EDITING GUIDELINES:
1. Technical Terms: ${termRule}
2. Completeness & Flow: You MUST preserve ALL information from the source text. Avoid stiff literal translation; instead, rephrase so it sounds like native speech in ${targetName} while keeping 100% of the original meaning.
3. Numbers & Data: Translate numbers, percentages, timeframes, and statistics exactly as stated (e.g., "18 decimals", "$1 billion", "sub-second", "99.9%").
4. Clarity & Cleanliness: Remove only meaningless verbal filler ("uh", "um", "like, you know" mid-sentence). Do NOT remove substantive connectors ("but", "however", "so", "actually", "I think", "we believe").
5. Fragment Continuation: Many segments are spoken fragments of a larger sentence due to natural speech pauses (e.g., ending in 'to', 'that', 'with'). Look at the DISCOURSE CONTEXT (recent lines) to understand the full sentence structure. Translate the current fragment so that it flows naturally from the previous translated lines, forming a coherent sentence when read together. Do not translate fragments as isolated full sentences if they are clearly grammatical continuations.
6. Style: Re-read the REGISTER rule above. Before you write the translation, ask yourself: "would a native ${targetName} speaker actually say it this way out loud?" If not, rewrite it. Never mirror the source sentence's word order or clause structure when ${targetName} would phrase it differently.

Format your output EXACTLY as follows (two lines, no extra text):
CLEAN_ORIGINAL: [Cleaned natural English — filler removed but ALL content preserved]
TRANSLATION: [Complete, accurate, natural-SPOKEN ${targetName} — nothing omitted, nothing translation-ese]

TEXT TO TRANSLATE:
"${text}"`;
}

async function translateLiveWithAI({ text, from, to, context, topic }) {
  try {
    const prompt = buildLiveTranslationPrompt(text, from, to, context, topic || 'general');
    // Subtitles are speech, not a document. A little headroom above 0 is what
    // lets the model reach for the natural phrasing instead of the word-for-word
    // one; still low enough that numbers and terms stay faithful.
    let res = await translateText({ text: prompt, bypassPrompt: true, from: 'English', to: to, temperature: 0.5, proxyTimeoutMs: 8000 });

    // An empty completion is usually a one-off (a truncated reasoning pass, a
    // dropped stream). Retrying once is far cheaper than dumping the whole line
    // to Google Translate, which is what the user actually notices.
    if ((!res || !res.success) && /empty translation/i.test(res?.error || '')) {
      console.warn('⚠️ [BG] Empty translation returned. Retrying once before falling back.');
      res = await translateText({ text: prompt, bypassPrompt: true, from: 'English', to: to, temperature: 0.5, proxyTimeoutMs: 8000 });
    }
    if (res && res.success && res.translated) {
      const cleanOriginalMatch = res.translated.match(/CLEAN_ORIGINAL:\s*([\s\S]*?)(?=\nTRANSLATION:|$)/i);
      const translationMatch = res.translated.match(/TRANSLATION:\s*([\s\S]*?)$/i);

      if (cleanOriginalMatch && translationMatch) {
        return {
          success: true,
          original: cleanOriginalMatch[1].replace(/^["'\s]+|["'\s]+$/g, '').trim(),
          translated: translationMatch[1].replace(/^["'\s]+|["'\s]+$/g, '').trim()
        };
      }

      // Secondary fallback parser if it used bullet points or different labels
      const lines = res.translated.split('\n');
      let cleanOriginal = text;
      let translation = res.translated;
      let foundOriginal = false;
      let foundTranslation = false;

      for (const line of lines) {
        const cleanLine = line.trim();
        if (cleanLine.toUpperCase().startsWith('CLEAN_ORIGINAL:')) {
          cleanOriginal = cleanLine.substring('CLEAN_ORIGINAL:'.length).trim();
          foundOriginal = true;
        } else if (cleanLine.toUpperCase().startsWith('TRANSLATION:')) {
          translation = cleanLine.substring('TRANSLATION:'.length).trim();
          foundTranslation = true;
        }
      }

      if (foundOriginal && foundTranslation) {
        return {
          success: true,
          original: cleanOriginal.replace(/^["'\s]+|["'\s]+$/g, '').trim(),
          translated: translation.replace(/^["'\s]+|["'\s]+$/g, '').trim()
        };
      }

      // If AI returned just a plain string without prefixes, strip common artifact text then use as-is
      const cleanOutput = (raw) => raw
        .replace(/^```[\w]*\n?|\n?```$/g, '')          // strip code-fence blocks
        .replace(/^(here is[^:]*:|output:|result:|translation:)\s*/gi, '') // strip role-play preambles
        .replace(/^["'`]+|["'`]+$/g, '')                // strip surrounding quotes
        .trim();
      return { success: true, original: text, translated: cleanOutput(res.translated) };
    }
    return res;
  } catch (err) {
    return { success: false, error: err.message || 'AI Translation failed' };
  }
}

// ─── 4. Whisper Hallucination & Repetition Filters ────────────────────────

function getSimilarityRatio(str1, str2) {
  const s1 = str1.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").replace(/\s+/g, " ").trim();
  const s2 = str2.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").replace(/\s+/g, " ").trim();
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;
  
  const len1 = s1.length;
  const len2 = s2.length;
  if (Math.abs(len1 - len2) > Math.max(len1, len2) * 0.4) {
    return 0.0;
  }

  let prevRow = Array(len2 + 1);
  let currRow = Array(len2 + 1);
  for (let j = 0; j <= len2; j++) prevRow[j] = j;

  for (let i = 1; i <= len1; i++) {
    currRow[0] = i;
    for (let j = 1; j <= len2; j++) {
      const substCost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,
        currRow[j - 1] + 1,
        prevRow[j - 1] + substCost
      );
    }
    let temp = prevRow;
    prevRow = currRow;
    currRow = temp;
  }
  const distance = prevRow[len2];
  const maxLen = Math.max(len1, len2);
  return (maxLen - distance) / maxLen;
}

function isRepetitionOfHistory(newText, history) {
  if (!newText || !history || history.length === 0) return false;
  const text = newText.trim().toLowerCase();
  
  const cleanText = text.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").replace(/\s+/g, " ").trim();
  const words = cleanText.split(/\s+/);
  const wordCount = words.length;
  
  if (wordCount <= 2) return false; // allow short conversational remarks
  
  // Whisper loops are consecutive, so we only need to look at the last 1-2 history items
  const lastItems = history.slice(-2);
  for (const item of lastItems) {
    const prevOrig = (item.original || '').trim().toLowerCase();
    if (!prevOrig) continue;
    
    const similarity = getSimilarityRatio(text, prevOrig);
    
    // Determine dynamic threshold based on word count to avoid false positives
    let threshold = 0.88;
    if (wordCount <= 4) {
      threshold = 1.0; // Must be exact match for short sentences
    } else if (wordCount <= 8) {
      threshold = 0.95; // Very high similarity for medium sentences
    }
    
    if (similarity >= threshold) {
      return true;
    }
  }
  return false;
}

function isRepetitiveLoop(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").replace(/\s+/g, " ").trim();
  const words = clean.split(' ');
  const n = words.length;

  // Space-less scripts (zh/ja/ko/th) arrive as ONE token, so the word and phrase
  // checks below cannot see a loop in them. A substring check used to sit at the
  // bottom of this function for that purpose, but `n < 4` returned before it
  // could ever run on them — it only ever fired on space-separated text, where
  // it deleted ordinary speech (three "that"s in a sentence, three words sharing
  // a suffix, three "mình"s in the exact register the prompt asks for). Run the
  // space-less case here, and require three back-to-back copies.
  if (n <= 2 && clean.length >= 12) {
    for (let len = 4; len <= 8; len++) {
      for (let i = 0; i + len * 3 <= clean.length; i++) {
        const sub = clean.substr(i, len);
        if (clean.substr(i + len, len) === sub && clean.substr(i + len * 2, len) === sub) return true;
      }
    }
  }
  if (n < 4) return false;

  // 1. Check for single word repetition (Whisper stutter/loop)
  // Brand/domain terms legitimately repeat in normal speech ("Circle, Circle
  // Arc, and Circle Gateway") — never treat them as loop evidence.
  const REPEAT_WHITELIST = new Set([
    'circle', 'usdc', 'stablecoin', 'stablecoins', 'wallet', 'wallets',
    'payment', 'payments', 'agent', 'agents', 'money', 'people', 'really',
    'chain', 'token', 'tokens', 'network'
  ]);
  const wordCounts = {};
  for (const w of words) {
    if (w.length < 3) continue;
    if (REPEAT_WHITELIST.has(w)) continue;
    wordCounts[w] = (wordCounts[w] || 0) + 1;
  }
  for (const [w, count] of Object.entries(wordCounts)) {
    if (w.length >= 5 && count >= 4) {
      return true;
    }
    if (count >= 5) {
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
      // Saying a phrase twice is rhetoric, not a Whisper loop — anaphora is the
      // commonest device in live speech ("we need to move fast, we need to ship
      // it today" tripped the old coverage > 0.5 rule). A real loop repeats
      // back-to-back, so require adjacency and near-total coverage.
      // (count >= 3 is already handled above.)
      if (count === 2 && len >= 3) {
        let first = -1;
        for (let i = 0; i + len <= n; i++) {
          if (words.slice(i, i + len).join(' ') === phrase) { first = i; break; }
        }
        const adjacent = first >= 0 && first + 2 * len <= n &&
          words.slice(first + len, first + 2 * len).join(' ') === phrase;
        if (adjacent && (len * count) / n > 0.8) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * @param {string} text
 * @param {boolean} hasStrongSpeech  The segment carried clear speech energy, so
 *   short pleasantries are dialogue rather than Whisper's silence filler.
 */
function isWhisperHallucination(text, hasStrongSpeech = false) {
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
    // ASR prompt leak-back: Whisper echoes its own spelling-hint prompt on silent/noisy
    // segments. These MUST be blocked here (background) — this is the gate before
    // translation, TTS readout, and caption history, not just the display layer.
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
    '플러스친구',
    // The "keep watching" family. Whisper emits these over silence on any
    // stream ripped from subtitled video, in whichever language it guessed —
    // so both the source phrasing and its Vietnamese rendering belong here.
    // Only the full phrasings go in this substring list — a bare "continue to
    // watch" would also swallow "continue to watch the chart", which is speech.
    'please continue to watch',
    'please continue watching',
    'vui lòng tiếp tục xem',
    'xin vui lòng tiếp tục xem',
    'hãy tiếp tục xem',
    'tiếp tục xem nhé',
    'mời các bạn đón xem',
    'mời quý vị đón xem',
    'mời các bạn xem tiếp',
    'xin mời các bạn đón xem',
    'ghiền mì gõ',
    'chúc các bạn xem video vui vẻ',
    'chúc các bạn xem phim vui vẻ',
    '请继续观看',
    '请订阅',
    '感谢观看',
    '謝謝觀看',
    'ご視聴ありがとうございました',
    'ご視聴ありがとう',
    '시청해주셔서 감사합니다',
    '구독과 좋아요'
  ];

  for (const sub of blockedSubstrings) {
    if (lowerText.includes(sub)) {
      // Only filter if the phrase IS the entire content (standalone hallucination).
      // If the speaker says "Thank you very much for joining us — let's talk about onchain payments",
      // that's real speech and should NOT be dropped.
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
    // Same "keep watching" family as the substring list, matched exactly here
    // so it is also caught after translation has reworded it.
    'please continue to watch',
    'please continue watching',
    'continue to watch',
    'keep watching',
    'stay tuned',
    'vui lòng tiếp tục xem',
    'xin vui lòng tiếp tục xem',
    'hãy tiếp tục xem',
    'tiếp tục xem',
    'mời các bạn đón xem',
    'mời quý vị đón xem',
    'oh',
    'um',
    'uh',
    'ah'
  ];

  if (hasStrongSpeech) {
    const conversationalTerms = new Set([
      'thank you very much', 'thanks very much', 'thank you', 'thanks', 'goodbye', 'bye',
      'see you next time', 'see you soon', 'thank you so much', 'cảm ơn', 'cám ơn', 'cảm ơn bạn',
      'cám ơn bạn', 'cảm ơn các bạn', 'cám ơn các bạn', 'tạm biệt', 'hẹn gặp lại', 'hẹn gặp lại các bạn',
      'hẹn gặp lại quý vị', 'chào tạm biệt', 'chào các bạn', 'chào mọi người', 'xin chào',
      'thanks you', 'thank u', 'thank you all', 'thank you guys', 'oh', 'um', 'uh', 'ah',
      'tiếng anh', 'tiếng việt', 'tiếng trung', 'tiếng nhật', 'tiếng hàn',
      'english', 'vietnamese', 'chinese', 'japanese', 'korean'
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
    const maxFillerLength = hasStrongSpeech ? 2 : 5;
    if (words.length < maxFillerLength) return true;
  }

  return false;
}

// ─── 5. Technical pre-correction & Vietnamese Post-Polish ──────────────────

function cleanAndPrecorrectOriginalText(text, topic = 'general') {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text;

  // Strip leaked ASR loop boundaries
  cleaned = cleaned.replace(/\s*Continue transcribing\.?/gi, '');
  cleaned = cleaned.replace(/\s*Tiếp tục phiên dịch\.?/gi, '');

  // Domain-specific acoustic corrections are ONLY safe on crypto/tech streams.
  // Applied globally they corrupt normal speech (e.g. "Circle and our team" →
  // "Circle and Arc team", "pay point" → "pain point" on a payments stream).
  let rules = [];
  if (topic === 'crypto' || topic === 'tech') {
    rules.push(
    { pattern: /\bmichael usd\b/gi, replacement: 'Micro USD' },
    { pattern: /\bcircle not a payment\b/gi, replacement: 'Circle nanopayments' },
    { pattern: /\bcircle and the r\b/gi, replacement: 'Circle and Arc' },
    { pattern: /\bop test\b/gi, replacement: 'OP testnet' },
    { pattern: /\bmachine water\b/gi, replacement: 'machine-to-machine' },
      { pattern: /\bx[\s-]*402\b/gi, replacement: 'x402' },
      { pattern: /\bx-402\b/gi, replacement: 'x402' },
      { pattern: /\b(?:x|ex)[\s-]*(?:four|4)[\s-]*(?:oh|o|zero|0)?[\s-]*(?:two|2)\b/gi, replacement: 'x402' },
      { pattern: /\bx[\s-]*flo(?:w)?[\s-]*(?:two|2)\b/gi, replacement: 'x402' },
      { pattern: /\bs[\s-]*(?:four|4)[\s-]*(?:dash|-)?[\s-]*(?:two|2)\b/gi, replacement: 'x402' },
      { pattern: /\bmachine to machine\b/gi, replacement: 'machine-to-machine' },
      { pattern: /\bthe machine-to-machine\b/gi, replacement: 'machine-to-machine' },
      { pattern: /\bble\b/gi, replacement: 'BLE' },
      { pattern: /\bbie\b/gi, replacement: 'BLE' },
      { pattern: /\bbre\b/gi, replacement: 'BLE' },
      { pattern: /\besp 32\b/gi, replacement: 'ESP32' },
      { pattern: /\besp32\b/gi, replacement: 'ESP32' },
      { pattern: /\be[-\s]?kendo\b/gi, replacement: 'eCandle' },
      { pattern: /\be[-\s]?central\b/gi, replacement: 'eCandle' },
      { pattern: /\be[-\s]?cando\b/gi, replacement: 'eCandle' },
      { pattern: /\becandle\b/gi, replacement: 'eCandle' },
      { pattern: /\becandles\b/gi, replacement: 'eCandles' }
    );
  }

  if (topic === 'crypto') {
    rules.push(
      { pattern: /\bgas lease\b/gi, replacement: 'gas fees' },
      { pattern: /\bgas leases\b/gi, replacement: 'gas fees' },
      { pattern: /\bproof of state\b/gi, replacement: 'proof of stake' },
      { pattern: /\bproof of space\b/gi, replacement: 'proof of stake' },
      { pattern: /\bstable coin\b/gi, replacement: 'stablecoin' },
      { pattern: /\btable coin\b/gi, replacement: 'stablecoin' },
      { pattern: /\bsmart contact\b/gi, replacement: 'smart contract' },
      { pattern: /\bsmart control\b/gi, replacement: 'smart contract' },
      { pattern: /\bhair drop\b/gi, replacement: 'airdrop' },
      { pattern: /\bair drop\b/gi, replacement: 'airdrop' },
      { pattern: /\bliquid pool\b/gi, replacement: 'liquidity pool' },
      { pattern: /\bliquidation pool\b/gi, replacement: 'liquidity pool' },
      { pattern: /\bdefi\b/gi, replacement: 'DeFi' },
      { pattern: /\bd-fi\b/gi, replacement: 'DeFi' },
      { pattern: /\bon chain\b/gi, replacement: 'onchain' },
      { pattern: /\bon-chain\b/gi, replacement: 'onchain' },
      { pattern: /\bbroadchain\b/gi, replacement: 'blockchain' },
      { pattern: /\bblock chain\b/gi, replacement: 'blockchain' },
      { pattern: /\bgenetic payment\b/gi, replacement: 'agentic payment' },
      { pattern: /\bthe art definitely\b/gi, replacement: 'Arc definitely' },
      { pattern: /\bart definitely\b/gi, replacement: 'Arc definitely' },
      { pattern: /\bcrypto[-\s]?nate\b/gi, replacement: 'crypto native' },
      { pattern: /\bratty\b/gi, replacement: 'ready' },
      { pattern: /\biot induction\b/gi, replacement: 'IoT industry' },
      { pattern: /\bphysical aging\b/gi, replacement: 'physical agent' },
      { pattern: /\bslipe\s?coin\b/gi, replacement: 'stablecoin' },
      { pattern: /\bpay to day\b/gi, replacement: 'pay-as-you-go' },
      { pattern: /\bpay per use pay as you go\b/gi, replacement: 'pay-per-use / pay-as-you-go' },
      { pattern: /\bhigh frequency small volume\b/gi, replacement: 'high-frequency, small-value' },
      { pattern: /\bark testnet\b/gi, replacement: 'Arc testnet' },
      { pattern: /\bark test net\b/gi, replacement: 'Arc testnet' },
      { pattern: /\barc test net\b/gi, replacement: 'Arc testnet' },
      { pattern: /\bark sdk\b/gi, replacement: 'Arc SDK' },
      { pattern: /\bark agent\b/gi, replacement: 'Arc Agent' },
      { pattern: /\barc agent\b/gi, replacement: 'Arc Agent' },
      { pattern: /\barc doc\b/gi, replacement: 'docs.arc.io' },
      { pattern: /\barc docs\b/gi, replacement: 'docs.arc.io' },
      { pattern: /\bark docs\b/gi, replacement: 'docs.arc.io' },
      { pattern: /\barc io\b/gi, replacement: 'docs.arc.io' },
      { pattern: /\bark network\b/gi, replacement: 'Arc Network' },
      { pattern: /\barc network\b/gi, replacement: 'Arc Network' },
      { pattern: /\bcircle arc\b/gi, replacement: 'Circle Arc' },
      { pattern: /\bcircle ark\b/gi, replacement: 'Circle Arc' },
      { pattern: /\bmalachite\b/gi, replacement: 'Malachite' },
      { pattern: /\bmaliki bft\b/gi, replacement: 'Malachite BFT' },
      { pattern: /\bmalachite bft\b/gi, replacement: 'Malachite BFT' },
      { pattern: /\btenderman bft\b/gi, replacement: 'Tendermint BFT' },
      { pattern: /\btender mint bft\b/gi, replacement: 'Tendermint BFT' },
      { pattern: /\bwreath\b/gi, replacement: 'Reth' },
      { pattern: /\breth\b/gi, replacement: 'Reth' },
      { pattern: /\barcane vm\b/gi, replacement: 'ArcaneVM' },
      { pattern: /\barkane vm\b/gi, replacement: 'ArcaneVM' },
      { pattern: /\be w m a\b/gi, replacement: 'EWMA' },
      { pattern: /\byou w m a\b/gi, replacement: 'EWMA' },
      { pattern: /\bc c t p\b/gi, replacement: 'CCTP' },
      { pattern: /\bapp kits?\b/gi, replacement: 'App Kit' },
      { pattern: /\bunified balance\b/gi, replacement: 'Unified Balance' },
      { pattern: /\bunify balance\b/gi, replacement: 'Unified Balance' },
      { pattern: /\bchain id five zero four two zero zero two\b/gi, replacement: 'Chain ID 5042002' },
      { pattern: /\bfive zero four two zero zero two\b/gi, replacement: '5042002' },
      { pattern: /\bviem\b/gi, replacement: 'Viem' },
      { pattern: /\bvee em\b/gi, replacement: 'Viem' },
      { pattern: /\bethers\b/gi, replacement: 'Ethers' },
      { pattern: /\bethers js\b/gi, replacement: 'Ethers.js' },
      { pattern: /\bsmart agent\b/gi, replacement: 'AI agent' },
      { pattern: /\bsmart agents\b/gi, replacement: 'AI agents' },
      { pattern: /\bai agent\b/gi, replacement: 'AI agent' },
      { pattern: /\bai agents\b/gi, replacement: 'AI agents' },
      { pattern: /\bgas war\b/gi, replacement: 'gas war' },
      { pattern: /\bgas wars\b/gi, replacement: 'gas war' },
      { pattern: /\bg weight\b/gi, replacement: 'gwei' },
      { pattern: /\bg-way\b/gi, replacement: 'gwei' },
      { pattern: /\bmev bot\b/gi, replacement: 'MEV bot' },
      { pattern: /\bmev bots\b/gi, replacement: 'MEV bots' },
      { pattern: /\bfront run\b/gi, replacement: 'frontrun' },
      { pattern: /\bfront running\b/gi, replacement: 'frontrun' },
      { pattern: /\bsandwich attack\b/gi, replacement: 'sandwich attack' },
      { pattern: /\bsandwich attacks\b/gi, replacement: 'sandwich attack' },
      { pattern: /\bslippage\b/gi, replacement: 'slippage' },
      { pattern: /\bimpermanent loss\b/gi, replacement: 'impermanent loss' },
      { pattern: /\bactive addresses\b/gi, replacement: 'active addresses' },
      { pattern: /\btx hash\b/gi, replacement: 'transaction hash' },
      { pattern: /\bblock explorer\b/gi, replacement: 'block explorer' },
      { pattern: /\byield aggregator\b/gi, replacement: 'yield aggregator' },
      { pattern: /\bconcentrated liquidity\b/gi, replacement: 'concentrated liquidity' },
      { pattern: /\bzk ml\b/gi, replacement: 'ZK-ML' },
      { pattern: /\bzkml\b/gi, replacement: 'ZK-ML' },
      { pattern: /\bzero knowledge machine learning\b/gi, replacement: 'zero-knowledge machine learning' },
      { pattern: /\bautonomous agent\b/gi, replacement: 'autonomous agent' },
      { pattern: /\bautonomous agents\b/gi, replacement: 'autonomous agents' },
      { pattern: /\bagentic framework\b/gi, replacement: 'agentic framework' },
      { pattern: /\bagentic frameworks\b/gi, replacement: 'agentic frameworks' },
      { pattern: /\bswarm intelligence\b/gi, replacement: 'swarm intelligence' },
      { pattern: /\bagent registry\b/gi, replacement: 'agent registry' },
      { pattern: /\binference cost\b/gi, replacement: 'inference cost' },
      { pattern: /\bvitalik\b/gi, replacement: 'Vitalik' },
      { pattern: /\bsatoshi\b/gi, replacement: 'Satoshi' },
      { pattern: /\bsandeep\b/gi, replacement: 'Sandeep' },
      { pattern: /\belon\b/gi, replacement: 'Elon' },
      { pattern: /\bcz\b/gi, replacement: 'CZ' },
      { pattern: /\bsreeram\b/gi, replacement: 'Sreeram' },
      { pattern: /\beigenlayer\b/gi, replacement: 'EigenLayer' },
      { pattern: /\beigen\b/gi, replacement: 'Eigen' }
    );
  } else if (topic === 'tech') {
    rules.push(
      { pattern: /\bmushroom\b/gi, replacement: 'machine' },
      { pattern: /\bmushrooms\b/gi, replacement: 'machines' },
      { pattern: /\bblue energy\b/gi, replacement: 'BLE' },
      { pattern: /\bblue tooth\b/gi, replacement: 'Bluetooth' },
      { pattern: /\bi yacht\b/gi, replacement: 'IoT' },
      { pattern: /\bi o t\b/gi, replacement: 'IoT' },
      { pattern: /\bdeep loy\b/gi, replacement: 'deploy' },
      { pattern: /\bcoobernetes\b/gi, replacement: 'Kubernetes' },
      { pattern: /\bkoobernetes\b/gi, replacement: 'Kubernetes' }
    );
  } else if (topic === 'business') {
    rules.push(
      { pattern: /\bconversation rate\b/gi, replacement: 'conversion rate' },
      { pattern: /\bconversations rate\b/gi, replacement: 'conversion rate' },
      { pattern: /\bpeach deck\b/gi, replacement: 'pitch deck' },
      { pattern: /\bsauce\b/gi, replacement: 'SaaS' },
      { pattern: /\bsass\b/gi, replacement: 'SaaS' },
      { pattern: /\bbee to bee\b/gi, replacement: 'B2B' },
      { pattern: /\bb to b\b/gi, replacement: 'B2B' },
      { pattern: /\bbee to see\b/gi, replacement: 'B2C' },
      { pattern: /\bb to c\b/gi, replacement: 'B2C' },
      { pattern: /\baccusation\b/gi, replacement: 'acquisition' }
    );
  } else if (topic === 'gaming') {
    rules.push(
      { pattern: /\bnoob\b/gi, replacement: 'newbie' },
      { pattern: /\bgank\b/gi, replacement: 'gank' },
      { pattern: /\bcooldown\b/gi, replacement: 'cooldown' },
      { pattern: /\brespawn\b/gi, replacement: 'respawn' }
    );
  } else if (topic === 'finance') {
    rules.push(
      { pattern: /\bbull market\b/gi, replacement: 'bull market' },
      { pattern: /\bbear market\b/gi, replacement: 'bear market' },
      { pattern: /\betf\b/gi, replacement: 'ETF' },
      { pattern: /\bportfolio\b/gi, replacement: 'portfolio' }
    );
  } else if (topic === 'entertainment') {
    rules.push(
      { pattern: /\bblockbuster\b/gi, replacement: 'blockbuster' },
      { pattern: /\bfandom\b/gi, replacement: 'fandom' },
      { pattern: /\bpremiere\b/gi, replacement: 'premiere' }
    );
  } else if (topic === 'education') {
    rules.push(
      { pattern: /\bsyllabus\b/gi, replacement: 'syllabus' },
      { pattern: /\bcurriculum\b/gi, replacement: 'curriculum' },
      { pattern: /\bhypothesis\b/gi, replacement: 'hypothesis' }
    );
  } else if (topic === 'news') {
    rules.push(
      { pattern: /\bbreaking news\b/gi, replacement: 'breaking news' },
      { pattern: /\bpress release\b/gi, replacement: 'press release' },
      { pattern: /\bcorrespondent\b/gi, replacement: 'correspondent' }
    );
  }

  rules.forEach(rule => {
    cleaned = cleaned.replace(rule.pattern, rule.replacement);
  });

  return cleaned;
}

function cleanStutteringAndRepetitions(text) {
  if (!text || typeof text !== 'string') return '';

  // The separator must be whitespace only. Allowing [\s,.]+ let the backreference
  // match across a sentence terminator and across an emphatic comma, so
  // "that's the point. The point is speed." collapsed to "that's the point is
  // speed." and "It's very, very fast." lost the emphasis it was carrying.
  // Single-word repetitions: "the the the" -> "the"
  let cleaned = text.replace(/\b(\w+)(?:\s+\1\b)+/gi, '$1');
  // Two-word repetitions: "so as so as" -> "so as"
  cleaned = cleaned.replace(/\b(\w+\s+\w+)(?:\s+\1\b)+/gi, '$1');
  // Three-word repetitions: "one two three one two three" -> "one two three"
  cleaned = cleaned.replace(/\b(\w+\s+\w+\s+\w+)(?:\s+\1\b)+/gi, '$1');

  return cleaned;
}

function cleanConsecutiveDuplicates(text) {
  if (!text || typeof text !== 'string') return '';
  let cleaned = cleanStutteringAndRepetitions(text);
  const words = cleaned.trim().split(/\s+/);
  if (words.length < 2) return cleaned;

  let n = words.length;
  let i = 0;
  let newWords = [];
  while (i < n) {
    let matchFound = false;
    for (let L = Math.min(10, Math.floor((n - i) / 2)); L >= 1; L--) {
      const rawSeq1 = words.slice(i, i + L).join(' ');
      // A terminator inside the first copy means two sentences that merely start
      // the same way. Stripping punctuation before comparing made them equal, and
      // `i += L` then dropped the copy carrying the '.', fusing both sentences.
      if (/[.!?。！？।]/.test(rawSeq1)) continue;
      const strip = s => s.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
      const seq1 = strip(rawSeq1);
      const seq2 = strip(words.slice(i + L, i + 2 * L).join(' '));
      // Doubling a single intensifier is emphasis, not a stutter.
      const EMPHATIC = new Set(['very', 'really', 'no', 'yes', 'so', 'rất', 'không', 'đúng', 'vâng']);
      if (L === 1 && EMPHATIC.has(seq1)) continue;
      if (seq1 === seq2 && seq1.length > 0) {
        i += L; // skip duplicate sequence
        matchFound = true;
        break;
      }
    }
    if (!matchFound) {
      newWords.push(words[i]);
      i++;
    }
  }
  return newWords.join(' ');
}

function cleanIncompletePunctuation(text) {
  if (!text || typeof text !== 'string') return '';
  const incompleteWords = new Set([
    'and', 'but', 'or', 'so', 'because', 'although', 'if', 'when', 'while', 'that', 'who', 'which', 'as', 'than', 'unless', 'though', 'whereas',
    'of', 'to', 'for', 'with', 'on', 'at', 'by', 'from', 'about', 'in', 'into', 'through', 'during', 'before', 'after', 'under', 'over', 'between', 'among', 'like',
    'the', 'a', 'an', 'this', 'these', 'those', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'any', 'some', 'every', 'each',
    'i', 'we', 'you', 'he', 'she', 'they', 'it', 'who', 'whom',
    'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must', 'get', 'got', 'become', 'becomes',
    'bring', 'bringing', 'enable', 'enabling', 'make', 'making', 'take', 'taking', 'give', 'giving', 'create', 'creating', 'want', 'wanting', 'need', 'needing', 'use', 'using', 'build', 'building',
    'provide', 'providing', 'allow', 'allowing', 'help', 'helping', 'send', 'sending', 'receive', 'receiving', 'run', 'running', 'start', 'starting', 'prevent', 'preventing', 'support', 'supporting'
  ]);
  // A '.', '!' or '?' may only be dissolved after a word that genuinely CANNOT
  // end an English sentence — an article, preposition or conjunction. The set
  // above also holds 'do', 'is', 'can', 'it', 'they', 'that', 'we', 'you', all of
  // which end sentences all the time, so applying it to terminators merged real
  // ones ("Yes, we do. The network settles." -> "Yes, we do the network settles.").
  // That in turn killed hasMultipleSentences, which is exactly what
  // shouldFinalizeSegment uses to cut at a true sentence boundary.
  // Commas stay dissolvable for the whole set.
  const hardIncomplete = new Set([
    'and', 'but', 'or', 'nor', 'yet', 'because', 'although', 'if', 'when', 'while',
    'as', 'than', 'unless', 'though', 'whereas', 'of', 'to', 'for', 'with', 'on', 'at',
    'by', 'from', 'about', 'in', 'into', 'through', 'during', 'before', 'after',
    'under', 'over', 'between', 'among', 'the', 'a', 'an', 'my', 'your', 'his', 'her',
    'its', 'our', 'their'
  ]);
  // Never re-case word2: it silently lowercased the proper nouns that the whole
  // PROPER_NOUNS_PROTECT / ARC_LIVESTREAM_TERM_RULES machinery exists to defend
  // ("That's what it is. Arc is fast." -> "...it is arc is fast.").
  return text.replace(/\b(\w+)\s*([.,!?]+)\s+(\w+)/g, (match, word1, punct, word2) => {
    const w = word1.toLowerCase();
    const commaOnly = !/[.!?]/.test(punct);
    if (commaOnly ? incompleteWords.has(w) : hardIncomplete.has(w)) {
      return word1 + ' ' + word2;
    }
    return match;
  });
}

function isSemanticallyIncomplete(text) {
  if (!text || typeof text !== 'string') return true;
  const cleanText = text.trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
  const words = cleanText.split(/\s+/);
  if (words.length === 0) return true;
  const lastWord = words[words.length - 1];

  // Only block on clearly dangling conjunctions, prepositions, and articles.
  // REMOVED verbs (build, run, use, etc.) — these can end a complete clause.
  // Keeping this list minimal to avoid over-blocking real sentences.
  const incompleteWords = new Set([
    // Conjunctions — sentence clearly continues
    'and', 'but', 'or', 'so', 'because', 'although', 'if', 'when', 'while',
    'who', 'which', 'as', 'than', 'unless', 'though', 'whereas', 'that',
    // Prepositions — noun phrase not yet complete
    'of', 'to', 'for', 'with', 'on', 'at', 'by', 'from', 'about', 'in',
    'into', 'through', 'during', 'before', 'after', 'under', 'over',
    'between', 'among', 'like',
    // Articles / determiners — always followed by noun
    'the', 'a', 'an', 'this', 'these', 'those',
    // Auxiliary verbs only (not action verbs)
    'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must'
  ]);

  return incompleteWords.has(lastWord);
}

/**
 * Multi-language aware finalize decision.
 * Replaces the old single-line `shouldFinalize` logic that incorrectly used
 * English-only `isSemanticallyIncomplete()` for all source languages.
 *
 * Strategy:
 * - Punctuation / multi-sentence markers: always finalize (language-agnostic).
 * - wordCount >= 20 safety cap: always finalize (Latin-script languages).
 * - CJK / Thai char cap (charCount >= 40): finalize when no space-separated words.
 * - English / auto source only: apply the English dangling-word heuristic.
 * - Non-English: rely on time-cap (3.5 s) to avoid holding chunks indefinitely.
 */
// How long an unpunctuated fragment may be held back waiting for the rest of its
// sentence. Trades caption naturalness against the delay a viewer feels; raise it
// if lines start arriving as disconnected fragments.
const SENTENCE_HOLD_MS = 2500;

function shouldFinalizeSegment({ text, sourceLang, endsWithPunctuation, hasMultipleSentences, wordCount, accumulatedMs }) {
  // Always finalize on clear sentence boundaries
  if (endsWithPunctuation || hasMultipleSentences) return true;

  // Word-count safety cap (meaningful for Latin-script languages).
  // 24 fits ~80% of real speech sentences whole (the audited 151-WPM Arc video
  // averages 17 words/sentence); 20 was splitting long jargon sentences in two.
  if (wordCount >= 24) return true;

  // Character-count safety cap for space-insensitive scripts (zh / ja / th)
  // wordCount is always 1 for CJK/Thai continuous text — use char count instead
  const cjkSources = ['zh', 'ja', 'th'];
  if (cjkSources.includes(sourceLang)) {
    const charCount = text.replace(/\s/g, '').length;
    if (charCount >= 40) return true;
  }

  // For English / auto-detected source: hold ALL unpunctuated fragments, not
  // just dangling-word ones. Fast speakers rarely pause, so hard-capped audio
  // chunks end mid-sentence on ordinary words ("...the network treats") — the
  // old rule finalized there and translated ~9-word fragments one by one
  // (audited at 64% fragment lines on a 151-WPM stream; holding cuts that to
  // ~29% and lets whole sentences translate correctly). Latency is safe: the
  // word cap above and the 5s time cap bound the hold, and interim Google
  // subtitles keep the UI live while a sentence accumulates.
  const isEnglishLike = !sourceLang || sourceLang === 'auto' || sourceLang === 'en';
  if (isEnglishLike) {
    if (accumulatedMs === undefined) return true;
    // This hold is pure added latency: the words are already transcribed and are
    // being kept back purely so an unpunctuated fragment can find its sentence.
    // At 5000ms it dominated the delay a viewer feels, on top of the chunk, the
    // ASR round trip and the translation round trip. 2500ms still absorbs the
    // common mid-sentence pause; the punctuation and word-count rules above
    // still finalise earlier whenever the sentence genuinely ends.
    return accumulatedMs >= SENTENCE_HOLD_MS;
  }

  // Non-English, non-CJK: apply time-cap to avoid holding chunks indefinitely.
  // sentenceStartTime is set when the first word of the current sentence arrives.
  if (accumulatedMs !== undefined && accumulatedMs < 3500) return false;

  // Time-cap reached or no timer available — finalize
  return true;
}


// This complements the AI prompt and also protects Google Translate output,
// which has no prompt/context channel. Keep only high-confidence replacements.
const ARC_LIVESTREAM_TERM_RULES = [
  { source: /\bArc\b|\bArc Network\b|\bCircle Arc\b/i, keep: 'Arc', bad: [/\bark\b/gi, /\barco\b/gi, /\barche\b/gi, /\bдуга\b/gi, /弧形?|弧線|圆弧|圓弧|아크|アーク/g] },
  { source: /\bArc Network\b/i, keep: 'Arc Network', bad: [/\bark network\b/gi, /\bmạng arc\b/gi, /\bred arc\b/gi, /Arc ネットワーク/g, /Arc 네트워크/g, /Arc 网络|Arc 網絡/g] },
  { source: /\bCircle\b/i, keep: 'Circle', bad: [/\bvòng tròn\b/gi, /\bcírculo\b/gi, /\bcercle\b/gi, /\bkreis\b/gi, /圆圈|圓圈|วงกลม|круг|서클|サークル/g] },
  { source: /\bUSDC\b/i, keep: 'USDC', bad: [/\busd coin\b/gi, /\busd đồng xu\b/gi, /\bยูเอสดีซี\b/gi] },
  { source: /\bEURC\b/i, keep: 'EURC', bad: [/\beur coin\b/gi, /\beur đồng xu\b/gi, /\be u r c\b/gi] },
  { source: /\bGateway\b/i, keep: 'Gateway', bad: [/\bcổng kết nối\b/gi, /\bcổng\b/gi, /网关|網關/g, /puerta de enlace/gi, /passerelle/gi] },
  { source: /\bCCTP\b|Cross-Chain Transfer Protocol/i, keep: 'CCTP', bad: [/\bc c t p\b/gi, /\bซีซีทีพี\b/gi] },
  { source: /\bMalachite\b/i, keep: 'Malachite', bad: [/\bmaliki\b/gi, /\bmalachit\b/gi, /孔雀石|มาลาไคต์|Малахит|말라카이트|マラカイト/g] },
  { source: /\bTendermint BFT\b/i, keep: 'Tendermint BFT', bad: [/\btender mint bft\b/gi, /\btenderman bft\b/gi] },
  { source: /\bReth\b/i, keep: 'Reth', bad: [/\bwreath\b/gi, /\bพวงหรีด\b/gi, /花环|花環/g] },
  { source: /\bArcaneVM\b|\bArcane VM\b/i, keep: 'ArcaneVM', bad: [/\barcane vm\b/gi, /\barkane vm\b/gi, /神秘\s*VM|비전\s*VM|アルケイン\s*VM/g] },
  { source: /\bEIP-1559\b/i, keep: 'EIP-1559', bad: [/\beip 1559\b/gi, /\be i p 1559\b/gi] },
  { source: /\bEWMA\b|exponentially weighted moving average/i, keep: 'EWMA', bad: [/\be w m a\b/gi, /\byou w m a\b/gi] },
  { source: /\bJSON-RPC\b/i, keep: 'JSON-RPC', bad: [/\bjson rpc\b/gi, /\bjason rpc\b/gi] },
  { source: /\bViem\b/i, keep: 'Viem', bad: [/\bvee em\b/gi] },
  { source: /\bUnified Balance\b/i, keep: 'Unified Balance', bad: [/\bunify balance\b/gi, /\bunified balances\b/gi, /统一余额|統一餘額|統一残高|통합 잔액|saldo unificado|solde unifié|einheitlicher saldo/g] },
  { source: /\bApp Kit\b|\bApp Kits\b|\bApp Kit SDK\b/i, keep: 'App Kit', bad: [/\bapp kits\b/gi, /应用套件|應用套件|アプリキット|앱 키트|kit d'application|kit de aplicación/g] },
  { source: /\bBridge Kit\b/i, keep: 'Bridge Kit', bad: [/\bkit cầu\b/gi, /橋接キット|브리지 키트|kit de pont|kit de puente/g] },
  { source: /\bSwap Kit\b/i, keep: 'Swap Kit', bad: [/交換キット|스왑 키트|kit d'échange|kit de intercambio/g] },
  { source: /\bModel Context Protocol\b|\bMCP\b/i, keep: 'MCP', bad: [/\bm c p\b/gi, /โมเดลบริบทโปรโตคอล/g] },
  { source: /\bChain ID 5042002\b|\b5042002\b/i, keep: 'Chain ID 5042002', bad: [/chain id five zero four two zero zero two/gi, /five zero four two zero zero two/gi] },
  { source: /\bx402\b/i, keep: 'x402', bad: [/\bx\s*-?\s*402\b/gi, /\bX-402\b/g, /\bx bốn không hai\b/gi, /\bx bốn lẻ hai\b/gi, /\bx bốn trăm linh hai\b/gi, /\bx bốn trăm lẻ hai\b/gi, /\bex four oh two\b/gi, /\bx four oh two\b/gi] },
  { source: /\bx420\b/i, keep: 'x420', bad: [/\bx\s*-?\s*420\b/gi, /\bX-420\b/g, /\bx bốn trăm hai mươi\b/gi, /\bx bốn hai không\b/gi, /\bex four twenty\b/gi, /\bx four twenty\b/gi] },
  { source: /\bArc House\b/i, keep: 'Arc House', bad: [/\bnhà arc\b/gi, /ngôi nhà arc/gi, /Arc nhà/gi] },
  { source: /\bArchitect\b/i, keep: 'Architect', bad: [/kiến trúc sư/gi, /kiến trúc sư thiết kế/gi, /Architecte/gi] },
  { source: /\bBLE\b|Bluetooth Low Energy/i, keep: 'BLE', bad: [/\bBIE\b/g, /\bBRE\b/g, /Bluetooth năng lượng thấp/gi] },
  { source: /\beCandle\b|\beCandles\b/i, keep: 'eCandle', bad: [/\bE-Kendo\b/g, /\bEkendo\b/g, /\bE-Central\b/g, /\bE-Cando\b/g, /nến điện tử/gi] },
  { source: /\bmachine-to-machine\b/i, keep: 'machine-to-machine', bad: [/giữa máy với máy/gi, /máy đến máy/gi, /máy với máy/gi] },
  { source: /\bhash rate\b/i, keep: 'hash rate', bad: [/tỷ lệ băm/gi, /tốc độ băm/gi] }
];

function escapeRegexLiteral(text) {
  const specials = '.*+?^' + String.fromCharCode(36) + '()|[]\{}';
  return text.split('').map(ch => specials.includes(ch) ? String.fromCharCode(92) + ch : ch).join('');
}

function applyArcTermProtection(translated, original) {
  if (!translated || !original) return translated || '';
  let polished = translated;
  ARC_LIVESTREAM_TERM_RULES.forEach(rule => {
    rule.source.lastIndex = 0;
    if (!rule.source.test(original)) return;
    rule.source.lastIndex = 0;
    rule.bad.forEach(pattern => { polished = polished.replace(pattern, rule.keep); });
  });
  const alwaysCased = [
    ['usdc', 'USDC'], ['eurc', 'EURC'], ['usyc', 'USYC'], ['evm', 'EVM'],
    ['rpc', 'RPC'], ['erc-20', 'ERC-20'], ['erc 20', 'ERC-20'], ['erc-8004', 'ERC-8004'],
    ['erc 8004', 'ERC-8004'], ['erc-8183', 'ERC-8183'], ['erc 8183', 'ERC-8183'], ['gwei', 'Gwei'],
    ['eip-1559', 'EIP-1559'], ['ewma', 'EWMA'], ['cctp', 'CCTP'], ['mcp', 'MCP'],
    ['x-402', 'x402'], ['x-420', 'x420'], ['ble', 'BLE'], ['esp32', 'ESP32'], ['ecandle', 'eCandle'],
    ['arc house', 'Arc House'], ['agentic economy', 'Agentic Economy'],
    ['circle gateway', 'Circle Gateway'], ['developer-controlled wallets', 'Developer-Controlled Wallets'],
    ['user-controlled wallets', 'User-Controlled Wallets'], ['modular wallets', 'Modular Wallets']
  ];
  // Removed: no-op identity pairs ('opt-in privacy' → 'opt-in privacy' etc.) that
  // burned a regex pass per line, and the 'architect' → 'Architect' rule that
  // capitalized the ordinary English word in every language.
  alwaysCased.forEach(([raw, fixed]) => {
    polished = polished.replace(new RegExp('\\b' + escapeRegexLiteral(raw) + '\\b', 'gi'), fixed);
  });
  return polished;
}

async function polishLiveTranslation(translated, original, targetLang = 'vi', topic = 'general') {
  let polished = applyArcTermProtection(translated, original);
  const glossary = await getGlossary(topic, targetLang);
  
  if (glossary && glossary.postReplacements) {
    glossary.postReplacements.forEach(rule => {
      if (rule.regex) {
        polished = polished.replace(rule.regex, rule.replacement);
      } else if (rule.pattern instanceof RegExp) {
        polished = polished.replace(rule.pattern, rule.replacement);
      } else {
        polished = polished.replace(new RegExp(escapeRegexLiteral(rule.pattern), 'gi'), rule.replacement);
      }
    });
  }

  // Handle specific context-aware rules that require looking at the original English text
  if ((targetLang || '').toLowerCase() === 'vi') {
    if (topic === 'crypto') {
      // Only touch "ổn định" when the original explicitly said stablecoin —
      // the previous blanket /ổn định/→'stable' rewrote EVERY legitimate use
      // of the Vietnamese word for "stable/stability" into English.
      if (original && /stable\s*coins?\b/i.test(original)) {
        polished = polished.replace(/đồng ổn định|đồng tiền ổn định/gi, 'stablecoin');
      }
      if (original && /circle/i.test(original)) {
        polished = polished.replace(/vòng tròn/gi, 'Circle');
      }
      if (original && /\barc\b/i.test(original)) {
        polished = polished.replace(/vòng cung|hồ quang|cung tròn/gi, 'Arc');
      }
      if (original && /x402/i.test(original)) {
        polished = polished.replace(/x[-\s]?402|x bốn không hai|x bốn lẻ hai|x bốn trăm linh hai|x bốn trăm lẻ hai/gi, 'x402');
      }
      if (original && /machine-to-machine/i.test(original)) {
        polished = polished.replace(/giữa máy với máy|máy đến máy|máy với máy/gi, 'machine-to-machine');
      }
      if (original && /machine wallet/i.test(original)) {
        polished = polished.replace(/ví máy|ví thiết bị/gi, 'machine wallet');
      }
      if (original && /streaming payment/i.test(original)) {
        polished = polished.replace(/thanh toán trực tuyến|khoản thanh toán trực tuyến|thanh toán streaming/gi, 'thanh toán liên tục');
      }
      if (original && /high[-\s]?frequency|small[-\s]?(?:value|volume)/i.test(original)) {
        polished = polished.replace(/tần số cao,?\s*âm lượng nhỏ/gi, 'tần suất cao, giá trị nhỏ');
        polished = polished.replace(/tần số cao,?\s*khối lượng nhỏ/gi, 'tần suất cao, giá trị nhỏ');
      }
      if (original && /dynamic pricing/i.test(original)) {
        polished = polished.replace(/giá động|định giá năng động/gi, 'định giá động');
      }
      if (original && /arc testnet/i.test(original)) {
        polished = polished.replace(/mạng thử nghiệm arc|mạng thử nghiệm của arc/gi, 'Arc Testnet');
      }
      if (original && /\bagents?\b/i.test(original)) {
        polished = polished.replace(/các tác nhân|các đại lý/gi, 'các agent');
        polished = polished.replace(/tác nhân|đại lý/gi, 'agent');
      }
      if (original && /docs\.arc\.io/i.test(original)) {
        polished = polished.replace(/tài liệu arc|tài liệu của arc/gi, 'docs.arc.io');
      }
      if (original && /vitalik/i.test(original)) {
        polished = polished.replace(/vitalik/gi, 'Vitalik');
      }
      if (original && /satoshi/i.test(original)) {
        polished = polished.replace(/satoshi/gi, 'Satoshi');
      }
      if (original && /sandeep/i.test(original)) {
        polished = polished.replace(/sandeep/gi, 'Sandeep');
      }
      if (original && /elon/i.test(original)) {
        polished = polished.replace(/elon/gi, 'Elon');
      }
      if (original && /\bcz\b/i.test(original)) {
        polished = polished.replace(/\bcz\b/gi, 'CZ');
      }
      if (original && /sreeram/i.test(original)) {
        polished = polished.replace(/sreeram/gi, 'Sreeram');
      }
      if (original && /eigenlayer/i.test(original)) {
        polished = polished.replace(/eigenlayer/gi, 'EigenLayer');
      }
      if (original && /\beigen\b/i.test(original)) {
        polished = polished.replace(/\beigen\b/gi, 'Eigen');
      }
    } else if (topic === 'tech') {
      // Spoken subtitles must never contain parenthetical glosses or slashes —
      // TTS reads them aloud and they look like machine output on screen.
      if (original && /\bfleet\b/i.test(original)) {
        polished = polished.replace(/đội tàu/gi, 'fleet');
      }
      if (original && /e[-\s]?candle/i.test(original)) {
        polished = polished.replace(/nến điện tử/gi, 'eCandle');
      }
      if (original && /\b(?:repository|repo)\b/i.test(original)) {
        polished = polished.replace(/kho chứa/gi, 'repo');
      }
    } else if (topic === 'business') {
      if (original && /\bgateway\b/i.test(original)) {
        polished = polished.replace(/\bcổng\b/gi, 'cổng thanh toán');
      }
    }
  } else {
    // Non-Vietnamese target: apply brand/tech-term protection for all other languages.
    // These rules guard against literal translations of terms that must stay in English
    // regardless of target language (Google Translate has no prompt/context channel).
    if (original) {
      if (/stable/i.test(original)) {
        polished = polished.replace(/stable\s+coin\b/gi, 'stablecoin');
      }
      if (/arc\s+testnet/i.test(original)) {
        // Protect "Arc Testnet" from being translated in any language
        polished = polished.replace(/\b(?:arc|ark)\s+(?:test\s*net|réseau\s+de\s+test|試験?ネット|테스트넷|testovac[íi]\s+s[íi]ť|Testnetz|тестовая\s+сеть|testnet)\b/gi, 'Arc Testnet');
      }
      if (/machine-to-machine/i.test(original)) {
        // Protect "machine-to-machine" from literal translations in other languages
        polished = polished.replace(/\bmachine\s*[àa\-]\s*machine\b/gi, 'machine-to-machine');
        polished = polished.replace(/\bmaschine\s*zu\s*maschine\b/gi, 'machine-to-machine');
        polished = polished.replace(/\bмашина\s*к\s*машине\b/gi, 'machine-to-machine');
      }
      if (/ecandle/i.test(original)) {
        polished = polished.replace(/\be[- ]?candle\b/gi, 'eCandle');
      }
      if (/hash\s*rate/i.test(original)) {
        // Common mistranslations in various languages
        polished = polished.replace(/\btasso\s+di\s+hash\b/gi, 'hash rate');
        polished = polished.replace(/\btaux\s+de\s+hachage\b/gi, 'hash rate');
        polished = polished.replace(/\bHashrate\b/g, 'hash rate');
      }
      if (/circle/i.test(original)) {
        // Protect Circle (the company) from being translated as a geometric shape
        polished = polished.replace(/\bKreis\b/g, 'Circle');
        polished = polished.replace(/\bcercle\b/gi, 'Circle');
        polished = polished.replace(/\bcírculo\b/gi, 'Circle');
        polished = polished.replace(/\bcerchio\b/gi, 'Circle');
      }
      if (/arc/i.test(original)) {
        // Protect Arc (the blockchain) from being translated as an arch/arc shape
        polished = polished.replace(/\bArco\b/g, 'Arc');
        polished = polished.replace(/\bArche\b/g, 'Arc');
      }
    }
    if (topic === 'crypto' && original) {
      if (/18 decimals|6 decimals|ERC-20/i.test(original)) polished = polished.replace(/ERC\s?20/gi, 'ERC-20');
      if (/sub-second|deterministic finality/i.test(original)) polished = polished.replace(/sub second/gi, 'sub-second');
    }
  }

  if ((targetLang || '').toLowerCase() === 'vi') {
    polished = deTranslationeseVi(polished);
  }

  // Spoken subtitles must never carry parenthetical glosses: TTS reads the
  // brackets out loud ("trượt giá mở ngoặc slippage đóng ngoặc") and on screen
  // they are the clearest tell of machine output. Sixteen crypto rules insert
  // them, and one of those ("ví máy" -> "ví thiết bị (machine wallet)") runs
  // before the term rule above, producing "machine wallet (machine wallet)".
  // Strip them here instead of unpicking every rule.
  polished = polished.replace(/\s*\(([^()]{1,40})\)/g, '');
  polished = polished.replace(/\s{2,}/g, ' ').trim();

  return polished;
}

// ─── Vietnamese de-translationese ────────────────────────────────────────────
// Everything else in polishLiveTranslation swaps TERMS; nothing addressed
// SYNTAX, so the calques that make output read as machine translation survived
// on both paths — and on the Google path, which has no prompt channel at all,
// nothing else could catch them.
//
// These rules are deliberately high-precision and low-recall. The lesson from
// the old `general.vi` block is that a post-filter which fires where it should
// not is far worse than one that misses: it silently overrides deliberate
// choices and corrupts ordinary words. So each rule carries an explicit
// whitelist rather than matching a general shape, and every one is covered by
// negative cases in the test suite.
const _VI_LETTER = '[a-zA-ZÀ-ỹ]';
const _VI_NB = `(?<!${_VI_LETTER})`;
const _VI_NA = `(?!${_VI_LETTER})`;

// Verbs after which spoken Vietnamese says "là", not the bookish "rằng".
const _VI_SAY_VERBS = ['nói', 'nghĩ', 'tin', 'cho', 'thấy', 'hiểu', 'biết', 'khẳng định', 'công nhận'];

// Adjectives that really do appear in the "một cách X" adverbial calque.
const _VI_ADV_ADJ = [
  'đáng kể', 'nhanh chóng', 'dễ dàng', 'hiệu quả', 'an toàn', 'chính xác',
  'rõ ràng', 'tự động', 'hoàn toàn', 'đơn giản', 'trực tiếp', 'độc lập',
  'liên tục', 'nhanh', 'chậm', 'đáng tin cậy', 'minh bạch', 'công khai'
];
// ...but "một cách" is also article + noun ("một cách làm hay" = a good way).
// After any of these verbs it is the noun reading, so leave it alone.
const _VI_NOUN_TAKERS = ['tìm', 'có', 'là', 'cần', 'muốn', 'chọn', 'dùng', 'theo', 'bằng', 'với', 'thành'];

// Nouns that "thực hiện"/"tiến hành" nominalise for no reason: a person just
// says "giao dịch", not "thực hiện giao dịch".
const _VI_ACTION_NOUNS = [
  'giao dịch', 'thanh toán', 'chuyển khoản', 'đặt lệnh', 'kiểm tra',
  'thay đổi', 'cập nhật', 'nâng cấp', 'triển khai'
];

const _VI_RE_MEANS_UPPER = new RegExp(`${_VI_NB}Điều (?:đó|này|đấy) có nghĩa là${_VI_NA}`, 'g');
const _VI_RE_MEANS_LOWER = new RegExp(`${_VI_NB}điều (?:đó|này|đấy) có nghĩa là${_VI_NA}`, 'g');
const _VI_RE_RANG = new RegExp(`${_VI_NB}(${_VI_SAY_VERBS.join('|')}) rằng${_VI_NA}`, 'gi');
const _VI_RE_MOTCACH = new RegExp(
  `${_VI_NB}(${_VI_NOUN_TAKERS.join('|')})?(\\s*)một cách (${_VI_ADV_ADJ.join('|')})${_VI_NA}`, 'gi');
const _VI_RE_THUCHIEN = new RegExp(
  `${_VI_NB}(?:thực hiện|tiến hành) (${_VI_ACTION_NOUNS.join('|')})${_VI_NA}`, 'gi');

// Dropping a leading word must not drop the sentence's capital letter — that is
// how the old /công chúng/ rule turned "Công chúng" into "công khai".
function _viKeepCase(match, out) {
  const c = match.charAt(0);
  return (c === c.toUpperCase() && c !== c.toLowerCase())
    ? out.charAt(0).toUpperCase() + out.slice(1)
    : out;
}

function deTranslationeseVi(text) {
  if (!text || typeof text !== 'string') return text || '';
  let t = text;
  // "That means ..." rendered literally. Nobody opens a spoken sentence this way.
  t = t.replace(_VI_RE_MEANS_UPPER, 'Tức là').replace(_VI_RE_MEANS_LOWER, 'tức là');
  // "nói rằng" -> "nói là". Only after a speech verb, so no other "rằng" moves
  // and the unrelated word "ràng"/"Rằng buộc" is untouched.
  t = t.replace(_VI_RE_RANG, (m, v) => `${v} là`);
  // Adverbial "một cách X" -> bare "X", unless a noun-taking verb precedes it.
  t = t.replace(_VI_RE_MOTCACH, (m, pre, sp, adj) =>
    pre ? m : `${sp}${_viKeepCase(m.trimStart(), adj)}`);
  // "thực hiện giao dịch" -> "giao dịch".
  t = t.replace(_VI_RE_THUCHIEN, (m, n) => _viKeepCase(m, n));
  return t;
}

// In-Memory Caption History Manager
// NOTE: captionHistory key in storage is owned by popup.js / sidepanel.js.
// Background only updates _currentSession so session archives work correctly.
async function updateCaptionHistoryInStorage(originalText, translatedText) {
  try {
    const newItem = {
      id: 'cap_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      timestamp: new Date().toLocaleTimeString(),
      original: originalText.trim(),
      translated: translatedText.trim()
    };

    // Append to active session history log using storage to handle MV3 service worker dormancy
    const { _currentSession: storedSession } = await chrome.storage.local.get(['_currentSession']);
    const sessionObj = storedSession || _currentSession;
    if (sessionObj) {
      if (!sessionObj.captions) sessionObj.captions = [];
      sessionObj.captions.push({
        time: newItem.timestamp,
        original: newItem.original,
        translated: newItem.translated
      });
      // Cap stored captions: unbounded growth made every new line re-serialize
      // thousands of entries into chrome.storage.local, slowing long sessions.
      if (sessionObj.captions.length > 300) {
        sessionObj.captions = sessionObj.captions.slice(-300);
      }
      _currentSession = sessionObj;
      await chrome.storage.local.set({ _currentSession: sessionObj }).catch(() => {});
    }
  } catch (_) {}
}

// ─── 6. Speech Narration & Accents synchronization ───────────────────────


let _ttsQueue = [];
let _isProcessingTts = false;
// Bumped by clearTtsState() to orphan work already in flight; bumped per utterance
// so a late event from a superseded utterance cannot release the mutex.
let _ttsGeneration = 0;
let _ttsUtteranceId = 0;

// Cached ASR, Translation, and TTS settings
// Default 1.25x: TTS reading a translation at 1.0x takes about as long as the
// original speech itself, so it inevitably falls behind the live subtitles.
// 1.25x keeps the readout paced with the subtitle flow while staying clear.
let _cachedTtsSpeed = 1.25;
let _cachedChromeVoiceMap = {};
let _cachedTtsGender = 'female';
let _cachedTtsEnabled = false;

let _cachedTopic = 'general';
let _cachedAsrEngine = 'groq';
let _cachedOpenaiApiKey = '';
let _cachedGroqApiKey = '';
let _cachedGroqModel = 'whisper-large-v3';
let _cachedOpenaiWhisperModel = 'whisper-1';
let _cachedDeepgramApiKey = '';
let _cachedDeepgramModel = 'nova-2';

// Default Glossary Terminology definitions
const DEFAULT_GLOSSARY = {
  crypto: {
    vi: {
      postReplacements: [
        { pattern: /khu định cư/gi, replacement: 'quyết toán/thanh toán' },
        { pattern: /khí ga/gi, replacement: 'phí gas' },
        { pattern: /đồng ổn định/gi, replacement: 'stablecoin' },
        { pattern: /mạng thử nghiệm/gi, replacement: 'testnet' },
        { pattern: /mạng chính/gi, replacement: 'mainnet' },
        { pattern: /người bản địa tiền điện tử/gi, replacement: 'người thuần crypto' },
        { pattern: /người bản địa hóa crypto/gi, replacement: 'người thuần crypto' },
        { pattern: /người thuần tiền điện tử/gi, replacement: 'người thuần crypto' },
        { pattern: /hợp đồng thông minh/gi, replacement: 'smart contract' },
        { pattern: /vào cuối ngày/gi, replacement: 'chung quy lại' },
        { pattern: /cuối cùng trong ngày/gi, replacement: 'suy cho cùng' },
        { pattern: /ví máy/gi, replacement: 'ví thiết bị (machine wallet)' },
        { pattern: /thanh toán nano/gi, replacement: 'thanh toán siêu nhỏ (nanopayments)' },
        { pattern: /x[-\s]?402/gi, replacement: 'x402' },
        { pattern: /x bốn không hai|x bốn lẻ hai|x bốn trăm linh hai|x bốn trăm lẻ hai/gi, replacement: 'x402' },
        { pattern: /x[-\s]?420/gi, replacement: 'x420' },
        { pattern: /x bốn trăm hai mươi|x bốn hai không/gi, replacement: 'x420' },
        { pattern: /ngôi nhà arc|nhà arc/gi, replacement: 'Arc House' },
        { pattern: /kiến trúc sư/gi, replacement: 'Architect' },
        { pattern: /\bBIE\b|\bBRE\b|bluetooth năng lượng thấp/gi, replacement: 'BLE' },
        { pattern: /nến điện tử|e-kendo|e-central|e-cando/gi, replacement: 'eCandle' },
        { pattern: /tỷ lệ băm|tốc độ băm/gi, replacement: 'hash rate' },
        { pattern: /mã thông báo/gi, replacement: 'token' },
        { pattern: /trên chuỗi/gi, replacement: 'onchain' },
        { pattern: /dữ liệu trên chuỗi/gi, replacement: 'dữ liệu onchain' },
        { pattern: /đại lý trí tuệ nhân tạo|đại lý thông minh/gi, replacement: 'AI Agent' },
        { pattern: /tác nhân trí tuệ nhân tạo|tác nhân thông minh/gi, replacement: 'AI Agent' },
        { pattern: /các tác nhân/gi, replacement: 'agents' },
        { pattern: /các đại lý/gi, replacement: 'agents' },
        { pattern: /đại lý/gi, replacement: 'agent' },
        { pattern: /ví do nhà phát triển kiểm soát/gi, replacement: 'Developer-Controlled Wallets' },
        { pattern: /ví do người dùng kiểm soát/gi, replacement: 'User-Controlled Wallets' },
        { pattern: /ví mô-đun|ví mô đun/gi, replacement: 'Modular Wallets' },
        { pattern: /quyền riêng tư chọn tham gia|quyền riêng tư tùy chọn/gi, replacement: 'opt-in privacy' },
        { pattern: /bảo mật hậu lượng tử/gi, replacement: 'post-quantum security' },
        { pattern: /thiết kế phí ổn định/gi, replacement: 'stable fee design' },
        { pattern: /nền kinh tế đại lý|nền kinh tế tác nhân|nền kinh tế tác nhân thông minh/gi, replacement: 'Agentic Economy' },
        { pattern: /trượt giá/gi, replacement: 'trượt giá (slippage)' },
        { pattern: /khai thác lợi nhuận|canh tác lợi nhuận/gi, replacement: 'khai thác lợi nhuận (yield farming)' },
        { pattern: /nhà cung cấp thanh khoản/gi, replacement: 'nhà cung cấp thanh khoản (LP)' },
        { pattern: /tổn thất tạm thời|tổn thất vô thường/gi, replacement: 'tổn thất vô thường (impermanent loss)' },
        { pattern: /tổng giá trị bị khóa|tổng giá trị khóa/gi, replacement: 'tổng giá trị khóa (TVL)' },
        { pattern: /đúc tiền/gi, replacement: 'đúc (mint)' },
        { pattern: /đốt tiền|đốt mã thông báo/gi, replacement: 'đốt (burn)' },
        { pattern: /đặt cược|khóa mã thông báo/gi, replacement: 'staking (khóa)' },
        { pattern: /mở khóa đặt cược|ngừng đặt cược/gi, replacement: 'unstaking (mở khóa)' },
        { pattern: /tác nhân tự trị/gi, replacement: 'tác nhân tự trị (autonomous agent)' },
        { pattern: /khung tác nhân/gi, replacement: 'khung tác nhân (agentic framework)' },
        { pattern: /trí tuệ bầy đàn/gi, replacement: 'trí tuệ bầy đàn (swarm intelligence)' },
        { pattern: /sổ đăng ký tác nhân/gi, replacement: 'sổ đăng ký tác nhân (agent registry)' },
        { pattern: /chi phí suy luận/gi, replacement: 'chi phí suy luận (inference cost)' }
      ],
      terms: {
        "Arc": "Arc",
        "Circle": "Circle",
        "USDC": "USDC",
        "EURC": "EURC",
        "USYC": "USYC",
        "CCTP": "CCTP",
        "App Kit": "App Kit",
        "Bridge Kit": "Bridge Kit",
        "Swap Kit": "Swap Kit",
        "Unified Balance": "Unified Balance",
        "ArcaneVM": "ArcaneVM",
        "Malachite": "Malachite",
        "Malachite BFT": "Malachite BFT",
        "Tendermint BFT": "Tendermint BFT",
        "Reth": "Reth",
        "EVM": "EVM",
        "Layer-1": "Layer-1",
        "JSON-RPC": "JSON-RPC",
        "RPC": "RPC",
        "EIP-1559": "EIP-1559",
        "EWMA": "EWMA",
        "Chain ID 5042002": "Chain ID 5042002",
        "Viem": "Viem",
        "Ethers": "Ethers",
        "Hardhat": "Hardhat",
        "Foundry": "Foundry",
        "Solidity": "Solidity",
        "ERC-20": "ERC-20",
        "ERC-8004": "ERC-8004",
        "ERC-8183": "ERC-8183",
        "MCP": "MCP",
        "Model Context Protocol": "Model Context Protocol",
        "AI Agent": "AI Agent",
        "testnet": "testnet",
        "mainnet": "mainnet",
        "Arcscan": "Arcscan",
        "docs.arc.io": "docs.arc.io",
        "nanopayments": "nanopayments",
        "stablecoin": "stablecoin",
        "onchain": "onchain",
        "Developer-Controlled Wallets": "Developer-Controlled Wallets",
        "User-Controlled Wallets": "User-Controlled Wallets",
        "Modular Wallets": "Modular Wallets"
      }
    },
    // English target: minimal no-op layer — fix common mistranslations back to
    // standard English forms (Google Translate occasionally produces these)
    en: {
      postReplacements: [
        { pattern: /stable\s+coin\b/gi, replacement: 'stablecoin' },
        { pattern: /ERC\s?20\b/gi, replacement: 'ERC-20' },
        { pattern: /sub\s+second\b/gi, replacement: 'sub-second' },
        { pattern: /\bon[- ]chain\b/gi, replacement: 'onchain' },
        { pattern: /\boff[- ]chain\b/gi, replacement: 'offchain' },
        { pattern: /\btest\s+net\b/gi, replacement: 'testnet' },
        { pattern: /\bmain\s+net\b/gi, replacement: 'mainnet' },
        { pattern: /\bblock\s+chain\b/gi, replacement: 'blockchain' },
        { pattern: /\be\s*candle\b/gi, replacement: 'eCandle' }
      ]
    }
  },
  tech: {
    vi: {
      postReplacements: [
        { pattern: /giao diện/gi, replacement: 'UI/UX' },
        { pattern: /máy chủ/gi, replacement: 'server' },
        { pattern: /giao thức/gi, replacement: 'giao thức (protocol)' },
        { pattern: /cơ sở dữ liệu/gi, replacement: 'database' }
      ],
      terms: {
        "user interface": "UI/UX",
        "server": "server",
        "protocol": "giao thức (protocol)",
        "database": "database"
      }
    },
    en: {
      postReplacements: [
        { pattern: /\bdata\s+base\b/gi, replacement: 'database' },
        { pattern: /\buser\s+interface\b/gi, replacement: 'UI' }
      ]
    }
  },
  business: {
    vi: {
      postReplacements: [
        { pattern: /tỷ lệ hội thoại/gi, replacement: 'tỷ lệ chuyển đổi (conversion rate)' },
        { pattern: /điểm đau/gi, replacement: 'điểm nghẽn (pain point)' },
        { pattern: /điểm thanh toán chính/gi, replacement: 'điểm nghẽn chính (pain point)' },
        { pattern: /điểm đau chính/gi, replacement: 'điểm nghẽn chính (pain point)' },
        { pattern: /phần mềm dịch vụ/gi, replacement: 'phần mềm SaaS' },
        { pattern: /cổ phần/gi, replacement: 'cổ phần (equity)' }
      ],
      terms: {
        "conversion rate": "tỷ lệ chuyển đổi (conversion rate)",
        "pain point": "điểm nghẽn (pain point)",
        "SaaS": "phần mềm SaaS",
        "equity": "cổ phần (equity)"
      }
    }
  },
  general: {
    vi: {
      postReplacements: [
        // getGlossary merges `general` FIRST for every topic, so nothing in here
        // may rewrite a register the live prompt deliberately chose.
        //
        // Two systematic bugs used to live in this block, asymmetric in the worst
        // possible direction. JS \b is ASCII-only, so a rule ending in a diacritic
        // ("quý vị", "anh chị") never fired at all — /\bquý vị\b/.test("Chào quý vị.")
        // is false — while a rule ending in an ASCII letter ("anh em", "chúng mình")
        // fired every time and undid the register. Use explicit Unicode-letter
        // lookarounds instead, and keep the longest pattern first so
        // "quý vị và các bạn" does not become "các bạn và các bạn".
        { pattern: /(?<![a-zA-ZÀ-ỹ])anh\s*[\/\-]\s*chị(?![a-zA-ZÀ-ỹ])/gi, replacement: 'bạn' },
        { pattern: /(?<![a-zA-ZÀ-ỹ])anh chị(?![a-zA-ZÀ-ỹ])/gi, replacement: 'bạn' },
        { pattern: /(?<![a-zA-ZÀ-ỹ])quý vị và các bạn(?![a-zA-ZÀ-ỹ])/gi, replacement: 'các bạn' },
        { pattern: /(?<![a-zA-ZÀ-ỹ])quý vị(?![a-zA-ZÀ-ỹ])/gi, replacement: 'các bạn' },
        { pattern: /(?<![a-zA-ZÀ-ỹ])anh em chúng ta(?![a-zA-ZÀ-ỹ])/gi, replacement: 'chúng ta' }
        // REMOVED /vòng cung/ -> 'Arc'          : unguarded; polishLiveTranslation already
        //                                         does this guarded by `original && /\barc\b/i`.
        //                                         Unguarded it broke "sút vòng cung" on sports streams.
        // REMOVED /công chúng/ -> 'công khai'    : noun -> adjective, ungrammatical
        //                                         ("trước công chúng" -> "trước công khai").
        // REMOVED /\banh em\b/ -> 'các bạn'      : undid the register the prompt spends ~900
        //                                         chars establishing, including its own ✓ few-shot
        //                                         example ("Anh em xem tiếp nha" -> "các bạn ...").
        // REMOVED /\bchúng mình\b/ -> 'chúng tôi': forced the exact stiff pronoun the register
        //                                         rule tells the model to avoid.
      ],
      terms: {
        "you": "mọi người/các bạn",
        "we": "mình/tụi mình/chúng ta"
      },
      phoneticReplacements: [
        { pattern: /bitcoin/gi, replacement: 'bít coi' },
        { pattern: /bitcoins/gi, replacement: 'bít coi' },
        { pattern: /btc/gi, replacement: 'bê tê cê' },
        { pattern: /ethereum/gi, replacement: 'ê-thê-ri-um' },
        { pattern: /eth/gi, replacement: 'ê thê' },
        { pattern: /solana/gi, replacement: 'xô la na' },
        { pattern: /sol/gi, replacement: 'xôn' },
        { pattern: /usdt/gi, replacement: 'u ét đê tê' },
        { pattern: /usdc/gi, replacement: 'u ét đê cê' },
        { pattern: /binance/gi, replacement: 'bai nét' },
        { pattern: /bnb/gi, replacement: 'bê en bê' },
        { pattern: /crypto/gi, replacement: 'cờ ríp tô' },
        { pattern: /blockchain/gi, replacement: 'blốc chein' },
        { pattern: /blockchains/gi, replacement: 'blốc chein' },
        { pattern: /web3/gi, replacement: 'web ba' },
        { pattern: /web 3/gi, replacement: 'web ba' },
        { pattern: /testnet/gi, replacement: 'tét nét' },
        { pattern: /mainnet/gi, replacement: 'mên nét' },
        { pattern: /gas fee/gi, replacement: 'phí gas' },
        { pattern: /gas fees/gi, replacement: 'phí gas' },
        // "ui" and "ai" are ordinary Vietnamese words ("vui", "ai cũng vậy"), so a
        // word boundary alone cannot save them — these two must be case-sensitive.
        // ASR and the LLM both write acronyms in caps, so nothing is lost.
        // Longest first: /ux/ used to consume "UX/UI" before the pair rule saw it.
        { pattern: /UX\/UI/g, replacement: 'u ích u ai' },
        { pattern: /ux/gi, replacement: 'u ích' },
        { pattern: /UI/g, replacement: 'u ai' },
        { pattern: /iot/gi, replacement: 'ai ô ti' },
        { pattern: /AI/g, replacement: 'ê ai' },
        { pattern: /api/gi, replacement: 'ê pi ai' },
        { pattern: /arc/gi, replacement: 'ác' },
        { pattern: /arc testnet/gi, replacement: 'ác tét nét' },
        { pattern: /arc testnets/gi, replacement: 'ác tét nét' },
        { pattern: /arc agent/gi, replacement: 'ác ê chần' },
        { pattern: /arc agents/gi, replacement: 'ác ê chần' },
        { pattern: /arc sdk/gi, replacement: 'ác ét đi cây' },
        { pattern: /docs\.arc\.io/gi, replacement: 'đốc chấm ác chấm ai ô' },
        { pattern: /ai agent/gi, replacement: 'ê ai ê chần' },
        { pattern: /ai agents/gi, replacement: 'ê ai ê chần' },
        { pattern: /agent/gi, replacement: 'ê chần' },
        { pattern: /agents/gi, replacement: 'ê chần' },
        { pattern: /sdk/gi, replacement: 'ét đi cây' },
        { pattern: /sdks/gi, replacement: 'ét đi cây' },
        { pattern: /circle/gi, replacement: 'sơ cồ' },
        { pattern: /tlay/gi, replacement: 'ti-lay' },
        { pattern: /usd/gi, replacement: 'u ét đê' },
        { pattern: /on-chain/gi, replacement: 'on chein' },
        { pattern: /onchain/gi, replacement: 'on chein' },
        { pattern: /tvl/gi, replacement: 'ti vi eo' },
        { pattern: /mev/gi, replacement: 'em e vi' },
        { pattern: /mev bot/gi, replacement: 'em e vi bót' },
        { pattern: /mev bots/gi, replacement: 'em e vi bót' },
        { pattern: /amm/gi, replacement: 'ê em em' },
        { pattern: /clmm/gi, replacement: 'xi el em em' },
        { pattern: /zk-ml/gi, replacement: 'di cây em el' },
        { pattern: /zkml/gi, replacement: 'di cây em el' },
        { pattern: /slippage/gi, replacement: 'sờ líp pịch' },
        { pattern: /gwei/gi, replacement: 'gờ-oai' },
        { pattern: /gas war/gi, replacement: 'gát oai' },
        { pattern: /gas wars/gi, replacement: 'gát oai' },
        { pattern: /yield/gi, replacement: 'diu' },
        { pattern: /farming/gi, replacement: 'pha minh' },
        { pattern: /frontrun/gi, replacement: 'phờ rần răn' },
        { pattern: /frontruns/gi, replacement: 'phờ rần răn' },
        { pattern: /dapp/gi, replacement: 'đi áp' },
        { pattern: /dapps/gi, replacement: 'đi áp' },
        { pattern: /smart contract/gi, replacement: 'sờ-mạt con-trắc' },
        { pattern: /smart contracts/gi, replacement: 'sờ-mạt con-trắc' },
        { pattern: /token/gi, replacement: 'tô kừn' },
        { pattern: /tokens/gi, replacement: 'tô kừn' },
        { pattern: /wallet/gi, replacement: 'oai lịt' },
        { pattern: /wallets/gi, replacement: 'oai lịt' },
        { pattern: /nanopayments/gi, replacement: 'na-nô pei mừn' },
        { pattern: /machine/gi, replacement: 'mơ shin' },
        { pattern: /machine-to-machine/gi, replacement: 'ma-shin tu ma-shin' },
        { pattern: /m2m/gi, replacement: 'em hai em' },
        { pattern: /ble/gi, replacement: 'bi eo i' },
        { pattern: /bxc/gi, replacement: 'bi ích xi' },
        { pattern: /vre/gi, replacement: 'vi ar i' },
        { pattern: /e-candle/gi, replacement: 'i can-đồ' },
        { pattern: /gateway/gi, replacement: 'gết-uây' },
        { pattern: /gateways/gi, replacement: 'gết-uây' },
        { pattern: /pain point/gi, replacement: 'pein poin' },
        { pattern: /pain points/gi, replacement: 'pein poin' },
        { pattern: /settlement/gi, replacement: 'xét-tồ-mần' },
        { pattern: /settlements/gi, replacement: 'xét-tồ-mần' }
      ]
    }
  }
};

// Precompile regex rules for static performance optimization
function precompileGlossaryRegexes(glossary) {
  for (const topic in glossary) {
    for (const lang in glossary[topic]) {
      const langData = glossary[topic][lang];
      if (langData.postReplacements) {
        langData.postReplacements.forEach(rule => {
          if (rule.pattern instanceof RegExp) {
            rule.regex = rule.pattern;
          } else {
            rule.regex = new RegExp(escapeRegexLiteral(rule.pattern), 'gi');
          }
        });
      }
      if (langData.phoneticReplacements) {
        // Phonetic rules target English tokens embedded in Vietnamese text, so
        // every one of them needs a word boundary. The RegExp branch used to
        // pass the literal through unanchored, and the rules run in sequence on
        // each other's output: /ui/ turned "vui" into "vu ai", then /ai/ rewrote
        // that into "vu ê ai" ("vui vẻ" -> "vu ê ai vẻ"). It also corrupted the
        // glossary's own correct output — "UI" became "u ê ai" instead of "u ai".
        // JS \b is ASCII-only and every source here is a Latin token, so guard
        // with explicit ASCII-letter lookarounds instead.
        langData.phoneticReplacements.forEach(rule => {
          if (rule.pattern instanceof RegExp) {
            const src = rule.pattern.source;
            const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g';
            rule.regex = new RegExp('(?<![A-Za-z0-9])(?:' + src + ')(?![A-Za-z0-9])', flags);
          } else {
            rule.regex = new RegExp('\\b' + escapeRegexLiteral(rule.pattern) + '\\b', 'gi');
          }
        });
      }
    }
  }
}

// Precompile default glossary on script load
precompileGlossaryRegexes(DEFAULT_GLOSSARY);

// Short-TTL cache: getGlossary used to hit chrome.storage.local on EVERY
// subtitle polish and EVERY TTS utterance — measurable per-line latency.
const _glossaryCacheMap = new Map();

async function getGlossary(topic, lang) {
  const cacheKey = topic + '|' + lang;
  const cached = _glossaryCacheMap.get(cacheKey);
  if (cached && (Date.now() - cached.t) < 30000) return cached.g;
  const { customGlossary } = await chrome.storage.local.get(['customGlossary']);
  const glossary = {};

  const generalDefault = DEFAULT_GLOSSARY['general']?.[lang] || {};
  const generalCustom = customGlossary?.['general']?.[lang] || {};

  const topicDefault = DEFAULT_GLOSSARY[topic]?.[lang] || {};
  const topicCustom = customGlossary?.[topic]?.[lang] || {};

  glossary.terms = {
    ...(generalDefault.terms || {}),
    ...(generalCustom.terms || {}),
    ...(topicDefault.terms || {}),
    ...(topicCustom.terms || {})
  };

  glossary.postReplacements = [
    ...(generalDefault.postReplacements || []),
    ...(generalCustom.postReplacements || []),
    ...(topicDefault.postReplacements || []),
    ...(topicCustom.postReplacements || [])
  ];

  glossary.phoneticReplacements = [
    ...(generalDefault.phoneticReplacements || []),
    ...(generalCustom.phoneticReplacements || []),
    ...(topicDefault.phoneticReplacements || []),
    ...(topicCustom.phoneticReplacements || [])
  ];

  _glossaryCacheMap.set(cacheKey, { g: glossary, t: Date.now() });
  return glossary;
}

// One-shot initialization of the ASR, Translation, and TTS settings cache from storage.
async function initSettingsCache() {
  try {
    const [localRes, syncRes] = await Promise.all([
      chrome.storage.local.get([
        'ltTtsSpeed', 'ltTtsChromeVoiceMap', 'ltTtsGender', 'ltTtsEnabled',
        'ltTopic'
      ]),
      chrome.storage.sync.get([
        'ltTtsChromeVoiceMap', 'ltAsrEngine', 'openaiApiKey', 'groqApiKey', 'groqModel', 'openaiWhisperModel',
        'deepgramApiKey', 'deepgramModel'
      ])
    ]);
    if (localRes.ltTtsSpeed !== undefined) _cachedTtsSpeed = parseFloat(localRes.ltTtsSpeed);
    _cachedChromeVoiceMap = Object.assign({}, syncRes.ltTtsChromeVoiceMap || {}, localRes.ltTtsChromeVoiceMap || {});
    _cachedTtsGender = localRes.ltTtsGender || 'female';
    _cachedTtsEnabled = !!localRes.ltTtsEnabled;

    _cachedTopic = localRes.ltTopic || 'general';

    _cachedAsrEngine = syncRes.ltAsrEngine || 'groq';
    _cachedOpenaiApiKey = syncRes.openaiApiKey || '';
    _cachedGroqApiKey = syncRes.groqApiKey || '';
    _cachedGroqModel = syncRes.groqModel || 'whisper-large-v3';
    _cachedOpenaiWhisperModel = syncRes.openaiWhisperModel || 'whisper-1';
    _cachedDeepgramApiKey = syncRes.deepgramApiKey || '';
    _cachedDeepgramModel = syncRes.deepgramModel || 'nova-2';

    console.log('🎙️ [BG] Settings cache initialized:', {
      speed: _cachedTtsSpeed, gender: _cachedTtsGender, enabled: _cachedTtsEnabled,
      topic: _cachedTopic,
      asrEngine: _cachedAsrEngine
    });
  } catch (err) {
    console.warn('⚠️ [BG] initSettingsCache failed:', err);
  }
}

// Real-time storage listener — keeps the in-memory cache fresh without polling.
chrome.storage.onChanged.addListener((changes, areaName) => {
  const syncMap = {
    ltAsrEngine: (v) => { _cachedAsrEngine = v; },
    openaiApiKey: (v) => { _cachedOpenaiApiKey = v; },
    groqApiKey: (v) => { _cachedGroqApiKey = v; },
    groqModel: (v) => { _cachedGroqModel = v; },
    openaiWhisperModel: (v) => { _cachedOpenaiWhisperModel = v; },
    deepgramApiKey: (v) => { _cachedDeepgramApiKey = v; },
    deepgramModel: (v) => { _cachedDeepgramModel = v; }
  };
  const localMap = {
    ltTtsSpeed:   (v) => { _cachedTtsSpeed = parseFloat(v); },
    ltTtsGender:  (v) => { _cachedTtsGender = v; },
    ltTtsEnabled: (v) => { _cachedTtsEnabled = !!v; },
    ltTopic:      (v) => { _cachedTopic = v; }
  };

  for (const [key, change] of Object.entries(changes)) {
    if (areaName === 'sync' && syncMap[key] && change.newValue !== undefined) {
      syncMap[key](change.newValue);
    }
    if (areaName === 'local' && localMap[key] && change.newValue !== undefined) {
      localMap[key](change.newValue);
    }
    if (key === 'ltTtsChromeVoiceMap' && change.newValue) {
      Object.assign(_cachedChromeVoiceMap, change.newValue);
    }
  }
});

// Initialize settings cache
initSettingsCache();

function clearTtsState() {
  try {
    // Invalidate everything already in flight. _processNextTTS yields twice
    // (getGlossary, getVoices); without these bumps a task that was mid-yield when
    // the user pressed Stop would come back and speak one more line into silence.
    _ttsGeneration++;
    _ttsUtteranceId++;
    _ttsQueue = [];
    _isProcessingTts = false;
    chrome.tts.stop();
  } catch (_) {}
}

const _ttsLangMap = {
  'vi': 'vi-VN',
  'en': 'en-US',
  'zh': 'zh-CN',
  'ja': 'ja-JP',
  'ko': 'ko-KR',
  'fr': 'fr-FR',
  'es': 'es-ES',
  'de': 'de-DE',
  'ru': 'ru-RU',
  'th': 'th-TH',
  'id': 'id-ID',
  'pt': 'pt-PT',
  'it': 'it-IT',
  'tr': 'tr-TR',
  'ar': 'ar-SA',
  'nl': 'nl-NL',
  'tl': 'fil-PH',
  'pl': 'pl-PL',
  'hi': 'hi-IN',
  'bn': 'bn-BD',
  'ur': 'ur-PK',
  'ms': 'ms-MY',
  'fa': 'fa-IR',
  'sw': 'sw-KE',
  'uk': 'uk-UA',
  'ro': 'ro-RO',
  'el': 'el-GR',
  'he': 'he-IL',
  'sv': 'sv-SE',
  'da': 'da-DK',
  'no': 'no-NO',
  'fi': 'fi-FI',
  'cs': 'cs-CZ',
  'hu': 'hu-HU',
  'sk': 'sk-SK',
  'bg': 'bg-BG',
  'hr': 'hr-HR',
  'sr': 'sr-RS',
  'ka': 'ka-GE',
  'az': 'az-AZ',
  'kk': 'kk-KZ',
  'mn': 'mn-MN'
};

function normalizeTtsLang(langCode) {
  if (!langCode) return 'vi-VN';
  const clean = langCode.trim();
  // Check if it already matches a standard xx-XX pattern
  if (/^[a-zA-Z]{2,3}-[a-zA-Z]{2,4}$/.test(clean)) {
    return clean;
  }
  const low = clean.toLowerCase();
  if (_ttsLangMap[low]) {
    return _ttsLangMap[low];
  }
  const primary = low.split('-')[0];
  return _ttsLangMap[primary] || 'vi-VN';
}

function getBestChromeVoice(voices, targetLang, targetGender) {
  if (!voices || voices.length === 0) return null;
  const prefix = targetLang.split('-')[0].toLowerCase();
  
  // 1. First pass: try to find a perfect match for both language prefix, gender, and name containing 'google'
  let matchedVoice = voices.find(v => {
    if (!v.lang || !v.voiceName) return false;
    const vPrefix = v.lang.split('-')[0].toLowerCase();
    const vName = v.voiceName.toLowerCase();
    return vPrefix === prefix && v.gender === targetGender && vName.includes('google');
  });
  
  // 2. Second pass: try to match by language prefix and name containing 'google' (ignoring gender)
  if (!matchedVoice) {
    matchedVoice = voices.find(v => {
      if (!v.lang || !v.voiceName) return false;
      const vPrefix = v.lang.split('-')[0].toLowerCase();
      const vName = v.voiceName.toLowerCase();
      return vPrefix === prefix && vName.includes('google');
    });
  }

  // 3. Third pass: try to find a match for both language prefix and gender (any engine)
  if (!matchedVoice) {
    matchedVoice = voices.find(v => {
      if (!v.lang) return false;
      const vPrefix = v.lang.split('-')[0].toLowerCase();
      return vPrefix === prefix && v.gender === targetGender;
    });
  }
  
  // 4. Fourth pass: if no match, try to match by language prefix only (ignoring gender)
  if (!matchedVoice) {
    matchedVoice = voices.find(v => {
      if (!v.lang) return false;
      const vPrefix = v.lang.split('-')[0].toLowerCase();
      return vPrefix === prefix;
    });
  }
  
  return matchedVoice ? matchedVoice.voiceName : null;
}

/**
 * Compute an adaptive playback speed based on how many items are backed up in
 * the TTS queue. Each queued item adds +0.15x, capped at +0.6x above the user's
 * base speed and at 1.6x absolute, to keep the audio intelligible.
 */
function getAdaptiveSpeed(baseSpeed, queueLength) {
  // Stronger catch-up than before (0.12/item, cap +0.5): subtitles now render
  // faster, so the readout must accelerate harder when it starts lagging or
  // the backpressure dropper will discard content instead.
  const bump = Math.min(queueLength * 0.15, 0.6);
  // Ceiling is 1.6, not 1.9: past ~1.6x the tone contours that carry meaning in
  // Vietnamese (and other tonal targets) smear together and the readout stops
  // being understandable, which defeats the point of catching up at all.
  return Math.min(baseSpeed + bump, 1.6);
}

async function speakSubtitle(text, langCode, speed, originalText, segmentId, sequenceNumber) {
  if (!text) return;

  // Push subtitle text chunk to speech queue (bake in resolved speed and sequence number)
  _ttsQueue.push({ text, langCode, speed: speed || _cachedTtsSpeed, originalText, segmentId, sequenceNumber });

  // TTS Backpressure: instead of hard-dropping at >3, use adaptive speed to
  // catch up gradually. Only drop when the queue is critically full (>8 items)
  // to prevent unbounded audio latency while losing as little content as possible.
  if (_ttsQueue.length > 8) {
    const dropCount = _ttsQueue.length - 5;
    console.warn(`⚠️ [BG] TTS Queue critical backpressure: dropping ${dropCount} oldest items (queue was ${_ttsQueue.length}). Keep head + last 4.`);
    _ttsQueue = [_ttsQueue[0], ..._ttsQueue.slice(-4)];
  }

  // Trigger speech engine
  _processNextTTS();
}

async function _processNextTTS() {
  if (_ttsQueue.length === 0 || _isProcessingTts) return;
  _isProcessingTts = true;

  const myGen = _ttsGeneration;
  const currentTask = _ttsQueue.shift();
  try {
  const normalizedLang = normalizeTtsLang(currentTask.langCode);

  // Adaptive speed: base speed from task setting + bump proportional to queue backlog
  const baseSpeed = currentTask.speed !== undefined ? currentTask.speed : _cachedTtsSpeed;
  let targetSpeed = getAdaptiveSpeed(baseSpeed, _ttsQueue.length);

  let rawSpeechText = currentTask.text;

  console.log(`🎙️ [BG] Speaking: "${rawSpeechText}" | Lang: ${normalizedLang} | Speed: ${targetSpeed}x | Queue remaining: ${_ttsQueue.length}`);

  // Fetch glossary to apply dynamic phonetic corrections
  const activeTopic = _cachedTopic;
  const glossary = await getGlossary(activeTopic, currentTask.langCode);

  // The await above is the one yield point between taking the mutex and speaking.
  // If the session was stopped meanwhile, release rather than speak a stale line.
  if (myGen !== _ttsGeneration) { _isProcessingTts = false; return; }

  const initiateSpeech = (text, lang, rate, isFallback = false) => {
    // Apply phonetic corrections only for Chrome TTS fallback since its engine cannot read mixed English
    let speakText = text;
    if (lang && lang.startsWith('vi')) {
      speakText = phoneticCorrectVietnameseTts(speakText, glossary);
    }

    const speakWithVoice = (voiceName = null) => {
      // Identify this specific utterance. Without a token, any late event from an
      // utterance that was already superseded released the mutex for the one
      // currently speaking, and chrome.tts.speak defaults to enqueue:false — so
      // the next line interrupted the current one, whose 'interrupted' event
      // released the mutex again. One overrun left the queue permanently
      // free-running, which also pinned _ttsQueue.length at 0 and thereby
      // silently disabled the getAdaptiveSpeed catch-up below.
      const myUtt = ++_ttsUtteranceId;
      const isStale = () => myGen !== _ttsGeneration || myUtt !== _ttsUtteranceId;

      const release = () => {
        if (isStale()) return;
        clearTimeout(safetyTimeout);
        _isProcessingTts = false;
        setTimeout(_processNextTTS, 50);
      };

      // Size the guard to the utterance instead of a flat 10s. A long accumulated
      // sentence (~250 Vietnamese chars) runs past 10s at 1.25x, and the old timer
      // fired mid-speech. Stop the engine before releasing so we never speak two
      // lines at once.
      const guardMs = Math.min(45000, Math.max(10000, (speakText.length / (20.6 * (rate || 1))) * 1000 * 2 + 4000));
      let safetyTimeout = setTimeout(() => {
        if (isStale()) return;
        console.warn(`⚠️ [BG] TTS safety timeout (${Math.round(guardMs)}ms) reached. Unlocking queue.`);
        try { chrome.tts.stop(); } catch (_) {}
        _ttsUtteranceId++;
        _isProcessingTts = false;
        _processNextTTS();
      }, guardMs);

      // Tell the overlay when this line actually starts and stops being spoken.
      // This is the sync channel: the display had no way to know, so it paced
      // captions off character count while the readout paced off the voice engine,
      // and the two drifted apart. Only start/end — many engines (Google's network
      // voices among them) never emit word/charIndex, so anything finer would work
      // on some machines and silently not on others.
      const notifySync = (phase) => {
        if (isStale() && phase !== 'end') return;
        try {
          if (activeTabId) {
            chrome.tabs.sendMessage(activeTabId, {
              action: 'lt_tts_sync',
              phase,
              sequenceNumber: currentTask.sequenceNumber,
              chars: speakText.length,
              rate,
              ts: Date.now()
            }).catch(() => {});
          }
        } catch (_) {}
      };

      const options = {
        rate: rate,
        onEvent: (event) => {
          if (event.type === 'start') {
            notifySync('start');
            return;
          }
          if (event.type === 'end' || event.type === 'interrupted' || event.type === 'cancelled' || event.type === 'error') {
            notifySync('end');
            release();
          }
        }
      };

      if (!isFallback) {
        if (voiceName) {
          options.voiceName = voiceName;
          console.log(`🎙️ [BG] Chrome TTS selected voiceName: ${voiceName}`);
        } else if (lang) {
          options.lang = lang;
        }
      }

      chrome.tts.speak(speakText, options, () => {
        if (chrome.runtime.lastError) {
          console.warn('❌ [BG] chrome.tts.speak failed:', chrome.runtime.lastError.message);
          clearTimeout(safetyTimeout);
          if (!isFallback) {
            console.log('🔄 [BG] Retrying speech with fallback default voice...');
            initiateSpeech(text, null, rate, true);
          } else {
            release();
          }
        } else {
          console.log('✅ [BG] chrome.tts.speak initiated successfully');
        }
      });
    };

    if (!isFallback && lang) {
      chrome.tts.getVoices(async (voices) => {
        // This callback runs on a later tick, so the try/catch around the function
        // body cannot cover it — throwing here would strand the mutex forever.
        try {
          let voiceName = null;
          try {
            // 1. Try to load user-selected specific voice for this target language
            // Support lookup via both full normalized code and base prefix fallback
            const selectedVoiceName = _cachedChromeVoiceMap[lang] || _cachedChromeVoiceMap[lang.split('-')[0]];

            if (selectedVoiceName && (voices || []).some(v => v.voiceName === selectedVoiceName)) {
              voiceName = selectedVoiceName;
              console.log(`🎙️ [BG] Using user-selected System Voice: ${voiceName}`);
            } else {
              // 2. Fallback to gender matching (which also prioritizes Google voices)
              voiceName = getBestChromeVoice(voices, lang, _cachedTtsGender);
              console.log(`🎙️ [BG] Fallback to Best Match Voice: ${voiceName} (Gender: ${_cachedTtsGender})`);
            }
          } catch (err) {
            console.warn('⚠️ [BG] Error getting chrome voice details:', err);
          }
          // Stop() during the getVoices round-trip: do not start a stale utterance.
          if (myGen !== _ttsGeneration) { _isProcessingTts = false; return; }
          speakWithVoice(voiceName);
        } catch (err) {
          console.error('❌ [BG] TTS voice callback threw — releasing queue lock:', err);
          _isProcessingTts = false;
          setTimeout(_processNextTTS, 50);
        }
      });
    } else {
      speakWithVoice(null);
    }
  };

  initiateSpeech(rawSpeechText, normalizedLang, targetSpeed);
  } catch (err) {
    // Anything thrown between taking the mutex and handing off to chrome.tts
    // (getGlossary rejecting, for instance) used to leave _isProcessingTts true
    // forever: the voice went silent for the rest of the session and the queue
    // filled up until it started dropping lines.
    console.error('❌ [BG] _processNextTTS threw — releasing queue lock:', err);
    _isProcessingTts = false;
    setTimeout(_processNextTTS, 50);
  }
}

function phoneticCorrectVietnameseTts(text, glossary) {
  if (!text) return '';
  let corrected = text;

  // Apply dynamic glossary phonetic replacements
  if (glossary && glossary.phoneticReplacements) {
    glossary.phoneticReplacements.forEach(rule => {
      if (rule.regex) {
        corrected = corrected.replace(rule.regex, rule.replacement);
      } else if (rule.pattern instanceof RegExp) {
        corrected = corrected.replace(rule.pattern, rule.replacement);
      } else {
        corrected = corrected.replace(new RegExp('\\b' + escapeRegexLiteral(rule.pattern) + '\\b', 'gi'), rule.replacement);
      }
    });
  }

  // Fallback / legacy static phonetic corrections
  const ttsCorrections = [
    { pattern: /\bbitcoin\b/gi, replacement: 'bít coi' },
    { pattern: /\bbitcoins\b/gi, replacement: 'bít coi' },
    { pattern: /\bbtc\b/gi, replacement: 'bê tê cê' },
    { pattern: /\bethereum\b/gi, replacement: 'ê-thê-ri-um' },
    { pattern: /\beth\b/gi, replacement: 'ê thê' },
    { pattern: /\bsolana\b/gi, replacement: 'xô la na' },
    { pattern: /\bsol\b/gi, replacement: 'xôn' },
    { pattern: /\busdt\b/gi, replacement: 'u ét đê tê' },
    { pattern: /\busdc\b/gi, replacement: 'u ét đê cê' },
    { pattern: /\bbinance\b/gi, replacement: 'bai nét' },
    { pattern: /\bbnb\b/gi, replacement: 'bê en bê' },
    { pattern: /\bcrypto\b/gi, replacement: 'cờ ríp tô' },
    { pattern: /\bblockchain\b/gi, replacement: 'blốc chein' },
    { pattern: /\bblockchains\b/gi, replacement: 'blốc chein' },
    { pattern: /\bweb3\b/gi, replacement: 'web ba' },
    { pattern: /\bweb 3\b/gi, replacement: 'web ba' },
    { pattern: /\btestnet\b/gi, replacement: 'tét nét' },
    { pattern: /\bmainnet\b/gi, replacement: 'mên nét' },
    { pattern: /\bgas fee\b/gi, replacement: 'phí gas' },
    { pattern: /\bgas fees\b/gi, replacement: 'phí gas' },
    // Case-sensitive, same reason as the glossary table above: \b does not stop
    // /\bai\b/ from eating the Vietnamese word "ai" ("ai cũng vậy" -> "ê ai cũng vậy").
    { pattern: /\bUX\/UI\b/g, replacement: 'u ích u ai' },
    { pattern: /\bux\b/gi, replacement: 'u ích' },
    { pattern: /\bUI\b/g, replacement: 'u ai' },
    { pattern: /\biot\b/gi, replacement: 'ai ô ti' },
    { pattern: /\bAI\b/g, replacement: 'ê ai' },
    { pattern: /\bapi\b/gi, replacement: 'ê pi ai' },
    { pattern: /\barc\b/gi, replacement: 'ác' },
    { pattern: /\barc testnet\b/gi, replacement: 'ác tét nét' },
    { pattern: /\barc testnets\b/gi, replacement: 'ác tét nét' },
    { pattern: /\barc agent\b/gi, replacement: 'ác ê chần' },
    { pattern: /\barc agents\b/gi, replacement: 'ác ê chần' },
    { pattern: /\barc sdk\b/gi, replacement: 'ác ét đi cây' },
    { pattern: /\bdocs\.arc\.io\b/gi, replacement: 'đốc chấm ác chấm ai ô' },
    { pattern: /\bai agent\b/gi, replacement: 'ê ai ê chần' },
    { pattern: /\bai agents\b/gi, replacement: 'ê ai ê chần' },
    { pattern: /\bagent\b/gi, replacement: 'ê chần' },
    { pattern: /\bagents\b/gi, replacement: 'ê chần' },
    { pattern: /\bsdk\b/gi, replacement: 'ét đi cây' },
    { pattern: /\bsdks\b/gi, replacement: 'ét đi cây' },
    { pattern: /\bcircle\b/gi, replacement: 'sơ cồ' },
    { pattern: /\btlay\b/gi, replacement: 'ti-lay' },
    { pattern: /\busd\b/gi, replacement: 'u ét đê' },
    { pattern: /\bon-chain\b/gi, replacement: 'on chein' },
    { pattern: /\bonchain\b/gi, replacement: 'on chein' },
    { pattern: /\btvl\b/gi, replacement: 'ti vi eo' },
    { pattern: /\bmev\b/gi, replacement: 'em e vi' },
    { pattern: /\bmev bot\b/gi, replacement: 'em e vi bót' },
    { pattern: /\bmev bots\b/gi, replacement: 'em e vi bót' },
    { pattern: /\bamm\b/gi, replacement: 'ê em em' },
    { pattern: /\bclmm\b/gi, replacement: 'xi el em em' },
    { pattern: /\bzk-ml\b/gi, replacement: 'di cây em el' },
    { pattern: /\bzkml\b/gi, replacement: 'di cây em el' },
    { pattern: /\bslippage\b/gi, replacement: 'sờ líp pịch' },
    { pattern: /\bgwei\b/gi, replacement: 'gờ-oai' },
    { pattern: /\bgas war\b/gi, replacement: 'gát oai' },
    { pattern: /\bgas wars\b/gi, replacement: 'gát oai' },
    { pattern: /\byield\b/gi, replacement: 'diu' },
    { pattern: /\bfarming\b/gi, replacement: 'pha minh' },
    { pattern: /\bfrontrun\b/gi, replacement: 'phờ rần răn' },
    { pattern: /\bfrontruns\b/gi, replacement: 'phờ rần răn' },
    { pattern: /\bdapp\b/gi, replacement: 'đi áp' },
    { pattern: /\bdapps\b/gi, replacement: 'đi áp' },
    { pattern: /\bsmart contract\b/gi, replacement: 'sờ-mạt con-trắc' },
    { pattern: /\bsmart contracts\b/gi, replacement: 'sờ-mạt con-trắc' },
    { pattern: /\btoken\b/gi, replacement: 'tô kừn' },
    { pattern: /\btokens\b/gi, replacement: 'tô kừn' },
    { pattern: /\bwallet\b/gi, replacement: 'oai lịt' },
    { pattern: /\bwallets\b/gi, replacement: 'oai lịt' },
    { pattern: /\bnanopayments\b/gi, replacement: 'na-nô pei mừn' },
    { pattern: /\bmachine\b/gi, replacement: 'mơ shin' },
    { pattern: /\bmachine-to-machine\b/gi, replacement: 'ma-shin tu ma-shin' },
    { pattern: /\bm2m\b/gi, replacement: 'em hai em' },
    { pattern: /\bble\b/gi, replacement: 'bi eo i' },
    { pattern: /\bbxc\b/gi, replacement: 'bi ích xi' },
    { pattern: /\bvre\b/gi, replacement: 'vi ar i' },
    { pattern: /\be-candle\b/gi, replacement: 'i can-đồ' },
    { pattern: /\bgateway\b/gi, replacement: 'gết-uây' },
    { pattern: /\bgateways\b/gi, replacement: 'gết-uây' },
    { pattern: /\bpain point\b/gi, replacement: 'pein poin' },
    { pattern: /\bpain points\b/gi, replacement: 'pein poin' },
    { pattern: /\bsettlement\b/gi, replacement: 'xét-tồ-mần' },
    { pattern: /\bsettlements\b/gi, replacement: 'xét-tồ-mần' }
  ];

  ttsCorrections.forEach(rule => {
    corrected = corrected.replace(rule.pattern, rule.replacement);
  });

  return corrected;
}

// Startup recovery and synchronization on Service Worker load
(async () => {
  try {
    const data = await chrome.storage.local.get(['isCapturing', 'activeTabId', 'autoReconnectConfig', 'ltSessionsStored', 'ltStoppedAt', 'ltUserStopped']);
    // Restore the latch before anything can act on the stale capture flag.
    _userStoppedLatch = !!data.ltUserStopped;
    self.ltSessions = data.ltSessionsStored || {};
    // Clear transient flags that may have been persisted mid-flight before the
    // service worker died — a stale _interimBusy would suppress interim
    // subtitles for the rest of the session.
    Object.values(self.ltSessions).forEach(s => { if (s) s._interimBusy = false; });
    // A stop that landed AFTER this flag was written must never be undone by a
    // worker restart. Storage is the only state that survives the worker, so the
    // stop timestamp is the tie-breaker against a stale isCapturing flag.
    const stoppedRecently = data.ltStoppedAt && (Date.now() - data.ltStoppedAt) < RESTORE_BLOCK_AFTER_STOP_MS;
    // The timestamp only covers the first minute. The latch has no expiry, which
    // is what makes a stop survive a worker restart an hour later.
    if (data.isCapturing && data.activeTabId && (stoppedRecently || _userStoppedLatch)) {
      console.log('🎙️ [BG] Ignoring stale capture state: the user stopped captions and has not started them again.');
      isCapturing = false;
      activeTabId = null;
      autoReconnectConfig = null;
      await chrome.storage.local.set({ isCapturing: false, activeTabId: null, autoReconnectConfig: null });
    } else if (data.isCapturing && data.activeTabId) {
      console.log('🎙️ [BG] Service worker initialized. Verifying responsiveness of active capture offscreen context...');

      let hasContext = false;
      try {
        if (typeof chrome.runtime.getContexts === 'function') {
          const contexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
          });
          hasContext = contexts && contexts.length > 0;
        }
      } catch (_) {}

      // THE bug behind "captions turn themselves back on": this used to restore the
      // session whenever the offscreen document merely answered a ping. But both
      // panels call lt_ensure_offscreen on load just to shave startup latency, so an
      // idle offscreen document exists all the time. A stale isCapturing flag plus
      // that idle document was read as "a capture is running" — and the worker
      // faithfully brought the session back. Liveness is not proof of capture; ask.
      let offscreenCapturing = false;
      if (hasContext) {
        // Retry ping up to 3 times to handle MV3 IPC initialization latency safely
        for (let i = 0; i < 3; i++) {
          try {
            const pingRes = await chrome.runtime.sendMessage({ target: 'offscreen', action: 'ping' });
            if (pingRes && pingRes.alive) {
              offscreenCapturing = !!pingRes.capturing;
              break;
            }
          } catch (_) {}
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      if (offscreenCapturing) {
        console.log('🎙️ [BG] RESTORE CAPTURE — trigger: service-worker-restart (offscreen still alive). Restoring session state.');
        isCapturing = true;
        activeTabId = data.activeTabId;
        autoReconnectConfig = data.autoReconnectConfig || null;
        _offscreenDocumentReady = true;
        startOffscreenHeartbeat();
        
        // Restore active session history log reference
        try {
          const sessionData = await chrome.storage.local.get(['_currentSession']);
          if (sessionData._currentSession) {
            _currentSession = sessionData._currentSession;
          }
        } catch (_) {}
      } else {
        console.log('🎙️ [BG] Offscreen is not actually capturing. Cleaning up stale capture state...');
        isCapturing = false;
        activeTabId = null;
        autoReconnectConfig = null;
        await chrome.storage.local.set({ isCapturing: false, activeTabId: null, autoReconnectConfig: null });
        try {
          await stopTabCapture(data.activeTabId);
        } catch (_) {}
      }
    } else {
      isCapturing = false;
      activeTabId = null;
      autoReconnectConfig = null;
      await chrome.storage.local.set({ isCapturing: false, activeTabId: null, autoReconnectConfig: null });
    }
  } catch (err) {
    console.error('🎙️ [BG] Startup capture restoration failed:', err);
  }
})();
