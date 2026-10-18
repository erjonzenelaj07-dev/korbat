-- LAB B (the clock) and LAB D (ten items in one confirmed transaction, the refusals, the held notice), as korbat_api.
\set S '00000000-0000-4000-8000-000000000001'
\set M '00000000-0000-4000-8000-00000000000a'
\set KM '00000000-0000-4000-8000-0000000000aa'
\set N '00000000-0000-4000-8000-00000000000b'
\set KN '00000000-0000-4000-8000-0000000000bb'
\pset format unaligned
\pset tuples_only on
\echo B1 an order from the message received 70 minutes ago: the deadline has passed; Annex III stops the clock; a clarification (the message received 1 minute ago) starts a fresh hour
select lab_order_open('00000000-0000-4000-8000-000000000e02', 'tco_removal', 'ES', 'CITCO', 'B-1', false, array['00000000-0000-4000-8000-000000000b0e']::uuid[], :'N') as ob \gset
select 'open', stopped, round(extract(epoch from clock_timestamp() - clock_start) / 60) as minutes_run, deadline_at < clock_timestamp() as overdue from legal_order_clock where order_id = :'ob';
insert into legal_order_events (order_id, kind, ground, by_staff) values (:'ob', 'annex3_sent', 'manifest_error', :'N');
select 'annex3', stopped, deadline_at from legal_order_clock where order_id = :'ob';
insert into legal_order_events (order_id, kind, effective_at, by_staff) select :'ob', 'clarification_received', m.received_at, :'N' from contact_messages m where m.id = '00000000-0000-4000-8000-000000000e05';
select 'clarified', stopped, deadline_at - clock_start as hour, round(extract(epoch from deadline_at - clock_timestamp()) / 60) as minutes_left from legal_order_clock where order_id = :'ob';
begin; select lab_order_effect(:'ob', :'N', :'KN'); commit;
select 'effect', within_hour from legal_order_clock where order_id = :'ob';
\echo D1 ten posts under one order with Section C, one transaction, one audit row; then what the author side would read
select lab_order_open('00000000-0000-4000-8000-000000000e01', 'tco_removal', 'FR', 'OCLCTIC', 'D-10', true, (select array_agg(id order by id) from posts where author_id = :'S' and id between '00000000-0000-4000-8000-000000000b04' and '00000000-0000-4000-8000-000000000b0d'), :'N') as od \gset
select seq as before from audit_head \gset
begin; select lab_order_effect(:'od', :'N', :'KN') as items; commit;
select 'audit rows written', (select seq from audit_head) - :before;
select 'took ms', round(took_ms, 1) from lab_events where kind = 'order_effect' and n = 10;
select 'posts', count(*), min(state::text), max(moderation_level::text) from posts p join legal_order_items i on i.post_id = p.id where i.order_id = :'od';
select 'decisions', count(*), count(informed_at) as told, min(author_mail::text), max(author_mail::text) from decisions d join legal_order_items i on i.id = d.order_item_id where i.order_id = :'od';
select 'an author-side read (informed_at is not null) returns', count(*) from decisions d join legal_order_items i on i.id = d.order_item_id where i.order_id = :'od' and d.informed_at is not null;
select 'hold until is the computed end', order_hold_until(:'od') = order_hold_end((select received_at from legal_orders where id = :'od'), false);
select 'release now', order_notices_release();
\echo D2 the refusals, each rolled back: no audit row; another action; a forged reference; an item the row does not name; a second measure; an account that is not staff
select lab_order_open('00000000-0000-4000-8000-000000000e04', 'tco_removal', 'FR', 'OCLCTIC', 'D-R', false, array['00000000-0000-4000-8000-000000000b03', '00000000-0000-4000-8000-000000000b02']::uuid[], :'N') as orf \gset
begin; select lab_order_effect(:'orf', :'N', :'KN', 'no_audit'); commit;
begin; select lab_order_effect(:'orf', :'N', :'KN', 'wrong_action'); commit;
begin; select lab_order_effect(:'orf', :'N', :'KN', 'wrong_reference'); commit;
begin; select lab_order_effect(:'orf', :'N', :'KN', 'missing_item'); commit;
begin; select lab_order_effect(:'orf', :'N', :'KN', 'extra_measure'); commit;
begin; select lab_order_effect(:'orf', :'S', :'KN'); commit;
select 'nothing stuck', count(*) from posts where id in ('00000000-0000-4000-8000-000000000b03', '00000000-0000-4000-8000-000000000b02') and state = 'visible';
