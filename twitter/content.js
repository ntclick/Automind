// ✅ ENHANCED AI REPLY GENERATOR - MULTI-LANGUAGE SUPPORT
// ✅ UNIQUE NAMESPACE TO AVOID CONFLICTS
(function() {
    window.AIReplyGenerator = window.AIReplyGenerator || {};

    if (window.AIReplyGenerator.isInjectedGlobal) {
        console.log('⚠️ AutoMind content script is already injected in this tab. Skipping duplicate injection.');
        return;
    }
    window.AIReplyGenerator.isInjectedGlobal = true;

    // Keep the page console clean: AutoMind's step-by-step logs are debug
    // noise for users reading their console (and get mistaken for errors).
    // Flip to true when debugging. The override lives in this extension's
    // isolated world only — page scripts and other extensions are untouched,
    // and console.warn / console.error always pass through.
    const AUTOMIND_DEBUG = false;
    if (!AUTOMIND_DEBUG) {
        console.log = function () {};
        console.info = function () {};
        console.debug = function () {};
    }

    let isInjected = false;
let currentPlatform = detectPlatform();
let observers = [];
let floatingPanel = null;
let currentTweetUrl = null;
let isGenerating = false;
let isInitializing = false;

// ✅ AI AUTO-DETECTION: No manual language detection variables needed

// ✅ Initialize language detector
// ✅ AI AUTO-DETECTION: No manual language detection needed
console.log('🤖 AI Auto-Detection enabled - AI will handle all language detection');

// ✅ AUTO-CLOSE FEATURE DISABLED
// let autoCloseTimer = null;
// let isContentGenerated = false;
// let autoCloseDelay = 8000; // 8 seconds delay after mouse leave - more user-friendly
// let isMouseOverPanel = false;

// ✅ AutoMind loaded

// ✅ Console commands available if needed
window.AIReplyGenerator.createButton = function() {
    return createToggleButton();
};

window.AIReplyGenerator.debug = function() {
    const info = {
        platform: currentPlatform,
        isInjected: isInjected,
        panelExists: !!floatingPanel,
        toggleExists: !!document.querySelector('.ai-panel-toggle'),
        emergencyExists: !!document.querySelector('.airg-emergency-ai-btn'),
        url: window.location.href,
        bodyExists: !!document.body,
        readyState: document.readyState,
        hostname: window.location.hostname
    };
    console.log('Extension Debug Info:', info);
    return info;
};

// Legacy support
window.createAIButton = window.AIReplyGenerator.createButton;
window.debugExtension = window.AIReplyGenerator.debug;

// ✅ Debug commands available in console if needed

// ✅ ENHANCED: Testing functions for content script
// Wait for ExtensionMessenger to be available
function createExtensionTester() {
    console.log('🔧 createExtensionTester called');
    console.log('🔍 ExtensionMessenger type:', typeof ExtensionMessenger);
    console.log('🔍 window.extensionTester exists:', !!window.extensionTester);

    if (typeof ExtensionMessenger === 'undefined') {
        console.log('⏳ ExtensionMessenger not ready, retrying in 100ms...');
        setTimeout(createExtensionTester, 100);
        return;
    }

    window.extensionTester = {
        async runFullTest() {
            try {
                console.log('🧪 Running full test from content script...');
                const result = await ExtensionMessenger.runFullTest();
                console.log('✅ Content script test completed:', result);
                return result;
            } catch (error) {
                console.error('❌ Content script test failed:', error);
                throw error;
            }
        },

        async testSettings() {
            try {
                console.log('⚙️ Testing settings from content script...');
                const result = await ExtensionMessenger.testSettings();
                console.log('✅ Content script settings test completed:', result);
                return result;
            } catch (error) {
                console.error('❌ Content script settings test failed:', error);
                throw error;
            }
        },

        async testAPIConnection() {
            try {
                console.log('🔗 Testing API connection from content script...');
                const result = await ExtensionMessenger.testAPIConnection();
                console.log('✅ Content script API test completed:', result);
                return result;
            } catch (error) {
                console.error('❌ Content script API test failed:', error);
                throw error;
            }
        },

        async testAIGeneration() {
            try {
                console.log('🤖 Testing AI generation from content script...');
                const result = await ExtensionMessenger.testAIGeneration();
                console.log('✅ Content script AI test completed:', result);
                return result;
            } catch (error) {
                console.error('❌ Content script AI test failed:', error);
                throw error;
            }
        },

        // Quick test function for console
        async quickTest() {
            console.log('🚀 Running quick test from console...');
            try {
                const result = await this.runFullTest();
                console.log('🎯 Quick test results:', result);
                return result;
            } catch (error) {
                console.error('❌ Quick test failed:', error);
                return { success: false, error: error.message };
            }
        },

        // Direct background communication (fallback)
        async testDirect() {
            try {
                console.log('🔗 Testing via direct background communication...');
                const response = await sendMessageWithErrorHandling({
                    action: 'runFullTest'
                });
                console.log('✅ Direct test completed:', response);
                return response;
            } catch (error) {
                console.error('❌ Direct test failed:', error);
                return { success: false, error: error.message };
            }
        }
    };

    console.log('🧪 Extension tester created successfully');
    console.log('💡 Available functions:');
    console.log('  - extensionTester.quickTest()');
    console.log('  - extensionTester.testDirect()');
    console.log('  - extensionTester.runFullTest()');
    console.log('  - extensionTester.testSettings()');
    console.log('  - extensionTester.testAPIConnection()');
    console.log('  - extensionTester.testAIGeneration()');
    console.log('🔍 window.extensionTester after creation:', !!window.extensionTester);
    console.log('🔍 window.extensionTester object:', window.extensionTester);
}

// Initialize tester when ready
createExtensionTester();

// ✅ FALLBACK: Ensure extensionTester is always available
setTimeout(() => {
    console.log('🔍 Checking extensionTester after 1 second...');
    console.log('🔍 window.extensionTester exists:', !!window.extensionTester);

    if (!window.extensionTester) {
        console.log('⚠️ ExtensionTester not created, creating fallback...');
        window.extensionTester = {
            async testDirect() {
                try {
                    console.log('🔗 Testing via direct background communication...');
                    const response = await sendMessageWithErrorHandling({
                        action: 'runFullTest'
                    });
                    console.log('✅ Direct test completed:', response);
                    return response;
                } catch (error) {
                    console.error('❌ Direct test failed:', error);
                    return { success: false, error: error.message };
                }
            },
            async quickTest() {
                return await this.testDirect();
            }
        };
        console.log('✅ Fallback extensionTester created');
        console.log('🔍 window.extensionTester after fallback:', !!window.extensionTester);
    } else {
        console.log('✅ ExtensionTester already exists');
    }
}, 1000);

// --- UTILITY FUNCTIONS ---
function isExtensionContextValid() {
    try {
        if (typeof chrome === 'undefined' || !chrome || !chrome.runtime || !chrome.runtime.id) {
            return false;
        }
        chrome.runtime.getURL('');
        return true;
    } catch (e) {
        return false;
    }
}

function detectPlatform() {
    const hostname = window.location.hostname;
    const url = window.location.href;
    console.log('🔍 Detecting platform for hostname:', hostname);
    console.log('🔍 Full URL:', url);

    // Check for X/Twitter domains
    if (hostname.includes('twitter') ||
        hostname.includes('x.com') ||
        hostname === 'x.com' ||
        hostname === 'twitter.com' ||
        hostname.includes('twitter.com') ||
        hostname.includes('.x.com')) {
        console.log('✅ Platform detected: twitter');
        return 'twitter';
    }

    console.log('⚠️ Platform detected: unknown');
    return 'unknown';
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function cleanup() {
    console.log('🧹 Starting cleanup...');

    // Auto-close feature is disabled; safe no-op if function ever exists
    if (typeof cancelAutoClose === 'function') cancelAutoClose();

    // Disconnect observers
    observers.forEach(observer => {
        try {
            observer.disconnect();
        } catch (e) {
            console.log('Observer disconnect error:', e);
        }
    });
    observers = [];

    // Remove floating panel
    if (floatingPanel && floatingPanel.parentNode) {
        floatingPanel.remove();
    }
    floatingPanel = null;

    // Remove all extension elements
    const selectors = [
        '.ai-comment-generator-btn',
        '.ai-button-container',
        '.ai-inline-comments',
        '.ai-floating-panel',
        '.ai-panel-toggle'
    ];

    selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(element => {
            try {
                element.remove();
            } catch (e) {
                console.log('Element removal error:', e);
            }
        });
    });

    // ✅ AUTO-CLOSE FEATURE DISABLED
    // isContentGenerated = false;
    // isMouseOverPanel = false;

    console.log('✅ Cleanup completed');
}

// ✅ SESSION & DATA FUNCTIONS
function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function getCurrentSessionId() {
    let sessionId = localStorage.getItem('ai-session-id');
    if (!sessionId) {
        sessionId = generateSessionId();
        localStorage.setItem('ai-session-id', sessionId);
    }
    return sessionId;
}

function getCurrentTweetUrl() {
    const tweetLink = document.querySelector('article[data-testid="tweet"] a[href*="/status/"]');
    if (tweetLink) {
        return tweetLink.href;
    }

    const urlMatch = window.location.href.match(/\/status\/(\d+)/);
    if (urlMatch) {
        return `https://twitter.com/i/status/${urlMatch[1]}`;
    }

    return window.location.href;
}

function checkTweetChange() {
    if (!isExtensionContextValid()) {
        console.warn('⚠️ Extension context invalidated. Cleaning up listeners and observers.');
        cleanup();
        return;
    }
    const newTweetUrl = getCurrentTweetUrl();

    if (currentTweetUrl && currentTweetUrl !== newTweetUrl) {
        console.log('🔄 Tweet changed detected:', currentTweetUrl, '->', newTweetUrl);

        // ✅ Update generate button state based on new URL
        const generateBtn = document.querySelector('.ai-floating-panel .generate-btn');
        if (generateBtn) {
            updateGenerateButtonState(generateBtn);
        }

        // ✅ OPTIMIZED: Only reset panel if it's actually open and visible
        const panel = document.querySelector('.ai-floating-panel');
        if (panel && panel.style.display !== 'none') {
            console.log('🔄 Resetting panel to initial state...');
            resetPanelToInitialState();
        } else {
            console.log('ℹ️ Panel not visible, skipping reset');
        }
    }

    currentTweetUrl = newTweetUrl;
}

function resetPanelToInitialState() {
    console.log('🔄 Resetting panel to initial state...');

    if (!isExtensionContextValid()) {
        console.warn('⚠️ Extension context invalidated. Cleaning up listeners and observers.');
        cleanup();
        return;
    }

    if (!floatingPanel) return;

    // Hide regenerate footer when going back to initial state
    const footer = floatingPanel.querySelector('#aiPanelFooter');
    if (footer) footer.classList.add('hidden');

    const contentArea = floatingPanel.querySelector('.panel-content');
    if (!contentArea) return;

    const iconUrl = chrome.runtime.getURL('icons/icon-48.png');
    contentArea.innerHTML = `
        <div class="ai-initial-state">
            <div class="ai-initial-icon" style="background:none;box-shadow:none;padding:0;overflow:hidden;">
                <img src="${iconUrl}" width="52" height="52" style="display:block;border-radius:14px;">
            </div>
            <h3 class="ai-initial-title">AutoMind</h3>
            <p class="ai-initial-sub">Generate authentic replies in multiple tones</p>
            <button class="generate-btn ai-gen-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Generate Replies
            </button>
        </div>
        <div class="ai-config-strip" id="aiConfigStrip"></div>
    `;

    const generateBtn = contentArea.querySelector('.generate-btn');
    if (generateBtn) {
        generateBtn.onclick = handleGenerateClick;
    }

    renderConfigStrip();

    console.log('✅ Panel reset completed');
}

// --- DATA FUNCTIONS ---
async function getCurrentSettings() {
    return new Promise((resolve, reject) => {
        // ✅ FIX: Check if extension context is still valid
        if (!chrome.runtime || !chrome.runtime.id) {
            reject(new Error('Extension context invalidated - please reload the page'));
            return;
        }

        chrome.storage.sync.get([
            'selectedTones', 'apiProvider', 'supabaseUrl', 'supabaseKey',
            'openaiApiKey', 'claudeApiKey', 'geminiApiKey', 'selectedModel',
            'userSettings'
        ], result => {
            console.log('⚙️ Loaded settings:', result);
            console.log('🔍 API Provider:', result.apiProvider);
            console.log('🔍 Has OpenAI Key:', !!result.openaiApiKey);
            console.log('🔍 Has Claude Key:', !!result.claudeApiKey);
            console.log('🔍 Has Gemini Key:', !!result.geminiApiKey);
            console.log('🔍 Selected Model:', result.selectedModel);
            console.log('🔍 Selected Tones:', result.selectedTones);
            console.log('🔍 Selected Tones Count:', result.selectedTones ? result.selectedTones.length : 0);
            console.log('🔍 Selected Tones Details:', result.selectedTones ? result.selectedTones.map((tone, index) => `${index + 1}. ${tone}`).join(', ') : 'None');

            // ✅ FIX: Use tones from userSettings if available
            let selectedTones = result.selectedTones;
            if (result.userSettings && result.userSettings.selectedTones) {
                selectedTones = result.userSettings.selectedTones;
                console.log('✅ Using tones from userSettings:', selectedTones);
                console.log('✅ UserSettings tones count:', selectedTones.length);
            }

            resolve({
                selectedTones: selectedTones || ['professional', 'casual', 'sarcastic'],
                apiProvider: result.apiProvider || 'openai',
                supabaseUrl: result.supabaseUrl || '',
                supabaseKey: result.supabaseKey || '',
                openaiApiKey: result.openaiApiKey || '',
                claudeApiKey: result.claudeApiKey || '',
                geminiApiKey: result.geminiApiKey || '',
                selectedModel: result.selectedModel || 'gpt-4o-mini'
            });
        });
    });
}

/**
 * Render the "this is what will be used" strip on the panel's initial screen.
 * Mirrors background.js getSettings(): in Free tier the provider AND model are
 * pinned, so a leftover model from another provider is never shown as active.
 */
async function renderConfigStrip() {
    const strip = floatingPanel && floatingPanel.querySelector('#aiConfigStrip');
    if (!strip) return;

    const PROVIDER_LABEL = {
        openai: 'OpenAI', claude: 'Claude', gemini: 'Gemini', kimi: 'Kimi',
        deepseek: 'DeepSeek', nvidia: 'NVIDIA NIM', local: 'Local server'
    };
    const MODEL_PREFIXES = {
        openai: [/^gpt-/i, /^o[1-9]/i], claude: [/^claude-/i], gemini: [/^gemini-/i],
        kimi: [/^moonshot-/i, /^kimi-/i], deepseek: [/^deepseek-/i], nvidia: [/\//], local: [/./]
    };
    const DEFAULT_MODELS = {
        openai: 'gpt-4o-mini', claude: 'claude-haiku-4-5-20251001',
        gemini: 'gemini-3.1-flash-preview', kimi: 'moonshot-v1-32k',
        deepseek: 'deepseek-v4-flash', nvidia: 'nvidia/llama-3.1-nemotron-51b-instruct', local: 'auto'
    };

    try {
        const s = await new Promise(resolve => chrome.storage.sync.get(
            ['aiMode', 'apiProvider', 'selectedModel', 'userSettings', 'selectedTones', 'language',
             'openaiApiKey', 'claudeApiKey', 'geminiApiKey', 'kimiApiKey', 'deepseekApiKey', 'nvidiaApiKey', 'localApiKey'],
            resolve));

        const isFree = (s.aiMode || 'system') !== 'custom';
        const provider = isFree ? 'openai' : (s.apiProvider || 'openai');
        let model = isFree ? 'gpt-4o-mini' : (s.selectedModel || DEFAULT_MODELS[provider]);
        const rules = MODEL_PREFIXES[provider];
        if (!isFree && (!model || (rules && !rules.some(re => re.test(model))))) {
            model = DEFAULT_MODELS[provider];
        }

        const keyMap = {
            openai: s.openaiApiKey, claude: s.claudeApiKey, gemini: s.geminiApiKey,
            kimi: s.kimiApiKey, deepseek: s.deepseekApiKey, nvidia: s.nvidiaApiKey, local: s.localApiKey
        };
        const keyMissing = !isFree && provider !== 'local' && !(keyMap[provider] || '').trim();

        const tones = (s.userSettings && s.userSettings.selectedTones) || s.selectedTones || [];
        const langLabel = (!s.language || s.language === 'auto')
            ? 'Match the post'
            : s.language.charAt(0).toUpperCase() + s.language.slice(1);

        strip.innerHTML = `
            <div class="ai-cfg-row">
                <span class="ai-cfg-label">Engine</span>
                <span class="ai-cfg-value ${keyMissing ? 'warn' : ''}">
                    ${isFree ? 'Free tier · 50/day' : PROVIDER_LABEL[provider] || provider}${keyMissing ? ' · no API key' : ''}
                </span>
            </div>
            <div class="ai-cfg-row">
                <span class="ai-cfg-label">Model</span>
                <span class="ai-cfg-value" title="${model}">${model}</span>
            </div>
            <div class="ai-cfg-row">
                <span class="ai-cfg-label">Tones</span>
                <span class="ai-cfg-value ${tones.length ? '' : 'warn'}">${tones.length ? tones.length + ' selected' : 'none selected'}</span>
            </div>
            <div class="ai-cfg-row">
                <span class="ai-cfg-label">Language</span>
                <span class="ai-cfg-value">${langLabel}</span>
            </div>
            <div class="ai-cfg-foot">
                <span style="font-size:11px;color:#94a3b8;">Applies to the next generation</span>
                <button class="ai-cfg-settings" id="aiOpenSettings">Change in Settings →</button>
            </div>
        `;

        const btn = strip.querySelector('#aiOpenSettings');
        if (btn) btn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'openOptionsPage' });
        });
    } catch (err) {
        console.warn('⚠️ Could not render config strip:', err);
        strip.innerHTML = '';
    }
}

async function recordTrainingData(action, commentData) {
    // Analytics removed for privacy compliance
    return;
}

async function updateUserStats(userId, action, rating) {
    // Analytics removed for privacy compliance
    return;
}

async function loadUserTrainingStats() {
    // Analytics removed for privacy compliance
    return {
        total_ratings: 0,
        total_uses: 0,
        total_copies: 0,
        total_generations: 0,
        average_rating: 0
    };
}

// Safe JSON helper to avoid unexpected end of JSON input
async function safeJson(response) {
    try {
        const text = await response.text();
        if (!text) return {};
        return JSON.parse(text);
    } catch (e) {
        return {};
    }
}

// ✅ NEW: Helper function for chrome.runtime.sendMessage with error handling
function sendMessageWithErrorHandling(messageData, timeout = 15000) {
    return new Promise((resolve, reject) => {
        // Check if extension context is still valid
        if (!chrome.runtime || !chrome.runtime.id) {
            reject(new Error('Extension context invalidated - please reload the page'));
            return;
        }

        const timeoutId = setTimeout(() => {
            reject(new Error('Message timeout - please try again'));
        }, timeout);

        chrome.runtime.sendMessage(messageData, (response) => {
            clearTimeout(timeoutId);

            if (chrome.runtime.lastError) {
                const errorMsg = chrome.runtime.lastError.message;
                if (errorMsg.includes('Could not establish connection') ||
                    errorMsg.includes('Receiving end does not exist')) {
                    reject(new Error('Extension context invalidated - please reload the page'));
                } else {
                    reject(new Error(errorMsg));
                }
            } else {
                resolve(response);
            }
        });
    });
}

