import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function privateIpv4Address(interfaceName = "") {
  const interfaces = os.networkInterfaces();
  const preferred = interfaces[interfaceName] || [];
  const candidates = [
    ...preferred,
    ...Object.entries(interfaces)
      .filter(([name]) => name !== interfaceName)
      .flatMap(([, addresses]) => addresses || []),
  ];
  return candidates.find((address) => {
    if (address.family !== "IPv4" || address.internal) return false;
    return (
      address.address.startsWith("10.") ||
      address.address.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(address.address)
    );
  })?.address || "";
}

function match(output, expression) {
  return output.match(expression)?.[1]?.trim() || "";
}

export function parseWindowsWifiInterfaces(output) {
  const blocks = output
    .split(/(?=^\s*Name\s*:)/gim)
    .filter((block) => /^\s*Name\s*:/im.test(block));

  return blocks.map((block) => {
    const interfaceName = match(block, /^\s*Name\s*:\s*(.+)$/im);
    const band = match(block, /^\s*Band\s*:\s*(.+)$/im);
    return {
      interfaceName,
      state: match(block, /^\s*State\s*:\s*(.+)$/im).toLowerCase(),
      ssid: match(block, /^\s*SSID\s*:\s*(.+)$/im),
      bssid: match(block, /^\s*(?:AP\s+)?BSSID\s*:\s*([0-9a-f:-]{17})\s*$/im).toLowerCase(),
      band,
      channel: match(block, /^\s*Channel\s*:\s*(.+)$/im),
      localAddress: privateIpv4Address(interfaceName),
      is24Ghz: /2[.]4\s*ghz/i.test(band),
    };
  });
}

export async function getCurrentWifiNetwork() {
  if (process.platform !== "win32") {
    return {
      interfaceName: "",
      state: "unknown",
      ssid: "",
      bssid: "",
      band: "",
      channel: "",
      localAddress: privateIpv4Address(),
      is24Ghz: null,
    };
  }

  const { stdout } = await execFileAsync("netsh.exe", ["wlan", "show", "interfaces"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
  });
  return parseWindowsWifiInterfaces(stdout).find((network) => network.state === "connected") || {
    interfaceName: "",
    state: "disconnected",
    ssid: "",
    bssid: "",
    band: "",
    channel: "",
    localAddress: privateIpv4Address(),
    is24Ghz: null,
  };
}
