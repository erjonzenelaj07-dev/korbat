-- LAB 3f seed, as the superuser: an admin M and a moderator N, each with a staff key; the author S with 14 posts, two
-- images on the first; a post by the moderator N; three contact messages; the limits raised except where a test lowers them.
INSERT INTO auth.users (id, email, role) VALUES ('00000000-0000-4000-8000-00000000000a', 'm@lab.test', 'admin');
INSERT INTO auth.users (id, email, role) VALUES ('00000000-0000-4000-8000-00000000000b', 'n@lab.test', 'moderator');
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-4000-8000-000000000001', 's@lab.test'), ('00000000-0000-4000-8000-000000000002', 't@lab.test');
INSERT INTO auth.staff_keys (id, user_id, credential_id, public_key, name, origin, rp_id) VALUES
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000000a', 'cred-a', 'pk', 'lab key a', 'https://console.lab', 'console.lab'),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000000b', 'cred-b', 'pk', 'lab key b', 'https://console.lab', 'console.lab');
INSERT INTO public.profiles (id, handle, display_name) SELECT u.id, split_part(u.email, '@', 1), split_part(u.email, '@', 1) FROM auth.users u;
INSERT INTO public.handle_history (handle_lower, profile_id) SELECT lower(p.handle), p.id FROM public.profiles p;
INSERT INTO public.moderation_limits (id, decisions_per_hour, decisions_per_day, case_opens_per_day, findings_per_day, reveals_per_day, updated_at)
VALUES (1, 1000, 1000, 1000, 1000, 1000, now())
ON CONFLICT (id) DO UPDATE SET decisions_per_hour = 1000, decisions_per_day = 1000;
INSERT INTO public.posts (id, author_id, body) SELECT ('00000000-0000-4000-8000-000000000b' || lpad(to_hex(i), 2, '0'))::uuid, '00000000-0000-4000-8000-000000000001', 'post ' || i FROM generate_series(1, 14) i;
INSERT INTO public.posts (id, author_id, body) VALUES ('00000000-0000-4000-8000-000000000c01', '00000000-0000-4000-8000-00000000000b', 'a post by the moderator');
INSERT INTO public.post_media (id, owner_id, status, position, width, height, blurhash, alt_text) VALUES
  ('00000000-0000-4000-8000-000000000d01', '00000000-0000-4000-8000-000000000001', 'ready', 0, 10, 10, 'x', 'alt one'),
  ('00000000-0000-4000-8000-000000000d02', '00000000-0000-4000-8000-000000000001', 'ready', 1, 10, 10, 'x', 'alt two');
UPDATE public.post_media SET post_id = '00000000-0000-4000-8000-000000000b01' WHERE id IN ('00000000-0000-4000-8000-000000000d01', '00000000-0000-4000-8000-000000000d02');
INSERT INTO public.contact_messages (id, folder, uidvalidity, uid, received_at, seen_at) VALUES
  ('00000000-0000-4000-8000-000000000e01', 'inbox', 1, 1, clock_timestamp() - interval '15 minutes', clock_timestamp()),
  ('00000000-0000-4000-8000-000000000e02', 'inbox', 1, 2, clock_timestamp() - interval '70 minutes', clock_timestamp()),
  ('00000000-0000-4000-8000-000000000e03', 'junk', 1, 1, clock_timestamp() - interval '5 minutes', clock_timestamp()),
  ('00000000-0000-4000-8000-000000000e04', 'inbox', 1, 3, clock_timestamp() - interval '2 minutes', clock_timestamp()),
  ('00000000-0000-4000-8000-000000000e05', 'inbox', 1, 4, clock_timestamp() - interval '1 minutes', clock_timestamp());
