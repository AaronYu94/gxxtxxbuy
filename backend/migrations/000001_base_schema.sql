create table if not exists app_runtime_metadata (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists app_runtime_metadata_set_updated_at on app_runtime_metadata;

create trigger app_runtime_metadata_set_updated_at
before update on app_runtime_metadata
for each row
execute function set_updated_at();

insert into app_runtime_metadata (key, value)
values ('schema', '{"name":"goatedbuy","base_version":1}'::jsonb)
on conflict (key) do nothing;
