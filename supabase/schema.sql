create table if not exists companies (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  dominio     text,
  uf          text,
  cidade      text,
  setor       text,
  faturamento_usd numeric,
  segmento    text,
  cei_status  text,
  status_aws  text,
  created_at  timestamptz default now()
);

create table if not exists leads (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid references companies(id) on delete cascade,
  nome_contato        text,
  cargo               text,
  email               text,
  whatsapp            text,
  linkedin_url        text,
  vertical_bluedocs   text,
  icp_score           text,
  dor_primaria        text,
  caso_uso_bluedocs   text,
  dados_apollo        jsonb,
  hubspot_company_id  text,
  hubspot_contact_id  text,
  hubspot_deal_id     text,
  status              text default 'imported',
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create table if not exists messages (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid references leads(id) on delete cascade,
  canal         text,
  conteudo      text,
  status        text,
  reply_content text,
  sent_at       timestamptz
);
