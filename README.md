# SAMC — Sistema de Análise de Mensagens Curtas

> Aplicação web para análise, classificação e gestão de SMS no Android (Termux) com IA Gemini.

---

## ⚠️ Pré-requisitos Importantes

### Termux e Termux:API — instalar APENAS pelo GitHub

As versões do **Google Play Store não funcionam** — as APIs internas são diferentes e o `termux-sms-list` não estará disponível.

**Passos:**

1. Descarrega os APKs oficiais:
   - Termux: [github.com/termux/termux-app/releases](https://github.com/termux/termux-app/releases)
   - Termux:API: [github.com/termux/termux-api/releases](https://github.com/termux/termux-api/releases)

2. Antes de instalar o **Termux:API**, desactiva temporariamente o **Play Protect**:
   - Google Play → ícone de perfil → **Play Protect** → ⚙️ → desactiva **"Verificar ameaças"**

3. Instala os dois `.apk`

4. Após a instalação, **reactiva o Play Protect**

---

## Instalação

### 1. Instalar dependências do sistema

```bash
pkg update && pkg upgrade -y
pkg install python git termux-api
```

### 2. Clonar o projecto

```bash
git clone https://github.com/SaideLeon/SAMC.git
cd SAMC
```

### 3. Instalar dependências Python

```bash
pip install -r requirements.txt
```

### 4. Conceder permissão de acesso aos SMS

Executa este comando e **aceita a permissão** quando o Android pedir:

```bash
termux-sms-list -l 1
```

> Sem este passo a aplicação não consegue ler nenhuma mensagem.

### 5. Definir a chave da API Gemini

```bash
export GEMINI_API_KEY="a_tua_chave_aqui"
```

Ou cria um ficheiro `.env` na pasta do projecto (com base no `.env.example`) para não teres de exportar em cada sessão.

### 6. Iniciar o servidor

```bash
python app.py
```

Acede a `http://localhost:5000` no browser do telemóvel.

---

## Funcionalidades

- **Mensagens Recentes** — lista as últimas N mensagens da caixa de entrada
- **Por Contacto** — filtra todas as mensagens de um número ou nome
- **Por Tipo** — inbox / sent / draft / outbox
- **Pesquisa** — pesquisa por palavra-chave num pool configurável
- **Backup** — exportação completa em `.txt` ou `.json`
- **Anti-Spam** — detecção heurística + classificação via Gemini
- **Chat IA** — conversa com Gemini sobre as tuas mensagens (SSE streaming)
- **Análise de Remetentes** — identifica remetentes suspeitos com IA

---

## Estrutura do Projecto

```
SAMC/
├── app.py                  # Backend Flask + API Gemini
├── requirements.txt        # Dependências Python
├── .env.example            # Variáveis de ambiente necessárias
├── backup/
│   ├── estado.py            # Caminhos/marcador partilhados
│   ├── backup_diario.py     # Backup local diário (sem internet)
│   └── sync_supabase.py     # Envia pendentes ao Supabase (com internet)
├── boot/
│   └── samc-boot.sh         # Script do Termux:Boot (arranque automático)
├── sql/
│   └── schema.sql           # Tabela Supabase para os backups
├── backups/                 # Gerado em runtime — pending/synced/erro/estado.json (não vai ao git)
├── templates/
│   └── index.html          # SPA principal
└── static/
    ├── css/
    │   └── style.css       # Estilos da interface
    └── js/
        ├── app.js          # Lógica do frontend (SPA)
        └── md.js           # Renderizador de Markdown
```

---

## Backup automático e arranque com o telemóvel

O SAMC pode:
1. **Reiniciar-se sozinho** sempre que o telemóvel for ligado;
2. Fazer um **backup diário** das SMS novas, guardado localmente;
3. **Esperar por internet** e, assim que ela existir, **enviar esse backup para o Supabase**, sem perder nada entretanto.

Isto usa dois mecanismos nativos do Android/Termux — nada fica dependente do Flask estar aberto:

- **Termux:Boot** — corre um script assim que o Android arranca.
- **Android JobScheduler** (via `termux-job-scheduler`) — agenda as duas tarefas periódicas mesmo com a app fechada; a tarefa de sincronização só é disparada pelo próprio Android quando há rede.

### 1. Instalar o Termux:Boot

Descarrega o APK (mesma origem do Termux, **não** é a Play Store):
[github.com/termux/termux-boot/releases](https://github.com/termux/termux-boot/releases)

Abre a app **Termux:Boot** uma vez, só para o Android registar a permissão de arranque.

### 2. Registar o script de arranque

```bash
mkdir -p ~/.termux/boot
cp ~/SAMC/boot/samc-boot.sh ~/.termux/boot/samc-boot.sh
chmod +x ~/.termux/boot/samc-boot.sh ~/SAMC/backup/*.py
```

### 3. Criar a tabela no Supabase

No SQL Editor do teu projecto Supabase, corre o conteúdo de [`sql/schema.sql`](sql/schema.sql).

### 4. Configurar o `.env`

Além do `GEMINI_API_KEY`, adiciona:

```bash
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_KEY=chave_service_role_aqui
SUPABASE_TABLE=sms_mensagens
```

> Usa a chave **service_role** (Project Settings → API no Supabase). Fica só no `.env` do telemóvel — este ficheiro já está no `.gitignore`, nunca é enviado ao GitHub.

### 5. Testar

```bash
# corre uma vez manualmente para confirmar que está tudo bem configurado
python backup/backup_diario.py
python backup/sync_supabase.py

# consulta o estado (também disponível na app, se preferires disparar por lá)
cat backups/estado.json
```

Depois reinicia o telemóvel — o `~/.termux/boot/samc-boot.sh` corre sozinho e regista as duas tarefas periódicas:

| Tarefa | Frequência | Precisa de rede? | O que faz |
|---|---|---|---|
| `backup/backup_diario.py` | a cada 24h | Não | Lê SMS novas via `termux-sms-list` e grava-as em `backups/pending/*.json` |
| `backup/sync_supabase.py` | até a cada 15 min | Sim | Se houver ficheiros pendentes **e** internet, envia-os para o Supabase e move-os para `backups/synced/` |

Se o telemóvel ficar sem internet, os backups continuam a acumular-se em `backups/pending/` normalmente — nada se perde; assim que a rede voltar, o próximo ciclo do job de sincronização envia tudo de uma vez.

Também podes forçar as duas coisas a partir da própria aplicação: `POST /api/backup/agora` (dispara backup + sync em segundo plano) e `GET /api/backup/estado` (mostra o último backup, a última sincronização e quantos ficheiros estão pendentes).

---

## Variáveis de Ambiente

| Variável         | Descrição                  | Obrigatória |
|------------------|----------------------------|-------------|
| `GEMINI_API_KEY` | Chave da API Google Gemini | Sim         |

---

## Stack Técnica

| Componente | Tecnologia                     |
|------------|--------------------------------|
| Backend    | Python · Flask                 |
| IA         | Google Gemini 2.5 Flash        |
| Streaming  | SSE (Server-Sent Events)       |
| Frontend   | HTML · CSS · JS vanilla        |
| SMS        | Termux:API (`termux-sms-list`) |

---

## Licença

Projecto pessoal — uso livre.
