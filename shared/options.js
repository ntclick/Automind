// Enhanced User Settings JavaScript
class UserSettings {
    constructor() {
        this.init();
        this.loadSettings();
        this.setupEventListeners();
        this.setupAdditionalEventListeners();
        this.setupTestButtons();
        this.setupOnboarding();
        this.setupAiModeToggle();
    }

    /** Toggle between system default (50/day proxy) and custom (BYO key) */
    setupAiModeToggle() {
        const radios = document.querySelectorAll('input[name="aiMode"]');
        if (!radios.length) return;

        const customSection = document.getElementById('customAiSection');
        const routingSection = document.getElementById('taskRoutingSection');
        // The Live Captions section stays visible in both modes — its free
        // Web Speech engine needs no API key, so hiding it would strand
        // free-tier users with no way to pick an engine.

        // Expose for save handlers to flip UI without reload
        this._applyAiMode = (mode) => {
            const isCustom = mode === 'custom';
            if (customSection)  customSection.style.display  = isCustom ? '' : 'none';
            // Task routing only applies with user-provided keys
            if (routingSection) routingSection.style.display = isCustom ? '' : 'none';
            const target = document.querySelector(`input[name="aiMode"][value="${mode}"]`);
            if (target) target.checked = true;

            // Switching to Free tier must also clear a stale model from the
            // previous provider. Leaving e.g. "deepseek-v4-flash" behind made the
            // extension send it to OpenAI, which 404s and drops every generation
            // to canned fallback replies.
            const patch = { aiMode: mode };
            if (mode === 'system') {
                patch.apiProvider = 'openai';
                patch.selectedModel = 'gpt-4o-mini';
            }
            chrome.storage.sync.set(patch);

            if (this.refreshTaskMap) this.refreshTaskMap();
        };

        radios.forEach(radio => {
            radio.addEventListener('change', () => {
                if (radio.checked) this._applyAiMode(radio.value);
            });
        });

        // Restore saved mode on load
        chrome.storage.sync.get('aiMode', ({ aiMode }) => {
            this._applyAiMode(aiMode || 'system');
        });
    }

