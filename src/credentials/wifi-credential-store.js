import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dpapiScript = path.join(root, "scripts", "dpapi.ps1");

export class CredentialStoreError extends Error {
  constructor(message, { code = "credential_store_error", statusCode = 500 } = {}) {
    super(message);
    this.name = "CredentialStoreError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function runDpapi(mode, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.CLEVERSPA_POWERSHELL || "pwsh.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", dpapiScript, "-Mode", mode],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    const stdout = [];
    const stderr = [];
    let outputLength = 0;
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(new CredentialStoreError("Windows password encryption timed out", {
        code: "credential_encryption_timeout",
      }));
    }, 10_000);
    timer.unref();

    child.on("error", (error) => finish(new CredentialStoreError(
      `Cannot start Windows password encryption: ${error.message}`,
      { code: "credential_encryption_unavailable" },
    )));
    child.stdout.on("data", (chunk) => {
      outputLength += chunk.length;
      if (outputLength <= 128 * 1024) stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (Buffer.concat(stderr).length < 16 * 1024) stderr.push(chunk);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString("utf8").trim();
        finish(new CredentialStoreError(
          `Windows password encryption failed${detail ? `: ${detail}` : ""}`,
          { code: "credential_encryption_failed" },
        ));
        return;
      }
      if (outputLength > 128 * 1024) {
        finish(new CredentialStoreError("Windows password encryption returned too much data"));
        return;
      }
      const output = Buffer.concat(stdout);
      const value = output.toString("utf8");
      output.fill(0);
      for (const chunk of stdout) chunk.fill(0);
      finish(null, value);
    });

    child.stdin.on("error", () => {});
    child.stdin.end(input, "utf8");
  });
}

export async function protectWithDpapi(password) {
  if (process.platform !== "win32") {
    throw new CredentialStoreError("Saved Wi-Fi passwords currently require Windows DPAPI", {
      code: "credential_storage_unsupported",
      statusCode: 501,
    });
  }
  return runDpapi("protect", password);
}

export async function unprotectWithDpapi(protectedPassword) {
  if (process.platform !== "win32") {
    throw new CredentialStoreError("Saved Wi-Fi passwords currently require Windows DPAPI", {
      code: "credential_storage_unsupported",
      statusCode: 501,
    });
  }
  return runDpapi("unprotect", protectedPassword);
}

export class WifiCredentialStore {
  constructor({
    filePath = path.join(root, "data", "wifi-credential.json"),
    protect = protectWithDpapi,
    unprotect = unprotectWithDpapi,
  } = {}) {
    this.filePath = filePath;
    this.protect = protect;
    this.unprotect = unprotect;
  }

  async #read() {
    let content;
    try {
      content = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw new CredentialStoreError(`Cannot read the saved Wi-Fi password: ${error.message}`);
    }
    try {
      const record = JSON.parse(content);
      if (
        record.version !== 1 ||
        typeof record.ssid !== "string" ||
        typeof record.protectedPassword !== "string"
      ) {
        throw new Error("unsupported record format");
      }
      return record;
    } catch (error) {
      throw new CredentialStoreError(`The saved Wi-Fi password record is invalid: ${error.message}`, {
        code: "credential_record_invalid",
      });
    }
  }

  async has(ssid) {
    const record = await this.#read();
    return Boolean(record && record.ssid === ssid);
  }

  async load(ssid) {
    const record = await this.#read();
    if (!record || record.ssid !== ssid) return null;
    try {
      return await this.unprotect(record.protectedPassword);
    } catch (error) {
      if (error instanceof CredentialStoreError) throw error;
      throw new CredentialStoreError(`Cannot decrypt the saved Wi-Fi password: ${error.message}`, {
        code: "credential_decryption_failed",
      });
    }
  }

  async save(ssid, password) {
    if (!ssid || !password) {
      throw new CredentialStoreError("Wi-Fi name and password are required for secure storage", {
        code: "credential_invalid",
        statusCode: 400,
      });
    }
    const protectedPassword = await this.protect(password);
    const record = {
      version: 1,
      ssid,
      protectedPassword,
      savedAt: new Date().toISOString(),
    };
    const directory = path.dirname(this.filePath);
    const temporary = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.mkdir(directory, { recursive: true });
    try {
      await fs.writeFile(temporary, `${JSON.stringify(record)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await fs.rename(temporary, this.filePath);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw new CredentialStoreError(`Cannot save the encrypted Wi-Fi password: ${error.message}`);
    }
  }

  async clear(ssid) {
    const record = await this.#read();
    if (!record || record.ssid !== ssid) return false;
    try {
      await fs.rm(this.filePath, { force: true });
      return true;
    } catch (error) {
      throw new CredentialStoreError(`Cannot remove the saved Wi-Fi password: ${error.message}`);
    }
  }
}
