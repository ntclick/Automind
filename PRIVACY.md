# Privacy Policy — AutoMind: AI Reply & Live Translator for X

**Last updated:** June 2026

AutoMind ("we", "us", "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, process, store, and share your data when you use the AutoMind browser extension.

---

## 1. Data Collection & Permissions

We collect the absolute minimum amount of data required to provide the extension's core functionality. We request only the permissions strictly necessary for our features:

### **Permissions Requested & Purpose:**
* **`activeTab`**: Used to securely read the active X/Twitter post context for generating replies and to initiate safe audio capturing context under active user direction.
* **`tabCapture`**: Used to capture the active tab's audio stream (e.g. live X Spaces, YouTube videos) when you explicitly click "Start Live Captions".
* **`offscreen`**: Used to launch a secure background window to run standard recording APIs (`MediaRecorder`) to segment tab audio chunks.
* **`sidePanel`**: Used to present the real-time captions, history list, and configuration controls in a convenient docked sidebar.
* **`storage`**: Used to save your settings locally on your machine.
* **`tts`**: Used to read out translated subtitles aloud as an optional accessibility voice readout.

### **Data We Collect and Process:**
* **User Settings**: Your selected tones, language preferences, UI preferences, and optional API keys.
* **Tweet Context**: The text of the tweet you are responding to or translating, ONLY when you explicitly click the "AutoMind AI" generation button.
* **Tab Audio Chunks**: Temporary base64 encoded audio segments captured locally from the active tab. **These chunks are processed solely in transit to generate text transcriptions and are NEVER permanently stored or saved anywhere.**
* **Anonymous Install ID**: A randomly generated UUID to track daily free-tier usage limits.

### **Data We DO NOT Collect:**
* Your name, email address, or personal identity.
* Your Twitter/X login credentials or session tokens.
* Your browsing history across unrelated sites.
* Any tab audio or video content when the "Live Captions" feature is in the "Stopped" state.
* Analytics or telemetry tracking data.

---

## 2. Data Processing and Use

The data we collect is used strictly for the following purposes:
* **Core Reply Functionality**: Tweet text context and selected tones are processed by the selected LLM to generate context-aware suggestions.
* **Live Translation Functionality**: Tab audio is split into small 2.5s segments locally inside your browser, converted to text via Speech-to-Text API, and translated into Vietnamese.
* **State Management**: User configurations are kept in storage to preserve your preferences across browser sessions.
* **Quota Management**: The anonymous install ID is used solely to verify daily free-tier usage counts on our server proxy.

We do not use your data for advertising, marketing, or training our own AI models.

---

## 3. Data Storage

* **Local Storage**: Your user preferences, custom API keys, and translation history are stored locally on your device using `chrome.storage.local`. This data never leaves your browser unless you initiate an AI completion.
* **Remote Storage (Free Tier Proxy Only)**: If you utilize our default proxy key, your anonymous install ID and a numeric usage counter (e.g., `quota:<uuid> = 12`) are temporarily stored on our Cloudflare Worker. This counter is automatically reset daily. The proxy does not store the content of your tweets, transcripts, translations, or IP address.

---

## 4. Data Sharing & Third-Party Services

We do not sell, rent, or trade your personal data. Data is shared with third-party service providers ONLY when necessary to fulfill your explicit requests:

### **A. AI Speech-to-Text (ASR) & Translation Providers:**
When you activate live captions or generate replies, text or audio data is sent securely to the AI provider you have selected in your settings:
* **OpenAI** (`api.openai.com`) - For text translation and Whisper ASR.
* **Groq** (`api.groq.com`) - For ultra-low latency speech transcription.
* **Anthropic Claude** (`api.anthropic.com`) - For premium text replies.
* **Google Gemini & Translate** (`generativelanguage.googleapis.com` & `translate.googleapis.com`) - For free-tier translations.
* **Kimi**, **DeepSeek**, **NVIDIA** - As alternative LLM choices.

### **B. Proxy Infrastructure:**
If using the free tier, requests are securely routed through our **Cloudflare** Worker proxy to protect administrative backend keys. 

Each third-party AI provider processes the data according to their own developer privacy policies (typically under strict API data retention policies where data is not used for model training).

---

## 5. Security

We take the security of your data seriously:
* All network communication between the extension, our proxy, and AI providers is fully encrypted using HTTPS.
* Personal API keys are stored securely inside Chrome's encrypted extension storage.
* Captured tab audio is processed temporarily in memory and is deleted instantly once transcription is completed.

---

## 6. Compliance

This extension strictly adheres to the **Chrome Web Store Developer Program Policies**, including the policies on User Data privacy and the **Least Privilege Principle**. We request only the narrowest possible permission scopes required to make our services work.

---

## 7. Contact Us

If you have any questions or concerns regarding this Privacy Policy or our data practices, please contact us via the support tab on our Chrome Web Store listing or open an issue on our GitHub repository.
