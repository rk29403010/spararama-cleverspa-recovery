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

If the spa is discovered but reports that a binding window is required, hold
the physical Wi-Fi button until the spa beeps, then run discovery again. Do not
factory-reset it: a Gizwits reset erases the saved Wi-Fi credentials and device
identity.

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