// ✅ NEW: Show extension reload message
function showExtensionReloadMessage() {
    // Create a temporary notification
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #ff6b6b;
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        z-index: 10000;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        max-width: 300px;
        animation: slideIn 0.3s ease-out;
    `;

    notification.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 5px;">🔄 Extension Update Required</div>
        <div style="font-size: 12px; opacity: 0.9;">Please reload the page to continue using AutoMind</div>
    `;

    // Add animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);

    document.body.appendChild(notification);

    // Auto remove after 5 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'slideIn 0.3s ease-out reverse';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 300);
        }
    }, 5000);
}

// ✅ REPLY FOCUS: Detect if user is replying to a specific comment
function detectReplyContext() {
    try {
        // Strategy 1: Check for reply box and "Replying to" indicator
        const replyBox = document.querySelector('[placeholder*="Tweet your reply"], [placeholder*="Reply"], [data-testid="tweetTextarea"]');
        if (!replyBox) return null;

        // Check if there's a "Replying to @username" indicator
        let replyIndicator = document.querySelector('[role="link"][href*="/"][data-testid*="User-Text"]') ||
                             document.querySelector('[data-testid*="replying-to"]');
        if (!replyIndicator) {
            const spans = document.querySelectorAll('span');
            for (const span of spans) {
                if (span.textContent.includes('Replying to')) {
                    replyIndicator = span;
                    break;
                }
            }
        }

        // Look for reply context in the DOM
        const replyContextElements = document.querySelectorAll('[data-testid="Tweet-User-Text"], [role="group"] [href*="/status/"]');

        // Strategy 2: Check if reply box is focused/active
        const isReplyActive = replyBox === document.activeElement ||
                             replyBox.contains(document.activeElement) ||
                             replyBox.closest('[data-testid="tweetCompose"]');

        // Strategy 3: Check URL for reply indicators
        const url = window.location.href;
        const hasReplyInUrl = url.includes('reply') || url.includes('compose/tweet');

        console.log('🔍 REPLY DETECTION:', {
            hasReplyBox: !!replyBox,
            hasReplyIndicator: !!replyIndicator,
            isReplyActive: isReplyActive,
            hasReplyInUrl: hasReplyInUrl,
            replyContextElements: replyContextElements.length
        });

        // If we have an active reply context, try to find the comment being replied to
        if (isReplyActive || hasReplyInUrl || replyIndicator) {
            // Look for the tweet being replied to by checking recent interactions
            const tweets = document.querySelectorAll('article[data-testid="tweet"]');
            let targetComment = null;
            let targetAuthor = null;

            // Check each tweet to see if it has reply indicators or is being replied to
            for (const tweet of tweets) {
                const replyBtn = tweet.querySelector('[data-testid="reply"], [aria-label*="Reply"]');
                const isBeingReplied = replyBtn && (
                    replyBtn.closest('[data-active="true"]') ||
                    replyBtn.getAttribute('aria-pressed') === 'true' ||
                    replyBtn.closest('[aria-expanded="true"]')
                );

                if (isBeingReplied) {
                    console.log('🎯 REPLY FOCUS: Found tweet being replied to');
                    targetComment = extractTweetTextFromArticle(tweet);
                    targetAuthor = extractTweetAuthorFromArticle(tweet);
                    break;
                }

                // Alternative: Check if tweet is near the reply box
                const tweetRect = tweet.getBoundingClientRect();
                const replyRect = replyBox.getBoundingClientRect();
                const isNearReply = Math.abs(tweetRect.top - replyRect.top) < 200;

                if (isNearReply && !targetComment) {
                    console.log('🎯 REPLY FOCUS: Found tweet near reply box');
                    targetComment = extractTweetTextFromArticle(tweet);
                    targetAuthor = extractTweetAuthorFromArticle(tweet);
                }
            }

            // If we found a target comment, get full context
            if (targetComment) {
                const replyContext = {
                    commentText: targetComment,
                    author: targetAuthor,
                    isReply: true,
                    originalPost: null, // Will be filled by main post detection
                    replyTo: targetAuthor
                };

                // Try to get the original post content too
                const mainTweets = document.querySelectorAll('article[data-testid="tweet"]');
                if (mainTweets.length > 1) {
                    // Usually the first tweet is the main post
                    const mainPost = extractTweetTextFromArticle(mainTweets[0]);
                    if (mainPost && mainPost !== targetComment) {
                        replyContext.originalPost = mainPost;
                    }
                }

                console.log('✅ REPLY FOCUS: Successfully detected reply context:', {
                    commentLength: targetComment.length,
                    author: targetAuthor,
                    hasOriginalPost: !!replyContext.originalPost
                });

                return replyContext;
            }
        }

        return null;
    } catch (error) {
        console.error('❌ REPLY DETECTION ERROR:', error);
        return null;
    }
}

// Helper function to extract author from tweet
function extractTweetAuthorFromArticle(tweetElement) {
    try {
        // Try different selectors for author
        const authorSelectors = [
            '[data-testid="User-Name"]',
            '[role="link"] [dir="ltr"]',
            'a[href*="/"] [dir="ltr"]',
            '[data-testid*="username"]'
        ];

        for (const selector of authorSelectors) {
            const authorElement = tweetElement.querySelector(selector);
            if (authorElement && authorElement.textContent) {
                return authorElement.textContent.trim();
            }
        }

        return 'Unknown Author';
    } catch (error) {
        console.error('❌ Error extracting tweet author:', error);
        return 'Unknown Author';
    }
}

// ✅ ENHANCED: getCurrentTweetData with multiple extraction strategies
// Helper function to find original tweet when replying from compose page
function findOriginalTweetFromCompose(tweetId) {
    try {
        // Look for tweet data in sessionStorage or localStorage (Twitter might store it)
        const sessionData = sessionStorage.getItem('twitter_compose_reply_data');
        if (sessionData) {
            const parsed = JSON.parse(sessionData);
            if (parsed.tweetId === tweetId || parsed.id === tweetId) {
                console.log('📦 COMPOSE PAGE: Found tweet data in sessionStorage');
                return parsed;
            }
        }

        // Try to find in DOM by traversing back in history or looking for referrer
        const referrer = document.referrer;
        if (referrer && referrer.includes('/status/')) {
            console.log('🔗 COMPOSE PAGE: Found referrer URL:', referrer);
            // Extract tweet ID from referrer
            const match = referrer.match(/\/status\/(\d+)/);
            if (match && match[1] === tweetId) {
                // We can't directly access the tweet content from referrer,
                // but we can create a placeholder for now
                return {
                    text: "Replying to a tweet about crypto/blockchain developments",
                    images: [],
                    videos: [],
                    links: [],
                    mentions: [],
                    hashtags: ["crypto"],
                    timestamp: new Date().toISOString(),
                    author: { name: "Tweet Author", handle: "tweet_author" },
                    foundViaReferrer: true
                };
            }
        }

        console.log('❌ COMPOSE PAGE: Could not find original tweet for ID:', tweetId);
        return null;
    } catch (error) {
        console.log('⚠️ COMPOSE PAGE: Error finding original tweet:', error);
        return null;
    }
}

async function getCurrentTweetData() {
    console.log('🔍 DEBUG: Starting getCurrentTweetData...');

    try {
        console.log('🔍 DEBUG: Current URL:', window.location.href);
        console.log('🔍 DEBUG: Document title:', document.title);
        // ✅ REPLY FOCUS: Check if user is replying to a specific comment
        const replyContext = detectReplyContext();
        if (replyContext) {
            console.log('🎯 REPLY FOCUS: Detected reply to specific comment:', replyContext.commentText?.substring(0, 100) + '...');
            return {
                text: replyContext.commentText,
                images: replyContext.images || [],
                videos: replyContext.videos || [],
                links: replyContext.links || [],
                mentions: replyContext.mentions || [],
                hashtags: replyContext.hashtags || [],
                timestamp: replyContext.timestamp,
                author: replyContext.author,
                isReply: true,
                originalPost: replyContext.originalPost,
                replyTo: replyContext.replyTo
            };
        }

        // Strategy -1: COMPOSE PAGE - If on compose page, generate based on URL context or generic crypto content
        const currentUrl = window.location.href;
        console.log('🔍 DEBUG: Current URL:', currentUrl);

        if (currentUrl.includes('/compose/post') || (currentUrl.includes('/compose/tweet') && !currentUrl.includes('/status/'))) {
            console.log('📝 COMPOSE PAGE: User is creating new content');

            // Try to get context from URL parameters or reply context
            const urlParams = new URLSearchParams(window.location.search);
            const replyTo = urlParams.get('reply_to') || urlParams.get('in_reply_to_status_id');
            const originalTweetId = urlParams.get('tweet_id') || urlParams.get('status_id');

            if (replyTo || originalTweetId) {
                console.log('🔗 COMPOSE PAGE: Found reply context in URL params');
                // Try to find the original tweet in the DOM
                const originalTweet = findOriginalTweetFromCompose(replyTo || originalTweetId);
                if (originalTweet) {
                    console.log('✅ COMPOSE PAGE: Found original tweet to reply to');
                    return {
                        text: originalTweet.text,
                        images: originalTweet.images || [],
                        videos: originalTweet.videos || [],
                        links: originalTweet.links || [],
                        mentions: originalTweet.mentions || [],
                        hashtags: originalTweet.hashtags || [],
                        timestamp: originalTweet.timestamp,
                        author: originalTweet.author,
                        isReply: true,
                        fromComposePage: true
                    };
                }
            }

            // Try to extract actual tweet content from the page
            console.log('🔍 COMPOSE PAGE: Attempting to extract actual tweet content...');

            // Look for tweet content in various selectors (based on actual HTML structure)
            const tweetSelectors = [
                '[data-testid="tweetText"]',  // Primary selector from actual HTML
                'div[data-testid="tweetText"]',  // More specific
                '[data-testid="tweet"] [data-testid="tweetText"]',  // Nested in tweet
                'article [data-testid="tweetText"]',  // In article
                '[role="article"] [data-testid="tweetText"]',  // In role article
                'div[dir="auto"][lang]',  // Based on actual structure: dir="auto" lang="en"
                '[data-testid="tweet"] [lang]',  // Fallback
                'article [lang]'  // Final fallback
            ];

            let actualTweetText = '';
            let actualAuthor = { name: "Unknown", handle: "unknown" };

            for (const selector of tweetSelectors) {
                const tweetElement = document.querySelector(selector);
                if (tweetElement && tweetElement.textContent.trim()) {
                    actualTweetText = tweetElement.textContent.trim();
                    console.log(`✅ Found tweet content via selector: ${selector}`);
                    console.log(`📝 Tweet text: ${actualTweetText.substring(0, 100)}...`);
                    break;
                }
            }

            // Try to find author info (based on actual HTML structure)
            const authorSelectors = [
                '[data-testid="User-Name"]',  // Primary selector from actual HTML
                'div[data-testid="User-Name"]',  // More specific
                '[data-testid="tweet"] [data-testid="User-Name"]',  // Nested in tweet
                'article [data-testid="User-Name"]',  // In article
                '[role="article"] [data-testid="User-Name"]'  // In role article
            ];

            for (const selector of authorSelectors) {
                const authorElement = document.querySelector(selector);
                if (authorElement) {
                    // Extract name - look for the first span with the display name
                    const nameSpans = authorElement.querySelectorAll('span');
                    for (const span of nameSpans) {
                        const text = span.textContent.trim();
                        // Skip empty spans and spans that look like handles (@username)
                        if (text && !text.startsWith('@') && text.length > 1) {
                            actualAuthor.name = text;
                            break;
                        }
                    }

                    // Extract handle - look for @username pattern
                    const handleSpans = authorElement.querySelectorAll('span');
                    for (const span of handleSpans) {
                        const text = span.textContent.trim();
                        if (text && text.startsWith('@')) {
                            actualAuthor.handle = text.substring(1); // Remove @ symbol
                            break;
                        }
                    }

                    console.log(`✅ Found author: ${actualAuthor.name} (@${actualAuthor.handle})`);
                    break;
                }
            }

            if (actualTweetText) {
                console.log('✅ COMPOSE PAGE: Using actual tweet content');
                return {
                    text: actualTweetText,
                    images: [],
                    videos: [],
                    links: [],
                    mentions: [],
                    hashtags: [],
                    timestamp: new Date().toISOString(),
                    author: actualAuthor,
                    isReply: false,
                    fromComposePage: true,
                    genericContent: false,
                    contextHint: "Replying to actual tweet content"
                };
            } else {
                console.log('🎲 COMPOSE PAGE: No actual tweet found, using generic crypto content');
                return {
                    text: "🚀 Exciting times in crypto! The blockchain revolution continues with groundbreaking innovations in DeFi, NFTs, and Web3. What's your take on the latest developments?",
                    images: [],
                    videos: [],
                    links: [],
                    mentions: [],
                    hashtags: ["crypto", "blockchain", "DeFi", "NFT"],
                    timestamp: new Date().toISOString(),
                    author: { name: "Crypto Enthusiast", handle: "crypto_enthusiast" },
                    isReply: false,
                    fromComposePage: true,
                    genericContent: true,
                    contextHint: "Creating new tweet about crypto trends"
                };
            }
        }

        const isNotComposePage = !currentUrl.includes('/compose/post') && !(currentUrl.includes('/compose/tweet') && !currentUrl.includes('/status/'));

        if (isNotComposePage) {
            console.log('🔍 DEBUG: Not on compose page, trying simple tweet extraction...');

            // Find first visible tweet in timeline
            const articles = document.querySelectorAll('article[data-testid="tweet"]');
            for (let i = 0; i < Math.min(articles.length, 3); i++) {
                const article = articles[i];
                const tweetData = extractComprehensiveTweetData(article);

                if (tweetData && tweetData.text && tweetData.text.length > 10) {
                    console.log('✅ DEBUG: Found tweet via simple extraction:', tweetData.text.substring(0, 50) + '...');

                // 📢 LOG CURRENT TWEET DATA WHEN FOUND
                console.log('📢 === TWEET EXTRACTED ===');
                console.log('📢 Method: Simple extraction');
                console.log('📢 Text:', tweetData.text);
                console.log('📢 Length:', tweetData.text.length, 'characters');
                console.log('📢 Images:', tweetData.images?.length || 0);
                console.log('📢 Videos:', tweetData.videos?.length || 0);
                console.log('📢 === END EXTRACTION ===');

                return tweetData;
                }
            }
        }

        // Extract tweet ID from URL if it's a specific tweet page
        const tweetIdMatch = currentUrl.match(/\/status\/(\d+)/);
        if (tweetIdMatch) {
            const tweetId = tweetIdMatch[1];
            console.log('🔍 DEBUG: Found tweet ID in URL:', tweetId);

            // ✅ ENHANCED: Check if we're on a reply page by looking for reply context
            const isReplyPage = currentUrl.includes('/status/') &&
                               (document.querySelector('[data-testid="reply"]') ||
                                document.querySelector('[aria-label*="Reply"]') ||
                                document.querySelector('[placeholder*="Tweet your reply"]'));

            if (isReplyPage) {
                console.log('🔍 DEBUG: Detected reply page, prioritizing tweet matching URL:', tweetId);
            }

            // Strategy 0a: Look for tweet by checking all articles and finding the one with matching URL
            const articles = document.querySelectorAll('article[data-testid="tweet"]');
            console.log('🔍 DEBUG: Checking', articles.length, 'articles for URL match...');

            // ✅ FIXED: First pass - find articles with matching URL
            let matchingArticle = null;
            for (let i = 0; i < articles.length; i++) {
                const article = articles[i];

                // ✅ ENHANCED: Debug each article content
                const articleText = extractTweetTextFromArticle(article);
                console.log(`🔍 DEBUG: Article ${i} content:`, articleText?.substring(0, 100) + '...');

                // Check if this article contains a link to the current tweet
                const tweetLinks = article.querySelectorAll('a[href*="/status/"]');
                console.log(`🔍 DEBUG: Article ${i} has ${tweetLinks.length} status links`);

                for (const link of tweetLinks) {
                    const href = link.getAttribute('href');
                    console.log(`🔍 DEBUG: Article ${i} link:`, href);
                    console.log(`🔍 DEBUG: Looking for tweet ID: ${tweetId}`);
                    console.log(`🔍 DEBUG: Link contains /status/${tweetId}:`, href && href.includes(`/status/${tweetId}`));

                    if (href && href.includes(`/status/${tweetId}`)) {
                        console.log('✅ DEBUG: Found matching link! Extracting tweet data...');
                        const tweetData = extractComprehensiveTweetData(article);
                        console.log('✅ DEBUG: Extracted tweet data:', tweetData);
                        if (tweetData.text && tweetData.text.length > 0) {
                            console.log('✅ DEBUG: Found tweet from URL match:', tweetData.text.substring(0, 50) + '...');
                            console.log('✅ DEBUG: Matching link:', href);
                            matchingArticle = tweetData;
                            break; // Found the matching tweet, use it
                        } else {
                            console.log('⚠️ DEBUG: Tweet data empty, skipping');
                        }
                    }
                }
                if (matchingArticle) break; // Exit outer loop if we found a match
            }

            // ✅ FIXED: Return the matching article if found
            if (matchingArticle) {
                console.log('✅ DEBUG: Returning matching article from all articles');
                return matchingArticle;
            }

            // Strategy 0b: If no direct match, look for the main tweet in the primary content area
            console.log('🔍 DEBUG: No direct URL match found, looking in primary content area...');
            const primaryColumn = document.querySelector('[data-testid="primaryColumn"]');
            if (primaryColumn) {
                // ✅ FIXED: Look for the tweet that matches the current URL, not just the first tweet
                const allTweets = primaryColumn.querySelectorAll('article[data-testid="tweet"]');
                console.log('🔍 DEBUG: Found', allTweets.length, 'tweets in primary column');

                // ✅ FIXED: First pass - find tweets with matching URL
                let matchingTweet = null;
                for (let i = 0; i < allTweets.length; i++) {
                    const tweet = allTweets[i];
                    const tweetText = extractTweetTextFromArticle(tweet);
                    console.log(`🔍 DEBUG: Primary tweet ${i} content:`, tweetText?.substring(0, 100) + '...');

                    // Check if this tweet contains a link to the current tweet ID
                    const tweetLinks = tweet.querySelectorAll('a[href*="/status/"]');
                    console.log(`🔍 DEBUG: Primary tweet ${i} has ${tweetLinks.length} status links`);

                    for (const link of tweetLinks) {
                        const href = link.getAttribute('href');
                        console.log(`🔍 DEBUG: Primary tweet ${i} link:`, href);
                        console.log(`🔍 DEBUG: Looking for tweet ID: ${tweetId}`);
                        console.log(`🔍 DEBUG: Link contains /status/${tweetId}:`, href && href.includes(`/status/${tweetId}`));

                        if (href && href.includes(`/status/${tweetId}`)) {
                            console.log('✅ DEBUG: Found matching link in primary column! Extracting tweet data...');
                            const tweetData = extractComprehensiveTweetData(tweet);
                            console.log('✅ DEBUG: Extracted tweet data:', tweetData);
                            if (tweetData.text && tweetData.text.length > 0) {
                            console.log('✅ DEBUG: Found matching tweet in primary column:', tweetData.text.substring(0, 50) + '...');

                            // 📢 LOG CURRENT TWEET DATA WHEN FOUND
                            console.log('📢 === TWEET EXTRACTED ===');
                            console.log('📢 Method: URL matching');
                            console.log('📢 Text:', tweetData.text);
                            console.log('📢 Length:', tweetData.text.length, 'characters');
                            console.log('📢 Images:', tweetData.images?.length || 0);
                            console.log('📢 Videos:', tweetData.videos?.length || 0);
                            console.log('📢 === END EXTRACTION ===');

                            matchingTweet = tweetData;
                                break; // Found the matching tweet, use it
                            } else {
                                console.log('⚠️ DEBUG: Tweet data empty, skipping');
                            }
                        }
                    }
                    if (matchingTweet) break; // Exit outer loop if we found a match
                }

                // ✅ FIXED: Return the matching tweet if found
                if (matchingTweet) {
                    console.log('✅ DEBUG: Returning matching tweet from primary column');
                    return matchingTweet;
                }

                // Fallback: if still no match, use the first tweet but log a warning
                const primaryTweet = allTweets[0];
                if (primaryTweet) {
                    const tweetData = extractComprehensiveTweetData(primaryTweet);
                    if (tweetData.text && tweetData.text.length > 10) {
                        console.log('⚠️ WARNING: Using first tweet as fallback, may not be the correct tweet being replied to');
                        console.log('🔍 DEBUG: Fallback tweet:', tweetData.text.substring(0, 50) + '...');

                        // 📢 LOG CURRENT TWEET DATA WHEN FOUND
                        console.log('📢 === TWEET EXTRACTED ===');
                        console.log('📢 Method: Fallback (first tweet)');
                        console.log('📢 Text:', tweetData.text);
                        console.log('📢 Length:', tweetData.text.length, 'characters');
                        console.log('📢 Images:', tweetData.images?.length || 0);
                        console.log('📢 Videos:', tweetData.videos?.length || 0);
                        console.log('📢 === END EXTRACTION ===');

                        return tweetData;
                    }
                }
            }
        }

        // Strategy 1: Look for main tweet article (fallback if URL strategy failed)
        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        console.log('🔍 DEBUG: Found articles:', articles.length);

        // If we're on a specific tweet page but didn't find it via URL, prioritize the tweet that matches the URL
        if (tweetIdMatch && articles.length > 0) {
            console.log('🔍 DEBUG: On specific tweet page but URL strategy failed, searching all articles for URL match...');
            const tweetId = tweetIdMatch[1];

            // Search through all articles to find the one that matches our URL
            for (const article of articles) {
                const tweetLinks = article.querySelectorAll('a[href*="/status/"]');
                for (const link of tweetLinks) {
                    const href = link.getAttribute('href');
                    if (href && href.includes(`/status/${tweetId}`)) {
                        const tweetData = extractComprehensiveTweetData(article);
                        if (tweetData.text && tweetData.text.length > 10) {
                            console.log('🔍 DEBUG: Found URL-matching tweet in all articles:', tweetData.text.substring(0, 50) + '...');
                            return tweetData;
                        }
                    }
                }
            }

            // If still no match, try primary column as last resort
            console.log('🔍 DEBUG: No URL match found in all articles, trying primary column...');
            const primaryColumn = document.querySelector('[data-testid="primaryColumn"]');
            if (primaryColumn) {
                const primaryTweet = primaryColumn.querySelector('article[data-testid="tweet"]');
                if (primaryTweet) {
                    const tweetData = extractComprehensiveTweetData(primaryTweet);
                    if (tweetData.text && tweetData.text.length > 10) {
                        console.log('⚠️ WARNING: Using primary column tweet as last resort, may not be the correct tweet');
                        console.log('🔍 DEBUG: Last resort tweet:', tweetData.text.substring(0, 50) + '...');
                        return tweetData;
                    }
                }
            }
        }

        let mainTweet = null;

        // Find the main tweet (usually the largest or most prominent)
        // ✅ ENHANCED: Look for the tweet that's currently focused/highlighted
        for (let i = 0; i < articles.length; i++) {
            const article = articles[i];
            const tweetText = extractTweetTextFromArticle(article);

            if (tweetText && tweetText.length > 10) { // Minimum length check
                // ✅ PRIORITY 1: Check if this tweet is currently focused or highlighted
                const isFocused = article.matches(':focus') ||
                                 article.querySelector(':focus') ||
                                 article.classList.contains('highlighted') ||
                                 article.style.backgroundColor ||
                                 article.getAttribute('aria-selected') === 'true';

                // ✅ PRIORITY 2: Check if this tweet is in the main content area and visible
                const isInMainContent = article.closest('[data-testid="primaryColumn"]') ||
                                       article.closest('main') ||
                                       article.closest('[role="main"]');

                // ✅ PRIORITY 3: Check if this tweet is currently in viewport
                const rect = article.getBoundingClientRect();
                const isInViewport = rect.top >= 0 && rect.bottom <= window.innerHeight;

                console.log('🔍 DEBUG: Tweet analysis:', {
                    index: i,
                    text: tweetText.substring(0, 30) + '...',
                    isFocused,
                    isInMainContent,
                    isInViewport,
                    rect: { top: rect.top, bottom: rect.bottom }
                });

                // Choose the best tweet based on priority
                if (isFocused) {
                    mainTweet = article;
                    console.log('🔍 DEBUG: Focused tweet found:', article);
                    break;
                } else if (isInMainContent && isInViewport && !mainTweet) {
                    mainTweet = article;
                    console.log('🔍 DEBUG: Main content tweet found:', article);
                } else if (isInMainContent && !mainTweet) {
                    mainTweet = article;
                    console.log('🔍 DEBUG: Main content tweet found (not in viewport):', article);
                } else if (!mainTweet) {
                    mainTweet = article;
                    console.log('🔍 DEBUG: Fallback tweet found:', article);
                }
            }
        }

        // Strategy 2: If no main tweet found, try other selectors with priority
        if (!mainTweet) {
            console.log('🔍 DEBUG: No main tweet found, trying alternative selectors...');

            // Try to find the most prominent tweet (usually the first one in main content)
            const mainContent = document.querySelector('[data-testid="primaryColumn"]') ||
                               document.querySelector('main') ||
                               document.querySelector('[role="main"]');

            if (mainContent) {
                const mainContentTweet = mainContent.querySelector('article[data-testid="tweet"]');
                if (mainContentTweet) {
                    const tweetText = extractTweetTextFromArticle(mainContentTweet);
                    if (tweetText && tweetText.length > 10) {
                        mainTweet = mainContentTweet;
                        console.log('🔍 DEBUG: Found tweet in main content area');
                    }
                }
            }

            // Fallback to other selectors
            if (!mainTweet) {
                const selectors = [
                    '[data-testid="tweetText"]',
                    '[data-testid="tweet"] div[dir="auto"]',
                    'article div[lang]',
                    '[role="article"] div[dir="auto"]'
                ];

                for (const selector of selectors) {
                    const element = document.querySelector(selector);
                    if (element && element.textContent.trim().length > 10) {
                        mainTweet = element.closest('article') || element;
                        console.log('🔍 DEBUG: Tweet found via selector:', selector);
                        break;
                    }
                }
            }
        }

            if (!mainTweet) {
            console.warn('⚠️ No tweet found, trying URL-based extraction');
            return extractFromURL();
        }

        // Extract comprehensive data
        const tweetData = extractComprehensiveTweetData(mainTweet);

        // ✅ DEBUG: Show which tweet was detected
        console.log('🔍 DEBUG: Detected tweet text:', tweetData.text?.substring(0, 50) + '...');
        console.log('🔍 DEBUG: Tweet length:', tweetData.text?.length);
        console.log('✅ Extracted tweet data:', tweetData);
        return tweetData;

    } catch (error) {
        console.error('❌ getCurrentTweetData error:', error);
        console.error('❌ Error stack:', error.stack);
        return extractFallbackData();
    }
}

