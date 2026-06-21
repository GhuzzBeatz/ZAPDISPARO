const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const http = require('http')
const https = require('https')
const { spawn } = require('child_process')
const { fileURLToPath } = require('url')

// â”€â”€ DETECTAR CHROME / CHROMIUM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function encontrarChrome() {
  // 1. Chromium bundled do puppeteer (desempacotado via asarUnpack)
  const asarBase = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : path.join(__dirname)

  for (const base of [
    path.join(asarBase, 'node_modules', 'puppeteer', '.local-chromium'),
    path.join(asarBase, 'node_modules', 'puppeteer-core', '.local-chromium'),
  ]) {
    try {
      if (!fs.existsSync(base)) continue
      for (const plat of fs.readdirSync(base)) {
        for (const exe of [
          path.join(base, plat, 'chrome-win', 'chrome.exe'),
          path.join(base, plat, 'chrome-win64', 'chrome.exe'),
          path.join(base, plat, 'chrome-linux', 'chrome'),
        ]) {
          if (fs.existsSync(exe)) return exe
        }
      }
    } catch(e) {}
  }

  // 2. Chrome do sistema (fallback)
  for (const c of [
    path.join('C:', 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join('C:', 'Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join('C:', 'Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join('C:', 'Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser', '/usr/bin/chromium',
  ]) {
    try { if (fs.existsSync(c)) return c } catch(e) {}
  }
  return null
}

app.setName('ZapDisparo')

// â”€â”€ DADOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getDataDir() {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.join(__dirname, 'data')
}
function lerJSON(nome, padrao) {
  try { return JSON.parse(fs.readFileSync(path.join(getDataDir(), nome+'.json'), 'utf8')) }
  catch(e) { return padrao }
}
function salvarJSON(nome, dados) {
  const dir = getDataDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, nome+'.json'), JSON.stringify(dados, null, 2))
}

const DEFAULT_UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/GhuzzBeatz/ZAPDISPARO/main/update-manifest.json'
const UPDATE_WEEK_MS = 7 * 24 * 60 * 60 * 1000
const UPDATE_PENDING_NOTICE_MS = UPDATE_WEEK_MS
const SCHEDULE_TICK_MS = 30 * 1000

function cmpVersao(a, b) {
  const pa = String(a || '0.0.0').split('.').map(v => Number(v) || 0)
  const pb = String(b || '0.0.0').split('.').map(v => Number(v) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0
    const db = pb[i] || 0
    if (da > db) return 1
    if (da < db) return -1
  }
  return 0
}

function obterCfgUpdate() {
  const cfg = lerJSON('update_config', {})
  return {
    manifestUrl: String(cfg.manifestUrl || DEFAULT_UPDATE_MANIFEST_URL || '').trim()
  }
}

function lerEstadoUpdate() {
  const st = lerJSON('update_state', {})
  return {
    weeklyEnabled: st.weeklyEnabled !== false,
    lastCheckAt: typeof st.lastCheckAt === 'string' ? st.lastCheckAt : '',
    lastResult: typeof st.lastResult === 'object' && st.lastResult ? st.lastResult : null,
    pendingUpdateVersion: typeof st.pendingUpdateVersion === 'string' ? st.pendingUpdateVersion : '',
    pendingUpdateDetectedAt: typeof st.pendingUpdateDetectedAt === 'string' ? st.pendingUpdateDetectedAt : ''
  }
}

function salvarEstadoUpdate(parcial) {
  const atual = lerEstadoUpdate()
  const novo = {
    ...atual,
    ...parcial
  }
  salvarJSON('update_state', novo)
  return novo
}

function calcularProximoCheck(lastCheckAt) {
  const ts = Date.parse(String(lastCheckAt || ''))
  if (!Number.isFinite(ts)) return new Date().toISOString()
  return new Date(ts + UPDATE_WEEK_MS).toISOString()
}

function deveChecarSemanalmente(estado) {
  if (!estado.weeklyEnabled) return false
  const ts = Date.parse(String(estado.lastCheckAt || ''))
  if (!Number.isFinite(ts)) return true
  return (Date.now() - ts) >= UPDATE_WEEK_MS
}

function registrarResultadoUpdate(updateCheck, checkedAt = new Date().toISOString()) {
  const atual = lerEstadoUpdate()
  const parcial = {
    lastCheckAt: checkedAt,
    lastResult: updateCheck || null
  }

  if (updateCheck && updateCheck.ok && updateCheck.hasUpdate) {
    const latest = String(updateCheck.latestVersion || '').trim()
    if (latest) {
      parcial.pendingUpdateVersion = latest
      parcial.pendingUpdateDetectedAt = atual.pendingUpdateVersion === latest && atual.pendingUpdateDetectedAt
        ? atual.pendingUpdateDetectedAt
        : checkedAt
    }
  } else if (updateCheck && updateCheck.ok && !updateCheck.hasUpdate) {
    parcial.pendingUpdateVersion = ''
    parcial.pendingUpdateDetectedAt = ''
  }

  return salvarEstadoUpdate(parcial)
}

function obterAvisoUpdatePendente() {
  const estado = lerEstadoUpdate()
  const detectedTs = Date.parse(String(estado.pendingUpdateDetectedAt || ''))
  const hasPending = !!estado.pendingUpdateVersion && Number.isFinite(detectedTs)
  const daysPending = hasPending ? Math.floor((Date.now() - detectedTs) / (24 * 60 * 60 * 1000)) : 0
  const show = hasPending && (Date.now() - detectedTs) >= UPDATE_PENDING_NOTICE_MS
  const lastResult = estado.lastResult || {}

  return {
    ok: true,
    show,
    currentVersion: app.getVersion(),
    latestVersion: lastResult.latestVersion || estado.pendingUpdateVersion || '',
    pendingUpdateVersion: estado.pendingUpdateVersion || '',
    pendingUpdateDetectedAt: estado.pendingUpdateDetectedAt || '',
    daysPending: Math.max(0, daysPending),
    downloadUrl: lastResult.downloadUrl || ''
  }
}

function requisicaoTexto(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url)
      const lib = u.protocol === 'https:' ? https : http
      const req = lib.request(u, {
        method: 'GET',
        headers: {
          'User-Agent': `ZapDisparo/${app.getVersion()}`,
          'Accept': 'application/json, text/plain, */*'
        },
        timeout: 20000
      }, (res) => {
        const status = Number(res.statusCode || 0)
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          if (redirects >= 5) return reject(new Error('Muitos redirecionamentos.'))
          const prox = new URL(res.headers.location, url).toString()
          res.resume()
          return resolve(requisicaoTexto(prox, redirects + 1))
        }
        if (status < 200 || status >= 300) {
          res.resume()
          return reject(new Error(`HTTP ${status}`))
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      })
      req.on('timeout', () => req.destroy(new Error('Timeout na requisicao.')))
      req.on('error', reject)
      req.end()
    } catch (e) {
      reject(e)
    }
  })
}

async function buscarManifestUpdate() {
  const normalizarManifest = (manifest) => {
    if (!manifest || typeof manifest !== 'object') {
      throw new Error('Manifesto vazio.')
    }
    const version = String(manifest.version || '').trim()
    const downloadUrl = String(manifest.download_url || manifest.url || '').trim()
    if (!version || !downloadUrl) {
      throw new Error('Manifesto sem "version" ou "download_url".')
    }
    return {
      version,
      downloadUrl,
      notes: String(manifest.notes || '').trim()
    }
  }

  const cfg = obterCfgUpdate()
  if (!cfg.manifestUrl) {
    const localPaths = [
      path.join(app.isPackaged ? path.dirname(process.execPath) : __dirname, 'update-manifest.json'),
      path.join(process.resourcesPath || '', 'update-manifest.json'),
      path.join(__dirname, 'update-manifest.json')
    ].filter(Boolean)

    for (const localManifestPath of localPaths) {
      if (!fs.existsSync(localManifestPath)) continue
      const localText = fs.readFileSync(localManifestPath, 'utf8')
      const localManifest = JSON.parse(localText)
      return { ok: true, manifest: normalizarManifest(localManifest) }
    }

    return { ok: false, message: 'URL de atualizacao nao configurada e arquivo local update-manifest.json nao encontrado.' }
  }

  const body = await requisicaoTexto(cfg.manifestUrl)
  let manifest = null
  try {
    manifest = JSON.parse(body)
  } catch (e) {
    throw new Error('Manifesto invalido (JSON).')
  }
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Manifesto vazio.')
  }
  return {
    ok: true,
    manifest: normalizarManifest(manifest)
  }
}

