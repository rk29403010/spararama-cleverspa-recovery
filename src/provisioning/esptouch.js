import dgram from "node:dgram";

const GUIDE_LENGTHS = Object.freeze([515, 514, 513, 512]);
const RESULT_PORT = 18266;
const TARGET_PORT = 7001;
const PACKET_INTERVAL_MS = 8;
const GUIDE_WINDOW_MS = 2000;
const DATA_WINDOW_MS = 4000;

export class EspTouchError extends Error {
  constructor(message, { code = "esptouch_error", statusCode = 500 } = {}) {
    super(message);
    this.name = "EspTouchError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function crc8(data) {
  let value = 0;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? (value >>> 1) ^ 0x8c : value >>> 1;
    }
  }
  return value & 0xff;
}

function parseBssid(value) {
  const compact = String(value).replace(/[:-]/g, "").toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(compact)) {
    throw new EspTouchError("A valid access-point BSSID is required", {
      code: "invalid_bssid",
      statusCode: 400,
    });
  }
  return Buffer.from(compact, "hex");
}

function parseIpv4(value) {
  const parts = String(value).split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new EspTouchError("The selected Wi-Fi adapter has no usable IPv4 address", {
      code: "invalid_local_address",
      statusCode: 400,
    });
  }
  return Buffer.from(parts);
}

function dataCode(value, sequence) {
  if (sequence < 0 || sequence > 127) {
    throw new EspTouchError("The Wi-Fi credentials are too long for this legacy spa");
  }
  const checksum = crc8(Buffer.from([value, sequence]));
  return [
    ((checksum >>> 4) << 4) | (value >>> 4),
    0x100 | sequence,
    ((checksum & 0x0f) << 4) | (value & 0x0f),
  ].map((encoded) => encoded + 40);
}

export function validateProvisioningInput({ ssid, password, bssid, localAddress }) {
  const ssidBytes = Buffer.from(String(ssid || ""), "utf8");
  const passwordBytes = Buffer.from(String(password ?? ""), "utf8");
  if (ssidBytes.length < 1 || ssidBytes.length > 32) {
    throw new EspTouchError("Wi-Fi name must contain 1 to 32 bytes", {
      code: "invalid_ssid",
      statusCode: 400,
    });
  }
  if (passwordBytes.length !== 0 && (passwordBytes.length < 8 || passwordBytes.length > 63)) {
    passwordBytes.fill(0);
    throw new EspTouchError("Wi-Fi password must contain 8 to 63 bytes", {
      code: "invalid_password",
      statusCode: 400,
    });
  }
  return {
    ssidBytes,
    passwordBytes,
    bssidBytes: parseBssid(bssid),
    localAddressBytes: parseIpv4(localAddress),
  };
}

export function buildEsptouchDatagramLengths(input) {
  const { ssidBytes, passwordBytes, bssidBytes, localAddressBytes } = validateProvisioningInput(input);
  try {
    const totalLength = localAddressBytes.length + 5 + passwordBytes.length + ssidBytes.length;
    let totalXor = totalLength ^ passwordBytes.length ^ crc8(ssidBytes) ^ crc8(bssidBytes);
    const codes = [
      dataCode(totalLength, 0),
      dataCode(passwordBytes.length, 1),
      dataCode(crc8(ssidBytes), 2),
      dataCode(crc8(bssidBytes), 3),
    ];

    for (const [index, value] of localAddressBytes.entries()) {
      totalXor ^= value;
      codes.push(dataCode(value, index + 5));
    }
    for (const [index, value] of passwordBytes.entries()) {
      totalXor ^= value;
      codes.push(dataCode(value, index + 9));
    }
    for (const [index, value] of ssidBytes.entries()) {
      totalXor ^= value;
      codes.push(dataCode(value, index + 9 + passwordBytes.length));
    }
    codes.splice(4, 0, dataCode(totalXor, 4));

    let insertionIndex = 5;
    for (const [index, value] of bssidBytes.entries()) {
      codes.splice(insertionIndex, 0, dataCode(value, totalLength + index));
      insertionIndex += 4;
    }

    return {
      guide: [...GUIDE_LENGTHS],
      data: codes.flat(),
      expectedResultLength: ssidBytes.length + passwordBytes.length + 9,
    };
  } finally {
    passwordBytes.fill(0);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function bind(socket, port, address) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    socket.once("error", onError);
    socket.bind(port, address, () => {
      socket.off("error", onError);
      resolve();
    });
  });
}

