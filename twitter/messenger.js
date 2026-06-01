// Robust messaging system between components
class ExtensionMessenger {
    static timeouts = new Map();
    static messageId = 0;

    static async sendToBackground(action, data, timeout = 15000) {
        return new Promise((resolve, reject) => {
            const messageId = ++this.messageId;

            const timeoutId = setTimeout(() => {
                this.timeouts.delete(messageId);
                reject(new Error(`Message timeout after ${timeout}ms`));
            }, timeout);

            this.timeouts.set(messageId, timeoutId);

            chrome.runtime.sendMessage({ 
                action, 
                data, 
                messageId,
                timestamp: Date.now() 
            }, (response) => {
                const timeoutId = this.timeouts.get(messageId);
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    this.timeouts.delete(messageId);
                }

                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (response?.error) {
                    reject(new Error(response.error));
                } else {
                    resolve(response);
                }
            });
        });
    }

    // ✅ ENHANCED: Testing functions
    static async runFullTest() {
        try {
            console.log('🧪 Running full extension test via messenger...');
            const result = await this.sendToBackground('runFullTest', {});
            console.log('✅ Full test completed:', result);
            return result;
        } catch (error) {
            console.error('❌ Full test failed:', error);
            throw error;
        }
    }

    static async testSettings() {
        try {
            console.log('⚙️ Testing settings via messenger...');
            const result = await this.sendToBackground('testSettings', {});
            console.log('✅ Settings test completed:', result);
            return result;
        } catch (error) {
            console.error('❌ Settings test failed:', error);
            throw error;
        }
    }

    static async testAPIConnection() {
        try {
            console.log('🔗 Testing API connection via messenger...');
            const result = await this.sendToBackground('testAPIConnection', {});
            console.log('✅ API test completed:', result);
            return result;
        } catch (error) {
            console.error('❌ API test failed:', error);
            throw error;
        }
    }

    static async testAIGeneration() {
        try {
            console.log('🤖 Testing AI generation via messenger...');
            const result = await this.sendToBackground('testAIGeneration', {});
            console.log('✅ AI test completed:', result);
            return result;
        } catch (error) {
            console.error('❌ AI test failed:', error);
            throw error;
        }
    }

    static async generateReplies(postData) {
        try {
            // Debug postData structure
            console.log('🔍 DEBUG: postData received:', postData);
            console.log('🔍 DEBUG: postData.text:', postData?.text);
            console.log('🔍 DEBUG: postData type:', typeof postData);
            
            // ✅ ENHANCED: Robust validation with multiple checks
            if (!postData) {
                console.error('❌ DEBUG: postData is null/undefined');
                throw new Error('No post data provided');
            }
            
            // ✅ FIXED: More detailed validation logging
            console.log('🔍 DEBUG: postData.text exists:', !!postData.text);
            console.log('🔍 DEBUG: postData.postContent exists:', !!postData.postContent);
            console.log('🔍 DEBUG: postData.text length:', postData.text?.length || 0);
            console.log('🔍 DEBUG: postData.postContent length:', postData.postContent?.length || 0);
            
            // ✅ ENHANCED: Priority order text extraction: text -> postContent -> content -> message
            const textContent = postData.text || postData.postContent || postData.content || postData.message || '';
            
            console.log('🔍 DEBUG: Text extraction priority check:');
            console.log('🔍 DEBUG: postData.text:', !!postData.text, postData.text?.substring(0, 50) + '...');
            console.log('🔍 DEBUG: postData.postContent:', !!postData.postContent, postData.postContent?.substring(0, 50) + '...');
            console.log('🔍 DEBUG: postData.content:', !!postData.content, postData.content?.substring(0, 50) + '...');
            console.log('🔍 DEBUG: postData.message:', !!postData.message, postData.message?.substring(0, 50) + '...');
            console.log('🔍 DEBUG: Final textContent:', textContent?.substring(0, 50) + '...');
            console.log('🔍 DEBUG: textContent type:', typeof textContent);
            console.log('🔍 DEBUG: textContent length:', textContent?.length || 0);
            console.log('🔍 DEBUG: textContent.trim().length:', textContent?.trim().length || 0);
            
            // ✅ CRITICAL FIX: Ensure we have valid text content
            if (!textContent || textContent.trim().length === 0) {
                console.error('❌ DEBUG: No valid text content found in any field:', postData);
                console.error('❌ DEBUG: textContent value:', textContent);
                console.error('❌ DEBUG: textContent type:', typeof textContent);
                throw new Error('No post content provided');
            }
            // Step 1: Detect language first
            console.log('🔍 DEBUG: Checking languageDetector:', typeof languageDetector);
            if (typeof languageDetector === 'undefined') {
                console.error('❌ languageDetector is not defined');
                throw new Error('Language detector not loaded');
            }
            
            const detectedLang = await languageDetector.detect(textContent);
            console.log('🌐 Detected language:', detectedLang);
            
            // ✅ CRITICAL FIX: Ensure we send postContent field as background.js expects
            const requestData = {
                action: 'generateComments',
                postContent: textContent, // ✅ CRITICAL: Use postContent field
                platform: 'twitter',
                sessionId: postData.sessionId || 'session_' + Date.now(),
                userId: postData.userId || 'user_' + Date.now(),
                timestamp: Date.now(),
                detectedLanguage: detectedLang
            };
            
            console.log('🔍 DEBUG: Request data prepared:', {
                postContent: requestData.postContent?.substring(0, 50) + '...',
                detectedLanguage: requestData.detectedLanguage
            });

            // Step 2: Send to background for AI processing (with timeout)
            const requestSummary = {
                action: requestData.action,
                postLength: (requestData.postContent || '').length,
                platform: requestData.platform,
                detectedLanguage: requestData.detectedLanguage
            };
            console.log('🛰️ Sending request to background:', requestSummary);
            const startAt = Date.now();

            const response = await new Promise((resolve, reject) => {
                console.log('🔍 DEBUG: Starting chrome.runtime.sendMessage...');
                // ✅ FIX: Check if extension context is still valid
                if (!chrome.runtime || !chrome.runtime.id) {
                    console.error('❌ Extension context invalidated');
                    reject(new Error('Extension context invalidated - please reload the page'));
                    return;
                }
                const timeoutId = setTimeout(() => {
                    console.error('⏰ Messenger timeout after 30 seconds');
                    reject(new Error('Generation timeout - please try again'));
                }, 30000);

                chrome.runtime.sendMessage(requestData, (response) => {
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
                        const elapsed = Date.now() - startAt;
                        try {
                            console.log('📩 Background response received:', {
                                tookMs: elapsed,
                                hasResponse: !!response,
                                success: response?.success,
                                apiProvider: response?.apiProvider,
                                model: response?.model,
                                tones: response?.data ? Object.keys(response.data) : null,
                                commentCount: response?.commentCount
                            });
                        } catch {}
                        resolve(response);
                    }
                });
            });

            if (response.success) {
                // Step 3: Humanize each reply (with fallback)
                console.log('🔍 DEBUG: Checking MultiLanguageHumanizer:', typeof MultiLanguageHumanizer);
                let humanizedReplies = {};

                try {
                    if (typeof MultiLanguageHumanizer !== 'undefined') {
                        const humanizer = new MultiLanguageHumanizer();
                        Object.entries(response.data).forEach(([tone, reply]) => {
                            humanizedReplies[tone] = humanizer.humanize(reply, detectedLang, tone);
                        });
                        console.log('✅ Humanization successful');
                    } else {
                        console.warn('⚠️ MultiLanguageHumanizer not available, using original replies');
                        humanizedReplies = { ...response.data };
                    }
                } catch (error) {
                    console.error('❌ Humanization failed, using original replies:', error);
                    humanizedReplies = { ...response.data };
                }

                const finalResult = {
                    success: true,
                    data: humanizedReplies,
                    language: detectedLang,
                    provider: response.apiProvider,
                    originalData: response.data
                };

                console.log('🔍 DEBUG: Messenger returning result:', {
                    success: finalResult.success,
                    dataKeys: Object.keys(finalResult.data),
                    dataCount: Object.keys(finalResult.data).length,
                    language: finalResult.language,
                    provider: finalResult.provider
                });

                return finalResult;
            } else {
                console.error('❌ Background responded with failure:', response);
                throw new Error(response.error || 'Generation failed');
            }
        } catch (error) {
            console.error('❌ Reply generation error (content → background):', {
                message: error.message,
                stack: error.stack
            });
            if (error.message.includes('Extension context invalidated')) {
                console.warn('⚠️ Extension context invalidated - using fallback replies');
                // Show user-friendly message
                if (typeof showExtensionReloadMessage === 'function') {
                    showExtensionReloadMessage();
                }
            } else {
                console.error('❌ Reply generation error:', error);
            }

            // Fallback to cached responses
            console.log('🔄 Using fallback replies...');
            return this.getFallbackReplies(postData?.text || postData?.postContent || '');
        }
    }

    static async getFallbackReplies(postContent) {
        // ✅ ENHANCED: Better language detection for fallback responses
        let lang = 'en'; // Default fallback
        try {
            if (postContent && postContent.trim().length > 0) {
                lang = await languageDetector.detect(postContent);
            }
        } catch (error) {
            console.log('⚠️ Language detection failed for fallback, using default:', error.message);
        }
        
        console.log('🔄 Using fallback replies for language:', lang);

        const fallbacks = {
            'vi': {
                casual: 'Hay đấy! Cảm ơn bạn đã chia sẻ',
                professional: 'Quan điểm rất thú vị và đáng suy ngẫm',
                sarcastic: 'Ồ tuyệt vời, một "khám phá" mới nữa',
                witty: 'Plot twist của ngày hôm nay đây rồi',
                analytical: 'Dữ liệu cho thấy những xu hướng đáng chú ý',
                concise: 'Thú vị thật',
                detailed: 'Phân tích chi tiết cho thấy nhiều điểm đáng quan tâm',
                friendly: 'Cảm ơn bạn đã chia sẻ thông tin hữu ích này',
                empathetic: 'Tôi hiểu và đánh giá cao quan điểm này',
                educational: 'Đây là kiến thức hữu ích cho những ai quan tâm',
                encouraging: 'Tiếp tục phát triển! Kiên trì sẽ được đền đáp',
                contrarian: 'Thú vị, nhưng có thể có những góc nhìn khác'
            },
            'en': {
                casual: 'This looks interesting! Thanks for sharing',
                professional: 'This presents a compelling perspective worth considering',
                sarcastic: 'Oh wonderful, another "breakthrough"',
                witty: 'Another day, another plot twist',
                analytical: 'Data patterns suggest significant implications',
                concise: 'Bullish',
                detailed: 'Comprehensive analysis reveals multiple key insights',
                friendly: 'Thanks for sharing this valuable information',
                empathetic: 'I understand and appreciate this perspective',
                educational: 'This is useful knowledge for those interested',
                encouraging: 'Keep building! Persistence pays off',
                contrarian: 'Interesting, but there might be other angles to consider'
            },
            'es': {
                casual: '¡Esto se ve interesante! Gracias por compartir',
                professional: 'Esto presenta una perspectiva convincente que vale la pena considerar',
                sarcastic: 'Oh maravilloso, otro "avance"',
                witty: '¡Otro día, otro giro en la trama!'
            },
            'fr': {
                casual: 'Ça a l\'air intéressant ! Merci de partager',
                professional: 'Cela présente une perspective convaincante à considérer',
                sarcastic: 'Oh merveilleux, une autre "percée"',
                witty: 'Un autre jour, un autre rebondissement'
            },
            'zh': {
                casual: '这看起来很有趣！感谢分享',
                professional: '这提出了一个值得考虑的令人信服的观点',
                sarcastic: '哦太好了，又一个"突破"',
                witty: '又是新的一天，又一个情节转折'
            },
            'ja': {
                casual: 'これは面白そうですね！シェアしてくれてありがとう',
                professional: 'これは考慮に値する説得力のある視点を提示しています',
                sarcastic: 'ああ素晴らしい、また別の「ブレークスルー」',
                witty: 'また別の日、また別のプロットツイスト'
            },
            'ko': {
                casual: '이것은 흥미로워 보입니다! 공유해 주셔서 감사합니다',
                professional: '이것은 고려할 가치가 있는 설득력 있는 관점을 제시합니다',
                sarcastic: '오 훌륭합니다, 또 다른 "돌파구"',
                witty: '또 다른 하루, 또 다른 플롯 트위스트'
            },
            'ar': {
                casual: 'هذا يبدو مثيراً للاهتمام! شكراً للمشاركة',
                professional: 'هذا يقدم منظوراً مقنعاً يستحق النظر فيه',
                sarcastic: 'أوه رائع، "اختراق" آخر',
                witty: 'يوم آخر، تطور آخر في القصة'
            },
            'th': {
                casual: 'นี่ดูน่าสนใจ! ขอบคุณที่แบ่งปัน',
                professional: 'นี่แสดงมุมมองที่น่าสนใจที่ควรพิจารณา',
                sarcastic: 'โอ้เยี่ยม "ความก้าวหน้า" อีกครั้ง',
                witty: 'อีกวันหนึ่ง การพลิกผันของพล็อตอีกครั้ง'
            }
        };

        return {
            success: true,
            data: fallbacks[lang] || fallbacks['en'],
            language: lang,
            provider: 'fallback'
        };
    }

    // Test connection to background script
    static async testConnection() {
        try {
            const response = await this.sendToBackground('ping', { test: true }, 5000);
            return { success: true, response };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Clear all pending timeouts
    static clearAllTimeouts() {
        this.timeouts.forEach((timeoutId) => {
            clearTimeout(timeoutId);
        });
        this.timeouts.clear();
    }

    // Get timeout stats
    static getTimeoutStats() {
        return {
            activeTimeouts: this.timeouts.size,
            nextMessageId: this.messageId + 1
        };
    }

    // ✅ NEW: Farcaster-specific reply generation
    static async generateFarcasterReplies(castData) {
        try {
            console.log('🎯 Farcaster: Generating replies for cast...');
            console.log('🔍 DEBUG: castData received:', castData);
            
            // Handle different input formats for Farcaster
            let castContent;
            if (typeof castData === 'string') {
                castContent = castData;
            } else if (castData.text) {
                castContent = castData.text;
            } else if (castData.content) {
                castContent = castData.content;
            } else {
                throw new Error('Invalid cast data format');
            }
            
            if (!castContent || castContent.trim().length === 0) {
                throw new Error('No cast content provided');
            }
            
            console.log('✅ Farcaster: Cast content length:', castContent.length);
            
            // Send to Farcaster-specific background script
            const requestData = {
                action: 'generateFarcasterReplies',
                postContent: castContent,
                imageUrl: castData.imageUrl || null,
                videoUrl: castData.videoUrl || null,
                detectedLanguage: castData.detectedLanguage || null,
                platform: 'farcaster'
            };
            
            console.log('🔍 Farcaster: Sending requestData:', requestData);
            
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(requestData, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(response);
                    }
                });
            });
            
            console.log('✅ Farcaster: Response received:', response);
            
            if (!response) {
                throw new Error('No response from Farcaster background script');
            }
            
            if (!response.success) {
                throw new Error(response.error || 'Unknown Farcaster error occurred');
            }
            
            return response.replies || [];
            
        } catch (error) {
            console.error('❌ ExtensionMessenger.generateFarcasterReplies error:', error);
            throw error;
        }
    }
}

// Export for use
const extensionMessenger = ExtensionMessenger;
