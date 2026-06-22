window.GHZ_APP_ID = 'zapdisparo'
;(function () {
  const APP_ID = window.GHZ_APP_ID
  const LS_KEY = `@${APP_ID.toUpperCase()}:licenca_cache`
  const SIG_KEY = `@${APP_ID.toUpperCase()}:licenca_sig`
  const SESSION_KEY = `@${APP_ID.toUpperCase()}:licenca_sessao`
  const CACHE_MAX_MS = 48 * 60 * 60 * 1000
  const _HMAC_SECRET = 'ghz_' + APP_ID + '_integrity_v2'
  function _computeHmac(data) {
    const str = JSON.stringify(data)
    let h = 0x811c9dc5
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) }
    const s = _HMAC_SECRET
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
    return (h >>> 0).toString(36)
  }
  function normalize(k) { return String(k || '').trim().toUpperCase() }
  function getCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null')
      if (!raw) return null
      const sig = localStorage.getItem(SIG_KEY)
      if (!sig || sig !== _computeHmac(raw)) { localStorage.removeItem(LS_KEY); localStorage.removeItem(SIG_KEY); return null }
      return raw
    } catch (e) { return null }
  }
  function saveCache(d) {
    const p = { active: d.active === true, license_key: normalize(d.license_key), customer_name: String(d.customer_name || ''), activated_at: d.activated_at || new Date().toISOString(), last_validated_at: d.last_validated_at || new Date().toISOString() }
    localStorage.setItem(LS_KEY, JSON.stringify(p))
    localStorage.setItem(SIG_KEY, _computeHmac(p))
    return p
  }
  function clearCache() { localStorage.removeItem(LS_KEY); localStorage.removeItem(SIG_KEY); sessionStorage.removeItem(SESSION_KEY) }
  function markSession() { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ok: true, at: new Date().toISOString() })) }
  function sessionValid() { try { const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); return s?.ok === true && cacheActive() } catch (e) { return false } }
  function cacheActive() {
    const c = getCache(); if (!c?.active || !c.license_key) return false
    const t = Date.parse(c.last_validated_at || c.activated_at || '')
    return Number.isFinite(t) && Date.now() - t <= CACHE_MAX_MS
  }
  async function activateOnline(key, phone) {
    const { ipcRenderer } = require('electron')
    const r = await ipcRenderer.invoke('license:activate', { license_key: normalize(key), phone: String(phone || '') })
    if (r?.ok) saveCache({ active: true, license_key: r.license_key || key, customer_name: r.customer_name || '', activated_at: r.activated_at, last_validated_at: r.last_seen_at || new Date().toISOString() })
    else clearCache(); return r
  }
  async function validateOnline() {
    const { ipcRenderer } = require('electron')
    const r = await ipcRenderer.invoke('license:validate')
    if (r?.ok) { const c = getCache() || {}; saveCache({ active: true, license_key: r.license_key || c.license_key, customer_name: r.customer_name || c.customer_name || '', activated_at: r.activated_at || c.activated_at, last_validated_at: r.last_seen_at || new Date().toISOString() }) }
    else clearCache(); return r
  }
  const api = { getCache, saveCache, clearCache, markSession, sessionValid, cacheActive, activateOnline, validateOnline, normalize, licencaAtiva: cacheActive }
  Object.freeze(api)
  Object.defineProperty(window, 'ghzLicense', { value: api, writable: false, configurable: false })
})()
