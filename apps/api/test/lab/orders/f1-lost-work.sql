-- LAB F, part 1, on lab3f AFTER the database labf was copied from it (labf is "the backup"): the work a restore loses,
-- and the export of the audit log's tail (the keeper's daily copy). Run as the superuser; the work itself as korbat_api.
\pset format unaligned
\pset tuples_only on
update public.moderation_limits set decisions_per_hour = 1000, decisions_per_day = 1000;
delete from auth.staff_personal_accounts;
select seq as head0 from public.audit_head \gset
\echo F1 the head at the backup
select :head0, left(hash, 12) from public.audit_head;
set role korbat_api;
\echo F2 lost work: an order opened (its audit row holds its facts) and given effect on P1; a removal of P14 under R5
select lab_order_open('00000000-0000-4000-8000-000000000e03', 'tco_removal', 'NL', 'ATKM', 'F-1', true, array['00000000-0000-4000-8000-000000000b01']::uuid[], '00000000-0000-4000-8000-00000000000b') as oflost \gset
insert into public.audit_log (actor_id, action, target_type, target_id, metadata, request_id)
select '00000000-0000-4000-8000-00000000000b', 'order_opened', 'order', o.id::text,
       jsonb_build_object('kind', o.kind, 'memberState', o.member_state, 'authority', o.authority, 'reference', o.reference, 'channel', o.channel,
         'receivedAt', o.received_at, 'openedAt', o.opened_at, 'sectionC', o.section_c, 'emergency', o.emergency, 'crossBorder', o.cross_border,
         'withholdFromAuthor', o.withhold_from_author,
         'items', (select jsonb_agg(jsonb_build_object('itemId', i.id, 'position', i.position, 'link', i.link, 'postId', i.post_id) order by i.position) from public.legal_order_items i where i.order_id = o.id)),
       'lab'
  from public.legal_orders o where o.id = :'oflost';
begin; select lab_order_effect(:'oflost', '00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000bb'); commit;
begin; select lab_remove('00000000-0000-4000-8000-000000000b0e', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000aa', 'R5') is not null; commit;
select 'lost state', right(id::text, 4), state from public.posts where id in ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-000000000b0e') order by id;
\echo F3 the tail: every audit row after the head at the backup, as JSON lines
select count(*), string_agg(action, ', ' order by chain_seq) from public.audit_log where chain_seq > :head0;
\o tail.jsonl
select jsonb_build_object('place', chain_seq, 'prevHash', prev_hash, 'hash', hash, 'action', action, 'actor', actor_id, 'targetType', target_type, 'targetId', target_id,
                          'metadata', metadata, 'at', created_at, 'stepUp', step_up is not null)::text
  from public.audit_log where chain_seq > :head0 order by chain_seq;
\o