async function verificarAtualizacaoApp() {
  try {
    const currentVersion = app.getVersion()
    const m = await buscarManifestUpdate()
    if (!m.ok) {
      return { ok: false, configured: false, currentVersion, message: m.message }
    }
    const latestVersion = m.manifest.version
    const hasUpdate = cmpVersao(latestVersion, currentVersion) > 0
    return {
      ok: true,
      currentVersion,
      latestVersion,
      hasUpdate,
      notes: m.manifest.notes || '',
      downloadUrl: m.manifest.downloadUrl
    }
  } catch (err) {
    return { ok: false, configured: true, message: err.message || String(err) }
  }
}

function obterOrigemNavegador(exePath) {
  const p = String(exePath || '').toLowerCase()
  if (!p) return 'nao_encontrado'
  if (p.includes('msedge')) return 'edge_sistema'
  if (p.includes('google\\chrome') || p.includes('google/chrome')) return 'chrome_sistema'
  if (p.includes('asar.unpacked') || p.includes('node_modules\\puppeteer') || p.includes('node_modules/puppeteer')) return 'chromium_interno'
  return 'outro'
}

async function obterStatusMotores() {
  const pkg = require('./package.json')
  const chromePath = encontrarChrome()
  const origemNavegador = obterOrigemNavegador(chromePath)
  const usaNavegadorSistema = origemNavegador === 'chrome_sistema' || origemNavegador === 'edge_sistema'
  return {
    appVersion: app.getVersion(),
    whatsappWebJsVersion: String((pkg.dependencies && pkg.dependencies['whatsapp-web.js']) || ''),
    navegadorPath: chromePath || '',
    origemNavegador,
    usaNavegadorSistema,
    regraAtualizacaoWhatsapp: 'Atualiza junto com a versao do app (novo instalador).',
    regraAtualizacaoChrome: usaNavegadorSistema
      ? 'Chrome/Edge do sistema atualiza automaticamente pelo Windows/Google.'
      : 'Chromium interno atualiza junto com a versao do app (novo instalador).'
  }
}

async function executarRotinaSemanalUpdate(force = false) {
  const estado = lerEstadoUpdate()
  const devido = force ? true : deveChecarSemanalmente(estado)
  const proximoCheckAt = force
    ? calcularProximoCheck(new Date().toISOString())
    : calcularProximoCheck(estado.lastCheckAt)

  if (!devido) {
    return {
      ok: true,
      checked: false,
      skipped: true,
      weeklyEnabled: estado.weeklyEnabled,
      lastCheckAt: estado.lastCheckAt || '',
      nextCheckAt: proximoCheckAt,
      lastResult: estado.lastResult || null
    }
  }

  const updateCheck = await verificarAtualizacaoApp()
  const checkedAt = new Date().toISOString()
  registrarResultadoUpdate(updateCheck, checkedAt)

  return {
    ok: true,
    checked: true,
    skipped: false,
    weeklyEnabled: estado.weeklyEnabled,
    lastCheckAt: checkedAt,
    nextCheckAt: calcularProximoCheck(checkedAt),
    updateCheck
  }
}

function baixarArquivo(url, destino, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url)
      const lib = u.protocol === 'https:' ? https : http
      const req = lib.request(u, {
        method: 'GET',
        headers: { 'User-Agent': `ZapDisparo/${app.getVersion()}` },
        timeout: 60000
      }, (res) => {
        const status = Number(res.statusCode || 0)
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          const prox = new URL(res.headers.location, url).toString()
          res.resume()
          return resolve(baixarArquivo(prox, destino, onProgress))
        }
        if (status < 200 || status >= 300) {
          res.resume()
          return reject(new Error(`Falha no download (HTTP ${status}).`))
        }
        const total = Number(res.headers['content-length'] || 0)
        let recebido = 0
        const ws = fs.createWriteStream(destino)
        res.on('data', (chunk) => {
          recebido += chunk.length
          if (typeof onProgress === 'function' && total > 0) {
            const pct = Math.max(0, Math.min(100, Math.round((recebido / total) * 100)))
            onProgress({ pct, recebido, total })
          }
        })
        res.pipe(ws)
        ws.on('finish', () => {
          ws.close(() => resolve(destino))
        })
        ws.on('error', (err) => {
          try { ws.close(() => {}) } catch (e) {}
          reject(err)
        })
      })
      req.on('timeout', () => req.destroy(new Error('Timeout no download.')))
      req.on('error', reject)
      req.end()
    } catch (e) {
      reject(e)
    }
  })
}

// â”€â”€ ESTADO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let wClient    = null
let wStatus    = 'desconectado'
let wQR        = null
let wInfo      = {}
let win        = null
let disparando = false
let pausado    = false
let initTimer  = null
let logMsgs    = []
const WA_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
let reconnectTimer = null
let reconnectAttempts = 0
let manualStopRequested = false
let authFinalizeTimer = null
let wStarting = false
let scheduleTimer = null
let scheduleProcessing = false
let wRecovering = null
const SESSION_CLIENT_ID = 'zapdisparo-ghz'

function emit(canal, dados) {
  try { if (win && !win.isDestroyed()) win.webContents.send(canal, dados) } catch(e) {}
}
function addLog(tipo, texto, numero) {
  const e = { id: Date.now(), tipo, texto, numero: numero||'', hora: new Date().toLocaleTimeString('pt-BR') }
  logMsgs.push(e)
  if (logMsgs.length > 500) logMsgs = logMsgs.slice(-500)
  try {
    const dir = getDataDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString()
    fs.appendFileSync(path.join(dir, 'wpp_logs.txt'), `[${stamp}] [${tipo.toUpperCase()}] ${texto}${numero ? ` | ${numero}` : ''}\n`)
  } catch (err) {}
  emit('zd:log', e)
}
function emitStatus(status, extra) {
  wStatus = status
  emit('zd:wstatus', { status, ...extra })
}

function getSessionDir() {
  return path.join(getDataDir(), 'wwebjs_auth', `session-${SESSION_CLIENT_ID}`)
}

function limparLocksSessao() {
  const sessionDir = getSessionDir()
  const lockFiles = [
    'SingletonLock',
    'SingletonCookie',
    'SingletonSocket',
    'DevToolsActivePort',
    'lockfile'
  ]
  const dirs = [sessionDir, path.join(sessionDir, 'Default')]
  let removed = 0

  for (const d of dirs) {
    for (const f of lockFiles) {
      const p = path.join(d, f)
      try {
        if (fs.existsSync(p)) {
          fs.rmSync(p, { force: true })
          removed += 1
        }
      } catch (e) {}
    }
  }
  return removed
}

async function matarNavegadoresSessao() {
  const needle = `session-${SESSION_CLIENT_ID}`.toLowerCase()
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const psScript = [
        `$needle = "${needle}"`,
        '$targets = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {',
        '  $_.Name -match "chrome|msedge|chromium" -and $_.CommandLine -and $_.CommandLine.ToLower().Contains($needle)',
        '}',
        'foreach ($p in $targets) {',
        '  try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {}',
        '}'
      ].join('; ')
      const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], { windowsHide: true })
      const done = () => resolve()
      p.on('error', done)
      p.on('close', done)
      setTimeout(() => {
        try { p.kill('SIGTERM') } catch (e) {}
        resolve()
      }, 5000)
    })
    return
  }

  await new Promise((resolve) => {
    const p = spawn('pkill', ['-f', needle], { stdio: 'ignore' })
    const done = () => resolve()
    p.on('error', done)
    p.on('close', done)
    setTimeout(() => {
      try { p.kill('SIGTERM') } catch (e) {}
      resolve()
    }, 3000)
  })
}

async function recuperarSessaoTravada(tag = 'pre-init') {
  await matarNavegadoresSessao()
  const removed = limparLocksSessao()
  if (removed > 0) {
    addLog('sistema', `Recuperacao de sessao (${tag}): ${removed} lock(s) removido(s).`)
  }
}

function traduzirErroConexao(msg) {
  const m = String(msg || '')
  if (m.includes('already running') || m.includes('userDataDir')) {
    return 'Sessao travada por navegador preso. O app ja limpou e vai tentar novamente.'
  }
  if (m.includes('auth timeout')) {
    return 'Tempo de autenticacao esgotado. Clique em Limpar Sessao e tente novamente.'
  }
  if (m.includes('Timeout')) {
    return 'Tempo de resposta excedido ao iniciar o WhatsApp. Tente novamente.'
  }
  return m
}

