#!/usr/bin/env bash
set -euo pipefail

RANKING_FILE="output/ranking.md"

if [ ! -f "$RANKING_FILE" ]; then
  echo "Erro: $RANKING_FILE não encontrado. Execute 'npm run generate:markdown' primeiro." >&2
  exit 1
fi

OS="$(uname -s)"

if [ "$OS" = "Darwin" ]; then
  pbcopy < "$RANKING_FILE"
elif [ "$OS" = "Linux" ]; then
  if command -v wl-copy &>/dev/null; then
    wl-copy < "$RANKING_FILE"
  elif command -v xclip &>/dev/null; then
    xclip -selection clipboard < "$RANKING_FILE"
  elif command -v xsel &>/dev/null; then
    xsel --clipboard --input < "$RANKING_FILE"
  else
    echo "Erro: nenhuma ferramenta de clipboard encontrada. Instale wl-copy (Wayland), xclip ou xsel (X11)." >&2
    exit 1
  fi
else
  echo "Erro: sistema operacional '$OS' não suportado." >&2
  exit 1
fi

echo "Ranking copiado para o clipboard."
