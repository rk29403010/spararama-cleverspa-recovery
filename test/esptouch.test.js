import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEsptouchDatagramLengths,
  crc8,
  validateProvisioningInput,
} from "../src/provisioning/esptouch.js";
import { parseWindowsWifiInterfaces } from "../src/provisioning/network-info.js";

const SAMPLE = {
  ssid: "Spa Test",
  password: "password123",
  bssid: "54:af:97:e1:db:f4",
  localAddress: "192.168.0.119",
};

test("uses the ESPTouch CRC-8/MAXIM checksum", () => {
  assert.equal(crc8(Buffer.from("123456789")), 0xa1);
});

test("builds legacy ESPTouch guide and datum packet lengths", () => {
  const result = buildEsptouchDatagramLengths(SAMPLE);
  assert.deepEqual(result.guide, [515, 514, 513, 512]);
  assert.equal(result.expectedResultLength, 28);
  assert.equal(result.data.length, (5 + 4 + 6 + 11 + 8) * 3);
  assert.ok(result.data.every((length) => length >= 40 && length <= 679));
  // The sixth triplet is BSSID byte 0 at sequence totalLength (296 + 28),
  // matching the raw-BSSID interleaving embedded in CleverLink 2.12.
  assert.deepEqual(result.data.slice(0, 18), [
    201, 296, 68,
    152, 297, 259,
    219, 298, 83,
    164, 299, 131,
    64, 300, 219,
    157, 324, 76,
  ]);
});

test("rejects invalid legacy Wi-Fi credentials before transmission", () => {
  assert.throws(
    () => validateProvisioningInput({ ...SAMPLE, password: "short" }),
    /8 to 63 bytes/,
  );
  assert.throws(
    () => validateProvisioningInput({ ...SAMPLE, bssid: "not-a-mac" }),
    /valid access-point BSSID/,
  );
});

test("parses the connected Windows Wi-Fi interface", () => {
  const output = `
    Name                   : WiFi
    State                  : connected
    SSID                   : Spa Test
    AP BSSID               : 54:AF:97:E1:DB:F4
    Band                   : 2.4 GHz
    Channel                : 4
  `;
  const [network] = parseWindowsWifiInterfaces(output);
  assert.equal(network.interfaceName, "WiFi");
  assert.equal(network.ssid, "Spa Test");
  assert.equal(network.bssid, "54:af:97:e1:db:f4");
  assert.equal(network.is24Ghz, true);
});
