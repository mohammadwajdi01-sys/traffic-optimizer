-- New accounts default to no additional buffer; existing preferences stay unchanged.
alter table public.user_preferences alter column safety_buffer set default 0;