// â”€â”€ JANELA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function createWindow() {
  const dir = getDataDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1100, minHeight: 700,
    title: 'ZapDisparo', autoHideMenuBar: true, show: false,
    backgroundColor: '#0b160b',
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#0b160b', symbolColor: '#e8f0e8', height: 34 }
    } : {}),
    webPreferences: {
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true, // OBRIGATÃ“RIO â€” app usa iframes
      contextIsolation: false,
      webSecurity: false,
      additionalArguments: ['--data-dir='+dir]
    }
  })
  win.loadFile('index.html')
  win.once('ready-to-show', () => { win.show(); win.focus() })
  setTimeout(() => { if (win && !win.isVisible()) win.show() }, 4000)
  win.on('page-title-updated', e => e.preventDefault())
  win.on('closed', () => { pararTimers(); pararAgendador(); win = null })
}

function pararTimers() {
  if (initTimer) { clearTimeout(initTimer); initTimer = null }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  if (authFinalizeTimer) { clearTimeout(authFinalizeTimer); authFinalizeTimer = null }
}

function pararAgendador() {
  if (scheduleTimer) { clearInterval(scheduleTimer); scheduleTimer = null }
}

function agendarReconexao(motivo) {
  if (manualStopRequested) return
  if (reconnectTimer) return

  reconnectAttempts += 1
  const delayMs = Math.min(30000, 3000 + ((reconnectAttempts - 1) * 3000))
  emitStatus('conectando')
  addLog('sistema', `Conexao perdida (${motivo || 'desconectado'}). Nova tentativa em ${Math.round(delayMs / 1000)}s.`)

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null
    if (manualStopRequested) return
    await iniciarWpp(true)
  }, delayMs)
}

function iniciarWatchdogPosAuth() {
  if (authFinalizeTimer) {
    clearTimeout(authFinalizeTimer)
    authFinalizeTimer = null
  }

  authFinalizeTimer = setTimeout(async () => {
    authFinalizeTimer = null
    if (manualStopRequested || !wClient) return
    if (wStatus !== 'autenticado' && wStatus !== 'conectando') return

    try {
      let state = 'UNKNOWN'
      try { state = await wClient.getState() } catch (e) {}
      addLog('sistema', `Checagem pos-auth: estado atual ${state}.`)

      if (state === 'CONNECTED') {
        wInfo = {
          numero: wClient.info?.wid?.user || '',
          nome: wClient.info?.pushname || ''
        }
        reconnectAttempts = 0
        addLog('sistema', `Conectado. +${wInfo.numero || 'sem numero'}`)
        emitStatus('conectado', wInfo)
        return
      }

      addLog('aviso', 'Nao concluiu conexao apos autenticar. Tentando reconectar...')
      try { await wClient.destroy() } catch (e) {}
      wClient = null
      emitStatus('desconectado')
      agendarReconexao('sem_ready_pos_auth')
    } catch (err) {
      addLog('erro', `Falha na checagem pos-auth: ${err.message || String(err)}`)
      try { if (wClient) await wClient.destroy() } catch (e) {}
      wClient = null
      emitStatus('desconectado')
      agendarReconexao('erro_watchdog_auth')
    }
  }, 20000)
}

// â”€â”€ WHATSAPP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function iniciarWpp(autoRetry = false) {
  if (wStarting) {
    addLog('aviso', 'Conexao ja em andamento. Aguarde...')
    return { ok: false, message: 'Conexao ja em andamento.' }
  }
  wStarting = true

  if (!autoRetry) {
    manualStopRequested = false
    reconnectAttempts = 0
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  if (wClient) {
    try { await wClient.destroy() } catch(e) {}
    wClient = null
    await new Promise(r => setTimeout(r, 1500))
  }

  if (initTimer) {
    clearTimeout(initTimer)
    initTimer = null
  }

  emitStatus('conectando')
  addLog('sistema', autoRetry
    ? 'Reconectando automaticamente...'
    : 'Iniciando. Aguarde (na primeira vez pode demorar ate 2 minutos).')

  // Timeout: 3 minutos
  initTimer = setTimeout(() => {
    if (wStatus === 'conectando') {
      wStarting = false
      addLog('erro', 'Tempo esgotado. Clique em "Limpar Sessao" e tente novamente.')
      emitStatus('desconectado')
      if (wClient) { try { wClient.destroy() } catch(e) {} wClient = null }
      if (reconnectAttempts >= 2) {
        try {
          const sp = path.join(getDataDir(), 'wwebjs_auth')
          if (fs.existsSync(sp)) fs.rmSync(sp, { recursive: true, force: true })
          addLog('sistema', 'Sessao antiga removida automaticamente para recuperar conexao.')
        } catch (e) {}
      }
      agendarReconexao('timeout')
    }
  }, 180000)

  try {
    await recuperarSessaoTravada('pre-init')

    const { Client, LocalAuth } = require('whatsapp-web.js')
    const qrcode = require('qrcode')

    const chromePath = encontrarChrome()
    if (chromePath) {
      const nome = chromePath.includes('msedge') ? 'Edge' :
                   chromePath.includes('asar.unpacked') ? 'Chromium interno' : 'Chrome'
      addLog('sistema', `Navegador detectado: ${nome}`)
    } else {
      addLog('sistema', 'Localizando Chromium automaticamente...')
    }

    addLog('sistema', 'Carregando Chrome...')

    const puppeteerBaseOpts = {
      headless: 'new',
      handleSIGINT: false,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas', '--disable-gpu', '--no-first-run',
        '--no-default-browser-check', '--disable-extensions',
        '--disable-background-networking', '--disable-default-apps',
        '--disable-sync', '--mute-audio', '--safebrowsing-disable-auto-update',
        '--disable-features=Translate,MediaRouter',
        '--disable-blink-features=AutomationControlled'
      ]
    }
    const puppeteerComPath = chromePath
      ? { ...puppeteerBaseOpts, executablePath: chromePath }
      : { ...puppeteerBaseOpts }
    const puppeteerSemPath = { ...puppeteerBaseOpts }

    const clientBaseOpts = {
      authStrategy: new LocalAuth({
        dataPath: path.join(getDataDir(), 'wwebjs_auth'),
        clientId: SESSION_CLIENT_ID
      }),
      puppeteer: puppeteerComPath,
      authTimeoutMs: 120000,
      qrMaxRetries: 6,
      takeoverOnConflict: true,
      takeoverTimeoutMs: 0,
      userAgent: WA_USER_AGENT
    }

    const initAttempts = [
      {
        name: chromePath ? 'chrome-path-no-cache' : 'auto-browser-no-cache',
        opts: {
          ...clientBaseOpts,
          webVersionCache: { type: 'none' }
        }
      },
      {
        name: 'auto-browser-no-cache',
        opts: {
          ...clientBaseOpts,
          puppeteer: puppeteerSemPath,
          webVersionCache: { type: 'none' }
        }
      },
      {
        name: 'local-cache-fallback',
        opts: {
          ...clientBaseOpts,
          puppeteer: puppeteerSemPath,
          webVersionCache: { type: 'local' }
        }
      }
    ]

    wClient = null
    let createErr = null
    for (const attempt of initAttempts) {
      try {
        addLog('sistema', `Inicializando motor (${attempt.name})...`)
        wClient = new Client(attempt.opts)
        createErr = null
        break
      } catch (err) {
        createErr = err
        wClient = null
      }
    }

    if (!wClient) {
      throw createErr || new Error('Falha ao criar cliente WhatsApp.')
    }

    wClient.on('loading_screen', (p) => {
      addLog('sistema', `Carregando WhatsApp: ${p}%`)
    })
    wClient.on('qr', async (qr) => {
      pararTimers()
      addLog('sistema', 'QR Code gerado. Escaneie com o WhatsApp no celular.')
      emitStatus('aguardando_qr')
      try { wQR = await qrcode.toDataURL(qr, { width: 300, margin: 2 }); emit('zd:qr', { qr: wQR }) }
      catch(e) { emit('zd:qr', { qrText: qr }) }
    })
    wClient.on('authenticated', () => {
      addLog('sistema', 'Autenticado. Finalizando...')
      emitStatus('autenticado')
      iniciarWatchdogPosAuth()
    })
    wClient.on('change_state', (state) => {
      addLog('sistema', `Estado WhatsApp: ${state}`)
      if (state === 'CONNECTED' && wStatus !== 'conectado') {
        wInfo = { numero: wClient.info?.wid?.user || '', nome: wClient.info?.pushname || '' }
        reconnectAttempts = 0
        emitStatus('conectado', wInfo)
      }
    })
    wClient.on('ready', () => {
      pararTimers()
      wInfo = { numero: wClient.info?.wid?.user||'', nome: wClient.info?.pushname||'' }
      addLog('sistema', `Conectado. +${wInfo.numero}`)
      reconnectAttempts = 0
      emitStatus('conectado', wInfo)
    })
    wClient.on('disconnected', (r) => {
      pararTimers()
      const motivo = String(r || 'desconectado')
      addLog('sistema', `Desconectado: ${motivo}`)
      emitStatus('desconectado')
      wClient = null
      agendarReconexao(motivo)
    })
    wClient.on('auth_failure', () => {
      pararTimers()
      addLog('erro', 'Falha na autenticacao. Clique em "Limpar Sessao".')
      emitStatus('desconectado')
      wClient = null
      agendarReconexao('auth_failure')
    })

    addLog('sistema', 'Inicializando conexao com WhatsApp...')
    await wClient.initialize()
    return { ok: true }
  } catch(err) {
    pararTimers()
    const msg = err.message || String(err)
    addLog('erro', `Erro: ${msg}`)
    if (msg.includes('already running') || msg.includes('userDataDir')) {
      await recuperarSessaoTravada('already-running')
      addLog('sistema', 'Sessao travada detectada e limpa automaticamente.')
      if (!autoRetry) agendarReconexao('sessao_travada')
    }
    if (msg.includes('Chrome') || msg.includes('spawn') || msg.includes('executable')) {
      addLog('erro', 'Instale o Google Chrome: https://www.google.com/chrome/')
    } else {
      addLog('erro', traduzirErroConexao(msg))
    }
    emitStatus('desconectado')
    wClient = null
    if (autoRetry) {
      agendarReconexao('erro_inicializacao')
    }
    return { ok: false, message: msg }
  } finally {
    wStarting = false
  }
}

