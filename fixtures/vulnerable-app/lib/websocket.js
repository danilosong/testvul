"use strict";

// Minimal hand-rolled RFC 6455 WebSocket server — just enough to exchange
// one JSON text message per connection for the fixture's WebSocket
// Observation control case. Not a general-purpose implementation: no
// fragmentation, no extensions, no binary frames.

const crypto = require("crypto");

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function acceptKeyFor(secWebSocketKey) {
  return crypto.createHash("sha1").update(secWebSocketKey + WS_MAGIC).digest("base64");
}

function encodeTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const lengthByte = payload.length < 126 ? payload.length : 126;
  const header = Buffer.alloc(lengthByte === 126 ? 4 : 2);
  header[0] = 0x81; // FIN + text opcode
  if (lengthByte === 126) {
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header[1] = lengthByte;
  }
  return Buffer.concat([header, payload]);
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let payloadLen = buffer[1] & 0x7f;
  let offset = 2;
  if (payloadLen === 126) {
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    payloadLen = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  let maskKey;
  if (masked) {
    maskKey = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + payloadLen) return null; // incomplete frame
  const rawPayload = buffer.subarray(offset, offset + payloadLen);
  const payload = masked
    ? Buffer.from(rawPayload.map((byte, i) => byte ^ maskKey[i % 4]))
    : Buffer.from(rawPayload);
  return { opcode, payload, consumed: offset + payloadLen };
}

/**
 * Upgrades `req`/`socket` to a WebSocket connection and invokes
 * `onConnection(send, onMessage)` once the handshake completes.
 */
function handleUpgrade(req, socket, head, onConnection) {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = acceptKeyFor(key);
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );

  const send = (text) => socket.write(encodeTextFrame(text));
  const messageHandlers = [];
  const onMessage = (cb) => messageHandlers.push(cb);

  let buffered = head && head.length ? head : Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    let frame;
    while ((frame = decodeFrame(buffered))) {
      buffered = buffered.subarray(frame.consumed);
      if (frame.opcode === 0x1) {
        messageHandlers.forEach((cb) => cb(frame.payload.toString("utf8")));
      } else if (frame.opcode === 0x8) {
        socket.end();
        return;
      }
    }
  });

  onConnection(send, onMessage);
}

module.exports = { handleUpgrade };