    init() {
        console.log('👤 Enhanced User Settings initialized');
        
        // Auto-request microphone permission if #request_mic hash is present!
        if (window.location.hash === '#request_mic') {
            console.log('🎙️ [Options] Requesting microphone permission via hash trigger...');
            navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
                stream.getTracks().forEach(track => track.stop());
                console.log('🎙️ [Options] Microphone permission granted.');
                this.showAlert('Microphone permission granted successfully! You can now close this tab and start captions.', 'success');
            }).catch(err => {
                console.error('🎙️ [Options] Microphone permission failed:', err);
                this.showAlert('Failed to grant microphone permission. Please click the mic icon in your address bar and select "Allow".', 'error');
            });
        }
    }

    async setupOnboarding() {
        const overlay = document.getElementById('onboardingOverlay');
        if (!overlay) return;
        try {
            const { onboarding } = await chrome.storage.local.get('onboarding');
            if (onboarding) overlay.classList.remove('hidden');
        } catch (_) {}

        const close = async () => {
            overlay.classList.add('hidden');
            await chrome.storage.local.set({ onboarding: false });
        };

        // Choice 1: free 50/day with default key (just close, default already kicks in)
        const free = document.getElementById('chooseFree');
        if (free) {
            free.addEventListener('click', async () => {
                await close();
                this.showAlert('Ready! You have 50 free uses per day.', 'success');
            });
        }

        // Choice 2: own API key — jump straight to AI & API Keys tab
        const own = document.getElementById('chooseOwnKey');
        if (own) {
            own.addEventListener('click', async () => {
                await close();
                const aiNav = document.querySelector('.nav-item[data-main-tab="ai"]');
                if (aiNav) aiNav.click();
                this.showAlert('Enter your API key for unlimited use.', 'info');
            });
        }

        const skip = document.getElementById('skipOnboarding');
        if (skip) skip.addEventListener('click', close);
    }

    setupEventListeners() {
        const MAX_TONES = 8;
        // Tone card click events
        document.querySelectorAll('.tone-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.tone-checkbox')) return;

                const checkbox = card.querySelector('input[type="checkbox"]');
                if (!checkbox || checkbox.disabled) return;

                // Block adding when limit reached
                if (!checkbox.checked) {
                    const checkedCount = document.querySelectorAll('.tone-checkbox input[type="checkbox"]:checked').length;
                    if (checkedCount >= MAX_TONES) {
                        this.showAlert(`Maximum ${MAX_TONES} tones`, 'warning');
                        return;
                    }
                }
                checkbox.checked = !checkbox.checked;
                this.updateToneSelection();
                this.saveUserSettings();
            });
        });

        // Tone checkbox change events
        document.querySelectorAll('.tone-checkbox input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                if (checkbox.checked) {
                    const checkedCount = document.querySelectorAll('.tone-checkbox input[type="checkbox"]:checked').length;
                    if (checkedCount > MAX_TONES) {
                        checkbox.checked = false;
                        this.showAlert(`Maximum ${MAX_TONES} tones`, 'warning');
                    }
                }
                this.updateToneSelection();
                this.saveUserSettings();
            });
        });

        // Default tone dropdown
        const defaultToneSelect = document.getElementById('defaultTone');
        if (defaultToneSelect) {
            defaultToneSelect.addEventListener('change', () => {
                this.selectTone(defaultToneSelect.value);
            });
        }

        // AI Provider dropdown - update models when provider changes
        const apiProviderSelect = document.getElementById('apiProvider');
        if (apiProviderSelect) {
            apiProviderSelect.addEventListener('change', () => {
                this.updateModelOptions(apiProviderSelect.value);
            });
        }

        // Temperature slider
        const temperatureSlider = document.getElementById('temperature');
        if (temperatureSlider) {
            temperatureSlider.addEventListener('input', () => {
                document.getElementById('temperatureValue').textContent = temperatureSlider.value;
            });
        }

        // Personal Character Configuration event listeners
        const authorPersonaSelect = document.getElementById('authorPersona');
        if (authorPersonaSelect) {
            authorPersonaSelect.addEventListener('change', () => {
                this.toggleCustomPersona();
            });
        }

        // Interest checkboxes
        document.querySelectorAll('.interest-item input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                this.updateInterestSelection();
            });
        });

        // Button dispatch keyed on data-action. Renaming a button label no longer
        // silently detaches its handler, which is what the old textContent
        // matching did.
        const ACTIONS = {
            'save-openai':   () => this.saveOpenAISettings(),
            'save-claude':   () => this.saveClaudeSettings(),
            'save-gemini':   () => this.saveGeminiSettings(),
            'save-kimi':     () => this.saveKimiSettings(),
            'save-deepseek': () => this.saveDeepSeekSettings(),
            'save-nvidia':   () => this.saveNvidiaSettings(),
            'save-groq':     () => this.saveGroqSettings(),
            'save-local':    () => this.saveLocalSettings(),
            'save-all':      () => this.saveAllApiKeys(),
            'test-openai':   () => this.testOpenAI(),
            'test-claude':   () => this.testClaude(),
            'test-gemini':   () => this.testGemini(),
            'test-kimi':     () => this.testKimi(),
            'test-deepseek': () => this.testDeepSeek(),
            'test-nvidia':   () => this.testNvidia(),
            'test-groq':     () => this.testGroq(),
            'test-local':    () => this.testLocal(),
            'test-all':      () => this.testAllApiKeys(),
            'goto-keys':     () => {
                const nav = document.querySelector('.nav-item[data-main-tab="keys"]');
                if (nav) nav.click();
            },
            'reset':         () => this.resetToDefaults()
        };

        document.querySelectorAll('[data-action]').forEach(btn => {
            const action = btn.getAttribute('data-action');
            const handler = ACTIONS[action];
            if (!handler) return;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('🔘 Action:', action);
                handler();
            });
        });

        this.setupAutoSave();
        this.setupProviderAccordion();
        this.setupTonePresets();

        // Setup main tab navigation
        this.setupMainTabNavigation();
        
        // Setup provider tab navigation
        this.setupTabNavigation();
    }

    /**
     * Everything that isn't an API key saves the instant it changes, so there
     * is no "did I remember to hit Save?" state to worry about. API keys keep
     * an explicit Save button because they pair with a Test action.
     */
    setupAutoSave() {
        const bind = (id, handler) => {
            const el = document.getElementById(id);
            if (!el || el._autoSaveBound) return;
            el._autoSaveBound = true;
            el.addEventListener('change', handler);
        };

        bind('commentLength', async () => {
            await chrome.storage.sync.set({ commentLength: document.getElementById('commentLength').value });
            this.showAlert('Reply length saved.', 'success');
        });

        bind('replyLanguage', async () => {
            await chrome.storage.sync.set({ language: document.getElementById('replyLanguage').value });
            this.showAlert('Reply language saved.', 'success');
        });

        bind('dailyQuota', async () => {
            const raw = parseInt(document.getElementById('dailyQuota').value, 10);
            const quota = Number.isFinite(raw) ? Math.min(1000, Math.max(0, raw)) : 50;
            document.getElementById('dailyQuota').value = quota;
            await chrome.storage.sync.set({ dailyQuota: quota });
            this.showAlert(`Daily limit set to ${quota}.`, 'success');
        });

        // Subtitle translation engine. Stored in storage.local because the side
        // panel owns the same key — writing it here syncs the panel live.
        bind('ltEngine', async () => {
            const v = document.getElementById('ltEngine').value;
            await chrome.storage.local.set({ ltEngine: v });
            this.showAlert(v === 'google'
                ? 'Subtitles will use Google Translate (free, no quota).'
                : 'Subtitles will use Premium AI.', 'success');
            this.refreshTaskMap();
        });
    }

    /**
     * Paint the "What powers each task" summary. The three jobs genuinely run on
     * different engines — replies go through the AI provider, subtitle text goes
     * through the translation engine, and audio goes through the ASR engine — so
     * showing one blanket "provider" would be wrong.
     */
    async refreshTaskMap() {
        const set = (engineId, tagId, engineText, tagText, tagClass) => {
            const e = document.getElementById(engineId);
            const t = document.getElementById(tagId);
            if (e) e.textContent = engineText;
            if (t) { t.textContent = tagText; t.className = 'task-tag ' + (tagClass || ''); }
        };

        const PROVIDER_LABEL = {
            openai: 'OpenAI', claude: 'Claude', gemini: 'Gemini', kimi: 'Kimi',
            deepseek: 'DeepSeek', nvidia: 'NVIDIA NIM', local: 'Local AI Server'
        };
        // Mirrors background.js — this panel must show the model that will
        // ACTUALLY be sent, not a stale value left over from another provider.
        const MODEL_PREFIXES = {
            openai: [/^gpt-/i, /^o[1-9]/i], claude: [/^claude-/i], gemini: [/^gemini-/i],
            kimi: [/^moonshot-/i, /^kimi-/i], deepseek: [/^deepseek-/i], nvidia: [/\//], local: [/./]
        };
        const DEFAULT_MODELS = {
            claude: 'claude-haiku-4-5-20251001', openai: 'gpt-4o-mini',
            gemini: 'gemini-3.1-flash-preview', kimi: 'moonshot-v1-32k',
            deepseek: 'deepseek-v4-flash', nvidia: 'nvidia/llama-3.1-nemotron-51b-instruct',
            local: 'auto'
        };
        const resolveModel = (model, provider) => {
            const rules = MODEL_PREFIXES[provider];
            if (model && (!rules || rules.some(re => re.test(model)))) return model;
            return DEFAULT_MODELS[provider] || 'gpt-4o-mini';
        };

        try {
            const s = await chrome.storage.sync.get([
                'aiMode', 'apiProvider', 'selectedModel', 'ltAsrEngine',
                'writeProvider', 'writeModel', 'translateProvider', 'translateModel',
                'tldrProvider', 'tldrGroqModel', 'tldrOpenaiModel',
                'groqApiKey', 'openaiApiKey'
            ]);
            const local = await chrome.storage.local.get(['ltEngine']);

            const isFree = (s.aiMode || 'system') !== 'custom';
            const mainProvider = isFree ? 'openai' : (s.apiProvider || 'openai');
            const mainModel = isFree ? 'gpt-4o-mini' : (s.selectedModel || 'default model');

            const describe = (routedProvider, routedModel) => {
                if (isFree) return 'OpenAI · gpt-4o-mini · via AutoMind (key included)';
                const p = routedProvider || mainProvider;
                const m = resolveModel(routedModel || (routedProvider ? '' : mainModel), p);
                return `${PROVIDER_LABEL[p] || p} · ${m}`;
            };

            // 1 — Reply generation
            set('taskEngineWrite', 'taskTagWrite',
                describe(s.writeProvider, s.writeModel),
                isFree ? '50 / day' : 'your key',
                isFree ? 'quota' : 'own');

            // 2 — Subtitle translation
            const ltEngine = local.ltEngine || 'google';
            if (ltEngine === 'google') {
                set('taskEngineTranslate', 'taskTagTranslate',
                    'Google Translate · no key, no quota', 'free', 'free');
            } else {
                set('taskEngineTranslate', 'taskTagTranslate',
                    describe(s.translateProvider, s.translateModel),
                    isFree ? '50 / day' : 'your key',
                    isFree ? 'quota' : 'own');
            }

            // 3 — Speech recognition (and flag a missing key rather than failing at start)
            const asr = s.ltAsrEngine || 'groq';
            const warn = document.getElementById('asrKeyWarning');
            let warnText = '';
            if (asr === 'webSpeech') {
                set('taskEngineAsr', 'taskTagAsr', "Chrome Web Speech · uses your microphone", 'free', 'free');
            } else if (asr === 'groq') {
                const ok = !!(s.groqApiKey || '').trim();
                set('taskEngineAsr', 'taskTagAsr', 'Groq Whisper Large v3 · tab audio',
                    ok ? 'your key' : 'key missing', ok ? 'own' : 'warn');
                if (!ok) warnText = 'No Groq key saved yet — live captions will not start. Add it on the API Keys tab, or switch to Web Speech API (free).';
            } else {
                const ok = !!(s.openaiApiKey || '').trim();
                set('taskEngineAsr', 'taskTagAsr', 'OpenAI Whisper · tab audio',
                    ok ? 'your key' : 'key missing', ok ? 'own' : 'warn');
                if (!ok) warnText = 'No OpenAI key saved yet — live captions will not start. Add it on the API Keys tab, or switch to Web Speech API (free).';
            }
            if (warn) {
                warn.textContent = warnText;
                warn.style.display = warnText ? 'block' : 'none';
            }

            // 4 — Video TLDR → post (always the user's own Groq/OpenAI key —
            // transcripts are too long for the free-tier proxy)
            const tldrProvider = s.tldrProvider === 'openai' ? 'openai' : 'groq';
            if (tldrProvider === 'groq') {
                const ok = !!(s.groqApiKey || '').trim();
                set('taskEngineTldr', 'taskTagTldr',
                    `Groq · ${s.tldrGroqModel || 'llama-3.3-70b-versatile'} · captions transcript`,
                    ok ? 'your key' : 'key missing', ok ? 'own' : 'warn');
            } else {
                const ok = !!(s.openaiApiKey || '').trim();
                set('taskEngineTldr', 'taskTagTldr',
                    `OpenAI · ${s.tldrOpenaiModel || 'gpt-4o-mini'} · captions transcript`,
                    ok ? 'your key' : 'key missing', ok ? 'own' : 'warn');
            }
        } catch (e) {
            console.warn('⚠️ Could not refresh task map:', e);
        }

        // The audit panel answers the same question one tab over, so it must
        // never lag behind this one.
        this.renderKeyAudit();
    }

    /** Expand/collapse provider cards so seven providers aren't all open at once. */
    setupProviderAccordion() {
        document.querySelectorAll('.provider-row').forEach(row => {
            const header = row.querySelector('.provider-row-header');
            if (!header) return;
            header.addEventListener('click', (e) => {
                // The radio and its label pick the active provider — don't toggle on those
                if (e.target.closest('.provider-row-radio') || e.target.closest('.provider-row-title')) return;
                row.classList.toggle('open');
            });
        });

        // Auto-open whichever provider is currently active so the key is visible
        const active = document.querySelector('input[name="activeProvider"]:checked');
        if (active) {
            const row = document.querySelector(`.provider-row[data-provider="${active.value}"]`);
            if (row) row.classList.add('open');
        }
    }

    /** Green dot on a provider row = a key is stored for it. */
    refreshKeyDots() {
        document.querySelectorAll('.key-dot[data-key-for]').forEach(dot => {
            const input = document.getElementById(dot.getAttribute('data-key-for'));
            const hasValue = !!(input && input.value && input.value.trim());
            dot.classList.toggle('set', hasValue);
            dot.title = hasValue ? 'Key saved' : 'No key yet';
        });
    }

    setupTonePresets() {
        const starter = document.getElementById('tonePresetStarter');
        const clear = document.getElementById('tonePresetClear');
        const setTones = (tones) => {
            document.querySelectorAll('.tone-checkbox input[type="checkbox"]').forEach(cb => {
                cb.disabled = false;
                cb.checked = tones.includes(cb.value);
            });
            this.updateToneSelection();
            this.saveUserSettings();
        };
        if (starter) starter.addEventListener('click', () => setTones(['professional', 'casual', 'witty', 'analytical', 'contrarian']));
        if (clear) clear.addEventListener('click', () => setTones([]));
    }

    // Setup main tab navigation
    setupMainTabNavigation() {
        // Support both old .main-tab-btn and new .nav-item
        const mainTabButtons = document.querySelectorAll('.main-tab-btn, .nav-item[data-main-tab]');
        const mainTabContents = document.querySelectorAll('.main-tab-content');

        mainTabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = button.getAttribute('data-main-tab');

                mainTabButtons.forEach(btn => btn.classList.remove('active'));
                mainTabContents.forEach(content => content.classList.remove('active'));
                
                // Add active class to clicked button and corresponding content
                button.classList.add('active');
                document.getElementById(`${targetTab}-tab`).classList.add('active');
            });
        });
    }

    // Setup provider list event handlers and radios
    setupTabNavigation() {
        // Handle radio button changes explicitly setting active provider
        const radios = document.querySelectorAll('input[name="activeProvider"]');
        radios.forEach(radio => {
            radio.addEventListener('change', () => {
                if (radio.checked) {
                    const provider = radio.value;
                    this.updateActiveProviderUI(provider);
                    
                    // Save active provider and mirror the selected model for that provider
                    chrome.storage.sync.set({ apiProvider: provider });
                    
                    // Determine which model dropdown to read from
                    let modelKey = `${provider}Model`;
                    if (provider === 'local') modelKey = 'localModel';
                    
                    const modelDropdown = document.getElementById(modelKey);
                    if (modelDropdown) {
                        chrome.storage.sync.set({ selectedModel: modelDropdown.value });
                        // Sync DOM hidden element too for compatibility
                        const hiddenModelSelect = document.getElementById('selectedModel');
                        if (hiddenModelSelect) {
                            hiddenModelSelect.innerHTML = `<option value="${modelDropdown.value}" selected>${modelDropdown.value}</option>`;
                        }
                    }
                }
            });
        });

        // Also add change listeners to the individual model dropdowns to sync selectedModel
        const modelSelectors = ['openaiModel', 'claudeModel', 'geminiModel', 'kimiModel', 'deepseekModel', 'nvidiaModel', 'localModel'];
        modelSelectors.forEach(selectorId => {
            const el = document.getElementById(selectorId);
            if (el) {
                el.addEventListener('change', () => {
                    // Only update selectedModel in storage if this dropdown belongs to the currently active provider
                    const activeRadio = document.querySelector('input[name="activeProvider"]:checked');
                    const provider = activeRadio ? activeRadio.value : '';
                    const expectedPrefix = selectorId.toLowerCase();
                    if (expectedPrefix.startsWith(provider)) {
                        chrome.storage.sync.set({ selectedModel: el.value });
                        // Sync DOM hidden element too for compatibility
                        const hiddenModelSelect = document.getElementById('selectedModel');
                        if (hiddenModelSelect) {
                            hiddenModelSelect.innerHTML = `<option value="${el.value}" selected>${el.value}</option>`;
                        }
                    }
                });
            }
        });
    }

    // Helper to update active provider UI styling and check states
    updateActiveProviderUI(provider) {
        if (!provider) return;
        
        // Check the correct radio button
        const radio = document.querySelector(`input[name="activeProvider"][value="${provider}"]`);
        if (radio) radio.checked = true;

        // Toggle active class on rows, and expand the active one so its key is visible
        document.querySelectorAll('.provider-row').forEach(row => {
            const isActive = row.getAttribute('data-provider') === provider;
            row.classList.toggle('active', isActive);
            if (isActive) row.classList.add('open');
        });

        // Update hidden select for legacy compatibility
        const hiddenSelect = document.getElementById('apiProvider');
        if (hiddenSelect) {
            hiddenSelect.value = provider;
        }

        if (this.refreshTaskMap) this.refreshTaskMap();
    }

    setupAdditionalEventListeners() {
        console.log('🔧 Setting up additional event listeners...');
        
        // Ensure all save buttons work with specific targeting
        setTimeout(() => {
            // Character Settings Save Button
            const characterSaveBtn = document.querySelector('button[onclick*="saveCharacterSettings"]');
            if (!characterSaveBtn) {
                // Find by text content
                const allBtns = document.querySelectorAll('.btn');
                allBtns.forEach(btn => {
                    if (btn.textContent.toLowerCase().includes('save character')) {
                        console.log('🎯 Found character save button, adding listener');
                        btn.addEventListener('click', (e) => {
                            e.preventDefault();
                            console.log('👤 Character save button clicked directly!');
                            this.saveCharacterSettings();
                        });
                    }
                    if (btn.textContent.toLowerCase().includes('save language')) {
                        console.log('🎯 Found language save button, adding listener');
                        btn.addEventListener('click', (e) => {
                            e.preventDefault();
                            console.log('🌐 Language save button clicked directly!');
                            this.saveLanguageSettings();
                        });
                    }
                    if (btn.textContent.toLowerCase().includes('save tone') || btn.textContent.toLowerCase().includes('save tone settings')) {
                        console.log('🎯 Found tone save button, adding listener');
                        btn.addEventListener('click', (e) => {
                            e.preventDefault();
                            console.log('🎭 Tone save button clicked directly!');
                            this.saveUserSettings();
                        });
                    }
                });
            }
        }, 1000); // Wait for DOM to be fully loaded
    }

    // Alert System
    showAlert(message, type = 'info') {
        console.log('🔔 Showing alert:', message, 'Type:', type);
        const alertDiv = document.getElementById('statusAlert');
        
        if (!alertDiv) {
            console.error('❌ Alert div not found!');
            return;
        }
        
        alertDiv.textContent = message;
        alertDiv.className = `alert alert-${type}`;
        alertDiv.style.display = 'block';
        
        console.log('✅ Alert displayed:', alertDiv.textContent, 'Class:', alertDiv.className);
        
        setTimeout(() => {
            alertDiv.style.display = 'none';
            console.log('🔕 Alert hidden');
        }, 5000);
    }

    // Setup test button event listeners
    setupTestButtons() {
        console.log('🔧 Setting up test button event listeners...');
        
        const testButtons = {
            'testAlertBtn': () => this.testAlert(),
            'testAllSavesBtn': () => this.testAllSaves(),
            'testAllSaveButtonsBtn': () => this.testAllSaveButtons(),
            'testAllFunctionsBtn': () => this.testAllFunctions(),
            'resetDailyQuotaBtn': () => this.resetDailyQuota(),
            'testSettingsSyncBtn': () => this.testSettingsSync(),
            'testQuotaBtn': () => this.testQuota(),
            'testAPIConnectionBtn': () => testAPIConnection(),
            'testAIGenerationBtn': () => this.testAIGeneration(),
            'testPingBtn': () => this.testPing()
        };
        
        for (const [id, handler] of Object.entries(testButtons)) {
            const button = document.getElementById(id);
            if (button) {
                button.addEventListener('click', handler);
                console.log(`✅ Added event listener for ${id}`);
            } else {
                console.warn(`⚠️ Button ${id} not found`);
            }
        }
    }

    // Update Multiple Tone Selection (max 8 tones)
    updateToneSelection() {
        const MAX_TONES = 8;
        const toneCheckboxes = document.querySelectorAll('.tone-checkbox input[type="checkbox"]');
        const checkedCount = document.querySelectorAll('.tone-checkbox input[type="checkbox"]:checked').length;

        toneCheckboxes.forEach(checkbox => {
            const tone = checkbox.value;
            const card = document.querySelector(`[data-tone="${tone}"]`);
            if (!card) return;

            if (checkbox.checked) {
                card.classList.add('selected');
                card.classList.remove('disabled');
            } else {
                card.classList.remove('selected');
                // Disable unchecked tones when limit reached
                if (checkedCount >= MAX_TONES) {
                    card.classList.add('disabled');
                    checkbox.disabled = true;
                } else {
                    card.classList.remove('disabled');
                    checkbox.disabled = false;
                }
            }
        });

        // Update count badge if exists
        const countBadge = document.getElementById('toneCountBadge');
        if (countBadge) {
            countBadge.textContent = `${checkedCount}/${MAX_TONES}`;
            countBadge.classList.toggle('full', checkedCount >= MAX_TONES);
        }
    }

    // Tone Selection
    selectTone(tone) {
        // Update dropdown
        const defaultToneSelect = document.getElementById('defaultTone');
        if (defaultToneSelect) {
            defaultToneSelect.value = tone;
        }

        // Update visual selection
        const toneCards = document.querySelectorAll('.tone-card');
        toneCards.forEach(card => {
            card.classList.remove('selected');
            if (card.dataset.tone === tone) {
                card.classList.add('selected');
            }
        });

        console.log('✅ Tone selected:', tone);
    }

    // Save User Settings with multiple tone support
    async saveUserSettings() {
        console.log('💾 Starting to save user settings...');
        try {
            // defaultTone / preferredLanguage were removed from the UI (they
            // duplicated the tone grid and the Reply Language select). Read them
            // defensively so this keeps working with or without those elements.
            const defaultToneEl = document.getElementById('defaultTone');
            const preferredLanguageEl = document.getElementById('preferredLanguage');

            // Get selected tones from checkboxes
            const selectedTones = [];
            const toneCheckboxes = document.querySelectorAll('.tone-checkbox input[type="checkbox"]:checked');
            toneCheckboxes.forEach(checkbox => {
                selectedTones.push(checkbox.value);
            });

            console.log('📝 Selected tones:', selectedTones);
            console.log('📝 Selected tones count:', selectedTones.length);

            // Cap at 8 tones
            if (selectedTones.length > 8) {
                selectedTones.length = 8;
                console.warn('⚠️ Truncated to 8 tones max');
            }
            // If no tones selected, use 5 default tones
            if (selectedTones.length === 0) {
                selectedTones.push('professional', 'casual', 'witty', 'analytical', 'contrarian');
                console.log('⚠️ No tones selected, using 5 default tones');
            }

            const userSettings = {
                defaultTone: defaultToneEl ? defaultToneEl.value : (selectedTones[0] || 'professional'),
                selectedTones: selectedTones,
                preferredLanguage: preferredLanguageEl ? preferredLanguageEl.value : 'auto'
            };

            console.log('💾 Saving to storage:', userSettings);
            console.log('💾 Saving selectedTones count:', userSettings.selectedTones.length);

            await chrome.storage.sync.set({
                userSettings: userSettings,
                lastUpdated: new Date().toISOString()
            });

            console.log('✅ Storage save completed');
            this.showAlert(`Saved — ${selectedTones.length} tone${selectedTones.length === 1 ? '' : 's'} active.`, 'success');
            console.log('✅ User settings saved:', userSettings);
        } catch (error) {
            console.error('❌ Error saving user settings:', error);
            this.showAlert('Error saving user settings: ' + error.message, 'error');
        }
    }

    // Save Language Settings
    async saveLanguageSettings() {
        try {
            const el = document.getElementById('preferredLanguage') || document.getElementById('replyLanguage');
            const languageSettings = {
                preferredLanguage: el ? el.value : 'auto'
            };

            await chrome.storage.sync.set({
                userLanguageSettings: languageSettings,
                lastUpdated: new Date().toISOString()
            });

            this.showAlert('Language settings saved successfully', 'success');
            console.log('✅ Language settings saved:', languageSettings);
        } catch (error) {
            this.showAlert('Error saving language settings', 'error');
            console.error('❌ Error saving language settings:', error);
        }
    }

    // Update Model Options based on provider
    updateModelOptions(provider) {
        const modelSelect = document.getElementById('selectedModel');
        if (!modelSelect) return;

        // Clear existing options
        modelSelect.innerHTML = '';

        // Model lists — newest first, legacy retained so existing users with their own
        // older keys / model IDs keep working without forced migration.
        const models = {
            openai: [
                // Cheapest first — recommended for cost-conscious users
                { value: 'gpt-4o-mini',   text: 'GPT-4o Mini (cheapest, recommended)' },
                { value: 'gpt-4o',        text: 'GPT-4o' },
                { value: 'gpt-4.1-mini',  text: 'GPT-4.1 Mini' },
                { value: 'gpt-4.1',       text: 'GPT-4.1' },
                // 2026 newer (5x more expensive than 4o-mini)
                { value: 'gpt-5.4-mini',  text: 'GPT-5.4 Mini (newer, pricier)' },
                { value: 'gpt-5.4-nano',  text: 'GPT-5.4 Nano' },
                { value: 'gpt-5.4',       text: 'GPT-5.4' },
                { value: 'gpt-5.5',       text: 'GPT-5.5 (flagship)' },
                { value: 'gpt-5',         text: 'GPT-5' },
                { value: 'gpt-5-mini',    text: 'GPT-5 Mini' },
                { value: 'gpt-5-nano',    text: 'GPT-5 Nano' },
                { value: 'gpt-3.5-turbo', text: 'GPT-3.5 Turbo' }
            ],
            claude: [
                // 2026 latest
                { value: 'claude-haiku-4-5-20251001',   text: 'Claude Haiku 4.5 (recommended)' },
                { value: 'claude-sonnet-4-6',           text: 'Claude Sonnet 4.6 (balanced)' },
                { value: 'claude-opus-4-7',             text: 'Claude Opus 4.7 (top reasoning)' },
                { value: 'claude-opus-4-6',             text: 'Claude Opus 4.6' },
                { value: 'claude-sonnet-4-5-20250929',  text: 'Claude Sonnet 4.5' },
                // 2025 legacy
                { value: 'claude-4-sonnet-20250522',    text: 'Claude 4 Sonnet (legacy)' },
                { value: 'claude-4-haiku',              text: 'Claude 4 Haiku (legacy)' },
                { value: 'claude-3.5-sonnet',           text: 'Claude 3.5 Sonnet (legacy)' }
            ],
            gemini: [
                // 2026 latest
                { value: 'gemini-3.1-flash-preview',      text: 'Gemini 3.1 Flash (recommended)' },
                { value: 'gemini-3.1-flash-lite-preview', text: 'Gemini 3.1 Flash Lite (free tier)' },
                { value: 'gemini-3.1-pro-preview',        text: 'Gemini 3.1 Pro (flagship)' },
                { value: 'gemini-2.5-flash-lite',         text: 'Gemini 2.5 Flash Lite (stable)' },
                // 2025 legacy
                { value: 'gemini-2.0-flash-exp',          text: 'Gemini 2.0 Flash (legacy)' },
                { value: 'gemini-2.0-pro',                text: 'Gemini 2.0 Pro (legacy)' },
                { value: 'gemini-1.5-pro-latest',         text: 'Gemini 1.5 Pro (legacy)' },
                { value: 'gemini-1.5-flash-latest',       text: 'Gemini 1.5 Flash (legacy)' },
                { value: 'gemini-1.5-flash-8b-latest',    text: 'Gemini 1.5 Flash 8B (legacy)' }
            ],
            kimi: [
                { value: 'kimi-k2.6',         text: 'Kimi K2.6 (latest, thinking)' },
                { value: 'kimi-k2.5',         text: 'Kimi K2.5 (vision)' },
                { value: 'kimi-k2-thinking',  text: 'Kimi K2 Thinking (reasoning)' },
                { value: 'moonshot-v1-32k',   text: 'Moonshot v1 32K (recommended, fast)' },
                { value: 'moonshot-v1-128k',  text: 'Moonshot v1 128K (long context)' },
                { value: 'moonshot-v1-8k',    text: 'Moonshot v1 8K (cheapest)' }
            ],
            deepseek: [
                { value: 'deepseek-v4-flash', text: 'DeepSeek V4 Flash (cheap, recommended)' },
                { value: 'deepseek-v4-pro',   text: 'DeepSeek V4 Pro (flagship)' },
                { value: 'deepseek-chat',     text: 'deepseek-chat (legacy alias)' },
                { value: 'deepseek-reasoner', text: 'deepseek-reasoner (legacy alias)' }
            ],
            nvidia: [
                { value: 'nvidia/llama-3.1-nemotron-51b-instruct', text: 'NVIDIA Llama 3.1 Nemotron 51B Instruct (recommended)' },
                { value: 'meta/llama-3.3-70b-instruct', text: 'Meta Llama 3.3 70B Instruct (high quality)' },
                { value: 'meta/llama-3.1-70b-instruct', text: 'Meta Llama 3.1 70B Instruct' },
                { value: 'meta/llama-3.1-8b-instruct', text: 'Meta Llama 3.1 8B Instruct' },
                { value: 'meta/llama-3.1-405b-instruct', text: 'Meta Llama 3.1 405B Instruct' },
                { value: 'mistralai/mistral-large-2-instruct', text: 'Mistral Large 2 Instruct' },
                { value: 'mistralai/mistral-nemo-12b-instruct', text: 'Mistral Nemo 12B Instruct' },
                { value: 'google/gemma-2-27b-it', text: 'Google Gemma 2 27B IT' },
                { value: 'google/gemma-2-9b-it', text: 'Google Gemma 2 9B IT' },
                { value: 'qwen/qwen-2.5-72b-instruct', text: 'Qwen 2.5 72B Instruct' },
                { value: 'qwen/qwen-2.5-coder-32b-instruct', text: 'Qwen 2.5 Coder 32B Instruct' },
                { value: 'microsoft/phi-3-medium-128k-instruct', text: 'Microsoft Phi-3 Medium' }
            ],
            local: [
                { value: 'auto',        text: 'Auto-detect' },
                { value: 'llama-3.1',   text: 'Llama 3.1' },
                { value: 'mistral-7b',  text: 'Mistral 7B' },
                { value: 'codellama',   text: 'Code Llama' }
            ]
        };

        const providerModels = models[provider] || [];
        providerModels.forEach(model => {
            const option = document.createElement('option');
            option.value = model.value;
            option.textContent = model.text;
            modelSelect.appendChild(option);
        });

        console.log('✅ Model options updated for provider:', provider);
    }

    // Save Model Settings
    async saveModelSettings() {
        try {
            const modelSettings = {
                apiProvider: document.getElementById('apiProvider').value,
                selectedModel: document.getElementById('selectedModel').value
            };

            await chrome.storage.sync.set(modelSettings);
            this.showAlert('Model settings saved successfully', 'success');
            console.log('✅ Model settings saved:', modelSettings);
        } catch (error) {
            this.showAlert('Error saving model settings', 'error');
            console.error('❌ Error saving model settings:', error);
        }
    }

    // Test Model Connection
    async testModelConnection() {
        try {
            const provider = document.getElementById('apiProvider').value;
            const model = document.getElementById('selectedModel').value;

            console.log('🔗 [OPTIONS] Testing model connection:', { provider, model });
            this.showAlert('Testing model connection...', 'warning');

            const requestData = {
                action: 'testModelConnection',
                provider: provider,
                model: model
            };
            console.log('📤 [OPTIONS] Sending test request:', requestData);

            const startTime = Date.now();
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(requestData, (response) => {
                    const elapsed = Date.now() - startTime;
                    console.log('📥 [OPTIONS] Background response received:', {
                        response: response,
                        elapsedMs: elapsed,
                        hasLastError: !!chrome.runtime.lastError
                    });

                    if (chrome.runtime.lastError) {
                        console.error('❌ [OPTIONS] Chrome runtime error:', chrome.runtime.lastError.message);
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        console.log('✅ [OPTIONS] Background response parsed successfully');
                        resolve(response);
                    }
                });
            });

            if (response && response.success) {
                this.showAlert('Model connection test successful!', 'success');
            } else {
                this.showAlert(`Model test failed: ${response?.error || 'Unknown error'}`, 'error');
            }
        } catch (error) {
            this.showAlert(`Model test failed: ${error.message}`, 'error');
            console.error('❌ Model test error:', error);
        }
    }

    // Save System Settings
    async saveSystemSettings() {
        try {
            // maxTokens / temperature / promptType were dropped from the UI —
            // background.js never read them, so exposing them was misleading.
            const val = (id, fallback) => {
                const el = document.getElementById(id);
                return el && el.value !== '' ? el.value : fallback;
            };
            const systemSettings = {
                dailyQuota: parseInt(val('dailyQuota', 50), 10) || 50,
                commentLength: val('commentLength', 'medium'),
                language: val('replyLanguage', 'auto')
            };

            await chrome.storage.sync.set(systemSettings);
            this.showAlert('System settings saved successfully', 'success');
            console.log('✅ System settings saved:', systemSettings);
        } catch (error) {
            this.showAlert('Error saving system settings', 'error');
            console.error('❌ Error saving system settings:', error);
        }
    }

    // Individual Provider Settings Methods
    async saveOpenAISettings() {
        try {
            const model = document.getElementById('openaiModel').value;
            const settings = {
                openaiApiKey: document.getElementById('openaiApiKey').value.trim(),
                openaiModel: model,
                apiProvider: 'openai',
                selectedModel: model,
                aiMode: 'custom'
            };
            if (!settings.openaiApiKey) {
                this.showAlert('Please enter OpenAI API Key', 'error');
                return;
            }
            await chrome.storage.sync.set(settings);
            if (this._applyAiMode) this._applyAiMode('custom');
            this.updateActiveProviderUI('openai');
            this.showAlert('OpenAI settings saved — OpenAI is now your active provider.', 'success');
        } catch (error) {
            this.showAlert('Error saving OpenAI settings', 'error');
            console.error('❌ Error saving OpenAI settings:', error);
        }
    }

    async testOpenAI() {
        try {
            const apiKey = document.getElementById('openaiApiKey').value.trim();
            const model = document.getElementById('openaiModel').value;

            console.log('🤖 [OPTIONS] Testing OpenAI:', { model, hasApiKey: !!apiKey, apiKeyLength: apiKey.length });

            if (!apiKey) {
                this.showAlert('Please enter OpenAI API Key first', 'error');
                return;
            }

            this.showAlert('Testing OpenAI connection...', 'warning');

            const requestData = {
                action: 'testApiKey',
                provider: 'openai',
                apiKey: apiKey,
                model: model
            };
            console.log('📤 [OPTIONS] OpenAI test request:', { action: requestData.action, provider: requestData.provider, model: requestData.model });

            const startTime = Date.now();
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(requestData, (response) => {
                    const elapsed = Date.now() - startTime;
                    console.log('📥 [OPTIONS] OpenAI test response:', {
                        response: response,
                        elapsedMs: elapsed,
                        hasLastError: !!chrome.runtime.lastError,
                        lastError: chrome.runtime.lastError?.message
                    });

                    if (chrome.runtime.lastError) {
                        console.error('❌ [OPTIONS] OpenAI Chrome runtime error:', chrome.runtime.lastError.message);
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        console.log('✅ [OPTIONS] OpenAI response parsed successfully');
                        resolve(response);
                    }
                });
            });

            if (response && response.success) {
                this.showAlert('OpenAI connection test successful!', 'success');
            } else {
                this.showAlert(`OpenAI test failed: ${response?.error || 'Unknown error'}`, 'error');
            }
        } catch (error) {
            this.showAlert(`OpenAI test failed: ${error.message}`, 'error');
            console.error('❌ OpenAI test error:', error);
        }
    }

    async saveClaudeSettings() {
        try {
            const model = document.getElementById('claudeModel').value;
            const settings = {
                claudeApiKey: document.getElementById('claudeApiKey').value.trim(),
                claudeModel: model,
                apiProvider: 'claude',
                selectedModel: model,
                aiMode: 'custom'
            };
            if (!settings.claudeApiKey) {
                this.showAlert('Please enter Claude API Key', 'error');
                return;
            }
            await chrome.storage.sync.set(settings);
            if (this._applyAiMode) this._applyAiMode('custom');
            this.updateActiveProviderUI('claude');
            this.showAlert('Claude settings saved — Claude is now your active provider.', 'success');
        } catch (error) {
            this.showAlert('Error saving Claude settings', 'error');
            console.error('❌ Error saving Claude settings:', error);
        }
    }

    async testClaude() {
        try {
            const apiKey = document.getElementById('claudeApiKey').value.trim();
            const model = document.getElementById('claudeModel').value;

            console.log('🧠 [OPTIONS] Testing Claude:', { model, hasApiKey: !!apiKey, apiKeyLength: apiKey.length });

            if (!apiKey) {
                this.showAlert('Please enter Claude API Key first', 'error');
                return;
            }

            this.showAlert('Testing Claude connection...', 'warning');

            const requestData = {
                action: 'testApiKey',
                provider: 'claude',
                apiKey: apiKey,
                model: model
            };
            console.log('📤 [OPTIONS] Claude test request:', { action: requestData.action, provider: requestData.provider, model: requestData.model });

            const startTime = Date.now();
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(requestData, (response) => {
                    const elapsed = Date.now() - startTime;
                    console.log('📥 [OPTIONS] Claude test response:', {
                        response: response,
                        elapsedMs: elapsed,
                        hasLastError: !!chrome.runtime.lastError,
                        lastError: chrome.runtime.lastError?.message
                    });

                    if (chrome.runtime.lastError) {
                        console.error('❌ [OPTIONS] Claude Chrome runtime error:', chrome.runtime.lastError.message);
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        console.log('✅ [OPTIONS] Claude response parsed successfully');
                        resolve(response);
                    }
                });
            });

            if (response && response.success) {
                this.showAlert('Claude connection test successful!', 'success');
            } else {
                this.showAlert(`Claude test failed: ${response?.error || 'Unknown error'}`, 'error');
            }
        } catch (error) {
            this.showAlert(`Claude test failed: ${error.message}`, 'error');
            console.error('❌ Claude test error:', error);
        }
    }

    async saveGeminiSettings() {
        try {
            const model = document.getElementById('geminiModel').value;
            const settings = {
                geminiApiKey: document.getElementById('geminiApiKey').value.trim(),
                geminiModel: model,
                apiProvider: 'gemini',
                selectedModel: model,
                aiMode: 'custom'
            };
            if (!settings.geminiApiKey) {
                this.showAlert('Please enter Gemini API Key', 'error');
                return;
            }
            await chrome.storage.sync.set(settings);
            if (this._applyAiMode) this._applyAiMode('custom');
            this.updateActiveProviderUI('gemini');
            this.showAlert('Gemini settings saved — Gemini is now your active provider.', 'success');
        } catch (error) {
            this.showAlert('Error saving Gemini settings', 'error');
            console.error('❌ Error saving Gemini settings:', error);
        }
    }

    async testGemini() {
        try {
            const apiKey = document.getElementById('geminiApiKey').value.trim();
            const selectedGeminiModel = document.getElementById('geminiModel').value;

            console.log('💎 [OPTIONS] Testing Gemini:', { hasApiKey: !!apiKey, apiKeyLength: apiKey.length, selectedModel: selectedGeminiModel });

            if (!apiKey) {
                this.showAlert('Please enter Gemini API Key first', 'error');
                return;
            }

            this.showAlert('Testing Gemini models...', 'warning');

            // Test multiple models - prioritize the user's selected model first!
            const modelsToTest = [
                selectedGeminiModel,
                'gemini-3.1-flash-preview',
                'gemini-2.5-flash-lite',
                'gemini-1.5-flash'
            ].filter((v, i, a) => a.indexOf(v) === i); // Deduplicate

            let workingModels = [];
            let failedModels = [];

            for (const model of modelsToTest) {
                console.log(`🧪 [OPTIONS] Testing model: ${model}`);

                try {
                    const requestData = {
                        action: 'testApiKey',
                        provider: 'gemini',
                        apiKey: apiKey,
                        model: model
                    };

            const startTime = Date.now();
            console.log('🚀 [OPTIONS] About to send chrome.runtime.sendMessage...');

            const response = await new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    console.error('⏰ [OPTIONS] Request timeout after 10s - background not responding');
                    reject(new Error('Request timeout after 10s - background not responding'));
                }, 10000); // 10 second timeout like in test

                console.log('📤 [OPTIONS] Calling chrome.runtime.sendMessage with:', requestData);

                chrome.runtime.sendMessage(requestData, (response) => {
                    console.log('📨 [OPTIONS] chrome.runtime.sendMessage callback fired:', {
                        hasResponse: !!response,
                        responseKeys: response ? Object.keys(response) : null,
                        lastError: chrome.runtime.lastError
                    });
                            clearTimeout(timeoutId);
                            const elapsed = Date.now() - startTime;
                            console.log(`📥 [OPTIONS] ${model} response:`, {
                                response: response,
                                elapsedMs: elapsed,
                                hasLastError: !!chrome.runtime.lastError,
                                lastError: chrome.runtime.lastError?.message
                            });

                            if (chrome.runtime.lastError) {
                                console.error(`❌ [OPTIONS] ${model} Chrome runtime error:`, chrome.runtime.lastError.message);
                                reject(new Error(chrome.runtime.lastError.message));
                            } else {
                                console.log(`✅ [OPTIONS] ${model} response parsed successfully`);
                                resolve(response);
                            }
                        });
                    });

                    if (response && response.success) {
                        workingModels.push(model);
                        console.log(`✅ [OPTIONS] ${model}: SUCCESS`);
                    } else {
                        const errorMsg = response?.error || 'Unknown error';
                        failedModels.push(`${model}: ${errorMsg}`);
                        console.log(`❌ [OPTIONS] ${model}: FAILED - ${errorMsg}`);
                    }

                } catch (error) {
                    failedModels.push(`${model}: ${error.message}`);
                    console.log(`❌ [OPTIONS] ${model}: ERROR - ${error.message}`);
                }

                // Small delay between requests to avoid rate limits (like in test script)
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Report results like in test script
            if (workingModels.length > 0) {
                let message = `✅ Gemini test successful!\n\nWorking models (${workingModels.length}):\n${workingModels.join('\n')}`;

                if (failedModels.length > 0) {
                    message += `\n\n❌ Failed models (${failedModels.length}):\n${failedModels.join('\n')}`;
                }

                this.showAlert(message, 'success');

                // Suggest the best working model (prioritize stable ones)
                const recommendedModel = workingModels.includes('gemini-1.5-flash') ? 'gemini-1.5-flash' :
                                        workingModels.includes('gemini-1.5-flash-8b') ? 'gemini-1.5-flash-8b' :
                                        workingModels[0];

                if (recommendedModel && recommendedModel !== document.getElementById('selectedModel').value) {
                    setTimeout(() => {
                        this.showAlert(`💡 Recommended: Switch to "${recommendedModel}" for best reliability`, 'info');
                    }, 2000);
                }

            } else {
                this.showAlert(`❌ All Gemini models failed:\n${failedModels.join('\n')}`, 'error');
            }

        } catch (error) {
            this.showAlert(`Gemini test setup error: ${error.message}`, 'error');
            console.error('❌ Gemini test setup failed:', error);
        }
    }

    async saveKimiSettings() {
        try {
            const model = document.getElementById('kimiModel').value;
            const settings = {
                kimiApiKey: document.getElementById('kimiApiKey').value.trim(),
                kimiModel: model,
                apiProvider: 'kimi',
                selectedModel: model,
                aiMode: 'custom'
            };
            if (!settings.kimiApiKey) {
                this.showAlert('Please enter Kimi API Key', 'error');
                return;
            }
            await chrome.storage.sync.set(settings);
            if (this._applyAiMode) this._applyAiMode('custom');
            this.updateActiveProviderUI('kimi');
            this.showAlert('Kimi settings saved — Kimi is now your active provider.', 'success');
        } catch (error) {
            this.showAlert('Error saving Kimi settings', 'error');
            console.error('❌ Error saving Kimi settings:', error);
        }
    }

    async testKimi() {
        try {
            const apiKey = document.getElementById('kimiApiKey').value.trim();
            const model = document.getElementById('kimiModel').value;

            if (!apiKey) {
                this.showAlert('Please enter Kimi API Key first', 'error');
                return;
            }

            this.showAlert('Testing Kimi connection...', 'warning');

            const response = await new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => reject(new Error('Request timeout')), 15000);
                chrome.runtime.sendMessage({
                    action: 'testApiKey',
                    provider: 'kimi',
                    apiKey: apiKey,
                    model: model
                }, (response) => {
                    clearTimeout(timeoutId);
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(response);
                    }
                });
            });

            if (response && response.success) {
                this.showAlert('Kimi connection successful!', 'success');
            } else {
                this.showAlert(`Kimi test failed: ${response?.error || 'Unknown error'}`, 'error');
            }
        } catch (error) {
            this.showAlert(`Kimi test error: ${error.message}`, 'error');
            console.error('❌ Kimi test failed:', error);
        }
    }

    async saveNvidiaSettings() {
        try {
            const settings = {
                nvidiaApiKey: document.getElementById('nvidiaApiKey').value.trim(),
                nvidiaModel: document.getElementById('nvidiaModel').value,
                apiProvider: 'nvidia',
                selectedModel: document.getElementById('nvidiaModel').value,
                aiMode: 'custom'
            };

            if (!settings.nvidiaApiKey) {
                this.showAlert('Please enter NVIDIA API Key', 'error');
                return;
            }

            await chrome.storage.sync.set(settings);
            if (this._applyAiMode) this._applyAiMode('custom');
            this.updateActiveProviderUI('nvidia');
            this.showAlert('NVIDIA settings saved — NVIDIA is now your active provider.', 'success');
        } catch (error) {
            this.showAlert('Error saving NVIDIA settings', 'error');
            console.error('❌ Error saving NVIDIA settings:', error);
        }
    }

    async testNvidia() {
        try {
            const apiKey = document.getElementById('nvidiaApiKey').value.trim();
            const model = document.getElementById('nvidiaModel').value;
            
            if (!apiKey) {
                this.showAlert('Please enter NVIDIA API Key first', 'error');
                return;
            }

            this.showAlert('Testing NVIDIA connection...', 'warning');

            const response = await new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => reject(new Error('Request timeout')), 15000);
                chrome.runtime.sendMessage({
                    action: 'testApiKey',
                    provider: 'nvidia',
                    apiKey: apiKey,
                    model: model
                }, (resp) => {
                    clearTimeout(timeoutId);
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(resp);
                    }
                });
            });

            if (response && response.success) {
                this.showAlert('NVIDIA connection successful!', 'success');
            } else {
                this.showAlert(`NVIDIA test failed: ${response?.error || 'Unknown error'}`, 'error');
            }
        } catch (error) {
            this.showAlert(`NVIDIA test error: ${error.message}`, 'error');
        }
    }

    async saveDeepSeekSettings() {
        try {
            const settings = {
                deepseekApiKey: document.getElementById('deepseekApiKey').value.trim(),
                deepseekModel: document.getElementById('deepseekModel').value,
                apiProvider: 'deepseek',                                  // make this the active provider
                selectedModel: document.getElementById('deepseekModel').value,
                aiMode: 'custom'                                          // user has provided own key
            };
            if (!settings.deepseekApiKey) {
                this.showAlert('Please enter DeepSeek API Key', 'error');
                return;
            }
            await chrome.storage.sync.set(settings);
            if (this._applyAiMode) this._applyAiMode('custom');
            this.updateActiveProviderUI('deepseek');
            this.showAlert('DeepSeek settings saved — DeepSeek is now your active provider.', 'success');
        } catch (error) {
            this.showAlert('Error saving DeepSeek settings', 'error');
            console.error('❌ Error saving DeepSeek settings:', error);
        }
    }

    async testDeepSeek() {
        try {
            const apiKey = document.getElementById('deepseekApiKey').value.trim();
            const model = document.getElementById('deepseekModel').value;
            if (!apiKey) {
                this.showAlert('Please enter DeepSeek API Key first', 'error');
                return;
            }
            this.showAlert('Testing DeepSeek connection...', 'warning');
            const response = await new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => reject(new Error('Request timeout')), 15000);
                chrome.runtime.sendMessage({
                    action: 'testApiKey', provider: 'deepseek', apiKey, model
                }, (resp) => {
                    clearTimeout(timeoutId);
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else resolve(resp);
                });
            });
            if (response && response.success) {
                this.showAlert('DeepSeek connection successful!', 'success');
            } else {
                this.showAlert(`DeepSeek test failed: ${response?.error || 'Unknown error'}`, 'error');
            }
        } catch (error) {
            this.showAlert(`DeepSeek test error: ${error.message}`, 'error');
        }
    }

    async saveLocalSettings() {
        try {
            const model = document.getElementById('localModel').value;
            const settings = {
                customEndpoint: document.getElementById('customEndpoint').value.trim(),
                localModel: model,
                apiProvider: 'local',
                selectedModel: model,
                aiMode: 'custom'
            };

            if (!settings.customEndpoint) {
                this.showAlert('Please enter Custom Endpoint', 'error');
                return;
            }

            await chrome.storage.sync.set(settings);
            if (this._applyAiMode) this._applyAiMode('custom');
            this.updateActiveProviderUI('local');
            this.showAlert('Local AI settings saved — Local AI is now your active provider.', 'success');
            console.log('✅ Local AI settings saved');
        } catch (error) {
            this.showAlert('Error saving Local AI settings', 'error');
            console.error('❌ Error saving Local AI settings:', error);
        }
    }

    async testLocal() {
        try {
            const endpoint = document.getElementById('customEndpoint').value.trim();
            const model = document.getElementById('localModel').value;
            
            if (!endpoint) {
                this.showAlert('Please enter Custom Endpoint first', 'error');
                return;
            }

            this.showAlert('Testing Local AI connection...', 'warning');
            
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    action: 'testLocalAI',
                    endpoint: endpoint,
                    model: model
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(response);
                    }
                });
            });

            if (response && response.success) {
                this.showAlert('Local AI connection test successful!', 'success');
            } else {
                this.showAlert(`Local AI test failed: ${response?.error || 'Unknown error'}`, 'error');
            }
        } catch (error) {
            this.showAlert(`Local AI test failed: ${error.message}`, 'error');
            console.error('❌ Local AI test error:', error);
        }
    }

    async saveGroqSettings() {
        try {
            const model = document.getElementById('groqModel').value;
            const settings = {
                groqApiKey: document.getElementById('groqApiKey').value.trim(),
                groqModel: model
            };
            if (!settings.groqApiKey) {
                this.showAlert('Please enter Groq API Key', 'error');
                return;
            }
            await chrome.storage.sync.set(settings);
            this.showAlert('Groq settings saved successfully.', 'success');
            console.log('✅ Groq settings saved');
        } catch (error) {
            this.showAlert('Error saving Groq settings', 'error');
            console.error('❌ Error saving Groq settings:', error);
        }
    }

    async testGroq() {
        try {
            const apiKey = document.getElementById('groqApiKey').value.trim();
            const model = document.getElementById('groqModel').value;

            console.log('⚡ [OPTIONS] Testing Groq:', { model, hasApiKey: !!apiKey, apiKeyLength: apiKey.length });

            if (!apiKey) {
                this.showAlert('Please enter Groq API Key first', 'error');
                return;
            }

            this.showAlert('Testing Groq connection...', 'warning');

            const requestData = {
                action: 'testApiKey',
                provider: 'groq',
                apiKey: apiKey,
                model: model
            };

            const startTime = Date.now();
            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage(requestData, (response) => {
                    resolve(response);
                });
            });

            const elapsed = Date.now() - startTime;
            console.log('📥 [OPTIONS] Groq test response:', response, `(${elapsed}ms)`);

            if (response && response.success) {
                this.showAlert(`⚡ Groq connection successful! (Latency: ${elapsed}ms)`, 'success');
            } else {
                this.showAlert(`Groq connection failed: ${response?.error || 'Unknown error'}`, 'error');
            }
        } catch (error) {
            this.showAlert(`Groq test error: ${error.message}`, 'error');
            console.error('❌ Groq test failed:', error);
        }
    }

    async saveAsrSettings() {
        // Auto-saved on change — the explicit "Save ASR" button was removed
        // because this is now the single place the engine is configured.
        try {
            const engine = document.getElementById('ltAsrEngine').value;
            const settings = {
                ltAsrEngine: engine
            };
            await chrome.storage.sync.set(settings);
            this.showAlert(`ASR engine saved.`, 'success');
            this.syncAsrEngineOptions();
            this.refreshTaskMap();
            console.log('✅ ASR Settings saved:', settings);
        } catch (error) {
            this.showAlert('Error saving ASR Settings', 'error');
            console.error('❌ Error saving ASR Settings:', error);
        }
    }

    /**
     * Show only the picked engine's settings, and say plainly whether the key
     * that engine needs is actually present. The engine dropdown and the key
     * that makes it work now live on different tabs, so this line is what stops
     * "I picked OpenAI Whisper" from silently meaning "captions will not start".
     */
    async syncAsrEngineOptions() {
        const engineEl = document.getElementById('ltAsrEngine');
        if (!engineEl) return;
        const engine = engineEl.value || 'groq';

        const blocks = {
            groq: 'asrOptionsGroq',
            whisper: 'asrOptionsWhisper',
            webSpeech: 'asrOptionsWebSpeech'
        };
        Object.entries(blocks).forEach(([name, id]) => {
            const el = document.getElementById(id);
            if (el) el.style.display = (name === engine) ? 'block' : 'none';
        });

        // Read the live input first so the state updates as the user types in
        // the vault, and only fall back to what is actually stored.
        const stored = await chrome.storage.sync.get(['groqApiKey', 'openaiApiKey']);
        const keyValue = (inputId, storedValue) => {
            const input = document.getElementById(inputId);
            const raw = input ? input.value : storedValue;
            return (raw || storedValue || '').trim();
        };

        const paint = (smallId, hasKey, providerName) => {
            const el = document.getElementById(smallId);
            if (!el) return;
            el.textContent = hasKey
                ? `${providerName} key found — captions are ready to start.`
                : `No ${providerName} key saved. Add it under API Keys, or switch to Web Speech API (free).`;
            el.style.color = hasKey ? 'var(--text-dim)' : 'var(--warning)';
        };

        paint('asrGroqKeyState', !!keyValue('groqApiKey', stored.groqApiKey), 'Groq');
        paint('asrOpenaiKeyState', !!keyValue('openaiApiKey', stored.openaiApiKey), 'OpenAI');
    }

    /**
     * Same contract as syncAsrEngineOptions, for the Video TLDR section: show
     * only the picked provider's model box, and state plainly whether the key
     * that provider needs actually exists — the key lives on another tab.
     */
    async syncTldrOptions() {
        const providerEl = document.getElementById('tldrProvider');
        if (!providerEl) return;
        const provider = providerEl.value === 'openai' ? 'openai' : 'groq';

        const groqBlock = document.getElementById('tldrOptionsGroq');
        const openaiBlock = document.getElementById('tldrOptionsOpenai');
        if (groqBlock) groqBlock.style.display = provider === 'groq' ? 'block' : 'none';
        if (openaiBlock) openaiBlock.style.display = provider === 'openai' ? 'block' : 'none';

        const stored = await chrome.storage.sync.get(['groqApiKey', 'openaiApiKey']);
        const keyValue = (inputId, storedValue) => {
            const input = document.getElementById(inputId);
            const raw = input ? input.value : storedValue;
            return (raw || storedValue || '').trim();
        };

        const paint = (smallId, hasKey, providerName) => {
            const el = document.getElementById(smallId);
            if (!el) return;
            el.textContent = hasKey
                ? `${providerName} key found — TLDR is ready to use.`
                : `No ${providerName} key saved. Add it under API Keys, or switch the TLDR provider.`;
            el.style.color = hasKey ? 'var(--text-dim)' : 'var(--warning)';
        };

        paint('tldrGroqKeyState', !!keyValue('groqApiKey', stored.groqApiKey), 'Groq');
        paint('tldrOpenaiKeyState', !!keyValue('openaiApiKey', stored.openaiApiKey), 'OpenAI');
    }

    /**
     * The audit panel on the API Keys tab. It reports the resolved choice — the
     * provider a job will really call and whether its key exists — rather than
     * the setting the user last touched.
     */
    async renderKeyAudit() {
        const list = document.getElementById('keyAuditList');
        if (!list) return;

        const PROVIDER_LABEL = {
            openai: 'OpenAI', claude: 'Claude', gemini: 'Gemini', kimi: 'Kimi',
            deepseek: 'DeepSeek', nvidia: 'NVIDIA NIM', local: 'Local AI Server'
        };
        const KEY_FOR = {
            openai: 'openaiApiKey', claude: 'claudeApiKey', gemini: 'geminiApiKey',
            kimi: 'kimiApiKey', deepseek: 'deepseekApiKey', nvidia: 'nvidiaApiKey',
            local: 'customEndpoint'
        };

        try {
            const s = await chrome.storage.sync.get([
                'aiMode', 'apiProvider', 'ltAsrEngine', 'writeProvider', 'translateProvider',
                'tldrProvider', 'openaiApiKey', 'claudeApiKey', 'geminiApiKey', 'kimiApiKey',
                'deepseekApiKey', 'nvidiaApiKey', 'groqApiKey', 'customEndpoint'
            ]);
            const local = await chrome.storage.local.get(['ltEngine']);

            const has = (storageKey) => {
                const input = document.getElementById(storageKey);
                const raw = input && input.value ? input.value : s[storageKey];
                return !!(raw || '').trim();
            };

            const isFree = (s.aiMode || 'system') !== 'custom';
            const mainProvider = s.apiProvider || 'openai';

            const rows = [];
            const providerRow = (job, routed) => {
                if (isFree) {
                    return { job, detail: 'AutoMind free tier · key included · 50 uses per day', state: 'free', label: 'free' };
                }
                const p = routed || mainProvider;
                const keyId = KEY_FOR[p];
                const ok = has(keyId);
                const what = p === 'local' ? 'endpoint' : 'key';
                return {
                    job,
                    detail: `${PROVIDER_LABEL[p] || p} · reads ${keyId}`,
                    state: ok ? 'ok' : 'warn',
                    label: ok ? `${what} saved` : `${what} missing`
                };
            };

            rows.push(providerRow('Reply writing', s.writeProvider));

            const ltEngine = local.ltEngine || 'google';
            if (ltEngine === 'google') {
                rows.push({ job: 'Subtitle translation', detail: 'Google Translate · no key, no quota', state: 'free', label: 'free' });
            } else {
                rows.push(providerRow('Subtitle translation', s.translateProvider));
            }

            const asr = s.ltAsrEngine || 'groq';
            if (asr === 'webSpeech') {
                rows.push({ job: 'Live captions (ASR)', detail: 'Chrome Web Speech · microphone, no key', state: 'free', label: 'free' });
            } else if (asr === 'groq') {
                const ok = has('groqApiKey');
                rows.push({ job: 'Live captions (ASR)', detail: 'Groq Whisper · reads groqApiKey', state: ok ? 'ok' : 'warn', label: ok ? 'key saved' : 'key missing' });
            } else {
                const ok = has('openaiApiKey');
                rows.push({ job: 'Live captions (ASR)', detail: 'OpenAI Whisper · reads openaiApiKey', state: ok ? 'ok' : 'warn', label: ok ? 'key saved' : 'key missing' });
            }

            // Video TLDR always runs on the user's own key, even on the free tier.
            if ((s.tldrProvider || 'groq') === 'groq') {
                const ok = has('groqApiKey');
                rows.push({ job: 'Video TLDR → post', detail: 'Groq · reads groqApiKey', state: ok ? 'ok' : 'warn', label: ok ? 'key saved' : 'key missing' });
            } else {
                const ok = has('openaiApiKey');
                rows.push({ job: 'Video TLDR → post', detail: 'OpenAI · reads openaiApiKey', state: ok ? 'ok' : 'warn', label: ok ? 'key saved' : 'key missing' });
            }

            list.innerHTML = rows.map(r => `
                <div class="audit-row">
                  <span class="audit-job">${r.job}</span>
                  <span class="audit-detail">${r.detail}</span>
                  <span class="audit-state ${r.state}">${r.label}</span>
                </div>
            `).join('');
        } catch (e) {
            console.warn('⚠️ Could not render key audit:', e);
            list.innerHTML = '<div class="audit-row"><span class="audit-detail">Could not read settings.</span></div>';
        }
    }

    async saveAllApiKeys() {
        try {
            const allSettings = {
                openaiApiKey: document.getElementById('openaiApiKey').value.trim(),
                claudeApiKey: document.getElementById('claudeApiKey').value.trim(),
                geminiApiKey: document.getElementById('geminiApiKey').value.trim(),
                kimiApiKey: document.getElementById('kimiApiKey').value.trim(),
                deepseekApiKey: document.getElementById('deepseekApiKey').value.trim(),
                nvidiaApiKey: document.getElementById('nvidiaApiKey').value.trim(),
                groqApiKey: document.getElementById('groqApiKey').value.trim(),
                customEndpoint: document.getElementById('customEndpoint').value.trim(),
                openaiModel: document.getElementById('openaiModel').value,
                claudeModel: document.getElementById('claudeModel').value,
                kimiModel: document.getElementById('kimiModel').value,
                deepseekModel: document.getElementById('deepseekModel').value,
                nvidiaModel: document.getElementById('nvidiaModel').value,
                geminiModel: document.getElementById('geminiModel').value,
                groqModel: document.getElementById('groqModel').value,
                openaiWhisperModel: document.getElementById('openaiWhisperModel').value,
                localModel: document.getElementById('localModel').value
            };

            // Only save non-empty keys
            const settingsToSave = {};
            Object.entries(allSettings).forEach(([key, value]) => {
                if (value) settingsToSave[key] = value;
            });

            await chrome.storage.sync.set(settingsToSave);
            this.showAlert('All API settings saved successfully', 'success');
            console.log('✅ All API settings saved');
        } catch (error) {
            this.showAlert('Error saving all API settings', 'error');
            console.error('❌ Error saving all API settings:', error);
        }
    }

    async testAllApiKeys() {
        try {
            this.showAlert('Testing all connections...', 'warning');
            
            const results = [];
            const providers = [
                { name: 'OpenAI', key: 'openaiApiKey', model: 'openaiModel', testFunc: 'testOpenAI' },
                { name: 'Claude', key: 'claudeApiKey', model: 'claudeModel', testFunc: 'testClaude' },
                { name: 'Gemini', key: 'geminiApiKey', model: 'selectedModel', testFunc: 'testGemini' },
                { name: 'Kimi', key: 'kimiApiKey', model: 'kimiModel', testFunc: 'testKimi' },
                { name: 'DeepSeek', key: 'deepseekApiKey', model: 'deepseekModel', testFunc: 'testDeepSeek' },
                { name: 'NVIDIA', key: 'nvidiaApiKey', model: 'nvidiaModel', testFunc: 'testNvidia' },
                { name: 'Local AI', key: 'customEndpoint', model: 'localModel', testFunc: 'testLocal' }
            ];

            for (const provider of providers) {
                const key = document.getElementById(provider.key).value.trim();
                if (key) {
                    try {
                        await this[provider.testFunc]();
                        results.push(`✅ ${provider.name}: Working`);
                    } catch (error) {
                        results.push(`❌ ${provider.name}: Failed`);
                    }
                }
            }

            const message = results.length > 0 ? results.join('\n') : 'No API keys configured';
            this.showAlert(message, results.every(r => r.includes('✅')) ? 'success' : 'warning');
        } catch (error) {
            this.showAlert(`Test all failed: ${error.message}`, 'error');
            console.error('❌ Test all error:', error);
        }
    }

    // Reset to Defaults
    async resetToDefaults() {
        if (!confirm('Reset tones, reply length and language to defaults?\n\nYour API keys will NOT be touched.')) return;
        try {
            const DEFAULT_TONES = ['professional', 'casual', 'witty', 'analytical', 'contrarian'];

            await chrome.storage.sync.set({
                userSettings: {
                    defaultTone: 'professional',
                    selectedTones: DEFAULT_TONES,
                    preferredLanguage: 'auto'
                },
                userLanguageSettings: { preferredLanguage: 'auto' },
                commentLength: 'medium',
                language: 'auto',
                dailyQuota: 50,
                lastUpdated: new Date().toISOString()
            });

            // Re-tick the grid immediately rather than waiting on a reload
            document.querySelectorAll('.tone-checkbox input[type="checkbox"]').forEach(cb => {
                cb.disabled = false;
                cb.checked = DEFAULT_TONES.includes(cb.value);
            });
            this.updateToneSelection();

            await this.loadSettings();
            this.showAlert('Reply settings reset to defaults. API keys kept.', 'success');
            console.log('✅ Settings reset to defaults');
        } catch (error) {
            this.showAlert('Error resetting settings', 'error');
            console.error('❌ Error resetting settings:', error);
        }
    }

    // Load Settings
    async loadSettings() {
        try {
            // Small delay to ensure DOM is fully ready
            await new Promise(resolve => setTimeout(resolve, 100));
            
            console.log('🔄 Starting to load settings...');
            
            // Load user settings
            const userSettings = await this.getUserSettings();
            console.log('📦 User settings loaded:', userSettings);
            
            if (userSettings && userSettings.defaultTone) {
                const defaultToneElement = document.getElementById('defaultTone');
                if (defaultToneElement) {
                    defaultToneElement.value = userSettings.defaultTone;
                    console.log('✅ Default tone dropdown set to:', userSettings.defaultTone);
                }
            } else {
                // Set default if no saved settings
                const defaultTone = 'professional';
                const defaultToneElement = document.getElementById('defaultTone');
                if (defaultToneElement) {
                    defaultToneElement.value = defaultTone;
                }
                console.log('✅ Set default tone to:', defaultTone);
            }

            // Load selected tones from checkboxes — enforce 8 tone cap on legacy data
            if (userSettings && userSettings.selectedTones && userSettings.selectedTones.length > 0) {
                let stored = userSettings.selectedTones;

                // Migrate legacy storage that had >8 tones (truncate + persist)
                if (stored.length > 8) {
                    console.warn(`⚠️ Legacy storage has ${stored.length} tones, capping at 8`);
                    stored = stored.slice(0, 8);
                    const merged = { ...userSettings, selectedTones: stored };
                    await chrome.storage.sync.set({ userSettings: merged });
                }

                console.log('📦 Loading selected tones:', stored);

                // Clear all checkboxes first
                document.querySelectorAll('.tone-checkbox input[type="checkbox"]').forEach(cb => { cb.checked = false; });

                stored.forEach(tone => {
                    const checkbox = document.getElementById(`tone-${tone}`);
                    if (checkbox) checkbox.checked = true;
                });

                this.updateToneSelection();
                console.log('✅ Visual tone selection updated');
            } else {
                // Default: 5 tones (covers professional/casual/witty/data/contrarian)
                const defaultTones = ['professional', 'casual', 'witty', 'analytical', 'contrarian'];
                defaultTones.forEach(tone => {
                    const checkbox = document.getElementById(`tone-${tone}`);
                    if (checkbox) checkbox.checked = true;
                });
                this.updateToneSelection();
                console.log('✅ Set default selected tones:', defaultTones);
            }

            // Load language settings
            const languageSettings = await this.getLanguageSettings();
            console.log('📦 Language settings loaded:', languageSettings);
            
            if (languageSettings && languageSettings.preferredLanguage) {
                const languageElement = document.getElementById('preferredLanguage');
                if (languageElement) {
                    languageElement.value = languageSettings.preferredLanguage;
                    console.log('✅ Language preference set to:', languageSettings.preferredLanguage);
                }
            }

            // Load model settings
            const result = await chrome.storage.sync.get(['apiProvider', 'selectedModel']);
            console.log('📦 Model settings loaded:', result);
            
            if (result.apiProvider) {
                const providerElement = document.getElementById('apiProvider');
                if (providerElement) {
                    providerElement.value = result.apiProvider;
                    this.updateModelOptions(result.apiProvider);
                    console.log('✅ API provider set to:', result.apiProvider);
                }
                
                if (result.selectedModel) {
                    const modelElement = document.getElementById('selectedModel');
                    if (modelElement) {
                        modelElement.value = result.selectedModel;
                        console.log('✅ Selected model set to:', result.selectedModel);
                    }
                }

                // Sync active provider state to our new unified list layout
                this.updateActiveProviderUI(result.apiProvider);
            }

            // Load character settings
            await this.loadCharacterSettings();

            // Load API keys
            const apiKeys = await chrome.storage.sync.get(['openaiApiKey', 'claudeApiKey', 'geminiApiKey', 'kimiApiKey', 'deepseekApiKey', 'nvidiaApiKey', 'groqApiKey', 'customEndpoint']);
            console.log('📦 API keys loaded (lengths):', {
                openai:   apiKeys.openaiApiKey   ? apiKeys.openaiApiKey.length   : 0,
                claude:   apiKeys.claudeApiKey   ? apiKeys.claudeApiKey.length   : 0,
                gemini:   apiKeys.geminiApiKey   ? apiKeys.geminiApiKey.length   : 0,
                kimi:     apiKeys.kimiApiKey     ? apiKeys.kimiApiKey.length     : 0,
                deepseek: apiKeys.deepseekApiKey ? apiKeys.deepseekApiKey.length : 0,
                nvidia:   apiKeys.nvidiaApiKey   ? apiKeys.nvidiaApiKey.length   : 0,
                groq:     apiKeys.groqApiKey     ? apiKeys.groqApiKey.length     : 0,
                local:    apiKeys.customEndpoint ? apiKeys.customEndpoint.length : 0
            });

            if (apiKeys.openaiApiKey) {
                const element = document.getElementById('openaiApiKey');
                if (element) element.value = apiKeys.openaiApiKey;
            }
            if (apiKeys.claudeApiKey) {
                const element = document.getElementById('claudeApiKey');
                if (element) element.value = apiKeys.claudeApiKey;
            }
            if (apiKeys.geminiApiKey) {
                const element = document.getElementById('geminiApiKey');
                if (element) element.value = apiKeys.geminiApiKey;
            }
            if (apiKeys.kimiApiKey) {
                const element = document.getElementById('kimiApiKey');
                if (element) element.value = apiKeys.kimiApiKey;
            }
            if (apiKeys.deepseekApiKey) {
                const element = document.getElementById('deepseekApiKey');
                if (element) element.value = apiKeys.deepseekApiKey;
            }
            if (apiKeys.nvidiaApiKey) {
                const element = document.getElementById('nvidiaApiKey');
                if (element) element.value = apiKeys.nvidiaApiKey;
            }
            if (apiKeys.groqApiKey) {
                const element = document.getElementById('groqApiKey');
                if (element) element.value = apiKeys.groqApiKey;
            }
            if (apiKeys.customEndpoint) {
                const element = document.getElementById('customEndpoint');
                if (element) element.value = apiKeys.customEndpoint;
            }

            // Load individual model selections
            const modelSettings = await chrome.storage.sync.get(['openaiModel', 'claudeModel', 'geminiModel', 'kimiModel', 'deepseekModel', 'nvidiaModel', 'groqModel', 'localModel']);
            console.log('📦 Individual model settings loaded:', modelSettings);

            if (modelSettings.openaiModel) {
                const element = document.getElementById('openaiModel');
                if (element) element.value = modelSettings.openaiModel;
            }
            if (modelSettings.claudeModel) {
                const element = document.getElementById('claudeModel');
                if (element) element.value = modelSettings.claudeModel;
            }
            if (modelSettings.geminiModel) {
                const element = document.getElementById('geminiModel');
                if (element) element.value = modelSettings.geminiModel;
            }
            if (modelSettings.kimiModel) {
                const element = document.getElementById('kimiModel');
                if (element) element.value = modelSettings.kimiModel;
            }
            if (modelSettings.deepseekModel) {
                const element = document.getElementById('deepseekModel');
                if (element) element.value = modelSettings.deepseekModel;
            }
            if (modelSettings.nvidiaModel) {
                const element = document.getElementById('nvidiaModel');
                if (element) element.value = modelSettings.nvidiaModel;
            }
            if (modelSettings.groqModel) {
                const element = document.getElementById('groqModel');
                if (element) element.value = modelSettings.groqModel;
            }
            if (modelSettings.localModel) {
                const element = document.getElementById('localModel');
                if (element) element.value = modelSettings.localModel;
            }

            // Load system settings
            const systemSettings = await chrome.storage.sync.get(['dailyQuota', 'maxTokens', 'temperature', 'promptType', 'commentLength', 'language']);
            console.log('📦 System settings loaded:', systemSettings);

            if (systemSettings.dailyQuota !== undefined) {
                const element = document.getElementById('dailyQuota');
                if (element) element.value = systemSettings.dailyQuota;
            }
            if (systemSettings.maxTokens !== undefined) {
                const element = document.getElementById('maxTokens');
                if (element) element.value = systemSettings.maxTokens;
            }
            if (systemSettings.temperature !== undefined) {
                const tempElement = document.getElementById('temperature');
                const tempValueElement = document.getElementById('temperatureValue');
                if (tempElement) {
                    tempElement.value = systemSettings.temperature;
                    if (tempValueElement) {
                        tempValueElement.textContent = systemSettings.temperature;
                    }
                }
            }
            if (systemSettings.promptType) {
                const element = document.getElementById('promptType');
                if (element) element.value = systemSettings.promptType;
            }
            if (systemSettings.commentLength) {
                const element = document.getElementById('commentLength');
                if (element) element.value = systemSettings.commentLength;
            }
            if (systemSettings.language) {
                const element = document.getElementById('replyLanguage');
                if (element) element.value = systemSettings.language;
            }

            // Load ASR Engine settings
            const asrSettings = await chrome.storage.sync.get(['ltAsrEngine', 'openaiWhisperModel']);
            const element = document.getElementById('ltAsrEngine');
            if (element) {
                element.value = asrSettings.ltAsrEngine || 'groq';
                // Auto-save on change — this is the single place the engine is configured
                if (!element._autoSaveBound) {
                    element._autoSaveBound = true;
                    element.addEventListener('change', () => this.saveAsrSettings());
                }
            }

            // OpenAI's transcription model is its own setting: whisper-1 is the
            // cheap default, the gpt-4o-*-transcribe models cost more per minute.
            const whisperModelEl = document.getElementById('openaiWhisperModel');
            if (whisperModelEl) {
                whisperModelEl.value = asrSettings.openaiWhisperModel || 'whisper-1';
                if (!whisperModelEl._autoSaveBound) {
                    whisperModelEl._autoSaveBound = true;
                    whisperModelEl.addEventListener('change', async () => {
                        await chrome.storage.sync.set({ openaiWhisperModel: whisperModelEl.value });
                        this.showAlert('OpenAI transcription model saved.', 'success');
                    });
                }
            }

            // The Groq model sits next to the engine picker but is saved by the
            // Groq save action, so keep it auto-saving on its own too.
            const groqModelEl = document.getElementById('groqModel');
            if (groqModelEl && !groqModelEl._autoSaveBound) {
                groqModelEl._autoSaveBound = true;
                groqModelEl.addEventListener('change', async () => {
                    await chrome.storage.sync.set({ groqModel: groqModelEl.value });
                    this.showAlert('Groq Whisper model saved.', 'success');
                });
            }

            // Load subtitle translation engine (shared with the side panel via storage.local)
            const ltLocal = await chrome.storage.local.get(['ltEngine']);
            const ltEngineEl = document.getElementById('ltEngine');
            if (ltEngineEl) ltEngineEl.value = ltLocal.ltEngine || 'google';

            // Load Task Routing settings (per-task provider/model overrides)
            const routing = await chrome.storage.sync.get(['writeProvider', 'writeModel', 'translateProvider', 'translateModel']);
            ['writeProvider', 'writeModel', 'translateProvider', 'translateModel'].forEach(key => {
                const el = document.getElementById(key);
                if (!el) return;
                el.value = routing[key] || '';
                if (!el._autoSaveBound) {
                    el._autoSaveBound = true;
                    el.addEventListener('change', async () => {
                        await chrome.storage.sync.set({ [key]: el.value.trim() });
                        this.showAlert('Task routing saved.', 'success');
                        this.refreshTaskMap();
                    });
                }
            });

            // Load Video TLDR settings — everything auto-saves on change, like
            // task routing above.
            const tldr = await chrome.storage.sync.get(['tldrProvider', 'tldrGroqModel', 'tldrOpenaiModel', 'tldrLanguage']);
            const TLDR_DEFAULTS = {
                tldrProvider: 'groq',
                tldrGroqModel: 'llama-3.3-70b-versatile',
                tldrOpenaiModel: 'gpt-4o-mini',
                tldrLanguage: 'auto'
            };
            Object.entries(TLDR_DEFAULTS).forEach(([key, fallback]) => {
                const el = document.getElementById(key);
                if (!el) return;
                el.value = tldr[key] || fallback;
                if (!el._autoSaveBound) {
                    el._autoSaveBound = true;
                    el.addEventListener('change', async () => {
                        await chrome.storage.sync.set({ [key]: el.value });
                        this.showAlert('Video TLDR settings saved.', 'success');
                        this.syncTldrOptions();
                        this.refreshTaskMap();
                    });
                }
            });

            // Reflect which providers have a stored key, and keep the dots live
            // as the user types so the row header confirms input immediately.
            this.refreshKeyDots();
            document.querySelectorAll('.key-dot[data-key-for]').forEach(dot => {
                const input = document.getElementById(dot.getAttribute('data-key-for'));
                if (input && !input._dotBound) {
                    input._dotBound = true;
                    input.addEventListener('input', () => {
                        this.refreshKeyDots();
                        this.syncAsrEngineOptions();
                        this.syncTldrOptions();
                        this.renderKeyAudit();
                    });
                }
            });

            await this.refreshTaskMap();
            await this.syncAsrEngineOptions();
            await this.syncTldrOptions();
            await this.renderKeyAudit();

            console.log('✅ All settings loaded successfully');
        } catch (error) {
            console.error('❌ Error loading settings:', error);
            this.showAlert('Error loading settings: ' + error.message, 'error');
        }
    }

    // Helper methods to get settings
    async getUserSettings() {
        const result = await chrome.storage.sync.get('userSettings');
        return result.userSettings || { 
            defaultTone: 'professional', 
            selectedTones: ['professional', 'casual', 'sarcastic', 'witty', 'concise', 'analytical', 'empathetic', 'humorous', 'brief', 'direct', 'punchy', 'snappy', 'crisp', 'sharp', 'contrarian', 'thao_mai'] 
        };
    }

    async getLanguageSettings() {
        const result = await chrome.storage.sync.get('userLanguageSettings');
        return result.userLanguageSettings;
    }

    // Personal Character Configuration — feature removed, no-op stubs kept for compat
    toggleCustomPersona() { /* removed */ }
    updateInterestSelection() { return []; }
    async saveCharacterSettings() { /* removed — UI section deleted */ }

    async loadCharacterSettings() {
        try {
            // No-op: Personal Character Configuration UI was removed.
            // Kept to avoid breaking callers; storage data (if any) is left untouched.
            return;
        } catch (error) {
            console.error('❌ Error loading character settings:', error);
        }
    }

    // Validate settings
    async validateSettings() {
        return true; // Always allow settings changes
    }
}