async function desconectarWpp(manual = true) {
  if (manual) manualStopRequested = true
  pararTimers()
  if (wClient) { try { await wClient.destroy() } catch(e) {} wClient = null }
  emitStatus('desconectado')
}

async function limparSessao() {
  manualStopRequested = true
  wStarting = false
  await desconectarWpp(false)
  await recuperarSessaoTravada('limpar-sessao')
  const sp = path.join(getDataDir(), 'wwebjs_auth')
  try { if (fs.existsSync(sp)) fs.rmSync(sp, { recursive: true, force: true }) } catch(e) {}
  addLog('sistema', 'Sessao limpa.')
}

// â”€â”€ DISPARO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function aplicarVariaveis(template, contato) {
  return template
    .replace(/{nome}/gi,     contato.nome     || '')
    .replace(/{empresa}/gi,  contato.empresa  || '')
    .replace(/{produto}/gi,  contato.produto  || '')
    .replace(/{valor}/gi,    contato.valor    || '')
    .replace(/{cidade}/gi,   contato.cidade   || '')
    .replace(/{campo1}/gi,   contato.campo1   || '')
    .replace(/{campo2}/gi,   contato.campo2   || '')
}

function limparTelefone(valor) {
  return String(valor || '')
    .replace(/\.0$/, '')
    .replace(/\D/g, '')
}

function montarCandidatosTelefoneBr(valor) {
  const bruto = limparTelefone(valor).replace(/^0+/, '')
  if (!bruto) return []

  const candidatos = []
  const add = (n) => {
    const d = limparTelefone(n)
    if (!d) return
    if (!candidatos.includes(d)) candidatos.push(d)
  }

  // Numero internacional nao-BR: tenta exatamente como veio.
  // Importante: 10/11 digitos sem "55" costuma ser BR local (DDD + numero),
  // entao nao deve entrar neste caminho.
  if (!bruto.startsWith('55') && bruto.length >= 12 && bruto.length <= 15) {
    add(bruto)
    return candidatos
  }

  let semPais = bruto
  if (bruto.startsWith('55') && (bruto.length === 12 || bruto.length === 13)) {
    add(bruto)
    semPais = bruto.slice(2)
  }

  semPais = semPais.replace(/^0+/, '')
  if (semPais.length > 11) semPais = semPais.slice(-11)

  if (semPais.length === 11) {
    // Formato atual: DDD + 9 + numero
    add('55' + semPais)
    // Legado: DDD + numero sem o nono digito
    if (semPais[2] === '9') add('55' + semPais.slice(0, 2) + semPais.slice(3))
  } else if (semPais.length === 10) {
    // Formato legado sem nono digito
    add('55' + semPais)
    // Variante com nono digito
    add('55' + semPais.slice(0, 2) + '9' + semPais.slice(2))
  } else if (bruto.length >= 12 && bruto.length <= 15) {
    add(bruto)
  }

  return candidatos
}

function traduzirErroEnvio(msg) {
  const original = String(msg || '').trim()
  const m = original.toLowerCase()
  if (!original) return 'Falha no envio.'
  if (
    m.includes('detached frame') ||
    m.includes('frame was detached') ||
    m.includes('execution context was destroyed') ||
    m.includes('cannot find context with specified id')
  ) {
    return 'WhatsApp Web recarregou no momento do envio. O app tentou novamente; se continuar, reconecte o WhatsApp e clique em "Enviar mensagem".'
  }
  if (m.includes('no lid for user')) {
    return 'Numero sem identificador LID no WhatsApp Web. Confira DDI/DDD e tente novamente.'
  }
  if (m.includes('wid error') || m.includes('invalid wid') || m.includes('invalid jid')) {
    return 'Numero invalido para WhatsApp (confira DDI + DDD + numero).'
  }
  if (m.includes('not registered') || m.includes('not a whatsapp user') || m.includes('is not on whatsapp')) {
    return 'Numero nao cadastrado no WhatsApp.'
  }
  if (m.includes('target closed') || m.includes('session closed') || m.includes('protocol error')) {
    return 'Sessao do WhatsApp caiu durante o envio. Reconecte e tente novamente.'
  }
  if (m.includes('not connected') || m.includes('disconnected')) {
    return 'WhatsApp desconectado no momento do envio.'
  }
  return original
}

function erroTransitorioEnvio(msg) {
  const m = String(msg || '').toLowerCase()
  return (
    m.includes('detached frame') ||
    m.includes('frame was detached') ||
    m.includes('execution context was destroyed') ||
    m.includes('cannot find context with specified id') ||
    m.includes('whatsapp web recarregou') ||
    m.includes('sessao do whatsapp caiu') ||
    m.includes('target closed') ||
    m.includes('session closed') ||
    m.includes('protocol error')
  )
}

async function aguardarWhatsAppConectado(timeoutMs = 60000) {
  const inicio = Date.now()
  while ((Date.now() - inicio) < timeoutMs) {
    if (wClient && wStatus === 'conectado') return true
    await sleep(750)
  }
  return !!(wClient && wStatus === 'conectado')
}

async function recuperarMotorEnvioWhatsApp(tag = 'envio') {
  if (wRecovering) return wRecovering

  wRecovering = (async () => {
    addLog('aviso', `WhatsApp Web ficou instavel (${tag}). Recuperando motor antes de reenviar...`)

    try {
      if (wClient?.pupPage && typeof wClient.pupPage.isClosed === 'function' && !wClient.pupPage.isClosed()) {
        await wClient.pupPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
        await sleep(6000)
        try {
          const state = await wClient.getState()
          if (state === 'CONNECTED') {
            wInfo = { numero: wClient.info?.wid?.user || wInfo.numero || '', nome: wClient.info?.pushname || wInfo.nome || '' }
            emitStatus('conectado', wInfo)
            addLog('sistema', 'WhatsApp Web recuperado apos recarregar a pagina.')
            return true
          }
        } catch (e) {}
      }
    } catch (err) {
      addLog('aviso', `Recarregamento do WhatsApp Web nao resolveu: ${traduzirErroEnvio(err.message || String(err))}`)
    }

    try {
      await iniciarWpp(true)
      const ok = await aguardarWhatsAppConectado(60000)
      if (ok) addLog('sistema', 'WhatsApp reconectado automaticamente para continuar o envio.')
      return ok
    } catch (err) {
      addLog('erro', `Falha ao recuperar WhatsApp automaticamente: ${traduzirErroEnvio(err.message || String(err))}`)
      return false
    }
  })()

  try {
    return await wRecovering
  } finally {
    wRecovering = null
  }
}

