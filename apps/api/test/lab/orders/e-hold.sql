-- LAB E: the end of a non-disclosure period. (1) order_hold_end against Regulation 1182/71 Art. 3 in EU time zones;
-- (2) the release at the period's last moment, with the real clock.
\pset format unaligned
\pset tuples_only on
\echo E1 300,000 random instants of 2026 to 2030 and the hours around every clock change, in eight zones: hold_end minus the end of the same weekday six weeks later in that zone
with zones(z) as (values ('Atlantic/Azores'), ('Europe/Lisbon'), ('Europe/Dublin'), ('Europe/Berlin'), ('Europe/Paris'), ('Europe/Helsinki'), ('Europe/Athens'), ('Asia/Nicosia')),
t as (select timestamptz '2026-01-01 00:00+00' + random() * interval '1826 days' as at from generate_series(1, 300000)
      union all select d + (h || ' minutes')::interval from unnest(array[timestamptz '2026-03-29 00:00+00', '2026-10-25 00:00+00', '2027-03-28 00:00+00', '2027-10-31 00:00+00']) d,
                generate_series(-180, 1620, 1) h
      union all select (d - 43)::timestamp at time zone 'UTC' + (h || ' minutes')::interval from unnest(array[date '2026-03-29', '2026-10-25', '2027-03-28', '2027-10-31']) d, generate_series(-180, 1620, 1) h)
select z, count(*) as instants,
       count(*) filter (where public.order_hold_end(at, false) < (((at at time zone z)::date + 43)::timestamp at time zone z)) as early,
       min(public.order_hold_end(at, false) - (((at at time zone z)::date + 43)::timestamp at time zone z)) as least_late,
       max(public.order_hold_end(at, false) - (((at at time zone z)::date + 43)::timestamp at time zone z)) as most_late
  from t cross join zones group by z order by z;
\echo E2 the hold from the instant itself: shortest and longest; and an extension adds exactly 42 days
select min(public.order_hold_end(at, false) - at), max(public.order_hold_end(at, false) - at), min(public.order_hold_end(at, true) - public.order_hold_end(at, false)), max(public.order_hold_end(at, true) - public.order_hold_end(at, false))
  from (select timestamptz '2026-01-01 00:00+00' + random() * interval '1826 days' as at from generate_series(1, 300000)) t;
\echo E3 the same value in three session time zones; and against the plain "plus 42 days" of the earlier lab
set timezone = 'UTC'; select 'UTC', public.order_hold_end('2026-10-06 21:30+00', false) at time zone 'UTC', (timestamptz '2026-10-06 21:30+00' + interval '42 days') at time zone 'UTC';
set timezone = 'Europe/Berlin'; select 'Berlin', public.order_hold_end('2026-10-06 21:30+00', false) at time zone 'UTC', (timestamptz '2026-10-06 21:30+00' + interval '42 days') at time zone 'UTC';
set timezone = 'America/New_York'; select 'New York', public.order_hold_end('2026-10-06 21:30+00', false) at time zone 'UTC', (timestamptz '2026-10-06 21:30+00' + interval '42 days') at time zone 'UTC';
reset timezone;