// Initialize user settings when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.userSettings = new UserSettings();
});

// Global functions for HTML onclick handlers
window.saveUserSettings = async () => {
    const isValid = await window.userSettings.validateSettings();
    if (isValid) {
        await window.userSettings.saveUserSettings();
    }
};

window.saveLanguageSettings = async () => {
    await window.userSettings.saveLanguageSettings();
};

window.saveCharacterSettings = async () => {
    console.log('🌍 Global saveCharacterSettings called');
    await window.userSettings.saveCharacterSettings();
};

// Debug function to test all saves
window.testAllSaves = () => {
    console.log('🧪 Testing all save functions...');
    if (window.userSettings) {
        window.userSettings.showAlert('All save functions are working!', 'success');
        console.log('✅ UserSettings instance found');
        console.log('✅ ShowAlert function working');
        
        // Test all save functions
        const saveFunctions = [
            'saveUserSettings', 'saveLanguageSettings', 'saveCharacterSettings',
            'saveModelSettings', 'saveSystemSettings', 'saveOpenAISettings',
            'saveClaudeSettings', 'saveGeminiSettings', 'saveKimiSettings', 
            'saveGroqSettings', 'saveAsrSettings', 'saveLocalSettings', 'saveAllApiKeys'
        ];
        
        saveFunctions.forEach(funcName => {
            if (typeof window.userSettings[funcName] === 'function') {
                console.log(`✅ ${funcName} function exists`);
            } else {
                console.error(`❌ ${funcName} function missing`);
            }
        });
    } else {
        console.error('❌ UserSettings instance not found');
    }
};

