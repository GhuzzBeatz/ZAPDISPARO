const SALT   = 'GHZ2026ZAPDISPARO'
const PREFIX = 'ZAPDISP'
const LS_KEY = '@ZAPDISPARO:licenca'

function gerarChaveZD(n) {
  const p1 = String(n).padStart(4,'0')
  const p2 = btoa(n+SALT).replace(/[^A-Z0-9]/gi,'').slice(0,4).toUpperCase()
  const p3 = String((n*31)%9999).padStart(4,'0')
  return `${PREFIX}-${p1}-${p2}-${p3}`
}
function validarChaveZD(key) {
  if (!key) return false
  const clean = key.trim().toUpperCase()
  const parts = clean.split('-')
  if (parts.length !== 4 || parts[0] !== PREFIX) return false
  const n = parseInt(parts[1])
  if (isNaN(n)) return false
  return gerarChaveZD(n) === clean
}
function licencaAtivaZD() {
  try { return validarChaveZD(localStorage.getItem(LS_KEY)||'') } catch(e) { return false }
}
function salvarLicencaZD(key) {
  localStorage.setItem(LS_KEY, key.trim().toUpperCase())
}
