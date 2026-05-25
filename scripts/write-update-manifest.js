#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

function argValue(flag) {
  const idx = process.argv.indexOf(flag)
  if (idx === -1) return ''
  return String(process.argv[idx + 1] || '').trim()
}

const version = argValue('--version')
const asset = argValue('--asset')
const repo = argValue('--repo') || process.env.GITHUB_REPOSITORY || ''
const outFile = argValue('--out') || 'update-manifest.json'
const notes = argValue('--notes') || 'Atualizacao automatica semanal.'

if (!version) {
  console.error('Erro: informe --version')
  process.exit(1)
}
if (!asset) {
  console.error('Erro: informe --asset')
  process.exit(1)
}
if (!repo || !repo.includes('/')) {
  console.error('Erro: informe --repo OWNER/REPO (ou use GITHUB_REPOSITORY)')
  process.exit(1)
}

const tag = `v${version}`
const encodedAsset = encodeURIComponent(asset)
const downloadUrl = `https://github.com/${repo}/releases/download/${tag}/${encodedAsset}`

const manifest = {
  version,
  download_url: downloadUrl,
  notes
}

const targetPath = path.resolve(outFile)
fs.writeFileSync(targetPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log(`Manifesto atualizado em: ${targetPath}`)
console.log(`download_url: ${downloadUrl}`)