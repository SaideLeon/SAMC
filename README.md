# SAMC — Sistema de Análise de Mensagens Curtas

> Aplicação web para análise, classificação e gestão de SMS no Android (Termux) com IA Gemini.

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
samc/
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

## Instalação (Termux)

```bash
# 1. Instalar dependências do sistema
pkg install python

# 2. Entrar na pasta do projecto
cd samc

# 3. Instalar dependências Python
pip install -r requirements.txt

# 4. Definir a chave da API Gemini
export GEMINI_API_KEY="a_tua_chave_aqui"

# 5. Iniciar o servidor
python app.py
```

Acede depois a `http://localhost:5000` no browser do telemóvel.

---

## Variáveis de Ambiente

| Variável         | Descrição                          | Obrigatória |
|------------------|------------------------------------|-------------|
| `GEMINI_API_KEY` | Chave da API Google Gemini         | Sim         |

---

## Stack Técnica

| Componente | Tecnologia              |
|------------|-------------------------|
| Backend    | Python · Flask          |
| IA         | Google Gemini 2.5 Flash |
| Streaming  | SSE (Server-Sent Events)|
| Frontend   | HTML · CSS · JS vanilla |
| SMS        | Termux:API (`termux-sms-list`) |

---

## Licença

Projecto pessoal — uso livre.
