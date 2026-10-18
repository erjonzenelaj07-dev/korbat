-- LAB F, part 2, on labf (the restored backup). The import as the migrator, the attempts to write the ledger without
-- a key, and the re-application under a key. Run as the superuser, with SET ROLE for each actor.
\pset format unaligned
\pset tuples_only on
\echo F4 the restored database: the head, and the lost order and measures are not there
select seq, left(hash, 12) from public.audit_head;
select 'orders F-1', count(*) from public.legal_orders where reference = 'F-1';
select 'state', right(id::text, 4), state from public.posts where id in ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-000000000b0e') order by id;
set role korbat_migrate;
create table public.restore_gaps (id bigserial primary key, place bigint not null, hash text not null, action text not null, target_type text, target_id text,
  metadata jsonb, acted_at timestamptz not null, class text not null, closed_at timestamptz, closed_by uuid, disposition text);
create table public.restore_tail (line jsonb not null);
\copy public.restore_tail from 'tail.jsonl' with (format csv, quote E'\x01', delimiter E'\x02')
-- The import: refuses a tail that does not continue the restored head; inserts the plain records again with their
-- original times; writes one gap a lost row; touches neither decisions nor decision_actions.
create function public.lab_restore_import() returns text language plpgsql set search_path = public, pg_temp as $$
declare
  head public.audit_head;
  r record;
  prev text;
  n_orders integer := 0;
  n_gaps integer := 0;
  oid uuid;
begin
  select h.* into head from public.audit_head h where h.id = 1;
  prev := head.hash;
  for r in select t.line from public.restore_tail t where (t.line ->> 'place')::bigint > head.seq order by (t.line ->> 'place')::bigint loop
    if r.line ->> 'prevHash' is distinct from prev then
      raise exception 'tail_not_continuous' using detail = format('place %s does not follow the restored head or the row before it', r.line ->> 'place');
    end if;
    prev := r.line ->> 'hash';
    if r.line ->> 'action' = 'order_opened' then
      oid := (r.line ->> 'targetId')::uuid;
      insert into public.legal_orders (id, kind, member_state, authority, reference, channel, received_at, section_c, emergency, cross_border, withhold_from_author,
                                       opened_by, opened_via, opened_at, imported_at)
      select oid, m ->> 'kind', m ->> 'memberState', m ->> 'authority', m ->> 'reference', m ->> 'channel', (m ->> 'receivedAt')::timestamptz, (m ->> 'sectionC')::boolean,
             (m ->> 'emergency')::boolean, (m ->> 'crossBorder')::boolean, (m ->> 'withholdFromAuthor')::boolean, (r.line ->> 'actor')::uuid, 'console',
             (m ->> 'openedAt')::timestamptz, now()
        from (select r.line -> 'metadata' as m) x;
      insert into public.legal_order_items (id, order_id, position, link, post_id)
      select (i ->> 'itemId')::uuid, oid, (i ->> 'position')::smallint, i ->> 'link', (i ->> 'postId')::uuid from jsonb_array_elements(r.line -> 'metadata' -> 'items') i;
      insert into public.legal_order_events (order_id, kind, at, by_staff, via) values (oid, 'opened', (r.line ->> 'at')::timestamptz, (r.line ->> 'actor')::uuid, 'console'), (oid, 'imported', null, null, 'cli');
      n_orders := n_orders + 1;
    elsif r.line ->> 'action' = 'order_effected' then
      -- The items keep the first disabling's time: preservation runs from it, and a re-applied disabling starts no new period.
      update public.legal_order_items i set disabled_at = (r.line ->> 'at')::timestamptz, preserve_until = public.order_preserve_until((r.line ->> 'at')::timestamptz)
       where i.id in (select (k)::uuid from jsonb_object_keys(r.line -> 'metadata' -> 'decisionIds') k);
    end if;
    insert into public.restore_gaps (place, hash, action, target_type, target_id, metadata, acted_at, class)
    values ((r.line ->> 'place')::bigint, r.line ->> 'hash', r.line ->> 'action', r.line ->> 'targetType', r.line ->> 'targetId', r.line -> 'metadata', (r.line ->> 'at')::timestamptz,
            case r.line ->> 'action' when 'order_effected' then 'order_effect' when 'order_opened' then 'record' else 'restriction' end);
    n_gaps := n_gaps + 1;
  end loop;
  update public.restore_gaps set closed_at = now(), disposition = 'imported' where class = 'record';
  return format('%s orders imported, %s gaps', n_orders, n_gaps);
