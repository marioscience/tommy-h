#!/usr/bin/env bash

trim_env_whitespace() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

load_env_file() {
  local env_file="${1:-.env}"
  local line key value first last

  [ -f "$env_file" ] || {
    printf 'ERROR: no existe el archivo de entorno: %s\n' "$env_file" >&2
    return 1
  }

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    line="$(trim_env_whitespace "$line")"
    case "$line" in
      ''|'#'*) continue ;;
    esac

    if [[ "$line" == export[[:space:]]* ]]; then
      line="$(trim_env_whitespace "${line#export}")"
    fi
    [[ "$line" == *=* ]] || {
      printf 'ERROR: linea .env invalida (falta =).\n' >&2
      return 1
    }

    key="$(trim_env_whitespace "${line%%=*}")"
    value="$(trim_env_whitespace "${line#*=}")"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || {
      printf 'ERROR: nombre de variable .env invalido: %s\n' "$key" >&2
      return 1
    }

    if [ "${#value}" -ge 2 ]; then
      first="${value:0:1}"
      last="${value: -1}"
    else
      first=''
      last=''
    fi
    if { [ "$first" = '"' ] && [ "$last" = '"' ]; } \
      || { [ "$first" = "'" ] && [ "$last" = "'" ]; }; then
      value="${value:1:${#value}-2}"
    else
      value="${value%%[[:space:]]#*}"
      value="$(trim_env_whitespace "$value")"
    fi

    export "$key=$value"
  done < "$env_file"
}
