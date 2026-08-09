import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WifiCredentialStore } from "../src/credentials/wifi-credential-store.js";

test("stores a protected Wi-Fi password without plaintext and can clear it", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "spararama-credential-test-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "wifi.json");
  const store = new WifiCredentialStore({
    filePath,
    protect: async (password) => Buffer.from(`protected:${password}`).toString("base64"),
    unprotect: async (value) => Buffer.from(value, "base64").toString("utf8").slice(10),
  });

  assert.equal(await store.has("Spa WiFi"), false);
  await store.save("Spa WiFi", "correct horse battery staple");
  assert.equal(await store.has("Spa WiFi"), true);
  assert.equal(await store.has("Another network"), false);
  assert.equal(await store.load("Spa WiFi"), "correct horse battery staple");
  assert.equal(await store.load("Another network"), null);

  let persisted = await fs.readFile(filePath, "utf8");
  assert.doesNotMatch(persisted, /correct horse battery staple/);

  await store.save("Spa WiFi", "replacement password");
  assert.equal(await store.load("Spa WiFi"), "replacement password");
  persisted = await fs.readFile(filePath, "utf8");
  assert.doesNotMatch(persisted, /replacement password/);

  assert.equal(await store.clear("Another network"), false);
  assert.equal(await store.clear("Spa WiFi"), true);
  assert.equal(await store.has("Spa WiFi"), false);
});