async function resolverChatIdContato(valorTelefone) {
  const candidatos = montarCandidatosTelefoneBr(valorTelefone)
  if (!candidatos.length) {
    return { ok: false, motivo: 'Numero invalido. Use DDD + numero (com ou sem 55).' }
  }

  const addUnico = (arr, valor) => {
    const v = String(valor || '').trim()
    if (!v) return
    if (!arr.includes(v)) arr.push(v)
    // Alguns fluxos retornam @s.whatsapp.net; manter variante @c.us para envio.
    if (v.endsWith('@s.whatsapp.net')) {
      const c = v.replace('@s.whatsapp.net', '@c.us')
      if (!arr.includes(c)) arr.push(c)
    }
  }

  let ultimoErro = null
  for (const numero of candidatos) {
    const possiveisIds = []
    const userId = `${numero}@c.us`

    // 1) Tenta obter mapeamento LID/PN (compatibilidade com mudancas recentes do WhatsApp Web)
    if (typeof wClient.getContactLidAndPhone === 'function') {
      try {
        const info = await wClient.getContactLidAndPhone([userId])
        const item = Array.isArray(info) ? info[0] : null
        addUnico(possiveisIds, item?.lid)
        addUnico(possiveisIds, item?.pn)
      } catch (err) {
        ultimoErro = err
      }
    }

    // 2) Fallback tradicional via queryWidExists
    try {
      const detalhado = await wClient.getNumberId(numero)
      if (detalhado && typeof detalhado === 'object') {
        if (detalhado._serialized) {
          addUnico(possiveisIds, detalhado._serialized)
        }
        if (detalhado.user && detalhado.server) {
          addUnico(possiveisIds, `${detalhado.user}@${detalhado.server}`)
        }
      }
    } catch (err) {
      ultimoErro = err
    }

    // 3) Valida qual ID realmente abre chat sem erro interno
    for (const chatId of possiveisIds) {
      try {
        const chat = await wClient.getChatById(chatId)
        if (chat) {
          return { ok: true, chatId, numeroCanonico: numero, confirmado: true }
        }
      } catch (err) {
        ultimoErro = err
      }
    }
  }

  if (ultimoErro) {
    return { ok: false, motivo: traduzirErroEnvio(ultimoErro.message || String(ultimoErro)) }
  }

  return { ok: false, motivo: 'Numero nao encontrado no WhatsApp. Confira DDI/DDD e se o numero existe no app.' }
}

async function enviarMensagemDireta(payload) {
  const telefone = limparTelefone(payload?.telefone || payload?.numero || '')
  const mensagem = String(payload?.mensagem || '').trim()
  if (!telefone || telefone.length < 8) {
    return { ok: false, motivo: 'Numero invalido. Use DDD + numero.' }
  }
  if (!mensagem) {
    return { ok: false, motivo: 'Mensagem vazia.' }
  }

  const tentativas = Math.max(1, Number(payload?.tentativas || 3))
  let ultimoMotivo = ''
  let ultimoNumero = telefone

  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    if (!wClient || wStatus !== 'conectado') {
      return { ok: false, motivo: 'WhatsApp nao conectado. Conecte o WhatsApp e tente novamente.', numero: telefone }
    }

    try {
      if (wClient.pupPage && typeof wClient.pupPage.isClosed === 'function' && wClient.pupPage.isClosed()) {
        return { ok: false, motivo: 'WhatsApp Web foi fechado internamente. Reconecte o WhatsApp e tente novamente.', numero: telefone }
      }
    } catch (e) {}

    const resolucao = await resolverChatIdContato(telefone)
    if (!resolucao.ok) {
      ultimoMotivo = resolucao.motivo
      if (erroTransitorioEnvio(ultimoMotivo) && tentativa < tentativas) {
        addLog('aviso', `WhatsApp Web instavel. Tentando novamente (${tentativa + 1}/${tentativas})...`, telefone)
        await recuperarMotorEnvioWhatsApp('resolver contato')
        await sleep(2500)
        continue
      }
      return { ok: false, motivo: ultimoMotivo, numero: telefone }
    }

    try {
      const contato = {
        telefone,
        numero: telefone,
        nome: String(payload?.nome || '').trim(),
        empresa: String(payload?.empresa || '').trim()
      }
      const texto = aplicarVariaveis(mensagem, contato)
      await wClient.sendMessage(resolucao.chatId, texto)
      return {
        ok: true,
        numero: resolucao.numeroCanonico || telefone,
        chatId: resolucao.chatId
      }
    } catch (err) {
      const erroOriginal = err.message || String(err)
      ultimoMotivo = traduzirErroEnvio(erroOriginal)
      ultimoNumero = resolucao.numeroCanonico || telefone

      if (erroTransitorioEnvio(erroOriginal) && tentativa < tentativas) {
        addLog('aviso', `WhatsApp Web recarregou durante o envio. Tentando novamente (${tentativa + 1}/${tentativas})...`, ultimoNumero)
        await recuperarMotorEnvioWhatsApp('enviar mensagem')
        await sleep(3000)
        continue
      }

      return {
        ok: false,
        numero: ultimoNumero,
        motivo: ultimoMotivo
      }
    }
  }

  return {
    ok: false,
    numero: ultimoNumero,
    motivo: ultimoMotivo || 'Falha no envio apos novas tentativas.'
  }
}

async function enviarContatoCampanhaComRetry({ contato, tel, mensagem, mediaParaEnvio, cacheChatId, tentativas = 3 }) {
  let ultimoMotivo = ''
  let ultimoNumero = tel

  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    if (!wClient || wStatus !== 'conectado') {
      return { ok: false, numero: tel, motivo: 'WhatsApp nao conectado.' }
    }

    try {
      if (wClient.pupPage && typeof wClient.pupPage.isClosed === 'function' && wClient.pupPage.isClosed()) {
        return { ok: false, numero: tel, motivo: 'WhatsApp Web foi fechado internamente. Reconecte o WhatsApp e tente novamente.' }
      }
    } catch (e) {}

    let resolucao = cacheChatId.get(tel)
    if (!resolucao || tentativa > 1) {
      resolucao = await resolverChatIdContato(tel)
      cacheChatId.set(tel, resolucao)
    }

    if (!resolucao.ok) {
      ultimoMotivo = resolucao.motivo
      cacheChatId.delete(tel)
      if (erroTransitorioEnvio(ultimoMotivo) && tentativa < tentativas) {
        addLog('aviso', `WhatsApp Web instavel. Tentando resolver novamente (${tentativa + 1}/${tentativas})...`, tel)
        await recuperarMotorEnvioWhatsApp('resolver contato do disparo')
        await sleep(2500)
        continue
      }
      return { ok: false, numero: tel, motivo: ultimoMotivo }
    }

    const chatId = resolucao.chatId
    ultimoNumero = resolucao.numeroCanonico || tel

    try {
      if (!resolucao.confirmado) {
        addLog('aviso', `Numero sem confirmacao previa. Tentando envio direto: ${ultimoNumero}`, ultimoNumero)
      }
      if (mediaParaEnvio) {
        await wClient.sendMessage(chatId, mediaParaEnvio, { caption: mensagem })
      } else {
        await wClient.sendMessage(chatId, mensagem)
      }
      return { ok: true, numero: ultimoNumero, chatId }
    } catch (err) {
      const erroOriginal = err.message || String(err)
      ultimoMotivo = traduzirErroEnvio(erroOriginal)
      cacheChatId.delete(tel)

      if (erroTransitorioEnvio(erroOriginal) && tentativa < tentativas) {
        addLog('aviso', `WhatsApp Web recarregou durante o envio. Tentando novamente (${tentativa + 1}/${tentativas})...`, ultimoNumero)
        await recuperarMotorEnvioWhatsApp('enviar contato do disparo')
        await sleep(3000)
        continue
      }

      return { ok: false, numero: ultimoNumero, motivo: ultimoMotivo }
    }
  }

  return {
    ok: false,
    numero: ultimoNumero,
    motivo: ultimoMotivo || 'Falha no envio apos novas tentativas.'
  }
}

function obterAgendadas() {
  const lista = lerJSON('agendadas', [])
  return Array.isArray(lista) ? lista : []
}

function salvarAgendadas(lista) {
  salvarJSON('agendadas', Array.isArray(lista) ? lista : [])
}

function resumirAgendadas(lista = obterAgendadas()) {
  return {
    total: lista.length,
    pendentes: lista.filter(i => i.status === 'pendente').length,
    enviados: lista.filter(i => i.status === 'enviado').length,
    erros: lista.filter(i => i.status === 'erro').length
  }
}

