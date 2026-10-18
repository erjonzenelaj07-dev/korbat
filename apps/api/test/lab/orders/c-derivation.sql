-- LAB C, as korbat_api: the new measure against moderation_apply's derivation, the readers, hiding from the author, the freeze.
\set S '00000000-0000-4000-8000-000000000001'
\set T '00000000-0000-4000-8000-000000000002'
\set M '00000000-0000-4000-8000-00000000000a'
\set KM '00000000-0000-4000-8000-0000000000aa'
\set N '00000000-0000-4000-8000-00000000000b'
\set KN '00000000-0000-4000-8000-0000000000bb'
\set P1 '00000000-0000-4000-8000-000000000b01'
\set P2 '00000000-0000-4000-8000-000000000b02'
\set PN '00000000-0000-4000-8000-000000000c01'
\pset format unaligned
\pset tuples_only on
\echo C1 a TCO order without Section C on P1 (two images) and on the post of the moderator, opened and given effect by the moderator N
select lab_order_open('00000000-0000-4000-8000-000000000e01', 'tco_removal', 'FR', 'OCLCTIC', 'TCO-1', false, array[:'P1', :'PN']::uuid[], :'N') as o1 \gset
begin; select lab_order_effect(:'o1', :'N', :'KN') as items; commit;
select 'post', right(id::text, 4), state, moderation_level from posts where id in (:'P1', :'PN') order by id;
select 'decision', kind, source, outcome, ground, category_keyword, needs_admin, informed_at = decided_at as told_at_once, author_mail from decisions where order_item_id is not null order by decided_at, id;
select 'action', a.kind, a.withhold_author, a.no_effect from decision_actions a join decisions d on d.id = a.decision_id where d.order_item_id is not null;
select 'item', position, disabled_at is not null as disabled, preserve_until = order_preserve_until(disabled_at) as preserved_6m_1d, preserve_until - disabled_at as span from legal_order_items where order_id = :'o1' order by position;
select 'case', right(target_id::text, 4), closed_at is not null as closed, intake_seq, answered_seq from cases order by target_id;
select 'clock', stopped, deadline_at - clock_start as hour, within_hour from legal_order_clock where order_id = :'o1';
\echo C2 the readers: postAccess as SQL for the author, another account and signed out; isShown of serve on the state of the post; the own state of each image
select 'postAccess author', lab_post_access(:'S', :'P1'), 'other', lab_post_access(:'T', :'P1'), 'signed out', lab_post_access(null, :'P1');
select 'serve isShown(post state)', state::text in ('visible', 'withheld', 'removed') from posts where id = :'P1';
select 'image', right(id::text, 4), moderation_state from post_media where post_id = :'P1' order by id;
select 'frozen (preserved)', post_frozen(:'P1');
\echo C3 gate K: a delete of the images of a preserved post deletes nothing
delete from post_media where post_id = :'P1' returning id;
select 'image rows left', count(*) from post_media where post_id = :'P1';
\echo C4 a removal under a korbat rule on the same post, after the order: the level stays disabled; the case and the order item
begin; select lab_remove(:'P1', :'M', :'KM', 'R5') as d_remove \gset
commit;
select 'post after remove', state, moderation_level from posts where id = :'P1';
select 'remove no_effect', no_effect from decision_actions where decision_id = :'d_remove';
\echo C5 reinstatement by the moderator is refused (admin); by the admin without a ground is refused; with a ground it lifts the measure of the order: the post is removed, not visible
select d.id as d_order from decisions d join legal_order_items i on i.id = d.order_item_id where i.post_id = :'P1' \gset
begin; select lab_correct(:'d_order', :'N', :'KN', 'reinstate_by_order', 'withdrawn'); rollback;
begin; select lab_correct(:'d_order', :'M', :'KM', 'reinstate_by_order', null); rollback;
begin; select lab_correct(:'d_order', :'M', :'KM', 'reinstate_by_order', 'withdrawn') as d_reinst \gset
commit;
select 'post after reinstatement', state, moderation_level, lab_post_access(:'S', :'P1') from posts where id = :'P1';
select 'item', reinstated_at is not null, preserve_ended_at is not null, 'frozen', post_frozen(:'P1') from legal_order_items where post_id = :'P1';
select 'events', string_agg(kind || coalesce(':' || ground, ''), ', ' order by at) from legal_order_events where order_id = :'o1';
\echo C6 the removal corrected too: visible again; then the other order: disable first, remove second, reverse the removal first
begin; select lab_correct(:'d_remove', :'M', :'KM', 'restore', null); commit;
select 'post after both reversals', state, moderation_level from posts where id = :'P1';
begin; select lab_remove(:'P2', :'M', :'KM', 'R5') as d_remove2 \gset
commit;
select lab_order_open('00000000-0000-4000-8000-000000000e03', 'tco_removal', 'FR', 'OCLCTIC', 'TCO-2', false, array[:'P2']::uuid[], :'N') as o2 \gset
begin; select lab_order_effect(:'o2', :'N', :'KN'); commit;
select 'P2 removed then disabled', state, moderation_level from posts where id = :'P2';
begin; select lab_correct(:'d_remove2', :'M', :'KM', 'restore', null); commit;
select 'P2 removal reversed, order stands', state, moderation_level, lab_post_access(:'S', :'P2') from posts where id = :'P2';
\echo C7 a dsa_art9 order that does not withhold from the author: level removed, shown to its author alone, nothing preserved
select lab_order_open('00000000-0000-4000-8000-000000000e04', 'dsa_art9', 'DE', 'Landesmedienanstalt', 'A9-1', false, array['00000000-0000-4000-8000-000000000b03']::uuid[], :'N') as o3 \gset
begin; select lab_order_effect(:'o3', :'N', :'KN'); commit;
select 'art9 post', state, moderation_level, lab_post_access(:'S', id), lab_post_access(:'T', id), 'frozen', post_frozen(id) from posts where id = '00000000-0000-4000-8000-000000000b03';
\echo C8 the author deletes a disabled post by the statement of the API (posts_guard allows it; the route must answer not_found first)
update posts set state = 'deleted_by_author', body = '' where id = :'P2';
select 'deleted while disabled', state, moderation_level from posts where id = :'P2';
select 'snapshot kept', count(*) filter (where body is not null), 'frozen', post_frozen(:'P2') from evidence_snapshots where target_id = :'P2';
\echo C9 what the API role may not do
insert into legal_order_events (order_id, kind) values (:'o1', 'hold_ended');
update legal_orders set section_c = true where id = :'o1';
update legal_order_items set preserve_until = now() where order_id = :'o1';
update decisions set informed_at = now() where order_item_id is not null;
insert into legal_orders (id, kind, member_state, authority, reference, channel, section_c, emergency, cross_border, withhold_from_author) values (gen_random_uuid(), 'tco_removal', 'FR', 'x', 'no-message', 'mailbox', false, false, true, true);
