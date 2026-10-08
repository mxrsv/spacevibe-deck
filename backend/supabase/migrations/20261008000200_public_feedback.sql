-- Owner decision: submissions enter Pending without a moderation step.
-- Incomplete uploads remain excluded by the API's ready=true filter.
alter table public.feedback_reports alter column status set default 'pending';
update public.feedback_reports set status = 'pending' where status in ('private', 'hidden');
