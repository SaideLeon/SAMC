"""
SAMC — Helpers partilhados pelos scripts de backup/sincronização.

Mantém:
- caminhos das pastas de backup (pending / synced / erro)
- o "marcador" local (estado.json) com o último _id de SMS já capturado
  e o device_id usado para identificar este telemóvel na base Supabase
"""
import json
import os
import uuid
from datetime import datetime, timezone

BASE_DIR    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # raiz do SAMC/
BACKUP_DIR  = os.path.join(BASE_DIR, "backups")
PENDING_DIR = os.path.join(BACKUP_DIR, "pending")
SYNCED_DIR  = os.path.join(BACKUP_DIR, "synced")
ERRO_DIR    = os.path.join(BACKUP_DIR, "erro")
ESTADO_FILE = os.path.join(BACKUP_DIR, "estado.json")

for _d in (BACKUP_DIR, PENDING_DIR, SYNCED_DIR, ERRO_DIR):
    os.makedirs(_d, exist_ok=True)

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(BASE_DIR, ".env"))
except ImportError:
    pass


def agora_iso():
    return datetime.now(timezone.utc).isoformat()


def log(ficheiro, mensagem):
    caminho = os.path.join(BACKUP_DIR, ficheiro)
    with open(caminho, "a", encoding="utf-8") as f:
        f.write(f"[{agora_iso()}] {mensagem}\n")


def carregar_estado():
    if os.path.exists(ESTADO_FILE):
        try:
            with open(ESTADO_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {"ultimo_id": 0, "device_id": None, "ultimo_backup_em": None, "ultimo_sync_em": None}


def guardar_estado(estado):
    with open(ESTADO_FILE, "w", encoding="utf-8") as f:
        json.dump(estado, f, ensure_ascii=False, indent=2)


def obter_device_id():
    """Devolve o SAMC_DEVICE_ID definido no .env, ou gera/reutiliza um ID estável."""
    device_id = os.environ.get("SAMC_DEVICE_ID")
    if device_id:
        return device_id
    estado = carregar_estado()
    if not estado.get("device_id"):
        estado["device_id"] = uuid.uuid4().hex[:12]
        guardar_estado(estado)
    return estado["device_id"]
