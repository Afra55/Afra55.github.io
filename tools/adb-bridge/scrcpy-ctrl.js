"use strict";

/**
 * Scrcpy control/device message codecs (v3.1 wire format).
 * Zero npm deps. Used by scrcpy-mirror.js.
 */

const TYPE_INJECT_KEYCODE = 0;
const TYPE_INJECT_TEXT = 1;
const TYPE_INJECT_TOUCH = 2;
const TYPE_INJECT_SCROLL = 3;
const TYPE_BACK_OR_SCREEN_ON = 4;
const TYPE_EXPAND_NOTIFICATION = 5;
const TYPE_EXPAND_SETTINGS = 6;
const TYPE_COLLAPSE_PANELS = 7;
const TYPE_GET_CLIPBOARD = 8;
const TYPE_SET_CLIPBOARD = 9;
const TYPE_SET_DISPLAY_POWER = 10;
const TYPE_ROTATE_DEVICE = 11;
const TYPE_RESET_VIDEO = 17;

const DEVICE_MSG_CLIPBOARD = 0;
const DEVICE_MSG_ACK_CLIPBOARD = 1;

const AMOTION_DOWN = 0;
const AMOTION_UP = 1;
const AMOTION_MOVE = 2;
const AKEY_DOWN = 0;
const AKEY_UP = 1;

const POINTER_ID_FINGER = 0xfffffffffffffffen;
const POINTER_ID_VIRTUAL = 0xfffffffffffffffdn; // -3 pinch helper

const KEYCODE = {
  HOME: 3,
  BACK: 4,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  POWER: 26,
  ENTER: 66,
  DEL: 67,
  APP_SWITCH: 187,
  RECENTS: 187,
};

const QUALITY_PRESETS = {
  high: { maxSize: 1920, videoBitRate: 8000000, maxFps: 60, label: "高清" },
  balanced: { maxSize: 1280, videoBitRate: 2500000, maxFps: 30, label: "均衡" },
  low: { maxSize: 800, videoBitRate: 1200000, maxFps: 24, label: "流畅省流" },
  smooth: { maxSize: 1024, videoBitRate: 4000000, maxFps: 60, label: "高帧" },
};

function floatToU16fp(f) {
  const x = Math.max(0, Math.min(1, Number(f) || 0));
  let u = Math.round(x * 0x10000);
  if (u >= 0xffff) u = 0xffff;
  return u & 0xffff;
}

function floatToI16fp(f) {
  const x = Math.max(-1, Math.min(1, Number(f) || 0));
  let i = Math.round(x * 0x8000);
  if (i > 0x7fff) i = 0x7fff;
  if (i < -0x8000) i = -0x8000;
  return i;
}

function resolveMotionAction(msg) {
  let action = msg.action;
  if (typeof action === "string" || msg.phase) {
    const p = String(action || msg.phase || "").toUpperCase();
    if (p === "DOWN" || p === "0") return AMOTION_DOWN;
    if (p === "UP" || p === "1") return AMOTION_UP;
    return AMOTION_MOVE;
  }
  const n = Number(action);
  return [AMOTION_DOWN, AMOTION_UP, AMOTION_MOVE].includes(n) ? n : null;
}

function writePosition(buf, offset, x, y, w, h) {
  buf.writeUInt32BE(x >>> 0, offset);
  buf.writeUInt32BE(y >>> 0, offset + 4);
  buf.writeUInt16BE(w & 0xffff, offset + 8);
  buf.writeUInt16BE(h & 0xffff, offset + 10);
}

function encodeTouch({ action, x, y, width, height, pressure, pointerId }) {
  const buf = Buffer.alloc(32);
  buf[0] = TYPE_INJECT_TOUCH;
  buf[1] = action;
  buf.writeBigUInt64BE(pointerId ?? POINTER_ID_FINGER, 2);
  writePosition(buf, 10, x, y, width, height);
  buf.writeUInt16BE(floatToU16fp(pressure ?? (action === AMOTION_UP ? 0 : 1)), 22);
  buf.writeUInt32BE(0, 24);
  buf.writeUInt32BE(0, 28);
  return buf;
}

function encodeScroll({ x, y, width, height, hScroll, vScroll }) {
  const buf = Buffer.alloc(21);
  buf[0] = TYPE_INJECT_SCROLL;
  writePosition(buf, 1, x, y, width, height);
  buf.writeInt16BE(floatToI16fp(hScroll || 0), 13);
  buf.writeInt16BE(floatToI16fp(vScroll || 0), 15);
  buf.writeUInt32BE(0, 17);
  return buf;
}

