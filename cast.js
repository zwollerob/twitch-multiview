'use strict';

// Google Cast support (Chromecast, Nvidia Shield, Google TV, ...).
//
// How casting works: the UI records its own window (picture + sound) into a
// live WebM stream. A small HTTP server on the local network serves that
// stream under a random, secret URL, and the Cast device is told to play it
// with Google's standard "Default Media Receiver". The PC keeps doing all the
// work (all streams, logged in, Turbo); the TV only plays one video.

const crypto = require('crypto');
const dgram = require('dgram');
const http = require('http');
const os = require('os');
const tls = require('tls');
const { EventEmitter } = require('events');
const multicastDns = require('multicast-dns');

const DEFAULT_MEDIA_RECEIVER = 'CC1AD845';
const NS = {
  connection: 'urn:x-cast:com.google.cast.tp.connection',
  heartbeat: 'urn:x-cast:com.google.cast.tp.heartbeat',
  receiver: 'urn:x-cast:com.google.cast.receiver',
  media: 'urn:x-cast:com.google.cast.media',
};

// ---------------------------------------------------------------------------
// Discovery (mDNS, on every network card: with a VPN active the default
// route would only reach the tunnel)
// ---------------------------------------------------------------------------
function discoverDevices(timeoutMs = 3500) {
  return new Promise(resolve => {
    const found = new Map();
    const ifaces = Object.values(os.networkInterfaces()).flat()
      .filter(a => a && a.family === 'IPv4' && !a.internal);
    const sockets = [];
    for (const iface of ifaces) {
      let m;
      try {
        m = multicastDns({ interface: iface.address, reuseAddr: true });
      } catch {
        continue;
      }
      m.on('error', () => {});
      m.on('response', res => {
        const d = {};
        const records = [...res.answers, ...res.additionals];
        // Other services (printers, VR software, ...) answer too: only use
        // records that belong to a Google Cast device.
        const isCast = r => typeof r.name === 'string' && r.name.endsWith('._googlecast._tcp.local');
        if (!records.some(isCast)) return;
        for (const r of records) {
          if (r.type === 'TXT' && !isCast(r)) continue;
          if (r.type === 'TXT') {
            for (const b of r.data) {
              const s = b.toString();
              const i = s.indexOf('=');
              if (i > 0) d[s.slice(0, i)] = s.slice(i + 1);
            }
          } else if (r.type === 'SRV') {
            d.port = r.data.port;
          } else if (r.type === 'A') {
            d.ip = r.data;
          }
        }
        if (!d.id || !d.ip || !d.fn) return;
        found.set(d.id, {
          id: d.id,
          name: (d.fn || 'Cast-apparaat').trim(),
          model: (d.md || '').trim(),
          ip: d.ip,
          port: d.port || 8009,
        });
      });
      const ask = () => m.query({ questions: [{ name: '_googlecast._tcp.local', type: 'PTR' }] });
      ask();
      setTimeout(ask, 1200);
      sockets.push(m);
    }
    setTimeout(() => {
      sockets.forEach(s => { try { s.destroy(); } catch { /* already closed */ } });
      resolve([...found.values()].sort((a, b) => a.name.localeCompare(b.name)));
    }, timeoutMs);
  });
}

// ---------------------------------------------------------------------------
// Cast v2 protocol: TLS + length-prefixed protobuf "CastMessage". The message
// only has six simple fields, so it is encoded by hand.
// ---------------------------------------------------------------------------
function varint(n) {
  const out = [];
  while (n > 127) { out.push((n & 127) | 128); n >>>= 7; }
  out.push(n);
  return Buffer.from(out);
}

function encodeMessage(source, destination, namespace, data) {
  const str = (field, s) => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([varint((field << 3) | 2), varint(b.length), b]); };
  const body = Buffer.concat([
    Buffer.from([0x08, 0x00]), // protocol_version = CASTV2_1_0
    str(2, source),
    str(3, destination),
    str(4, namespace),
    Buffer.from([0x28, 0x00]), // payload_type = STRING
    str(6, JSON.stringify(data)),
  ]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([len, body]);
}

