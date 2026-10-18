-- LAB B2, as korbat_api on lab3f: a second Annex III and a clarification that is effective after it; a sending time earlier than the receipt.
\pset format unaligned
\pset tuples_only on
\echo B2 Annex III now, then a clarification effective now: a fresh hour from the clarification, not the rest of the old one
select id as ob from legal_orders where reference = 'B-1' \gset
insert into legal_order_events (order_id, kind, ground, by_staff) values (:'ob', 'annex3_sent', 'missing_information', '00000000-0000-4000-8000-00000000000b');
select 'annex3', stopped, deadline_at from legal_order_clock where order_id = :'ob';
select pg_sleep(1);
insert into legal_order_events (order_id, kind, by_staff) values (:'ob', 'clarification_received', '00000000-0000-4000-8000-00000000000b');
select 'clarified', stopped, deadline_at - clock_start as hour, clock_start > (select received_at from legal_orders where id = :'ob') + interval '60 minutes' as start_is_after_the_first_deadline,
       round(extract(epoch from deadline_at - clock_timestamp()) / 60) as minutes_left from legal_order_clock where order_id = :'ob';
\echo B3 the import kept the times of the lost order (labf against the tail)
