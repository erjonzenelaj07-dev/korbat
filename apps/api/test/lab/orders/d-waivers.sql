-- LAB D3 to D5, set up as the superuser, acted as korbat_api: the checks an order decision is not held to, and the release.
\pset format unaligned
\pset tuples_only on
\echo D3 the moderator N is linked to a personal account that is the author S: a removal by N is refused; with the decision caps at zero a removal by the admin is refused; the order is given effect by N all the same
insert into auth.staff_personal_accounts (staff_user_id, personal_user_id) values ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000001');
set role korbat_api;
begin; select lab_remove('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000bb', 'R5'); commit;
reset role;
update public.moderation_limits set decisions_per_hour = 0, decisions_per_day = 0;
set role korbat_api;
begin; select lab_remove('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000aa', 'R5'); commit;
begin; select lab_order_effect((select id from legal_orders where reference = 'D-R'), '00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000bb') as items; commit;
select 'given effect', count(*) from posts where id in ('00000000-0000-4000-8000-000000000b03', '00000000-0000-4000-8000-000000000b02') and state::text = 'disabled';
reset role;
\echo D4 the release at the end of the hold, with the real clock: the authority gave a written end three seconds from now (set as the migrator)
update public.legal_orders set authority_hold_until = clock_timestamp() + interval '3 seconds' where reference = 'D-10';
set role korbat_api;
select 'before the end', order_notices_release();
select pg_sleep(2);
select 'one second before the end', order_notices_release(), (select count(informed_at) from decisions d join legal_order_items i on i.id = d.order_item_id join legal_orders o on o.id = i.order_id where o.reference = 'D-10');
select pg_sleep(1.2);
select 'after the end', order_notices_release();
select 'told', count(informed_at), min(author_mail::text), bool_and(informed_at > decided_at) from decisions d join legal_order_items i on i.id = d.order_item_id join legal_orders o on o.id = i.order_id where o.reference = 'D-10';
select 'events', count(*) from legal_order_events where kind = 'notice_released';
select 'again', order_notices_release();
\echo D5 the predicate at the last microsecond of a computed end
select order_hold_end('2026-10-06 21:30+00', false) <= order_hold_end('2026-10-06 21:30+00', false) - interval '1 microsecond' as released_one_microsecond_before, order_hold_end('2026-10-06 21:30+00', false) <= order_hold_end('2026-10-06 21:30+00', false) as released_at_the_end;