function decodeMessage(buf) {
  const msg = {};
  let i = 0;
  const readVarint = () => { let n = 0, shift = 0, b; do { b = buf[i++]; n |= (b & 127) << shift; shift += 7; } while (b & 128); return n >>> 0; };
  while (i < buf.length) {
    const key = readVarint();
    const field = key >> 3;
    const wire = key & 7;
    if (wire === 0) { readVarint(); continue; }
    if (wire !== 2) break;
    const len = readVarint();
    const val = buf.slice(i, i + len);
    i += len;
    if (field === 2) msg.source = val.toString();
    else if (field === 3) msg.destination = val.toString();
    else if (field === 4) msg.namespace = val.toString();
    else if (field === 6) msg.payload = val.toString();
  }
  try { msg.data = JSON.parse(msg.payload); } catch { msg.data = null; }
  return msg;
}

class CastClient extends EventEmitter {
  constructor(device) {
    super();
    this.device = device;
    this.requestId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.transportId = null;
    this.sessionId = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      // Cast devices use a self-signed certificate.
      this.socket = tls.connect({ host: this.device.ip, port: this.device.port, rejectUnauthorized: false, timeout: 8000 }, () => {
        this.send('sender-0', 'receiver-0', NS.connection, { type: 'CONNECT' });
        this.heartbeat = setInterval(() => this.send('sender-0', 'receiver-0', NS.heartbeat, { type: 'PING' }), 5000);
        resolve();
      });
      this.socket.on('data', chunk => this.onData(chunk));
      this.socket.on('timeout', () => this.socket.destroy(new Error('Geen antwoord van het apparaat')));
      this.socket.on('error', err => { reject(err); this.emit('error', err); });
      this.socket.on('close', () => { clearInterval(this.heartbeat); this.emit('close'); });
    });
  }

  send(source, destination, namespace, data) {
    if (this.socket && !this.socket.destroyed) this.socket.write(encodeMessage(source, destination, namespace, data));
  }

  // accept(data) decides which reply counts as the answer; a device that
  // first has to wake up (e.g. a Shield in standby) can take a while.
  request(destination, namespace, data, { timeout = 12000, accept = () => true } = {}) {
    const requestId = this.requestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('Het apparaat reageert niet')); }, timeout);
      this.pending.set(requestId, { resolve, reject, timer, accept });
      this.send('sender-0', destination, namespace, { ...data, requestId });
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const len = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + len) break;
      const msg = decodeMessage(this.buffer.slice(4, 4 + len));
      this.buffer = this.buffer.slice(4 + len);
      this.onMessage(msg);
    }
  }

  onMessage(msg) {
    const d = msg.data || {};
    if (msg.namespace === NS.heartbeat && d.type === 'PING') {
      this.send('sender-0', msg.source, NS.heartbeat, { type: 'PONG' });
      return;
    }
    if (msg.namespace === NS.connection && d.type === 'CLOSE') {
      this.emit('ended', 'Het apparaat heeft de verbinding gesloten');
      return;
    }
    if (msg.namespace === NS.receiver && d.type === 'RECEIVER_STATUS') {
      const apps = (d.status && d.status.applications) || [];
      // Someone else started another app on the TV: our cast is over.
      if (this.sessionId && !apps.some(a => a.sessionId === this.sessionId)) this.emit('ended', 'Er wordt iets anders afgespeeld op het apparaat');
    }
    if (msg.namespace === NS.media && d.type === 'MEDIA_STATUS') {
      const st = (d.status || [])[0];
      if (st && st.playerState === 'IDLE' && st.idleReason && st.idleReason !== 'INTERRUPTED') this.emit('ended', `Afspelen gestopt (${st.idleReason})`);
      if (st) this.emit('media', st.playerState);
    }
    const p = d.requestId && this.pending.get(d.requestId);
    if (!p) return;
    const failed = /FAILED|INVALID|ERROR/.test(d.type || '');
    if (!failed && !p.accept(d)) return; // not the final answer yet
    clearTimeout(p.timer);
    this.pending.delete(d.requestId);
    if (failed) p.reject(new Error(`${d.type}${d.reason ? ` (${d.reason})` : ''}`));
    else p.resolve(d);
  }

  async launch(appId = DEFAULT_MEDIA_RECEIVER) {
    const res = await this.request('receiver-0', NS.receiver, { type: 'LAUNCH', appId }, {
      timeout: 30000,
      accept: r => ((r.status && r.status.applications) || []).some(a => a.appId === appId),
    });
    const app = ((res.status && res.status.applications) || []).find(a => a.appId === appId);
    if (!app) throw new Error('Kon de speler op het apparaat niet starten');
    this.transportId = app.transportId;
    this.sessionId = app.sessionId;
    this.send('sender-0', this.transportId, NS.connection, { type: 'CONNECT' });
  }

  load(url, title, contentType = 'video/webm') {
    return this.request(this.transportId, NS.media, {
      type: 'LOAD',
      autoplay: true,
      currentTime: 0,
      media: {
        contentId: url,
        contentType,
        streamType: 'LIVE',
        metadata: { metadataType: 0, title, subtitle: 'Twitch MultiView' },
      },
    }, {
      timeout: 30000,
      // Loaded = the player buffers or plays (an IDLE status comes first).
      accept: r => r.type === 'MEDIA_STATUS' && (r.status || []).some(st => st.playerState === 'PLAYING' || st.playerState === 'BUFFERING'),
    });
  }

  async stop() {
    try {
      if (this.sessionId) await this.request('receiver-0', NS.receiver, { type: 'STOP', sessionId: this.sessionId });
    } catch { /* device already gone */ }
    this.close();
  }

  close() {
    clearInterval(this.heartbeat);
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    if (this.socket) this.socket.destroy();
  }
}

