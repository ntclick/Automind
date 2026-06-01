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
        const apiKeysSection = document.getElementById('apiKeysSection');

        // Expose for save handlers to flip UI without reload
        this._applyAiMode = (mode) => {
            const isCustom = mode === 'custom';
            if (customSection)  customSection.style.display  = isCustom ? '' : 'none';
            if (apiKeysSection) apiKeysSection.style.display = isCustom ? '' : 'none';
            const target = document.querySelector(`input[name="aiMode"][value="${mode}"]`);
            if (target) target.checked = true;
            chrome.storage.sync.set({ aiMode: mode });
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

        // Save buttons event listeners with better targeting
        document.querySelectorAll('.btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const buttonText = btn.textContent.toLowerCase().trim();
                console.log('🔘 Button clicked:', buttonText, 'Element:', btn);
                
                if (buttonText.includes('save tone') || buttonText.includes('save tone settings')) {
                    console.log('🎭 Save tone button clicked!');
                    this.saveUserSettings();
                } else if (buttonText.includes('save language')) {
                    console.log('🌐 Save language button clicked!');
                    this.saveLanguageSettings();
                } else if (buttonText.includes('save character')) {
                    console.log('👤 Save character button clicked!');
                    this.saveCharacterSettings();
                } else if (buttonText.includes('save model')) {
                    console.log('🤖 Save model button clicked!');
                    this.saveModelSettings();
                } else if (buttonText.includes('save system')) {
                    console.log('⚙️ Save system button clicked!');
                    this.saveSystemSettings();
                } else if (buttonText.includes('save openai')) {
                    console.log('🤖 Save OpenAI button clicked!');
                    this.saveOpenAISettings();
                } else if (buttonText.includes('save claude')) {
                    console.log('🧠 Save Claude button clicked!');
                    this.saveClaudeSettings();
                } else if (buttonText.includes('save gemini')) {
                    console.log('💎 Save Gemini button clicked!');
                    this.saveGeminiSettings();
                } else if (buttonText.includes('save kimi')) {
                    console.log('🌙 Save Kimi button clicked!');
                    this.saveKimiSettings();
                } else if (buttonText.includes('save deepseek')) {
                    console.log('💾 Save DeepSeek button clicked!');
                    this.saveDeepSeekSettings();
                } else if (buttonText.includes('save nvidia')) {
                    console.log('💾 Save NVIDIA button clicked!');
                    this.saveNvidiaSettings();
                } else if (buttonText.includes('save groq')) {
                    console.log('⚡ Save Groq button clicked!');
                    this.saveGroqSettings();
                } else if (buttonText.includes('save local')) {
                    console.log('🏠 Save Local button clicked!');
                    this.saveLocalSettings();
                } else if (buttonText.includes('save asr')) {
                    console.log('🎙️ Save ASR button clicked!');
                    this.saveAsrSettings();
                } else if (buttonText.includes('save all')) {
                    console.log('💾 Save all button clicked!');
                    this.saveAllApiKeys();
                }
            });
        });

        // Test buttons event listeners
        document.querySelectorAll('.btn-secondary').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const buttonText = btn.textContent.toLowerCase();
                
                if (buttonText.includes('test connection')) {
                    this.testModelConnection();
                } else if (buttonText.includes('test openai')) {
                    this.testOpenAI();
                } else if (buttonText.includes('test claude')) {
                    this.testClaude();
                } else if (buttonText.includes('test gemini')) {
                    this.testGemini();
                } else if (buttonText.includes('test kimi')) {
                    this.testKimi();
                } else if (buttonText.includes('test deepseek')) {
                    this.testDeepSeek();
                } else if (buttonText.includes('test nvidia')) {
                    this.testNvidia();
                } else if (buttonText.includes('test groq')) {
                    this.testGroq();
                } else if (buttonText.includes('test local')) {
                    this.testLocal();
                } else if (buttonText.includes('test all')) {
                    this.testAllApiKeys();
                } else if (buttonText.includes('reset')) {
                    this.resetToDefaults();
                }
            });
        });

        // Setup main tab navigation
        this.setupMainTabNavigation();
        
        // Setup provider tab navigation
        this.setupTabNavigation();
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

    // Setup provider tab navigation
    setupTabNavigation() {
        const tabButtons = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = button.getAttribute('data-tab');

                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));

                button.classList.add('active');
                const tabContent = document.getElementById(`${targetTab}-tab`);
                if (tabContent) tabContent.classList.add('active');

                // Two-way sync: clicking a provider tab makes that provider the active one
                // (only meaningful in custom mode; harmless in system mode).
                const providerTabs = ['openai', 'claude', 'gemini', 'kimi', 'deepseek', 'nvidia', 'local'];
                if (providerTabs.includes(targetTab)) {
                    const providerSelect = document.getElementById('apiProvider');
                    if (providerSelect && providerSelect.value !== targetTab) {
                        providerSelect.value = targetTab;
                        // Repopulate model dropdown for new provider
                        if (typeof this.updateModelOptions === 'function') {
                            this.updateModelOptions(targetTab);
                        }
                    }
                    // Persist active provider
                    chrome.storage.sync.set({ apiProvider: targetTab });
                }
            });
        });
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
            const defaultTone = document.getElementById('defaultTone').value;
            console.log('📝 Default tone:', defaultTone);
            
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
                defaultTone: defaultTone,
                selectedTones: selectedTones,
                preferredLanguage: document.getElementById('preferredLanguage').value
            };

            console.log('💾 Saving to storage:', userSettings);
            console.log('💾 Saving selectedTones count:', userSettings.selectedTones.length);

            await chrome.storage.sync.set({
                userSettings: userSettings,
                lastUpdated: new Date().toISOString()
            });

            console.log('✅ Storage save completed');
            this.showAlert('User settings saved successfully!', 'success');
            console.log('✅ User settings saved:', userSettings);
        } catch (error) {
            console.error('❌ Error saving user settings:', error);
            this.showAlert('Error saving user settings: ' + error.message, 'error');
        }
    }

    // Save Language Settings
    async saveLanguageSettings() {
        try {
            const languageSettings = {
                preferredLanguage: document.getElementById('preferredLanguage').value
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
                { value: 'minimaxai/minimax-m2.7', text: 'MiniMax M2.7 (Reasoning)' },
                { value: 'meta/llama-4-maverick-17b-128e-instruct', text: 'Llama 4 Maverick 17B' },
                { value: 'step-3.5-flash', text: 'Step 3.5 Flash' },
                { value: 'mistralai/mistral-large-3-675b-instruct-2512', text: 'Mistral Large 3 (675B)' },
                { value: 'mistralai/mistral-nemotron', text: 'Mistral Nemotron' },
                { value: 'qwen/qwen3-coder-480b-a35b-instruct', text: 'Qwen 3 Coder 480B' },
                { value: 'google/gemma-3-27b-it', text: 'Gemma 3 27B IT' },
                { value: 'moonshotai/kimi-k2-instruct', text: 'Kimi K2 Instruct' },
                { value: 'moonshotai/kimi-k2-thinking', text: 'Kimi K2 Thinking' },
                { value: 'z.ai/glm-4.7', text: 'GLM 4.7' }
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
            const systemSettings = {
                dailyQuota: parseInt(document.getElementById('dailyQuota').value) || 50,
                maxTokens: parseInt(document.getElementById('maxTokens').value) || 150,
                temperature: parseFloat(document.getElementById('temperature').value) || 0.7,
                promptType: document.getElementById('promptType').value || 'default',
                commentLength: document.getElementById('commentLength').value || 'medium',
                language: document.getElementById('replyLanguage').value || 'auto'
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
            const settings = {
                geminiApiKey: document.getElementById('geminiApiKey').value.trim(),
                apiProvider: 'gemini',
                selectedModel: 'gemini-3.1-flash-preview',
                aiMode: 'custom'
            };
            if (!settings.geminiApiKey) {
                this.showAlert('Please enter Gemini API Key', 'error');
                return;
            }
            await chrome.storage.sync.set(settings);
            if (this._applyAiMode) this._applyAiMode('custom');
            this.showAlert('Gemini settings saved — Gemini is now your active provider.', 'success');
        } catch (error) {
            this.showAlert('Error saving Gemini settings', 'error');
            console.error('❌ Error saving Gemini settings:', error);
        }
    }

    async testGemini() {
        try {
            const apiKey = document.getElementById('geminiApiKey').value.trim();

            console.log('💎 [OPTIONS] Testing Gemini:', { hasApiKey: !!apiKey, apiKeyLength: apiKey.length });

            if (!apiKey) {
                this.showAlert('Please enter Gemini API Key first', 'error');
                return;
            }

            this.showAlert('Testing Gemini models...', 'warning');

            // Test multiple models like in the test script - prioritize working ones
            const modelsToTest = [
                'gemini-1.5-flash',      // Most stable and recommended
                'gemini-1.5-flash-8b',   // Fast and efficient
                'gemini-2.0-flash-exp'   // Current user setting (may have rate limits)
            ];

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
            const settings = {
                customEndpoint: document.getElementById('customEndpoint').value.trim(),
                localModel: document.getElementById('localModel').value
            };

            if (!settings.customEndpoint) {
                this.showAlert('Please enter Custom Endpoint', 'error');
                return;
            }

            await chrome.storage.sync.set(settings);
            this.showAlert('Local AI settings saved successfully', 'success');
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
        try {
            const engine = document.getElementById('ltAsrEngine').value;
            const settings = {
                ltAsrEngine: engine
            };
            await chrome.storage.sync.set(settings);
            this.showAlert(`ASR Speech Engine settings saved successfully. Active engine: ${engine}`, 'success');
            console.log('✅ ASR Speech Engine saved:', engine);
        } catch (error) {
            this.showAlert('Error saving ASR Settings', 'error');
            console.error('❌ Error saving ASR Settings:', error);
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
                groqModel: document.getElementById('groqModel').value,
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
        if (confirm('Reset all user settings to defaults?')) {
            try {
                const defaultSettings = {
                    defaultTone: 'professional',
                    preferredLanguage: 'auto'
                };

                await chrome.storage.sync.set({
                    userSettings: defaultSettings,
                    userLanguageSettings: { preferredLanguage: 'auto' },
                    lastUpdated: new Date().toISOString()
                });

                this.loadSettings();
                this.showAlert('Settings reset to defaults', 'success');
                console.log('✅ Settings reset to defaults');
            } catch (error) {
                this.showAlert('Error resetting settings', 'error');
                console.error('❌ Error resetting settings:', error);
            }
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
            const modelSettings = await chrome.storage.sync.get(['openaiModel', 'claudeModel', 'kimiModel', 'deepseekModel', 'nvidiaModel', 'groqModel', 'localModel']);
            console.log('📦 Individual model settings loaded:', modelSettings);

            if (modelSettings.openaiModel) {
                const element = document.getElementById('openaiModel');
                if (element) element.value = modelSettings.openaiModel;
            }
            if (modelSettings.claudeModel) {
                const element = document.getElementById('claudeModel');
                if (element) element.value = modelSettings.claudeModel;
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
            const asrSettings = await chrome.storage.sync.get(['ltAsrEngine']);
            const element = document.getElementById('ltAsrEngine');
            if (element) {
                element.value = asrSettings.ltAsrEngine || 'groq';
            }

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

