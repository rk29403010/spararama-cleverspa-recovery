import {
  CLEVERSPA_APP_ID,
  CLEVERSPA_PRODUCT_KEY,
  GIZWITS_API_ROOT,
} from "./constants.js";

export class GizwitsApiError extends Error {
  constructor(message, { status = 0, code = 0 } = {}) {
    super(message);
    this.name = "GizwitsApiError";
    this.status = status;
    this.code = code;
  }
}

export class GizwitsCloudClient {
  #token = "";
  #device = null;
  #bindingsUpdatedAt = 0;

  constructor({ fetchImpl = fetch, apiRoot = GIZWITS_API_ROOT } = {}) {
    this.fetch = fetchImpl;
    this.apiRoot = apiRoot;
  }

  get connected() {
    return Boolean(this.#token && this.#device);
  }

  get device() {
    return this.#device;
  }

  async #request(path, { method = "GET", body, authenticated = true } = {}) {
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Gizwits-Application-Id": CLEVERSPA_APP_ID,
    };
    if (authenticated && this.#token) headers["X-Gizwits-User-token"] = this.#token;
    const response = await this.fetch(`${this.apiRoot}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new GizwitsApiError(`Gizwits returned a non-JSON response (${response.status})`, {
        status: response.status,
      });
    }
    if (!response.ok || data.error_code) {
      throw new GizwitsApiError(
        data.error_message || data.detail_message || `Gizwits request failed (${response.status})`,
        { status: response.status, code: data.error_code || 0 },
      );
    }
    return data;
  }

  async login(username, password) {
    if (!username || !password) throw new Error("username and password are required");
    const result = await this.#request("/app/login", {
      method: "POST",
      authenticated: false,
      body: { username, password, lang: "en" },
    });
    this.#token = result.token;
    await this.refreshBindings();
    return { uid: result.uid, expireAt: result.expire_at, device: this.#device };
  }

  async useToken(token) {
    if (!token) throw new Error("token is required");
    this.#token = token;
    await this.refreshBindings();
    return { device: this.#device };
  }

  async refreshBindings() {
    const result = await this.#request("/app/bindings?limit=20&skip=0");
    const devices = result.devices || [];
    this.#device =
      devices.find((device) => device.product_key === CLEVERSPA_PRODUCT_KEY) ||
      devices[0] ||
      null;
    if (!this.#device) throw new GizwitsApiError("No spa is bound to this Gizwits account");
    this.#bindingsUpdatedAt = Date.now();
    return devices;
  }

  async getState() {
    if (!this.connected) throw new GizwitsApiError("Gizwits cloud is not connected");
    if (Date.now() - this.#bindingsUpdatedAt > 30_000) await this.refreshBindings();
    const latest = await this.#request(`/app/devdata/${this.#device.did}/latest`);
    const attributes = latest.attr || {};
    return {
      online: this.#device.is_online !== false,
      transport: "cloud",
      updatedAt: new Date(Number(latest.updated_at) * 1000).toISOString(),
      device: {
        id: this.#device.did,
        name: this.#device.dev_alias || this.#device.product_name || "CleverSpa",
        productKey: this.#device.product_key || CLEVERSPA_PRODUCT_KEY,
      },
      attributes,
    };
  }

  async setAttributes(attributes) {
    if (!this.connected) throw new GizwitsApiError("Gizwits cloud is not connected");
    await this.#request(`/app/control/${this.#device.did}`, {
      method: "POST",
      body: { attrs: attributes },
    });
  }
}
