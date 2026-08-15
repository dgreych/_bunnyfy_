#!/usr/bin/env python3
"""Publica o estado atual do repositório no servidor de produção (Pterodactyl).

Fluxo: empacota os arquivos rastreados pelo git, envia via URL assinada,
descompacta no servidor, reinicia (stop -> confirma offline -> start) e
faz uma checagem de saúde final.

Variáveis de ambiente obrigatórias:
  PTERODACTYL_PANEL     URL base do painel (ex: https://painel.exemplo.com)
  PTERODACTYL_API_KEY   chave de API do Client API
  PTERODACTYL_SERVER_ID identificador curto do servidor

Nenhum valor de credencial é impresso em nenhum momento.
"""

import json
import os
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request

HEALTH_URL = os.environ.get("DEPLOY_HEALTH_URL", "").strip()
STOP_TIMEOUT_S = 60
BOOT_GRACE_S = 45


def env_or_die(name):
    value = os.environ.get(name, "").strip()
    if not value:
        print(f"faltando variável de ambiente obrigatória: {name}", file=sys.stderr)
        sys.exit(1)
    return value


PANEL = env_or_die("PTERODACTYL_PANEL").rstrip("/")
API_KEY = env_or_die("PTERODACTYL_API_KEY")
SERVER_ID = env_or_die("PTERODACTYL_SERVER_ID")


def api_request(path, method="GET", data=None, headers=None):
    req_headers = {"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"}
    if headers:
        req_headers.update(headers)
    body = json.dumps(data).encode("utf-8") if isinstance(data, dict) else data
    if isinstance(data, dict):
        req_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{PANEL}/api/client{path}", data=body, method=method, headers=req_headers)
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def get_state():
    data = api_request(f"/servers/{SERVER_ID}/resources")
    return data["attributes"]["current_state"]


def power(signal):
    api_request(f"/servers/{SERVER_ID}/power", method="POST", data={"signal": signal})


def build_archive():
    fd, path = tempfile.mkstemp(suffix=".tar.gz")
    os.close(fd)
    # git archive só inclui arquivos rastreados: .env, node_modules, banco
    # local e qualquer estado de runtime do servidor nunca são tocados.
    subprocess.run(["git", "archive", "--format=tar.gz", "-o", path, "HEAD"], check=True)
    return path


def upload_and_extract(archive_path):
    upload_meta = api_request(f"/servers/{SERVER_ID}/files/upload")
    upload_url = upload_meta["attributes"]["url"]

    boundary = "----deploy-boundary-bunnyfy"
    filename = "deploy-payload.tar.gz"
    with open(archive_path, "rb") as fh:
        file_bytes = fh.read()

    body = bytearray()
    body += f"--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="files"; filename="{filename}"\r\n'.encode()
    body += b"Content-Type: application/gzip\r\n\r\n"
    body += file_bytes
    body += f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        upload_url,
        data=bytes(body),
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=180):
        pass

    api_request(
        f"/servers/{SERVER_ID}/files/decompress",
        method="POST",
        data={"root": "/", "file": filename},
    )


def wait_for_state(target, timeout_s):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if get_state() == target:
            return True
        time.sleep(5)
    return False


def health_check():
    if not HEALTH_URL:
        return True
    for _ in range(6):
        try:
            with urllib.request.urlopen(HEALTH_URL, timeout=10) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(10)
    return False


def main():
    print("empacotando repositório...")
    archive_path = build_archive()
    try:
        print("enviando e descompactando no servidor...")
        upload_and_extract(archive_path)
    finally:
        os.remove(archive_path)

    print("reiniciando servidor (stop -> confirmar offline -> start)...")
    power("stop")
    if not wait_for_state("offline", STOP_TIMEOUT_S):
        print("servidor não confirmou offline a tempo", file=sys.stderr)
        sys.exit(1)
    power("start")

    print(f"aguardando {BOOT_GRACE_S}s de boot antes da checagem de saúde...")
    time.sleep(BOOT_GRACE_S)

    if health_check():
        print("deploy concluído e saúde confirmada.")
    else:
        print("deploy enviado, mas a checagem de saúde não confirmou sucesso — verificar manualmente.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
