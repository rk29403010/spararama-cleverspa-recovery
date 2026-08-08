import assert from "node:assert/strict";
import test from "node:test";
import { CLEVERSPA_PRODUCT_KEY } from "../src/gizwits/constants.js";
import {
  buildAttributeUpdate,
  buildPacket,
  decodeSpaStatus,
  extractPackets,
  parseDiscoveryPacket,
  parsePacket,
} from "../src/gizwits/lan-protocol.js";

test("builds and parses a Gizwits status request", () => {
  const packet = buildPacket(0x0090, Buffer.from([0x02]));
  assert.equal(packet.toString("hex"), "000000030400009002");
  assert.deepEqual(parsePacket(packet), {
    flag: 0,
    command: 0x0090,
    payload: Buffer.from([0x02]),
  });
});

test("extracts multiple frames while preserving an incomplete remainder", () => {
  const one = buildPacket(0x0015);
  const two = buildPacket(0x0016);
  const input = Buffer.concat([one, two, Buffer.from([0, 0, 0])]);
  const result = extractPackets(input);
  assert.deepEqual(result.packets.map((packet) => packet.command), [0x0015, 0x0016]);
  assert.equal(result.remainder.toString("hex"), "000000");
});

test("parses the standard Gizwits discovery response", () => {
  const field = (value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "ascii");
    const length = Buffer.alloc(2);
    length.writeUInt16BE(bytes.length);
    return Buffer.concat([length, bytes]);
  };
  const payload = Buffer.concat([
    field("abcdefghijklmnopqrstuv"),
    field(Buffer.from("a4e57c123456", "hex")),
    field("04020004"),
    field(CLEVERSPA_PRODUCT_KEY),
  ]);
  const result = parseDiscoveryPacket(buildPacket(0x0004, payload), "192.168.0.123");
  assert.equal(result.ip, "192.168.0.123");
  assert.equal(result.uid, "abcdefghijklmnopqrstuv");
  assert.equal(result.mac, "a4:e5:7c:12:34:56");
  assert.equal(result.productKey, CLEVERSPA_PRODUCT_KEY);
});

test("decodes the recovered CleverSpa datapoint layout", () => {
  const bytes = Buffer.from([0b00000101, 20, 9, 0x00, 0x78, 37, 0x27, 0xd8, 0]);
  assert.deepEqual(decodeSpaStatus(bytes), {
    Heater: true,
    Bubble: false,
    Filter: true,
    O3: false,
    Temperature_setup: 40,
    Check: 9,
    Timing: 120,
    Current_temperature: 37,
    Time_filter: 10200,
    Overtime_filter: false,
    Superheat: false,
    Undercooling: false,
  });
});

test("encodes heater and target-temperature partial updates", () => {
  const heater = buildAttributeUpdate({ Heater: 1 }, 0x1234);
  assert.equal(heater.sequence.toString("hex"), "00001234");
  assert.equal(heater.flags.toString("hex"), "01");
  assert.equal(heater.values.toString("hex"), "0100000000");

  const target = buildAttributeUpdate({ Temperature_setup: 40 }, 0x1235);
  assert.equal(target.flags.toString("hex"), "10");
  assert.equal(target.values.toString("hex"), "0014000000");
});

test("rejects temperatures outside the spa's 20-42 degree range", () => {
  assert.throws(() => buildAttributeUpdate({ Temperature_setup: 43 }), /between 20 and 42/);
});
