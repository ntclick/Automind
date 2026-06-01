// Advanced Multi-Language Humanization Module
class MultiLanguageHumanizer {
    constructor() {
        this.patterns = this.loadLanguagePatterns();
    }

    loadLanguagePatterns() {
        return {
            'vi': {
                aiPatterns: [
                    'như một ai', 'tôi là trí tuệ nhân tạo', 'hơn nữa', 'thêm vào đó',
                    'điều quan trọng là', 'bạn nên xem xét', 'tôi nghĩ rằng bạn nên',
                    'tuy nhiên', 'do đó', 'vì vậy', 'như vậy', 'có thể thấy rằng',
                    'tóm lại', 'kết luận', 'nhìn chung', 'về cơ bản', 'tôi khuyên bạn'
                ],
                naturalReplacements: {
                    'thực sự thú vị': 'hay đấy',
                    'rất quan trọng': 'quan trọng',
                    'cần phải': 'nên',
                    'tôi nghĩ rằng': 'thấy',
                    'điều này': 'cái này',
                    'phát triển đáng kể': 'bay mạnh',
                    'xu hướng tích cực': 'trend ngon',
                    'điều này rất quan trọng': 'cái này quan trọng',
                    'cần phải xem xét': 'nên soi',
                    'tôi khuyên bạn nên': 'nên',
                    'đây là một': 'đây là',
                    'rất có thể': 'dễ là',
                    'chắc chắn': 'chắc luôn',
                    'đồng ý': 'chuẩn luôn',
                    'tuyệt vời': 'đỉnh chóp',
                    'không thể tin được': 'ảo thật đấy',
                    'chúc mừng': 'chúc mừng sếp'
                },
                hooks: [
                    'Ủa', 'Ơ', 'Thật luôn', 'Đợi đã', 'Ủa alo', 'Kìa', 'Tính ra', 'Cơ mà', 'Nói thật', 'Chuẩn', 'Gớm', 'Ái chà'
                ],
                cryptoSlang: [
                    'sếp', 'chủ tịch', 'uy tín', 'lên luôn', 'cháy', 'đỉnh', 'lùa gà', 'đu đỉnh', 'bắt đáy', 'ví', 'sàn', 'bay mạnh', 'fomo', 'fud'
                ],
                contractions: {
                    'không': 'ko',
                    'được': 'đc',
                    'nhưng': 'nhưg',
                    'người': 'ng',
                    'gì': 'j',
                    'biết': 'bít',
                    'quá': 'qá'
                }
            },
            'en': {
                aiPatterns: [
                    'as an ai', 'i am an artificial', 'furthermore', 'moreover',
                    'it\'s important to', 'you should consider', 'i would recommend',
                    'however', 'therefore', 'thus', 'it can be seen that',
                    'additionally', 'in conclusion', 'to summarize',
                    'it is worth noting', 'in summary'
                ],
                naturalReplacements: {
                    'this is interesting': 'based',
                    'very important': 'big if true',
                    'you should': 'u should',
                    'i believe that': 'imo',
                    'this situation': 'this',
                    'significant growth': 'moon',
                    'positive momentum': 'up only',
                    'it\'s important to note': 'fr',
                    'you should consider': 'maybe',
                    'i would recommend': 'try',
                    'this is a': 'this is',
                    'it is very likely': 'probs'
                },
                hooks: [
                    'Based', 'Honestly', 'Wait', 'Wow', 'Fr', 'Yo', 'Damn', 'Yoo', 'Bruh', 'No cap'
                ],
                cryptoSlang: [
                    'ser', 'fren', 'ngmi', 'wagmi', 'gm', 'gn', 'tbh', 'fam', 'anon', 'lfg', 'bags', 'whale'
                ],
                contractions: {
                    'do not': 'dont',
                    'cannot': 'cant',
                    'will not': 'wont',
                    'should not': 'shouldnt',
                    'would not': 'wouldnt',
                    'it is': 'its',
                    'you are': 'ure',
                    'they are': 'theyre',
                    'for real': 'fr',
                    'to be honest': 'tbh',
                    'not gonna lie': 'ngl'
                }
            },
            'es': {
                aiPatterns: [
                    'como una ia', 'soy una ia', 'inteligencia artificial',
                    'además', 'sin embargo', 'por lo tanto', 'así que',
                    'es importante', 'deberías considerar', 'recomendaría'
                ],
                naturalReplacements: {
                    'esto es interesante': 'qué bien',
                    'crecimiento significativo': 'subida brutal',
                    'momento positivo': 'buena vibra',
                    'es muy importante': 'clave',
                    'deberías': 'podrías',
                    'recomiendo': 'mira'
                },
                hooks: ['Oye', 'Wow', 'Vaya', 'Claro'],
                cryptoSlang: ['fren', 'ser', 'vamos', 'luna'],
                contractions: {}
            }
        };
    }

