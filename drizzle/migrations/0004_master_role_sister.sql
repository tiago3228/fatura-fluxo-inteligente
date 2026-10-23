create or replace function app.assign_master_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(new.email) in ('tiago3228@yahoo.com.br', 'cristine.daisy21@gmail.com') then
    insert into public.user_roles (user_id, role)
    values (new.id, 'master')
    on conflict (user_id, role) do nothing;
  end if;
  return new;
end;
$$;