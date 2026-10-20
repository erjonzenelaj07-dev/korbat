-- LAB 3d seed, as the superuser: an admin A and a moderator B, each with a staff key; the author S with ten posts:
-- b01 one image (d01); b02 two images (d02, d03); b03 two (d04, d05); b04 one (d06); b05 one (d07); b06 one (d08);
-- b07 one (d09); b08 one (d0a).
INSERT INTO auth.users (id, email, role) VALUES ('00000000-0000-4000-8000-00000000000a', 'a@lab.test', 'admin');
INSERT INTO auth.users (id, email, role) VALUES ('00000000-0000-4000-8000-00000000000b', 'b@lab.test', 'moderator');
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-4000-8000-000000000001', 's@lab.test');
INSERT INTO auth.staff_keys (id, user_id, credential_id, public_key, name, origin, rp_id) VALUES
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000000a', 'cred-a', 'pk', 'lab key a', 'https://console.lab', 'console.lab'),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000000b', 'cred-b', 'pk', 'lab key b', 'https://console.lab', 'console.lab');
INSERT INTO public.profiles (id, handle, display_name) SELECT u.id, split_part(u.email, '@', 1), split_part(u.email, '@', 1) FROM auth.users u;
INSERT INTO public.handle_history (handle_lower, profile_id) SELECT lower(p.handle), p.id FROM public.profiles p;
INSERT INTO public.moderation_limits (id, decisions_per_hour, decisions_per_day, case_opens_per_day, findings_per_day, reveals_per_day, updated_at)
VALUES (1, 1000, 1000, 1000, 1000, 1000, now())
ON CONFLICT (id) DO UPDATE SET decisions_per_hour = 1000, decisions_per_day = 1000;
INSERT INTO public.posts (id, author_id, body) SELECT ('00000000-0000-4000-8000-000000000b' || lpad(to_hex(i), 2, '0'))::uuid, '00000000-0000-4000-8000-000000000001', 'post ' || i FROM generate_series(1, 10) i;
INSERT INTO public.post_media (id, owner_id, status, position, width, height, blurhash, alt_text)
SELECT ('00000000-0000-4000-8000-000000000d' || lpad(to_hex(i), 2, '0'))::uuid, '00000000-0000-4000-8000-000000000001', 'ready', 0, 10, 10, 'x', 'alt ' || i FROM generate_series(1, 10) i;
UPDATE public.post_media SET post_id = '00000000-0000-4000-8000-000000000b01' WHERE id = '00000000-0000-4000-8000-000000000d01';
UPDATE public.post_media SET post_id = '00000000-0000-4000-8000-000000000b02' WHERE id = '00000000-0000-4000-8000-000000000d02';
UPDATE public.post_media SET post_id = '00000000-0000-4000-8000-000000000b02', position = 1 WHERE id = '00000000-0000-4000-8000-000000000d03';
UPDATE public.post_media SET post_id = '00000000-0000-4000-8000-000000000b03' WHERE id = '00000000-0000-4000-8000-000000000d04';
UPDATE public.post_media SET post_id = '00000000-0000-4000-8000-000000000b03', position = 1 WHERE id = '00000000-0000-4000-8000-000000000d05';
UPDATE public.post_media SET post_id = '00000000-0000-4000-8000-000000000b04' WHERE id = '00000000-0000-4000-8000-000000000d06';
UPDATE public.post_media SET post_id = '00000000-0000-4000-8000-000000000b05' WHERE id = '00000000-0000-4000-8000-000000000d07';
UPDATE public.post_media SET post_id = '00000000-0000-4000-8000-000000000b06' WHERE id = '00000000-0000-4000-8000-000000000d08';
UPDATE public.post_media SET post_id = '00000000-0000-4000-8000-000000000b07' WHERE id = '00000000-0000-4000-8000-000000000d09';
UPDATE public.post_media SET post_id = '00000000-0000-4000-8000-000000000b08' WHERE id = '00000000-0000-4000-8000-000000000d0a';
