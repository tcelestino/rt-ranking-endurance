#!/usr/bin/env bash
set -euo pipefail

BASE_BRANCH="main"
DATE_BR=$(date +"%d/%m/%Y")
DATE_BRANCH=$(date +"%d-%m-%Y")
BRANCH_NAME="update-${DATE_BRANCH}"
COMMIT_MSG="update: dados ${DATE_BR}"
PR_TITLE="Atualização: ${DATE_BR}"

if ! command -v gh &>/dev/null; then
  echo "Erro: GitHub CLI (gh) não encontrado. Instale em https://cli.github.com" >&2
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "Erro: não autenticado no GitHub CLI. Execute 'gh auth login'." >&2
  exit 1
fi

if [ -z "$(git status --porcelain -- data/)" ]; then
  echo "Aviso: nenhuma alteração em data/ para commitar." >&2
  exit 1
fi

git fetch origin "$BASE_BRANCH"
git checkout -B "$BRANCH_NAME" "origin/$BASE_BRANCH"

git add data/manifest.json 'data/*/female-*.json' 'data/*/male-*.json' 'data/runners.json' # apenas .json que precisam ser commitados
git commit -m "$COMMIT_MSG"
git push -u origin "$BRANCH_NAME" --force-with-lease

if ! gh pr view "$BRANCH_NAME" &>/dev/null; then
  gh pr create \
    --base "$BASE_BRANCH" \
    --head "$BRANCH_NAME" \
    --title "$PR_TITLE" \
    --body "$COMMIT_MSG"
fi

PR_URL=$(gh pr view "$BRANCH_NAME" --json url --jq '.url')

if gh pr merge "$BRANCH_NAME" \
  --squash \
  --subject "$PR_TITLE" \
  --body "$COMMIT_MSG" \
  --delete-branch; then
  git checkout "$BASE_BRANCH"
  git pull
  git branch -D "$BRANCH_NAME" 2>/dev/null || true
  echo "Deploy concluído: PR '$PR_TITLE' mergeado com squash."
else
  echo "Aviso: merge automático falhou (branch protection ativa ou checks pendentes)." >&2
  echo "Sua branch local '$BRANCH_NAME' foi mantida para que você possa fazer ajustes." >&2
  echo "Revise e faça o merge manualmente: $PR_URL" >&2
  exit 1
fi