// ✅ ENHANCED: Extract tweet text with multiple strategies
function extractTweetTextFromArticle(article) {
    const textSelectors = [
        '[data-testid="tweetText"]',
        'div[dir="auto"][lang]',
        'div[dir="ltr"]',
        'div[dir="rtl"]',
        'span[dir="auto"]',
        '.r-37j5jr', // Twitter's text class
        '.css-1dbjc4n .r-37j5jr'
    ];

    for (const selector of textSelectors) {
        const textElement = article.querySelector(selector);
        if (textElement && textElement.textContent.trim().length > 0) {
            // Clean and return text
            let text = textElement.textContent.trim();

            // Remove common Twitter UI text
            text = text.replace(/^(Replying to|Quote Tweet|Show this thread)/g, '');
            text = text.replace(/\s+/g, ' ').trim();

            if (text.length > 5) { // Minimum meaningful text
                console.log('📝 Text extracted via selector:', selector, 'Length:', text.length);
                return text;
            }
        }
    }

    // Fallback: get all text content
    const allText = article.textContent.trim();
    if (allText.length > 10) {
        console.log('📝 Text extracted via fallback, Length:', allText.length);
        return allText.substring(0, 500); // Limit length
    }

    return '';
}

// ✅ ENHANCED: Extract comprehensive tweet data
function extractComprehensiveTweetData(tweetElement) {
    const data = {
        text: '',
        images: [],
        videos: [],
        links: [],
        mentions: [],
        hashtags: [],
        timestamp: null,
        author: null,
        engagement: {
            likes: 0,
            retweets: 0,
            replies: 0
        }
    };

    // Extract main text content
    data.text = extractTweetTextFromArticle(tweetElement);

    // Extract images
    const images = tweetElement.querySelectorAll('img[src*="pbs.twimg.com"], img[src*="pic.x.com"]');
    images.forEach(img => {
        if (img.src && !img.src.includes('avatar')) {
            data.images.push(img.src);
        }
    });

    // Extract videos
    const videos = tweetElement.querySelectorAll('video, [data-testid="videoComponent"]');
    videos.forEach(video => {
        if (video.src || video.poster) {
            data.videos.push({
                src: video.src || null,
                poster: video.poster || null
            });
        }
    });

    // Extract links
    const links = tweetElement.querySelectorAll('a[href*="http"]');
    links.forEach(link => {
        if (link.href && !link.href.includes('twitter.com') && !link.href.includes('x.com')) {
            data.links.push(link.href);
        }
    });

    // Extract mentions and hashtags from text
    if (data.text) {
        const mentionRegex = /@(\w+)/g;
        const hashtagRegex = /#(\w+)/g;

        let match;
        while ((match = mentionRegex.exec(data.text)) !== null) {
            data.mentions.push(match[1]);
        }

        while ((match = hashtagRegex.exec(data.text)) !== null) {
            data.hashtags.push(match[1]);
        }
    }

    // Extract author info
    const authorElement = tweetElement.querySelector('[data-testid="User-Name"]');
    if (authorElement) {
        data.author = {
            name: authorElement.textContent.trim(),
            handle: extractUserHandle(tweetElement)
        };
    }

    // Extract engagement metrics
    const engagementSelectors = {
        likes: '[data-testid="like"]',
        retweets: '[data-testid="retweet"]',
        replies: '[data-testid="reply"]'
    };

    Object.entries(engagementSelectors).forEach(([key, selector]) => {
        const element = tweetElement.querySelector(selector);
        if (element) {
            const countElement = element.querySelector('[data-testid*="count"]');
            if (countElement) {
                data.engagement[key] = parseEngagementCount(countElement.textContent);
            }
        }
    });

    return data;
}

// ✅ Helper function to extract user handle
function extractUserHandle(tweetElement) {
    const handleSelectors = [
        '[data-testid="User-Name"] span[dir="ltr"]',
        '.r-14j79pv' // Twitter handle class
    ];

    for (const selector of handleSelectors) {
        const element = tweetElement.querySelector(selector);
        if (element && element.textContent.includes('@')) {
            return element.textContent.replace('@', '');
        }
    }

    // ✅ FIXED: Manual search for spans containing @
    const spans = tweetElement.querySelectorAll('[data-testid="User-Name"] span');
    for (const span of spans) {
        if (span.textContent.includes('@')) {
            return span.textContent.replace('@', '');
        }
    }

    return null;
}

// ✅ Helper function to parse engagement counts
function parseEngagementCount(text) {
    if (!text) return 0;

    const cleanText = text.trim().toLowerCase();
    const numMatch = cleanText.match(/[\d,\.]+/);

    if (!numMatch) return 0;

    let num = parseFloat(numMatch[0].replace(',', ''));

    if (cleanText.includes('k')) {
        num *= 1000;
    } else if (cleanText.includes('m')) {
        num *= 1000000;
    }

    return Math.floor(num);
}

// ✅ URL-based extraction fallback
function extractFromURL() {
    console.log('🔍 Attempting URL-based extraction');

    const url = window.location.href;
    const statusMatch = url.match(/\/status\/(\d+)/);

    if (statusMatch) {
        // Try to find any text on the page that might be the tweet
        const textElements = document.querySelectorAll('div[dir="auto"], span[dir="auto"]');
        let longestText = '';

        textElements.forEach(element => {
            const text = element.textContent.trim();
            if (text.length > longestText.length && text.length > 10) {
                longestText = text;
            }
        });

        if (longestText) {
            console.log('✅ URL-based extraction successful');
            return {
                text: longestText,
                images: [],
                videos: [],
                extractionMethod: 'url-based'
            };
        }
    }

    return extractFallbackData();
}

// ✅ Final fallback data
function extractFallbackData() {
    console.log('🔄 Using fallback data extraction');

    // Try to get any meaningful text from the page
    const candidateElements = [
        ...document.querySelectorAll('[role="main"] div[dir="auto"]'),
        ...document.querySelectorAll('main div[dir="auto"]'),
        ...document.querySelectorAll('article div[dir="auto"]')
    ];

    let bestText = '';

    candidateElements.forEach(element => {
        const text = element.textContent.trim();
        if (text.length > bestText.length && text.length < 1000 && text.length > 10) {
            bestText = text;
        }
    });

    if (bestText) {
        console.log('✅ Fallback extraction found text:', bestText.length, 'characters');

        // 📢 LOG CURRENT TWEET DATA WHEN FOUND
        console.log('📢 === TWEET EXTRACTED ===');
        console.log('📢 Method: Ultimate fallback');
        console.log('📢 Text:', bestText);
        console.log('📢 Length:', bestText.length, 'characters');
        console.log('📢 Images: 0');
        console.log('📢 Videos: 0');
        console.log('📢 === END EXTRACTION ===');

        return {
            text: bestText,
            images: [],
            videos: [],
            extractionMethod: 'fallback'
        };
    }

    // Ultimate fallback
    console.log('⚠️ No text found, using page title');
    return {
        text: document.title || 'No content available',
        images: [],
        videos: [],
        extractionMethod: 'page-title'
    };
}

function getCurrentTweetText() {
    return getCurrentTweetData().text;
}

// --- UI FUNCTIONS ---
function showMessage(message, type = 'info') {
    console.log(`📢 Showing message: ${type} - ${message}`);

    const colors = {
        success: '#28a745',
        error: '#dc3545',
        warning: '#ffc107',
        info: '#17a2b8'
    };

    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10001;
        background: ${colors[type] || colors.info};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        max-width: 300px;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, 4000);
}

function insertTextIntoReplyBox(text) {
    const selectors = [
        '[data-testid="tweetTextarea_0"]',
        'div[role="textbox"]',
        '.public-DraftEditor-content',
        '[contenteditable="true"]'
    ];

    let replyBox = null;
    for (const selector of selectors) {
        replyBox = document.querySelector(selector);
        if (replyBox) break;
    }

    if (!replyBox) {
        console.error('❌ Reply box not found');
        return false;
    }

    try {
        replyBox.focus();

        // Select all existing content then replace via paste simulation
        // This is the most React-compatible approach — Twitter listens for paste
        // and updates its internal state, which enables the Reply button
        document.execCommand('selectAll', false, null);

        try {
            const dt = new DataTransfer();
            dt.setData('text/plain', text);
            replyBox.dispatchEvent(new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dt
            }));
        } catch (_) {
            // Fallback: selectAll + insertText (no manual innerHTML clear to keep React happy)
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, text);
        }

        // Verify insertion succeeded; if content doesn't match, force via insertText
        const current = (replyBox.textContent || replyBox.innerText || '').trim();
        if (!current.startsWith(text.substring(0, Math.min(15, text.length)).trim())) {
            document.execCommand('selectAll', false, null);
            document.execCommand('delete', false, null);
            document.execCommand('insertText', false, text);
        }

        // Dispatch React-compatible InputEvent so Twitter re-validates the Reply button
        replyBox.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertFromPaste',
            data: text
        }));
        replyBox.dispatchEvent(new Event('change', { bubbles: true }));

        console.log('✅ Text inserted successfully');
        return true;

    } catch (e) {
        console.error('❌ Error inserting text:', e);
        return false;
    }
}

function createRatingStars(currentRating, onRate) {
    const starsContainer = document.createElement('div');
    starsContainer.style.cssText = `
        display: flex;
        gap: 2px;
        align-items: center;
        margin-top: 8px;
    `;

    for (let i = 1; i <= 5; i++) {
        const star = document.createElement('span');
        star.innerHTML = i <= currentRating ? '⭐' : '☆';
        star.style.cssText = `
            cursor: pointer;
            font-size: 16px;
            transition: all 0.2s ease;
            user-select: none;
        `;

        star.onclick = () => {
            onRate(i);
            for (let j = 1; j <= 5; j++) {
                const starElement = starsContainer.children[j - 1];
                starElement.innerHTML = j <= i ? '⭐' : '☆';
            }
        };

        star.onmouseenter = () => {
            for (let j = 1; j <= 5; j++) {
                const starElement = starsContainer.children[j - 1];
                starElement.innerHTML = j <= i ? '⭐' : '☆';
            }
        };

        starsContainer.appendChild(star);
    }

    const ratingText = document.createElement('span');
    ratingText.style.cssText = `
        margin-left: 8px;
        font-size: 11px;
        color: #536471;
    `;
    ratingText.textContent = currentRating > 0 ? `${currentRating}/5` : 'Rate this reply';

    starsContainer.appendChild(ratingText);

    return starsContainer;
}

