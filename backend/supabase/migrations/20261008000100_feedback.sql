-- Feedback is private until the owner changes status in Supabase Studio.
create table public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null unique,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  title text not null check (char_length(title) between 3 and 120),
  body text not null default '' check (char_length(body) <= 2000),
  category text not null check (category in ('bug', 'idea', 'other')),
  status text not null default 'private' check (status in ('private', 'pending', 'review', 'done', 'hidden')),
  ready boolean not null default false,
  images jsonb not null default '[]' check (jsonb_typeof(images) = 'array' and jsonb_array_length(images) <= 3),
  created_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  updated_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint
);
create index feedback_reports_created on public.feedback_reports (created_at desc, id desc);
alter table public.feedback_reports enable row level security;
revoke all on public.feedback_reports from anon, authenticated;
grant all on public.feedback_reports to service_role;

-- Bound anonymous storage writes across all Worker locations, including retries.
create function public.guard_feedback_intake() returns trigger
language plpgsql set search_path = '' as $$
declare daily_limit constant integer := 100;
begin
  perform pg_advisory_xact_lock(83740261);
  if exists (select 1 from public.feedback_reports where draft_id = new.draft_id) then
    return new;
  end if;
  if (select count(*) from public.feedback_reports
      where created_at >= (extract(epoch from clock_timestamp()) * 1000)::bigint - 86400000) >= daily_limit then
    raise exception using errcode = 'P0001', message = 'feedback_intake_limit';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_feedback_intake() from public, anon, authenticated;
create trigger feedback_intake_limit before insert on public.feedback_reports
for each row execute function public.guard_feedback_intake();

create function public.touch_feedback_report() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  return new;
end;
$$;
revoke all on function public.touch_feedback_report() from public, anon, authenticated;
create trigger feedback_report_updated before update on public.feedback_reports
for each row execute function public.touch_feedback_report();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-images', 'feedback-images', false, 5242880, array['image/png', 'image/jpeg', 'image/webp']);
-- No Storage policies: only the server service role and Studio administrators can access files.
