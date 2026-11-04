/**
 * Host half of dsh-locale-vi.
 *
 * The Vietnamese language pack itself lives in the browser half (client.js):
 * every translated string belongs to a Client locale namespace. This Host entry
 * exists for two reasons:
 *
 *   1. the bundle patch row must resolve to a real Host plugin;
 *   2. it offers the `/vi-sync` command, which re-scans the installed Client
 *      bundles for strings that are not translated yet and fills them in with
 *      the Host translation service (anonymous Google/Bing routes: no API key,
 *      no per-user cost).
 *
 * Everything here is defensive on purpose: a broken Host half fails the whole
 * Harness boot, so any failure is caught, logged, and the plugin stays inert.
 */
import { readFile, writeFile, readdir, open } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))
/** <profile>/node_modules/dsh-locale-vi -> <profile> */
const PROFILE_DIR = path.dirname(path.dirname(PLUGIN_DIR))
const DICT_FILE = path.join(PLUGIN_DIR, 'locale', 'dict.json')
const CLIENT_FILE = path.join(PLUGIN_DIR, 'client.js')
const MARK_BEGIN = '/* VI-DICTS-BEGIN */'
const MARK_END = '/* VI-DICTS-END */'

// A dictionary pair: quoted key, single-quoted key, or a bare identifier key
// (`nav: "Built-in plugins"`). Bare keys are common in newer DSH bundles.
const PAIR_RE = /(?:"([^"\\]{1,200})"|'([^'\\]{1,200})'|([A-Za-z_$][\w$]{0,80}))\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)/g
const REGISTER_RE = /locale\.register\(/g
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/
const NS_ALIAS = { 'plugin:dsh-context': 'dsh-context' }
const MAX_PER_RUN = 250

export const name = 'dsh-locale-vi'

export function apply(ctx) {
  try {
    // Optional service: register the command only when the Host has one.
    ctx.inject(['commands'], (scope) => {
      scope.commands.register({
        name: 'vi-sync',
        description: 'Dịch (bổ sung) các chuỗi giao diện mới sang tiếng Việt',
        handler: async (invocation) => {
          try {
            const report = await runSync(ctx, invocation.signal)
            return { kind: 'success', text: report }
          } catch (error) {
            const message = error && error.message ? error.message : String(error)
            return { kind: 'error', text: 'Không đồng bộ được bản dịch: ' + message }
          }
        },
      })
    })
  } catch (error) {
    console.warn('[dsh-locale-vi] host half inactive:', error && error.message ? error.message : error)
  }
}

/* ------------------------------------------------------------------ corpus */

async function listSiblingBundles() {
  const roots = [path.join(PROFILE_DIR, 'node_modules'), PLUGIN_DIR]
  const files = []
  const push = (dir, pkg) => {
    files.push({ label: pkg, file: path.join(dir, 'lib', 'client.js') })
    files.push({ label: pkg, file: path.join(dir, 'client.js') })
  }
  for (const root of roots) {
    let entries = []
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      const dir = path.join(root, entry.name)
      if (entry.name.startsWith('@')) {
        let scoped = []
        try {
          scoped = await readdir(dir, { withFileTypes: true })
        } catch {
          continue
        }
        for (const sub of scoped) {
          if (sub.isDirectory()) push(path.join(dir, sub.name), entry.name + '/' + sub.name)
        }
        continue
      }
      push(dir, entry.name)
    }
  }
  return files
}