window.saveModelSettings = async () => {
    await window.userSettings.saveModelSettings();
};

window.testModelConnection = async () => {
    await window.userSettings.testModelConnection();
};

window.saveSystemSettings = async () => {
    await window.userSettings.saveSystemSettings();
};

// New functions for tabbed interface
window.saveOpenAISettings = async () => {
    await window.userSettings.saveOpenAISettings();
};

window.testOpenAI = async () => {
    await window.userSettings.testOpenAI();
};

window.saveClaudeSettings = async () => {
    await window.userSettings.saveClaudeSettings();
};

window.testClaude = async () => {
    await window.userSettings.testClaude();
};

window.saveGeminiSettings = async () => {
    await window.userSettings.saveGeminiSettings();
};

window.testGemini = async () => {
    await window.userSettings.testGemini();
};

window.saveKimiSettings = async () => {
    await window.userSettings.saveKimiSettings();
};

window.testKimi = async () => {
    await window.userSettings.testKimi();
};

window.saveLocalSettings = async () => {
    await window.userSettings.saveLocalSettings();
};

window.testLocal = async () => {
    await window.userSettings.testLocal();
};

window.saveGroqSettings = async () => {
    await window.userSettings.saveGroqSettings();
};

window.testGroq = async () => {
    await window.userSettings.testGroq();
};

