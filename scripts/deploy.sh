#!/usr/bin/env bash
set -euo pipefail

BASE_BRANCH="main"
DATE_BR=$(date +"%d/%m/%Y")
DATE_BRANCH=$(date +"%d-%m-%Y")
BRANCH_NAME="update-${DATE_BRANCH}"
COMMIT_MSG="update: dados ${DATE_BR}"
PR_TITLE="Atualização: ${DATE_BR}"

resolve_branch_name() {
  local base_name="$1"
  local name="$base_name"
  local suffix=2
  local open_pr
  while git show-ref --verify --quiet "refs/remotes/origin/$name" ||
        git show-ref --verify --quiet "refs/heads/$name"; do
    if git show-ref --verify --quiet "refs/remotes/origin/$name"; then
      open_pr=$(gh pr list --head "$name" --state open --json number --jq '.[0].number // empty')
      if [ -n "$open_pr" ]; then
        echo "Reutilizando branch '$name': o PR #$open_pr aberto será atualizado com o estado atual de data/." >&2
        echo "$name"
        return
      fi
    fi
    name="${base_name}-${suffix}"
    suffix=$((suffix + 1))
  done
  echo "$name"
}

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

git fetch --prune origin

BRANCH_NAME=$(resolve_branch_name "$BRANCH_NAME")
echo "Branch: $BRANCH_NAME"

DATA_BACKUP=$(mktemp -d)
trap 'rm -rf "$DATA_BACKUP"' EXIT
cp -R data/. "$DATA_BACKUP/"
git checkout --no-overlay "origin/$BASE_BRANCH" -- data/
git checkout -B "$BRANCH_NAME" "origin/$BASE_BRANCH"
cp -R "$DATA_BACKUP/." data/

git add data/manifest.json 'data/*/female-*.json' 'data/*/male-*.json' 'data/runners.json' # apenas .json que precisam ser commitados
git commit -m "$COMMIT_MSG"
git push -u origin "$BRANCH_NAME" --force-with-lease

PR_URL=$(gh pr list --head "$BRANCH_NAME" --state open --json url --jq '.[0].url // empty')
if [ -z "$PR_URL" ]; then
  PR_URL=$(gh pr create \
    --base "$BASE_BRANCH" \
    --head "$BRANCH_NAME" \
    --title "$PR_TITLE" \
    --body "$COMMIT_MSG")
fi

if gh pr merge "$PR_URL" \
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
  echo "Execute o deploy novamente para atualizar o PR ou faça o merge manualmente: $PR_URL" >&2
  exit 1
fi
