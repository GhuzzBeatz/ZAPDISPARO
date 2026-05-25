# Passo a passo: update automatico semanal (cliente)

Este projeto ja possui botao de atualizacao no app e rotina semanal de checagem.
Com este workflow, voce nao precisa vir manualmente gerar setup toda semana.

## 1) Subir este projeto para um repositorio GitHub
- O workflow criado em `.github/workflows/weekly-auto-release.yml` roda no GitHub Actions.
- O branch padrao deve ser `main`.

## 2) Ativar permissoes do Actions para gravar no repositorio
No repositorio GitHub:
- `Settings` -> `Actions` -> `General`
- Em `Workflow permissions`, marcar **Read and write permissions**

Sem isso, o workflow nao consegue:
- commitar `package.json` / `package-lock.json`
- commitar `update-manifest.json`
- criar releases

## 3) Ativar alerta no WhatsApp (sucesso e erro)
O workflow envia aviso no numero `+55 11 94898-1459` quando:
- a atualizacao semanal concluir com sucesso
- ocorrer falha (com job/etapa e link dos logs)

Para ativar:
1. Abra contato com o bot do CallMeBot e autorize sua conta:
   - adicione `+34 623 78 64 49`
   - envie: `I allow callmebot to send me messages`
2. Copie a API key recebida no WhatsApp.
3. No repositorio GitHub:
   - `Settings` -> `Secrets and variables` -> `Actions`
   - `New repository secret`
   - Nome: `WHATSAPP_ALERT_APIKEY`
   - Valor: (sua chave da CallMeBot)

Sem esse secret, o workflow roda normal, mas nao envia aviso no WhatsApp.

## 4) Publicar o arquivo de manifesto remoto
O workflow atualiza automaticamente `update-manifest.json` na branch `main`.
Use esta URL no cliente:

`https://raw.githubusercontent.com/GhuzzBeatz/ZAPDISPARO/main/update-manifest.json`

## 5) Configurar os clientes para usar o manifesto remoto
No cliente, arquivo de dados do app:
- `%APPDATA%\\ZapDisparo\\data\\update_config.json`

Conteudo:
```json
{
  "manifestUrl": "https://raw.githubusercontent.com/GhuzzBeatz/ZAPDISPARO/main/update-manifest.json"
}
```

## 6) Disparar a primeira release automaticamente
No GitHub:
- `Actions` -> `Weekly Auto Release` -> `Run workflow`

O workflow vai:
1. Atualizar `whatsapp-web.js` para `latest`
2. Incrementar versao patch do app
3. Gerar novo `Setup.exe`
4. Criar/atualizar release GitHub com os binarios
5. Atualizar `update-manifest.json` com a URL real do setup

## 7) Rotina semanal
- O workflow roda toda segunda-feira (cron no arquivo YAML).
- O app do cliente encontra a nova versao pelo botao:
  `Atualizar App (WhatsApp + Chromium)`

## Observacoes importantes
- Atualizacao de WhatsApp/Chromium e feita por **novo pacote do app** (setup), nao por troca de arquivo avulso.
- Se usar branch protegida com bloqueio de push por bot, o workflow precisa excecao.
- Se quiser mudar horario semanal, edite a linha `cron` em `.github/workflows/weekly-auto-release.yml`.

