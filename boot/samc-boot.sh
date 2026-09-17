#!/data/data/com.termux/files/usr/bin/bash
# SAMC — script de arranque automático.
#
# Instalação (uma vez só):
#   1. Instala a app "Termux:Boot" (fora da Play Store, mesmo sítio do Termux):
#      https://github.com/termux/termux-boot/releases
#   2. Abre a Termux:Boot pelo menos uma vez (pede a permissão de arranque).
#   3. mkdir -p ~/.termux/boot
#   4. cp ~/SAMC/boot/samc-boot.sh ~/.termux/boot/samc-boot.sh
#   5. chmod +x ~/.termux/boot/samc-boot.sh ~/SAMC/backup/*.py
#   6. Reinicia o telemóvel para testar.
#
# O que este script faz sempre que o telemóvel liga:
#   - regista (ou renova) as duas tarefas periódicas no JobScheduler do Android:
#       job 1 -> backup diário local das SMS (não precisa de internet)
#       job 2 -> envia para o Supabase os backups pendentes (só corre com rede)
#   - reinicia o servidor Flask do SAMC em segundo plano

SAMC_DIR="$HOME/SAMC"
mkdir -p "$SAMC_DIR/backups"
LOG="$SAMC_DIR/backups/boot.log"

echo "[$(date)] arranque SAMC" >> "$LOG"

termux-wake-lock

# dá tempo à Termux:API e à rede para ficarem prontas
sleep 15

cd "$SAMC_DIR" || { echo "[$(date)] ERRO: $SAMC_DIR não encontrado" >> "$LOG"; exit 1; }

# --- Job 1: backup diário (a cada 24h, sem exigir rede) ---------------------
termux-job-scheduler \
    --job-id 1001 \
    --period-ms 86400000 \
    --persisted true \
    --script "$SAMC_DIR/backup/backup_diario.py" \
    >> "$LOG" 2>&1

# --- Job 2: sincronização com Supabase (só corre quando há internet) -------
# 900000 ms = 15 min é o intervalo mínimo permitido pelo Android JobScheduler;
# o Android decide o momento exacto dentro dessa janela consoante a bateria e
# a rede, e só o dispara mesmo quando --network any estiver satisfeito.
termux-job-scheduler \
    --job-id 1002 \
    --period-ms 900000 \
    --network any \
    --persisted true \
    --script "$SAMC_DIR/backup/sync_supabase.py" \
    >> "$LOG" 2>&1

# --- Servidor Flask (opcional, remove se não quiseres que arranque sozinho) -
nohup python "$SAMC_DIR/app.py" >> "$SAMC_DIR/backups/server.log" 2>&1 &

echo "[$(date)] tarefas registadas, servidor iniciado (pid $!)" >> "$LOG"