function emitirAgendadasAtualizadas(lista = obterAgendadas()) {
  emit('zd:agendadas_atualizadas', resumirAgendadas(lista))
}

function normalizarAgendada(payload) {
  const telefone = limparTelefone(payload?.telefone || payload?.numero || '')
  const mensagem = String(payload?.mensagem || '').trim()
  const nome = String(payload?.nome || '').trim()
  const scheduledAtRaw = String(payload?.scheduledAt || '').trim()
  const scheduledTs = Date.parse(scheduledAtRaw)

  if (!telefone || telefone.length < 8) {
    return { ok: false, motivo: 'Informe um numero valido com DDD.' }
  }
  if (!mensagem) {
    return { ok: false, motivo: 'Escreva a mensagem que sera enviada.' }
  }
  if (!Number.isFinite(scheduledTs)) {
    return { ok: false, motivo: 'Informe uma data e horario validos.' }
  }
  if (scheduledTs < Date.now() - 60 * 1000) {
    return { ok: false, motivo: 'O horario precisa ser futuro.' }
  }

  return {
    ok: true,
    item: {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      nome,
      telefone,
      mensagem,
      scheduledAt: new Date(scheduledTs).toISOString(),
      status: 'pendente',
      attempts: 0,
      lastError: '',
      createdAt: new Date().toISOString(),
      sentAt: '',
      errorAt: ''
    }
  }
}

function criarAgendada(payload) {
  const normalizada = normalizarAgendada(payload)
  if (!normalizada.ok) return normalizada

  const lista = obterAgendadas()
  lista.unshift(normalizada.item)
  salvarAgendadas(lista)
  emitirAgendadasAtualizadas(lista)
  return { ok: true, item: normalizada.item }
}

function removerAgendada(id) {
  const lista = obterAgendadas()
  const novaLista = lista.filter(item => String(item.id) !== String(id))
  salvarAgendadas(novaLista)
  emitirAgendadasAtualizadas(novaLista)
  return { ok: true }
}

async function enviarAgendadaPorId(id, manual = false) {
  const lista = obterAgendadas()
  const idx = lista.findIndex(item => String(item.id) === String(id))
  if (idx < 0) return { ok: false, motivo: 'Agendamento nao encontrado.' }

  const item = { ...lista[idx] }
  const resultado = await enviarMensagemDireta({
    telefone: item.telefone,
    nome: item.nome,
    mensagem: item.mensagem
  })

  const atualizada = obterAgendadas()
  const idxAtual = atualizada.findIndex(i => String(i.id) === String(id))
  if (idxAtual < 0) return { ok: false, motivo: 'Agendamento removido durante o envio.' }

  const agora = new Date().toISOString()
  atualizada[idxAtual] = {
    ...atualizada[idxAtual],
    attempts: Number(atualizada[idxAtual].attempts || 0) + 1,
    status: resultado.ok ? 'enviado' : 'erro',
    sentAt: resultado.ok ? agora : atualizada[idxAtual].sentAt || '',
    errorAt: resultado.ok ? '' : agora,
    lastError: resultado.ok ? '' : (resultado.motivo || 'Falha no envio.'),
    manualRetryAt: manual ? agora : atualizada[idxAtual].manualRetryAt || ''
  }
  salvarAgendadas(atualizada)
  emitirAgendadasAtualizadas(atualizada)

  if (resultado.ok) {
    addLog('enviado', `Agendada enviada: ${item.nome || resultado.numero}`, resultado.numero)
    return { ok: true, item: atualizada[idxAtual] }
  }

  addLog('erro', `Erro em agendada ${item.nome || item.telefone}: ${resultado.motivo}`, item.telefone)
  return { ok: false, motivo: resultado.motivo, item: atualizada[idxAtual] }
}

function marcarAgendadasPerdidasAoAbrir() {
  const estado = lerJSON('agendadas_state', {})
  const lastSeenTs = Date.parse(String(estado.lastSeenAt || ''))
  const now = Date.now()
  const lista = obterAgendadas()
  let mudou = false

  for (const item of lista) {
    if (item.status !== 'pendente') continue
    const ts = Date.parse(String(item.scheduledAt || ''))
    if (!Number.isFinite(ts)) {
      item.status = 'erro'
      item.lastError = 'Data ou horario invalido no agendamento.'
      item.errorAt = new Date().toISOString()
      mudou = true
      continue
    }
    if (ts <= now && (!Number.isFinite(lastSeenTs) || lastSeenTs < ts)) {
      item.status = 'erro'
      item.lastError = 'O app estava fechado no horario agendado. Use "Enviar mensagem" para tentar agora.'
      item.errorAt = new Date().toISOString()
      mudou = true
    }
  }

  if (mudou) {
    salvarAgendadas(lista)
    emitirAgendadasAtualizadas(lista)
  }
}

async function processarAgendadas() {
  if (scheduleProcessing) return
  scheduleProcessing = true

  try {
    const now = Date.now()
    let lista = obterAgendadas()
    const idsParaEnviar = []
    let mudou = false

    for (const item of lista) {
      if (item.status !== 'pendente') continue
      const ts = Date.parse(String(item.scheduledAt || ''))
      if (!Number.isFinite(ts)) {
        item.status = 'erro'
        item.lastError = 'Data ou horario invalido no agendamento.'
        item.errorAt = new Date().toISOString()
        mudou = true
        continue
      }
      if (ts > now) continue

      if (!wClient || wStatus !== 'conectado') {
        item.status = 'erro'
        item.lastError = 'WhatsApp nao estava conectado no horario agendado.'
        item.errorAt = new Date().toISOString()
        mudou = true
        continue
      }

      idsParaEnviar.push(item.id)
    }

    if (mudou) {
      salvarAgendadas(lista)
      emitirAgendadasAtualizadas(lista)
    }

    salvarJSON('agendadas_state', { lastSeenAt: new Date().toISOString() })

    for (const id of idsParaEnviar) {
      await enviarAgendadaPorId(id, false)
    }
  } finally {
    scheduleProcessing = false
  }
}

function iniciarAgendador() {
  if (scheduleTimer) clearInterval(scheduleTimer)
  marcarAgendadasPerdidasAoAbrir()
  processarAgendadas()
  scheduleTimer = setInterval(processarAgendadas, SCHEDULE_TICK_MS)
}

