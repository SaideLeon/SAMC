## Documento Histórico de Correção — Parâmetros do `termux-sms-list`

### 1. Descrição do problema

Foi identificado um erro no uso do comando `termux-sms-list`, onde as flags estavam sendo passadas no formato incorreto:

```
--flag valor   ❌ (inválido nesta versão)
```

O sistema exigia obrigatoriamente o formato com sinal de igual:

```
--flag=valor   ✓ (formato correto)
```

---

### 2. Causa do erro

A versão atual do `termux-sms-list` utilizada no Termux não suporta argumentos separados por espaço.
Todas as opções devem ser passadas no formato:

```
--opção=valor
```

Caso contrário, o comando falha ou ignora os parâmetros.

---

### 3. Alterações realizadas

#### Correção da função `get_sms_selection`

Foram ajustados todos os parâmetros para o formato correto:

* Antes:

  ```
  ["--message-limit", "20"]        ❌
  ```

  Depois:

  ```
  ["--message-limit=20"]           ✓
  ```

* Antes:

  ```
  ["--message-type", "inbox"]      ❌
  ```

  Depois:

  ```
  ["--message-type=inbox"]         ✓
  ```

* Antes:

  ```
  ["--message-address", "+823030"] ❌
  ```

  Depois:

  ```
  ["--message-address=+823030"]    ✓
  ```

---

### 4. Arquivo afetado

* `app.py` (Termux SMS handler)

---

### 5. Resultado

Após a correção:

* O comando `termux-sms-list` passou a aceitar corretamente os parâmetros.
* A função `get_sms_selection` passou a funcionar sem erros de parsing.
* O sistema voltou a operar normalmente.

---

### 6. Nota técnica (prevenção)

A partir desta correção, deve-se garantir que:

* Todas as flags do `termux-sms-list` sejam sempre passadas no formato `--flag=valor`.
* Nunca utilizar separação por espaço (`--flag valor`) para este comando, pois não é suportado nesta versão.

---
