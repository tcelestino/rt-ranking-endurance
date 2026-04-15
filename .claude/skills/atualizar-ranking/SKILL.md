---
name: atualizar-ranking
description: Use when the user asks to execute the update/deploy process for ranking data, run the update, process images, or deploy new running data.
---

# Atualizar Ranking

Executa o fluxo completo de update e deploy dos dados de corrida.

## Passos

Execute cada passo em ordem. Não pule etapas.

### 1. Processar imagens
```bash
npm run update
```

### 2. Criar branch
```bash
git checkout -b update-$(date +%d)-$(date +%m)-$(date +%Y)
```

### 3. Commit e push
```bash
git add data/
git commit -m "update: dados $(date +%d/%m/%Y)"
git push origin HEAD
```

### 4. Criar Pull Request e fazer merge
```bash
gh pr create --title "Atualização: $(date +%d/%m/%Y)" --body "Update automático de dados de corrida do dia" --base main
gh pr merge <numero> --squash --delete-branch
```

> Substitua `<numero>` pelo número do PR retornado pelo `gh pr create`.

### 5. Limpar pasta images
Após o merge:
```bash
npm run clear:images
```

## Regras

- **Nunca** executar `npm run generate:manifest` nesse fluxo.
- Sempre aguardar o merge antes de limpar as imagens.
- Confirmar com o usuário antes de fazer push/PR caso haja dúvida sobre os dados processados.
