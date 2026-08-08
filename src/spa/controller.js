import { CLEVERSPA_PRODUCT_KEY } from "../gizwits/constants.js";
import { GizwitsCloudClient } from "../gizwits/cloud-client.js";
import { discoverGizwitsDevices } from "../gizwits/lan-discovery.js";
import { GizwitsLanClient } from "../gizwits/lan-client.js";

const MAX_CLOUD_STATUS_AGE_MS = 1_000_000;
const FILTER_COOLDOWN_MS = 30_000;

export class SpaControlError extends Error {
  constructor(message, { code = "control_blocked", statusCode = 409 } = {}) {
    super(message);
    this.name = "SpaControlError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function asBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function normalizeState(raw) {
  const attributes = raw.attributes || {};
  const updatedAt = raw.updatedAt || new Date(0).toISOString();
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const alerts = {
    filterOverdue: asBoolean(attributes.Overtime_filter),
    superheat: asBoolean(attributes.Superheat),
    undercooling: asBoolean(attributes.Undercooling),
  };
  const currentTemperature = Number(attributes.Current_temperature);
  const targetTemperature = Number(attributes.Temperature_setup);
  const blockedReasons = [];
  if (!raw.online) blockedReasons.push("The spa reports that it is offline");
  if (!Number.isFinite(ageMs) || ageMs < -60_000 || ageMs > MAX_CLOUD_STATUS_AGE_MS) {
    blockedReasons.push("The most recent spa status is stale");
  }
  if (!Number.isFinite(currentTemperature) || currentTemperature < 1 || currentTemperature > 45) {
    blockedReasons.push("The water-temperature reading is implausible");
  }
  if (alerts.superheat) blockedReasons.push("The spa reports an overheat condition");
  if (alerts.undercooling) blockedReasons.push("The spa reports an undercooling/sensor condition");
  if (alerts.filterOverdue) blockedReasons.push("The spa says the filter is overdue for replacement");

  return {
    connected: Boolean(raw.online),
    transport: raw.transport,
    updatedAt,
    device: raw.device,
    currentTemperature,
    targetTemperature,
    heater: asBoolean(attributes.Heater),
    filter: asBoolean(attributes.Filter),
    bubbles: asBoolean(attributes.Bubble),
    ozone: asBoolean(attributes.O3),
    filterMinutes: Number(attributes.Time_filter),
    alerts,
    controllable: blockedReasons.length === 0,
    blockedReasons,
  };
}

export class SpaController {
  #transport = null;
  #lastStatus = null;
  #heaterObservedOffSince = null;
  #operation = Promise.resolve();

  constructor({ cloudClient = new GizwitsCloudClient(), discover = discoverGizwitsDevices } = {}) {
    this.cloudClient = cloudClient;
    this.discoverDevices = discover;
    this.diagnostics = {
      lastDiscoveryAt: null,
      discoveredDevices: [],
      lastError: null,
    };
  }

  async connectCloud(username, password) {
    const result = await this.cloudClient.login(username, password);
    this.#replaceTransport(this.cloudClient);
    return result;
  }

  async connectCloudToken(token) {
    const result = await this.cloudClient.useToken(token);
    this.#replaceTransport(this.cloudClient);
    return result;
  }

  async connectLan(ip, passcode = "", device = {}) {
    const client = new GizwitsLanClient({
      ip,
      passcode,
      device: { ...device, productKey: device.productKey || CLEVERSPA_PRODUCT_KEY },
    });
    await client.connect();
    this.#replaceTransport(client);
    return this.status({ refresh: true });
  }

  #replaceTransport(next) {
    if (this.#transport && this.#transport !== next && typeof this.#transport.close === "function") {
      this.#transport.close();
    }
    this.#transport = next;
    this.#lastStatus = null;
    this.#heaterObservedOffSince = null;
  }

