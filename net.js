// 線上功能：線上排行榜（Firestore）與多人連線（Realtime Database）
// 沒有 Firebase 設定時線上功能停用；網址加上 ?localnet 會改用本機測試後端（同一台電腦的多個分頁互連）
import { FIREBASE_CONFIG } from './firebase-config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const LOCAL = new URLSearchParams(location.search).has('localnet');
export const onlineAvailable = LOCAL || !!FIREBASE_CONFIG?.apiKey;
export const onlineLocal = LOCAL;
export const MAX_PLAYERS = 6;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.random() * CODE_CHARS.length | 0]).join('');

let backend = null;
export async function connect() {
  if (backend) return backend;
  if (!onlineAvailable) throw new Error('線上功能尚未設定');
  backend = LOCAL ? new LocalBackend() : await FirebaseBackend.create(FIREBASE_CONFIG);
  return backend;
}

// ================= Firebase =================
class FirebaseBackend {
  static async create(cfg) {
    const [app, auth, fs, db] = await Promise.all([
      import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'),
      import(FB + 'firebase-firestore.js'), import(FB + 'firebase-database.js'),
    ]);
    const b = new FirebaseBackend();
    b.fs = fs; b.db = db;
    const fapp = app.initializeApp(cfg);
    const a = auth.getAuth(fapp);
    await auth.signInAnonymously(a);
    b.uid = a.currentUser.uid;
    b.store = fs.getFirestore(fapp);
    b.rtdb = db.getDatabase(fapp);
    b.offset = 0;
    db.onValue(db.ref(b.rtdb, '.info/serverTimeOffset'), s => { b.offset = s.val() || 0; });
    return b;
  }
  serverNow() { return Date.now() + this.offset; }

  // ---- 排行榜：tracks/{track}/laps/{uid}，每人每條賽道保留最佳一圈 ----
  async submitLap(track, rec) {
    const { doc, getDoc, setDoc, serverTimestamp } = this.fs;
    const ref = doc(this.store, 'tracks', track, 'laps', this.uid);
    const old = await getDoc(ref);
    if (old.exists() && old.data().time <= rec.time) return false;
    await setDoc(ref, { ...rec, ts: serverTimestamp() });
    return true;
  }
  async topLaps(track, n = 20) {
    const { collection, query, orderBy, limit, getDocs } = this.fs;
    const snap = await getDocs(query(collection(this.store, 'tracks', track, 'laps'), orderBy('time'), limit(n)));
    return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  }

  // ---- 房間：rooms/{code} = { host, track, state, startAt, players/{uid}, pos/{uid} } ----
  r(path) { return this.db.ref(this.rtdb, path); }
  async createRoom(me, track) {
    const { get, set, onDisconnect } = this.db;
    let code;
    for (let i = 0; i < 8; i++) { code = newCode(); if (!(await get(this.r('rooms/' + code))).exists()) break; }
    await set(this.r('rooms/' + code), { host: this.uid, track, state: 'lobby', startAt: 0, players: { [this.uid]: { ...me, joined: this.serverNow() } } });
    onDisconnect(this.r('rooms/' + code)).remove();
    return code;
  }
  async joinRoom(code, me) {
    const { get, set, onDisconnect } = this.db;
    const snap = await get(this.r('rooms/' + code));
    if (!snap.exists()) throw new Error('找不到這個房間');
    const room = snap.val();
    if (room.state !== 'lobby') throw new Error('這個房間已經在比賽中');
    if (Object.keys(room.players || {}).length >= MAX_PLAYERS) throw new Error('房間已滿');
    await set(this.r(`rooms/${code}/players/${this.uid}`), { ...me, joined: this.serverNow() });
    onDisconnect(this.r(`rooms/${code}/players/${this.uid}`)).remove();
    onDisconnect(this.r(`rooms/${code}/pos/${this.uid}`)).remove();
  }
  async leaveRoom(code, isHost) {
    const { remove } = this.db;
    if (isHost) await remove(this.r('rooms/' + code));
    else { await remove(this.r(`rooms/${code}/players/${this.uid}`)); await remove(this.r(`rooms/${code}/pos/${this.uid}`)); }
  }
  onRoom(code, cb) { return this.db.onValue(this.r('rooms/' + code), s => cb(s.val())); }
  updateRoom(code, patch) { return this.db.update(this.r('rooms/' + code), patch); }
  setMe(code, patch) { return this.db.update(this.r(`rooms/${code}/players/${this.uid}`), patch); }
  sendState(code, st) { return this.db.set(this.r(`rooms/${code}/pos/${this.uid}`), st); }
  onStates(code, cb) { return this.db.onValue(this.r(`rooms/${code}/pos`), s => cb(s.val() || {})); }
}

