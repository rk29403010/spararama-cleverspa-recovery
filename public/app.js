(() => {
  "use strict";

  const POLL_INTERVAL_MS = 5000;
  const SESSION_TOKEN_KEY = "spararama.accessToken";
  const TARGET_MIN = 20;
  const TARGET_MAX = 42;

  const elements = Object.fromEntries(
    Array.from(document.querySelectorAll("[id]"), (element) => [element.id, element]),
  );

  let spaState = emptyState();
  let pendingTarget = null;
  let requestInFlight = false;
  let provisionInFlight = false;
  let pollTimer;
  let toastTimer;
  let provisionTimer;

  function emptyState() {
    return {
      connected: false,
      controllable: false,
      currentTemperature: null,
      targetTemperature: null,
      heater: false,
      filter: false,
      bubbles: false,
      faults: [],
      deviceName: "Not found",
      route: "None",
      updatedAt: null,
      stale: true,
    };
  }

  function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null);
  }

  function finiteNumber(...values) {
    const value = firstDefined(...values);
    if (value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function stateBoolean(...values) {
    const value = firstDefined(...values);
    if (value === true || value === 1 || value === "1" || value === "on") return true;
    if (value === false || value === 0 || value === "0" || value === "off") return false;
    return false;
  }

  function normalizeFaults(raw, state) {
    const candidates = firstDefined(
      state.faults,
      state.errors,
      state.warnings,
      state.blockedReasons,
      raw.faults,
      raw.errors,
      raw.warnings,
      raw.blockedReasons,
      [],
    );
    const list = Array.isArray(candidates) ? candidates : candidates ? [candidates] : [];
    const faults = list
      .map((fault) => typeof fault === "string" ? fault : firstDefined(fault.message, fault.description, fault.code))
      .filter(Boolean)
      .map(String);
    if (!faults.length && state.hasError === true) faults.push("The spa reported an unspecified fault.");
    return faults;
  }

  function normalizeStatus(raw) {
    const state = raw.spa || raw.state || raw.status || raw;
    const device = raw.device || state.device || {};
    const connection = raw.connection || state.connection || {};
    const currentTemperature = finiteNumber(
      state.currentTemperature,
      state.current_temperature,
      state.Current_temperature,
      state.temperature,
    );
    const targetTemperature = finiteNumber(
      state.targetTemperature,
      state.target_temperature,
      state.Temperature_setup,
      state.temperatureSetup,
    );
    const connected = stateBoolean(
      state.connected,
      state.online,
      state.deviceOnline,
      connection.connected,
      device.online,
    );

    return {
      connected,
      // Intentionally strict: UI controls unlock only on an explicit true from the backend.
      controllable: raw.controllable === true || state.controllable === true,
      currentTemperature,
      targetTemperature,
      heater: stateBoolean(state.heater, state.Heater),
      filter: stateBoolean(state.filter, state.Filter),
      bubbles: stateBoolean(state.bubbles, state.bubble, state.Bubble),
      faults: normalizeFaults(raw, state),
      deviceName: String(firstDefined(device.name, device.productName, device.id, device.did, device.ip, state.deviceName, state.did, "Not found")),
      route: String(firstDefined(connection.route, connection.source, state.transport, state.route, state.source, raw.transport, raw.source, connected ? "Connected" : "None")),
      updatedAt: firstDefined(state.updatedAt, state.lastSeen, raw.updatedAt, raw.timestamp, null),
      stale: state.stale === true || raw.stale === true || faultsMentionStale(state.blockedReasons || raw.blockedReasons),
    };
  }

  function faultsMentionStale(reasons) {
    return Array.isArray(reasons) && reasons.some((reason) => String(reason).toLowerCase().includes("stale"));
  }

  function sessionToken() {
    try { return sessionStorage.getItem(SESSION_TOKEN_KEY) || ""; }
    catch { return ""; }
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body) headers.set("Content-Type", "application/json");
    const token = sessionToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const response = await fetch(path, {
      ...options,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });

    let body = null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      body = await response.json().catch(() => null);
    }

    if (response.status === 401) {
      elements.tokenPanel.hidden = false;
      throw new Error(body?.error || "Access token required");
    }
    if (!response.ok) throw new Error(body?.error || body?.message || `Request failed (${response.status})`);
    return body;
  }

  function displayTemperature(value) {
    if (!Number.isFinite(value)) return "--";
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function describeTemperature(value) {
    if (!Number.isFinite(value)) return "No reading yet";
    if (value < 20) return "Cool water";
    if (value < 32) return "Warming up";
    if (value < 38) return "Comfortably warm";
    return "Hot water";
  }

  function describeTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
  }

  function setConnection(connected) {
    elements.connectionPill.className = `status-pill status-pill--${connected ? "online" : "offline"}`;
    elements.connectionLabel.textContent = connected ? "Spa online" : "Spa offline";
  }

  function setSwitch(name, enabled, controllable) {
    const button = elements[`${name}Control`];
    const label = elements[`${name}State`];
    button.setAttribute("aria-checked", String(enabled));
    button.disabled = !controllable || requestInFlight;
    label.textContent = enabled ? "On" : controllable ? "Off" : "Unavailable";
    button.closest(".control-card").classList.toggle("control-card--active", enabled);
  }

  function render() {
    const controllable = spaState.controllable && !spaState.stale && spaState.faults.length === 0;
    setConnection(spaState.connected);

    elements.currentTemperature.textContent = displayTemperature(spaState.currentTemperature);
    elements.temperatureDescription.textContent = describeTemperature(spaState.currentTemperature);
    elements.targetTemperature.textContent = displayTemperature(spaState.targetTemperature);
    if (pendingTarget === null && Number.isFinite(spaState.targetTemperature)) pendingTarget = spaState.targetTemperature;
    elements.pendingTarget.textContent = displayTemperature(pendingTarget);

    elements.deviceName.textContent = spaState.deviceName;
    elements.connectionRoute.textContent = spaState.route;
    elements.lastContact.textContent = describeTime(spaState.updatedAt);
    elements.freshness.textContent = spaState.stale
      ? "Reading is not yet confirmed"
      : `Updated ${describeTime(spaState.updatedAt)}`;

    elements.faultPanel.hidden = spaState.faults.length === 0;
    elements.faultList.replaceChildren(...spaState.faults.map((message) => {
      const item = document.createElement("li");
      item.textContent = message;
      return item;
    }));

    setSwitch("heater", spaState.heater, controllable);
    setSwitch("filter", spaState.filter, controllable);
    setSwitch("bubbles", spaState.bubbles, controllable);

    elements.targetDown.disabled = !controllable || requestInFlight || pendingTarget === null || pendingTarget <= TARGET_MIN;
    elements.targetUp.disabled = !controllable || requestInFlight || pendingTarget === null || pendingTarget >= TARGET_MAX;
    elements.targetApply.disabled = !controllable || requestInFlight || pendingTarget === null || pendingTarget === spaState.targetTemperature;
    elements.controlLock.textContent = controllable ? "Controls ready" : spaState.faults.length ? "Locked while a fault is active" : "Waiting for safe control";
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 4200);
  }

  function setProvisionStatus(kind, title, detail, { elapsed = false } = {}) {
    elements.provisionStatus.hidden = false;
    elements.provisionStatus.className = `provision-status provision-status--${kind}`;
    elements.provisionStatusTitle.textContent = title;
    elements.provisionStatusDetail.textContent = detail;
    elements.provisionProgress.hidden = !elapsed;
    elements.provisionElapsed.hidden = !elapsed;
  }

  async function refreshProvisionNetwork() {
    try {
      const response = await api("/api/network");
      const network = response?.network || {};
      if (network.ssid && !elements.provisionSsid.value) elements.provisionSsid.value = String(network.ssid);
      if (network.bssid && !elements.provisionBssid.value) elements.provisionBssid.value = String(network.bssid);
    } catch {
      // Status polling already exposes authentication or connection problems.
    }
  }

  async function refreshStatus({ quiet = false } = {}) {
    try {
      const raw = await api("/api/status");
      const nextState = normalizeStatus(raw || {});
      if (pendingTarget === null || pendingTarget === spaState.targetTemperature) {
        pendingTarget = nextState.targetTemperature;
      }
      spaState = nextState;
      if (sessionToken()) elements.tokenPanel.hidden = true;
      render();
    } catch (error) {
      spaState = { ...spaState, connected: false, controllable: false, stale: true };
      render();
      if (!quiet) showToast(error.message);
    } finally {
      clearTimeout(pollTimer);
      pollTimer = setTimeout(() => refreshStatus({ quiet: true }), POLL_INTERVAL_MS);
    }
  }

  async function postAction(path, body, successMessage) {
    if (requestInFlight) return;
    requestInFlight = true;
    render();
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      showToast(successMessage);
      await refreshStatus({ quiet: true });
    } catch (error) {
      showToast(error.message);
    } finally {
      requestInFlight = false;
      render();
    }
  }

  function confirmHeater() {
    if (typeof elements.heaterDialog.showModal === "function") {
      elements.heaterDialog.showModal();
      return;
    }
    if (window.confirm("Start filtration and heating? Make sure the spa is filled and ready to run.")) {
      postAction("/api/control/heater", { enabled: true }, "Heater start requested");
    }
  }

  elements.heaterControl.addEventListener("click", () => {
    if (spaState.heater) postAction("/api/control/heater", { enabled: false }, "Heater stop requested");
    else confirmHeater();
  });

  elements.heaterDialog.addEventListener("close", () => {
    if (elements.heaterDialog.returnValue === "confirm") {
      postAction("/api/control/heater", { enabled: true }, "Heater start requested");
    }
  });

  elements.filterControl.addEventListener("click", () => {
    postAction("/api/control/filter", { enabled: !spaState.filter }, `Filter ${spaState.filter ? "stop" : "start"} requested`);
  });

  elements.bubblesControl.addEventListener("click", () => {
    postAction("/api/control/bubbles", { enabled: !spaState.bubbles }, `Bubbles ${spaState.bubbles ? "stop" : "start"} requested`);
  });

  elements.targetDown.addEventListener("click", () => {
    pendingTarget = Math.max(TARGET_MIN, pendingTarget - 1);
    render();
  });

  elements.targetUp.addEventListener("click", () => {
    pendingTarget = Math.min(TARGET_MAX, pendingTarget + 1);
    render();
  });

  elements.targetApply.addEventListener("click", async () => {
    const temperature = pendingTarget;
    await postAction("/api/control/target-temperature", { temperature }, `Target set to ${temperature}°C`);
  });

  elements.discoverButton.addEventListener("click", async () => {
    elements.discoverButton.disabled = true;
    elements.discoverButton.textContent = "Searching…";
    try {
      await api("/api/discover", { method: "POST" });
      showToast("Discovery complete");
      await refreshStatus({ quiet: true });
    } catch (error) {
      showToast(error.message);
    } finally {
      elements.discoverButton.disabled = false;
      elements.discoverButton.textContent = "Discover";
    }
  });

  elements.provisionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (provisionInFlight) return;

    const payload = {
      ssid: elements.provisionSsid.value,
      password: elements.provisionPassword.value,
      confirmedPanelReady: elements.provisionPanelReady.checked,
    };
    const bssid = elements.provisionBssid.value.trim();
    if (bssid) payload.bssid = bssid;

    provisionInFlight = true;
    elements.provisionCard.setAttribute("aria-busy", "true");
    elements.provisionFields.disabled = true;
    elements.discoverButton.disabled = true;
    setProvisionStatus(
      "working",
      "Sending Wi-Fi details",
      "Keep this page open. The V2 panel normally takes 60–90 seconds to reconnect.",
      { elapsed: true },
    );

    const startedAt = Date.now();
    elements.provisionElapsed.textContent = "0 seconds elapsed";
    clearInterval(provisionTimer);
    provisionTimer = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      elements.provisionElapsed.textContent = `${seconds} second${seconds === 1 ? "" : "s"} elapsed`;
    }, 1000);

    // Start the same-origin request, then immediately remove credentials from the page.
    const provisionRequest = api("/api/provision", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    elements.provisionForm.reset();
    payload.ssid = "";
    payload.password = "";
    payload.confirmedPanelReady = false;
    delete payload.bssid;

    try {
      const provisionResult = await provisionRequest;
      await refreshStatus({ quiet: true });
      if (provisionResult?.warning) {
        setProvisionStatus(
          "warning",
          "Wi-Fi setup needs confirmation",
          provisionResult.warning,
        );
      } else {
        setProvisionStatus(
          "success",
          "Wi-Fi setup finished",
          spaState.connected ? "Your spa is online and its status has been refreshed." : "The connection attempt and discovery finished. If the spa is not online yet, wait a moment and try Discover.",
        );
      }
    } catch (error) {
      setProvisionStatus(
        "error",
        "Wi-Fi setup did not finish",
        `${error.message}. Put the panel into Wi-Fi mode again before retrying.`,
      );
    } finally {
      clearInterval(provisionTimer);
      provisionInFlight = false;
      elements.provisionCard.removeAttribute("aria-busy");
      elements.provisionFields.disabled = false;
      elements.discoverButton.disabled = false;
      refreshProvisionNetwork();
    }
  });

  elements.provisionAdvanced.addEventListener("toggle", () => {
    if (elements.provisionAdvanced.open) refreshProvisionNetwork();
  });

  elements.cloudLoginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = elements.cloudUsername.value;
    const password = elements.cloudPassword.value;
    elements.cloudLoginButton.disabled = true;
    try {
      await api("/api/cloud/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      showToast("Gizwits account connected for this server session");
      await refreshStatus({ quiet: true });
    } catch (error) {
      showToast(error.message);
    } finally {
      // Cloud credentials are deliberately removed from the page after every attempt.
      elements.cloudLoginForm.reset();
      elements.cloudLoginButton.disabled = false;
    }
  });

  elements.tokenForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const token = elements.accessToken.value.trim();
    if (!token) return;
    try { sessionStorage.setItem(SESSION_TOKEN_KEY, token); }
    catch { showToast("This browser cannot keep a session token"); return; }
    clearTimeout(toastTimer);
    elements.toast.hidden = true;
    elements.tokenForm.reset();
    elements.tokenPanel.hidden = true;
    refreshStatus();
    refreshProvisionNetwork();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshStatus({ quiet: true });
  });

  refreshStatus();
  refreshProvisionNetwork();
})();
