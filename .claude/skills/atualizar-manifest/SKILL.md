---
name: atualizar-manifest
description: Use when the user asks to update or deploy manifest.json, typically on the first day of a new month before running the update process.
---

# Atualizar Manifest

Executa o fluxo de atualização do `manifest.json` com deploy. Deve ser rodado **antes** do fluxo de update quando a atualização ocorre no primeiro dia do mês.

## Passos

Execute cada passo em ordem. Não pule etapas.

### 1. Sincronizar branch local
```bash
git checkout main && git pull origin main
```

### 2. Limpar cache
```bash
npm run clear:cache
```

### 3. Atualizar manifest.json
```bash
npm run generate:manifest || { echo "Falha ao gerar manifest.json. Abortando."; exit 1; }
```

### 4. Criar branch
```bash
git checkout -b update-manifest-$(date +%m)-$(date +%Y)
```

### 5. Commit e push
```bash
git add data/
git commit -m "chore: atualização do manifest $(date +%m/%Y)"
git push origin HEAD
```

### 6. Criar Pull Request e fazer merge
```bash
gh pr create --title "chore: atualização manifest.json" --body "Atualização do manifest.json para o mês $(date +%m/%Y)" --base main
gh pr merge --squash --delete-branch
```

## Após o merge

Prosseguir com o fluxo de update e deploy dos dados (`/atualizar-ranking`).

## Regras

- Executar apenas no **primeiro dia do mês**.
- O passo 3 aborta automaticamente se o manifest falhar — não continuar em caso de erro.
- O `--squash` mantém o histórico da `main` limpo.
