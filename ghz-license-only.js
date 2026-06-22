const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const https = require('https')
const http = require('http')
const { execFileSync } = require('child_process')

const SUPABASE_URL = 'https://wpkaaxarresldcstaatj.supabase.co'
const SUPABASE_KEY = 'sb_publishable_G3I0XMI3dPG1Skkw9iFm9Q_1Ng6MVG0'
const LICENSE_CACHE_MAX_MS = 48 * 60 * 60 * 1000

module.exports = function setup(config) {
  const { app, ipcMain, getDataDir } = config

  // ── SUPABASE RPC ────────────────────────────────────────
  function supabaseRpc(fn, payload = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(`/rest/v1/rpc/${fn}`, SUPABASE_URL)
      const body = Buffer.from(JSON.stringify(payload), 'utf8')
      const client = url.protocol === 'http:' ? http : https
      const req = client.request(url, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          authorization: `Bearer ${SUPABASE_KEY}`,
          'content-type': 'application/json',
          'content-length': body.length
        }
      }, res => {
        const chunks = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          let json = null
          try { json = raw ? JSON.parse(raw) : null } catch (e) {}
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(json?.message || json?.error || raw || `HTTP ${res.statusCode}`))
            return
          }
          resolve(json)
        })
      })
      req.on('error', reject)
      req.setTimeout(20000, () => req.destroy(new Error('Tempo limite ao validar licença.')))
      req.write(body)
      req.end()
    })
  }

  // ── DEVICE INFO ─────────────────────────────────────────
  function machineGuid() {
    if (process.platform !== 'win32') return ''
    try {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true, timeout: 3000 })
      const m = out.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i)
      return m ? m[1].trim() : ''
    } catch (e) { return '' }
  }

  function getDeviceInfo() {
    const base = [machineGuid(), os.hostname(), os.userInfo().username, os.platform(), os.arch()].join('|')
    return {
      device_hash: crypto.createHash('sha256').update(`ghz-license-v1|${base}`).digest('hex'),
      device_name: os.hostname(),
      device_os: `${os.type()} ${os.release()} ${os.arch()}`,
      app_version: app.getVersion()
    }
  }

  // ── LICENSE STATE ───────────────────────────────────────
  function statePath() { return path.join(getDataDir(), 'license-state.json') }

  function computeStateHmac(s) {
    const payload = `${s.active}|${s.license_key}|${s.activated_at}|${s.last_validated_at}`
    return crypto.createHmac('sha256', 'ghz_license_state_v2').update(payload).digest('hex')
  }

  function readState() {
    try {
      const s = JSON.parse(fs.readFileSync(statePath(), 'utf8') || '{}')
      if (s.active && s._sig && s._sig !== computeStateHmac(s)) {
        s.active = false
        s.last_error = 'Integrity check failed'
      }
      return s
    } catch (e) { return {} }
  }

  function saveState(patch = {}) {
    const dir = getDataDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const s = { active: false, license_key: '', customer_name: '', activated_at: '', last_validated_at: '', last_error: '', ...readState(), ...patch }
    s._sig = computeStateHmac(s)
    fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), 'utf8')
    return s
  }

  function cacheValid(s) {
    if (!s) s = readState()
    if (!s.active || !s.license_key) return false
    if (s._sig && s._sig !== computeStateHmac(s)) return false
    const t = Date.parse(s.last_validated_at || s.activated_at || '')
    return Number.isFinite(t) && Date.now() - t <= LICENSE_CACHE_MAX_MS
  }

  // ── LICENSE ACTIVATE / VALIDATE ─────────────────────────
  async function activate(key, phone) {
    const k = String(key || '').trim().toUpperCase()
    const d = getDeviceInfo()
    const r = await supabaseRpc('ghz_activate_license', { p_license_key: k, p_device_hash: d.device_hash, p_device_name: d.device_name, p_device_os: d.device_os, p_app_version: d.app_version, p_customer_phone: String(phone || '') })
    if (!r?.ok) { saveState({ active: false, license_key: k, last_error: r?.message || 'Licença inválida.' }); return r || { ok: false, message: 'Licença inválida.' } }
    saveState({ active: true, license_key: k, customer_name: r.customer_name || '', activated_at: r.activated_at || new Date().toISOString(), last_validated_at: new Date().toISOString(), last_error: '' })
    return r
  }

  async function validate() {
    const s = readState()
    if (!s.license_key) return { ok: false, code: 'missing_license', message: 'Licença não ativada.' }
    const d = getDeviceInfo()
    const r = await supabaseRpc('ghz_validate_license', { p_license_key: s.license_key, p_device_hash: d.device_hash, p_device_name: d.device_name, p_device_os: d.device_os, p_app_version: d.app_version })
    if (!r?.ok) { saveState({ active: false, last_error: r?.message || 'Licença inválida.' }); return r || { ok: false, message: 'Licença inválida.' } }
    saveState({ active: true, customer_name: r.customer_name || s.customer_name || '', last_validated_at: new Date().toISOString(), last_error: '' })
    return r
  }

  // ── IPC HANDLERS (license only) ─────────────────────────
  ipcMain.handle('license:get-state', async () => ({ ...readState(), cache_valid: cacheValid() }))
  ipcMain.handle('license:device-info', async () => {
    const i = getDeviceInfo()
    return { device_hash_preview: i.device_hash.slice(0, 12), device_name: i.device_name, device_os: i.device_os }
  })
  ipcMain.handle('license:activate', async (e, { license_key, phone }) => activate(license_key, phone))
  ipcMain.handle('license:validate', async () => validate())

  // ── PERIODIC REVALIDATION (every 30 min) ───────────────
  const REVALIDATE_INTERVAL = 30 * 60 * 1000
  let revalidateTimer = null
  function startRevalidation() {
    if (revalidateTimer) clearInterval(revalidateTimer)
    revalidateTimer = setInterval(async () => {
      const s = readState()
      if (!s.active || !s.license_key) return
      try {
        const r = await validate()
        if (!r?.ok) {
          const { BrowserWindow } = require('electron')
          const wins = BrowserWindow.getAllWindows()
          wins.forEach(w => w.webContents.executeJavaScript(
            "if(window.ghzLicense)window.ghzLicense.clearCache();window.location.replace('pages/licenca.html')"
          ))
        }
      } catch (e) { /* network error — keep cached state */ }
    }, REVALIDATE_INTERVAL)
  }
  app.whenReady().then(startRevalidation)

  // ── STARTUP GATE: force server validation on app start ──
  ipcMain.handle('license:startup-check', async () => {
    const s = readState()
    if (!s.active || !s.license_key) return { ok: false, reason: 'no_license' }
    try {
      const r = await validate()
      return r?.ok ? { ok: true } : { ok: false, reason: r?.message || 'invalid' }
    } catch (e) {
      return cacheValid(s) ? { ok: true, cached: true } : { ok: false, reason: 'offline_expired' }
    }
  })

  ipcMain.handle('license:go-to-app', async () => {
    const { BrowserWindow } = require('electron')
    const w = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (w) w.loadFile('index.html')
    return { ok: true }
  })

  ipcMain.handle('license:go-to-licenca', async () => {
    const { BrowserWindow } = require('electron')
    const w = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (w) w.loadFile('pages/licenca.html')
    return { ok: true }
  })

  return { cacheValid, readState, validate }
}
