// AutoMind extension config — gitignored, never committed.
//
// SETUP:
//   1. Copy this file to `shared/secrets.js`
//   2. Set `proxyUrl` to your deployed Cloudflare Worker URL
//   3. (Real API keys live on the Worker — NEVER put them here in production)
//
// RECOMMENDED (production): proxyUrl only — keys stay server-side
//   self.ADMIN_DEFAULTS = { proxyUrl: 'https://automind-proxy.YOUR.workers.dev' };
//
// LEGACY (local dev only): bundle keys directly. They're public if you publish.
//   self.ADMIN_DEFAULTS = { kimiApiKey: 'sk-...' };
//
// SECURITY NOTE:
//   - `proxyUrl` is a public URL — safe to ship.
//   - Bundled API keys ship in the .crx/.zip — anyone can extract them.
//     Use the proxy approach unless you really know what you're doing.

self.ADMIN_DEFAULTS = {
  // Production: point to your deployed Cloudflare Worker
  proxyUrl: 'https://automind-proxy.YOUR-SUBDOMAIN.workers.dev',

  // Legacy / local dev only — leave empty for production
  // kimiApiKey: '',
  // openaiApiKey: '',
  // claudeApiKey: '',
  // geminiApiKey: '',
};