  async discover(options = {}) {
    const devices = await this.discoverDevices(options);
    this.diagnostics.lastDiscoveryAt = new Date().toISOString();
    this.diagnostics.discoveredDevices = devices;
    const spa = devices.find((device) => device.productKey === CLEVERSPA_PRODUCT_KEY);
    if (spa) {
      try {
        // An existing cloud binding often contains the LAN passcode, avoiding
        // the need to put the physical panel back into its binding window.
        const recoveredPasscode = this.cloudClient.device?.passcode || "";
        await this.connectLan(spa.ip, recoveredPasscode, spa);
      } catch (error) {
        this.diagnostics.lastError = error.message;
      }
    }
    return { devices, spaFound: Boolean(spa), status: await this.status() };
  }

  #observeStatus(status) {
    this.#lastStatus = status;
    if (status.heater) this.#heaterObservedOffSince = null;
    else if (this.#heaterObservedOffSince === null) this.#heaterObservedOffSince = Date.now();
  }

  async status({ refresh = true } = {}) {
    if (!this.#transport) {
      return {
        connected: false,
        transport: null,
        controllable: false,
        blockedReasons: ["No CleverSpa has been connected yet"],
        diagnostics: this.diagnostics,
      };
    }
    try {
      if (refresh || !this.#lastStatus) {
        const status = normalizeState(await this.#transport.getState());
        this.#observeStatus(status);
      }
      return { ...this.#lastStatus, diagnostics: this.diagnostics };
    } catch (error) {
      this.diagnostics.lastError = error.message;
      return {
        connected: false,
        transport: this.#lastStatus?.transport || null,
        controllable: false,
        blockedReasons: [error.message],
        diagnostics: this.diagnostics,
      };
    }
  }

  #serialized(action) {
    const result = this.#operation.then(action, action);
    this.#operation = result.catch(() => {});
    return result;
  }

  async #requireSafeState() {
    if (!this.#transport) throw new SpaControlError("No spa is connected");
    const state = normalizeState(await this.#transport.getState());
    this.#observeStatus(state);
    if (!state.controllable) {
      throw new SpaControlError(state.blockedReasons.join("; "));
    }
    return state;
  }

  async #waitFor(attribute, expected, attempts = 8) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const state = normalizeState(await this.#transport.getState());
      this.#observeStatus(state);
      if (state[attribute] === expected) return state;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    throw new SpaControlError(`The spa did not confirm ${attribute}=${expected}`, {
      code: "confirmation_timeout",
    });
  }

  controlHeater(enabled) {
    return this.#serialized(async () => {
      const state = await this.#requireSafeState();
      if (enabled) {
        if (!state.filter) {
          await this.#transport.setAttributes({ Filter: 1 });
          await this.#waitFor("filter", true);
        }
        await this.#transport.setAttributes({ Heater: 1 });
        return this.#waitFor("heater", true);
      }
      await this.#transport.setAttributes({ Heater: 0 });
      const result = await this.#waitFor("heater", false);
      this.#heaterObservedOffSince = Date.now();
      return result;
    });
  }

  controlFilter(enabled) {
    return this.#serialized(async () => {
      const state = await this.#requireSafeState();
      if (!enabled) {
        if (state.heater) {
          throw new SpaControlError("Turn the heater off before stopping filtration");
        }
        const offFor = Date.now() - (this.#heaterObservedOffSince ?? Date.now());
        if (offFor < FILTER_COOLDOWN_MS) {
          throw new SpaControlError(
            `Filtration must cool the heater for another ${Math.ceil((FILTER_COOLDOWN_MS - offFor) / 1000)} seconds`,
          );
        }
      }
      await this.#transport.setAttributes({ Filter: enabled ? 1 : 0 });
      return this.#waitFor("filter", enabled);
    });
  }

  controlBubbles(enabled) {
    return this.#serialized(async () => {
      await this.#requireSafeState();
      await this.#transport.setAttributes({ Bubble: enabled ? 1 : 0 });
      return this.#waitFor("bubbles", enabled);
    });
  }

  setTargetTemperature(temperature) {
    return this.#serialized(async () => {
      await this.#requireSafeState();
      if (!Number.isInteger(temperature) || temperature < 20 || temperature > 42) {
        throw new SpaControlError("Target temperature must be a whole number from 20 to 42 °C", {
          code: "invalid_temperature",
          statusCode: 400,
        });
      }
      await this.#transport.setAttributes({ Temperature_setup: temperature });
      return this.#waitFor("targetTemperature", temperature);
    });
  }
}
