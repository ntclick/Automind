// Advanced Multi-Language Humanization Module
class MultiLanguageHumanizer {
    constructor() {
        this.patterns = this.loadLanguagePatterns();
    }

    loadLanguagePatterns() {
        return {
            'vi': {
                // Only genuinely robotic openers belong here. Everyday connectives
                // ("tuy nhiên", "vì vậy", "như vậy", "nhìn chung", "về cơ bản") were
                // removed: they are normal spoken Vietnamese, and deleting them
                // mid-sentence mangled real replies — e.g. "ai cũng có những ngày
                // như vậy." became "ai cũng có những ngày ." It also contradicted
                // the generation prompt, which explicitly says to keep connectors.
                aiPatterns: [
                    'như một ai', 'tôi là trí tuệ nhân tạo', 'là một trí tuệ nhân tạo',
                    'với tư cách là một ai', 'tôi không thể', 'tôi nghĩ rằng bạn nên',
                    'bạn nên xem xét', 'tôi khuyên bạn', 'có thể thấy rằng',
                    'điều quan trọng cần lưu ý là', 'tóm lại thì'
                ],
                naturalReplacements: {},
                hooks: [],
                cryptoSlang: [],
                contractions: {}
            },
            'en': {
                aiPatterns: [
                    'as an ai', 'i am an artificial', 'furthermore', 'moreover',
                    'it\'s important to', 'you should consider', 'i would recommend',
                    'however', 'therefore', 'thus', 'it can be seen that',
                    'additionally', 'in conclusion', 'to summarize',
                    'it is worth noting', 'in summary'
                ],
                naturalReplacements: {},
                hooks: [],
                cryptoSlang: [],
                contractions: {}
            },
            'es': {
                aiPatterns: [
                    'como una ia', 'soy una ia', 'inteligencia artificial',
                    'además', 'sin embargo', 'por lo tanto', 'así que',
                    'es importante', 'deberías considerar', 'recomendaría'
                ],
                naturalReplacements: {},
                hooks: [],
                cryptoSlang: [],
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
            // Step 1: Remove AI patterns.
            // Strip the leftover whitespace too, otherwise removing a phrase
            // leaves a double space or a stranded " ." before the full stop.
            if (langPatterns.aiPatterns) {
                langPatterns.aiPatterns.forEach(pattern => {
                    // \b is ASCII-only and does not fire correctly next to
                    // Vietnamese diacritics, so bound on whitespace/edges instead.
                    const regex = new RegExp(`(^|\\s)${pattern}(?=$|[\\s,.!?])`, 'gi');
                    humanized = humanized.replace(regex, '$1');
                });
                humanized = humanized
                    .replace(/\s{2,}/g, ' ')
                    .replace(/\s+([,.!?])/g, '$1')
                    .trim();
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

        // ✅ Step D: Smart Casing - Always capitalize first letter of sentences (viết hoa đầu dòng đúng chính tả)
        if (cleaned.length > 0) {
            cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
        }

        // ✅ Step E: Smart Contraction Casing - Ensure standard abbreviations at start are capitalized correctly (e.g. "Ngl", "Tbh", "Gm")
        const contractions = ['ngl', 'tbh', 'fr', 'imo', 'irl', 'smh', 'fomo', 'fud', 'lfg', 'gm', 'gn', 'ser', 'ngmi', 'wagmi'];
        contractions.forEach(abbr => {
            const lowerCased = abbr.toLowerCase();
            const capitalized = abbr.charAt(0).toUpperCase() + abbr.slice(1).toLowerCase();
            if (cleaned.startsWith(lowerCased + ' ') || cleaned.startsWith(lowerCased + ',') || cleaned === lowerCased) {
                cleaned = capitalized + cleaned.slice(lowerCased.length);
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
