// AutoMind proxy client — used when the user has NOT configured their own API key.
// All requests go to your Cloudflare Worker, which holds the real keys.
// PROXY_URL is set in shared/secrets.js (gitignored). Do not commit real URL.

self.PROXY_CLIENT = {
  // Generate a stable per-install ID (kept in chrome.storage.local)
  async getInstallId() {
    const { installId } = await chrome.storage.local.get('installId');
    if (installId) return installId;
    const newId = crypto.randomUUID();
    await chrome.storage.local.set({ installId: newId });
    return newId;
  },

  // POST { provider, model, payload } to /proxy
  async call(provider, model, payload) {
    const proxyUrl = (self.ADMIN_DEFAULTS && self.ADMIN_DEFAULTS.proxyUrl) || 'https://automind-proxy.dev102vn.workers.dev';
    if (!proxyUrl) throw new Error('Proxy URL not configured');

    const installId = await this.getInstallId();
    const res = await fetch(`${proxyUrl}/proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Install-Id': installId
      },
      body: JSON.stringify({ provider, model, payload })
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error || `Proxy error ${res.status}`);
      err.status = res.status;
      err.quota = json.quota;
      err.quotaExhausted = !!json.quotaExhausted;
      throw err;
    }
    return json; // { success, data, quota }
  },

  async getQuota() {
    const proxyUrl = (self.ADMIN_DEFAULTS && self.ADMIN_DEFAULTS.proxyUrl) || 'https://automind-proxy.dev102vn.workers.dev';
    if (!proxyUrl) return null;
    const installId = await this.getInstallId();
    const res = await fetch(`${proxyUrl}/quota`, { headers: { 'X-Install-Id': installId } });
    const json = await res.json().catch(() => ({}));
    return json.quota || null;
  }
};
