import dgram from "node:dgram";
import {
  CLEVERSPA_PRODUCT_KEY,
  GIZWITS_DISCOVERY_PORT,
  GIZWITS_DISCOVERY_REQUEST,
} from "./constants.js";
import { parseDiscoveryPacket } from "./lan-protocol.js";

export function discoverGizwitsDevices({ timeoutMs = 3500, target = "255.255.255.255" } = {}) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const devices = new Map();
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve([...devices.values()]);
    };

    const timer = setTimeout(() => finish(), timeoutMs);
    socket.on("error", finish);
    socket.on("message", (message, remote) => {
      try {
        const device = parseDiscoveryPacket(message, remote.address);
        devices.set(remote.address, {
          ...device,
          isCleverSpa: device.productKey === CLEVERSPA_PRODUCT_KEY,
        });
      } catch {
        // Other UDP traffic on the port is irrelevant to Gizwits discovery.
      }
    });
    socket.bind(0, "0.0.0.0", () => {
      socket.setBroadcast(true);
      for (const delay of [0, 300, 700]) {
        setTimeout(() => {
          if (!settled) {
            socket.send(GIZWITS_DISCOVERY_REQUEST, GIZWITS_DISCOVERY_PORT, target);
          }
        }, delay);
      }
    });
  });
}