window.saveAsrSettings = async () => {
    await window.userSettings.saveAsrSettings();
};

window.saveAllApiKeys = async () => {
    await window.userSettings.saveAllApiKeys();
};

window.testAllApiKeys = async () => {
    await window.userSettings.testAllApiKeys();
};

window.resetToDefaults = async () => {
    await window.userSettings.resetToDefaults();
};


// Test alert function for debugging
window.testAlert = () => {
    console.log('🧪 Testing alert system...');
    if (window.userSettings) {
        window.userSettings.showAlert('Test alert working!', 'success');
    } else {
        console.error('❌ UserSettings not initialized!');
        alert('UserSettings not initialized!');
    }
};

// Test all save buttons function
window.testAllSaveButtons = () => {
    console.log('🧪 Testing all save buttons...');
    if (window.userSettings) {
        const allBtns = document.querySelectorAll('.btn');
        const saveButtons = [];
        
        allBtns.forEach(btn => {
            const text = btn.textContent.toLowerCase().trim();
            if (text.includes('save')) {
                saveButtons.push({
                    element: btn,
                    text: text,
                    hasListener: btn.onclick !== null || btn.getAttribute('onclick') !== null
                });
            }
        });
        
        console.log('📋 Found save buttons:', saveButtons);
        
        saveButtons.forEach(btn => {
            if (btn.hasListener) {
                console.log(`✅ ${btn.text} - has listener`);
            } else {
                console.log(`❌ ${btn.text} - missing listener`);
            }
        });
        
        window.userSettings.showAlert(`Found ${saveButtons.length} save buttons`, 'info');
    } else {
        console.error('❌ UserSettings not initialized!');
    }
};

