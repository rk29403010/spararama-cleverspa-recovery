# CleverSpa recovery plan

## Goal

Restore owner-controlled monitoring and heating for a Wi-Fi CleverSpa after the
branded CleverLink service was withdrawn. The first usable client will be a
small, phone-friendly web app that runs on the owner's network.

## Evidence so far

- CleverSpa used Gizwits application ID `805cc6a3f41b48aeae471e2fcb6ebc73`.
- The CleverSpa Firebase project used for branded-app authentication now
  returns `404`, but `api.gizwits.com` still recognizes the application ID.
- Known cloud attributes include `Current_temperature`, `Temperature_setup`,
  `Heater`, `Filter`, `Bubble`, and error/filter counters.
- Gizwits GAgent devices provide a LAN protocol: UDP discovery on port `12414`
  and TCP control on port `12416`.
- The target spa is the V2 blue-display / 365 Freezeguard control-panel model.
- No device on the current LAN answered the read-only GAgent discovery query,
  so the spa has not yet been positively identified online.

## Delivery phases

1. Build a dependency-light Node.js service and installable web UI.
2. Add read-only LAN discovery and cloud account diagnostics.
3. Monitor current water temperature and device/error state.
4. Enable heater control only after fresh status and device identity checks.
5. Add target temperature, filter, and bubbles as optional controls.
6. Add direct LAN control after discovery yields the spa product key and its
   Gizwits datapoint definition.

## Safety contract

- Heater-on always starts filtration first.
- Reject heater-on if status is stale, the spa reports an error, or temperature
  data is implausible.
- Default binding is loopback only. LAN exposure requires an explicit access
  token.
- Credentials and Gizwits tokens stay in memory and are never logged or
  committed.
- Diagnostic/discovery operations are read-only; control must be an explicit
  user action and is disabled until a real device is confirmed.

## Proposed structure

```text
src/
  server.js                 HTTP/API entrypoint
  config.js                 safe runtime configuration
  gizwits/cloud-client.js   surviving Gizwits OpenAPI transport
  gizwits/lan-protocol.js   packet encoding/decoding
  gizwits/lan-discovery.js  read-only UDP discovery
  spa/controller.js         safety policy and normalized spa state
public/                     installable mobile web UI
test/                       Node built-in tests
```

## Current blockers to live verification

- The spa is not currently responding to Gizwits LAN discovery.
- Cloud control needs either the old CleverLink/Gizwits account credentials or
  an existing Gizwits user token, entered locally rather than committed.
