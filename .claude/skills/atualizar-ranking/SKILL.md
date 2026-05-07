---
name: atualizar-ranking
description: Use when the user asks to execute the update/deploy process for ranking data, run the update, process images, or deploy new running data.
---

# Atualizar Ranking

Executa o fluxo completo de update e deploy dos dados de corrida. Se for o primeiro dia do mês, atualiza o manifest.json antes de processar as imagens.

## Passos

Execute cada passo em ordem. Não pule etapas.

### 1. Verificar data

Verifique se hoje é o primeiro dia do mês:

```bash
date +%d
```

Se o resultado for `01`, execute o **Bloco A** antes de continuar. Caso contrário, pule para o **Passo 2**.

---

### Bloco A — Atualizar manifest.json (apenas no dia 01)

#### A.1. Sincronizar branch local
```bash
git checkout main && git pull origin main
```

#### A.2. Limpar cache
```bash
npm run clear:cache
```

#### A.3. Gerar manifest.json
```bash
npm run generate:manifest || { echo "Falha ao gerar manifest.json. Abortando."; exit 1; }
```

#### A.4. Criar branch para o manifest
```bash
git checkout -b update-manifest-$(date +%m)-$(date +%Y)
```

#### A.5. Commit e push do manifest
```bash
git add data/
git commit -m "chore: atualização do manifest $(date +%m/%Y)"
git push origin HEAD
```

#### A.6. Criar Pull Request e fazer merge do manifest
```bash
gh pr create --title "chore: atualização manifest.json" --body "Atualização do manifest.json para o mês $(date +%m/%Y)" --base main
gh pr merge --squash --delete-branch
```

Após o merge, retornar para `main` antes de continuar:
```bash
git checkout main && git pull origin main
```

---

### 2. Processar imagens
```bash
npm run update
```

### 3. Criar branch
```bash
git checkout -b update-$(date +%d)-$(date +%m)-$(date +%Y)
```

### 4. Commit e push
```bash
git add data/
git commit -m "update: dados $(date +%d/%m/%Y)"
git push origin HEAD
```

### 5. Criar Pull Request e fazer merge
```bash
gh pr create --title "Atualização: $(date +%d/%m/%Y)" --body "Update automático de dados de corrida do dia" --base main
gh pr merge <numero> --squash --delete-branch
```

Substitua `<numero>` pelo número do PR retornado pelo `gh pr create`.

### 6. Limpar pasta images
Após o merge:
```bash
npm run clear:images
```

### 7. Gerar arquivo ranking.md
Após a limpeza da pasta de imagens, gere o arquivo `ranking.md` executando o comando:

```bash
npm run generate:markdown || { echo "Falha ao gerar ranking.md. Verifique os arquivos de dados."; exit 1; }
```

Após rodar o comando, o arquivo `output/ranking.md` será atualizado. Ele é gerado automaticamente e não deve ser versionado, portanto, **não faça commit deste arquivo**.

Copie o conteúdo para a área de transferência:

```bash
pbcopy < output/ranking.md
```

Informe ao usuário que o conteúdo do `output/ranking.md` foi copiado para a área de transferência.

## Regras

- O manifest só é atualizado quando a skill roda no **primeiro dia do mês** (`date +%d` == `01`).
- O passo A.3 aborta automaticamente se o manifest falhar — não continuar em caso de erro.
- Sempre aguardar o merge antes de limpar as imagens.
- Confirmar com o usuário antes de fazer push/PR caso haja dúvida sobre os dados processados.
- O `--squash` mantém o histórico da `main` limpo em ambos os PRs.