// Test all functions
window.testAllFunctions = () => {
    console.log('🧪 Testing all functions...');
    
    if (window.userSettings) {
        // Test alert system
        window.userSettings.showAlert('Testing all functions...', 'info');
        
        // Test save functions
        const saveFunctions = [
            'saveUserSettings', 'saveLanguageSettings', 'saveCharacterSettings',
            'saveModelSettings', 'saveSystemSettings', 'saveOpenAISettings',
            'saveClaudeSettings', 'saveGeminiSettings', 'saveKimiSettings', 'saveLocalSettings', 'saveAllApiKeys'
        ];
        
        let workingFunctions = 0;
        saveFunctions.forEach(funcName => {
            if (typeof window.userSettings[funcName] === 'function') {
                console.log(`✅ ${funcName} function exists`);
                workingFunctions++;
            } else {
                console.error(`❌ ${funcName} function missing`);
            }
        });
        
        // Test buttons
        const allBtns = document.querySelectorAll('.btn');
        const saveButtons = [];
        allBtns.forEach(btn => {
            const text = btn.textContent.toLowerCase().trim();
            if (text.includes('save')) {
                saveButtons.push(text);
            }
        });
        
        console.log(`📊 Results: ${workingFunctions}/${saveFunctions.length} save functions working, ${saveButtons.length} save buttons found`);
        
        window.userSettings.showAlert(`✅ ${workingFunctions}/${saveFunctions.length} functions working, ${saveButtons.length} save buttons found`, 'success');
        
    } else {
        console.error('❌ UserSettings not initialized!');
    }
};

