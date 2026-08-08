import net from "node:net";
import { EventEmitter } from "node:events";
import { GIZWITS_CONTROL_PORT } from "./constants.js";
import {
  buildAttributeUpdate,
  buildPacket,
  extractPackets,
  parseStatusPayload,
} from "./lan-protocol.js";

export class GizwitsLanError extends Error {
  constructor(message, code = "lan_error") {
    super(message);
    this.name = "GizwitsLanError";
    this.code = code;
  }
}

export class GizwitsLanClient extends EventEmitter {
  #socket = null;
  #buffer = Buffer.alloc(0);
  #waiters = new Map();
  #heartbeat = null;
  #passcode = null;
  #connected = false;
  #currentAttributes = null;

  constructor({ ip, port = GIZWITS_CONTROL_PORT, passcode = "", timeoutMs = 5000, device = {} }) {
    super();
    if (!ip) throw new Error("a spa IP address is required");
    this.ip = ip;
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.device = device;
    this.#passcode = passcode ? Buffer.from(passcode, "utf8") : null;
  }

  get connected() {
    return this.#connected && this.#socket && !this.#socket.destroyed;
  }

  get hasPasscode() {
    return Boolean(this.#passcode?.length);
  }

  async connect() {
    if (this.connected) return;
    await this.#openSocket();
    try {
      if (!this.#passcode) {
        const response = await this.#request(0x0006, 0x0007);
        if (response.length < 2) {
          throw new GizwitsLanError("The spa returned an invalid passcode response", "passcode_invalid");
        }
        const length = response.readUInt16BE(0);
        if (length === 0) {
          throw new GizwitsLanError(
            "The spa is not in its local binding window; hold its Wi-Fi button until it beeps and retry",
            "binding_required",
          );
        }
        this.#passcode = Buffer.from(response.subarray(2, 2 + length));
      }

      const length = Buffer.alloc(2);
      length.writeUInt16BE(this.#passcode.length);
      const login = await this.#request(
        0x0008,
        0x0009,
        Buffer.concat([length, this.#passcode]),
      );
      if (!login.length || login[0] !== 0) {
        throw new GizwitsLanError(
          `The spa rejected the local login${login.length ? ` (code ${login[0]})` : ""}`,
          "login_failed",
        );
      }
      this.#connected = true;
      this.#heartbeat = setInterval(() => {
        if (this.connected) this.#socket.write(buildPacket(0x0015));
      }, 4000);
      this.#heartbeat.unref();
      await this.getState();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  async #openSocket() {
    this.#socket = new net.Socket();
    this.#socket.setNoDelay(true);
    this.#socket.on("data", (chunk) => this.#onData(chunk));
    this.#socket.on("error", (error) => this.#failAll(error));
    this.#socket.on("close", () => {
      this.#connected = false;
      this.emit("disconnected");
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#socket.destroy();
        reject(new GizwitsLanError(`Timed out connecting to ${this.ip}:${this.port}`, "connect_timeout"));
      }, this.timeoutMs);
      const onError = (error) => {
        clearTimeout(timer);
        reject(new GizwitsLanError(`Cannot connect to ${this.ip}:${this.port}: ${error.message}`, "connect_failed"));
      };
      this.#socket.once("error", onError);
      this.#socket.connect(this.port, this.ip, () => {
        clearTimeout(timer);
        this.#socket.off("error", onError);
        resolve();
      });
    });
  }

  #onData(chunk) {
    try {
      const extracted = extractPackets(Buffer.concat([this.#buffer, chunk]));
      this.#buffer = extracted.remainder;
      for (const packet of extracted.packets) {
        if (packet.command === 0x0091 || packet.command === 0x0093) {
          try {
            this.#currentAttributes = parseStatusPayload(packet.payload);
            this.emit("status", this.#currentAttributes);
          } catch {
            // A solicited waiter still receives the raw payload below.
          }
        }
        const queue = this.#waiters.get(packet.command);
        const waiter = queue?.shift();
        if (waiter) {
          clearTimeout(waiter.timer);
          waiter.resolve(packet.payload);
          if (queue.length === 0) this.#waiters.delete(packet.command);
        }
      }
    } catch (error) {
      this.#socket?.destroy(error);
    }
  }

  #failAll(error) {
    for (const queue of this.#waiters.values()) {
      for (const waiter of queue) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
    this.#waiters.clear();
  }

  async #request(sendCommand, receiveCommand, payload = Buffer.alloc(0)) {
    if (!this.#socket || this.#socket.destroyed) {
      throw new GizwitsLanError("The local spa socket is not connected", "not_connected");
    }
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const queue = this.#waiters.get(receiveCommand) || [];
        this.#waiters.set(receiveCommand, queue.filter((item) => item.resolve !== resolve));
        reject(
          new GizwitsLanError(
            `No response to Gizwits command 0x${sendCommand.toString(16)}`,
            "response_timeout",
          ),
        );
      }, this.timeoutMs);
      const queue = this.#waiters.get(receiveCommand) || [];
      queue.push({ resolve, reject, timer });
      this.#waiters.set(receiveCommand, queue);
    });
    this.#socket.write(buildPacket(sendCommand, payload));
    return response;
  }

  async getState() {
    if (!this.connected) {
      if (this.#socket && !this.#socket.destroyed) {
        // connect() performs its first status request after login.
      } else {
        await this.connect();
        if (this.#currentAttributes) return this.#formatState();
      }
    }
    const payload = await this.#request(0x0090, 0x0091, Buffer.from([0x02]));
    this.#currentAttributes = parseStatusPayload(payload);
    return this.#formatState();
  }

  #formatState() {
    return {
      online: true,
      transport: "lan",
      updatedAt: new Date().toISOString(),
      device: {
        id: this.device.uid || this.ip,
        name: "CleverSpa",
        ip: this.ip,
        mac: this.device.mac,
        productKey: this.device.productKey,
        firmwareVersion: this.device.firmwareVersion,
      },
      attributes: { ...this.#currentAttributes },
    };
  }

  async setAttributes(attributes) {
    if (!this.connected) await this.connect();
    const update = buildAttributeUpdate(attributes);
    const acknowledgement = await this.#request(0x0093, 0x0094, update.payload);
    if (acknowledgement.length >= 4 && !acknowledgement.subarray(0, 4).equals(update.sequence)) {
      throw new GizwitsLanError("The spa acknowledged a different control sequence", "ack_mismatch");
    }
    return this.getState();
  }

  close() {
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    this.#heartbeat = null;
    this.#connected = false;
    this.#failAll(new GizwitsLanError("The local spa connection closed", "connection_closed"));
    this.#socket?.destroy();
    this.#socket = null;
    this.#buffer = Buffer.alloc(0);
  }
}
