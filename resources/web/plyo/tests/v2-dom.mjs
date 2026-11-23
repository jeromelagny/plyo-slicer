// DOM factice pour exécuter la page v2 sous node (tests/assistant-v2-*.test.mjs) : la page est assemblée comme le fait le
// slicer (marqueurs plyo-include), son corps HTML est lu par un petit analyseur, et le pont window.orca est simulé.
// Seul ce dont la page a besoin est imité : éléments, classes, attributs, texte, événements, recherche simple.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');

class Text {
  constructor(t) { this.nodeType = 3; this.data = String(t); this.parentNode = null; }
  get textContent() { return this.data; }
  set textContent(t) { this.data = String(t); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
}

class Element {
  constructor(doc, tag) {
    this.ownerDocument = doc; this.nodeType = 1; this.tagName = tag.toUpperCase(); this.childNodes = []; this.parentNode = null;
    this.attrs = {}; this.listeners = {}; this.style = {}; this.dataset = {}; this.disabled = false; this.value = '';
    this.scrollTop = 0; this.scrollHeight = 0; this.files = [];
    const self = this;
    this.classList = {
      _get: () => (self.attrs.class || '').split(/\s+/).filter(Boolean),
      _set: (list) => { self.attrs.class = list.join(' '); },
      add(...c) { const l = this._get(); c.forEach((x) => { if (!l.includes(x)) l.push(x); }); this._set(l); },
      remove(...c) { this._set(this._get().filter((x) => !c.includes(x))); },
      contains(c) { return this._get().includes(c); },
      toggle(c, force) { const on = force === undefined ? !this.contains(c) : !!force; if (on) this.add(c); else this.remove(c); return on; },
    };
  }
  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = String(v); }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = String(v); }
  get title() { return this.attrs.title || ''; }
  set title(v) { this.attrs.title = String(v); }
  get placeholder() { return this.attrs.placeholder || ''; }
  set placeholder(v) { this.attrs.placeholder = String(v); }
  get type() { return this.attrs.type || ''; }
  set type(v) { this.attrs.type = String(v); }
  get src() { return this.attrs.src || ''; }
  set src(v) { this.attrs.src = String(v); }
  get alt() { return this.attrs.alt || ''; }
  set alt(v) { this.attrs.alt = String(v); }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument.documentElement; }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(t) { this.childNodes.forEach((n) => { n.parentNode = null; }); this.childNodes = []; if (t !== '' && t != null) this.appendChild(new Text(t)); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'disabled') this.disabled = true; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  insertBefore(n, ref) { if (!ref) return this.appendChild(n); if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(ref), 0, n); return n; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(other) { for (let n = other; n; n = n.parentNode) if (n === this) return true; return false; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  dispatch(type, extra) {
    const ev = Object.assign({ type, target: this, preventDefault() {}, stopPropagation() { this.stopped = true; } }, extra || {});
    for (let n = this; n && !ev.stopped; n = n.parentNode) (n.listeners[type] || []).slice().forEach((f) => f.call(n, ev));
    if (!ev.stopped) (this.ownerDocument.listeners[type] || []).slice().forEach((f) => f(ev));
    return ev;
  }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() {} blur() {} scrollIntoView() {}
  matches(sel) {
    return sel.split(',').some((one) => {
      const m = /^([a-z0-9]*)((?:[.#][\w-]+)*)$/i.exec(one.trim());
      if (!m) throw new Error('sélecteur non géré : ' + one);
      if (m[1] && m[1].toUpperCase() !== this.tagName) return false;
      return (m[2].match(/[.#][\w-]+/g) || []).every((p) => (p[0] === '#' ? this.id === p.slice(1) : this.classList.contains(p.slice(1))));
    });
  }
  querySelectorAll(sel) { const out = []; const walk = (n) => n.children.forEach((c) => { if (c.matches(sel)) out.push(c); walk(c); }); walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

const VOID = new Set(['input', 'br', 'img', 'hr', 'meta']);
// Lit un fragment HTML simple (balises, attributs entre guillemets, texte) dans `parent`.
function parseInto(doc, parent, html) {
  const re = /<!--[\s\S]*?-->|<\/([a-z0-9]+)\s*>|<([a-z0-9]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/gi;
  const stack = [parent];
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[1]) stack.pop();
    else if (m[2]) {
      const e = doc.createElement(m[2].toLowerCase());
      for (const a of (m[3] || '').matchAll(/([a-z-]+)(?:="([^"]*)")?/gi)) e.setAttribute(a[1], a[2] === undefined ? '' : a[2]);
      if ('disabled' in e.attrs) e.disabled = true;
      top.appendChild(e);
      if (!VOID.has(m[2].toLowerCase())) stack.push(e);
    } else if (m[4] && m[4].trim()) top.appendChild(new Text(m[4]));
  }
}

export function makeDocument(bodyHtml) {
  const doc = { listeners: {} };
  doc.createElement = (t) => new Element(doc, t);
  doc.createElementNS = (ns, t) => new Element(doc, t);
  doc.createTextNode = (t) => new Text(t);
  doc.documentElement = new Element(doc, 'html');
  doc.body = doc.documentElement.appendChild(new Element(doc, 'body'));
  doc.addEventListener = (type, fn) => { (doc.listeners[type] = doc.listeners[type] || []).push(fn); };
  doc.getElementById = (id) => doc.documentElement.querySelectorAll('#' + id)[0] || null;
  doc.querySelectorAll = (s) => doc.documentElement.querySelectorAll(s);
  parseInto(doc, doc.body, bodyHtml);
  return doc;
}

// Réponse du service : JSON, ou flux NDJSON (`lines`), ou une promesse qui n'aboutit qu'à l'annulation (`hang`).
export function response(status, data, opts = {}) {
  const ndjson = opts.lines;
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: (n) => (/content-type/i.test(n) ? (ndjson ? 'application/x-ndjson' : 'application/json') : (opts.headers || {})[n] || null) },
    json: async () => data,
    body: ndjson ? { getReader() { const chunks = ndjson.map((l) => new TextEncoder().encode(JSON.stringify(l) + '\n')); return { read: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true }) }; } } : null,
  };
}

// La page v2 lancée dans un contexte isolé. `bridge(msg, emit)` répond aux messages postés ; `fetch(url, init)` simule le service.
export function loadV2({ bridge = () => {}, fetch = async () => response(500, {}) } = {}) {
  const page = read(path.join('v2', 'index.html'));
  const body = page.slice(page.indexOf('<body>') + 6, page.indexOf('<!--plyo-config-->'));
  const document = makeDocument(body);
  const timers = new Set();
  const posted = [];
  const calls = [];
  let listener = null;
  const emit = (m) => listener && listener(JSON.parse(JSON.stringify(m)));
  const ctx = {
    document, console, crypto: webcrypto, AbortController, TextDecoder, TextEncoder, URL, Promise,
    setTimeout: (f, ms, ...a) => { const t = setTimeout(() => { timers.delete(t); f(...a); }, ms); timers.add(t); return t; },
    clearTimeout: (t) => { timers.delete(t); clearTimeout(t); },
    setInterval: (f, ms) => { const t = setInterval(f, ms); timers.add(t); return t; },
    clearInterval: (t) => { timers.delete(t); clearInterval(t); },
    addEventListener() {},
    fetch: (url, init) => { calls.push({ url, init }); return fetch(url, init); },
    PLYO_API_URL: 'https://api.plyo.test',
    orca: {
      postMessage: (m) => { const copy = JSON.parse(JSON.stringify(m)); posted.push(copy); setTimeout(() => bridge(copy, emit), 0); },
      onMessage: (fn) => { listener = fn; },
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const names = [...page.matchAll(/<!--plyo-include:([^>]*?)-->/g)].map((m) => m[1]);
  for (const name of names) vm.runInContext(read(name), ctx, { filename: name });
  const start = page.lastIndexOf('<script>');
  vm.runInContext(page.slice(start + 8, page.indexOf('</script>', start)), ctx, { filename: 'v2/index.html' });
  const $ = (id) => document.getElementById(id);
  return {
    ctx, document, posted, calls, emit, $,
    text: (id) => $(id).textContent,
    stop() { for (const t of timers) { clearTimeout(t); clearInterval(t); } timers.clear(); },
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