// Reset daily quota function
window.resetDailyQuota = async () => {
    console.log('🔄 Resetting daily quota...');
    try {
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                action: 'resetDailyQuota'
            }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });

        if (response && response.success) {
            window.userSettings.showAlert('Daily quota reset successfully!', 'success');
            console.log('✅ Daily quota reset successfully');
        } else {
            window.userSettings.showAlert(`Failed to reset daily quota: ${response?.error || 'Unknown error'}`, 'error');
            console.error('❌ Failed to reset daily quota:', response?.error);
        }
    } catch (error) {
        window.userSettings.showAlert(`Error resetting daily quota: ${error.message}`, 'error');
        console.error('❌ Error resetting daily quota:', error);
    }
};

// Test settings synchronization function
window.testSettingsSync = async () => {
    console.log('🧪 Testing settings synchronization...');
    try {
        // Get current settings from options
        const selectedTones = [];
        const toneCheckboxes = document.querySelectorAll('.tone-checkbox input[type="checkbox"]:checked');
        toneCheckboxes.forEach(checkbox => {
            selectedTones.push(checkbox.value);
        });

        console.log('📝 Options selectedTones:', selectedTones);
        console.log('📝 Options selectedTones count:', selectedTones.length);

        // Get settings from background script
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                action: 'getSettings'
            }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });

        if (response && response.success) {
            const backgroundSettings = response.data;
            console.log('📝 Background selectedTones:', backgroundSettings.selectedTones);
            console.log('📝 Background selectedTones count:', backgroundSettings.selectedTones?.length);

            // Compare settings
            const optionsCount = selectedTones.length;
            const backgroundCount = backgroundSettings.selectedTones?.length || 0;
            const isSync = optionsCount === backgroundCount;

            if (isSync) {
                window.userSettings.showAlert(`Settings synchronized! Both have ${optionsCount} tones selected.`, 'success');
                console.log('✅ Settings are synchronized');
            } else {
                window.userSettings.showAlert(`Settings mismatch! Options: ${optionsCount} tones, Background: ${backgroundCount} tones`, 'warning');
                console.warn('⚠️ Settings are not synchronized');
            }
        } else {
            window.userSettings.showAlert(`Failed to get background settings: ${response?.error || 'Unknown error'}`, 'error');
            console.error('❌ Failed to get background settings:', response?.error);
        }
    } catch (error) {
        window.userSettings.showAlert(`Error testing settings sync: ${error.message}`, 'error');
        console.error('❌ Error testing settings sync:', error);
    }
};

