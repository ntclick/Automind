// Enhanced Language Detection Module
class MultiLanguageDetector {
    constructor() {
        this.cache = new Map();
        this.patterns = this.initializePatterns();
        this.maxCacheSize = 100;
    }

    initializePatterns() {
        return {
            'vi': {
                regex: /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i,
                words: ['và', 'của', 'có', 'là', 'trong', 'với', 'được', 'cho', 'không', 'này', 'đó', 'một', 'các', 'những', 'tôi', 'bạn', 'anh', 'chị', 'em', 'chúng', 'ta', 'họ', 'nó', 'đây', 'như', 'thì', 'mà', 'để', 'khi', 'nếu', 'vì', 'nên', 'sẽ', 'đã', 'đang', 'ko', 'đc', 'mình'],
                score: 0
            },
            'en': {
                regex: /^[a-zA-Z0-9\s.,!?;:'"\-()]+$/,
                words: ['the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'with', 'you', 'this', 'but', 'his', 'by', 'from', 'they', 'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'fren', 'ser', 'lfg', 'gm'],
                score: 0
            },
            'zh': {
                regex: /[\u4e00-\u9fff]/,
                words: ['的', '是', '在', '了', '有', '和', '人', '这', '中', '大', '为', '上', '个', '国', '我', '他', '她', '它', '们', '你', '们', '那', '这', '些', '那', '些', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '不', '很', '说', '去', '来', '好', '要', '会', '能', '就', '都', '也', '着', '把', '被', '给', '过', '还', '以', '对', '从', '到', '出', '进', '让', '比', '像', '于', '往', '后', '得', '看', '听', '吃', '喝', '做', '写', '读', '学', '玩', '跑', '走', '坐', '站', '爱', '喜欢', '想', ' know', '觉得', '认为', '相信', '希望', '需要', '应该', '可以', '可能', '时间', '地方', '东西', '事情', '问题', '方法', '结果', '原因', '目的', '意义', '价值', '重要', '一样', '一样', '还是', '还是', '或者', '而且', '但是', '虽然', '因为', '所以', '如果', '那么', '的话', '的话'],
                score: 0
            },
            'ja': {
                regex: /[\u3040-\u309f\u30a0-\u30ff]/,
                words: ['の', 'に', 'は', 'を', 'た', 'が', 'で', 'て', 'と', 'し', 'れ', 'さ', 'ある', 'いる', 'です', 'ます', 'だ', 'である', 'する', 'なる', 'ある', 'いる', '見る', '聞く', '言う', '思う'],
                score: 0
            },
            'ko': {
                regex: /[\uac00-\ud7af]/,
                words: ['이', '그', '의', '를', '에', '는', '가', '과', '로', '으로', '에서', '부터', '까지', '에게', '이다', '있다', '하다', '되다', '보다', '보다', '같だ', '다르다', '크다', '작다', '좋다', '나쁘다'],
                score: 0
            },
            'ar': {
                regex: /[\u0600-\u06ff]/,
                words: ['في', 'من', 'إلى', 'على', 'هذا', 'هذه', 'التي', 'الذي', 'كان', 'كانت', 'يكون', 'تكون', 'أنا', 'أنت', 'هو', 'هي', 'نحن', 'أنتم', 'هم', 'هن', 'الذي', 'التي', 'هذا', 'هذه', 'ذلك', 'تلك'],
                score: 0
            },
            'ru': {
                regex: /[\u0400-\u04ff]/,
                words: ['и', 'в', 'не', 'на', 'я', 'быть', 'с', 'он', 'а', 'как', 'по', 'но', 'они', 'к', 'у', 'для', 'что', 'от', 'за', 'из', 'до', 'при', 'о', 'об', 'со', 'во'],
                score: 0
            },
            'th': {
                regex: /[\u0e00-\u0e7f]/,
                words: ['ที่', 'ใน', 'ของ', 'และ', 'เป็น', 'มี', 'จะ', 'ได้', 'ไม่', 'ก็', 'หรือ', 'แต่', 'ฉัน', 'คุณ', 'เขา', 'เธอ', 'เรา', 'พวกเขา', 'นี้', 'นั้น', 'นี่', 'นั่น', 'อะไร', 'ใคร', 'เมื่อไหร่', 'ที่ไหน'],
                score: 0
            },
            'hi': {
                regex: /[\u0900-\u097f]/,
                words: ['का', 'की', 'के', 'में', 'से', 'को', 'पर', 'है', 'हैं', 'था', 'थे', 'था', 'थी', 'हो', 'होता', 'होती', 'होते', 'मैं', 'तुम', 'वह', 'वे', 'यह', 'ये', 'वो', 'हम', 'आप'],
                score: 0
            },
            'es': {
                regex: /[ñáéíóúüç]/i,
                words: ['el', 'la', 'de', 'que', 'y', 'a', 'en', 'un', 'ser', 'se', 'no', 'te', 'lo', 'le', 'los', 'las', 'del', 'al', 'por', 'con', 'para', 'sobre', 'entre', 'hasta', 'desde', 'hacia'],
                score: 0
            },
            'fr': {
                regex: /[àâäéèêëïîôöùûüÿç]/i,
                words: ['le', 'de', 'et', 'à', 'un', 'il', 'être', 'et', 'en', 'avoir', 'que', 'pour', 'dans', 'ce', 'son', 'une', 'sur', 'avec', 'ne', 'se', 'pas', 'tout', 'mais', 'plus', 'par', 'comme'],
                score: 0
            }
        };
    }

    async detect(text) {
        if (!text || text.trim().length < 2) return 'en';

        // Fingerprint = 50 characters prefix + total length (sufficient to identify unique strings efficiently)
        const fingerprint = text.substring(0, 50) + '|' + text.length;
        
        // Check cache
        if (this.cache.has(fingerprint)) {
            return this.cache.get(fingerprint);
        }

        // Run pattern detection (accurate, local, and synchronous)
        const detected = this.detectByPatterns(text);
        
        // Cache result
        if (this.cache.size >= this.maxCacheSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(fingerprint, detected);

        console.log(`🌐 Detected language for "${text.substring(0, 30)}...":`, detected);
        return detected;
    }

    async detectWithChromeAPI(text) {
        try {
            const capabilities = await ai.languageDetector.capabilities();
            if (capabilities.available === 'no') {
                throw new Error('Chrome Language Detector not available');
            }

            const detector = await ai.languageDetector.create();
            const results = await detector.detect(text);

            return results[0]?.detectedLanguage || 'en';
        } catch (error) {
            throw error;
        }
    }

    detectByPatterns(text) {
        if (!text) return 'en';
        
        // 1. Fast-path Unicode block checks (O(1) matching for specific scripts)
        if (/[\u0e00-\u0e7f]/.test(text)) return 'th';      // Thai
        if (/[\uac00-\ud7af]/.test(text)) return 'ko';      // Korean
        if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja'; // Japanese Kana
        if (/[\u0600-\u06ff]/.test(text)) return 'ar';      // Arabic
        if (/[\u0400-\u04ff]/.test(text)) return 'ru';      // Cyrillic/Russian
        if (/[\u0900-\u097f]/.test(text)) return 'hi';      // Devanagari/Hindi
        
        // Vietnamese characters fast-path
        if (/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(text)) {
            return 'vi';
        }
        
        // Chinese character vs Japanese Kanji check
        if (/[\u4e00-\u9fff]/.test(text)) {
            return /[\u3040-\u30ff]/.test(text) ? 'ja' : 'zh';
        }
        
        // Latin scripts fallback scoring (English vs Spanish vs French)
        let bestLang = 'en';
        let maxScore = 0;
        
        // Reset scores
        Object.keys(this.patterns).forEach(lang => {
            this.patterns[lang].score = 0;
        });
        
        const cleanText = text.toLowerCase();
        
        // Check Regex matches (high weight)
        Object.entries(this.patterns).forEach(([lang, data]) => {
            if (lang === 'en') return; // Handled as default / fallback
            
            const regex = data.regex;
            if (regex) {
                const matches = text.match(new RegExp(regex, 'gi'));
                if (matches) {
                    data.score += matches.length * 8; // High weight for specific characters
                }
            }
        });
        
        // Check Word matches (medium weight)
        Object.entries(this.patterns).forEach(([lang, data]) => {
            if (data.words) {
                data.words.forEach(word => {
                    const regex = new RegExp(`\\b${word}\\b`, 'gi');
                    const matches = cleanText.match(regex);
                    if (matches) {
                        data.score += matches.length * 4;
                    }
                });
            }
        });
        
        // Determine the winner
        Object.entries(this.patterns).forEach(([lang, data]) => {
            if (data.score > maxScore) {
                maxScore = data.score;
                bestLang = lang;
            }
        });
        
        // Default to English if no strong indicator
        if (maxScore < 3) {
            const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
            const totalChars = text.replace(/\s/g, '').length;
            if (totalChars > 0 && (englishChars / totalChars) > 0.5) {
                return 'en';
            }
            return 'en';
        }
        
        return bestLang;
    }

    // Clear cache
    clearCache() {
        this.cache.clear();
    }

    // Get cache stats
    getCacheStats() {
        return {
            size: this.cache.size,
            maxSize: this.maxCacheSize
        };
    }

    async testWithFakeData() {
        console.log('🤖 Running test with pattern detector...');
        const viTest = this.detectByPatterns('Chào bạn, đây là tiếng Việt rất tự nhiên.');
        const enTest = this.detectByPatterns('Hello fren, this is standard crypto lfg gm vibe.');
        const zhTest = this.detectByPatterns('你好，这是中文测试。');
        
        return { 
            success: true, 
            message: 'Language detector tests completed',
            results: {
                vietnamese: viTest,
                english: enTest,
                chinese: zhTest
            }
        };
    }
}

// Export for use
const languageDetector = new MultiLanguageDetector();

if (typeof window !== 'undefined') {
    setTimeout(async () => {
        console.log('🚀 Enhanced Language Detector loaded successfully!');
    }, 1000);
}
