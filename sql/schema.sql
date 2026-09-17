-- SAMC — tabela de backup de SMS no Supabase
-- Corre isto uma vez no SQL Editor do teu projecto Supabase.

create table if not exists public.sms_mensagens (
    id            bigserial primary key,
    device_id     text        not null,
    sms_id        bigint      not null,
    numero        text,
    tipo          text,
    corpo         text,
    recebido_em   text,
    sincronizado_em timestamptz not null default now(),

    -- evita duplicados se um ficheiro pendente for reenviado
    constraint sms_mensagens_dispositivo_sms_unico unique (device_id, sms_id)
);

create index if not exists sms_mensagens_device_idx on public.sms_mensagens (device_id);
create index if not exists sms_mensagens_numero_idx on public.sms_mensagens (numero);

-- Row Level Security: fica ligado por omissão no Supabase.
-- Como a sincronização é feita a partir do teu próprio telemóvel usando a
-- service_role key (que ignora RLS), não precisas de nenhuma política extra
-- desde que uses SUPABASE_KEY = service_role no .env do dispositivo — NUNCA
-- coloques a service_role key no frontend/app.py nem a comites no git.
--
-- Se preferires usar a chave "anon" (menos sensível, mas então qualquer
-- pessoa com essa chave consegue inserir linhas), activa RLS e cria uma
-- política de insert explícita:
--
-- alter table public.sms_mensagens enable row level security;
-- create policy "permitir insert via anon key"
--   on public.sms_mensagens for insert
--   to anon
--   with check (true);
