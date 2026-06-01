# AutoMind - AI Reply & Live Translator for X (Twitter)

🚀 **The ultimate dual-powered browser assistant for X.com: Generate smart, context-aware AI replies and translate live tab audio (Spaces, live streams, videos) into real-time Vietnamese subtitles inside a convenient Side Panel.**

---

## ✨ Features

### 🎙️ 1. Live Stream Captions & Translation
Never miss a word in any active tab audio. AutoMind captures tab audio stream and translates speech into real-time subtitles:
* **Docked Side Panel**: View streaming subtitles comfortably right next to your timeline.
* **X Spaces & Live Video Translation**: Instantly translate spoken English into natural, fluent Vietnamese.
* **Ultra-Low Latency ASR**: Integrates with high-performance speech engines (Groq Whisper, OpenAI Whisper) for gapless audio capture.
* **Text-to-Speech (TTS) Voice Readout**: Optional audio output for accessibility, reading translated sentences aloud.
* **Mute Tab Sync**: Automatically mutes the tab audio when TTS is enabled to prevent overlapping audio playback.

### 🚀 2. AI Smart Replies for X.com
Stand out in any conversation on X with highly contextual, engaging replies:
* **One-Click Comment Generation**: Automatically drafts comment suggestions based on the post thread.
* **Customizable Tones**: Professional, Casual, Sarcastic, Witty, Concise, or Analytical (tailored for Web3/Crypto community vibes).
* **Smart Language Detection**: Automatically analyzes the source language of the post and drafts the reply in the exact same language.
* **Leading AI Models**: Flexible backend routing using OpenAI (GPT-4o/mini), Anthropic (Claude 3.5 Sonnet), Google (Gemini 1.5 Pro/Flash), DeepSeek, Kimi, or Local APIs.

---

## 🚀 Installation & Setup

### 📥 Cloning to Your **Downloads** Folder
If you want to quickly clone this repository straight to your computer's **Downloads** folder, copy and paste the appropriate command below into your command-line interface:

#### **Option A: For PowerShell** (Recommended on Windows)
```powershell
cd "$env:USERPROFILE\Downloads"; git clone https://github.com/ntclick/Automind.git
```

#### **Option B: For Command Prompt (CMD)**
```cmd
cd %USERPROFILE%\Downloads && git clone https://github.com/ntclick/Automind.git
```

---

### 🔧 Load the Extension into Google Chrome

Once the repository is cloned:
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable the **"Developer mode"** toggle in the top-right corner.
3. Click the **"Load unpacked"** button in the top-left.
4. Select the `Automind` folder located inside your **Downloads** directory.
5. AutoMind will now be active in your extension bar!

---

## 🎯 How to Use

### 1. Configuration (Optional: Bring Your Own Key)
* AutoMind provides **50 free daily uses** out of the box via our secure Cloudflare proxy.
* If you require unlimited uses, click the extension icon, navigate to **Settings**, and toggle on **"Use Own API Key"** to enter your OpenAI, Anthropic, or Groq API Keys.

### 2. Crafting AI Replies on X.com
* Open [X.com](https://x.com) (Twitter).
* The extension programmatically injects AI action buttons directly beneath posts.
* Click the **AI Button**, select your desired **Tone**, and watch the extension generate a contextual draft response in seconds.

### 3. Capturing Live Captions & Spaces
* Open any tab containing live audio (e.g., an X Space, a YouTube video, or a podcast).
* Click the **AutoMind** extension icon and click **"Start Live Captions"**.
* A secure launch overlay will prompt a single click to authorize browser audio capture.
* The Chrome **Side Panel** will automatically open next to your tab, rendering real-time translation subtitles!

---

## 🔒 Privacy & Security

* **Zero Tracking**: AutoMind does NOT track your browsing history or require your Twitter/X credentials.
* **Local Storage**: All user settings, configurations, and caption history are stored 100% locally on your machine using `chrome.storage.local`.
* **ASR Audio Transit**: Audio segments are processed transiently in memory to output text. **No raw audio files or recording logs are ever permanently saved, stored, or distributed.**

---

## 🤝 Contributing

1. **Fork** the repository.
2. **Create** your feature branch (`git checkout -b feature/AmazingFeature`).
3. **Commit** your changes (`git commit -m 'Add some AmazingFeature'`).
4. **Push** to the branch (`git push origin feature/AmazingFeature`).
5. **Open** a Pull Request.

---

## 📄 License

Distributed under the MIT License. See [LICENSE.md](LICENSE.md) for more information.

---

**Made with ❤️ for Arc users**

**Author**: [@trungkts29](https://x.com/trungkts29)
