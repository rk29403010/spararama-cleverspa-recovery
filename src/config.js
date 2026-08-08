import os from "node:os";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function parsePort(raw) {
  const port = Number.parseInt(raw ?? "8787", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("CLEVERSPA_PORT must be an integer between 1 and 65535");
  }
  return port;
}

function parseBoolean(raw) {
  return /^(1|true|yes)$/i.test(raw ?? "");
}

const host = process.env.CLEVERSPA_HOST || "127.0.0.1";
const accessToken = process.env.CLEVERSPA_ACCESS_TOKEN || "";
const loopbackOnly = LOOPBACK_HOSTS.has(host);

if (!loopbackOnly && accessToken.length < 20) {
  throw new Error(
    "LAN binding requires CLEVERSPA_ACCESS_TOKEN with at least 20 characters",
  );
}

export const config = Object.freeze({
  host,
  port: parsePort(process.env.CLEVERSPA_PORT),
  accessToken,
  loopbackOnly,
  spaIp: process.env.CLEVERSPA_IP || "",
  spaPasscode: process.env.CLEVERSPA_PASSCODE || "",
  allowLanCredentialLogin: parseBoolean(
    process.env.CLEVERSPA_ALLOW_LAN_CREDENTIAL_LOGIN,
  ),
  hostname: os.hostname(),
});

export function isLoopbackAddress(address = "") {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}