// ================= 本機測試後端（BroadcastChannel + localStorage） =================
class LocalBackend {
  constructor() {
    this.uid = sessionStorage.getItem('to-local-uid') || Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem('to-local-uid', this.uid);
    this.ch = new BroadcastChannel('turbo-overdose-net');
    this.listeners = new Set();
    this.ch.onmessage = e => this.listeners.forEach(fn => fn(e.data));
    addEventListener('beforeunload', () => { if (this.room) this.leaveRoom(this.room, this.isHost); });
  }
  serverNow() { return Date.now(); }
  read(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
  write(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  emit(msg) { this.ch.postMessage(msg); this.listeners.forEach(fn => fn(msg)); }
  rooms() { return this.read('to-local-rooms', {}); }
  saveRoom(code, room) {
    const all = this.rooms();
    if (room) all[code] = room; else delete all[code];
    this.write('to-local-rooms', all);
    this.emit({ type: 'room', code, room });
  }
  async submitLap(track, rec) {
    const all = this.read('to-local-laps', {});
    const key = track + '/' + this.uid;
    if (all[key] && all[key].time <= rec.time) return false;
    all[key] = { ...rec, track, uid: this.uid };
    this.write('to-local-laps', all);
    return true;
  }
  async topLaps(track, n = 20) {
    return Object.values(this.read('to-local-laps', {})).filter(r => r.track === track).sort((a, b) => a.time - b.time).slice(0, n);
  }
  async createRoom(me, track) {
    const code = newCode();
    this.room = code; this.isHost = true;
    this.saveRoom(code, { host: this.uid, track, state: 'lobby', startAt: 0, players: { [this.uid]: { ...me, joined: Date.now() } } });
    return code;
  }
  async joinRoom(code, me) {
    const room = this.rooms()[code];
    if (!room) throw new Error('找不到這個房間');
    if (room.state !== 'lobby') throw new Error('這個房間已經在比賽中');
    if (Object.keys(room.players).length >= MAX_PLAYERS) throw new Error('房間已滿');
    room.players[this.uid] = { ...me, joined: Date.now() };
    this.room = code; this.isHost = false;
    this.saveRoom(code, room);
  }
  async leaveRoom(code, isHost) {
    const room = this.rooms()[code];
    this.room = null;
    if (!room) return;
    if (isHost) return this.saveRoom(code, null);
    delete room.players[this.uid];
    this.saveRoom(code, room);
  }
  onRoom(code, cb) {
    const fn = m => { if (m.type === 'room' && m.code === code) cb(m.room); };
    this.listeners.add(fn);
    cb(this.rooms()[code] || null);
    return () => this.listeners.delete(fn);
  }
  async updateRoom(code, patch) { const room = this.rooms()[code]; if (room) this.saveRoom(code, { ...room, ...patch }); }
  async setMe(code, patch) {
    const room = this.rooms()[code];
    if (room?.players[this.uid]) { Object.assign(room.players[this.uid], patch); this.saveRoom(code, room); }
  }
  sendState(code, st) { this.ch.postMessage({ type: 'pos', code, uid: this.uid, st }); }
  onStates(code, cb) {
    const map = {};
    const fn = m => { if (m.type === 'pos' && m.code === code) { map[m.uid] = m.st; cb({ ...map }); } };
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
