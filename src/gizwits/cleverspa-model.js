import { CLEVERSPA_PRODUCT_KEY } from "./constants.js";

// Recovered from Gizwits' read-only datapoint endpoint for the CleverSpa
// product key. `addition` and `ratio` convert the wire value to display units.
export const CLEVERSPA_MODEL = Object.freeze({
  name: "SPA_Bathtub_O3",
  productKey: CLEVERSPA_PRODUCT_KEY,
  packetVersion: 4,
  protocolType: "standard",
  attributes: Object.freeze([
    { id: 0, name: "Heater", type: "status_writable", dataType: "bool", byteOffset: 0, unit: "bit", bitOffset: 0, length: 1 },
    { id: 1, name: "Bubble", type: "status_writable", dataType: "bool", byteOffset: 0, unit: "bit", bitOffset: 1, length: 1 },
    { id: 2, name: "Filter", type: "status_writable", dataType: "bool", byteOffset: 0, unit: "bit", bitOffset: 2, length: 1 },
    { id: 3, name: "O3", type: "status_writable", dataType: "bool", byteOffset: 0, unit: "bit", bitOffset: 3, length: 1 },
    { id: 4, name: "Temperature_setup", type: "status_writable", dataType: "uint8", byteOffset: 1, unit: "byte", bitOffset: 0, length: 1, addition: 20, ratio: 1, minimum: 20, maximum: 42 },
    { id: 5, name: "Check", type: "status_writable", dataType: "uint8", byteOffset: 2, unit: "byte", bitOffset: 0, length: 1, addition: 0, ratio: 1, minimum: 0, maximum: 255 },
    { id: 6, name: "Timing", type: "status_writable", dataType: "uint16", byteOffset: 3, unit: "byte", bitOffset: 0, length: 2, addition: 0, ratio: 1, minimum: 0, maximum: 720 },
    { id: 7, name: "Current_temperature", type: "status_readonly", dataType: "uint8", byteOffset: 5, unit: "byte", bitOffset: 0, length: 1, addition: 0, ratio: 1, minimum: 0, maximum: 50 },
    { id: 8, name: "Time_filter", type: "status_readonly", dataType: "uint16", byteOffset: 6, unit: "byte", bitOffset: 0, length: 2, addition: 0, ratio: 1, minimum: 0, maximum: 10200 },
    { id: 9, name: "Overtime_filter", type: "alert", dataType: "bool", byteOffset: 8, unit: "bit", bitOffset: 0, length: 1 },
    { id: 10, name: "Superheat", type: "alert", dataType: "bool", byteOffset: 8, unit: "bit", bitOffset: 1, length: 1 },
    { id: 11, name: "Undercooling", type: "alert", dataType: "bool", byteOffset: 8, unit: "bit", bitOffset: 2, length: 1 },
  ]),
});

export const CLEVERSPA_STATUS_LENGTH = 9;