async function iniciarDisparo(campanha) {
  if (!wClient || wStatus !== 'conectado') {
    emit('zd:disparo_erro', { erro: 'WhatsApp nao conectado.' })
    return
  }
  disparando = true
  pausado    = false
  const contatos = campanha.contatos
  const delayMin  = Number(campanha.delayMin || 10)
  const delayMax  = Number(campanha.delayMax || 25)
  let enviados   = 0, erros = 0, pulados = 0
  let mediaParaEnvio = null
  const cacheChatId = new Map()

  emit('zd:disparo_inicio', { total: contatos.length })
  addLog('sistema', `Disparo iniciado - ${contatos.length} contatos.`)

  if (campanha.imagemBase64 || campanha.imagemPath) {
    try {
      const { MessageMedia } = require('whatsapp-web.js')
      const nomeArquivo = String(campanha.imagemNome || '').trim() || 'imagem.jpg'
      const caminhoImagem = String(campanha.imagemPath || '').trim()

      if (caminhoImagem && fs.existsSync(caminhoImagem)) {
        mediaParaEnvio = MessageMedia.fromFilePath(caminhoImagem)
      } else {
        const base64 = String(campanha.imagemBase64).includes(',')
          ? String(campanha.imagemBase64).split(',')[1]
          : String(campanha.imagemBase64)
        const mime = String(campanha.imagemMime || '').trim() || 'image/jpeg'
        mediaParaEnvio = new MessageMedia(mime, base64, nomeArquivo)
      }

      addLog('sistema', `Anexo de imagem pronto: ${nomeArquivo}`)
    } catch (err) {
      emit('zd:disparo_erro', { erro: `Falha ao preparar imagem anexada: ${err.message}` })
      addLog('erro', `Falha ao preparar imagem anexada: ${err.message}`)
      disparando = false
      return
    }
  }

  for (let i = 0; i < contatos.length; i++) {
    // Aguardar se pausado
    while (pausado && disparando) await sleep(500)
    if (!disparando) break

    const c   = contatos[i]
    const tel = limparTelefone(c.telefone || c.numero || c.celular || '')
    if (!tel || tel.length < 8) {
      pulados++
      emit('zd:disparo_progresso', { i: i+1, total: contatos.length, enviados, erros, pulados, status: 'pulado', contato: c.nome||tel, numero: tel, motivo: 'Numero invalido' })
      addLog('aviso', `Numero invalido pulado: ${c.nome || c.telefone}`, tel)
      continue
    }

    const mensagem = aplicarVariaveis(campanha.mensagem, c)
    const resultadoEnvio = await enviarContatoCampanhaComRetry({
      contato: c,
      tel,
      mensagem,
      mediaParaEnvio,
      cacheChatId,
      tentativas: 3
    })

    if (resultadoEnvio.ok) {
      enviados++
      emit('zd:disparo_progresso', {
        i: i+1, total: contatos.length, enviados, erros, pulados,
        status: 'enviado', contato: c.nome || resultadoEnvio.numero, numero: resultadoEnvio.numero
      })
      addLog('enviado', `Enviado: ${c.nome || resultadoEnvio.numero}`, resultadoEnvio.numero)
    } else {
      erros++
      emit('zd:disparo_progresso', {
        i: i+1, total: contatos.length, enviados, erros, pulados,
        status: 'erro', contato: c.nome || resultadoEnvio.numero, numero: resultadoEnvio.numero, motivo: resultadoEnvio.motivo
      })
      addLog('erro', `Erro ao enviar para ${c.nome || resultadoEnvio.numero}: ${resultadoEnvio.motivo}`, resultadoEnvio.numero)
    }

    // Delay entre mensagens (nÃ£o na Ãºltima)
    if (i < contatos.length - 1 && disparando && !pausado) {
      const delayAleatorio = Math.floor(Math.random() * (delayMax - delayMin + 1) + delayMin) * 1000
      emit('zd:aguardando', { delay: Math.round(delayAleatorio/1000), proximo: i+2 })
      await sleep(delayAleatorio)
    }
  }

  disparando = false
  const resultado = { enviados, erros, pulados, total: contatos.length }

  // Salvar no histÃ³rico
  const hist = lerJSON('historico', [])
  hist.unshift({
    id:        Date.now(),
    nome:      campanha.nome || 'Disparo',
    data:      new Date().toLocaleDateString('pt-BR'),
    hora:      new Date().toLocaleTimeString('pt-BR'),
    ...resultado
  })
  salvarJSON('historico', hist.slice(0, 100))

  emit('zd:disparo_fim', resultado)
  addLog('sistema', `Disparo concluido. Enviados: ${enviados} | Erros: ${erros} | Pulados: ${pulados}`)
}

async function iniciarDisparoGrupos(campanha) {
  if (!wClient || wStatus !== 'conectado') {
    emit('zd:disparo_erro', { erro: 'WhatsApp nao conectado.' })
    return
  }
  disparando = true
  pausado    = false
  const grupos    = campanha.grupos
  const delayMin  = Number(campanha.delayMin || 10)
  const delayMax  = Number(campanha.delayMax || 25)
  let enviados = 0, erros = 0
  let mediaParaEnvio = null

  emit('zd:disparo_inicio', { total: grupos.length })
  addLog('sistema', `Disparo em grupos iniciado - ${grupos.length} grupo(s).`)

  if (campanha.imagemBase64 || campanha.imagemPath) {
    try {
      const { MessageMedia } = require('whatsapp-web.js')
      const nomeArquivo = String(campanha.imagemNome || '').trim() || 'imagem.jpg'
      const caminhoImagem = String(campanha.imagemPath || '').trim()

      if (caminhoImagem && fs.existsSync(caminhoImagem)) {
        mediaParaEnvio = MessageMedia.fromFilePath(caminhoImagem)
      } else {
        const base64 = String(campanha.imagemBase64).includes(',')
          ? String(campanha.imagemBase64).split(',')[1]
          : String(campanha.imagemBase64)
        const mime = String(campanha.imagemMime || '').trim() || 'image/jpeg'
        mediaParaEnvio = new MessageMedia(mime, base64, nomeArquivo)
      }

      addLog('sistema', `Anexo de imagem pronto: ${nomeArquivo}`)
    } catch (err) {
      emit('zd:disparo_erro', { erro: `Falha ao preparar imagem anexada: ${err.message}` })
      addLog('erro', `Falha ao preparar imagem anexada: ${err.message}`)
      disparando = false
      return
    }
  }

  for (let i = 0; i < grupos.length; i++) {
    while (pausado && disparando) await sleep(500)
    if (!disparando) break

    const g = grupos[i]
    const chatId = g.id
    const nome = g.nome || 'Grupo'

    if (!chatId) {
      erros++
      emit('zd:disparo_progresso', { i: i+1, total: grupos.length, enviados, erros, pulados: 0, status: 'erro', contato: nome, numero: '', motivo: 'ID do grupo invalido' })
      addLog('erro', `ID invalido para grupo: ${nome}`)
      continue
    }

    const mensagem = campanha.mensagem

    const MAX_TENTATIVAS = 3
    let enviou = false
    let ultimoMotivo = ''

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      if (!wClient || wStatus !== 'conectado') {
        ultimoMotivo = 'WhatsApp nao conectado.'
        break
      }

      try {
        if (mediaParaEnvio) {
          await wClient.sendMessage(chatId, mediaParaEnvio, { caption: mensagem })
        } else {
          await wClient.sendMessage(chatId, mensagem)
        }
        enviou = true
        break
      } catch (err) {
        ultimoMotivo = traduzirErroEnvio(err.message || String(err))
        if (erroTransitorioEnvio(err.message || String(err)) && tentativa < MAX_TENTATIVAS) {
          addLog('aviso', `Erro transitorio no grupo ${nome}. Tentando novamente (${tentativa + 1}/${MAX_TENTATIVAS})...`)
          await recuperarMotorEnvioWhatsApp('enviar grupo')
          await sleep(3000)
          continue
        }
      }
    }

    if (enviou) {
      enviados++
      emit('zd:disparo_progresso', {
        i: i+1, total: grupos.length, enviados, erros, pulados: 0,
        status: 'enviado', contato: nome, numero: chatId
      })
      addLog('enviado', `Enviado para grupo: ${nome}`, chatId)
    } else {
      erros++
      emit('zd:disparo_progresso', {
        i: i+1, total: grupos.length, enviados, erros, pulados: 0,
        status: 'erro', contato: nome, numero: chatId, motivo: ultimoMotivo
      })
      addLog('erro', `Erro ao enviar para grupo ${nome}: ${ultimoMotivo}`, chatId)
    }

    if (i < grupos.length - 1 && disparando && !pausado) {
      const delayAleatorio = Math.floor(Math.random() * (delayMax - delayMin + 1) + delayMin) * 1000
      emit('zd:aguardando', { delay: Math.round(delayAleatorio/1000), proximo: i+2 })
      await sleep(delayAleatorio)
    }
  }

  disparando = false
  const resultado = { enviados, erros, pulados: 0, total: grupos.length }

  const hist = lerJSON('historico', [])
  hist.unshift({
    id:        Date.now(),
    nome:      campanha.nome || 'Disparo em Grupos',
    data:      new Date().toLocaleDateString('pt-BR'),
    hora:      new Date().toLocaleTimeString('pt-BR'),
    ...resultado
  })
  salvarJSON('historico', hist.slice(0, 100))

  emit('zd:disparo_fim', resultado)
  addLog('sistema', `Disparo em grupos concluido. Enviados: ${enviados} | Erros: ${erros}`)
}