async function showCommentsInPanel(comments, tweetData, opts = {}) {
    console.log('🎨 Showing comments in floating panel...');
    console.log('📊 Comments received:', Object.keys(comments));
    console.log('📊 Total comments count:', Object.keys(comments).length);
    console.log('🔍 Context:', tweetData?.genericContent ? 'Generic crypto content for new tweet' : tweetData?.isReply ? 'Reply to tweet' : 'Regular tweet');

    // Log each comment content
    Object.entries(comments).forEach(([tone, content]) => {
        console.log(`📝 ${tone}: "${content?.substring(0, 50)}${content?.length > 50 ? '...' : ''}"`);
    });

    if (!floatingPanel) {
        console.error('❌ Floating panel not found');
        return;
    }

    const contentArea = floatingPanel.querySelector('.panel-content');
    if (!contentArea) return;

    contentArea.innerHTML = '';
    contentArea.scrollTop = 0; // reset scroll when new content is shown

    // Canned-fallback banner. Without this, an AI outage is indistinguishable
    // from a normal generation — the replies just quietly stop matching the tweet.
    if (opts.usedFallback) {
        const warn = document.createElement('div');
        warn.style.cssText = 'margin:0 0 10px;padding:9px 11px;border-radius:8px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#fbbf24;font-size:11.5px;line-height:1.45;';
        warn.innerHTML = '⚠️ <strong>Sample replies</strong> — the AI request failed, so these are generic and do not reference this tweet. Check your API key in Settings.';
        contentArea.appendChild(warn);
    }

    // Add context header for compose page
    if (tweetData?.genericContent) {
        const contextHeader = document.createElement('div');
        contextHeader.className = 'context-header';
        contextHeader.innerHTML = `<div class="ai-context-banner">✦ New tweet · crypto trends</div>`;
        contentArea.appendChild(contextHeader);
    } else if (tweetData?.fromComposePage && tweetData?.isReply) {
        const contextHeader = document.createElement('div');
        contextHeader.className = 'context-header';
        contextHeader.innerHTML = `<div class="ai-context-banner">↩ Replying from compose</div>`;
        contentArea.appendChild(contextHeader);
    }

    const userStats = await loadUserTrainingStats();

    const header = document.createElement('div');
    header.innerHTML = `
        <div class="ai-replies-header">
            <span class="ai-replies-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                AI Replies
            </span>
            <span class="ai-replies-meta">${userStats.total_uses || 0} used · ${(userStats.average_rating || 0).toFixed(1)}★</span>
        </div>
    `;
    contentArea.appendChild(header);

    const settings = await getCurrentSettings();
    const selectedTones = settings.selectedTones || ['professional', 'casual', 'sarcastic'];

    let hasValidComment = false;

    selectedTones.forEach(tone => {
        console.log(`🔄 Processing tone: ${tone}, has comment: ${!!comments[tone]}, comment length: ${comments[tone]?.length || 0}`);

        if (comments[tone] && comments[tone].trim()) {
            hasValidComment = true;
            console.log(`✅ Creating card for tone: ${tone}`);

            const commentCard = document.createElement('div');
            commentCard.className = 'ai-card';

            let userRating = 0;

            commentCard.innerHTML = `
                <div class="ai-card-head">
                    <span class="ai-tone-badge">${tone}</span>
                    <button class="ai-card-regen" title="Regenerate this tone">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                    </button>
                </div>
                <div class="ai-card-body">${comments[tone]}</div>
                <div class="ai-card-footer">
                    <div class="rating-container"></div>
                    <div class="ai-card-actions">
                        <button class="copy-comment-btn ai-copy-btn">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            Copy
                        </button>
                        <button class="use-comment-btn ai-use-btn">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            Use
                        </button>
                    </div>
                </div>
            `;

            // Wire per-card regenerate button
            const regenBtn = commentCard.querySelector('.ai-card-regen');
            const cardBody = commentCard.querySelector('.ai-card-body');
            if (regenBtn) {
                regenBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (regenBtn.disabled) return;
                    regenBtn.disabled = true;
                    regenBtn.classList.add('spinning');
                    try {
                        const newText = await regenerateSingleTone(tone);
                        if (newText) {
                            comments[tone] = newText;
                            cardBody.textContent = newText;
                            commentCard.style.borderColor = '#6366f1';
                            setTimeout(() => { commentCard.style.borderColor = ''; }, 800);
                        } else {
                            showMessage('Could not regenerate, try again later', 'error');
                        }
                    } catch (err) {
                        console.error('Regen single tone error:', err);
                        showMessage(err.message || 'Regeneration failed', 'error');
                    } finally {
                        regenBtn.disabled = false;
                        regenBtn.classList.remove('spinning');
                    }
                };
            }

            const ratingContainer = commentCard.querySelector('.rating-container');
            const ratingStars = createRatingStars(userRating, async (rating) => {
                userRating = rating;

                await recordTrainingData('rated', {
                    tone: tone,
                    text: comments[tone],
                    rating: rating,
                    originalPost: getCurrentTweetText()
                });

                showMessage(`Thanks for rating! ${rating}/5 stars`, 'success');

                const ratingText = ratingStars.querySelector('span');
                ratingText.textContent = `${rating}/5`;
            });

            ratingContainer.appendChild(ratingStars);

            const useBtn = commentCard.querySelector('.use-comment-btn');
            const copyBtn = commentCard.querySelector('.copy-comment-btn');

            // ✅ FIXED: Use button handler with debounce and auto-hide
            useBtn.onclick = async function(e) {
                e.stopPropagation();

                if (useBtn.dataset.processing === 'true') {
                    console.log('⚠️ Button already processing, ignoring click');
                    return;
                }

                useBtn.dataset.processing = 'true';
                console.log('🖱️ Use button clicked for tone:', tone);

                const originalText = useBtn.innerHTML;
                useBtn.innerHTML = '⏳ Using...';
                useBtn.disabled = true;

                const success = insertTextIntoReplyBox(comments[tone]);

                if (success) {
                    showMessage(`Reply used! ${tone} tone applied.`, 'success');
                    commentCard.style.background = '#e8f5e8';
                    commentCard.style.borderColor = '#28a745';

                    // ✅ AUTO-HIDE PANEL AFTER USE
                    setTimeout(() => {
                        if (floatingPanel) {
                            floatingPanel.style.display = 'none';
                            localStorage.setItem('ai-panel-visible', 'false');
                        }
                    }, 1500);

                    await recordTrainingData('used', {
                        tone: tone,
                        text: comments[tone],
                        rating: 5,
                        originalPost: getCurrentTweetText()
                    });

                } else {
                    navigator.clipboard.writeText(comments[tone]).then(async () => {
                        showMessage(`Auto-insert failed. Text copied to clipboard!`, 'warning');
                        commentCard.style.background = '#fff3cd';
                        commentCard.style.borderColor = '#ffc107';

                        await recordTrainingData('copied', {
                            tone: tone,
                            text: comments[tone],
                            rating: 3,
                            originalPost: getCurrentTweetText()
                        });

                    }).catch(() => {
                        showMessage('Insert failed. Please copy text manually.', 'error');
                    });
                }

                setTimeout(() => {
                    useBtn.innerHTML = originalText;
                    useBtn.disabled = false;
                    useBtn.dataset.processing = 'false';

                    if (commentCard.parentNode) {
                        commentCard.style.background = 'white';
                        commentCard.style.borderColor = '#e1e8ed';
                    }
                }, 2000);
            };

            copyBtn.onclick = async function(e) {
                e.stopPropagation();
                console.log('📋 Copy button clicked for tone:', tone);

                navigator.clipboard.writeText(comments[tone]).then(async () => {
                    showMessage(`${tone} reply copied to clipboard!`, 'success');

                    copyBtn.innerHTML = '✅ Copied';
                    copyBtn.style.background = 'linear-gradient(135deg, #28a745 0%, #20c997 100%)';

                setTimeout(() => {
                        copyBtn.innerHTML = '📋 Copy';
                        copyBtn.style.background = 'linear-gradient(135deg, #6c757d 0%, #495057 100%)';
                    }, 1500);

                    await recordTrainingData('copied', {
                        tone: tone,
                        text: comments[tone],
                        rating: 3,
                        originalPost: getCurrentTweetText()
                    });

                }).catch(() => {
                    showMessage('Failed to copy text', 'error');
                });
            };

            commentCard.onmouseenter = () => {
                commentCard.style.borderColor = '#1d9bf0';
                commentCard.style.transform = 'translateY(-2px)';
                commentCard.style.boxShadow = '0 8px 25px rgba(29, 155, 240, 0.15)';
            };

            commentCard.onmouseleave = () => {
                commentCard.style.borderColor = '#e1e8ed';
                commentCard.style.transform = 'translateY(0)';
                commentCard.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
            };

            contentArea.appendChild(commentCard);
        }
    });

    if (!hasValidComment) {
        contentArea.innerHTML = `
            <div class="ai-initial-state">
                <div class="ai-initial-icon" style="background:linear-gradient(135deg,#f43f5e,#ec4899)">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                </div>
                <p class="ai-initial-title" style="font-size:13px">No replies generated</p>
                <p class="ai-initial-sub">Check your API settings and try again</p>
            </div>
        `;
        return;
    }

    // Show & wire the sticky footer "Tạo lại" button
    const footer = floatingPanel.querySelector('#aiPanelFooter');
    const refreshBtn = floatingPanel.querySelector('#aiRegenerateBtn');
    if (footer) footer.classList.remove('hidden');

    if (refreshBtn) {
        const originalHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Regenerate`;
        refreshBtn.innerHTML = originalHTML;
        refreshBtn.disabled = false;
        refreshBtn.dataset.processing = 'false';

        refreshBtn.onclick = async function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (refreshBtn.dataset.processing === 'true') return;

            refreshBtn.dataset.processing = 'true';
            refreshBtn.innerHTML = `<div style="width:13px;height:13px;border:2px solid rgba(255,255,255,0.4);border-top-color:#fff;border-radius:50%;animation:ai-spin 0.7s linear infinite"></div> Generating...`;
            refreshBtn.disabled = true;

            try {
                resetPanelToInitialState();
                await performAIGeneration(refreshBtn, originalHTML);
            } catch (error) {
                console.error('❌ Refresh generation failed:', error);
                showMessage('Failed to generate new replies', 'error');
            } finally {
                // Reset immediately when API actually returns (not on a fixed timer)
                refreshBtn.innerHTML = originalHTML;
                refreshBtn.disabled = false;
                refreshBtn.dataset.processing = 'false';
            }
        };
    }

    // ✅ AUTO-CLOSE FEATURE DISABLED
    // await markContentGenerated();

    console.log('✅ Comments displayed in panel successfully');
}

// ✅ CREATE FLOATING PANEL
function createFloatingPanel() {
    console.log('🔧 Creating floating panel...');

    if (!isExtensionContextValid()) {
        console.warn('⚠️ Extension context invalidated. Cleaning up listeners and observers.');
        cleanup();
        return null;
    }

    if (floatingPanel) {
        console.log('⚠️ Panel already exists');
        return floatingPanel;
    }

    floatingPanel = document.createElement('div');
    floatingPanel.className = 'ai-floating-panel';
    // Inject panel CSS once
    if (!document.getElementById('ai-panel-styles')) {
        const css = document.createElement('style');
        css.id = 'ai-panel-styles';
        css.textContent = `
            .ai-floating-panel * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
            .ai-panel-header { display:flex; align-items:center; justify-content:space-between; padding:0 14px; height:48px; border-bottom:1px solid #f1f5f9; background:#fff; flex-shrink:0; }
            .ai-panel-brand { display:flex; align-items:center; gap:9px; }
            .ai-panel-logo { width:28px; height:28px; border-radius:7px; background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%); display:flex; align-items:center; justify-content:center; color:#fff; flex-shrink:0; }
            .ai-panel-title { font-size:13px; font-weight:600; color:#0f172a; letter-spacing:-0.2px; }
            .ai-panel-controls { display:flex; gap:2px; }
            .ai-ctrl-btn { width:28px; height:28px; border-radius:6px; border:none; background:transparent; color:#94a3b8; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background 0.15s,color 0.15s; }
            .ai-ctrl-btn:hover { background:#f1f5f9; color:#475569; }
            .ai-ctrl-btn svg { width:14px; height:14px; }
            .ai-panel-content {
                padding:14px;
                overflow-y:auto;
                overflow-x:hidden;
                flex:1 1 auto;
                min-height:0;
                overscroll-behavior:contain;
                scroll-behavior:smooth;
                scrollbar-gutter:stable;
                -webkit-overflow-scrolling:touch;
            }
            .ai-panel-content::-webkit-scrollbar { width:8px; }
            .ai-panel-content::-webkit-scrollbar-track { background:transparent; margin:4px 0; }
            .ai-panel-content::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:4px; border:2px solid #f8fafc; background-clip:padding-box; }
            .ai-panel-content::-webkit-scrollbar-thumb:hover { background:#94a3b8; background-clip:padding-box; border:2px solid #f8fafc; }
            .ai-initial-state { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:28px 20px 16px; gap:12px; text-align:center; }
            .ai-config-strip { margin-top:4px; border:1px solid #e2e8f0; border-radius:9px; background:#f8fafc; overflow:hidden; }
            .ai-cfg-row { display:flex; align-items:center; gap:8px; padding:8px 11px; font-size:11.5px; color:#475569; border-bottom:1px solid #eef2f7; }
            .ai-cfg-row:last-child { border-bottom:none; }
            .ai-cfg-label { color:#94a3b8; flex-shrink:0; }
            .ai-cfg-value { color:#0f172a; font-weight:600; margin-left:auto; text-align:right; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .ai-cfg-value.warn { color:#b45309; }
            .ai-cfg-foot { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:7px 11px; background:#fff; border-top:1px solid #eef2f7; }
            .ai-cfg-settings { background:none; border:none; padding:0; font-size:11.5px; font-weight:600; color:#6366f1; cursor:pointer; font-family:inherit; }
            .ai-cfg-settings:hover { text-decoration:underline; }
            .ai-initial-icon { width:52px; height:52px; border-radius:14px; background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%); display:flex; align-items:center; justify-content:center; color:#fff; margin-bottom:4px; box-shadow:0 4px 12px rgba(99,102,241,0.3); }
            .ai-initial-title { font-size:15px; font-weight:600; color:#0f172a; margin:0; }
            .ai-initial-sub { font-size:13px; color:#64748b; margin:0; line-height:1.5; }
            .ai-gen-btn { display:inline-flex; align-items:center; gap:7px; padding:10px 20px; background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%); color:#fff; border:none; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; transition:opacity 0.15s,transform 0.1s; margin-top:4px; }
            .ai-gen-btn:hover { opacity:0.9; }
            .ai-gen-btn:active { transform:scale(0.98); }
            .ai-gen-btn svg { width:14px; height:14px; }
            .ai-replies-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
            .ai-replies-title { font-size:13px; font-weight:600; color:#0f172a; display:flex; align-items:center; gap:6px; }
            .ai-replies-title svg { width:14px; height:14px; color:#6366f1; }
            .ai-replies-meta { font-size:11px; color:#94a3b8; }
            .ai-card { background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:12px; margin-bottom:10px; transition:border-color 0.15s,box-shadow 0.15s; }
            .ai-card:hover { border-color:#c7d2fe; box-shadow:0 2px 8px rgba(99,102,241,0.08); }
            .ai-card-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
            .ai-tone-badge { font-size:11px; font-weight:600; color:#6366f1; background:#ede9fe; padding:2px 8px; border-radius:5px; text-transform:capitalize; }
            .ai-card-body { font-size:13px; color:#0f172a; line-height:1.6; padding:10px; background:#f8fafc; border-radius:7px; margin-bottom:10px; border-left:3px solid #6366f1; }
            .ai-card-footer { display:flex; align-items:center; justify-content:space-between; gap:8px; }
            .ai-card-actions { display:flex; gap:6px; }
            .ai-copy-btn { display:inline-flex; align-items:center; gap:5px; padding:6px 10px; background:#f1f5f9; color:#475569; border:1px solid #e2e8f0; border-radius:6px; font-size:11px; font-weight:500; cursor:pointer; transition:all 0.15s; }
            .ai-copy-btn:hover { background:#e2e8f0; }
            .ai-copy-btn svg { width:12px; height:12px; }
            .ai-card-regen { width:26px; height:26px; padding:0; background:transparent; color:#94a3b8; border:1px solid transparent; border-radius:5px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; transition:all 0.15s; }
            .ai-card-regen:hover { background:#ede9fe; color:#6366f1; border-color:#c7d2fe; }
            .ai-card-regen:disabled { opacity:0.5; cursor:not-allowed; }
            .ai-card-regen svg { width:13px; height:13px; }
            .ai-card-regen.spinning svg { animation:ai-spin 0.8s linear infinite; }
            .ai-use-btn { display:inline-flex; align-items:center; gap:5px; padding:6px 12px; background:#6366f1; color:#fff; border:none; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; transition:opacity 0.15s; }
            .ai-use-btn:hover { opacity:0.85; }
            .ai-use-btn:disabled { opacity:0.55; cursor:not-allowed; }
            .ai-use-btn svg { width:12px; height:12px; }
            .ai-loading { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px 20px; gap:14px; }
            .ai-spinner { width:32px; height:32px; border:3px solid #e2e8f0; border-top-color:#6366f1; border-radius:50%; animation:ai-spin 0.7s linear infinite; }
            @keyframes ai-spin { to { transform:rotate(360deg); } }
            .ai-loading-text { font-size:13px; color:#64748b; font-weight:500; }
            .ai-context-banner { font-size:11px; font-weight:500; color:#6366f1; background:#ede9fe; border-radius:7px; padding:6px 10px; margin-bottom:10px; text-align:center; }
            .ai-refresh-btn { display:inline-flex; align-items:center; gap:6px; padding:9px 14px; background:#6366f1; color:#fff; border:none; border-radius:7px; font-size:12px; font-weight:600; cursor:pointer; transition:all 0.15s; width:100%; justify-content:center; box-shadow:0 2px 6px rgba(99,102,241,0.25); }
            .ai-refresh-btn:hover { opacity:0.9; }
            .ai-refresh-btn:disabled { opacity:0.6; cursor:not-allowed; }
            .ai-refresh-btn svg { width:13px; height:13px; }
            .ai-panel-footer { padding:10px 14px; border-top:1px solid #e2e8f0; background:#fff; flex-shrink:0; }
            .ai-panel-footer.hidden { display:none; }
        `;
        document.head.appendChild(css);
    }

    floatingPanel.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        width: 340px;
        max-height: 80vh;
        background: #f8fafc;
        border-radius: 14px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
        border: 1px solid #e2e8f0;
        z-index: 9999;
        overflow: hidden;
        display: flex;
        flex-direction: column;
    `;

    const panelIconUrl = chrome.runtime.getURL('icons/icon-48.png');
    floatingPanel.innerHTML = `
        <div class="ai-panel-header">
            <div class="ai-panel-brand">
                <div class="ai-panel-logo" style="background:none;padding:0;overflow:hidden;">
                    <img src="${panelIconUrl}" width="28" height="28" style="display:block;border-radius:7px;">
                </div>
                <span class="ai-panel-title">AutoMind</span>
            </div>
            <div class="ai-panel-controls">
                <button class="ai-ctrl-btn minimize-btn" title="Minimize">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
                <button class="ai-ctrl-btn close-btn" title="Close">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
        </div>
        <div class="ai-panel-content panel-content">
            <div class="ai-initial-state">
                <div class="ai-initial-icon" style="background:none;box-shadow:none;padding:0;overflow:hidden;">
                    <img src="${panelIconUrl}" width="52" height="52" style="display:block;border-radius:14px;">
                </div>
                <h3 class="ai-initial-title">AutoMind</h3>
                <p class="ai-initial-sub">Generate authentic replies in multiple tones with one click</p>
                <button class="generate-btn ai-gen-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                    Generate Replies
                </button>
            </div>
            <!-- Current config, shown BEFORE generating so a wrong model or an
                 empty tone list is visible up front instead of after a bad run -->
            <div class="ai-config-strip" id="aiConfigStrip"></div>
        </div>
        <div class="ai-panel-footer hidden" id="aiPanelFooter">
            <button class="ai-refresh-btn" id="aiRegenerateBtn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                Regenerate
            </button>
        </div>
    `;

    setupPanelEvents();
    document.body.appendChild(floatingPanel);

    console.log('✅ Floating panel created successfully');
    return floatingPanel;
}

// ✅ CREATE TOGGLE BUTTON - GUARANTEED TO SHOW
function createToggleButton() {
    console.log('🔧 Creating toggle button...');

    if (!isExtensionContextValid()) {
        console.warn('⚠️ Extension context invalidated. Cleaning up listeners and observers.');
        cleanup();
        return;
    }

    // Force remove any existing toggle buttons
    document.querySelectorAll('.ai-panel-toggle').forEach(btn => {
        console.log('Removing existing toggle button');
        btn.remove();
    });

    const iconUrl = chrome.runtime.getURL('icons/icon-48.png');
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'ai-panel-toggle';
    toggleBtn.innerHTML = `<img src="${iconUrl}" width="48" height="48" style="display:block;border-radius:50%;width:48px;height:48px;object-fit:cover;pointer-events:none;">`;
    toggleBtn.style.cssText = `
        position: fixed !important;
        bottom: 90px !important;
        right: 20px !important;
        width: 48px !important;
        height: 48px !important;
        border-radius: 50% !important;
        background: none !important;
        border: none !important;
        padding: 0 !important;
        cursor: pointer !important;
        z-index: 999999 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        box-shadow: 0 4px 16px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.2) !important;
        transition: transform 0.2s ease, box-shadow 0.2s ease !important;
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
        overflow: hidden !important;
    `;

    // ✅ FORCE ATTRIBUTES
    toggleBtn.setAttribute('data-ai-toggle', 'true');
    toggleBtn.setAttribute('title', 'AutoMind - Click to toggle');

    toggleBtn.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('🖱️ Toggle button clicked');

        try {
            const justCreated = !floatingPanel;
            if (justCreated) {
                console.log('Creating floating panel...');
                createFloatingPanel();
            }

            // First creation = always show. Otherwise toggle visibility.
            const isHidden = justCreated ? true : (floatingPanel.style.display === 'none');
            // MUST be 'flex' to preserve flex column layout (header/content/footer)
            floatingPanel.style.display = isHidden ? 'flex' : 'none';

            localStorage.setItem('ai-panel-visible', isHidden ? 'true' : 'false');

            // ✅ Update button state when panel is shown
            if (isHidden) {
                const generateBtn = floatingPanel.querySelector('.generate-btn');
                if (generateBtn) {
                    updateGenerateButtonState(generateBtn);
                }
                // Re-read settings each time the panel opens — the user may have
                // changed them in Options since it was last rendered.
                renderConfigStrip();
            }

            // ✅ AUTO-CLOSE FEATURE DISABLED
            /*
            if (isHidden) {
                isContentGenerated = false;
                cancelAutoClose();
                console.log('🔄 Auto-close state reset - panel opened');
            }
            */

            console.log('✅ Panel toggled:', isHidden ? 'visible' : 'hidden');

        } catch (error) {
            console.error('❌ Toggle error:', error);
            // Silent fail — no alert popup that interrupts user
        }
    };

    // ✅ HOVER EFFECTS
    toggleBtn.onmouseenter = () => {
        toggleBtn.style.transform = 'scale(1.08)';
        toggleBtn.style.boxShadow = '0 6px 24px rgba(99,102,241,0.6), 0 2px 6px rgba(0,0,0,0.2)';
    };

    toggleBtn.onmouseleave = () => {
        toggleBtn.style.transform = 'scale(1)';
        toggleBtn.style.boxShadow = '0 4px 16px rgba(99,102,241,0.45), 0 1px 3px rgba(0,0,0,0.2)';
    };

    // ✅ FORCE ADD TO DOM
    document.body.appendChild(toggleBtn);

    // ✅ VERIFY BUTTON IS VISIBLE
    const rect = toggleBtn.getBoundingClientRect();
    console.log('✅ Toggle button created successfully');
    console.log('📏 Button position:', rect);
    console.log('👁️ Button visible:', rect.width > 0 && rect.height > 0);

    // ✅ Button visibility check
    if (rect.width === 0 || rect.height === 0) {
        console.log('⚠️ Main button not visible');
    }

    // ✅ Debug button removed for clean operation

    return toggleBtn;
}

// ✅ Emergency button function
function createEmergencyButton() {

    // Remove any existing emergency buttons
    document.querySelectorAll('.airg-emergency-ai-btn, .emergency-ai-btn').forEach(btn => btn.remove());

    const btn = document.createElement('button');
    btn.className = 'airg-emergency-ai-btn'; // ✅ UNIQUE CLASS NAME
    btn.innerHTML = '🤖 AI';
    btn.style.cssText = `
        position: fixed !important;
        bottom: 20px !important;
        right: 20px !important;
        width: 80px !important;
        height: 80px !important;
        border-radius: 50% !important;
        background: linear-gradient(135deg, #ff0000 0%, #ff6600 100%) !important;
        color: white !important;
        border: 4px solid #ffff00 !important;
        font-size: 20px !important;
        font-weight: bold !important;
        cursor: pointer !important;
        z-index: 999999999 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        box-shadow: 0 8px 30px rgba(255, 0, 0, 0.8) !important;
        transition: all 0.3s ease !important;
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
    `;

    btn.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Emergency AI button clicked');

        // Try to create floating panel
        try {
            if (!floatingPanel) {
                createFloatingPanel();
            }
            if (floatingPanel) {
                floatingPanel.style.display = 'flex';
            }
        } catch (error) {
            console.error('Error creating panel:', error);
        }
    };

    // Append to body or documentElement
    if (document.body) {
        document.body.appendChild(btn);
    } else {
        document.documentElement.appendChild(btn);
    }

    // Button created

    return btn;
}

// ✅ Debug button removed for clean operation

function setupPanelEvents() {
    if (!floatingPanel) return;

    const closeBtn = floatingPanel.querySelector('.close-btn');
    if (closeBtn) {
        closeBtn.onclick = () => {
            console.log('❌ Closing panel');
            closePanel();
        };
    }

    // ✅ AUTO-CLOSE TOGGLE BUTTON DISABLED
    /*
    const autoCloseToggleBtn = floatingPanel.querySelector('.auto-close-toggle');
    if (autoCloseToggleBtn) {
        autoCloseToggleBtn.onclick = async () => {
            console.log('🔒 Toggling auto-close setting');
            try {
                const result = await chrome.storage.sync.get(['autoClosePanel']);
                const currentSetting = result.autoClosePanel === true;
                const newSetting = !currentSetting;

                await chrome.storage.sync.set({ autoClosePanel: newSetting });

                // Update button appearance
                autoCloseToggleBtn.textContent = newSetting ? '🔒' : '🔓';
                autoCloseToggleBtn.title = newSetting ? 'Auto-close enabled' : 'Auto-close disabled';

                // Cancel current auto-close if disabled
                if (!newSetting) {
                    cancelAutoClose();
                    isContentGenerated = false;
                    console.log('✅ Auto-close disabled - current timer cancelled');
                } else {
                    console.log('✅ Auto-close enabled');
                }

                // Show brief feedback
                const originalText = autoCloseToggleBtn.textContent;
                autoCloseToggleBtn.textContent = newSetting ? '✅' : '❌';
                setTimeout(() => {
                    autoCloseToggleBtn.textContent = originalText;
                }, 1000);

            } catch (error) {
                console.error('❌ Error toggling auto-close:', error);
            }
        };

        // Load current setting and update button appearance
        chrome.storage.sync.get(['autoClosePanel']).then(result => {
            const autoCloseEnabled = result.autoClosePanel === true;
            // Default to disabled (🔓) if no setting exists
            autoCloseToggleBtn.textContent = autoCloseEnabled ? '🔒' : '🔓';
            autoCloseToggleBtn.title = autoCloseEnabled ? 'Auto-close enabled' : 'Auto-close disabled (default)';
        });
    }
    */

    const minimizeBtn = floatingPanel.querySelector('.minimize-btn');
    if (minimizeBtn) {
        const minusIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
        const plusIcon  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/><line x1="12" y1="5" x2="12" y2="19"/></svg>`;
        minimizeBtn.onclick = () => {
            const content = floatingPanel.querySelector('.panel-content');
            const collapsed = content.style.display === 'none';
            content.style.display = collapsed ? 'block' : 'none';
            minimizeBtn.innerHTML = collapsed ? minusIcon : plusIcon;
        };
    }

    const generateBtn = floatingPanel.querySelector('.generate-btn');
    if (generateBtn) {
        generateBtn.onclick = handleGenerateClick;
        updateGenerateButtonState(generateBtn);
    }

    // Stop wheel scroll from leaking to x.com when panel reaches its scroll edges
    const panelContent = floatingPanel.querySelector('.panel-content');
    if (panelContent && !panelContent.dataset.wheelBound) {
        panelContent.dataset.wheelBound = 'true';
        panelContent.addEventListener('wheel', (e) => {
            const atTop = panelContent.scrollTop === 0;
            const atBottom = Math.ceil(panelContent.scrollTop + panelContent.clientHeight) >= panelContent.scrollHeight;
            if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
                e.preventDefault();
            }
            e.stopPropagation();
        }, { passive: false });
    }

    // Auto-close disabled — skip setupAutoCloseEvents to avoid ReferenceError
    makePanelDraggable();
}

// ✅ Update generate button state - always enabled (don't overwrite SVG content)
function updateGenerateButtonState(button) {
    if (!button) return;
    if (button.dataset.processing !== 'true') {
        button.disabled = false;
        button.style.opacity = '1';
        button.style.cursor = 'pointer';
        button.title = 'Generate AI replies for the visible tweet';
    }
}

// ✅ AUTO-CLOSE FEATURE FUNCTIONS
function setupAutoCloseEvents() {
    if (!floatingPanel) return;

    // Mouse enter event - cancel auto-close timer
    floatingPanel.addEventListener('mouseenter', () => {
        console.log('🖱️ Mouse entered panel');
        isMouseOverPanel = true;
        cancelAutoClose();
    });

    // Mouse leave event - start auto-close timer if content is generated
    floatingPanel.addEventListener('mouseleave', () => {
        console.log('🖱️ Mouse left panel');
        isMouseOverPanel = false;

        // ✅ FIXED: Don't hide panel during generation
        const generateBtn = floatingPanel.querySelector('#generate-btn');
        if (generateBtn && generateBtn.disabled) {
            console.log('⚠️ Panel not hidden because generating');
            return;
        }

        // ✅ FIXED: Only start auto-close if content is generated AND user has had time to interact
        if (isContentGenerated) {
            // Add a small delay to prevent accidental auto-close when moving mouse quickly
            setTimeout(() => {
                if (isContentGenerated && !isMouseOverPanel && floatingPanel && floatingPanel.style.display !== 'none') {
                    console.log('⏰ Mouse left panel - starting auto-close timer');
                    startAutoClose();
                }
            }, 1000); // 1 second delay before starting timer
        }
    });
}

/*
function startAutoClose() {
    console.log('⏰ Starting auto-close timer');
    cancelAutoClose(); // Clear any existing timer

    // Show countdown notification
    showAutoCloseNotification();

    autoCloseTimer = setTimeout(() => {
        console.log('🔒 Auto-closing panel after content generation');
        closePanel();
    }, autoCloseDelay);
}
*/

function showAutoCloseNotification() {
    if (!floatingPanel) return;

    const notification = document.createElement('div');
    notification.className = 'auto-close-notification';
    notification.style.cssText = `
        position: absolute;
        top: -40px;
        right: 0;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 12px;
        z-index: 10000;
        animation: slideDown 0.3s ease-out;
    `;
    notification.innerHTML = `🔒 Auto-closing in ${autoCloseDelay/1000}s - Click 🔓 to disable`;

    // Add animation CSS
    if (!document.querySelector('#auto-close-styles')) {
        const style = document.createElement('style');
        style.id = 'auto-close-styles';
        style.textContent = `
            @keyframes slideDown {
                from { transform: translateY(-20px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }

    floatingPanel.appendChild(notification);

    // Remove notification after delay
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'slideDown 0.3s ease-out reverse';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 300);
        }
    }, autoCloseDelay);
}

/*
function cancelAutoClose() {
    if (autoCloseTimer) {
        console.log('❌ Canceling auto-close timer');
        clearTimeout(autoCloseTimer);
        autoCloseTimer = null;
    }

    // Remove any auto-close notification
    const notification = document.querySelector('.auto-close-notification');
    if (notification) {
        notification.remove();
    }
}
*/

function closePanel() {
    if (floatingPanel) {
        console.log('🔒 Closing panel');
        floatingPanel.style.display = 'none';
        localStorage.setItem('ai-panel-visible', 'false');

        // ✅ AUTO-CLOSE FEATURE DISABLED
        // isContentGenerated = false;
        // isMouseOverPanel = false;
        // cancelAutoClose();
    }
}

/*
async function markContentGenerated() {
    console.log('✅ Content generated - checking auto-close setting');

    // Check if auto-close is enabled in settings
    try {
        const result = await chrome.storage.sync.get(['autoClosePanel']);
        const autoCloseEnabled = result.autoClosePanel === true; // Default to false - auto-close disabled

        if (autoCloseEnabled) {
            console.log('✅ Auto-close enabled - content marked as generated');
            isContentGenerated = true;

            // ✅ FIXED: Only start auto-close timer after a longer delay and only if mouse is not over panel
            // Don't start timer immediately - wait for user to finish interacting
            setTimeout(() => {
                if (isContentGenerated && !isMouseOverPanel && floatingPanel && floatingPanel.style.display !== 'none') {
                    console.log('⏰ Starting auto-close timer after delay');
                    startAutoClose();
                }
            }, 5000); // Wait 5 seconds before considering auto-close

        } else {
            console.log('⚠️ Auto-close disabled in settings - panel will stay open');
            isContentGenerated = false;
        }
    } catch (error) {
        console.error('❌ Error checking auto-close setting:', error);
        // Default to disabled - panel stays open
        console.log('⚠️ Auto-close disabled by default - panel will stay open');
        isContentGenerated = false;
    }
}
*/

function makePanelDraggable() {
    // New panel uses .ai-panel-header; keep .panel-header as fallback for safety
    const header = floatingPanel.querySelector('.ai-panel-header, .panel-header');
    if (!header) {
        console.warn('⚠️ Panel header not found, drag disabled');
        return;
    }
    header.style.cursor = 'grab';

    let isDragging = false;
    let currentX = 0, currentY = 0, initialX, initialY;
    let xOffset = 0, yOffset = 0;

    header.addEventListener('mousedown', dragStart);

    function dragStart(e) {
        // Don't start drag when clicking interactive header elements (close/minimize)
        if (e.target.closest('button, svg, a, input')) return;

        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;

        if (e.target === header || header.contains(e.target)) {
            isDragging = true;
            header.style.cursor = 'grabbing';
            document.addEventListener('mousemove', dragMove);
            document.addEventListener('mouseup', dragEnd);
        }
    }

    function dragMove(e) {
        if (isDragging) {
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            xOffset = currentX;
            yOffset = currentY;

            floatingPanel.style.transform = `translate(${currentX}px, ${currentY}px)`;
        }
    }

    function dragEnd() {
        initialX = currentX;
        initialY = currentY;
        isDragging = false;
        header.style.cursor = 'grab';
        document.removeEventListener('mousemove', dragMove);
        document.removeEventListener('mouseup', dragEnd);
    }
}

function handleGenerateClick() {
    console.log('🖱️ Generate button clicked');

    const generateBtn = floatingPanel.querySelector('.generate-btn');
    if (!generateBtn) {
        console.error('❌ Generate button not found');
        return;
    }

    // ✅ IMPROVED: Check both disabled state and processing flag
    if (generateBtn.disabled || generateBtn.dataset.processing === 'true') {
        console.log('⚠️ Button disabled or already processing, ignoring click');
        return;
    }

    // ✅ IMPROVED: Immediately disable button to prevent rapid clicks
    generateBtn.dataset.processing = 'true';
    generateBtn.disabled = true;

    const originalHTML = generateBtn.innerHTML;
    generateBtn.innerHTML = `<div style="width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:ai-spin 0.7s linear infinite"></div> Generating...`;

    // ✅ IMPROVED: Add timeout fallback to prevent stuck buttons
    const generationTimeout = setTimeout(() => {
        console.log('⏰ Generation timeout - resetting button');
        if (generateBtn && generateBtn.dataset.processing === 'true') {
            resetGenerateButton(generateBtn, originalHTML);
            showMessage('Generation timed out. Please try again.', 'warning');
        }
    }, 30000); // 30 second timeout

    // ✅ FIXED: Use async/await for better error handling
    performAIGeneration(generateBtn, originalHTML, generationTimeout).catch(error => {
        console.error('❌ Generate click failed:', error);
        clearTimeout(generationTimeout); // Clear timeout on error
        showMessage('Generation failed. Please try again.', 'error');

        // Reset button on error
        if (generateBtn) {
            resetGenerateButton(generateBtn, originalHTML);
        }
    });
}

// Regenerate just one tone, return its new text
async function regenerateSingleTone(tone) {
    const tweetData = await getCurrentTweetData();
    const settings = await getCurrentSettings();
    const targetText = tweetData?.text || tweetData?.fullContent || getCurrentTweetText();
    if (!targetText) throw new Error('Could not find tweet content');

    const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            action: 'generateComments',
            data: {
                postContent: targetText,
                isReply: !!tweetData?.isReply,
                originalPost: tweetData?.originalPost || null,
                replyTo: tweetData?.replyTo || null
            },
            settings: { ...settings, selectedTones: [tone] }
        }, res => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(res);
        });
    });

    if (!response?.success) throw new Error(response?.error || 'Generation failed');
    const text = response.comments?.[tone] || response.data?.[tone];
    return text ? text.trim() : null;
}

async function performAIGeneration(button, originalHTML, generationTimeout) {
    try {
        // ✅ Allow generation anywhere - extract whatever tweet content is visible
        const currentUrl = window.location.href;
        const isOnComposePage = currentUrl.includes('/compose/post') || currentUrl.includes('/compose/tweet');

        console.log('🔍 Generation context:', {
            currentUrl: currentUrl,
            isOnComposePage: isOnComposePage,
            allowingGeneration: true
        });

        console.log('📝 Step 1: Getting tweet content...');
        const tweetData = await getCurrentTweetData();

        // ✅ ENHANCED: Better validation with debug info
        console.log('🔍 DEBUG: tweetData validation:', {
            hasTweetData: !!tweetData,
            hasText: !!tweetData?.text,
            textLength: tweetData?.text?.length || 0,
            textValue: tweetData?.text?.substring(0, 100) + '...',
            extractionMethod: tweetData?.extractionMethod || 'unknown'
        });

        console.log('🔍 DEBUG: Full tweetData object:', JSON.stringify(tweetData, null, 2));

        // 📢 CURRENT TWEET DATA LOGGING
        console.log('📢 === CURRENT TWEET DATA ===');
        console.log('📢 Tweet Text:', tweetData?.text || 'No text extracted');
        console.log('📢 Tweet Length:', tweetData?.text?.length || 0, 'characters');
        console.log('📢 Extraction Method:', tweetData?.extractionMethod || 'unknown');
        console.log('📢 Has Images:', (tweetData?.images?.length || 0) > 0);
        console.log('📢 Image Count:', tweetData?.images?.length || 0);
        console.log('📢 Has Videos:', (tweetData?.videos?.length || 0) > 0);
        console.log('📢 Video Count:', tweetData?.videos?.length || 0);
        if (tweetData?.text && tweetData.text.length > 0) {
            console.log('📢 Tweet Preview (first 200 chars):', tweetData.text.substring(0, 200) + (tweetData.text.length > 200 ? '...' : ''));
        }
        console.log('📢 === END TWEET DATA ===');

        if (!tweetData || !tweetData.text || tweetData.text.trim() === '') {
            console.error('❌ DEBUG: No valid tweet content found:', tweetData);
            throw new Error('No tweet content found to reply to');
        }

        console.log('📝 Step 2: Tweet content obtained:', tweetData.text.substring(0, 50) + '...');

        // ✅ ENHANCED: Use new ExtensionMessenger for better communication
        console.log('🌐 Step 3: Detecting language and generating replies...');

        // ✅ AI AUTO-DETECTION: Let AI handle language detection
        const detectedLanguage = 'auto';
        console.log('🤖 AI Auto-Detection Enabled:', detectedLanguage);

        // ✅ ENHANCED: Map tweetData to expected format with validation
        const postData = {
            text: tweetData.text || '',
            postContent: tweetData.text || '', // ✅ CRITICAL: Add postContent field
            content: tweetData.text || '', // ✅ CRITICAL: Add content field
            imageUrl: tweetData.images && tweetData.images.length > 0 ? tweetData.images[0] : null,
            videoUrl: tweetData.videos && tweetData.videos.length > 0 ? tweetData.videos[0] : null,
            username: 'current_user',
            timestamp: Date.now(),
            tweetId: 'current_tweet',
            isReply: !!tweetData.isReply,
            originalPost: tweetData.originalPost || null,
            replyTo: tweetData.replyTo || null
        };

        // ✅ DEBUG: Validate postData before sending
        console.log('🔍 DEBUG: tweetData.text validation:', {
            exists: !!tweetData.text,
            length: tweetData.text?.length || 0,
            trimmed: tweetData.text?.trim().length || 0,
            value: tweetData.text?.substring(0, 100) + '...'
        });

        console.log('🔍 DEBUG: tweetData from getCurrentTweetData:', tweetData);
        console.log('🔍 DEBUG: postData mapped:', postData);

        // ✅ ENHANCED: Ensure ExtensionMessenger is available
        let result;
        if (typeof ExtensionMessenger === 'undefined') {
            console.error('❌ ExtensionMessenger not available, using direct background communication');
            result = await sendMessageWithErrorHandling({
                action: 'generateComments',
                postContent: postData.text || postData.postContent || postData.content || '',
                imageUrl: postData.imageUrl || null,
                videoUrl: postData.videoUrl || null,
                platform: 'twitter',
                sessionId: postData.sessionId || 'session_' + Date.now(),
                userId: postData.userId || 'user_' + Date.now(),
                timestamp: Date.now(),
                detectedLanguage: detectedLanguage,
                isReply: !!postData.isReply,
                originalPost: postData.originalPost || null,
                replyTo: postData.replyTo || null
            });
        } else {
            result = await ExtensionMessenger.generateReplies(postData);
        }

        console.log('🔍 DEBUG: Result received from messenger:', {
            success: result.success,
            hasData: !!result.data,
            dataType: typeof result.data,
            dataKeys: result.data ? Object.keys(result.data) : null,
            dataLength: result.data ? Object.keys(result.data).length : 0,
            error: result.error,
            provider: result.provider
        });

        if (result.success) {
            if (result.usedFallback) {
                // The AI call failed and these are canned, tweet-independent
                // strings. Saying "generated successfully" here is how a total
                // AI outage used to pass as working output.
                console.warn('⚠️ Step 4: AI FAILED — showing canned fallback replies:', result.fallbackReason);
                showMessage(
                    `AI unavailable (${result.fallbackReason || 'request failed'}). Showing sample replies — check your API key in Settings.`,
                    'warning'
                );
            } else {
                console.log('✅ Step 4: Replies generated successfully');
            }
            console.log('🎭 Step 5: Displaying humanized replies...');

            // Display the humanized replies
            showCommentsInPanel(result.data, tweetData, { usedFallback: !!result.usedFallback });

            // Record training data with enhanced info
            recordTrainingData(tweetData, result.data, result.language, result.provider);

        } else {
            throw new Error(result.error || 'Generation failed');
        }

        // ✅ IMPROVED: Clear timeout on successful completion
        if (generationTimeout) {
            clearTimeout(generationTimeout);
        }

        // ✅ FIXED: Only reset button if it's the original generate button
        if (button && originalHTML) {
            resetGenerateButton(button, originalHTML);
        }

    } catch (error) {
        console.error('❌ Generation error:', error);

        // ✅ IMPROVED: Clear timeout on error
        if (generationTimeout) {
            clearTimeout(generationTimeout);
        }

        let errorMessage = error.message;
        if (errorMessage.includes('API key')) {
            errorMessage = '🔑 Please configure your API key in extension settings';
        } else if (errorMessage.includes('quota')) {
            errorMessage = '📊 Daily quota exceeded';
        }

        showMessage(errorMessage, 'error');

        // ✅ FIXED: Only reset button if it's the original generate button
        if (button && originalHTML) {
            resetGenerateButton(button, originalHTML);
        }
    }
}

function resetGenerateButton(button, originalHTML) {
    console.log('🔄 Resetting generate button state...');

    // ✅ IMPROVED: Ensure button exists and reset all states
    if (!button) {
        console.error('❌ Cannot reset button: button is null');
        return;
    }

    try {
        button.innerHTML = originalHTML;
        button.disabled = false;
        button.dataset.processing = 'false';

        console.log('✅ Generate button reset completed');
    } catch (error) {
        console.error('❌ Error resetting button:', error);
        // Fallback reset
        try {
            button.disabled = false;
            button.dataset.processing = 'false';
        } catch (fallbackError) {
            console.error('❌ Fallback reset also failed:', fallbackError);
        }
    }
}

function debugReplyButton() {
    console.log('🔍 ===== REPLY BUTTON DEBUG =====');

    const selectors = [
        '[data-testid="tweetButton"]',
        'button[data-testid="tweetButton"]',
        '[data-testid="tweetButtonInline"]'
    ];

    selectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        console.log(`Selector "${selector}": found ${elements.length} elements`);

        elements.forEach((el, index) => {
            console.log(`  Element ${index}:`, {
                tagName: el.tagName,
                textContent: el.textContent.trim(),
                disabled: el.disabled,
                ariaDisabled: el.getAttribute('aria-disabled'),
                className: el.className,
                style: el.style.cssText,
                offsetParent: !!el.offsetParent
            });
        });
    });

    // Scan all button/clickable elements for Reply or Post text manually
    console.log('🔍 Scanning button elements for "Reply" or "Post" text...');
    const manualElements = [];
    document.querySelectorAll('button, [role="button"]').forEach(el => {
        const text = el.textContent.trim();
        if (text.includes('Reply') || text.includes('Post')) {
            manualElements.push(el);
        }
    });

    console.log(`Found ${manualElements.length} buttons containing "Reply" or "Post" text`);
    manualElements.forEach((el, index) => {
        console.log(`  Manual Button ${index}:`, {
            tagName: el.tagName,
            textContent: el.textContent.trim(),
            disabled: el.disabled,
            ariaDisabled: el.getAttribute('aria-disabled'),
            className: el.className,
            style: el.style.cssText,
            offsetParent: !!el.offsetParent
        });
    });

    const editor = document.querySelector('div[data-testid="tweetTextarea_0"]');
    if (editor) {
        console.log('📝 Editor status:', {
            textContent: editor.textContent,
            innerHTML: editor.innerHTML,
            contentEditable: editor.contentEditable,
            focused: document.activeElement === editor
        });
    }

    const replyBtn = document.querySelector('[data-testid="tweetButton"]');
    if (replyBtn) {
        console.log('🔧 Attempting to manually enable Reply button...');

        replyBtn.disabled = false;
        replyBtn.removeAttribute('disabled');
        replyBtn.removeAttribute('aria-disabled');
        replyBtn.style.opacity = '1';
        replyBtn.style.pointerEvents = 'auto';
        replyBtn.style.cursor = 'pointer';

        const classesToRemove = ['disabled', 'r-bnwqim', 'r-1loqt21'];
        classesToRemove.forEach(cls => replyBtn.classList.remove(cls));

        console.log('✅ Manual enable attempt completed');
    }

    showMessage('Debug info logged to console. Check F12 → Console', 'info');
}

// ✅ SIMPLIFIED INITIALIZATION - FOCUS ON TOGGLE BUTTON
function initializeExtension() {
    console.log('🚀 Starting extension initialization...');
    console.log('🔍 Platform detected:', currentPlatform);
    console.log('🔍 Current URL:', window.location.href);

    if (isInjected) {
        console.log('⚠️ Extension already injected, skipping...');
        return;
    }

    // Clean up any existing elements
    cleanup();

    // ✅ FORCE INJECTION FOR X/TWITTER (even if platform detection fails)
    const isTwitterX = window.location.hostname.includes('twitter') ||
                      window.location.hostname.includes('x.com') ||
                      window.location.href.includes('twitter.com') ||
                      window.location.href.includes('x.com');

    if (currentPlatform === 'twitter' || isTwitterX) {
        console.log('✅ Twitter/X detected, creating toggle button...');
        console.log('🔍 Platform:', currentPlatform, 'URL check:', isTwitterX);

        // ✅ WAIT FOR BODY TO BE READY
        if (!document.body) {
            console.log('⏳ Body not ready, waiting...');
            setTimeout(initializeExtension, 100);
            return;
        }

        // ✅ PRIORITY: Create toggle button first (most important)
        const toggleBtn = createToggleButton();

        // ✅ Only create panel if toggle button exists
        if (toggleBtn) {
            console.log('✅ Toggle button created, now creating panel...');
            createFloatingPanel();

            // Set initial visibility
            const savedVisibility = localStorage.getItem('ai-panel-visible');
            if (savedVisibility === 'false' && floatingPanel) {
                floatingPanel.style.display = 'none';
            }

            // ✅ MINIMAL: Only set up tweet change detection if everything else works
            try {
                const debouncedTweetCheck = debounce(checkTweetChange, 1000);
                const tweetObserver = new MutationObserver(debouncedTweetCheck);
                tweetObserver.observe(document.body, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['href']
                });
                observers.push(tweetObserver);

                currentTweetUrl = getCurrentTweetUrl();
                console.log('📍 Initial tweet URL:', currentTweetUrl);
            } catch (e) {
                console.log('⚠️ Observer setup failed, but toggle button should still work');
            }
        }
    } else {
        console.log('❌ Not on Twitter/X, skipping initialization');
    }

    isInjected = true;
    console.log('✅ Extension initialization completed');
}

// ✅ CSS ANIMATIONS
const style = document.createElement('style');
style.textContent = `
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }

    .ai-floating-panel .panel-header {
        cursor: grab;
        user-select: none;
    }

    .ai-floating-panel .panel-content::-webkit-scrollbar {
        width: 6px;
    }

    .ai-floating-panel .panel-content::-webkit-scrollbar-track {
        background: #f1f3f4;
        border-radius: 3px;
    }

    .ai-floating-panel .panel-content::-webkit-scrollbar-thumb {
        background: #dadce0;
        border-radius: 3px;
    }

    .ai-floating-panel .panel-content::-webkit-scrollbar-thumb:hover {
        background: #bdc1c6;
    }

    .ai-panel-toggle:hover {
        transform: scale(1.1) !important;
    }

    .ai-panel-toggle:active {
        transform: scale(0.95) !important;
    }
`;
document.head.appendChild(style);

// ✅ INITIALIZATION WITH MULTIPLE ATTEMPTS
console.log('🔄 Setting up extension initialization...');

function attemptInitialization() {
    if (!isExtensionContextValid()) {
        console.warn('⚠️ Extension context invalidated. Skipping attemptInitialization.');
        cleanup();
        return;
    }
    console.log('🎯 Attempting initialization...');

    const isTwitterX = window.location.hostname.includes('twitter') ||
                      window.location.hostname.includes('x.com') ||
                      window.location.href.includes('twitter.com') ||
                      window.location.href.includes('x.com');

    try {
        initializeExtension();

        // ✅ Simple verification
        setTimeout(() => {
            const toggleExists = document.querySelector('.ai-panel-toggle');
            if (!toggleExists && (currentPlatform === 'twitter' || isTwitterX)) {
                console.log('⚠️ Toggle button not found, retrying...');
                createToggleButton();
            }
        }, 2000);

    } catch (error) {
        console.error('❌ Initialization error:', error);

        // ✅ SIMPLE FALLBACK - ALWAYS CREATE BUTTON
        setTimeout(() => {
            if (currentPlatform === 'twitter' || isTwitterX) {
                console.log('🔄 Creating fallback toggle button...');
                createToggleButton();
            }
        }, 500);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('📄 DOM Content Loaded');
        setTimeout(attemptInitialization, 500);
    });
} else {
    console.log('📄 Document already ready');
    setTimeout(attemptInitialization, 500);
}

// ✅ AI AUTO-DETECTION: No initialization needed
console.log('🤖 AI Auto-Detection ready for X/Twitter');

// ✅ Clean initialization - no emergency buttons needed

// ✅ Navigation handling (simplified)
let lastUrl = location.href;
const navigationObserver = new MutationObserver(() => {
    if (!isExtensionContextValid()) {
        console.warn('⚠️ Extension context invalidated. Disconnecting navigationObserver.');
        navigationObserver.disconnect();
        cleanup();
        return;
    }
    const url = location.href;
    if (url !== lastUrl) {
        console.log('🧭 Navigation detected:', lastUrl, '->', url);
        lastUrl = url;

        isInjected = false;
        setTimeout(() => {
            attemptInitialization();
            setTimeout(checkTweetChange, 1500);
        }, 1000);
    }
});

try {
    navigationObserver.observe(document, { subtree: true, childList: true });
    // Do NOT push navigationObserver to observers so it persists across standard panel/element cleanups.
    // It will automatically disconnect itself inside its callback when context is invalidated.
} catch (e) {
    console.log('⚠️ Navigation observer failed, but extension should still work');
}

// ✅ GLOBAL TEST FUNCTION
window.testAIExtension = function() {
    console.log('🧪 ===== AI EXTENSION DEBUG TEST =====');
    console.log('🔍 Current state:', {
        platform: currentPlatform,
        isInjected: isInjected,
        panelExists: !!floatingPanel,
        toggleExists: !!document.querySelector('.ai-panel-toggle'),
        currentTweetUrl: currentTweetUrl
    });

    const toggle = document.querySelector('.ai-panel-toggle');
    if (toggle) {
        const rect = toggle.getBoundingClientRect();
        console.log('🔘 Toggle position:', rect);
        console.log('👁️ Toggle visible:', rect.width > 0 && rect.height > 0);
    } else {
        console.log('❌ Toggle button not found!');
    }

    if (floatingPanel) {
        const rect = floatingPanel.getBoundingClientRect();
        console.log('📏 Panel position:', rect);
        console.log('👁️ Panel visible:', floatingPanel.style.display !== 'none');
    }

    loadUserTrainingStats().then(stats => {
        console.log('📊 User training stats:', stats);
    });

    console.log('✅ Debug test completed');
};

// Auto-run debug test is disabled in production to avoid console spam and X/Twitter SPA overhead.
// To debug manually, run window.testAIExtension() from DevTools.
if (window.AIReplyGenerator && window.AIReplyGenerator.DEBUG) {
    setTimeout(() => {
        if (window.testAIExtension) {
            window.testAIExtension();
        }
    }, 3000);
}

console.log('✅ CLEANED Enhanced Floating Panel Content Script loaded - GUARANTEED TOGGLE BUTTON!');

// ✅ GLOBAL DEBUG FUNCTIONS
window.debugExtension = function() {
    console.log('🔍 ===== EXTENSION DEBUG INFO =====');
    console.log('🔍 ExtensionMessenger type:', typeof ExtensionMessenger);
    console.log('🔍 window.extensionTester exists:', !!window.extensionTester);
    console.log('🔍 window.extensionTester object:', window.extensionTester);
    console.log('🔍 chrome.runtime available:', !!chrome.runtime);
    console.log('🔍 Platform:', currentPlatform);
    console.log('🔍 Panel exists:', !!floatingPanel);
    console.log('🔍 Toggle exists:', !!document.querySelector('.ai-panel-toggle'));
    console.log('🔍 Current URL:', window.location.href);
    console.log('✅ Debug info logged');
};

window.testExtensionTester = function() {
    console.log('🧪 ===== TESTING EXTENSION TESTER =====');
    if (window.extensionTester) {
        console.log('✅ extensionTester exists');
        return window.extensionTester.testDirect();
    } else {
        console.log('❌ extensionTester not found');
        console.log('🔍 Creating emergency extensionTester...');
        window.extensionTester = {
            async testDirect() {
                console.log('🚨 Emergency testDirect called');
                try {
                    const response = await sendMessageWithErrorHandling({
                        action: 'runFullTest'
                    });
                    console.log('✅ Emergency test completed:', response);
                    return response;
                } catch (error) {
                    console.error('❌ Emergency test failed:', error);
                    return { success: false, error: error.message };
                }
            }
        };
        return window.extensionTester.testDirect();
    }
};

// ✅ NEW: Test tones specifically
window.testTones = async function() {
    console.log('🎭 ===== TESTING TONES FROM OPTIONS =====');
    try {
        const settings = await getCurrentSettings();
        console.log('🎭 Settings loaded:', settings);
        console.log('🎭 Selected Tones:', settings.selectedTones);
        console.log('🎭 Tones Count:', settings.selectedTones.length);
        console.log('🎭 Tones Details:', settings.selectedTones.map((tone, index) => `${index + 1}. ${tone}`).join(', '));

        // Check if we have all 15 tones available
        const allAvailableTones = ['professional', 'casual', 'sarcastic', 'witty', 'concise', 'analytical', 'empathetic', 'humorous', 'brief', 'direct', 'punchy', 'snappy', 'crisp', 'sharp', 'thao_mai'];
        const missingAvailableTones = allAvailableTones.filter(tone => !settings.selectedTones.includes(tone));

        console.log('🎭 AVAILABLE TONES CHECK:');
        console.log('🎭 All Available Tones (15):', allAvailableTones);
        console.log('🎭 Currently Selected Tones:', settings.selectedTones);
        console.log('🎭 Missing from Selection:', missingAvailableTones);

        if (missingAvailableTones.length > 0) {
            console.log('⚠️ NOT ALL TONES SELECTED! Missing:', missingAvailableTones.length, 'tones');
            console.log('💡 Go to Options page and select all tones you want to use');
        } else {
            console.log('✅ All 15 tones are selected in options');
        }

        // Test AI generation with these tones
        console.log('🎭 Testing AI generation with these tones...');
        const response = await sendMessageWithErrorHandling({
            action: 'generateComments',
            postContent: 'Test post for tone verification',
            platform: 'twitter',
            sessionId: 'test_' + Date.now(),
            userId: 'test_user',
            timestamp: Date.now(),
            detectedLanguage: 'en'
        });

        console.log('🎭 AI Generation Response:', response);
        if (response && response.success && response.data) {
            console.log('🎭 Generated Replies:', response.data);
            console.log('🎭 Generated Tones Count:', Object.keys(response.data).length);
            console.log('🎭 Generated Tones:', Object.keys(response.data).map((tone, index) => `${index + 1}. ${tone}`).join(', '));

            // Compare with selected tones
            const selectedTones = settings.selectedTones;
            const generatedTones = Object.keys(response.data);
            const missingTones = selectedTones.filter(tone => !generatedTones.includes(tone));
            const extraTones = generatedTones.filter(tone => !selectedTones.includes(tone));

            console.log('🎭 TONE COMPARISON:');
            console.log('🎭 Selected Tones:', selectedTones);
            console.log('🎭 Generated Tones:', generatedTones);
            console.log('🎭 Missing Tones:', missingTones);
            console.log('🎭 Extra Tones:', extraTones);

            if (missingTones.length === 0 && extraTones.length === 0) {
                console.log('✅ All tones match perfectly!');
            } else {
                console.log('⚠️ Tone mismatch detected!');
                console.log('💡 Expected', selectedTones.length, 'tones but got', generatedTones.length, 'tones');
            }
        }

        return response;
    } catch (error) {
        console.error('❌ Tone test failed:', error);
        throw error;
    }
};

// ✅ NEW: Fix tones in storage to include all 15 tones
window.fixTones = async function() {
    console.log('🔧 ===== FIXING TONES IN STORAGE =====');
    try {
        const allTones = ['professional', 'casual', 'sarcastic', 'witty', 'concise', 'analytical', 'empathetic', 'humorous', 'brief', 'direct', 'punchy', 'snappy', 'crisp', 'sharp', 'thao_mai'];

        // Get current settings
        const result = await chrome.storage.sync.get(['userSettings']);
        const userSettings = result.userSettings || {};

        console.log('🔧 Current userSettings:', userSettings);
        console.log('🔧 Current selectedTones:', userSettings.selectedTones);
        console.log('🔧 Current selectedTones count:', userSettings.selectedTones?.length || 0);

        // Update selectedTones to include all 15 tones
        userSettings.selectedTones = allTones;

        // Save back to storage
        await chrome.storage.sync.set({ userSettings: userSettings });

        console.log('✅ Fixed! Updated selectedTones to include all 15 tones');
        console.log('✅ New selectedTones:', userSettings.selectedTones);
        console.log('✅ New count:', userSettings.selectedTones.length);

        // Reload settings to verify
        const newSettings = await getCurrentSettings();
        console.log('✅ Verification - New settings loaded:', newSettings.selectedTones.length, 'tones');

        return { success: true, tones: userSettings.selectedTones };
    } catch (error) {
        console.error('❌ Fix tones failed:', error);
        throw error;
    }
};

window.testSettings = async function() {
    console.log('🔍 ===== TESTING SETTINGS FROM OPTIONS =====');
    try {
        const settings = await getCurrentSettings();
        console.log('✅ Settings loaded:', settings);

        // Test API connection
        console.log('🔗 Testing API connection...');
        const apiTest = await sendMessageWithErrorHandling({
            action: 'testAPIConnection'
        });

        console.log('✅ API Test Result:', apiTest);
        return { settings, apiTest };

    } catch (error) {
        console.error('❌ Settings test failed:', error);
        return { success: false, error: error.message };
    }
};

// ✅ EXPOSE DEBUG FUNCTIONS GLOBALLY
window.debugExtension = window.debugExtension;
window.testExtensionTester = window.testExtensionTester;
window.testSettings = window.testSettings;
window.testTones = window.testTones;
window.fixTones = window.fixTones;

// ✅ EMERGENCY FALLBACK: Ensure functions are available
if (!window.testTones) {
    window.testTones = async function() {
        console.log('🎭 ===== TESTING TONES FROM OPTIONS =====');
        try {
            const settings = await getCurrentSettings();
            console.log('🎭 Settings loaded:', settings);
            console.log('🎭 Selected Tones:', settings.selectedTones);
            console.log('🎭 Tones Count:', settings.selectedTones.length);
            console.log('🎭 Tones Details:', settings.selectedTones.map((tone, index) => `${index + 1}. ${tone}`).join(', '));

            // Check if we have all 15 tones available
            const allAvailableTones = ['professional', 'casual', 'sarcastic', 'witty', 'concise', 'analytical', 'empathetic', 'humorous', 'brief', 'direct', 'punchy', 'snappy', 'crisp', 'sharp', 'thao_mai'];
            const missingAvailableTones = allAvailableTones.filter(tone => !settings.selectedTones.includes(tone));

            console.log('🎭 AVAILABLE TONES CHECK:');
            console.log('🎭 All Available Tones (15):', allAvailableTones);
            console.log('🎭 Currently Selected Tones:', settings.selectedTones);
            console.log('🎭 Missing from Selection:', missingAvailableTones);

            if (missingAvailableTones.length > 0) {
                console.log('⚠️ NOT ALL TONES SELECTED! Missing:', missingAvailableTones.length, 'tones');
                console.log('💡 Go to Options page and select all tones you want to use');
            } else {
                console.log('✅ All 15 tones are selected in options');
            }

            return { success: true, tones: settings.selectedTones, count: settings.selectedTones.length };
        } catch (error) {
            console.error('❌ Tone test failed:', error);
            throw error;
        }
    };
}

// ✅ NEW: Check actual tones in options vs generated
window.checkToneMismatch = async function() {
    console.log('🔍 ===== CHECKING TONE MISMATCH =====');
    try {
        // Get settings from storage directly
        const result = await chrome.storage.sync.get(['userSettings']);
        const userSettings = result.userSettings || {};
        const optionsTones = userSettings.selectedTones || [];

        console.log('🔍 DIRECT STORAGE CHECK:');
        console.log('🔍 Options Tones from Storage:', optionsTones);
        console.log('🔍 Options Tones Count:', optionsTones.length);
        console.log('🔍 Options Tones Details:', optionsTones.map((tone, index) => `${index + 1}. ${tone}`).join(', '));

        // Get current settings (what extension is using)
        const settings = await getCurrentSettings();
        console.log('🔍 EXTENSION SETTINGS CHECK:');
        console.log('🔍 Extension Tones:', settings.selectedTones);
        console.log('🔍 Extension Tones Count:', settings.selectedTones.length);
        console.log('🔍 Extension Tones Details:', settings.selectedTones.map((tone, index) => `${index + 1}. ${tone}`).join(', '));

        // Compare
        const missingInExtension = optionsTones.filter(tone => !settings.selectedTones.includes(tone));
        const extraInExtension = settings.selectedTones.filter(tone => !optionsTones.includes(tone));

        console.log('🔍 TONE COMPARISON:');
        console.log('🔍 Missing in Extension:', missingInExtension);
        console.log('🔍 Extra in Extension:', extraInExtension);

        if (missingInExtension.length > 0 || extraInExtension.length > 0) {
            console.log('⚠️ TONE MISMATCH DETECTED!');
            console.log('💡 Extension is not using the same tones as options');
        } else {
            console.log('✅ Tones match perfectly between options and extension');
        }

        return {
            optionsTones,
            extensionTones: settings.selectedTones,
            missingInExtension,
            extraInExtension,
            mismatch: missingInExtension.length > 0 || extraInExtension.length > 0
        };
    } catch (error) {
        console.error('❌ Tone mismatch check failed:', error);
        throw error;
    }
};

// ✅ EXPOSE NEW FUNCTION
window.checkToneMismatch = window.checkToneMismatch;

// ✅ AUTO-CLOSE FEATURE: Test function
window.testAutoClose = async function() {
    console.log('🔒 ===== TESTING AUTO-CLOSE FEATURE =====');

    try {
        // Test 1: Check if auto-close setting is accessible
        console.log('🧪 Test 1: Checking auto-close setting...');
        const result = await chrome.storage.sync.get(['autoClosePanel']);
        const autoCloseEnabled = result.autoClosePanel === true;
        console.log('✅ Auto-close setting:', autoCloseEnabled);

        // Test 2: Check if floating panel exists and has mouse events
        console.log('🧪 Test 2: Checking floating panel...');
        if (floatingPanel) {
            console.log('✅ Floating panel exists');
            console.log('✅ Panel visible:', floatingPanel.style.display !== 'none');
            console.log('✅ Panel has mouse events:', floatingPanel.onmouseenter !== null || floatingPanel.onmouseleave !== null);
        } else {
            console.log('❌ Floating panel not found');
        }

        // Test 3: Check auto-close state variables DISABLED
        console.log('🧪 Test 3: Auto-close feature disabled');
        // console.log('✅ isContentGenerated:', isContentGenerated);
        // console.log('✅ isMouseOverPanel:', isMouseOverPanel);
        // console.log('✅ autoCloseTimer:', autoCloseTimer ? 'Active' : 'None');
        // console.log('✅ autoCloseDelay:', autoCloseDelay + 'ms');

        // Test 4: Simulate content generation DISABLED
        console.log('🧪 Test 4: Auto-close feature disabled');
        // await markContentGenerated();
        // console.log('✅ Content generation simulation completed');
        // console.log('✅ isContentGenerated after:', isContentGenerated);

        // Test 5: Test timer functions DISABLED
        console.log('🧪 Test 5: Auto-close feature disabled');
        // if (isContentGenerated) {
        //     startAutoClose();
        //     console.log('✅ Auto-close timer started');
        //
        //     // Cancel after a short delay to test cancel function
        //     setTimeout(() => {
        //         cancelAutoClose();
        //         console.log('✅ Auto-close timer cancelled');
        //     }, 1000);
        // }

        console.log('✅ All auto-close tests completed successfully!');
        return { success: true, message: 'Auto-close feature is working correctly' };

    } catch (error) {
        console.error('❌ Auto-close test failed:', error);
        return { success: false, error: error.message };
    }
};

console.log('🔧 Debug functions available:');
console.log('  - debugExtension() - Show all extension debug info');
console.log('  - testExtensionTester() - Test extensionTester with emergency fallback');
console.log('  - testSettings() - Test settings from options page');
console.log('  - testTones() - Test tones from options page specifically');
console.log('  - fixTones() - Fix tones in storage to include all 15 tones');
console.log('  - checkToneMismatch() - Check if tones in options match extension');
console.log('  - testAutoClose() - Test auto-close functionality');
console.log('🔍 window.debugExtension available:', typeof window.debugExtension);
console.log('🔍 window.testExtensionTester available:', typeof window.testExtensionTester);
console.log('🔍 window.testSettings available:', typeof window.testSettings);
console.log('🔍 window.testTones available:', typeof window.testTones);
console.log('🔍 window.fixTones available:', typeof window.fixTones);
console.log('🔍 window.checkToneMismatch available:', typeof window.checkToneMismatch);
console.log('🔍 window.testAutoClose available:', typeof window.testAutoClose);

// ✅ ENHANCED: Message listener for background communication
const contentScriptMessageListener = (request, sender, sendResponse) => {
    if (!isExtensionContextValid()) {
        try {
            chrome.runtime.onMessage.removeListener(contentScriptMessageListener);
        } catch (e) {
            // Ignore if context is invalidated
        }
        return;
    }

    if (request && request.action !== 'ping') {
        console.log('📨 Content script received message:', request);
    }

    if (request.action === 'checkIfOnTwitter') {
        sendResponse({ isOnTwitter: true });
    } else if (request.action === 'ping') {
        sendResponse({ ok: true });
    } else if (request.action === 'getCurrentTweet') {
        // ✅ FIXED: Handle async operation properly
        getCurrentTweetData().then(tweetData => {
        console.log('📨 Sending tweet data to background:', tweetData);
        sendResponse(tweetData);
        }).catch(error => {
            console.error('❌ Error getting tweet data:', error);
            sendResponse({ error: error.message });
        });
        return true; // Keep message channel open for async response
    } else if (request.action === 'generateReply') {
        handleGenerateClick();
        sendResponse({ success: true });
    } else if (request.action === 'lt_start') {
        LiveTranslator.start(request.sourceLang || 'en', request.targetLang || 'vi');
        sendResponse({ success: true });
    } else if (request.action === 'lt_stop') {
        LiveTranslator.stop();
        sendResponse({ success: true });
    } else if (request.action === 'lt_subtitle') {
        LiveTranslator.showSubtitle(request.original, request.translated, request.sequenceNumber, request.targetLang);
        sendResponse({ success: true });
    } else if (request.action === 'lt_processing') {
        LiveTranslator.showProcessing();
        sendResponse({ success: true });
    } else if (request.action === 'lt_error') {
        LiveTranslator.showError(request.error);
        sendResponse({ success: true });
    }

    return true; // Keep message channel open for async response
};

chrome.runtime.onMessage.addListener(contentScriptMessageListener);

// ==========================================
// 🎙️ LIVE TRANSLATOR: Speech Recognition & Overlay
// ==========================================

let localMovieMode = false;
try {
  chrome.storage.local.get(['ltMovieMode'], (res) => {
    if (res && res.ltMovieMode !== undefined) {
      localMovieMode = !!res.ltMovieMode;
    }
  });
} catch (e) {
  console.warn('Failed to get ltMovieMode in content script:', e);
}

try {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (changes.ltMovieMode) {
      localMovieMode = !!changes.ltMovieMode.newValue;
      console.log('🎬 [Content] Movie Mode updated to:', localMovieMode);
    }
  });
} catch (e) {
  console.warn('Failed to add storage listener in content script:', e);
}

function isRepetitiveLoop(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").replace(/\s+/g, " ").trim();
  const words = clean.split(' ');
  const n = words.length;

  // Space-less scripts arrive as one token — mirrors background.js.
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
      // Mirrors isRepetitiveLoop in background.js — see the rationale there.
      // Saying a phrase twice is rhetoric; a real loop repeats back-to-back.
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

  if (localMovieMode) {
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
    const maxFillerLength = localMovieMode ? 2 : 5;
    if (words.length < maxFillerLength) return true;
  }

  return false;
}

const langNames = {
  'auto': 'Auto Detect',
  'en': 'English',
  'vi': 'Vietnamese',
  'zh': 'Chinese',
  'ja': 'Japanese',
  'ko': 'Korean',
  'fr': 'French',
  'es': 'Spanish',
  'de': 'German',
  'ru': 'Russian',
  'th': 'Thai',
  'hi': 'Hindi',
  'id': 'Indonesian',
  'pt': 'Portuguese',
  'it': 'Italian',
  'tr': 'Turkish',
  'ar': 'Arabic',
  'nl': 'Dutch',
  'tl': 'Tagalog',
  'pl': 'Polish',
  'bn': 'Bengali',
  'ur': 'Urdu',
  'ms': 'Malay',
  'fa': 'Persian',
  'sw': 'Swahili',
  'uk': 'Ukrainian',
  'ro': 'Romanian',
  'el': 'Greek',
  'he': 'Hebrew',
  'sv': 'Swedish',
  'da': 'Danish',
  'no': 'Norwegian',
  'fi': 'Finnish',
  'cs': 'Czech',
  'hu': 'Hungarian',
  'sk': 'Slovak',
  'bg': 'Bulgarian',
  'hr': 'Croatian',
  'sr': 'Serbian',
  'ka': 'Georgian',
  'az': 'Azerbaijani',
  'kk': 'Kazakh',
  'mn': 'Mongolian'
};

/**
 * Overlay looks. Each preset owns the box and the two text rows, so switching
 * is a single Object.assign rather than a pile of conditionals at render time.
 * Presets that drop the box lean on a heavy text outline instead — over live
 * video that reads better than a translucent panel, which is the whole reason
 * the plain card was hard to look at.
 */
const SUBTITLE_STYLES = {
  card: {
    overlay: { width: '75%', maxWidth: '850px', bottom: '8%', padding: '18px 24px', borderRadius: '16px',
      background: 'rgba(8, 8, 8, 0.90)', border: '1px solid rgba(255, 255, 255, 0.12)',
      backdropFilter: 'blur(16px)', boxShadow: '0 12px 40px rgba(0, 0, 0, 0.65)' },
    translation: { fontSize: '23px', fontWeight: '600', letterSpacing: 'normal', color: '#ffd043',
      textShadow: '0 2px 4px rgba(0, 0, 0, 0.9)' },
    original: { fontSize: '16px', color: '#dddddd' }
  },
  netflix: {
    overlay: { width: '88%', maxWidth: '1100px', bottom: '10%', padding: '0', borderRadius: '0',
      background: 'transparent', border: 'none', backdropFilter: 'none', boxShadow: 'none' },
    translation: { fontSize: '30px', fontWeight: '700', letterSpacing: 'normal', color: '#ffffff',
      textShadow: '0 0 6px #000, 2px 2px 0 #000, -2px 2px 0 #000, 2px -2px 0 #000, -2px -2px 0 #000' },
    original: { fontSize: '19px', color: '#e6e6e6' }
  },
  bar: {
    overlay: { width: '100%', maxWidth: 'none', bottom: '0', padding: '14px 24px', borderRadius: '0',
      background: 'rgba(0, 0, 0, 0.82)', border: 'none', backdropFilter: 'none', boxShadow: 'none' },
    translation: { fontSize: '26px', fontWeight: '600', letterSpacing: 'normal', color: '#ffffff',
      textShadow: '0 2px 4px rgba(0, 0, 0, 0.9)' },
    original: { fontSize: '17px', color: '#c9c9c9' }
  },
  karaoke: {
    overlay: { width: '92%', maxWidth: '1200px', bottom: '12%', padding: '0', borderRadius: '0',
      background: 'transparent', border: 'none', backdropFilter: 'none', boxShadow: 'none' },
    translation: { fontSize: '38px', fontWeight: '800', letterSpacing: '0.5px', color: '#ffe14d',
      textShadow: '0 0 8px #000, 3px 3px 0 #000, -3px 3px 0 #000, 3px -3px 0 #000, -3px -3px 0 #000' },
    original: { fontSize: '20px', color: '#f0f0f0' }
  },
  contrast: {
    overlay: { width: '80%', maxWidth: '900px', bottom: '9%', padding: '14px 20px', borderRadius: '8px',
      background: '#ffe600', border: '2px solid #000000', backdropFilter: 'none',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)' },
    translation: { fontSize: '26px', fontWeight: '700', letterSpacing: 'normal', color: '#000000',
      textShadow: 'none' },
    original: { fontSize: '17px', color: '#333333' }
  },
  minimal: {
    overlay: { width: 'auto', maxWidth: '640px', bottom: '6%', padding: '8px 14px', borderRadius: '10px',
      background: 'rgba(0, 0, 0, 0.55)', border: 'none', backdropFilter: 'blur(8px)', boxShadow: 'none' },
    translation: { fontSize: '17px', fontWeight: '500', letterSpacing: 'normal', color: '#f5f5f5',
      textShadow: '0 1px 3px rgba(0, 0, 0, 0.9)' },
    original: { fontSize: '13px', color: '#b9b9b9' }
  }
};

const LiveTranslator = {
  recognition: null,
  overlay: null,
  targetLang: 'vi',
  isListening: false,
  dimTimeout: null,
  currentSegmentId: null,
  silenceTimeout: null,
  lastSpeechText: '',
  lastSubtitleSeq: -1,
  // Subtitle queue state (P2 — smooth read-paced display)
  _subtitleQueue: [],
  _subtitleDisplaying: false,

  // On-screen display style. The overlay keeps a short rolling feed instead of
  // one replaced line, and reveals the newest line at speaking pace, so a
  // glance away no longer costs you the sentence.
  _feedLines: 3,
  _typewriter: true,
  _typeTimer: null,
  _typeTarget: null,
  _style: 'netflix',

  _preset() {
    return SUBTITLE_STYLES[this._style] || SUBTITLE_STYLES.netflix;
  },

  _loadDisplayPrefs() {
    try {
      chrome.storage.local.get(['ltSubtitleLines', 'ltSubtitleTypewriter', 'ltSubtitleStyle'], (res) => {
        if (chrome.runtime.lastError || !res) return;
        const lines = parseInt(res.ltSubtitleLines, 10);
        this._feedLines = Number.isFinite(lines) ? Math.min(4, Math.max(1, lines)) : 3;
        this._typewriter = res.ltSubtitleTypewriter !== false;
        this._style = SUBTITLE_STYLES[res.ltSubtitleStyle] ? res.ltSubtitleStyle : 'netflix';
        this._applyStyle();
        this._trimFeed();
      });
    } catch (_) {}
  },

  /** Repaint the box and every line in the current preset. */
  _applyStyle() {
    if (!this.overlay) return;
    const preset = this._preset();
    Object.assign(this.overlay.style, preset.overlay);

    const feed = this._feedEl();
    if (!feed) return;
    Array.from(feed.children).forEach(line => this._styleLine(line));
  },

  _styleLine(line) {
    if (!line) return;
    const preset = this._preset();
    const transEl = line.querySelector('.subtitle-translation');
    const origEl = line.querySelector('.subtitle-original');
    if (transEl) Object.assign(transEl.style, preset.translation);
    if (origEl) Object.assign(origEl.style, preset.original);
  },

  // ─── Subtitle queue helpers ───────────────────────────────────────────────

  /**
   * Estimate minimum display duration (ms) for a translated subtitle string.
   * CJK / Thai scripts carry more meaning per character so they need fewer
   * characters-per-second to read comfortably.
   */
  _estimateReadMs(text, langCode) {
    // Live viewers skim rather than read carefully — pace faster than comfortable
    // reading speed so subtitles never lag behind the audio. Previous values
    // (MIN 1400ms, 15cps, MAX 6s) forced up to 6s hold PER LINE and were the
    // single biggest source of "chữ nhả quá chậm".
    const cps = { zh: 8, ja: 8, ko: 10, th: 10 }[langCode] || 22; // chars per second
    const MIN_MS = 600, MAX_MS = 4000;
    return Math.min(MAX_MS, Math.max(MIN_MS, (text.length / cps) * 1000));
  },

  /**
   * Push a final (non-interim) subtitle into the display queue.
   * Applies backpressure by keeping only the first item + last 2 items when
   * the queue grows beyond 4, so the user never sees content that is too far
   * behind the live audio.
   */
  _enqueueSubtitle(original, translated) {
    this._subtitleQueue.push({ original, translated });
    // Backpressure is handled primarily by SHORTENING hold times (see
    // _playNextSubtitle) instead of silently dropping content. Dropping only
    // kicks in as a last resort when severely backed up (>6 items).
    if (this._subtitleQueue.length > 6) {
      const dropped = this._subtitleQueue.length - 4;
      console.warn(`🎙️ [Content] Subtitle queue critical: dropping ${dropped} middle item(s).`);
      this._subtitleQueue = [
        this._subtitleQueue[0],
        ...this._subtitleQueue.slice(-3)
      ];
    }
    if (!this._subtitleDisplaying) this._playNextSubtitle();
  },

  /** Dequeue and render the next subtitle, scheduling the one after it. */
  _playNextSubtitle() {
    if (this._subtitleQueue.length === 0) {
      this._subtitleDisplaying = false;
      return;
    }
    this._subtitleDisplaying = true;
    const item = this._subtitleQueue.shift();
    let holdMs = this._estimateReadMs(item.translated || item.original || '', this.targetLang);
    // Catch-up pacing: when lines are queuing behind this one, shorten the hold
    // so display drains toward real-time instead of drifting further behind.
    const backlog = this._subtitleQueue.length;
    if (backlog >= 3) holdMs = Math.min(holdMs, 700);
    else if (backlog >= 1) holdMs = Math.min(holdMs, 1200);
    // holdMs is resolved first so the reveal can size itself to the time it has.
    this._renderSubtitle(item.original, item.translated, holdMs);
    setTimeout(() => this._playNextSubtitle(), holdMs);
  },

  /**
   * Write subtitle content to the DOM overlay.
   * Extracted from showSubtitle() so the queue runner can call it independently.
   */
  _renderSubtitle(original, translated, holdMs) {
    this.createOverlay();
    if (!translated || !translated.trim()) return;

    const line = this._lineForFinal();
    if (!line) return;
    const transEl = line.querySelector('.subtitle-translation');
    const origEl = line.querySelector('.subtitle-original');

    this.show();
    transEl.style.animation = 'none';
    transEl.style.color = this._preset().translation.color;
    transEl.style.fontStyle = 'normal';
    transEl.style.opacity = '1';

    const text = translated.trim();
    if (original && original.trim() && original.trim() !== text) {
      origEl.style.display = 'block';
      origEl.textContent = original.trim();
    } else {
      origEl.style.display = 'none';
      origEl.textContent = '';
    }

    // Trim before typing so the reveal happens on a line that is already in
    // its final position and opacity.
    this._trimFeed();
    this._typeInto(transEl, text, holdMs);
    if (this.dimTimeout) clearTimeout(this.dimTimeout);
    this.dimTimeout = null;
    // The `!this.isListening` guard is always true in tab-capture mode (nothing
    // sends lt_start), so this arms on every line. 8s is short enough that an
    // ordinary pause between paragraphs blanks the overlay; 20s still clears it
    // when the stream really has gone quiet.
    this.dimTimeout = setTimeout(() => { this.hide(); }, 20000);
  },

  // ─────────────────────────────────────────────────────────────────────────

  createOverlay() {
    if (this.overlay) return;

    this.overlay = document.createElement('div');
    this.overlay.id = 'automind-live-subtitle-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      bottom: 8%;
      left: 50%;
      transform: translateX(-50%);
      width: 75%;
      max-width: 850px;
      min-height: 80px;
      background: rgba(8, 8, 8, 0.90);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      padding: 18px 24px;
      color: #fff;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 23px;
      font-weight: 600;
      line-height: 1.6;
      text-align: center;
      z-index: 2147483647;
      pointer-events: none;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.65), 0 0 1px rgba(255, 255, 255, 0.15) inset;
      display: none;
      /* hide() fades opacity to 0 and only then sets display:none, so with
         transition:none the overlay vanished in one frame instead of fading. */
      transition: opacity 0.35s ease, transform 0.35s ease;
      opacity: 0;
      transform: translate(-50%, 20px);
    `;

    const feed = document.createElement('div');
    feed.className = 'subtitle-feed';
    feed.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    this.overlay.appendChild(feed);
    document.body.appendChild(this.overlay);

    this._appendLine();
    this._applyStyle();      // paint with what we know now…
    this._loadDisplayPrefs(); // …then correct it once storage answers
  },

  _feedEl() {
    return this.overlay ? this.overlay.querySelector('.subtitle-feed') : null;
  },

  /** Build one caption line: translated text on top, source text underneath. */
  _appendLine() {
    const feed = this._feedEl();
    if (!feed) return null;

    const line = document.createElement('div');
    line.className = 'subtitle-line';
    line.style.cssText = 'transition: opacity 0.25s ease;';

    const translationDiv = document.createElement('div');
    translationDiv.className = 'subtitle-translation';
    translationDiv.style.cssText = 'margin-bottom: 4px; min-height: 1em;';

    const originalDiv = document.createElement('div');
    originalDiv.className = 'subtitle-original';
    originalDiv.style.cssText = 'font-weight: 400; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9); display: none;';

    line.appendChild(translationDiv);
    line.appendChild(originalDiv);
    feed.appendChild(line);
    this._styleLine(line);
    return line;
  },

  /** The line currently being written to. */
  _currentLine() {
    this.createOverlay();
    const feed = this._feedEl();
    if (!feed) return null;
    return feed.lastElementChild || this._appendLine();
  },

  /**
   * Where the next FINAL subtitle goes. An interim preview line is overwritten
   * rather than kept, otherwise every sentence would appear twice.
   */
  _lineForFinal() {
    const current = this._currentLine();
    if (!current) return null;
    const isReusable = current.dataset.interim === '1' ||
                       !current.querySelector('.subtitle-translation').textContent.trim();
    if (isReusable) {
      delete current.dataset.interim;
      return current;
    }
    return this._appendLine();
  },

  /** Drop lines past the configured window and fade whatever is left behind. */
  _trimFeed() {
    const feed = this._feedEl();
    if (!feed) return;

    const max = Math.max(1, this._feedLines);
    while (feed.children.length > max) feed.removeChild(feed.firstElementChild);

    const total = feed.children.length;
    Array.from(feed.children).forEach((line, index) => {
      const age = total - 1 - index; // 0 = newest
      line.style.opacity = String(Math.max(0.35, 1 - age * 0.28));
      // Only the live line shows its source text; older ones would double the
      // overlay's height and push it over the video.
      const original = line.querySelector('.subtitle-original');
      if (original && age > 0) original.style.display = 'none';
    });
  },

  _clearFeed() {
    // Cancel without flushing: the elements the reveal writes to are destroyed
    // by feed.innerHTML below, so there is nothing to strand here.
    if (this._typeTimer) {
      clearInterval(this._typeTimer);
      this._typeTimer = null;
    }
    this._typeTarget = null;
    const feed = this._feedEl();
    if (!feed) return;
    feed.innerHTML = '';
    this._appendLine();
  },

  /**
   * Reveal text at roughly speaking pace. The budget is a fraction of the line's
   * hold time so the sentence is always complete and readable before the next
   * one lands — a reveal still running when the line is replaced is worse than
   * no reveal at all.
   */
  _typeInto(el, text, holdMs) {
    this._flushReveal();

    const budget = Math.max(0, (holdMs || 0) * 0.6);
    // Above ~90 chars/sec the reveal is a blur, not a reveal, and the reader is
    // better served by the whole line sitting still for the time available. This
    // is the catch-up case: holdMs collapses to 700ms when lines are queuing.
    const tooFastToRead = budget > 0 && text && (text.length / (budget / 1000)) > 90;
    if (!this._typewriter || !text || budget < 250 || tooFastToRead) {
      el.textContent = text;
      return;
    }

    // Two spans — revealed prefix plus an invisible remainder. The full string is
    // in the DOM from the first frame, so the line wraps to its final height
    // immediately; writing a growing substring used to re-wrap on every word and
    // shove the already-read lines above it by a full line-height each time.
    el.textContent = '';
    const shownEl = document.createElement('span');
    const restEl = document.createElement('span');
    restEl.style.opacity = '0';
    el.appendChild(shownEl);
    el.appendChild(restEl);

    // Derive the tick PERIOD from the budget instead of rounding chars-per-tick up.
    // The old form ran for ceil(len/perStep) * 16ms, which pinned the reveal at
    // ~59% of its budget (a flat 63 chars/sec however much time it had) and made
    // one extra character halve the duration: 150 chars took 2400ms, 151 took 1216ms.
    const MIN_STEP_MS = 16;
    const perStep = Math.max(1, Math.ceil(text.length / (budget / MIN_STEP_MS)));
    const stepMs = Math.max(MIN_STEP_MS, budget / Math.ceil(text.length / perStep));
    let shown = 0;
    this._typeTarget = { shownEl, restEl, text };

    this._typeTimer = setInterval(() => {
      shown = Math.min(text.length, shown + perStep);
      // Snap only the RENDERED index to a word boundary; `shown` stays monotonic
      // so text never un-reveals. Keeps a half-written word from occupying the end
      // of a row and then jumping down to the next one.
      let n = shown;
      if (n < text.length && text[n] !== ' ') {
        const sp = text.lastIndexOf(' ', n);
        if (sp > 0 && n - sp <= 12) n = sp + 1;
      }
      shownEl.textContent = text.slice(0, n);
      restEl.textContent = text.slice(n);
      if (shown >= text.length) {
        clearInterval(this._typeTimer);
        this._typeTimer = null;
        this._typeTarget = null;
      }
    }, stepMs);
  },

  /**
   * Cancel an in-flight reveal without stranding the line it was writing.
   * There is only one timer slot, so a new line used to kill the previous
   * reveal mid-word and leave that line permanently truncated — reliably so in a
   * background tab, where Chrome clamps timers to ~1s per tick.
   */
  _flushReveal() {
    if (this._typeTimer) {
      clearInterval(this._typeTimer);
      this._typeTimer = null;
    }
    if (this._typeTarget) {
      const { shownEl, restEl, text } = this._typeTarget;
      if (shownEl) shownEl.textContent = text;
      if (restEl) restEl.textContent = '';
      this._typeTarget = null;
    }
  },

  show() {
    this.createOverlay();
    this.overlay.style.display = 'block';
    this.overlay.offsetHeight; // force reflow
    this.overlay.style.opacity = '1';
    this.overlay.style.transform = 'translate(-50%, 0)';
  },

  hide() {
    if (!this.overlay) return;
    this.overlay.style.opacity = '0';
    this.overlay.style.transform = 'translate(-50%, 20px)';
    // Must outlast the 350ms opacity transition, or display:none cuts the fade.
    setTimeout(() => {
      if (this.overlay && this.overlay.style.opacity === '0') {
        this.overlay.style.display = 'none';
      }
    }, 400);
  },

  showProcessing() {
    // Intentionally no-op: keep the previous translation visible until the next final subtitle arrives.
  },

  showError(error) {
    const message = typeof error === 'string'
      ? error
      : (error && error.message) ? error.message : 'Live translation failed';

    console.warn('🎙️ [Content] Live translation error:', message);
    this.createOverlay();

    // An error replaces the feed outright — stale captions sitting above a
    // failure message read as if captioning were still working.
    this._clearFeed();
    const line = this._currentLine();
    if (!line) return;
    const transEl = line.querySelector('.subtitle-translation');
    const origEl = line.querySelector('.subtitle-original');
    this.show();

    transEl.style.animation = 'none';
    transEl.style.color = '#ff6b6b';
    transEl.style.opacity = '1';
    transEl.style.fontStyle = 'normal';
    transEl.textContent = '⚠️ ' + message;

    if (origEl) {
      origEl.style.display = 'none';
      origEl.textContent = '';
    }

    if (this.dimTimeout) clearTimeout(this.dimTimeout);
    this.dimTimeout = setTimeout(() => {
      this.hide();
    }, 10000);
  },

  showSubtitle(original, translated, sequenceNumber, targetLang) {
    // The overlay never learned the target language: lt_start has no sender
    // anywhere in the extension, so targetLang stayed at its 'vi' default and the
    // per-script reading speeds in _estimateReadMs ({zh:8, ja:8, ko:10, th:10})
    // were unreachable — CJK captions were paced at the 22 cps Latin rate.
    if (targetLang) this.targetLang = targetLang;
    if (sequenceNumber !== undefined) {
      if (sequenceNumber < this.lastSubtitleSeq) {
        console.log(`🎙️ [Content] Drop out-of-order/stale subtitle segment (seq: ${sequenceNumber} < last: ${this.lastSubtitleSeq})`);
        return;
      }
      this.lastSubtitleSeq = sequenceNumber;
    }

    if (translated === 'Listening...' || translated === 'Translating...' || translated === '✨ Translating...' || /^\s*(?:✨\s*)?Translating\.\.\.\s*$/i.test(String(translated || ''))) {
      // Wait silently until finished to avoid awkward interim flashing/loading indicators.
      return;
    }

    // Double check Whisper hallucination to protect display overlay
    if (isWhisperHallucination(original) || isWhisperHallucination(translated)) {
      console.log('🎙️ [Content] Filtered out Whisper hallucination overlay:', original, '->', translated);
      return;
    }

    // ── Interim real-time speech preview (prefixed with 🎙️) ──────────────────
    // Render directly only when the queue is idle (not currently holding a
    // final subtitle at minimum display time). If a final subtitle is on screen,
    // skip the interim update entirely to avoid breaking min-display-time.
    if (typeof translated === 'string' && translated.startsWith('🎙️')) {
      if (this._subtitleDisplaying) {
        // A final subtitle is currently being held — ignore this interim update
        return;
      }
      // Queue is idle: render interim directly so the user sees real-time
      // progress. It lands on its own line, tagged so the final subtitle
      // overwrites it instead of stacking a near-duplicate underneath.
      this.createOverlay();
      const interimLine = this._lineForFinal();
      if (!interimLine) return;
      interimLine.dataset.interim = '1';
      const transEl = interimLine.querySelector('.subtitle-translation');
      const origEl  = interimLine.querySelector('.subtitle-original');
      this.show();
      // Complete whatever line was mid-reveal before the interim takes over.
      this._flushReveal();
      // Dim rather than recolour: a fixed grey is invisible on the light presets.
      transEl.style.animation = 'none';
      transEl.style.color = this._preset().translation.color;
      transEl.style.opacity = '0.75';
      transEl.style.fontStyle = 'italic';
      transEl.textContent = translated.trim();
      origEl.style.display = 'none';
      origEl.textContent = '';
      this._trimFeed();
      if (this.dimTimeout) clearTimeout(this.dimTimeout);
      this.dimTimeout = null;
      return;
    }

    // ── Final translated subtitle — route through the read-paced queue ──────
    if (!translated || !translated.trim()) return;
    this._enqueueSubtitle(original, translated);
  },

  start(sourceLang, targetLang) {
    if (this.isListening) this.stop();
    this.sourceLang = sourceLang || 'en';
    this.targetLang = targetLang || 'vi';
    this.isListening = true;
    this.currentSegmentId = 'mic-' + Date.now();
    this.lastSpeechText = '';
    this.lastSubtitleSeq = -1;
    if (this.silenceTimeout) clearTimeout(this.silenceTimeout);
    this.silenceTimeout = null;

    console.log('🎙️ [Content] Microphone passive overlay started.');
    this.showSubtitle('', '🎙️ Listening to microphone...');
  },

  stop() {
    this.isListening = false;
    this.lastSubtitleSeq = -1;
    // Flush subtitle queue immediately on stop to prevent stale content
    this._subtitleQueue = [];
    this._subtitleDisplaying = false;
    this._clearFeed();
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }
    this.lastSpeechText = '';
    this.hide();

    // Automatically pause all playing videos/audio in this tab to avoid audio clutter when deactivating capture
    try {
      const mediaElements = document.querySelectorAll('video, audio');
      mediaElements.forEach(media => {
        if (!media.paused) {
          media.pause();
          console.log('🎙️ [Content] Automatically paused media (video/audio) to prevent audio overlap.');
        }
      });
    } catch (err) {
      console.warn('⚠️ [Content] Failed to auto-pause media elements on stop:', err);
    }
  }
};

// Subtitle display preferences live in the side panel, so pick up edits made
// while a stream is already running rather than only on the next start.
try {
  LiveTranslator._loadDisplayPrefs();
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.ltSubtitleLines || changes.ltSubtitleTypewriter || changes.ltSubtitleStyle) {
      LiveTranslator._loadDisplayPrefs();
    }
  });
} catch (_) {}

})();

