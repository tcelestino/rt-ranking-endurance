# Backoffice na Cloudflare: deploy e verificação

Checklist para executar manualmente. Cada ação externa (Clerk, GitHub, Cloudflare) exige confirmação sua. URL final: `https://ranking-endurance.tcelestino.dev.br/backoffice`.

## Pré-requisitos

- [ ] Acesso à conta Cloudflare com a zona `tcelestino.dev.br` e `npx wrangler login` feito
- [ ] Acesso admin ao repositório no GitHub e ao dashboard do Clerk
- [ ] `npm test && npm run backoffice:check && npm run worker:check` verdes

## 1. Clerk de produção

- [ ] Criar a instância Production
- [ ] Domínio principal `tcelestino.dev.br`, com os CNAMEs pedidos no DNS em modo "DNS only"
- [ ] Credenciais OAuth Google próprias (não as compartilhadas)
- [ ] Login somente com Google
- [ ] Restrictions > Allowlist apenas com o e-mail do admin
- [ ] Sessions > Customize session token: `{ "metadata": "{{user.public_metadata}}" }`
- [ ] Após o primeiro login, definir `publicMetadata = { "role": "admin" }` no usuário
- [ ] Colocar `pk_live_...` em `vars.CLERK_PUBLISHABLE_KEY` no `wrangler.jsonc`

## 2. PAT do GitHub

- [ ] Fine-grained, restrito a este repositório, permissões Contents RW e Pull requests RW
- [ ] Validade de 1 ano, com lembrete no calendário para a rotação
- [ ] Confirmar que a branch protection da `main` permite o merge por esse token; senão, usar "Publicar" com merge automático desligado

## 3. Recursos Cloudflare

- [ ] `npx wrangler kv namespace create IMAGE_CACHE -c worker/wrangler.jsonc` e trocar `REPLACE_WITH_KV_ID` pelo id
- [ ] `npx wrangler secret put CLERK_SECRET_KEY -c worker/wrangler.jsonc`
- [ ] `npx wrangler secret put GITHUB_TOKEN -c worker/wrangler.jsonc`
- [ ] Garantir que o `namespace_id` do `ratelimits` (`1201`) é único na conta
- [ ] Conferir que não restam `REPLACE_WITH_KV_ID` nem `pk_live_REPLACE_ME` no `wrangler.jsonc`
- [ ] `git grep -nE 'sk_(live|test)|ghp_|github_pat_' -- worker` não retorna nada
- [ ] `git ls-files worker | grep dev.vars` mostra só `worker/.dev.vars.example`
- [ ] `CURRENT_MONTH` NÃO está definido nas `vars` de produção
- [ ] `CLERK_SECRET_KEY` e `GITHUB_TOKEN` jamais entram em `vars` (só `wrangler secret`)

## 4. Deploy

Aviso: `npm run worker:deploy` publica imediatamente e a rota fica pública assim que sobe. A allowlist do Clerk e o role admin (seção 1) precisam estar configurados antes.

- [ ] `npm run worker:dryrun` sem erros
- [ ] `npm run worker:deploy`
- [ ] Conferir a rota `ranking-endurance.tcelestino.dev.br/backoffice*` e que o resto do hostname continua servido pelo site atual
- [ ] O `robots.txt` do hostname tem `Disallow: /backoffice/` na implantação que serve o site público (`static/robots.txt` documenta a regra)

## 5. Verificações de segurança em produção

Use `BASE=https://ranking-endurance.tcelestino.dev.br`.

- [ ] Sem token a API nega: `curl -s -o /dev/null -w '%{http_code}' $BASE/backoffice/api/state` retorna `401`
- [ ] `curl -sI $BASE/backoffice/` e `curl -sI $BASE/backoffice/app.js` trazem `x-robots-tag`, `content-security-policy` e `strict-transport-security`
- [ ] `curl -sI $BASE/backoffice` retorna `308` para `/backoffice/`
- [ ] `curl -sI $BASE/backoffice/api/state` traz `cache-control: no-store`
- [ ] `curl -sI $BASE/backoffice/inexistente` retorna `404` com `x-robots-tag`
- [ ] `curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/backoffice/index.html` retorna `404`
- [ ] Origin errado é rejeitado antes da autenticação: `curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Origin: https://evil.example' $BASE/backoffice/api/save` retorna `403` ("Origem não permitida"), com ou sem token
- [ ] Autenticação isolada: o mesmo POST com `-H 'Origin: https://ranking-endurance.tcelestino.dev.br'` e sem token retorna `401`
- [ ] Nenhuma URL `*.workers.dev` nem de preview responde
- [ ] Navegador sem violações de CSP no console (Clerk, Turnstile, Chart.js)
- [ ] Login com o Google do admin entra; outra conta é barrada pela allowlist; conta sem role recebe `403`
- [ ] Smoke test com token real do Clerk: o Worker repassa ao Clerk apenas o header `Authorization`; confirmar que autentica e, se a instância for `pk_test`, que o cookie de dev browser não é necessário
- [ ] Rodar `wrangler dev` uma vez e inspecionar `env.GITHUB_REPO` para confirmar que `.dev.vars` sobrescreve as `vars`

## 6. Fluxo real

- [ ] Enviar 1 print real: `analyze` devolve km e pace. Isso valida o formato de entrada do binding de IA para `@cf/meta/llama-3.2-11b-vision-instruct`; se ele não aceitar `image_url` em `messages`, trocar para o campo `image`, mantendo a assinatura de `analyzeImage`
- [ ] Conferir que o tipo `Ai` real é atribuível a `AiBinding`
- [ ] `save` cria a branch `update-DD-MM-YYYY` com 1 commit contendo o trailer `Backoffice-User`
- [ ] `publish` sem merge abre o PR
- [ ] `publish` com merge automático mergeia o PR
- [ ] O site público lê os dados novos

## 7. Rollback e rotação

- [ ] Rollback: `npx wrangler rollback -c worker/wrangler.jsonc` ou remover/reverter a rota `/backoffice*`
- [ ] Rotação do PAT: gerar novo token, `npx wrangler secret put GITHUB_TOKEN -c worker/wrangler.jsonc`, revogar o antigo
- [ ] Rotação do Clerk: gerar nova chave, `npx wrangler secret put CLERK_SECRET_KEY -c worker/wrangler.jsonc`

## 8. Limitações conhecidas

- Duas abas salvando a mesma imagem ao mesmo tempo só são barradas em sequência: o cache de hash no KV é eventualmente consistente.
- A Cache API só funciona em domínio customizado, não em `workers.dev`, e é por data center.
- O plano gratuito limita subrequests a 50; o primeiro carregamento do snapshot usa ~30 blobs. Depois, o cache por SHA evita as requisições.
- O backoffice Express local continua existindo até a remoção ser confirmada.