function encodeKeycode({ action, keycode, repeat = 0, metaState = 0 }) {
  const buf = Buffer.alloc(14);
  buf[0] = TYPE_INJECT_KEYCODE;
  buf[1] = action & 0xff;
  buf.writeUInt32BE(keycode >>> 0, 2);
  buf.writeUInt32BE(repeat >>> 0, 6);
  buf.writeUInt32BE(metaState >>> 0, 10);
  return buf;
}

function encodeText(text) {
  const raw = Buffer.from(String(text || "").slice(0, 300), "utf8");
  const buf = Buffer.alloc(1 + 4 + raw.length);
  buf[0] = TYPE_INJECT_TEXT;
  buf.writeUInt32BE(raw.length, 1);
  raw.copy(buf, 5);
  return buf;
}

function encodeSetClipboard(text, { sequence = 1n, paste = false } = {}) {
  const raw = Buffer.from(String(text || "").slice(0, 256 * 1024 - 20), "utf8");
  const buf = Buffer.alloc(10 + 4 + raw.length);
  buf[0] = TYPE_SET_CLIPBOARD;
  buf.writeBigUInt64BE(BigInt(sequence), 1);
  buf[9] = paste ? 1 : 0;
  buf.writeUInt32BE(raw.length, 10);
  raw.copy(buf, 14);
  return buf;
}

function encodeGetClipboard(copyKey = 0) {
  return Buffer.from([TYPE_GET_CLIPBOARD, copyKey & 0xff]);
}

function encodeDisplayPower(on) {
  return Buffer.from([TYPE_SET_DISPLAY_POWER, on ? 1 : 0]);
}

function encodeEmpty(type) {
  return Buffer.from([type & 0xff]);
}

function resolveKeycode(raw) {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const s = String(raw).trim().toUpperCase().replace(/^KEYCODE_/, "");
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return KEYCODE[s] ?? KEYCODE[s.replace(/-/g, "_")] ?? null;
}

/**
 * Parse device→client messages on the control socket.
 * @returns {{ consumed: number, msg?: object }}
 */
function parseDeviceMessage(buf) {
  if (!buf || !buf.length) return { consumed: 0 };
  const type = buf[0];
  if (type === DEVICE_MSG_CLIPBOARD) {
    if (buf.length < 5) return { consumed: 0 };
    const len = buf.readUInt32BE(1);
    if (buf.length < 5 + len) return { consumed: 0 };
    const text = buf.subarray(5, 5 + len).toString("utf8");
    return { consumed: 5 + len, msg: { type: "clipboard", text } };
  }
  if (type === DEVICE_MSG_ACK_CLIPBOARD) {
    if (buf.length < 9) return { consumed: 0 };
    return {
      consumed: 9,
      msg: { type: "clipboard_ack", sequence: buf.readBigUInt64BE(1).toString() },
    };
  }
  // Unknown: skip 1 byte to resync poorly; prefer stop
  return { consumed: -1 };
}

function resolveQuality(name) {
  const key = String(name || "balanced").toLowerCase();
  return { name: QUALITY_PRESETS[key] ? key : "balanced", ...(QUALITY_PRESETS[key] || QUALITY_PRESETS.balanced) };
}

module.exports = {
  TYPE_INJECT_KEYCODE,
  TYPE_INJECT_TEXT,
  TYPE_INJECT_TOUCH,
  TYPE_INJECT_SCROLL,
  TYPE_BACK_OR_SCREEN_ON,
  TYPE_EXPAND_NOTIFICATION,
  TYPE_EXPAND_SETTINGS,
  TYPE_COLLAPSE_PANELS,
  TYPE_GET_CLIPBOARD,
  TYPE_SET_CLIPBOARD,
  TYPE_SET_DISPLAY_POWER,
  TYPE_ROTATE_DEVICE,
  TYPE_RESET_VIDEO,
  AMOTION_DOWN,
  AMOTION_UP,
  AMOTION_MOVE,
  AKEY_DOWN,
  AKEY_UP,
  POINTER_ID_FINGER,
  POINTER_ID_VIRTUAL,
  KEYCODE,
  QUALITY_PRESETS,
  resolveMotionAction,
  resolveKeycode,
  resolveQuality,
  encodeTouch,
  encodeScroll,
  encodeKeycode,
  encodeText,
  encodeSetClipboard,
  encodeGetClipboard,
  encodeDisplayPower,
  encodeEmpty,
  parseDeviceMessage,
  floatToU16fp,
  floatToI16fp,
};