function send(socket, packet, port, address) {
  return new Promise((resolve, reject) => {
    socket.send(packet, port, address, (error) => error ? reject(error) : resolve());
  });
}

function formatMac(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(":");
}

function multicastTarget(counter) {
  const octet = (counter % 100) + 1;
  return `234.${octet}.${octet}.${octet}`;
}

let provisioningActive = false;

export async function provisionEspTouch(input, { timeoutMs = 60_000 } = {}) {
  if (provisioningActive) {
    throw new EspTouchError("A Wi-Fi provisioning attempt is already running", {
      code: "provisioning_busy",
      statusCode: 409,
    });
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 90_000) {
    throw new EspTouchError("Provisioning timeout must be between 10 and 90 seconds", {
      code: "invalid_timeout",
      statusCode: 400,
    });
  }

  const encoded = buildEsptouchDatagramLengths(input);
  input.password = "";
  const guidePackets = encoded.guide.map((length) => Buffer.alloc(length, 1));
  const dataPackets = encoded.data.map((length) => Buffer.alloc(length, 1));
  const receiver = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const sender = dgram.createSocket("udp4");
  let result = null;
  let socketError = null;
  provisioningActive = true;

  receiver.on("error", (error) => { socketError = error; });
  sender.on("error", (error) => { socketError = error; });
  receiver.on("message", (message) => {
    if (message.length < 11 || message[0] !== (encoded.expectedResultLength & 0xff)) return;
    result = {
      mac: formatMac(message.subarray(1, 7)),
      ip: [...message.subarray(7, 11)].join("."),
    };
  });

  try {
    await bind(receiver, RESULT_PORT, "0.0.0.0");
    await bind(sender, 0, input.localAddress);
    sender.setMulticastInterface(input.localAddress);
    sender.setMulticastTTL(1);
    sender.setMulticastLoopback(false);
    const deadline = Date.now() + timeoutMs;
    let dataOffset = 0;
    let targetCounter = 0;

    while (!result && Date.now() < deadline) {
      if (socketError) throw socketError;
      const guideDeadline = Math.min(deadline, Date.now() + GUIDE_WINDOW_MS);
      while (!result && Date.now() < guideDeadline) {
        if (socketError) throw socketError;
        const target = multicastTarget(targetCounter);
        targetCounter += 1;
        for (const packet of guidePackets) {
          await send(sender, packet, TARGET_PORT, target);
          await delay(PACKET_INTERVAL_MS);
        }
      }

      const dataDeadline = Math.min(deadline, Date.now() + DATA_WINDOW_MS);
      while (!result && Date.now() < dataDeadline) {
        if (socketError) throw socketError;
        const target = multicastTarget(targetCounter);
        targetCounter += 1;
        for (let count = 0; count < 3; count += 1) {
          const packet = dataPackets[dataOffset];
          dataOffset = (dataOffset + 1) % dataPackets.length;
          await send(sender, packet, TARGET_PORT, target);
          await delay(PACKET_INTERVAL_MS);
        }
      }
    }

    if (!result) {
      throw new EspTouchError(
        "The spa did not acknowledge Wi-Fi provisioning within 60 seconds",
        { code: "provisioning_timeout", statusCode: 504 },
      );
    }
    return result;
  } catch (error) {
    if (error instanceof EspTouchError) throw error;
    throw new EspTouchError(`Wi-Fi provisioning failed: ${error.message}`, {
      code: error.code || "provisioning_failed",
    });
  } finally {
    provisioningActive = false;
    for (const socket of [receiver, sender]) {
      try { socket.close(); }
      catch { /* The socket may have failed before it was bound. */ }
    }
  }
}
