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
  importScripts('./secrets.js', './proxy-client.js');
} catch (e) {
  console.warn('[BG] secrets.js or proxy-client.js not loaded:', e.message);
}
const ADMIN_DEFAULTS = (self.ADMIN_DEFAULTS && typeof self.ADMIN_DEFAULTS === 'object') ? self.ADMIN_DEFAULTS : {};

// PROXY_URL is the only "secret" that ships in extension — it's just a URL, not a key.
// Real API keys live as Cloudflare Worker secrets and never reach the client.
const PROXY_URL = ADMIN_DEFAULTS.proxyUrl || '';
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
  console.log('🔍 [BG] Full message:', request);
  console.log('🔍 [BG] Message platform:', request.platform);

  // ✅ Handle ping test
  if (request.action === 'ping') {
    console.log('🏓 [BG] Ping received, responding...');
    sendResponse({ pong: true, timestamp: Date.now() });
    return true;
  }
  
  if (request.action === 'generateComments') {
    const timeoutId = setTimeout(() => {
      sendResponse({ success: false, error: 'Request timeout. Please try again.', timeout: true });
    }, 30000);

    (async () => {
      const settings = await getSettings();
      const isDefaultKey = settings.usingDefaultKey;

      // Only enforce quota when using bundled default key
      if (isDefaultKey) {
        const quota = await checkQuota();
        if (!quota.ok) {
          clearTimeout(timeoutId);
          sendResponse({ success: false, error: quota.error, quotaExhausted: true, quota });
          return;
        }
      }
      try {
        const response = await handleGenerateComments(request);
        clearTimeout(timeoutId);
        if (response.success && isDefaultKey) {
          response.quota = await consumeQuota();
        }
        // Always include quota info so popup can render UI correctly
        if (!response.quota) response.quota = await getQuotaState();
        response.usingDefaultKey = isDefaultKey;
        sendResponse(response);
      } catch (error) {
        clearTimeout(timeoutId);
        sendResponse({ success: false, error: error.message || 'Unknown error' });
      }
    })();

    return true;
  }

  if (request.action === 'getQuota') {
    getQuotaState().then(state => sendResponse({ success: true, quota: state }));
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

  if (request.action === 'lt_tab_start') {
    (async () => {
      try {
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
            });
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
          isReconnecting = false;
          autoReconnectConfig = null;
          const res = await stopTabCapture(tabId);
          sendResponse(res);
        } else {
          console.log('🎙️ [BG] Implicit stop triggered (audio track ended due to reload/navigation). Entering auto-reconnect state...');
          isReconnecting = true;
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

  if (request.action === 'lt_local_start') {
    isCapturing = true;
    activeTabId = request.tabId;
    chrome.storage.local.set({ isCapturing: true, activeTabId: request.tabId }).catch(() => {});
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'lt_local_stop') {
    isCapturing = false;
    activeTabId = null;
    chrome.storage.local.set({ isCapturing: false, activeTabId: null, autoReconnectConfig: null }).catch(() => {});
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'lt_process_audio') {
    (async () => {
      try {
        const { audioBase64, config } = request;
        if (!audioBase64) {
          sendResponse({ success: true, empty: true });
          return;
        }
        
        if (!_audioQueue) _audioQueue = [];
        _audioQueue.push({ audioBase64, config });
        _processAudioQueue();
        
        sendResponse({ success: true });
      } catch (err) {
        console.error('❌ [BG] Error adding audio to sequential queue:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }



  if (request.action === 'lt_stop_tts') {
    try {
      _ttsQueue = [];
      _isProcessingTts = false;
      chrome.tts.stop();
      sendResponse({ success: true });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
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

  if (request.action === 'lt_subtitle') {
    (async () => {
      try {
        if (request.mode === 'microphone') {
          const ttsEnabled = await chrome.storage.local.get(['ltTtsEnabled']);
          if (ttsEnabled.ltTtsEnabled) {
            speakSubtitle(request.translated, request.targetLang);
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
    // Extract data from request
    const { postContent, detectedLanguage } = request;
    
    // Step 1: Validate input
    if (!postContent || postContent.trim().length === 0) {
      throw new Error('No post content provided');
    }
    
    console.log('📄 Post content length:', postContent.length);
    
    // Step 2: Load settings with validation
    console.log('⚙️ Loading settings...');
    const settings = await getSettings();
    
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
    const canGenerate = await checkDailyQuota();
    if (!canGenerate) {
      throw new Error('Daily quota exceeded. Please try again tomorrow or increase your quota in settings.');
    }

    // Step 4: Get training insights
    console.log('🧠 Loading training insights...');
    const trainingInsights = await getTrainingInsights();
    
    // Step 5: Generate comments
    console.log('🤖 Generating AI comments...');
    const comments = await generateCommentsWithAI(
      { postContent }, 
      settings, 
      trainingInsights
    );
    
    if (!comments || Object.keys(comments).length === 0) {
      throw new Error('AI failed to generate any comments');
    }
    
    // Step 6: Update usage stats
    console.log('📈 Updating usage stats...');
    await updateUsageStats();

    // Step 7: Return success response
    const response = { 
      success: true, 
      data: comments,
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
        'claudeApiKey', 'openaiApiKey', 'geminiApiKey', 'kimiApiKey', 'deepseekApiKey', 'localApiKey',
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

          let apiKey = '';
          let userKey = ''; // raw key user typed in storage (no fallback)
          if (aiMode === 'custom') {
            switch(provider) {
              case 'claude':   userKey = (result.claudeApiKey || result.apiKey || '').trim(); break;
              case 'openai':   userKey = (result.openaiApiKey || '').trim(); break;
              case 'gemini':   userKey = (result.geminiApiKey || '').trim(); break;
              case 'kimi':     userKey = (result.kimiApiKey || '').trim(); break;
              case 'deepseek': userKey = (result.deepseekApiKey || '').trim(); break;
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
            selectedModel: result.selectedModel || getDefaultModel(provider),
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
    local:    'auto'
  };
  return defaults[provider] || DEFAULT_MODEL;
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
    
    // ✅ Always return valid fallback responses
    console.log('🔧 Using fallback responses due to error');
    return await getTrainingOptimizedFallbacks();
  }
}

// ✅ ENHANCED: Build prompt with automatic language detection
async function buildPrompt(contentObj, settings, trainingInsights = null) {
  try {
    const { postContent, isReply, originalPost, replyTo } = contentObj;
    const selectedTones = settings.selectedTones || ['professional', 'casual', 'sarcastic', 'contrarian'];

    // ✅ REPLY FOCUS: Determine content to focus on
    const targetContent = isReply ? postContent : postContent;
    const contextContent = isReply ? originalPost : null;
    
    // ✅ AI AUTO-DETECTION: Always let AI handle language detection
    let detectedLanguage = 'auto';
    console.log('🤖 BuildPrompt - AI Auto-Detection enabled - AI will handle all language detection');
    console.log('🌐 BuildPrompt - AI will automatically detect and respond in the correct language');

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
      `LENGTH: Keep replies ULTRA-SHORT - MAXIMUM 1 SENTENCE, 5-10 words per reply` :
      settings.commentLength === 'long' ?
      `LENGTH: Write more detailed replies - 2-3 sentences, 20-40 words per reply` :
      `LENGTH: Write balanced replies - MAXIMUM 1-2 sentences, 10-20 words per reply`;

    const languageInstruction = detectedLanguage !== 'auto' ?
      `Reply in ${detectedLanguage.toUpperCase()} only.` :
      `Reply in the SAME language as the tweet (no mixing).`;

    // Compact one-liner tone descriptors — keeps voice distinct, slashes token cost
    const TONE_BRIEFS = {
      professional: 'measured, no slang, sounds like an analyst',
      sarcastic:    'dry irony, fake-praise, mocks the claim',
      direct:       'blunt, no hedge, states the point',
      punchy:       'high-energy, all-caps OK, hype',
      casual:       'lowercase, "ngl/tbh/lol", chatty',
      witty:        'clever wordplay, punchline',
      contrarian:   'pushes back, "actually…", crowd-missed angle',
      concise:      '3-6 words MAX, pure signal',
      analytical:   'cites numbers, on-chain data, TA',
      empathetic:   'gentle, validates feelings',
      humorous:     'self-deprecating or absurd, actually funny',
      brief:        'one compact factual sentence',
      sharp:        'exposes flaw or hidden angle, cold',
      thao_mai:     'Vietnamese: lịch sự nhưng có ý kiến, "dạ em xin phép..."',
      snappy:       'attitude, "lol no, next"',
      crisp:        'polished, slightly elevated vocab'
    };

    const promptTemplate = `Reply to this tweet as a real X user. Generate ${optimizedTones.length} replies, each in a DISTINCT voice.

TWEET: "${targetContent}"

RULES:
- Reply in the SAME language as the tweet (auto-detect).
- Length varies by tone: concise/snappy=3-6 words, casual/direct/witty/punchy=6-12 words, analytical/professional/sharp/crisp/contrarian=10-18 words. Max 20.
- No emojis, no AI clichés ("very excited", "incredible", "fascinating"), no preamble.
- Reference specific details from the tweet (numbers, names, claims).
- Each tone must sound dramatically different — vocab, rhythm, attitude.

TONES:
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
async function getTrainingOptimizedFallbacks() {
  console.log('🔧 Getting training-optimized fallbacks...');
  
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
async function checkDailyQuota() {
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
          
          const quota = parseInt(quotaResult.dailyQuota) || 10;
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

async function translateText(request) {
  const { text, from = 'Vietnamese', to = 'English' } = request;
  if (!text || !text.trim()) return { success: false, error: 'No text provided' };

  const settings = await getSettings();
  // Skip key check when proxy holds the real key (default mode)
  const willUseProxy = HAS_PROXY && settings.usingDefaultKey && settings.apiProvider !== 'local';
  if (!settings.apiKey && !willUseProxy) {
    return { success: false, error: 'No API key configured' };
  }

  const prompt = `You are a strict translator. Translate the text below from ${from} to ${to}.

STRICT RULES:
- Translate ONLY the exact content provided. Do not add, expand, summarize, paraphrase, or invent anything.
- Preserve all proper nouns, names, brands, numbers, URLs, hashtags, @mentions, emojis EXACTLY as they appear.
- Keep the same tone, register, and punctuation. If casual, stay casual. If formal, stay formal.
- If the text is a fragment, single word, or incomplete sentence, translate just that fragment — don't complete it.
- Do NOT add greetings, sign-offs, explanations, notes, quotation marks, or commentary.
- Preserve tech, blockchain, and cryptocurrency industry terms untranslated. For example, keep words like "stable" (in crypto contexts, meaning stablecoin), "token", "node", "hash", "gas", "airdrop", "smart contract", "mint", "staking", "yield farming", "fork", etc., exactly as they are.
- If the text is already in ${to}, return it unchanged.
- Output ONLY the translation. No prefix, no suffix, no formatting.

TEXT TO TRANSLATE:
${text}`;
  // temperature 0 = most deterministic / no creative liberty (faithful translation)
  const apiConfig = { max_tokens: 1000, temperature: 0 };

  // Route via proxy when using bundled default key
  if (settings.usingDefaultKey && HAS_PROXY && self.PROXY_CLIENT) {
    try {
      const provider = settings.apiProvider;
      const model = settings.selectedModel || getDefaultModel(provider);
      // Kimi K2 family requires temperature: 1; other providers use 0 for faithful translation
      const temp = provider === 'kimi' ? 1 : 0;
      // GPT-5 / o1+ require `max_completion_tokens` instead of `max_tokens`
      const useNewParam = provider === 'openai' && (model?.startsWith('gpt-5') || model?.startsWith('o1') || model?.startsWith('o3') || model?.startsWith('o4'));
      const tokenField = useNewParam ? 'max_completion_tokens' : 'max_tokens';
      let payload;
      if (provider === 'claude') {
        payload = { model, max_tokens: 1000, messages: [{ role: 'user', content: prompt }], temperature: temp };
      } else if (provider === 'gemini') {
        payload = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: temp, maxOutputTokens: 1000 } };
      } else {
        payload = { model, messages: [{ role: 'user', content: prompt }], [tokenField]: 1000, temperature: temp };
      }
      const result = await self.PROXY_CLIENT.call(provider, model, payload);
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
            const useNew = m.startsWith('gpt-5') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4');
            return { model: m, messages: [{ role: 'user', content: prompt }], temperature: 0, ...(useNew ? { max_completion_tokens: 1000 } : { max_tokens: 1000 }) };
          })()),
          signal: controller.signal
        });
        const data = await resp.json();
        translated = data.choices?.[0]?.message?.content || '';
        break;
      }
      case 'claude': {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': settings.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: settings.selectedModel, max_tokens: 1000, messages: [{ role: 'user', content: prompt }], temperature: 0 }),
          signal: controller.signal
        });
        const data = await resp.json();
        translated = data.content?.[0]?.text || '';
        break;
      }
      case 'gemini': {
        const model = settings.selectedModel || 'gemini-3.1-flash-preview';
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 1000 } }),
          signal: controller.signal
        });
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
        const data = await resp.json();
        translated = data.choices?.[0]?.message?.content || '';
        break;
      }
      case 'deepseek': {
        const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.apiKey}` },
          body: JSON.stringify({ model: settings.selectedModel || 'deepseek-v4-flash', messages: [{ role: 'user', content: prompt }], max_tokens: 1000, temperature: 0 }),
          signal: controller.signal
        });
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

// ✅ ADDED: Test Model Connection Function
async function testModelConnection(request) {
  console.log('🔗 Testing model connection...');
  
  try {
    const settings = await getSettings();
    
    if (!settings.apiKey) {
      return { success: false, error: 'No API key configured' };
    }
    
    if (!settings.apiProvider) {
      return { success: false, error: 'No API provider selected' };
    }
    
    // Test with a simple prompt
    const testPrompt = "Hello, this is a test message. Please respond with 'Connection successful'.";
    
    let response;
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
      default:
        return { success: false, error: `Unsupported provider: ${settings.apiProvider}` };
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
let autoReconnectConfig = null;
self.ltSessions = {};
let _offscreenHeartbeat = null;
let _offscreenDocumentReady = false;

function startOffscreenHeartbeat() {
  stopOffscreenHeartbeat();
  _offscreenHeartbeat = setInterval(async () => {
    try {
      await chrome.runtime.sendMessage({ target: 'offscreen', action: 'ping' });
    } catch (e) {
      console.warn('💔 [BG] Offscreen heartbeat failed, recreating...');
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

  // Active ping responsiveness check
  let isAlive = false;
  try {
    const pingRes = await chrome.runtime.sendMessage({ target: 'offscreen', action: 'ping' });
    if (pingRes && pingRes.alive) {
      isAlive = true;
    }
  } catch (e) {
    isAlive = false;
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

  console.log('🎙️ [BG] Creating new offscreen document...');
  
  // Robust retry loop (up to 5 times) to handle Chrome's asynchronous closeDocument/createDocument race conditions
  let attempts = 5;
  while (attempts > 0) {
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['USER_MEDIA'],
        justification: 'Capture active tab audio stream for real-time translation captions'
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

async function startTabCapture(tabId, streamId, config) {
  try {
    await createOffscreenDocument();
    startOffscreenHeartbeat(); // Heartbeat ping to keep document alive
    
    isCapturing = true;
    activeTabId = tabId;
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
        config: config
      };
    }

    // Persist Mute Tab and TTS states in storage so popup toggle reflects properly
    const storageData = await chrome.storage.local.get(['ltMuteTab', 'ltTtsEnabled']);
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
        ltTtsEnabled: isTtsEnabled
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
  isReconnecting = false;
  autoReconnectConfig = null;

  // Clear active capture state in storage
  chrome.storage.local.set({
    isCapturing: false,
    activeTabId: null,
    autoReconnectConfig: null
  }).catch(() => {});
  
  stopOffscreenHeartbeat(); // Stop Heartbeat ping

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
  }

  // Restore tab audio playback
  try {
    if (tabId) {
      await chrome.tabs.update(tabId, { muted: false });
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

// Automatically reconnect tab capture when the captured tab is reloaded or navigated!
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId === activeTabId && changeInfo.status === 'complete' && isCapturing && isReconnecting) {
    console.log(`🎙️ [BG] Captured tab ${tabId} loaded. Attempting automatic tab capture reconnection...`);
    
    setTimeout(async () => {
      // Re-verify capture session parameters
      if (!isCapturing || !isReconnecting || activeTabId !== tabId) return;
      
      try {
        const config = autoReconnectConfig || {};
        
        chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, async (streamId) => {
          if (chrome.runtime.lastError || !streamId) {
            console.warn('🎙️ [BG] Auto-reconnect getMediaStreamId failed:', chrome.runtime.lastError?.message);
            // Stay in isReconnecting state so next reload/navigation can attempt capture again
            return;
          }
          
          console.log(`🎙️ [BG] Auto-reconnect got stream ID. Resuming capture...`);
          isReconnecting = false;
          await startTabCapture(tabId, streamId, config);
          
          // Notify the UI if open to ensure smooth sync
          broadcastMessage({ action: 'lt_tab_reconnected', tabId: tabId });
        });
      } catch (err) {
        console.warn('🎙️ [BG] Auto-reconnect startTabCapture failed:', err.message);
      }
    }, 1500); // 1.5s delay to guarantee standard page environment initializations
  }
});

// Broadcast a message to all active pages (content scripts and popup)
function broadcastMessage(payload) {
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, ([activeTab]) => {
      if (activeTab && activeTab.id) {
        chrome.tabs.sendMessage(activeTab.id, payload).catch(() => {});
      }
    });
  } catch (_) {}
  try {
    chrome.runtime.sendMessage(payload).catch(() => {});
  } catch (_) {}
}

// ─── 2. Sequential Audio Processing Queue ────────────────────────────────

let _audioQueue = [];
let _isProcessingAudio = false;

async function _processAudioQueue() {
  if (_isProcessingAudio) return;
  if (_audioQueue.length === 0) {
    _isProcessingAudio = false;
    return;
  }
  _isProcessingAudio = true;

  // Shed backlog if lag grows beyond 3 segments to keep up with real-time stream
  if (_audioQueue.length > 3) {
    console.warn(`⚠️ [BG] Audio processing backlog too large (${_audioQueue.length}). Shedding oldest chunks.`);
    _audioQueue = _audioQueue.slice(_audioQueue.length - 2);
  }

  const task = _audioQueue.shift();
  try {
    await handleAudioSegment(task.audioBase64, task.config);
  } catch (err) {
    console.error('❌ [BG] Sequential audio segment task failed:', err);
  } finally {
    // ─── CRITICAL FIX: Reset flag BEFORE recursive call ──────────────────
    // If we reset AFTER the recursive call, the recursion hits the guard
    // `if (_isProcessingAudio) return` and exits immediately, leaving the
    // queue permanently frozen (deadlock).
    _isProcessingAudio = false;
    _processAudioQueue();
  }
}

async function handleAudioSegment(audioBase64, config) {
  const { sourceLang, targetLang, apiKey, ltEngine } = config;
  const storage = await chrome.storage.local.get(['ltTopic']);
  const activeTopic = storage.ltTopic || 'general';
  
  console.log('🎙️ [BG] Processing audio segment sequentially. Base64 length:', audioBase64.length, '| Topic:', activeTopic);

  // Initialize session memory for this active captured tab
  if (!self.ltSessions) self.ltSessions = {};
  if (!activeTabId) activeTabId = 0;
  if (!self.ltSessions[activeTabId]) {
    self.ltSessions[activeTabId] = {
      chunks: [],
      lastText: '',
      lastTimestamp: Date.now(),
      history: [],
      segmentId: 'seg_' + Date.now() + '_' + Math.floor(Math.random() * 1000)
    };
  }
  const session = self.ltSessions[activeTabId];

  // 1. Send Base64 payload to active ASR Speech Engine for transcription
  let transcribedText = '';
  try {
    const syncSettings = await chrome.storage.sync.get(['ltAsrEngine', 'openaiApiKey', 'groqApiKey', 'groqModel']);
    const asrEngine = syncSettings.ltAsrEngine || 'groq';
    
    if (asrEngine === 'groq') {
      const groqKey = syncSettings.groqApiKey;
      const groqModel = syncSettings.groqModel || 'whisper-large-v3';
      if (!groqKey) {
        throw new Error('Groq API Key is missing. Please add it in settings.');
      }
      transcribedText = await transcribeGroq(audioBase64, sourceLang, targetLang, groqKey, groqModel);
    } else {
      // Default to OpenAI Whisper
      const whisperKey = syncSettings.openaiApiKey || apiKey;
      if (!whisperKey) {
        throw new Error('OpenAI API Key is missing. Please add it in settings.');
      }
      transcribedText = await transcribeWhisper(audioBase64, sourceLang, targetLang, whisperKey);
    }
  } catch (err) {
    console.error('❌ [BG] Transcription failed:', err);
    broadcastMessage({ action: 'lt_error', error: 'Transcription failed: ' + err.message });
    return;
  }

  if (!transcribedText || !transcribedText.trim()) {
    console.log('🎙️ [BG] Silent or empty transcription chunk.');
    if (session.chunks && session.chunks.length > 0) {
      console.log(`🎙️ [BG] Silence detected (empty segment received). Force-finalizing pending text.`);
      await finalizeAndTranslateSentence(session, sourceLang, targetLang, ltEngine, activeTopic);
    }
    return;
  }

  console.log(`🎙️ [BG] Whisper Transcribed: "${transcribedText.trim()}"`);

  // 2. Filter out Whisper silence/noise hallucinations
  if (isWhisperHallucination(transcribedText)) {
    console.log('🎙️ [BG] Whisper silence hallucination filtered:', transcribedText.trim());
    return;
  }

  // 3. Pre-correct acoustic tech nouns & stutter
  let cleanedText = cleanAndPrecorrectOriginalText(transcribedText, activeTopic);
  cleanedText = cleanConsecutiveDuplicates(cleanedText);

  if (!cleanedText || !cleanedText.trim()) return;

  // 4. Boundary check and sentence accumulation
  // Check if speaker paused long enough (2.0s) to finalize sentence
  const pauseThreshold = 2000;
  const isPause = Date.now() - session.lastTimestamp > pauseThreshold;
  if (isPause && session.chunks.length > 0) {
    console.log(`🎙️ [BG] Long pause detected (${Math.round(Date.now() - session.lastTimestamp)}ms > ${pauseThreshold}ms). Force-finalizing previous sentence.`);
    await finalizeAndTranslateSentence(session, sourceLang, targetLang, ltEngine, activeTopic);
  }

  session.lastTimestamp = Date.now();

  const splitIntoSentences = (text) => {
    if (!text) return [];
    return text.split(/(?<=[.!?。！？])\s+(?=\S)/).map(s => s.trim()).filter(s => s.length > 0);
  };

  const sentences = splitIntoSentences(cleanedText);
  for (const sentence of sentences) {
    // If chunks overflow (>=3), force-finalize the accumulated chunks before pushing new sentences to prevent drift
    if (session.chunks.length >= 3) {
      console.log(`🎙️ [BG] Chunks overflow (>=3). Force-finalizing to prevent duplication/drift.`);
      await finalizeAndTranslateSentence(session, sourceLang, targetLang, ltEngine, activeTopic);
    }
    session.chunks.push(sentence);
  }

  let fullOriginalText = session.chunks.join(' ');
  fullOriginalText = cleanIncompletePunctuation(fullOriginalText);
  fullOriginalText = cleanConsecutiveDuplicates(fullOriginalText);

  // Keep the session memory synchronized with the cleaned text
  session.chunks = [fullOriginalText];

  // 5. Cognitive Semantic Completion Checking
  const endsWithPunctuation = /[.!?。！？]$/.test(fullOriginalText.trim());
  const hasMultipleSentences = /[.!?。！？]\s+(?=\S)/.test(fullOriginalText); // Detect multiple complete sentences
  const incomplete = isSemanticallyIncomplete(fullOriginalText) && !endsWithPunctuation;
  const wordCount = fullOriginalText.split(/\s+/).length;
  
  // Decide if we should translate & display now
  // We finalize immediately if:
  // - The text ends in a sentence punctuation (like . ! ? 。 ！)
  // - OR the text contains multiple complete sentences
  // - OR the text is semantically complete
  // - OR the word count reaches 8 words (optimal low latency compromise, instead of 10)
  const shouldFinalize = endsWithPunctuation || hasMultipleSentences || !incomplete || (wordCount >= 8);

  if (shouldFinalize) {
    console.log(`🎙️ [BG] Sentence complete (shouldFinalize=true). Word count: ${wordCount}`);
    await finalizeAndTranslateSentence(session, sourceLang, targetLang, ltEngine, activeTopic);
  } else {
    // To prevent awkward fragmented flashing overlays, we do NOT broadcast incomplete sentences.
    // Instead, we wait silently until shouldFinalize is true!
    console.log('🎙️ [BG] Sentence incomplete. Waiting for predicate completion...');
  }
}

async function finalizeAndTranslateSentence(session, sourceLang, targetLang, ltEngine, activeTopic = 'general') {
  const fullTextToTranslate = session.chunks.join(' ');
  const activeSegmentId = session.segmentId;

  // Reset rolling state for next sentence
  session.chunks = [];
  session.lastText = '';
  session.segmentId = 'seg_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

  if (!fullTextToTranslate || !fullTextToTranslate.trim()) return;

  // Double check Whisper hallucination on the finalized accumulated sentence
  if (isWhisperHallucination(fullTextToTranslate)) {
    console.log('🎙️ [BG] Finalized sentence filtered as Whisper hallucination:', fullTextToTranslate.trim());
    return;
  }

  console.log(`🎙️ [BG] Finalizing sentence: "${fullTextToTranslate.trim()}"`);

  // Translate asynchronously to keep sequential audio queue fast!
  (async () => {
    try {
      let translatedText = '';
      const engineToUse = ltEngine || 'google';
      const contextSnapshot = [...(session.history || [])];

      let originalText = fullTextToTranslate;

      // Skip translation API call if source == target language
      const effectiveSource = (sourceLang || 'auto').toLowerCase();
      const effectiveTarget = (targetLang || 'vi').toLowerCase();
      const skipTranslation = effectiveSource !== 'auto' && effectiveSource === effectiveTarget;

      if (skipTranslation) {
        console.log('🌐 [BG] Source == Target language. Skipping translation, showing original text.');
        translatedText = originalText;
      } else if (engineToUse === 'openai') {
        console.log('🤖 [BG] Translating via OpenAI Premium...');
        const transRes = await translateLiveWithAI({
          text: fullTextToTranslate,
          from: sourceLang,
          to: targetLang,
          context: contextSnapshot
        });
        if (transRes && transRes.success) {
          translatedText = transRes.translated;
          if (transRes.original) {
            originalText = transRes.original;
          }
        } else {
          const apiError = transRes?.error || 'AI Translation failed';
          console.warn('⚠️ [BG] OpenAI translation failed, falling back to free Google Translate:', apiError);
          broadcastMessage({
            action: 'lt_warning',
            error: `Premium AI Translation failed (${apiError}). Falling back to Google Translate.`
          });
          translatedText = await translateGoogleBg(fullTextToTranslate, targetLang);
        }
      } else {
        console.log('🌐 [BG] Translating via Google Translate (Free)...');
        translatedText = await translateGoogleBg(fullTextToTranslate, targetLang);
      }

      // Enforce premium tech glossary polish
      translatedText = polishVietnameseTranslation(translatedText, originalText, activeTopic);

      console.log(`🎙️ [BG] Translation completed: "${translatedText.trim()}"`);

      // Save to sliding context dialogue memory
      if (!session.history) session.history = [];
      session.history.push({ original: originalText, translated: translatedText });
      if (session.history.length > 3) session.history.shift(); // Keep last 3Snapshots

      // Save to floating history storage (limit 200)
      await updateCaptionHistoryInStorage(originalText, translatedText);

      // Broadcast subtitle overlay containing BOTH translated and original text
      broadcastMessage({
        action: 'lt_subtitle',
        original: originalText,
        translated: translatedText,
        mode: 'tabCapture',
        timestamp: Date.now(),
        segmentId: activeSegmentId
      });

      // Synchronous TTS Readout if enabled
      const ttsEnabled = await chrome.storage.local.get(['ltTtsEnabled']);
      if (ttsEnabled.ltTtsEnabled) {
        speakSubtitle(translatedText, targetLang);
      }

    } catch (err) {
      console.error('❌ [BG] Translation task failed:', err);
    }
  })();
}

// ─── 3. Whisper ASR & Google Translate Helpers ───────────────────────────

async function transcribeWhisper(audioBase64, sourceLang, targetLang, whisperKey) {
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

  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.webm');
  formData.append('model', 'whisper-1');

  // Configure transcribing target accent locale if known
  if (sourceLang && sourceLang !== 'auto') {
    formData.append('language', sourceLang);
  }

  // Inject Tech spelling alignment hints inside Whisper prompt
  const whisperPrompt = "Circle, Arc, TLAY, USDC, Bitcoin, UX, UI, mainnet, testnet, token, gas fee, nanopayments, machine-to-machine.";
  formData.append('prompt', whisperPrompt);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000); // 12 seconds timeout to prevent deadlock

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
      throw new Error(`Whisper ASR HTTP failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return data.text || '';
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('OpenAI Whisper ASR request timed out (12s limit)');
    }
    throw err;
  }
}

async function transcribeGroq(audioBase64, sourceLang, targetLang, groqKey, groqModel = 'whisper-large-v3') {
  const binaryString = atob(audioBase64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const arrayBuffer = bytes.buffer;

  const audioBlob = new Blob([arrayBuffer], { type: 'audio/webm' });

  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.webm');
  formData.append('model', groqModel || 'whisper-large-v3');

  if (sourceLang && sourceLang !== 'auto') {
    formData.append('language', sourceLang);
  }

  const whisperPrompt = "Circle, Arc, TLAY, USDC, Bitcoin, UX, UI, mainnet, testnet, token, gas fee, nanopayments, machine-to-machine.";
  formData.append('prompt', whisperPrompt);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000); // 12 seconds timeout to prevent deadlock

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
      throw new Error(`Groq ASR HTTP failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return data.text || '';
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Groq ASR request timed out (12s limit)');
    }
    throw err;
  }
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
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tgt}&dt=t&q=${encodeURIComponent(text)}`;

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
      // Return original text as fallback if response body is empty
      return translatedText || text;
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        console.error(`❌ [BG] Google Translate failed after ${MAX_RETRIES} retries:`, err.message);
        // ── IMPORTANT: return original text so captions keep flowing, never go silent ──
        return text;
      }
      const delay = attempt * 1000;
      console.warn(`⚠️ [BG] Google Translate error (attempt ${attempt}): ${err.message}. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return text; // Safety fallback
}

async function translateLiveWithAI({ text, from, to, context }) {
  try {
    const contextLines = context.map(c => `User said: "${c.original}" -> Translated: "${c.translated}"`).join('\n');
    const prompt = `You are a professional tech, gaming, and blockchain translator and editor.
Translate live speech while dynamically cleaning up live speaker stammering, hesitations, or exact repeated words/phrases that are caused by the speaker thinking out loud (e.g. "It's loading. Let's see. It's loading. It's loading" -> "It's loading, let's see").

DISCOURSE CONTEXT (Last few dialogue sentences):
${contextLines || "None"}

STRICT TRANSLATION & EDITING RULES:
1. Remove all redundant filler words, hesitations (e.g., "uh", "um", "you know", "so yeah"), and stammering or thinking-out-loud repetitions in both the optimized original English text and the translation. Make them flow naturally.
2. Keep tech proper nouns and people's names accurate and preserved in standard English spelling (e.g., "Circle", "Arc", "USDC", "Bitcoin", "Vitalik", "Satoshi", "Sandeep", "Elon", "CZ", "Sreeram").
3. Ensure natural address/pronouns in Vietnamese (ONLY use "bạn"/"các bạn" for you, and "tôi"/"chúng tôi" for I/we. NEVER use formal/corporate pronouns like "anh/chị", "quý vị", "ông/bà").
4. Translate literal idioms into natural slang (e.g., "settlement" to "quyết toán/thanh toán", "machine wallet" to "ví thiết bị", "crypto native" to "người thuần crypto").
5. Format your output EXACTLY as follows with no other text, quotes, or explanations:
CLEAN_ORIGINAL: [Optimized natural English text without hesitations or repetitions]
TRANSLATION: [Natural Vietnamese translation of the optimized text]

TEXT TO TRANSLATE:
"${text}"`;

    const res = await translateText({ text: prompt, from: 'English', to: to });
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
      
      // If AI returned just a plain string without prefixes, we treat it as translation and keep original text as is
      return { success: true, original: text, translated: res.translated.trim() };
    }
    return res;
  } catch (err) {
    return { success: false, error: err.message || 'AI Translation failed' };
  }
}

// ─── 4. Whisper Hallucination Filter ─────────────────────────────────────

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
    .replace(/[\d\s\p{P}\p{S}]/gu, ' ') // replaces all punctuation, symbols, numbers, and spaces with space
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

// ─── 5. Technical pre-correction & Vietnamese Post-Polish ──────────────────

function cleanAndPrecorrectOriginalText(text, topic = 'general') {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text;
  
  // Strip leaked ASR loop boundaries
  cleaned = cleaned.replace(/\s*Continue transcribing\.?/gi, '');
  cleaned = cleaned.replace(/\s*Tiếp tục phiên dịch\.?/gi, '');

  let rules = [
    { pattern: /\bmichael usd\b/gi, replacement: 'Micro USD' },
    { pattern: /\bcircle not a payment\b/gi, replacement: 'Circle nanopayments' },
    { pattern: /\bcircle and the r\b/gi, replacement: 'Circle and Arc' },
    { pattern: /\bcircle and are\b/gi, replacement: 'Circle and Arc' },
    { pattern: /\bcircle and our\b/gi, replacement: 'Circle and Arc' },
    { pattern: /\bcircle and or\b/gi, replacement: 'Circle and Arc' },
    { pattern: /\bop test\b/gi, replacement: 'OP testnet' },
    { pattern: /\bmachine water\b/gi, replacement: 'machine-to-machine' },
    { pattern: /\bembedded wallet\b/gi, replacement: 'embedded wallet' },
    { pattern: /\bpay point\b/gi, replacement: 'pain point' },
    { pattern: /\bpay points\b/gi, replacement: 'pain points' }
  ];

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
  }

  rules.forEach(rule => {
    cleaned = cleaned.replace(rule.pattern, rule.replacement);
  });

  return cleaned;
}

function cleanStutteringAndRepetitions(text) {
  if (!text || typeof text !== 'string') return '';
  
  // Single-word repetitions: "the the the" -> "the"
  let cleaned = text.replace(/\b(\w+)(?:[\s,.]+(?:\1)\b)+/gi, '$1');
  // Two-word repetitions: "so as so as" -> "so as"
  cleaned = cleaned.replace(/\b(\w+[\s,.]+\w+)(?:[\s,.]+(?:\1)\b)+/gi, '$1');
  // Three-word repetitions: "one two three one two three" -> "one two three"
  cleaned = cleaned.replace(/\b(\w+[\s,.]+\w+[\s,.]+\w+)(?:[\s,.]+(?:\1)\b)+/gi, '$1');
  
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
      let seq1 = words.slice(i, i + L).join(' ').toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
      let seq2 = words.slice(i + L, i + 2 * L).join(' ').toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
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
  return text.replace(/\b(\w+)\s*[.,!?]+\s+(\w+)/g, (match, word1, word2) => {
    if (incompleteWords.has(word1.toLowerCase())) {
      let newWord2 = word2;
      if (word2 !== 'I' && !/^[A-Z]{2,}/.test(word2)) {
        newWord2 = word2.charAt(0).toLowerCase() + word2.slice(1);
      }
      return word1 + ' ' + newWord2;
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

function polishVietnameseTranslation(translated, original, topic = 'general') {
  if (!translated) return '';
  let polished = translated;

  // Premium Tech & Crypto translations rules mapping
  let replacements = [
    { pattern: /vòng cung/gi, replacement: 'Arc' },
    { pattern: /công chúng/gi, replacement: 'công khai' },
    // Modern community-focused pronoun replacements for Vietnamese ("you" -> "bạn", "các bạn")
    { pattern: /anh\s*[\/\-]\s*chị/gi, replacement: 'bạn' },
    { pattern: /\banh\/chị\b/gi, replacement: 'bạn' },
    { pattern: /\banh chị\b/gi, replacement: 'bạn' },
    { pattern: /\bquý vị\b/gi, replacement: 'các bạn' },
    { pattern: /\bquý vị và các bạn\b/gi, replacement: 'các bạn' }
  ];

  if (topic === 'crypto') {
    replacements.push(
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
      { pattern: /mã thông báo/gi, replacement: 'token' },
      { pattern: /trên chuỗi/gi, replacement: 'onchain' },
      { pattern: /dữ liệu trên chuỗi/gi, replacement: 'dữ liệu onchain' },
      { pattern: /đại lý trí tuệ nhân tạo|đại lý thông minh/gi, replacement: 'AI Agent' },
      { pattern: /tác nhân trí tuệ nhân tạo|tác nhân thông minh/gi, replacement: 'AI Agent' },
      { pattern: /các tác nhân/gi, replacement: 'agents' },
      { pattern: /các đại lý/gi, replacement: 'agents' },
      { pattern: /đại lý/gi, replacement: 'agent' },
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
    );
    if (original && /stable/i.test(original)) {
      polished = polished.replace(/đồng ổn định/gi, 'stablecoin');
      polished = polished.replace(/ổn định/gi, 'stable');
    }
    if (original && /circle/i.test(original)) {
      polished = polished.replace(/vòng tròn/gi, 'Circle');
    }
    if (original && /arc/i.test(original)) {
      polished = polished.replace(/vòng cung|hồ quang|cung tròn/gi, 'Arc');
    }
    if (original && /arc testnet/i.test(original)) {
      polished = polished.replace(/mạng thử nghiệm arc|mạng thử nghiệm của arc/gi, 'Arc Testnet');
    }
    if (original && /agent/i.test(original)) {
      polished = polished.replace(/tác nhân|đại lý/gi, 'agent');
    }
    if (original && /agents/i.test(original)) {
      polished = polished.replace(/các tác nhân|các đại lý/gi, 'agents');
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
    if (original && /cz/i.test(original)) {
      polished = polished.replace(/\bcz\b/gi, 'CZ');
    }
    if (original && /sreeram/i.test(original)) {
      polished = polished.replace(/sreeram/gi, 'Sreeram');
    }
    if (original && /eigenlayer/i.test(original)) {
      polished = polished.replace(/eigenlayer/gi, 'EigenLayer');
    }
    if (original && /eigen/i.test(original)) {
      polished = polished.replace(/\beigen\b/gi, 'Eigen');
    }
  } else if (topic === 'tech') {
    replacements.push(
      { pattern: /giao diện/gi, replacement: 'UI/UX' },
      { pattern: /máy chủ/gi, replacement: 'server' },
      { pattern: /giao thức/gi, replacement: 'giao thức (protocol)' },
      { pattern: /cơ sở dữ liệu/gi, replacement: 'database' }
    );
    if (original && /fleet/i.test(original)) {
      polished = polished.replace(/đội tàu/gi, 'đội xe/thiết bị (fleet)');
    }
    if (original && /candle/i.test(original)) {
      polished = polished.replace(/nến điện tử|nến/gi, 'thiết bị E-candle');
    }
    if (original && /repository|repo/i.test(original)) {
      polished = polished.replace(/kho chứa/gi, 'repo/repository');
    }
  } else if (topic === 'business') {
    replacements.push(
      { pattern: /tỷ lệ hội thoại/gi, replacement: 'tỷ lệ chuyển đổi (conversion rate)' },
      { pattern: /điểm đau/gi, replacement: 'điểm nghẽn (pain point)' },
      { pattern: /điểm thanh toán chính/gi, replacement: 'điểm nghẽn chính (pain point)' },
      { pattern: /điểm đau chính/gi, replacement: 'điểm nghẽn chính (pain point)' },
      { pattern: /phần mềm dịch vụ/gi, replacement: 'phần mềm SaaS' },
      { pattern: /cổ phần/gi, replacement: 'cổ phần (equity)' }
    );
    if (original && /gateway/i.test(original)) {
      polished = polished.replace(/\bcổng\b/gi, 'cổng thanh toán (gateway)');
    }
  }

  replacements.forEach(rep => {
    polished = polished.replace(rep.pattern, rep.replacement);
  });

  return polished;
}

// In-Memory Caption History Manager
async function updateCaptionHistoryInStorage(originalText, translatedText) {
  try {
    const { captionHistory = [] } = await chrome.storage.local.get(['captionHistory']);
    const newItem = {
      id: 'cap_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      timestamp: new Date().toLocaleTimeString(),
      original: originalText.trim(),
      translated: translatedText.trim()
    };
    
    captionHistory.push(newItem);
    // Limit to last 200 captions
    if (captionHistory.length > 200) captionHistory.shift();
    await chrome.storage.local.set({ captionHistory });
  } catch (_) {}
}

// ─── 6. Speech Narration & Accents synchronization ───────────────────────

let _ttsQueue = [];
let _isProcessingTts = false;

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
  return _ttsLangMap[langCode] || 'vi-VN';
}

function speakSubtitle(text, langCode) {
  if (!text) return;
  
  // Push subtitle text chunk to speech queue
  _ttsQueue.push({ text, langCode });
  
  // Trigger speech engine
  _processNextTTS();
}

async function _processNextTTS() {
  if (_ttsQueue.length === 0 || _isProcessingTts) return;
  _isProcessingTts = true;

  // Adjust vocal speech rate dynamically based on backlog in queue and Latency preset!
  let speechRate = 1.0;
  try {
    const storage = await chrome.storage.local.get(['ltSegmentPreset']);
    const preset = storage.ltSegmentPreset || 'accuracy';
    
    if (preset === 'speed') {
      // 1.5s segments arrive extremely fast, require faster catch-up speech rates
      if (_ttsQueue.length > 2) {
        speechRate = 2.1;
      } else if (_ttsQueue.length > 1) {
        speechRate = 1.6;
      } else {
        speechRate = 1.25;
      }
    } else if (preset === 'balanced') {
      // 2.5s segments arrive at a medium pace
      if (_ttsQueue.length > 2) {
        speechRate = 1.9;
      } else if (_ttsQueue.length > 1) {
        speechRate = 1.45;
      } else {
        speechRate = 1.1;
      }
    } else {
      // 3.5s segments arrive at a slower standard pace
      if (_ttsQueue.length > 2) {
        speechRate = 1.75;
      } else if (_ttsQueue.length > 1) {
        speechRate = 1.35;
      } else {
        speechRate = 1.0;
      }
    }
  } catch (_) {
    // Fallback standard rate scaling on error
    if (_ttsQueue.length > 2) {
      speechRate = 1.9;
    } else if (_ttsQueue.length > 1) {
      speechRate = 1.4;
    } else {
      speechRate = 1.0;
    }
  }

  const currentTask = _ttsQueue.shift();
  const normalizedLang = normalizeTtsLang(currentTask.langCode);

  let rawSpeechText = currentTask.text;
  if (normalizedLang.startsWith('vi')) {
    rawSpeechText = phoneticCorrectVietnameseTts(rawSpeechText);
  }

  console.log(`🎙️ [BG] Speaking: "${rawSpeechText}" | Accent: ${normalizedLang} | Rate: ${speechRate}x`);

  const initiateSpeech = (text, lang, rate, isFallback = false) => {
    const options = {
      rate: rate,
      onEvent: (event) => {
        console.log(`🎙️ [BG] TTS Event: ${event.type}`);
        if (event.type === 'end' || event.type === 'interrupted' || event.type === 'error') {
          _isProcessingTts = false;
          setTimeout(_processNextTTS, 50);
        }
      }
    };
    if (!isFallback && lang) {
      options.lang = lang;
    }

    chrome.tts.speak(text, options, () => {
      if (chrome.runtime.lastError) {
        console.warn('❌ [BG] chrome.tts.speak failed:', chrome.runtime.lastError.message);
        if (!isFallback) {
          console.log('🔄 [BG] Retrying speech with fallback default voice...');
          initiateSpeech(text, null, rate, true);
        } else {
          _isProcessingTts = false;
          setTimeout(_processNextTTS, 50);
        }
      } else {
        console.log('✅ [BG] chrome.tts.speak initiated successfully');
      }
    });
  };

  initiateSpeech(rawSpeechText, normalizedLang, speechRate);
}

function phoneticCorrectVietnameseTts(text) {
  if (!text) return '';
  let corrected = text;

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
    { pattern: /\bux\b/gi, replacement: 'u ích' },
    { pattern: /\bui\b/gi, replacement: 'u ai' },
    { pattern: /\bux\/ui\b/gi, replacement: 'u ích u ai' },
    { pattern: /\biot\b/gi, replacement: 'ai ô ti' },
    { pattern: /\bai\b/gi, replacement: 'ê ai' },
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
    const data = await chrome.storage.local.get(['isCapturing', 'activeTabId', 'autoReconnectConfig']);
    if (data.isCapturing && data.activeTabId) {
      console.log('🎙️ [BG] Service worker initialized. Verifying responsiveness of active capture offscreen context...');
      
      let offscreenAlive = false;
      try {
        const pingRes = await chrome.runtime.sendMessage({ target: 'offscreen', action: 'ping' });
        if (pingRes && pingRes.alive) {
          offscreenAlive = true;
        }
      } catch (_) {}
      
      if (offscreenAlive) {
        console.log('🎙️ [BG] Offscreen context responded to ping. Restoring background capturing session state.');
        isCapturing = true;
        activeTabId = data.activeTabId;
        autoReconnectConfig = data.autoReconnectConfig || null;
        _offscreenDocumentReady = true;
        startOffscreenHeartbeat();
      } else {
        console.log('🎙️ [BG] Offscreen context did not respond to ping. Cleaning up stale capture state...');
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
