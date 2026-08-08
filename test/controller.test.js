import assert from "node:assert/strict";
import test from "node:test";
import { SpaController } from "../src/spa/controller.js";

class FakeTransport {
  constructor(overrides = {}) {
    this.calls = [];
    this.attributes = {
      Current_temperature: 35,
      Temperature_setup: 38,
      Heater: 0,
      Filter: 0,
      Bubble: 0,
      Overtime_filter: 0,
      Superheat: 0,
      Undercooling: 0,
      Time_filter: 120,
      ...overrides,
    };
  }

  async login() {
    return { device: { did: "spa-1" } };
  }

  async getState() {
    return {
      online: true,
      transport: "test",
      updatedAt: new Date().toISOString(),
      device: { id: "spa-1", name: "Test Spa" },
      attributes: { ...this.attributes },
    };
  }

  async setAttributes(attributes) {
    this.calls.push(attributes);
    Object.assign(this.attributes, attributes);
  }
}

test("heater-on starts and confirms filtration first", async () => {
  const transport = new FakeTransport();
  const controller = new SpaController({ cloudClient: transport });
  await controller.connectCloud("owner@example.test", "not-stored");

  const result = await controller.controlHeater(true);
  assert.deepEqual(transport.calls, [{ Filter: 1 }, { Heater: 1 }]);
  assert.equal(result.filter, true);
  assert.equal(result.heater, true);
});

test("heater-on is blocked when the spa reports overheat", async () => {
  const transport = new FakeTransport({ Superheat: 1 });
  const controller = new SpaController({ cloudClient: transport });
  await controller.connectCloud("owner@example.test", "not-stored");

  await assert.rejects(() => controller.controlHeater(true), /overheat condition/);
  assert.deepEqual(transport.calls, []);
});

test("filter-off is blocked during heater cooldown", async () => {
  const transport = new FakeTransport({ Heater: 0, Filter: 1 });
  const controller = new SpaController({ cloudClient: transport });
  await controller.connectCloud("owner@example.test", "not-stored");

  await assert.rejects(() => controller.controlFilter(false), /cool the heater/);
  assert.deepEqual(transport.calls, []);
});

test("target temperature must be a whole number in range", async () => {
  const transport = new FakeTransport();
  const controller = new SpaController({ cloudClient: transport });
  await controller.connectCloud("owner@example.test", "not-stored");

  await assert.rejects(() => controller.setTargetTemperature(42.5), /whole number/);
  await assert.rejects(() => controller.setTargetTemperature(19), /20 to 42/);
  assert.deepEqual(transport.calls, []);
});