// â”€â”€ IPC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ipcMain.handle('wpp:iniciar',       async () => iniciarWpp())
ipcMain.handle('wpp:desconectar',   async () => { await desconectarWpp(true); return { ok: true } })
ipcMain.handle('wpp:limpar',        async () => { await limparSessao(); return { ok: true } })
ipcMain.handle('wpp:status',        async () => ({ status: wStatus, info: wInfo }))
ipcMain.handle('app:update-check',  async () => {
  const updateCheck = await verificarAtualizacaoApp()
  registrarResultadoUpdate(updateCheck)
  return updateCheck
})
ipcMain.handle('app:update-weekly-status', async () => {
  const estado = lerEstadoUpdate()
  return {
    ok: true,
    weeklyEnabled: estado.weeklyEnabled,
    lastCheckAt: estado.lastCheckAt || '',
    nextCheckAt: calcularProximoCheck(estado.lastCheckAt),
    lastResult: estado.lastResult || null,
    pendingUpdateVersion: estado.pendingUpdateVersion || '',
    pendingUpdateDetectedAt: estado.pendingUpdateDetectedAt || ''
  }
})
ipcMain.handle('app:update-weekly-set-enabled', async (e, enabled) => {
  const estado = salvarEstadoUpdate({ weeklyEnabled: !!enabled })
  return {
    ok: true,
    weeklyEnabled: estado.weeklyEnabled,
    lastCheckAt: estado.lastCheckAt || '',
    nextCheckAt: calcularProximoCheck(estado.lastCheckAt),
    pendingUpdateVersion: estado.pendingUpdateVersion || '',
    pendingUpdateDetectedAt: estado.pendingUpdateDetectedAt || ''
  }
})
ipcMain.handle('app:update-weekly-run', async (e, payload) => {
  const force = !!payload?.force
  return executarRotinaSemanalUpdate(force)
})
ipcMain.handle('app:engine-status', async () => obterStatusMotores())
ipcMain.handle('app:update-pending-notice', async () => obterAvisoUpdatePendente())
ipcMain.handle('app:update-download-install', async (e, payload) => {
  try {
    const url = String(payload?.downloadUrl || '').trim()
    const latestVersion = String(payload?.latestVersion || '').trim() || 'nova'
    if (!url) return { ok: false, message: 'URL de download nao informada.' }

    let targetPath = ''
    if (/^https?:\/\//i.test(url)) {
      const tempDir = path.join(app.getPath('temp'), 'zapdisparo_updates')
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

      let fileName = ''
      try {
        const u = new URL(url)
        fileName = path.basename(u.pathname || '')
      } catch (e) {}
      if (!fileName || !fileName.toLowerCase().endsWith('.exe')) {
        fileName = `ZapDisparo-Setup-${latestVersion}.exe`
      }
      targetPath = path.join(tempDir, fileName)

      emit('zd:update_status', { state: 'downloading', percent: 0, text: 'Baixando atualizacao...' })
      await baixarArquivo(url, targetPath, (info) => {
        emit('zd:update_status', {
          state: 'downloading',
          percent: info.pct || 0,
          text: `Baixando atualizacao... ${info.pct || 0}%`
        })
      })
      emit('zd:update_status', { state: 'ready', percent: 100, text: 'Download concluido. Abrindo instalador...' })
    } else {
      targetPath = /^file:\/\//i.test(url) ? fileURLToPath(url) : url
      if (!fs.existsSync(targetPath)) {
        return { ok: false, message: 'Arquivo local do instalador nao encontrado.' }
      }
      emit('zd:update_status', { state: 'ready', percent: 100, text: 'Abrindo instalador local...' })
    }

    setTimeout(() => {
      try {
        const child = spawn(targetPath, [], { detached: true, stdio: 'ignore', windowsHide: false })
        child.unref()
      } catch (e) {}
      salvarEstadoUpdate({ pendingUpdateVersion: '', pendingUpdateDetectedAt: '' })
      setTimeout(() => app.quit(), 800)
    }, 250)

    return { ok: true, path: targetPath }
  } catch (err) {
    emit('zd:update_status', { state: 'error', text: `Erro no download: ${err.message || String(err)}` })
    return { ok: false, message: err.message || String(err) }
  }
})

ipcMain.handle('disparo:iniciar',   async (e, campanha) => { iniciarDisparo(campanha); return { ok: true } })
ipcMain.handle('disparo:iniciarGrupos', async (e, campanha) => { iniciarDisparoGrupos(campanha); return { ok: true } })
ipcMain.handle('disparo:pausar',    async () => { pausado = true;  addLog('sistema','Pausado.'); return { ok: true } })
ipcMain.handle('disparo:retomar',   async () => { pausado = false; addLog('sistema','Retomado.'); return { ok: true } })
ipcMain.handle('disparo:parar',     async () => { disparando = false; pausado = false; addLog('sistema','Disparo interrompido.'); return { ok: true } })
ipcMain.handle('disparo:status',    async () => ({ disparando, pausado }))

ipcMain.handle('agendadas:listar', async () => ({ ok: true, itens: obterAgendadas(), resumo: resumirAgendadas() }))
ipcMain.handle('agendadas:criar', async (e, payload) => criarAgendada(payload))
ipcMain.handle('agendadas:remover', async (e, id) => removerAgendada(id))
ipcMain.handle('agendadas:enviar-agora', async (e, id) => enviarAgendadaPorId(id, true))
ipcMain.handle('agendadas:processar', async () => { await processarAgendadas(); return { ok: true, resumo: resumirAgendadas() } })

ipcMain.handle('dados:ler',    async (e, nome)        => lerJSON(nome, []))
ipcMain.handle('dados:salvar', async (e, nome, dados) => { salvarJSON(nome, dados); return { ok: true } })


// â”€â”€ IMPORTAR EXCEL/CSV â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ipcMain.handle('importar:arquivo', async () => {
  try {
    const { filePaths, canceled } = await dialog.showOpenDialog(win, {
      filters: [{ name: 'Planilha / CSV', extensions: ['xlsx','xls','csv'] }],
      properties: ['openFile']
    })
    if (canceled || !filePaths.length) return { ok: false, motivo: 'cancelado' }
    const XLSX = require('xlsx')
    const wb   = XLSX.readFile(filePaths[0])
    const ws   = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })
    return { ok: true, dados: rows, arquivo: path.basename(filePaths[0]) }
  } catch(err) { return { ok: false, motivo: err.message } }
})

// â”€â”€ SALVAR PLANILHA MODELO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ipcMain.handle('salvar:modelo', async () => {
  try {
    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: 'Salvar Planilha Modelo',
      defaultPath: 'modelo_zapdisparo.xlsx',
      filters: [{ name: 'Planilha Excel', extensions: ['xlsx'] }]
    })
    if (canceled || !filePath) return { ok: false, motivo: 'cancelado' }
    const XLSX = require('xlsx')
    const dados = [
      ['telefone', 'nome', 'empresa', 'produto', 'valor', 'campo1', 'campo2'],
      ['11999999999', 'JoÃ£o Silva', 'Empresa do JoÃ£o', 'Notebook Dell', 'R$ 2.499,00', '', ''],
      ['21988887777', 'Maria Santos', 'Loja da Maria', 'Celular Samsung', 'R$ 1.299,00', '', ''],
      ['31977776666', 'Carlos Oliveira', '', 'Produto Teste', 'R$ 599,00', '', '']
    ]
    const ws = XLSX.utils.aoa_to_sheet(dados)
    ws['!cols'] = [{wch:16},{wch:20},{wch:22},{wch:22},{wch:14},{wch:14},{wch:14}]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Contatos ZapDisparo')
    XLSX.writeFile(wb, filePath)
    return { ok: true, caminho: filePath }
  } catch(err) { return { ok: false, motivo: err.message } }
})

// â”€â”€ LISTAS E TEMPLATES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ipcMain.handle('listas:ler',       async ()        => lerJSON('listas', []))
ipcMain.handle('listas:salvar',    async (e, d)    => { salvarJSON('listas', d); return { ok: true } })
ipcMain.handle('templates:ler',    async ()        => lerJSON('templates', []))
ipcMain.handle('templates:salvar', async (e, d)    => { salvarJSON('templates', d); return { ok: true } })
ipcMain.handle('wpp:listarGrupos', async () => {
  if (!wClient || wStatus !== 'conectado') return { ok: false, motivo: 'WhatsApp nao conectado.' }
  try {
    const chats = await wClient.getChats()
    const grupos = chats
      .filter(c => c.isGroup)
      .map(c => ({
        id: c.id._serialized || c.id,
        nome: c.name || 'Grupo sem nome',
        participantes: c.participants ? c.participants.length : 0
      }))
    return { ok: true, grupos }
  } catch (err) {
    return { ok: false, motivo: err.message || String(err) }
  }
})
ipcMain.handle('hist:ler',         async ()        => lerJSON('historico', []))
ipcMain.handle('hist:limpar',      async ()        => { salvarJSON('historico', []); return { ok: true } })
ipcMain.handle('wpp:logs',         async ()        => logMsgs)

// ── LICENÇA SUPABASE ─────────────────────────────────────
const setupLicense = require('./ghz-license-only')
setupLicense({ app, ipcMain, getDataDir })

// â”€â”€ CICLO DE VIDA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.whenReady().then(() => {
  createWindow()
  iniciarAgendador()
})
app.on('window-all-closed', async () => {
  pararTimers()
  pararAgendador()
  await desconectarWpp(true)
  if (process.platform !== 'darwin') app.quit()
})