    humanize(text, language, tone = 'casual') {
        if (!text) return text;
        
        // Map long names (e.g. 'vietnamese', 'english') to standard 2-letter codes
        let langCode = language || 'en';
        if (langCode === 'vietnamese' || langCode === 'vi') langCode = 'vi';
        else if (langCode === 'english' || langCode === 'en') langCode = 'en';
        else if (langCode === 'spanish' || langCode === 'es') langCode = 'es';
        else if (langCode === 'chinese' || langCode === 'zh') langCode = 'zh';
        else if (langCode === 'japanese' || langCode === 'ja') langCode = 'ja';
        else if (langCode === 'korean' || langCode === 'ko') langCode = 'ko';

        console.log(`🧹 Humanizing with tone "${tone}" for language code "${langCode}"`);

        // If pattern for language is not registered, we still apply generic cleanups (Step 6, Step 7)
        let humanized = text;
        const langPatterns = this.patterns[langCode];

        if (langPatterns) {
            // Step 1: Remove AI patterns
            if (langPatterns.aiPatterns) {
                langPatterns.aiPatterns.forEach(pattern => {
                    const regex = new RegExp(`\\b${pattern}\\b`, 'gi');
                    humanized = humanized.replace(regex, '');
                });
            }

            // Step 2: Apply natural replacements
            if (langPatterns.naturalReplacements) {
                Object.entries(langPatterns.naturalReplacements).forEach(([formal, casual]) => {
                    const regex = new RegExp(formal, 'gi');
                    humanized = humanized.replace(regex, casual);
                });
            }

            // Step 3: Add contractions (40% chance)
            if (Math.random() < 0.4 && langPatterns.contractions) {
                Object.entries(langPatterns.contractions).forEach(([formal, casual]) => {
                    const regex = new RegExp(`\\b${formal}\\b`, 'gi');
                    humanized = humanized.replace(regex, casual);
                });
            }

            // Step 4: Add Hook (30% chance, start)
            if (Math.random() < 0.3 && langPatterns.hooks && langPatterns.hooks.length > 0) {
                const hook = this.getRandomElement(langPatterns.hooks);
                const startsWithHook = langPatterns.hooks.some(h => humanized.trim().toLowerCase().startsWith(h.toLowerCase()));
                if (!startsWithHook) {
                     // ✅ HOOK CASING SAFETY GUARD: When prepending a hook like "Wait,",
                     // lowercase the first char of original text to avoid "wait, Massively..." anomalies
                     let body = humanized.trimStart();
                     if (body.length > 0 && /^[A-Z]/.test(body) && !/^[A-Z]{2,}/.test(body) && !body.startsWith('@') && !body.startsWith('#')) {
                         body = body.charAt(0).toLowerCase() + body.slice(1);
                     }
                     humanized = `${hook}, ${body}`;
                }
            }

            // Step 5: Add Crypto Slang (40% chance, end)
            if (Math.random() < 0.4 && langPatterns.cryptoSlang && langPatterns.cryptoSlang.length > 0) {
                const slang = this.getRandomElement(langPatterns.cryptoSlang);
                if (!humanized.toLowerCase().includes(slang.toLowerCase())) {
                    humanized = `${humanized} ${slang}`;
                }
            }
        }
        
        // Step 6: Smart Emoji System based on tone
        const emojiMap = {
            'casual': ['😂', '🔥', '👀', '🙌', '💯', '🤣', '😎'],
            'punchy': ['🚀', '💯', '🔥', '👑', '💥', '💪', '⚡'],
            'witty': ['😉', '😎', '💡', '🧠', '😏'],
            'sarcastic': ['😏', '🙃', '🤡', '🤷‍♂️'],
            'contrarian': ['🤔', '🤷‍♂️', '🙃'],
            'sharp': ['⚔️', '🧠', '🥶'],
            'thao_mai': ['🥰', '🌸', '🎀', '🥺', '💖', '💐', '😘'],
            'empathetic': ['❤️', '🙏', '🥺', '✨'],
            'humorous': ['😂', '🤡', '🤪', '💀']
        };

        const stripAllEmojisTones = ['professional', 'analytical', 'brief', 'concise', 'direct'];

        if (stripAllEmojisTones.includes(tone)) {
            // Aggressively strip emojis for dry/professional tones
            humanized = humanized.replace(/[\u{1F300}-\u{1F9FF}]/gu, '');
            humanized = humanized.replace(/[\u{1F600}-\u{1F64F}]/gu, '');
            humanized = humanized.replace(/[\u{1F680}-\u{1F6FF}]/gu, '');
            humanized = humanized.replace(/[\u{2600}-\u{26FF}]/gu, '');
            humanized = humanized.replace(/[\u{2700}-\u{27BF}]/gu, '');
            humanized = humanized.replace(/[\u{1F900}-\u{1F9FF}]/gu, '');
        } else {
            // Allow emojis generated by AI, but clean up double emojis if redundant
            humanized = humanized.replace(/([\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}])\1+/gu, '$1');
            
            // If AI didn't include emojis, inject a tone-appropriate emoji with 45% chance
            const hasEmoji = /[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}]/gu.test(humanized);
            if (!hasEmoji && Math.random() < 0.45 && emojiMap[tone]) {
                const randomEmoji = this.getRandomElement(emojiMap[tone]);
                humanized = `${humanized} ${randomEmoji}`;
            }
        }

        // Step 7: Clean up
        humanized = this.finalCleanup(humanized, tone);

        return humanized;
    }

    getRandomElement(array) {
        return array[Math.floor(Math.random() * array.length)];
    }

    finalCleanup(text, tone) {
        // ✅ Step A: Spelling autocorrect for common LLM fat-finger typos
        const typoCorrections = {
            'isctually': 'actually',
            'definately': 'definitely',
            'teh': 'the',
            'adn': 'and',
            'becuase': 'because',
            'recieve': 'receive',
            'seperate': 'separate',
            'occured': 'occurred',
            'untill': 'until',
            'wierd': 'weird',
            'alot': 'a lot',
            'truely': 'truly',
            'occassion': 'occasion',
            'accomodate': 'accommodate',
            'goverment': 'government',
            'enviroment': 'environment'
        };
        let cleaned = text;
        Object.entries(typoCorrections).forEach(([typo, correct]) => {
            const regex = new RegExp(`\\b${typo}\\b`, 'gi');
            cleaned = cleaned.replace(regex, correct);
        });

        // ✅ Step B: Basic whitespace and dash cleanup
        cleaned = cleaned
            .replace(/\s+/g, ' ')
            .replace(/^[,\s\-]+/, '')       // Strip leading commas/dashes/spaces
            .replace(/[—–]/g, '-')
            .trim();

        // ✅ Step C: Selective trailing punctuation by tone category
        const formalTones = ['professional', 'analytical', 'detailed', 'educational', 'empathetic', 'friendly', 'encouraging', 'crisp'];
        const casualTones = ['casual', 'punchy', 'brief', 'sarcastic', 'witty', 'direct', 'snappy', 'thao_mai', 'humorous', 'sharp', 'contrarian'];

        if (formalTones.includes(tone)) {
            // Strip trailing commas/dashes but PRESERVE/ENSURE a final period
            cleaned = cleaned.replace(/[,\s\-]+$/, '').trim();
            if (cleaned.length > 0 && !/[.!?]$/.test(cleaned)) {
                cleaned += '.';
            }
        } else {
            // Casual: strip ALL trailing punctuation for internet aesthetic
            cleaned = cleaned.replace(/[,\.\s\-]+$/, '').trim();
        }

        // ✅ Step D: Smart Casing
        if (casualTones.includes(tone)) {
            if (cleaned.length > 0) {
                // Don't lowercase acronyms (BTC, SOL, GM), @mentions, or #hashtags
                if (!/^[A-Z]{2,}/.test(cleaned) && !cleaned.startsWith('@') && !cleaned.startsWith('#')) {
                    cleaned = cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
                }
            }
        } else {
             // For professional/formal, capitalize first letter
             if (cleaned.length > 0) {
                 cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
             }
        }

        // ✅ Step E: Smart Contraction Casing — fix weird "Ngl", "Tbh", "Fr" at sentence start
        const lowercaseContractions = ['ngl', 'tbh', 'fr', 'imo', 'irl', 'smh', 'fomo', 'fud', 'lfg', 'gm', 'gn', 'ser', 'ngmi', 'wagmi'];
        lowercaseContractions.forEach(abbr => {
            // Match the weirdly-capitalized form at the start (e.g. "Ngl" → "ngl", "Tbh" → "tbh")
            const weirdCased = abbr.charAt(0).toUpperCase() + abbr.slice(1).toLowerCase();
            if (cleaned.startsWith(weirdCased + ' ') || cleaned.startsWith(weirdCased + ',') || cleaned === weirdCased) {
                cleaned = abbr + cleaned.slice(abbr.length);
            }
        });
        
        return cleaned;
    }

    // Batch humanize multiple texts
    humanizeBatch(texts, language, tone = 'casual') {
        const results = {};
        Object.entries(texts).forEach(([key, text]) => {
            results[key] = this.humanize(text, language, tone);
        });
        return results;
    }

    // Get supported languages
    getSupportedLanguages() {
        return Object.keys(this.patterns);
    }

    // Check if language is supported
    isLanguageSupported(language) {
        let lang = language;
        if (lang === 'vietnamese') lang = 'vi';
        else if (lang === 'english') lang = 'en';
        else if (lang === 'spanish') lang = 'es';
        return this.patterns.hasOwnProperty(lang);
    }
}

// Export for use
const multiLanguageHumanizer = new MultiLanguageHumanizer();
if (typeof window !== 'undefined') {
    window.MultiLanguageHumanizer = MultiLanguageHumanizer;
}
