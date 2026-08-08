# Spararama CleverSpa recovery bridge

This project restores monitoring and control for a Wi-Fi CleverSpa whose
CleverLink app backend has disappeared. It is a local-first Node.js web app,
designed to run on a PC or small always-on computer on the same network as the
spa. The current target is the V2 blue-display / 365 Freezeguard control panel.

The project is deliberately conservative around heating:

- filtration is started and confirmed before the heater is enabled;
- current status, water temperature, and fault flags are checked first;
- filtration cannot be stopped while heating or during a 30-second cooldown;
- the server listens on this PC only unless LAN access and an access token are
  explicitly configured.

## What was recovered

Static analysis of the old CleverLink Android app and its public integrations
identified the underlying Gizwits GAgent platform. The surviving Gizwits
datapoint endpoint returned the exact `SPA_Bathtub_O3` model:

- current water temperature and target temperature;
- heater, filtration, bubbles, and ozone;
- filter age plus overheat, undercooling, and filter-overdue warnings.

The durable route is Gizwits' local protocol: UDP discovery on port `12414`
and TCP control on port `12416`. A temporary cloud route is also implemented
for an existing Gizwits token or an account that still accepts direct Gizwits
login.

## Run it

Requirements: Node.js 22 or newer. There are no third-party runtime packages.

```powershell
npm.cmd test
npm.cmd start
```

Open <http://127.0.0.1:8787> and choose **Find spa**. Discovery is read-only.

### Reconnect a spa whose Wi-Fi is offline

The V2 panel uses the ESPTouch v1 provisioning method selected by the original
CleverLink application. On the computer running Spararama:

1. Connect to the intended 2.4 GHz home Wi-Fi network.
2. Open the **Reconnect Wi-Fi** section and enter the network password locally.
3. Hold the spa's physical Wi-Fi button only until the first beep, then release
   it immediately. This is the documented pairing action, not a factory reset.
4. Confirm the panel is ready and start the 60-second provisioning attempt.

The Wi-Fi password is converted into transient UDP packet lengths, then removed
from the request objects and never logged or written to disk. ESPTouch v1 is an
old protocol without meaningful over-the-air credential protection, so use it
only on a trusted home network. A nearby radio observer could potentially
recover credentials during the short provisioning window.

Windows may ask whether Node.js can receive private-network traffic. Allowing
private-network UDP is needed for the ESPTouch acknowledgement on port `18266`;
the app also confirms success independently through Gizwits discovery.

Do not factory-reset the spa: a Gizwits reset erases its saved Wi-Fi credentials
and device identity. If provisioning times out, release the button and let the
panel return to normal before retrying.

## Optional configuration

PowerShell environment variables can be set for the current terminal before
starting the service:

```powershell
$env:CLEVERSPA_IP = '192.168.0.123'
$env:CLEVERSPA_PASSCODE = 'passcode-obtained-during-binding'
npm.cmd start
```

For access from a phone on the home LAN, use a long access token:

```powershell
$env:CLEVERSPA_HOST = '0.0.0.0'
$env:CLEVERSPA_ACCESS_TOKEN = 'replace-with-a-long-random-secret'
npm.cmd start
```

Then open `http://<this-PCs-IP>:8787`. Do not port-forward this service or the
spa's TCP port to the Internet. Use a home VPN for access while away.

Cloud credentials and tokens are held in memory only and are never logged or
written to disk. The original CleverLink account used a now-missing Firebase
project, so old email/password login may not work; importing a still-valid old
Gizwits token is more reliable.

## Current live-verification requirement

The local protocol codec and safety policy are covered by automated tests, but
the actual spa has not yet appeared in LAN discovery. Live temperature and
heater verification therefore requires the spa to be powered on, associated
with the 2.4 GHz network, and positively identified by product key
`bc120ff8066147748e6e7057a9b93acc`.