// Test quota functionality
window.testQuota = async () => {
    console.log('🧪 Testing quota functionality...');
    try {
        // Get current quota settings
        const dailyQuota = document.getElementById('dailyQuota').value;
        console.log('📝 Daily quota setting:', dailyQuota);

        // Get current usage from background script
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                action: 'getSettings'
            }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });

        if (response && response.success) {
            const settings = response.data;
            console.log('📝 Background settings:', settings);

            // Test quota check
            const quotaResponse = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    action: 'checkDailyQuota'
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(response);
                    }
                });
            });

            if (quotaResponse && quotaResponse.success) {
                window.userSettings.showAlert(`Quota test successful! Daily limit: ${dailyQuota}, Can generate: ${quotaResponse.canGenerate}`, 'success');
                console.log('✅ Quota test successful');
            } else {
                window.userSettings.showAlert(`Quota test failed: ${quotaResponse?.error || 'Unknown error'}`, 'error');
                console.error('❌ Quota test failed:', quotaResponse?.error);
            }
        } else {
            window.userSettings.showAlert(`Failed to get settings: ${response?.error || 'Unknown error'}`, 'error');
            console.error('❌ Failed to get settings:', response?.error);
        }
    } catch (error) {
        window.userSettings.showAlert(`Error testing quota: ${error.message}`, 'error');
        console.error('❌ Error testing quota:', error);
    }
};

// Test Ping Background Script
async function testPing() {
    try {
        console.log('🏓 [OPTIONS] Testing ping to background script...');
        window.userSettings.showAlert('Testing ping to background...', 'warning');

        const startTime = Date.now();
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                action: 'ping'
            }, (response) => {
                const elapsed = Date.now() - startTime;
                console.log('🏓 [OPTIONS] Ping response received:', {
                    response: response,
                    elapsedMs: elapsed,
                    hasLastError: !!chrome.runtime.lastError,
                    lastError: chrome.runtime.lastError?.message
                });

                if (chrome.runtime.lastError) {
                    console.error('❌ [OPTIONS] Ping Chrome runtime error:', chrome.runtime.lastError.message);
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    console.log('✅ [OPTIONS] Ping response parsed successfully');
                    resolve(response);
                }
            });
        });

        if (response && response.pong) {
            window.userSettings.showAlert(`Background ping successful! (${Date.now() - startTime}ms)`, 'success');
        } else {
            window.userSettings.showAlert('Background ping failed - no response', 'error');
        }
    } catch (error) {
        window.userSettings.showAlert(`Background ping error: ${error.message}`, 'error');
        console.error('❌ Background ping failed:', error);
    }
}

// Test API Connection Function
async function testAPIConnection() {
    console.log('🔗 Testing API connection...');
    window.userSettings.showAlert('Testing API connection...', 'warning');
    
    try {
        // Get current settings
        const settings = await getCurrentSettings();
        console.log('⚙️ Current settings:', settings);
        
        if (!settings.apiKey) {
            window.userSettings.showAlert('❌ No API key configured. Please set up your API key first.', 'error');
            return;
        }
        
        if (!settings.apiProvider) {
            window.userSettings.showAlert('❌ No API provider selected. Please select an AI provider.', 'error');
            return;
        }
        
        // Test connection by sending a simple message to background script
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                action: 'testAPIConnection',
                settings: settings
            }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });
        
        if (response && response.success) {
            window.userSettings.showAlert(`✅ API connection successful! Provider: ${settings.apiProvider}`, 'success');
        } else {
            window.userSettings.showAlert(`❌ API connection failed: ${response?.error || 'Unknown error'}`, 'error');
        }
        
    } catch (error) {
        console.error('❌ API connection test failed:', error);
        window.userSettings.showAlert(`❌ API connection test failed: ${error.message}`, 'error');
    }
}

// Test AI Generation Function
async function testAIGeneration() {
    console.log('🤖 Testing AI generation...');
    window.userSettings.showAlert('Testing AI generation...', 'warning');
    
    try {
        // Get current settings
        const settings = await getCurrentSettings();
        console.log('⚙️ Current settings:', settings);
        
        if (!settings.apiKey) {
            window.userSettings.showAlert('❌ No API key configured. Please set up your API key first.', 'error');
            return;
        }
        
        if (!settings.apiProvider) {
            window.userSettings.showAlert('❌ No API provider selected. Please select an AI provider.', 'error');
            return;
        }
        
        // Test generation with sample content
        const testContent = {
            postContent: "This is a test tweet about AI technology and its impact on society.",
            imageUrl: null,
            videoUrl: null,
            detectedLanguage: 'en'
        };
        
        console.log('📝 Testing with sample content:', testContent);
        
        // Send test generation request to background script
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                action: 'generateComments',
                ...testContent
            }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });
        
        if (response && response.success) {
            console.log('✅ AI generation test successful:', response);
            window.userSettings.showAlert(`✅ AI generation successful! Generated ${Object.keys(response.data || {}).length} replies`, 'success');
        } else {
            console.error('❌ AI generation test failed:', response);
            window.userSettings.showAlert(`❌ AI generation failed: ${response?.error || 'Unknown error'}`, 'error');
        }
        
    } catch (error) {
        console.error('❌ AI generation test failed:', error);
        window.userSettings.showAlert(`❌ AI generation test failed: ${error.message}`, 'error');
    }
}

// Get Current Settings Helper
async function getCurrentSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get([
            'claudeApiKey', 'openaiApiKey', 'geminiApiKey', 'localApiKey',
            'apiProvider', 'selectedModel', 'customEndpoint', 'apiKey',
            'customPrompt', 'selectedTones', 'language', 'promptType', 'commentLength'
        ], (result) => {
            const settings = {
                apiProvider: result.apiProvider || 'openai',
                apiKey: result.apiKey || result.openaiApiKey || result.claudeApiKey || result.geminiApiKey || result.localApiKey,
                selectedModel: result.selectedModel || 'gpt-4o',
                customEndpoint: result.customEndpoint || '',
                selectedTones: result.selectedTones || ['casual', 'professional'],
                language: result.language || 'auto',
                promptType: result.promptType || 'multi-tone',
                commentLength: result.commentLength || 'medium'
            };
            resolve(settings);
        });
    });
}

window.testPing = async () => {
    await testPing();
};