async function readAsarEntries() {
  // Desktop installs ship the UI inside app.asar; electron exposes resourcesPath.
  const candidates = []
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'app.asar'))
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar'))
  }
  for (const asar of candidates) {
    let handle
    try {
      handle = await open(asar, 'r')
      const head = Buffer.alloc(16)
      await handle.read(head, 0, 16, 0)
      const dataSize = head.readUInt32LE(4)
      const jsonLength = head.readUInt32LE(12)
      const jsonBuf = Buffer.alloc(jsonLength)
      await handle.read(jsonBuf, 0, jsonLength, 16)
      const header = JSON.parse(jsonBuf.toString('utf8'))
      const base = 8 + dataSize
      const found = []
      const walk = (node, prefix) => {
        if (!node || typeof node !== 'object') return
        if (typeof node.offset === 'number' && typeof node.size === 'number' && node.size > 0) {
          if (/dsh-client-ui-[^/]+\/lib\/client\.js$/.test(prefix)) {
            found.push({ label: '@deepseek-ai/dsh-client-ui-' + prefix.split('/')[0].replace('dsh-client-ui-', ''), file: null, offset: base + Number(node.offset), size: node.size })
          }
          return
        }
        if (node.files) for (const [k, v] of Object.entries(node.files)) walk(v, prefix ? prefix + '/' + k : k)
      }
      walk(header, '')
      for (const item of found) {
        const buf = Buffer.alloc(item.size)
        await handle.read(buf, 0, item.size, item.offset)
        item.text = buf.toString('utf8')
      }
      return found
    } catch {
      continue
    } finally {
      if (handle) await handle.close().catch(() => {})
    }
  }
  return []
}

