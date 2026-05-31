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