// ---------------------------------------------------------------------------
// Live stream server: one secret URL, only while casting, only on the network
// card that reaches the Cast device.
// ---------------------------------------------------------------------------
function localAddressFor(ip) {
  return new Promise(resolve => {
    const s = dgram.createSocket('udp4');
    s.connect(9, ip, () => {
      const addr = s.address().address;
      s.close();
      resolve(addr);
    });
    s.on('error', () => { s.close(); resolve(null); });
  });
}

class StreamServer extends EventEmitter {
  async start(deviceIp) {
    this.host = await localAddressFor(deviceIp);
    if (!this.host) throw new Error('Kon geen netwerkverbinding naar het apparaat vinden');
    this.token = crypto.randomBytes(24).toString('hex');
    this.response = null;
    this.server = http.createServer((req, res) => this.onRequest(req, res));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, this.host, resolve);
    });
    return `http://${this.host}:${this.server.address().port}/cast/${this.token}.webm`;
  }

  onRequest(req, res) {
    if (req.url !== `/cast/${this.token}.webm`) {
      res.writeHead(404).end();
      return;
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': 'video/webm', 'Access-Control-Allow-Origin': '*' }).end();
      return;
    }
    // A new connection from the TV always gets a fresh stream from the
    // beginning (WebM header + first keyframe); the old one is closed.
    if (this.response) this.response.end();
    this.response = res;
    res.writeHead(200, {
      'Content-Type': 'video/webm',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'none',
    });
    res.on('close', () => { if (this.response === res) this.response = null; });
    this.emit('client');
  }

  write(chunk) {
    if (this.response && !this.response.writableEnded) this.response.write(chunk);
  }

  stop() {
    if (this.response) this.response.end();
    this.response = null;
    if (this.server) this.server.close();
    this.server = null;
  }
}

module.exports = { discoverDevices, CastClient, StreamServer };