end $$;
\echo F5 a tail whose first row does not follow the restored head is refused
begin;
update public.restore_tail set line = jsonb_set(line, '{prevHash}', '"00"') where (line ->> 'place')::bigint = (select min((line ->> 'place')::bigint) from public.restore_tail);
select public.lab_restore_import();
rollback;
\echo F6 the import
select public.lab_restore_import();
select 'gaps', place, action, class, disposition from public.restore_gaps order by place;
select 'order', reference, imported_at is not null, opened_at < now() - interval '1 second' as original_time, order_hold_until(id) is not null as held from public.legal_orders where reference = 'F-1';
select 'item', disabled_at is not null, preserve_until is not null, action_id is null as no_measure_yet, 'frozen already', post_frozen(post_id) from public.legal_order_items i join public.legal_orders o on o.id = i.order_id where o.reference = 'F-1';
select 'ledger rows written by the import', count(*) from public.decisions d where d.decided_at > (select imported_at from public.legal_orders where reference = 'F-1') - interval '5 seconds' and d.decided_at >= (select max(closed_at) from public.restore_gaps);
select 'P1 still', state from public.posts where id = '00000000-0000-4000-8000-000000000b01';
\echo F7 the migrator copies the lost decision and its measure into the ledger by hand: (a) with no audit row; (b) with an audit row of the system actor
begin;
insert into public.cases (target_type, target_id, opened_at) values ('post', '00000000-0000-4000-8000-000000000b01', now());
insert into public.intakes (kind, ref, channel, alleges_illegal, category, received_at) values ('order', public.lab_ref(), 'authority', true, 'STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY', now());
insert into public.intake_items (intake_id, position, target_type, target_id, case_id, lane, created_at)
select (select id from public.intakes order by received_at desc limit 1), 1, 'post', '00000000-0000-4000-8000-000000000b01', (select id from public.cases where target_id = '00000000-0000-4000-8000-000000000b01' and closed_at is null), 0, now();
update public.legal_order_items i set intake_item_id = (select x.id from public.intake_items x where x.target_id = '00000000-0000-4000-8000-000000000b01' and x.answered_by is null)
 where i.post_id = '00000000-0000-4000-8000-000000000b01' and i.order_id = (select id from public.legal_orders where reference = 'F-1');
insert into public.evidence_snapshots (case_id, target_type, target_id, taken_at, author_handle, body, salt, digest)
select c.id, 'post', c.target_id, now(), 's', 'x', repeat('ab', 32), public.lab_digest(repeat('ab', 32), 'x') from public.cases c where c.target_id = '00000000-0000-4000-8000-000000000b01' and c.closed_at is null;
insert into public.decisions (case_id, kind, order_item_id, seen_state_version, through_seq, outcome, ground, rules_version, redress_version, category, source,
                              snapshot_id, snapshot_digest, decided_by, decided_at, xact, puid, informed_at, suspect, needs_admin, ended_interim)
select c.id, 'order', i.id, c.state_version, 0, 'restricted', 'illegal', 2, 1, 'STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY', 'order', s.id, s.digest,
       '00000000-0000-4000-8000-00000000000b', now() - interval '1 hour', '1'::xid8, 'x', now() - interval '1 hour', false, false, false
  from public.cases c join public.legal_order_items i on i.post_id = c.target_id join public.legal_orders o on o.id = i.order_id and o.reference = 'F-1'
  join public.evidence_snapshots s on s.case_id = c.id where c.closed_at is null;
select 'forced by the trigger', decided_at = now() as decided_now, xact = pg_current_xact_id() as this_transaction from public.decisions order by decided_at desc limit 1;
insert into public.decision_actions (decision_id, kind, subject_account_id, created_at)
select d.id, 'disable_by_order', '00000000-0000-4000-8000-000000000001', now() - interval '1 hour' from public.decisions d order by d.decided_at desc limit 1;
select 'inside the transaction', state from public.posts where id = '00000000-0000-4000-8000-000000000b01';
savepoint a;
set constraints all immediate;
rollback to a;
insert into public.audit_log (actor_id, action, target_type, target_id, metadata, request_id)
select '00000000-0000-4000-8000-00000000000b', 'order_effected', 'order', o.id::text, '{}'::jsonb, 'lab' from public.legal_orders o where o.reference = 'F-1';
commit;
select 'after the refused commit', state from public.posts where id = '00000000-0000-4000-8000-000000000b01';
reset role;
\echo F8 the re-application: the moderator, under a key, "Disable for an order" on the imported order
set role korbat_api;
begin; select lab_order_effect((select id from legal_orders where reference = 'F-1'), '00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000bb') as items; commit;
reset role;
set role korbat_migrate;
update public.restore_gaps g set closed_at = now(), disposition = 'reapplied', closed_by = (select i.decision_id from public.legal_order_items i where i.order_id::text = g.target_id limit 1) where g.class = 'order_effect';
select 'P1', state from public.posts where id = '00000000-0000-4000-8000-000000000b01';
select 'item', disabled_at < (select d.decided_at from public.decisions d where d.id = i.decision_id) as keeps_first_disabling, preserve_until = public.order_preserve_until(disabled_at) as keeps_first_period
  from public.legal_order_items i join public.legal_orders o on o.id = i.order_id where o.reference = 'F-1';
select 'notice still held', d.informed_at is null, d.author_mail from public.decisions d join public.legal_order_items i on i.decision_id = d.id join public.legal_orders o on o.id = i.order_id where o.reference = 'F-1';
select 'open gaps', class, count(*) from public.restore_gaps where closed_at is null group by class;
