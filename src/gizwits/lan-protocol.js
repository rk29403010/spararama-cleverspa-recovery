import { CLEVERSPA_MODEL, CLEVERSPA_STATUS_LENGTH } from "./cleverspa-model.js";

const PREFIX = Buffer.from([0, 0, 0, 3]);

export function encodeVariableLength(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("length must be a non-negative safe integer");
  }
  const bytes = [];
  do {
    let next = value & 0x7f;
    value >>= 7;
    if (value > 0) next |= 0x80;
    bytes.push(next);
  } while (value > 0);
  return Buffer.from(bytes);
}

export function decodeVariableLength(buffer, offset = 0) {
  let value = 0;
  let shift = 0;
  let index = offset;
  while (index < buffer.length) {
    const byte = buffer[index++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, nextOffset: index };
    shift += 7;
    if (shift > 28) throw new Error("Gizwits variable length is too large");
  }
  return null;
}

export function buildPacket(command, payload = Buffer.alloc(0), flag = 0) {
  const commandBytes = Buffer.alloc(2);
  commandBytes.writeUInt16BE(command);
  const bodyLength = 1 + commandBytes.length + payload.length;
  return Buffer.concat([
    PREFIX,
    encodeVariableLength(bodyLength),
    Buffer.from([flag]),
    commandBytes,
    payload,
  ]);
}

export function parsePacket(packet) {
  if (packet.length < 8 || !packet.subarray(0, 4).equals(PREFIX)) {
    throw new Error("invalid Gizwits packet prefix");
  }
  const decoded = decodeVariableLength(packet, 4);
  if (!decoded) throw new Error("incomplete Gizwits packet length");
  const end = decoded.nextOffset + decoded.value;
  if (packet.length !== end) throw new Error("Gizwits packet length mismatch");
  const flag = packet[decoded.nextOffset];
  const command = packet.readUInt16BE(decoded.nextOffset + 1);
  return {
    flag,
    command,
    payload: packet.subarray(decoded.nextOffset + 3),
  };
}

export function extractPackets(input) {
  const packets = [];
  let buffer = input;
  while (buffer.length >= 5) {
    if (!buffer.subarray(0, 4).equals(PREFIX)) {
      throw new Error("invalid Gizwits stream prefix");
    }
    const decoded = decodeVariableLength(buffer, 4);
    if (!decoded) break;
    const totalLength = decoded.nextOffset + decoded.value;
    if (buffer.length < totalLength) break;
    packets.push(parsePacket(buffer.subarray(0, totalLength)));
    buffer = buffer.subarray(totalLength);
  }
  return { packets, remainder: Buffer.from(buffer) };
}

function readLengthField(buffer, offset) {
  if (offset + 2 > buffer.length) throw new Error("truncated discovery field");
  const length = buffer.readUInt16BE(offset);
  const start = offset + 2;
  const end = start + length;
  if (end > buffer.length) throw new Error("truncated discovery value");
  return { value: buffer.subarray(start, end), nextOffset: end };
}

export function parseDiscoveryPacket(packet, ip = "") {
  const parsed = parsePacket(packet);
  if (parsed.command !== 0x0004) {
    throw new Error(`unexpected discovery command 0x${parsed.command.toString(16)}`);
  }
  let offset = 0;
  const uid = readLengthField(parsed.payload, offset);
  offset = uid.nextOffset;
  const mac = readLengthField(parsed.payload, offset);
  offset = mac.nextOffset;
  const firmware = readLengthField(parsed.payload, offset);
  offset = firmware.nextOffset;
  const productKey = readLengthField(parsed.payload, offset);
  return {
    ip,
    uid: uid.value.toString("ascii"),
    mac: [...mac.value].map((byte) => byte.toString(16).padStart(2, "0")).join(":"),
    firmwareVersion: firmware.value.toString("ascii"),
    productKey: productKey.value.toString("ascii"),
  };
}

function decodeNumber(attribute, bytes) {
  const raw = attribute.dataType === "uint16"
    ? bytes.readUInt16BE(attribute.byteOffset)
    : bytes[attribute.byteOffset];
  return raw * (attribute.ratio ?? 1) + (attribute.addition ?? 0);
}

export function decodeSpaStatus(bytes) {
  if (bytes.length < CLEVERSPA_STATUS_LENGTH) {
    throw new Error(`CleverSpa status requires ${CLEVERSPA_STATUS_LENGTH} bytes`);
  }
  const state = {};
  for (const attribute of CLEVERSPA_MODEL.attributes) {
    if (attribute.dataType === "bool") {
      state[attribute.name] =
        ((bytes[attribute.byteOffset] >> attribute.bitOffset) & 1) === 1;
    } else {
      state[attribute.name] = decodeNumber(attribute, bytes);
    }
  }
  return state;
}

export function parseStatusPayload(payload) {
  if (payload.length < CLEVERSPA_STATUS_LENGTH + 1) {
    throw new Error("truncated CleverSpa status payload");
  }
  const actionOffset = payload.length - CLEVERSPA_STATUS_LENGTH - 1;
  const action = payload[actionOffset];
  if (action !== 0x03 && action !== 0x04) {
    throw new Error(`unexpected CleverSpa status action 0x${action.toString(16)}`);
  }
  return decodeSpaStatus(payload.subarray(-CLEVERSPA_STATUS_LENGTH));
}

function encodeWireNumber(attribute, value) {
  if (!Number.isFinite(value)) throw new TypeError(`${attribute.name} must be numeric`);
  if (value < attribute.minimum || value > attribute.maximum) {
    throw new RangeError(
      `${attribute.name} must be between ${attribute.minimum} and ${attribute.maximum}`,
    );
  }
  const raw = (value - (attribute.addition ?? 0)) / (attribute.ratio ?? 1);
  if (!Number.isInteger(raw)) throw new RangeError(`${attribute.name} is off step`);
  return raw;
}

export function buildAttributeUpdate(updates, sequence = Math.floor(Date.now() / 1000) & 0xffff) {
  const writable = CLEVERSPA_MODEL.attributes.filter(
    (attribute) => attribute.type === "status_writable",
  );
  const byName = new Map(writable.map((attribute) => [attribute.name, attribute]));
  const flags = Buffer.alloc(Math.floor(Math.max(...writable.map((a) => a.id)) / 8) + 1);
  const valuesLength = Math.max(
    ...writable.map((attribute) => attribute.byteOffset + (attribute.unit === "byte" ? attribute.length : 1)),
  );
  const values = Buffer.alloc(valuesLength);

  for (const [name, value] of Object.entries(updates)) {
    const attribute = byName.get(name);
    if (!attribute) throw new Error(`${name} is not a writable CleverSpa attribute`);
    const byteIndex = Math.floor(attribute.id / 8);
    const flagIndex = flags.length - 1 - byteIndex;
    flags[flagIndex] |= 1 << (attribute.id % 8);
    if (attribute.dataType === "bool") {
      if (Boolean(value)) values[attribute.byteOffset] |= 1 << attribute.bitOffset;
    } else {
      const raw = encodeWireNumber(attribute, Number(value));
      if (attribute.dataType === "uint16") values.writeUInt16BE(raw, attribute.byteOffset);
      else values[attribute.byteOffset] = raw;
    }
  }

  const sequenceBytes = Buffer.alloc(4);
  sequenceBytes.writeUInt32BE(sequence >>> 0);
  const payload = Buffer.concat([sequenceBytes, Buffer.from([0x01]), flags, values]);
  return { sequence: sequenceBytes, payload, packet: buildPacket(0x0093, payload), flags, values };
}