/** Source slice from `start` through the matching close character. */
function balancedAt(text, start, open, close) {
  let depth = 0
  let quote = null
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch
    else if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** `const X = { ... }` body for an identifier, if the bundle declares one. */
function findConstObject(text, ident) {
  const at = text.search(new RegExp('(?:const|let|var)\\s+' + ident.replace(/\$/g, '\\$') + '\\s*=\\s*\\{'))
  if (at < 0) return null
  const open = text.indexOf('{', at)
  return open < 0 ? null : balancedAt(text, open, '{', '}')
}

/** Split an object body on top-level commas. */
function splitTop(body) {
  const parts = []
  let depth = 0
  let buf = ''
  for (const ch of body) {
    if (ch === '{' || ch === '[' || ch === '(') depth += 1
    else if (ch === '}' || ch === ']' || ch === ')') depth -= 1
    if (ch === ',' && depth === 0) {
      parts.push(buf.trim())
      buf = ''
    } else buf += ch
  }
  if (buf.trim()) parts.push(buf.trim())
  return parts
}

/** Every `<key: english>` pair inside one dictionary literal. */
function parsePairs(blob) {
  const dict = {}
  for (const match of blob.matchAll(PAIR_RE)) {
    const key = match[1] || match[2] || match[3]
    if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    let value = match[4]
    value = value.slice(1, -1).replace(/\\(.)/g, '$1')
    if (!value.trim()) continue
    if (CJK_RE.test(value)) continue // Chinese copy is not an English source string.
    if (dict[key] === undefined) dict[key] = value
  }
  return dict
}

/** All `<ns, english dict>` pairs published by one Client bundle. */
function extractDicts(text) {
  const out = []
  if (!text.includes('locale.register(')) return out
  for (const m of text.matchAll(REGISTER_RE)) {
    const call = balancedAt(text, m.index + 'locale.register'.length, '(', ')')
    if (!call) continue
    const args = call.slice(1, -1)
    const first = args.split(',')[0].trim()
    let ns = null
    const lit = /^["'`]([^"'`]+)["'`]$/.exec(first)
    if (lit) ns = lit[1]
    else {
      const decl = new RegExp('(?:const|let|var)\\s+' + first.replace(/\$/g, '\\$') + '\\s*=\\s*["\'`]([^"\'`]+)["\'`]').exec(text)
      if (decl) ns = decl[1]
    }
    if (!ns) continue
    ns = NS_ALIAS[ns] || ns
    const rest = args.slice(first.length).replace(/^\s*,\s*/, '').trim()
    if (!rest.startsWith('{')) continue
    const inner = balancedAt(rest, 0, '{', '}')
    if (!inner) continue
    const dict = {}
    for (const part of splitTop(inner.slice(1, -1))) {
      let which = null
      let ident = null
      if (part === 'zh' || part === 'en') which = ident = part
      else {
        const pair = /^(zh|en)\s*:\s*([A-Za-z_$][\w$]*)$/.exec(part)
        if (pair) {
          which = pair[1]
          ident = pair[2]
        }
      }
      if (which === 'en' && ident) {
        const blob = findConstObject(text, ident)
        if (blob) Object.assign(dict, parsePairs(blob))
      } else {
        const inline = /^en\s*:\s*\{/.exec(part)
        if (inline) {
          const blob = balancedAt(part, part.indexOf('{'), '{', '}')
          if (blob) Object.assign(dict, parsePairs(blob))
        }
      }
    }
    if (Object.keys(dict).length) out.push({ ns, dict })
  }
  return out
}

async function scanCorpus() {
  const corpus = {}
  const parse = (_entry, text) => {
    for (const found of extractDicts(text)) {
      corpus[found.ns] = corpus[found.ns] || {}
      for (const [key, value] of Object.entries(found.dict)) {
        if (corpus[found.ns][key] === undefined) corpus[found.ns][key] = value
      }
    }
  }
  for (const entry of await listSiblingBundles()) {
    try {
      parse(entry, await readFile(entry.file, 'utf8'))
    } catch {
      /* not every package ships a Client half */
    }
  }
  for (const entry of await readAsarEntries()) parse(entry, entry.text)
  return corpus
}

/* -------------------------------------------------------------- translate */

async function makeTranslator(ctx) {
  const translator = typeof ctx.get === 'function' ? ctx.get('translator') : undefined
  if (!translator) return null
  let providers = []
  try {
    providers = await translator.availableProviders()
  } catch {
    return null
  }
  const anonymous = providers.find((id) => id === 'google') || providers.find((id) => id === 'bing')
  if (!anonymous) return null
  return async (text, signal) => {
    const spec = translator.resolve({ text, targetLanguage: 'vi', sourceLanguage: 'en', provider: anonymous })
    return translator.translate(spec, signal)
  }
}

async function mapLimit(items, limit, worker) {
  const out = []
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      out[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return out
}

/* ------------------------------------------------------------------- sync */

async function loadDict() {
  try {
    return JSON.parse(await readFile(DICT_FILE, 'utf8'))
  } catch {
    return {}
  }
}

async function writeDict(dicts) {
  await writeFile(DICT_FILE, JSON.stringify(dicts, null, 2) + '\n', 'utf8')
  const client = await readFile(CLIENT_FILE, 'utf8')
  const begin = client.indexOf(MARK_BEGIN)
  const end = client.indexOf(MARK_END)
  if (begin < 0 || end < 0) throw new Error('client.js thiếu marker VI-DICTS')
  const next = client.slice(0, begin + MARK_BEGIN.length) + JSON.stringify(dicts, null, 2) + client.slice(end)
  await writeFile(CLIENT_FILE, next, 'utf8')
}

async function runSync(ctx, signal) {
  const dicts = await loadDict()
  const corpus = await scanCorpus()
  const missing = []
  for (const [ns, entries] of Object.entries(corpus)) {
    for (const [key, value] of Object.entries(entries)) {
      if (!dicts[ns] || dicts[ns][key] === undefined) missing.push({ ns, key, value })
    }
  }
  if (!missing.length) return 'Bản dịch đã đầy đủ: không có chuỗi tiếng Anh mới.'

  const translate = await makeTranslator(ctx)
  if (!translate) return 'Thiếu chuỗi mới, nhưng Host chưa bật dịch vụ dịch (translator) với route miễn phí google/bing.'

  const batch = missing.slice(0, MAX_PER_RUN)
  let done = 0
  let failed = 0
  await mapLimit(batch, 4, async (item) => {
    if (signal && signal.aborted) return
    try {
      const vi = String(await translate(item.value, signal)).trim()
      if (!vi) throw new Error('empty')
      dicts[item.ns] = dicts[item.ns] || {}
      dicts[item.ns][item.key] = vi
      done += 1
    } catch {
      failed += 1
    }
  })
  if (done) await writeDict(dicts)
  const rest = missing.length - batch.length
  const lines = ['Đã dịch ' + done + ' chuỗi mới' + (failed ? ', lỗi ' + failed : '') + '.']
  if (rest > 0) lines.push('Còn ' + rest + ' chuỗi chờ lượt sau (mỗi lần tối đa ' + MAX_PER_RUN + ').')
  lines.push('Tải lại trang (Ctrl+R) để thấy tiếng Việt mới.')
  return lines.join('\n')
}
